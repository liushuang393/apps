"""
発話セグメント収束処理（Phase 3 C1）：1 発話 → 言語検出 → 2 主線 → 永続化。

LiveKit Agent の rtc 配線から切り離した「1 発話セグメントの収束」を担う
transport 非依存の単一責務クラス。SpeechSegmenter が切り出した 16kHz モノ生 PCM
を受け取り、WAV 化 → 言語検出 → 採番/重複排除 → HybridOrchestrator 駆動 →
DB 永続化までを束ねる。rtc に依存しないため単体テスト可能（依存は注入可能）。

設計原則:
    - README §0「収束は Output Manager と DB のみ」。配信は sink 経由のみ。
    - 言語検出・orchestrator・sequencer は注入可能（既定は本番実体を遅延束縛）。
    - Sink は受聴者の user_language に依存するため、構築は sink_factory に委譲する。
"""

import logging
from collections.abc import Awaitable, Callable

from app.ai_pipeline.ab_runtime import ABContext, reset_ab_context, set_ab_context
from app.ai_pipeline.diarization import Enrollment, SpeakerIdentifier
from app.ai_pipeline.orchestrator import (
    HybridOrchestrator,
    OrchestrationResult,
    OutputSink,
)
from app.ai_pipeline.qos import HybridQoSMonitor
from app.audio.archive import AudioArchive, compute_audio_hash
from app.audio.pcm import wrap_wav16
from app.audio.speaker_embedding import SpeakerEmbedder
from app.rooms.manager import ParticipantPreference
from app.translate import subtitle_cache
from app.webrtc.listeners import build_listeners
from app.webrtc.persistence import (
    MeetingConfig,
    SubtitleSequencer,
    generate_subtitle_id,
    get_or_create_session,
    save_transcript_segment,
)

logger = logging.getLogger(__name__)

# AI 主線の入力サンプルレート（16kHz モノ。segmenter 出力に一致）。
_INPUT_SAMPLE_RATE = 16000
# 言語検出失敗を表す値（この場合は話者ヒント言語へフォールバック）。
_UNKNOWN_LANG = "multi"
_ERROR_PREFIXES = (
    "[ASRエラー",
    "[ASR error",
    "[Transcription error",
    "[Speech error",
)

# 注入可能な言語検出関数（wav, hint）→（認識テキスト, 検出言語）。
DetectFn = Callable[[bytes, str], Awaitable[tuple[str, str]]]
# user_language（user_id→目標言語）と話者 ID から OutputSink を構築するファクトリ。
SinkFactory = Callable[[dict[str, str], str], OutputSink]
# 中間パイプライン事件（回放ログ）の記録関数（既定 app.db.replay.record_pipeline_event）。
# 注入されない（None）場合は回放ログを記録しない（従来挙動・単体テスト非破壊）。
RecordEventFn = Callable[..., Awaitable[str | None]]
# consent 済み登録話者の (user_id, speaker_label, embedding) を返す供給関数（P4-A）。
EnrollmentLoader = Callable[[], Awaitable[list[tuple[str, str, list[float]]]]]


def _degraded_langs_present(
    *, source_language: str, tags: list[dict], translations: dict[str, str]
) -> bool:
    """翻訳が必要な対象言語のうち訳文が得られなかったものがあるか（縮退判定）。

    tags の target_language（source と異なる）で translations に非空エントリが無い
    ものがあれば全主線失敗の縮退（M4 原文プレースホルダ配信）とみなす。純ロジック。
    """
    for t in tags:
        lang = t.get("target_language")
        if not lang or lang == source_language:
            continue
        if not translations.get(lang):
            return True
    return False


class SegmentProcessor:
    """1 発話セグメントの収束（検出→2 主線→永続化）を担う transport 非依存クラス。"""

    def __init__(
        self,
        *,
        orchestrator: HybridOrchestrator | None = None,
        sequencer: SubtitleSequencer | None = None,
        detect_fn: DetectFn | None = None,
        input_sample_rate: int = _INPUT_SAMPLE_RATE,
        audio_archive: AudioArchive | None = None,
        record_event_fn: RecordEventFn | None = None,
        speaker_embedder: SpeakerEmbedder | None = None,
        speaker_identifier: SpeakerIdentifier | None = None,
        enrollment_loader: EnrollmentLoader | None = None,
    ) -> None:
        self._orchestrator = orchestrator or HybridOrchestrator(
            monitor=HybridQoSMonitor()
        )
        self._sequencer = sequencer or SubtitleSequencer()
        self._detect_fn = detect_fn
        self._input_sample_rate = input_sample_rate
        # 離線重跑（P3-D）: 音声アーカイブと回放ログ記録は注入時のみ有効。
        self._audio_archive = audio_archive
        self._record_event_fn = record_event_fn
        # 話者分離（P4-A）: embedder + identifier + enrollment 供給が揃う時のみ有効。
        self._speaker_embedder = speaker_embedder
        self._speaker_identifier = speaker_identifier
        self._enrollment_loader = enrollment_loader
        # consent 済み登録話者のキャッシュ（会議設定データ。初回照会でロード）。
        self._enrollments: list[Enrollment] | None = None

    def forget_room(self, room_id: str) -> None:
        """room 終了時に採番・重複排除・話者クラスタの状態を破棄する（状態リーク防止）。"""
        self._sequencer.forget_room(room_id)
        if self._speaker_identifier is not None:
            self._speaker_identifier.forget_room(room_id)

    async def _resolve_speaker_label(self, room_id: str, wav: bytes) -> str | None:
        """話者分離（P4-A）で発話の表示ラベルを解決する（未有効・失敗時 None）。

        embedder + identifier が揃い embedder が利用可能な時のみ embedding を抽出し、
        consent 済み登録話者と照合、未登録は会議内クラスタリングでラベル付けする。
        speaker_id（track 権威）は不変で、本ラベルは増強情報。失敗はライブを壊さない。
        """
        if self._speaker_embedder is None or self._speaker_identifier is None:
            return None
        try:
            if not self._speaker_embedder.available():
                return None
            embedding = await self._speaker_embedder.embed(wav)
            if embedding is None:
                return None
            enrollments = await self._get_enrollments()
            identity = self._speaker_identifier.identify(
                room_id, embedding, enrollments
            )
            return identity.label
        except Exception as e:  # noqa: BLE001 - 話者分離の失敗はライブを壊さない
            logger.warning("[Agent] 話者分離に失敗(room=%s): %s", room_id, e)
            return None

    async def _get_enrollments(self) -> list[Enrollment]:
        """consent 済み登録話者を取得しキャッシュする（会議設定データ）。

        注意点: 会議設定データのため初回のみロードしプロセス寿命でキャッシュする。
            会議進行中の consent 変更は次回会議まで反映されない（許容トレードオフ）。
        """
        if self._enrollments is not None:
            return self._enrollments
        if self._enrollment_loader is None:
            self._enrollments = []
            return self._enrollments
        rows = await self._enrollment_loader()
        self._enrollments = [
            Enrollment(user_id=uid, speaker_label=label, embedding=emb)
            for uid, label, emb in rows
        ]
        return self._enrollments

    async def process_partial(
        self,
        *,
        room_id: str,
        speaker_id: str,
        pcm16: bytes,
        speaker_lang_hint: str,
        participants: dict[str, ParticipantPreference],
        sink_factory: SinkFactory,
        revision: int,
    ) -> None:
        """発話確定前の暫定字幕（ASR 原文 interim）を配信する（§P2 首字遅延短縮）。

        ASR のみ実行し翻訳・TTS・永続化・重複排除・採番は行わない（低遅延・低コスト・
        非破壊）。前端は speaker_id 単位の interim 行を revision で上書きし、final 到着で
        消去する。認識空・エラー文字列は配信しない。
        """
        if not pcm16:
            return
        wav = wrap_wav16(pcm16, self._input_sample_rate)
        original_text, detected_lang = await self._detect(wav, speaker_lang_hint)
        if not detected_lang or detected_lang == _UNKNOWN_LANG:
            detected_lang = speaker_lang_hint
        if not original_text or self._is_provider_error_text(original_text):
            return
        listeners, user_language = build_listeners(participants, speaker_id)
        sink = sink_factory(user_language, speaker_id)
        await self._orchestrator.deliver_partial_subtitle(
            sink=sink,
            listeners=listeners,
            subtitle_id="",
            seq=0,
            revision=revision,
            speaker_id=speaker_id,
            partial_text=original_text,
            source_language=detected_lang,
            # §3 事件協議: room/speaker/revision を trace_id に載せ回放・可観測に供する。
            trace_id=f"{room_id}:{speaker_id}:{revision}",
        )

    @staticmethod
    def _is_provider_error_text(text: str) -> bool:
        """ASR 失敗を示す疑似テキストを通常字幕として流さない。"""
        normalized = text.strip()
        if not normalized:
            return False
        if normalized.startswith(_ERROR_PREFIXES):
            return True
        return (
            normalized.startswith("[")
            and normalized.endswith("]")
            and "エラー" in normalized
        )

    async def _detect(self, wav: bytes, hint: str) -> tuple[str, str]:
        """言語検出（既定は ai_pipeline.detect_language を遅延束縛）。"""
        if self._detect_fn is not None:
            return await self._detect_fn(wav, hint)
        from app.ai_pipeline.pipeline import ai_pipeline

        return await ai_pipeline.detect_language(wav, hint_language=hint)

    async def process(
        self,
        *,
        room_id: str,
        speaker_id: str,
        pcm16: bytes,
        speaker_lang_hint: str,
        participants: dict[str, ParticipantPreference],
        sink_factory: SinkFactory,
        config: MeetingConfig,
    ) -> OrchestrationResult | None:
        """1 発話セグメントを収束させる（配信は sink、記録は DB へ）。

        Returns:
            収束結果（無音・認識空・連続重複時は None で早期離脱）。
        """
        if not pcm16:
            return None
        wav = wrap_wav16(pcm16, self._input_sample_rate)

        original_text, detected_lang = await self._detect(wav, speaker_lang_hint)
        if not detected_lang or detected_lang == _UNKNOWN_LANG:
            detected_lang = speaker_lang_hint
        if not original_text:
            logger.debug(
                "[Agent] 認識結果なし(room=%s, speaker=%s)", room_id, speaker_id
            )
            return None
        if self._is_provider_error_text(original_text):
            logger.warning(
                "[Agent] 認識エラー文字列を字幕化せず破棄: room=%s speaker=%s text=%s",
                room_id,
                speaker_id,
                original_text,
            )
            return None

        # 連続同一テキストは字幕を発行しない（採番もしない）。
        if self._sequencer.is_duplicate(room_id, speaker_id, original_text):
            logger.debug("[Agent] 重複字幕をスキップ: '%s'", original_text[:30])
            return None
        self._sequencer.remember(room_id, speaker_id, original_text)
        seq = self._sequencer.next_seq(room_id)

        listeners, user_language = build_listeners(participants, speaker_id)
        sink = sink_factory(user_language, speaker_id)
        subtitle_id = generate_subtitle_id()
        await subtitle_cache.store_original(subtitle_id, original_text, detected_lang)

        # 話者分離（P4-A）: 発話の表示ラベルを orchestrate 前に解決する。ライブ字幕
        # payload へ載せて話者帰属を即時表示するため（未有効時は即 None・非破壊）。
        speaker_label = await self._resolve_speaker_label(room_id, wav)

        # セッション id を安全取得（失敗は None）。A/B の unit=session 解決と回放ログの
        # 双方で使い回すことで DB 呼び出しは 1 回に保つ（純増ゼロ）。回放ログ無効時は
        # 追加コストを避けるため解決しない（この場合 unit=session は既定へ縮退。room/user
        # は影響なし）。
        session_id = (
            await self._safe_session_id(room_id)
            if self._record_event_fn is not None
            else None
        )

        # A/B 実験の配信単位（room/user/session）を発話文脈へ設定する。聞く主線の
        # process_audio がこれを継承し unit=room/user/session を解決可能にする（未有効時は無害）。
        ab_token = set_ab_context(
            ABContext(room_id=room_id, user_id=speaker_id, session_id=session_id)
        )
        try:
            result = await self._orchestrator.orchestrate(
                audio_bytes=wav,
                source_language=detected_lang,
                original_text=original_text,
                listeners=listeners,
                sink=sink,
                mode=config.mode,
                enable_openai_s2s=config.enable_openai_s2s,
                language_routes=config.language_routes,
                subtitle_id=subtitle_id,
                seq=seq,
                speaker_id=speaker_id,
                speaker_label=speaker_label,
            )
        finally:
            reset_ab_context(ab_token)

        seg_id = await save_transcript_segment(
            room_id=room_id,
            speaker_id=speaker_id,
            source_language=detected_lang,
            text=original_text,
            translations=result.translations,
            tags=result.tags,
            speaker_label=speaker_label,
        )

        # 離線重跑（P3-D）: 音声アーカイブ＋回放ログを記録（注入時のみ・非破壊）。
        await self._record_pipeline_event(
            room_id=room_id,
            speaker_id=speaker_id,
            source_language=detected_lang,
            original_text=original_text,
            wav=wav,
            seq=seq,
            seg_id=seg_id,
            result=result,
            speaker_label=speaker_label,
            session_id=session_id,
        )
        return result

    async def _safe_session_id(self, room_id: str) -> str | None:
        """セッション id を安全に解決する（失敗時 None・ライブを壊さない）。"""
        try:
            return await get_or_create_session(room_id)
        except Exception as e:  # noqa: BLE001 - セッション解決失敗はライブを壊さない
            logger.warning("[Agent] セッション解決に失敗(room=%s): %s", room_id, e)
            return None

    async def _record_pipeline_event(
        self,
        *,
        room_id: str,
        speaker_id: str,
        source_language: str,
        original_text: str,
        wav: bytes,
        seq: int,
        seg_id: str | None,
        result: OrchestrationResult,
        speaker_label: str | None = None,
        session_id: str | None = None,
    ) -> None:
        """回放ログ（PipelineEvent）を記録する。音声アーカイブ有効時は暗号化保存。

        record_event_fn 未注入なら何もしない（従来挙動）。session_id は process() が
        解決済みの値を受け取る（DB 呼び出しの二重化回避）。全体を try/except で囲い、
        未防御依存が例外を投げても process を壊さない（review 指摘 3: ライブ配信は既に
        完了済みで、回放ログ記録の失敗で収束の戻り値を飛ばしてはならない）。
        """
        if self._record_event_fn is None:
            return
        try:
            audio_hash: str | None = None
            if self._audio_archive is not None:
                h = compute_audio_hash(wav)
                if await self._audio_archive.store(h, wav):
                    audio_hash = h
            degraded = _degraded_langs_present(
                source_language=source_language,
                tags=result.tags,
                translations=result.translations,
            )
            await self._record_event_fn(
                source_language=source_language,
                asr_text=original_text,
                room_id=room_id,
                session_id=session_id,
                transcript_segment_id=seg_id,
                speaker_id=speaker_id,
                speaker_label=speaker_label,
                seq=seq,
                audio_hash=audio_hash,
                translations=result.translations,
                tags=result.tags,
                degraded=degraded,
                trace_id=f"{room_id}:{speaker_id}:{seq}",
            )
        except Exception as e:  # noqa: BLE001 - 回放ログ記録の失敗はライブを壊さない
            logger.warning(
                "[Agent] 回放ログ記録に失敗(room=%s, speaker=%s): %s",
                room_id,
                speaker_id,
                e,
            )
