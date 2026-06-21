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


# 注入可能な主線実体のシグネチャ
HearingFn = Callable[[bytes, str, str, str], Awaitable[object]]
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

    async def _hearing(self, audio: bytes, src: str, tgt: str, speaker: str) -> object:
        """聞く主線（S2S）。既定は ai_pipeline.process_audio を遅延束縛。"""
        if self._hearing_fn is not None:
            return await self._hearing_fn(audio, src, tgt, speaker)
        from app.ai_pipeline.pipeline import ai_pipeline

        return await ai_pipeline.process_audio(audio, src, tgt, speaker)

    async def _reading(self, text: str, src: str, tgt: str) -> str:
        """読む主線の MT。既定は translate_text_simple を遅延束縛。"""
        if self._reading_fn is not None:
            return await self._reading_fn(text, src, tgt)
        from app.translate.routes import translate_text_simple

        return await translate_text_simple(text, src, tgt)

    async def _converge(
        self,
        *,
        target_lang: str,
        members: list[Listener],
        decision_reason: str,
        s2s_provider: str | None,
        audio_data: bytes | None,
        hearing_text: str,
        reading_text: str,
        sink: OutputSink,
        subtitle_id: str,
        seq: int,
        speaker_id: str,
        result: OrchestrationResult,
    ) -> None:
        """Output Manager 収束: 2 主線出力を混ぜずに配信し、記録を集約する。"""
        # 字幕は読む主線を権威とし、無ければ聞く主線 delta で代替（§9 縮退）。
        subtitle_text = reading_text or hearing_text
        subtitle_mainline = "reading" if reading_text else "hearing"
        is_translated = bool(reading_text or hearing_text)

        deliveries: list[Awaitable] = []
        for ls in members:
            # 聞く主線: 翻訳音声（話者自身には返さない＝エコー防止）。
            if audio_data and ls.wants_audio and ls.user_id != speaker_id:
                deliveries.append(sink.deliver_audio(ls.user_id, audio_data))
            # 読む主線: 字幕（有効者のみ）。主線 provider をタグ付けして配信。
            if subtitle_text and ls.subtitle_enabled:
                message = {
                    "type": "subtitle",
                    "id": subtitle_id,
                    "seq": seq,
                    "speaker_id": speaker_id,
                    "original_text": subtitle_text,
                    "source_language": target_lang,
                    "is_translated": is_translated,
                    "mainline": subtitle_mainline,
                    "provider": s2s_provider
                    if subtitle_mainline == "hearing"
                    else "asr_mt",
                }
                deliveries.append(sink.deliver_subtitle(ls.user_id, message))

        if deliveries:
            await asyncio.gather(*deliveries, return_exceptions=True)

        # 記録（DB 永続化用）と QoS/ログ用タグを集約。
        if subtitle_text:
            result.translations[target_lang] = subtitle_text
        result.tags.append(
            {
                "target_language": target_lang,
                "reason": decision_reason,
                "hearing_audio": bool(audio_data),
                "subtitle_mainline": subtitle_mainline if subtitle_text else None,
                "s2s_provider": s2s_provider,
            }
        )

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

        async def run_group(target_lang: str, members: list[Listener]) -> None:
            ctx = RouteContext(
                mode=mode,
                source_language=source_language,
                target_language=target_lang,
                enable_openai_s2s=enable_openai_s2s,
                language_routes=language_routes or {},
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
                            audio_bytes, source_language, target_lang, speaker_id
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
            for name, task in tasks.items():
                try:
                    out = await task
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "[Hybrid] %s 主線エラー(%s): %s", name, target_lang, e
                    )
                    continue
                if name == "hearing":
                    audio_data = getattr(out, "audio_data", None)
                    hearing_text = getattr(out, "translated_text", "") or ""
                else:
                    reading_text = out or ""

            # --- ランタイム縮退（§10）: 聞く主線が失敗（出力なし）し、読む主線が
            #     未駆動なら、字幕の可聴性確保のため読む主線へ縮退する ---
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

            await self._converge(
                target_lang=target_lang,
                members=members,
                decision_reason=reason,
                s2s_provider=decision.s2s_provider,
                audio_data=audio_data,
                hearing_text=hearing_text,
                reading_text=reading_text,
                sink=sink,
                subtitle_id=subtitle_id,
                seq=seq,
                speaker_id=speaker_id,
                result=result,
            )

        await asyncio.gather(*(run_group(t, m) for t, m in groups.items()))
        # §9: 全主線駆動後に QoS 目標逸脱を評価し qos_warning を反映（注入時のみ）。
        await self._emit_qos_warnings(sink, listeners, result)
        return result


# モジュール唯一の既定インスタンス（純ロジック＋注入で共有して安全）
hybrid_orchestrator = HybridOrchestrator()
