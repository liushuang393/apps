"""会議後に最強モデルで再処理する離線重跑の編排（P3-D）。

目的:
    実時パイプラインが残した PipelineEvent（回放ログ）を対象に、暗号化アーカイブの
    音声を最強 ASR で書き起こし直し、原文を最強 MT で全対象言語へ訳し直す。得られた
    高品質版は RerunResult に分離保存し、実時出力との diff は訓練訂正へ導出する。

入出力:
    - 入力: session_id（rerun_session）または個々の PipelineEvent（rerun_event）。
    - 出力: RerunSummary（件数集計）または RerunResult.id（重跑成功時）。

注意点:
    - 「失败=空字符串」契約: 注入する ASRFn/MTFn は失敗時に "" を返す。ASR が "" を
      返したら実時 asr_text へフォールバックする。音声も原文も無ければ SKIPPED。
    - 尊重原則: 機械重跑は人手訂正ではない。diff から導出する訂正は
      corrected_by="offline_rerun" かつ split=HOLDOUT とし、人手 review 前に学習へ
      入れない。訓練書き込みの失敗は重跑自体を失敗させない（try/except で握る）。
    - ステージ呼び出しは注入可能（テストで容易に差し替え）。DB アクセスは本モジュール
      名前空間へ import した関数越しに行い、テストで monkeypatch できる。
"""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING

from app.db.models import DataSplit, RerunStatus
from app.db.replay import (
    list_rerunnable_events,
    mark_rerun_status,
    save_rerun_result,
)
from app.db.training import (
    record_asr_correction,
    record_translation_correction,
)

if TYPE_CHECKING:
    from app.audio.archive import AudioArchive
    from app.db.models import PipelineEvent

logger = logging.getLogger(__name__)

# 注入可能な最強モデル呼び出しの型
# ASRFn: (wav_bytes, source_language) -> text（失敗時 ""）
ASRFn = Callable[[bytes, str], Awaitable[str]]
# MTFn: (text, source_language, target_language) -> translated（失敗時 ""）
MTFn = Callable[[str, str, str], Awaitable[str]]

# 名前付き定数（マジック値禁止）
_DEFAULT_TARGET_LANGS: tuple[str, ...] = ("ja", "en", "zh", "vi")


@dataclass
class RerunSummary:
    """離線重跑の件数集計（1 セッション分）。

    total は対象事件数、done/skipped/failed はその内訳。
    done + skipped + failed == total が常に成り立つ。
    """

    total: int = 0
    done: int = 0
    skipped: int = 0
    failed: int = 0


class OfflineReranker:
    """PipelineEvent を最強モデルで再処理する編排器。

    目的: 音声の再 ASR と原文の再 MT を行い、高品質版を RerunResult に保存しつつ、
        実時出力との差分を HOLDOUT 訂正として導出する。
    注意点: ASR/MT は注入。未注入なら該当段はスキップ（MT のみ・再処理なし等に縮退）。
    """

    def __init__(
        self,
        *,
        asr_fn: ASRFn | None = None,
        mt_fn: MTFn | None = None,
        archive: AudioArchive | None = None,
        target_languages: tuple[str, ...] = _DEFAULT_TARGET_LANGS,
        asr_model_name: str = "offline-asr",
        mt_model_name: str = "offline-mt",
        emit_corrections: bool = True,
    ) -> None:
        """依存とパラメータを注入する。

        入力:
            asr_fn: 最強 ASR 呼び出し（音声・言語 → 原文）。None なら再 ASR しない。
            mt_fn: 最強 MT 呼び出し（原文・原言語・訳言語 → 訳文）。None なら再訳しない。
            archive: 音声アーカイブ（audio_hash → バイト列）。None なら音声を取れない。
            target_languages: 再訳の対象言語群（原言語は自動除外）。
            asr_model_name / mt_model_name: RerunResult に記録するモデル名。
            emit_corrections: diff から HOLDOUT 訂正を導出するか。
        注意点: asr_fn と mt_fn が両方 None だと再処理する術がない（呼び出し側の判断）。
        """
        self._asr_fn = asr_fn
        self._mt_fn = mt_fn
        self._archive = archive
        self._target_languages = target_languages
        self._asr_model_name = asr_model_name
        self._mt_model_name = mt_model_name
        self._emit_corrections = emit_corrections

    async def rerun_session(self, session_id: str) -> RerunSummary:
        """セッションの再処理対象事件を順に再処理し集計を返す。

        入力: session_id — 対象セッション。
        出力: RerunSummary（total/done/skipped/failed）。
        注意点: 対象は list_rerunnable_events の既定（PENDING/FAILED）に従う。
        """
        events = await list_rerunnable_events(session_id)
        summary = RerunSummary(total=len(events))
        for event in events:
            await self._process_event(event, summary)
        logger.info(
            "[RERUN] session=%s total=%d done=%d skipped=%d failed=%d",
            session_id,
            summary.total,
            summary.done,
            summary.skipped,
            summary.failed,
        )
        return summary

    async def rerun_event(self, event: PipelineEvent) -> str | None:
        """1 事件を再処理し RerunResult.id を返す（SKIPPED/FAILED 時は None）。

        入力: event — 再処理対象の PipelineEvent。
        出力: 保存した RerunResult.id。対象外・失敗時は None。
        注意点: 集計不要の単発呼び出し用。内部で使い捨ての summary を用いる。
        """
        return await self._process_event(event, RerunSummary())

    async def _process_event(
        self, event: PipelineEvent, summary: RerunSummary
    ) -> str | None:
        """rerun_event の本体。summary を加算し RerunResult.id を返す。

        入力: event と加算対象の summary。
        出力: RerunResult.id（DONE 時）または None（SKIPPED/FAILED 時）。
        注意点: 予期せぬ例外は握って FAILED とし、ライブ運用を壊さない。
        """
        try:
            asr_text2 = await self._resolve_asr_text(event)
            # 音声結果も実時原文も無ければ再処理不能 → SKIPPED
            if not asr_text2:
                await mark_rerun_status(event.id, RerunStatus.SKIPPED.value)
                summary.skipped += 1
                return None

            translations2 = await self._retranslate(asr_text2, event.source_language)
            rid = await save_rerun_result(
                pipeline_event_id=event.id,
                source_language=event.source_language,
                asr_text=asr_text2,
                transcript_segment_id=event.transcript_segment_id,
                translations=translations2 or None,
                asr_model=self._asr_model_name,
                mt_model=self._mt_model_name,
            )
            # 保存失敗（None）を DONE 扱いにすると結果が失われ再処理もされない。
            # FAILED として再処理対象に残す（review 指摘 2: サイレント欠損の防止）。
            if rid is None:
                logger.warning(
                    "[RERUN] 事件 %s の結果保存に失敗（FAILED として再処理保留）", event.id
                )
                await mark_rerun_status(event.id, RerunStatus.FAILED.value)
                summary.failed += 1
                return None

            if self._emit_corrections:
                await self._emit_corrections_safe(event, asr_text2, translations2)

            await mark_rerun_status(event.id, RerunStatus.DONE.value)
            summary.done += 1
            return rid
        except Exception as e:  # noqa: BLE001 - 個別事件の失敗はライブを壊さない
            logger.warning("[RERUN] 事件 %s の再処理に失敗: %s", event.id, e)
            await mark_rerun_status(event.id, RerunStatus.FAILED.value)
            summary.failed += 1
            return None

    async def _resolve_asr_text(self, event: PipelineEvent) -> str:
        """高品質 ASR 原文を解決する（音声があれば再 ASR、無ければ実時原文）。

        入力: event — audio_hash / asr_text を持つ事件。
        出力: 再 ASR 原文。音声/アーカイブ/asr_fn が欠けるか ASR が "" なら実時原文。
        注意点: 「失败=空字符串」契約に従い ASR が "" を返したらフォールバックする。
        """
        if event.audio_hash and self._archive and self._asr_fn:
            wav = await self._archive.load(event.audio_hash)
            if wav:
                asr_text2 = await self._asr_fn(wav, event.source_language)
                if asr_text2:
                    return asr_text2
        # 音声なし / アーカイブなし / asr_fn なし / ASR 失敗 → 実時原文へ縮退
        return event.asr_text

    async def _retranslate(self, asr_text: str, source_language: str) -> dict[str, str]:
        """原文を全対象言語（原言語除く）へ再訳する。空訳文は採らない。

        入力: asr_text — 再訳元の原文、source_language — 原言語。
        出力: {target_language: translated} の辞書（mt_fn 未注入なら空）。
        注意点: mt_fn が "" を返した言語は結果に含めない（失败=空字符串契約）。
        """
        translations2: dict[str, str] = {}
        if not self._mt_fn:
            return translations2
        for tgt in self._target_languages:
            if tgt == source_language:
                continue
            translated = await self._mt_fn(asr_text, source_language, tgt)
            if translated:
                translations2[tgt] = translated
        return translations2

    async def _emit_corrections_safe(
        self,
        event: PipelineEvent,
        asr_text2: str,
        translations2: dict[str, str],
    ) -> None:
        """diff から HOLDOUT 訂正を導出する（失敗は握って重跑を壊さない）。

        入力: 事件・再 ASR 原文・再訳辞書。
        出力: なし（副作用として訓練訂正を記録）。
        注意点: 尊重原則により corrected_by=offline_rerun / split=HOLDOUT で記録する。
            実時出力が存在し、かつ再処理版と異なる場合のみ訂正を作る。
        """
        try:
            # ASR: 実時原文があり、再 ASR 版と異なるときのみ訂正
            if asr_text2 != event.asr_text and event.asr_text:
                await record_asr_correction(
                    source_language=event.source_language,
                    asr_text=event.asr_text,
                    corrected_text=asr_text2,
                    transcript_segment_id=event.transcript_segment_id,
                    audio_hash=event.audio_hash,
                    # corrected_by は users.id への FK。機械再処理に人手著者は無いため
                    # None（HOLDOUT 分割が「人手 review 前の候補」を表す。review 指摘 1:
                    # 文字列を入れると FK 違反で全訂正がサイレント欠損する）。
                    corrected_by=None,
                    split=DataSplit.HOLDOUT.value,
                )
            # MT: 実時訳文があり、再訳版と異なる言語のみ訂正
            realtime_translations = event.translations or {}
            for tgt, corrected in translations2.items():
                realtime = realtime_translations.get(tgt)
                if realtime and realtime != corrected:
                    await record_translation_correction(
                        source_language=event.source_language,
                        target_language=tgt,
                        source_text=asr_text2,
                        mt_text=realtime,
                        corrected_text=corrected,
                        corrected_by=None,  # FK to users.id: 機械再処理は None（指摘 1）
                        split=DataSplit.HOLDOUT.value,
                    )
        except Exception as e:  # noqa: BLE001 - 訓練書き込み失敗は重跑を壊さない
            logger.warning("[RERUN] 事件 %s の訂正導出に失敗: %s", event.id, e)


def build_default_reranker() -> OfflineReranker | None:
    """実ステージを配線した既定 reranker を構築する（両段とも不可なら None）。

    入力: なし（プロバイダ可用性と settings を参照）。
    出力: 少なくとも一方の段が使える OfflineReranker、両段とも不可なら None。
    注意点: faster_whisper 未導入なら asr_fn は配線しない（MT のみ）。同様に
        ctranslate2 / model_dir 未設定なら mt_fn を配線しない（再 ASR のみ）。
    """
    from app.ai_pipeline.providers import local_asr, local_mt
    from app.audio.archive import build_audio_archive

    asr_fn: ASRFn | None = None
    mt_fn: MTFn | None = None
    if local_asr.available():
        asr_fn = local_asr.FasterWhisperASRStage().transcribe_audio
    if local_mt.available():
        mt_fn = local_mt.LocalMTStage().translate_text

    if asr_fn is None and mt_fn is None:
        logger.warning("[RERUN] ASR/MT ともに不可のため reranker を構築できない")
        return None

    return OfflineReranker(
        asr_fn=asr_fn,
        mt_fn=mt_fn,
        archive=build_audio_archive(),
    )
