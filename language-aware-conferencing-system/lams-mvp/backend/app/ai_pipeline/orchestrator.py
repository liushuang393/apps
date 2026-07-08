"""
Hybrid Orchestrator（README §0 / Phase 3 ハイブリッド 2 主線の同時オーケストレーション）

目的:
    1 つの発話音声を「フォーク（音声複製のみ）」し、2 つの独立主線へ同時投入する:
      - 聞く主線: S2S（OpenAI/Gemini Realtime）→ 翻訳音声 + transcript delta
      - 読む主線: ASR + MT（Google/GPT）→ 字幕 / 記録
    2 主線は混ぜず、収束は Output Manager（本クラス）と DB のみで行う。

設計原則:
    - transport / DB 非依存。配信は OutputSink プロトコル経由で外部委譲する。
    - 主線の駆動可否は ModeRouter（純ロジック）に委譲する。
    - 聞く/読むの実処理は注入可能（既定は ai_pipeline / translate_text_simple）。
      これにより I/O・ネットワーク非依存で単体テスト可能。
入力 / 出力:
    orchestrate(...) が各言語の主線を駆動し、OrchestrationResult を返す。
"""

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Protocol

from app.ai_pipeline.mode_router import ModeRouter, RouteContext, mode_router
from app.ai_pipeline.qos import HybridQoSMonitor

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Listener:
    """主線出力の受信者（参加者表現から疎結合化した最小情報）。"""

    user_id: str
    target_language: str  # 受聴者の目標言語（基底コード）
    wants_audio: bool  # 翻訳音声（聞く主線）を受信するか
    subtitle_enabled: bool  # 字幕（読む主線/delta）を受信するか


class OutputSink(Protocol):
    """Output Manager の配信境界（transport 実装を外部委譲する）。"""

    async def deliver_audio(self, user_id: str, audio: bytes) -> None: ...

    async def deliver_subtitle(self, user_id: str, message: dict) -> None: ...


@dataclass
class OrchestrationResult:
    """収束結果（DB 永続化と QoS/ログ用のタグ集合）。"""

    translations: dict[str, str] = field(default_factory=dict)
    tags: list[dict] = field(default_factory=list)
    qos_warnings: list[dict] = field(default_factory=list)


# 注入可能な主線実体のシグネチャ（第5引数 = 検出済み原文。欠陥 #1）
HearingFn = Callable[[bytes, str, str, str, str | None], Awaitable[object]]
ReadingFn = Callable[[str, str, str], Awaitable[str]]


class HybridOrchestrator:
    """音声複製→2 主線同時投入→Output Manager 収束を担う単一責務クラス。"""

    def __init__(
        self,
        router: ModeRouter = mode_router,
        hearing_fn: HearingFn | None = None,
        reading_fn: ReadingFn | None = None,
        monitor: HybridQoSMonitor | None = None,
    ) -> None:
        self._router = router
        self._hearing_fn = hearing_fn
        self._reading_fn = reading_fn
        # QoS モニタ（§9）。注入時のみ計測・警告を行う（None なら無効＝純動作）。
        self._monitor = monitor

    async def _run_timed(self, mainline: str, coro: Awaitable[object]) -> object:
        """主線コルーチンを実行し所要時間（ms）を monitor に記録する（注入時のみ）。"""
        if self._monitor is None:
            return await coro
        start = time.perf_counter()
        try:
            return await coro
        finally:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            self._monitor.record_latency(mainline, elapsed_ms)

    async def _emit_qos_warnings(
        self, sink: OutputSink, listeners: list[Listener], result: OrchestrationResult
    ) -> None:
        """§9 目標逸脱を評価し qos_warning を result と sink(任意) に反映する。"""
        if self._monitor is None:
            return
        warnings: list[dict] = []
        for name in ("hearing", "reading"):
            w = self._monitor.evaluate_latency(name)
            if w is not None:
                warnings.append(w)
        gw = self._monitor.evaluate_glossary()
        if gw is not None:
            warnings.append(gw)
        nw = self._monitor.evaluate_number_retention()
        if nw is not None:
            warnings.append(nw)
        if not warnings:
            return
        result.qos_warnings.extend(warnings)
        # OutputSink が deliver_event を持てば配信（Protocol 非必須の任意拡張）。
        deliver_event = getattr(sink, "deliver_event", None)
        if deliver_event is None:
            return
        events: list[Awaitable] = [
            deliver_event(ls.user_id, w) for ls in listeners for w in warnings
        ]
        if events:
            await asyncio.gather(*events, return_exceptions=True)

    async def _hearing(
        self, audio: bytes, src: str, tgt: str, speaker: str, original_text: str | None
    ) -> object:
        """聞く主線（S2S/カスケード）。既定は ai_pipeline.process_audio を遅延束縛。"""
        if self._hearing_fn is not None:
            return await self._hearing_fn(audio, src, tgt, speaker, original_text)
        from app.ai_pipeline.pipeline import ai_pipeline

        return await ai_pipeline.process_audio(
            audio, src, tgt, speaker, original_text=original_text
        )

    async def _reading(self, text: str, src: str, tgt: str) -> str:
        """読む主線の MT。既定は translate_text_simple を遅延束縛。"""
        if self._reading_fn is not None:
            return await self._reading_fn(text, src, tgt)
        from app.translate.routes import translate_text_simple

        return await translate_text_simple(text, src, tgt)

    def _subtitle_message(
        self,
        *,
        subtitle_id: str,
        seq: int,
        speaker_id: str,
        original_text: str,
        source_language: str,
        target_lang: str,
        subtitle_text: str,
        mainline: str,
        s2s_provider: str | None,
        degraded: bool = False,
        is_partial: bool = False,
        revision: int = 0,
        trace_id: str | None = None,
        model_id: str | None = None,
    ) -> dict:
        """字幕 data channel ペイロード（typed 事件）を組み立てる（純ロジック）。

        改善案 §3 事件協議: revision / is_partial / trace_id / model_id を持たせ、
        partial 更新・可観測・A/B・回放の基盤とする（既存フィールドは後方互換で保持）。
        degraded=True は全主線失敗時の縮退（原文プレースホルダ）を表す。この場合は
        訳文が無いため is_translated=False とし、原文のみを届ける（M4）。
        is_partial=True は確定前の暫定字幕（同一 seq を revision で上書き更新する）。
        """
        return {
            "type": "subtitle",
            "id": subtitle_id,
            "seq": seq,
            # sequence_id は seq の別名（§3 事件協議の正式名。前端は seq を継続利用可）。
            "sequence_id": seq,
            "revision": revision,
            "speaker_id": speaker_id,
            "original_text": original_text,
            "source_language": source_language,
            "translated_text": (
                subtitle_text
                if (
                    not degraded
                    and not is_partial
                    and target_lang != source_language
                    and subtitle_text
                )
                else None
            ),
            "target_language": target_lang,
            "is_translated": bool(
                not degraded and target_lang != source_language and subtitle_text
            ),
            "is_partial": is_partial,
            "is_final": not is_partial,
            "degraded": degraded,
            "mainline": mainline,
            "provider": s2s_provider if mainline == "hearing" else "asr_mt",
            "trace_id": trace_id,
            "model_id": model_id,
        }

    async def deliver_partial_subtitle(
        self,
        *,
        sink: OutputSink,
        listeners: list[Listener],
        subtitle_id: str,
        seq: int,
        revision: int,
        speaker_id: str,
        partial_text: str,
        source_language: str,
        trace_id: str | None = None,
        model_id: str | None = None,
    ) -> None:
        """確定前の暫定字幕（原文 interim）を全購読者へ配信する（§P2 首字遅延）。

        partial は ASR 原文のみ（翻訳しない＝低遅延・低コスト）。target_language は
        受聴者ごとの目標言語を設定するが translated_text=None・is_partial=True とし、
        前端は同一 seq を revision で上書きする。DB へは永続化しない（final のみ記録）。
        """
        if not partial_text:
            return
        groups: dict[str, list[Listener]] = {}
        for ls in listeners:
            groups.setdefault(ls.target_language, []).append(ls)
        for target_lang, members in groups.items():
            await self._deliver_subtitle_group(
                sink,
                members,
                self._subtitle_message(
                    subtitle_id=subtitle_id,
                    seq=seq,
                    speaker_id=speaker_id,
                    original_text=partial_text,
                    source_language=source_language,
                    target_lang=target_lang,
                    subtitle_text="",
                    mainline="partial",
                    s2s_provider=None,
                    is_partial=True,
                    revision=revision,
                    trace_id=trace_id,
                    model_id=model_id,
                ),
            )

    async def _deliver_subtitle_group(
        self, sink: OutputSink, members: list[Listener], message: dict
    ) -> None:
        """字幕を購読者へ配信する（読む主線の収束）。"""
        deliveries = [
            sink.deliver_subtitle(ls.user_id, message)
            for ls in members
            if ls.subtitle_enabled
        ]
        if deliveries:
            await asyncio.gather(*deliveries, return_exceptions=True)

    async def _deliver_audio_group(
        self,
        sink: OutputSink,
        members: list[Listener],
        audio_data: bytes | None,
        speaker_id: str,
    ) -> None:
        """翻訳音声を購読者へ配信する（聞く主線の収束。話者自身は除外）。"""
        if not audio_data:
            return
        deliveries = [
            sink.deliver_audio(ls.user_id, audio_data)
            for ls in members
            if ls.wants_audio and ls.user_id != speaker_id
        ]
        if deliveries:
            await asyncio.gather(*deliveries, return_exceptions=True)

    async def orchestrate(
        self,
        *,
        audio_bytes: bytes,
        source_language: str,
        original_text: str,
        listeners: list[Listener],
        sink: OutputSink,
        mode: str,
        enable_openai_s2s: bool = True,
        language_routes: dict | None = None,
        subtitle_id: str = "",
        seq: int = 0,
        speaker_id: str = "",
    ) -> OrchestrationResult:
        """目標言語ごとに 2 主線を駆動し、収束結果を返す（副作用は sink 経由のみ）。"""
        result = OrchestrationResult()

        # 目標言語でグルーピング（同一ペアの主線は 1 回だけ駆動して収束）
        groups: dict[str, list[Listener]] = {}
        for ls in listeners:
            groups.setdefault(ls.target_language, []).append(ls)

        # §9 実配線: hearing P95 超過中は聞く主線を止め、字幕へ縮退させる（欠陥 #9）
        s2s_available = True
        if self._monitor is not None:
            s2s_available = not self._monitor.hearing_degraded()

        async def run_group(target_lang: str, members: list[Listener]) -> None:
            ctx = RouteContext(
                mode=mode,
                source_language=source_language,
                target_language=target_lang,
                enable_openai_s2s=enable_openai_s2s,
                language_routes=language_routes or {},
                s2s_available=s2s_available,
            )
            decision = self._router.decide(ctx)

            audio_data: bytes | None = None
            hearing_text = ""
            reading_text = ""
            reason = decision.reason

            # --- フォーク: 2 主線を同時投入（音声は複製のみ。各主線は計測付き） ---
            tasks: dict[str, asyncio.Task] = {}
            if decision.run_hearing and decision.needs_translation:
                tasks["hearing"] = asyncio.ensure_future(
                    self._run_timed(
                        "hearing",
                        self._hearing(
                            audio_bytes,
                            source_language,
                            target_lang,
                            speaker_id,
                            original_text,
                        ),
                    )
                )
            if decision.needs_translation and decision.run_reading:
                tasks["reading"] = asyncio.ensure_future(
                    self._run_timed(
                        "reading",
                        self._reading(original_text, source_language, target_lang),
                    )
                )
            # --- 読む主線を先に収束（字幕は hearing を待たない。欠陥 #10） ---
            subtitle_sent = False
            if "reading" in tasks:
                try:
                    reading_text = (await tasks["reading"]) or ""
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "[Hybrid] reading 主線エラー(%s): %s", target_lang, e
                    )
                if reading_text:
                    await self._deliver_subtitle_group(
                        sink,
                        members,
                        self._subtitle_message(
                            subtitle_id=subtitle_id,
                            seq=seq,
                            speaker_id=speaker_id,
                            original_text=original_text,
                            source_language=source_language,
                            target_lang=target_lang,
                            subtitle_text=reading_text,
                            mainline="reading",
                            s2s_provider=decision.s2s_provider,
                        ),
                    )
                    subtitle_sent = True

            # --- 聞く主線の収束（翻訳音声） ---
            if "hearing" in tasks:
                try:
                    out = await tasks["hearing"]
                    audio_data = getattr(out, "audio_data", None)
                    hearing_text = getattr(out, "translated_text", "") or ""
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "[Hybrid] hearing 主線エラー(%s): %s", target_lang, e
                    )
                await self._deliver_audio_group(sink, members, audio_data, speaker_id)

            # --- ランタイム縮退（§10）: 聞く主線が失敗し読む主線が未駆動 ---
            hearing_failed = "hearing" in tasks and not audio_data and not hearing_text
            if (
                decision.needs_translation
                and hearing_failed
                and "reading" not in tasks
                and not reading_text
            ):
                try:
                    out = await self._run_timed(
                        "reading",
                        self._reading(original_text, source_language, target_lang),
                    )
                    reading_text = out or ""
                    reason = "hearing_failed_runtime_fallback_reading"
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "[Hybrid] 縮退 reading 主線エラー(%s): %s", target_lang, e
                    )

            if not decision.needs_translation:
                reading_text = original_text

            # --- 未送の字幕を収束（hearing delta 代替 / 縮退 / 同一言語） ---
            subtitle_text = reading_text or hearing_text
            if not subtitle_sent and subtitle_text:
                mainline = "reading" if reading_text else "hearing"
                await self._deliver_subtitle_group(
                    sink,
                    members,
                    self._subtitle_message(
                        subtitle_id=subtitle_id,
                        seq=seq,
                        speaker_id=speaker_id,
                        original_text=original_text,
                        source_language=source_language,
                        target_lang=target_lang,
                        subtitle_text=subtitle_text,
                        mainline=mainline,
                        s2s_provider=decision.s2s_provider,
                    ),
                )
            elif not subtitle_sent and decision.needs_translation and original_text:
                # 全主線失敗（hearing/reading/縮退すべて空）: 原文プレースホルダを
                # 配信し「発話があった事実」を受聴者に必ず届ける（改善点 M4）。
                # 原文は訳文でないため result.translations には入れない（DB/数字保持
                # 統計を汚染しない）。
                logger.warning(
                    "[Hybrid] 全主線失敗のため原文プレースホルダを配信(%s): '%s'",
                    target_lang,
                    original_text[:30],
                )
                await self._deliver_subtitle_group(
                    sink,
                    members,
                    self._subtitle_message(
                        subtitle_id=subtitle_id,
                        seq=seq,
                        speaker_id=speaker_id,
                        original_text=original_text,
                        source_language=source_language,
                        target_lang=target_lang,
                        subtitle_text=original_text,
                        mainline="degraded",
                        s2s_provider=decision.s2s_provider,
                        degraded=True,
                    ),
                )

            # --- 記録（DB 永続化用）と QoS/ログ用タグを集約 ---
            if subtitle_text:
                result.translations[target_lang] = subtitle_text
            result.tags.append(
                {
                    "target_language": target_lang,
                    "reason": reason,
                    "hearing_audio": bool(audio_data),
                    "subtitle_mainline": (
                        ("reading" if reading_text else "hearing")
                        if subtitle_text
                        else None
                    ),
                    "s2s_provider": decision.s2s_provider,
                }
            )

        await asyncio.gather(*(run_group(t, m) for t, m in groups.items()))
        # §9: 全主線駆動後に QoS 目標逸脱を評価し qos_warning を反映（注入時のみ）。
        await self._emit_qos_warnings(sink, listeners, result)
        return result


# モジュール唯一の既定インスタンス（純ロジック＋注入で共有して安全）
hybrid_orchestrator = HybridOrchestrator()
