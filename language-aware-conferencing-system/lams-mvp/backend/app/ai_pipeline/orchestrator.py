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

from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from app.ai_pipeline.events import envelope_event
from app.ai_pipeline.mode_router import ModeRouter, RouteContext, mode_router
from app.ai_pipeline.output_manager import (
    DefaultOutputManager,
    FinalSubtitleCommand,
    InterimSubtitleCommand,
    ListenerRef,
    OutputManager,
    TranslatedAudioCommand,
)
from app.ai_pipeline.output_manager.sink_adapter import OutputSinkTransportAdapter
from app.ai_pipeline.qos import HybridQoSMonitor
from app.ai_pipeline.revision_authority import (
    RevisionAuthority,
    RevisionStreamKey,
    RevisionUnknownError,
    StreamKind,
    get_revision_authority,
)
from app.ai_pipeline.runtime.port import RealtimeRuntimePort
from app.ai_pipeline.runtime.types import SessionContext, TurnInput

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

    async def deliver_audio(
        self, user_id: str, audio: bytes, *, generation_id: int | None = None
    ) -> None: ...

    async def deliver_subtitle(self, user_id: str, message: dict) -> None: ...


@runtime_checkable
class EventOutputSink(Protocol):
    """任意イベントの配信に対応する Sink。"""

    async def deliver_event(self, user_id: str, message: dict) -> None: ...


@runtime_checkable
class InterimOutputSink(Protocol):
    """暫定字幕の配信に対応する Sink。"""

    async def deliver_interim(self, user_id: str, message: dict) -> None: ...


class RuntimeRegistryPort(Protocol):
    """Orchestrator が利用する Runtime レジストリの最小公開契約。"""

    def get_or_create(self, context: SessionContext) -> RealtimeRuntimePort: ...

    def interrupt_speaker(
        self, room_id: str, speaker_id: str, generation_id: int | None = None
    ) -> None: ...

    async def release_speaker(self, room_id: str, speaker_id: str) -> None: ...

    async def release_room(self, room_id: str) -> None: ...


@dataclass
class OrchestrationResult:
    """収束結果（DB 永続化と QoS/ログ用のタグ集合）。"""

    translations: dict[str, str] = field(default_factory=dict)
    tags: list[dict] = field(default_factory=list)
    qos_warnings: list[dict] = field(default_factory=list)


@dataclass(frozen=True)
class HearingOutput:
    """聞く主線から収束処理へ渡す最小結果。"""

    audio_data: bytes | None
    translated_text: str
    generation_id: int = 0


# 注入可能な主線実体のシグネチャ（第5引数 = 検出済み原文。欠陥 #1）
HearingFn = Callable[[bytes, str, str, str, str | None], Awaitable[HearingOutput]]
ReadingFn = Callable[[str, str, str], Awaitable[str]]


class HybridOrchestrator:
    """音声複製→2 主線同時投入→Output Manager 収束を担う単一責務クラス。"""

    def __init__(
        self,
        router: ModeRouter = mode_router,
        hearing_fn: HearingFn | None = None,
        reading_fn: ReadingFn | None = None,
        monitor: HybridQoSMonitor | None = None,
        runtime_registry: RuntimeRegistryPort | None = None,
        revision_authority: RevisionAuthority | None = None,
    ) -> None:
        self._router = router
        self._hearing_fn = hearing_fn
        self._reading_fn = reading_fn
        # QoS モニタ（§9）。注入時のみ計測・警告を行う（None なら無効＝純動作）。
        self._monitor = monitor
        # RealtimeRuntimePort レジストリ（未注入時はモジュール既定を遅延束縛）
        self._runtime_registry = runtime_registry
        # 暫定字幕 revision の単一権威（未注入時はプロセス共有）
        self._revision_authority = revision_authority or get_revision_authority()
        # Runtime 再接続中の話者（次発話の QoE input 向け観測）
        self._provider_recovering: set[str] = set()

    def is_provider_recovering(self, speaker_id: str) -> bool:
        """Runtime 再接続など Provider 回復中かを観測事実として返す。"""
        return speaker_id in self._provider_recovering

    def interrupt_speaker(
        self,
        room_id: str,
        speaker_id: str,
        generation_id: int | None = None,
    ) -> None:
        """新発話開始時に話者の全 Runtime へ割込みを通知する。"""
        if self._hearing_fn is not None:
            return
        self._get_runtime_registry().interrupt_speaker(
            room_id, speaker_id, generation_id
        )

    def _get_runtime_registry(self) -> RuntimeRegistryPort:
        """注入レジストリまたはプロセス既定を返す。"""
        if self._runtime_registry is not None:
            return self._runtime_registry
        from app.ai_pipeline.runtime.factory import runtime_registry

        return runtime_registry

    async def release_speaker(self, room_id: str, speaker_id: str) -> None:
        """退室した話者の持続 Runtime と revision state を解放する。"""
        self._revision_authority.release_speaker(room_id, speaker_id)
        await self._get_runtime_registry().release_speaker(room_id, speaker_id)

    async def release_room(self, room_id: str) -> None:
        """終了した会議室の持続 Runtime と revision state を解放する。"""
        self._revision_authority.release_room(room_id)
        await self._get_runtime_registry().release_room(room_id)

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
        self,
        sink: OutputSink,
        listeners: list[Listener],
        result: OrchestrationResult,
        *,
        room_id: str,
        speaker_id: str,
        utterance_id: str,
        generation_id: int,
        sequence_id: int,
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
        enveloped_warnings = [
            envelope_event(
                warning,
                room_id=room_id,
                speaker_id=speaker_id,
                utterance_id=utterance_id,
                generation_id=generation_id,
                sequence_id=sequence_id,
            )
            for warning in warnings
        ]
        result.qos_warnings.extend(enveloped_warnings)
        for warning in enveloped_warnings:
            await self._deliver_event_group(sink, listeners, warning)

    async def _hearing(
        self,
        audio: bytes,
        src: str,
        tgt: str,
        speaker: str,
        original_text: str | None,
        *,
        room_id: str = "",
        utterance_id: str = "",
        s2s_provider: str | None = None,
    ) -> HearingOutput:
        """聞く主線（S2S/カスケード）。既定は RealtimeRuntimePort 経由。"""
        if self._hearing_fn is not None:
            output = await self._hearing_fn(audio, src, tgt, speaker, original_text)
            if not isinstance(output, HearingOutput):
                raise TypeError("hearing_fn は HearingOutput を返す必要がある")
            return output
        return await self._hearing_via_runtime(
            audio,
            src,
            tgt,
            speaker,
            original_text,
            room_id=room_id,
            utterance_id=utterance_id,
            s2s_provider=s2s_provider,
        )

    async def _hearing_via_runtime(
        self,
        audio: bytes,
        src: str,
        tgt: str,
        speaker: str,
        original_text: str | None,
        *,
        room_id: str,
        utterance_id: str,
        s2s_provider: str | None,
    ) -> HearingOutput:
        """
        RealtimeRuntimePort／registry 公開面だけで聞く主線を駆動する。

        mode・具象 class・tracker は registry／Runtime 側が所有する。
        """
        from app.config import settings

        registry = self._get_runtime_registry()
        provider = s2s_provider or settings.ai_provider
        ctx = SessionContext(
            room_id=room_id or "default",
            speaker_id=speaker or "unknown",
            source_language=src,
            target_language=tgt,
            provider=provider,
        )
        runtime = registry.get_or_create(ctx)
        await runtime.open_session(ctx)
        turn = await runtime.run_turn(
            TurnInput(
                utterance_id=utterance_id or "utt",
                audio=audio,
                original_text=original_text,
            )
        )
        gen = turn.generation_id
        audio_data: bytes | None = None
        text = ""
        saw_provider_degraded = False
        for event in turn.events:
            if event.type == "runtime_degraded":
                saw_provider_degraded = True
            if not runtime.should_capture(event.generation_id):
                continue
            if event.type == "audio" and event.audio_data:
                audio_data = event.audio_data
            if event.type in ("transcript_delta", "turn_done") and event.text:
                text = event.text or text
        # 次発話の QoE 向けに Provider 回復中フラグを更新（本文は含めない）
        if saw_provider_degraded:
            self._provider_recovering.add(speaker or "unknown")
        else:
            self._provider_recovering.discard(speaker or "unknown")
        return HearingOutput(
            audio_data=audio_data, translated_text=text, generation_id=gen
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
        speaker_label: str | None = None,
        room_id: str = "",
        utterance_id: str = "",
        generation_id: int = 0,
    ) -> dict:
        """字幕 data channel ペイロード（typed 事件）を組み立てる（純ロジック）。

        改善案 §3 事件協議: revision / is_partial / trace_id / model_id を持たせ、
        partial 更新・可観測・A/B・回放の基盤とする（既存フィールドは後方互換で保持）。
        degraded=True は全主線失敗時の縮退（原文プレースホルダ）を表す。この場合は
        訳文が無いため is_translated=False とし、原文のみを届ける（M4）。
        is_partial=True は確定前の暫定字幕（同一 seq を revision で上書き更新する）。
        """
        return envelope_event(
            {
                "type": "subtitle",
                "id": subtitle_id,
                "seq": seq,
                "speaker_id": speaker_id,
                # 話者分離ラベルは track 権威の speaker_id を補う増強情報。
                "speaker_label": speaker_label,
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
            },
            room_id=room_id,
            speaker_id=speaker_id,
            utterance_id=utterance_id or subtitle_id,
            generation_id=generation_id,
            sequence_id=seq,
            revision=revision,
        )

    def _interim_message(
        self,
        *,
        subtitle_id: str,
        target_language: str,
        seq: int,
        room_id: str,
        speaker_id: str,
        text: str,
        generation_id: int,
    ) -> dict:
        """聞く主線の文字差分を暫定字幕契約へ変換する。

        revision は RevisionAuthority から取得し、ローカル採番しない。
        """
        utterance_id = self._revision_authority.begin(
            room_id,
            speaker_id,
            utterance_id=subtitle_id or None,
        )
        token = self._revision_authority.advance(
            room_id,
            speaker_id,
            utterance_id,
            RevisionStreamKey(
                kind=StreamKind.HEARING_TRANSCRIPT,
                language=target_language,
            ),
        )
        return envelope_event(
            {
                "type": "subtitle_interim",
                "id": utterance_id,
                "seq": seq,
                "speaker_id": speaker_id,
                "text": text,
                "is_final": False,
            },
            room_id=room_id,
            speaker_id=speaker_id,
            utterance_id=utterance_id,
            generation_id=generation_id,
            sequence_id=seq,
            revision=token.revision,
        )

    def _finish_interim(
        self,
        *,
        room_id: str,
        speaker_id: str,
        subtitle_id: str,
        target_language: str,
    ) -> None:
        """確定字幕到着後に対象 hearing stream を finalize する。"""
        if not subtitle_id:
            return
        try:
            self._revision_authority.finalize(
                room_id,
                speaker_id,
                subtitle_id,
                RevisionStreamKey(
                    kind=StreamKind.HEARING_TRANSCRIPT,
                    language=target_language,
                ),
            )
        except RevisionUnknownError:
            # interim 未発行なら何もしない
            return

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

    async def _deliver_interim_group(
        self, sink: OutputSink, members: list[Listener], message: dict
    ) -> None:
        """暫定字幕対応 Sink に限って revision 付き更新を配信する。"""
        if not isinstance(sink, InterimOutputSink):
            return
        deliveries = [
            sink.deliver_interim(ls.user_id, message)
            for ls in members
            if ls.subtitle_enabled
        ]
        if deliveries:
            await asyncio.gather(*deliveries, return_exceptions=True)

    @staticmethod
    async def _deliver_event_group(
        sink: OutputSink, members: list[Listener], message: dict
    ) -> None:
        """イベント対応 Sink の受信者へ同じイベントを配信する。"""
        if not isinstance(sink, EventOutputSink):
            return
        await asyncio.gather(
            *(sink.deliver_event(member.user_id, message) for member in members),
            return_exceptions=True,
        )

    async def _deliver_audio_group(
        self,
        sink: OutputSink,
        members: list[Listener],
        audio_data: bytes | None,
        speaker_id: str,
        *,
        generation_id: int | None = None,
    ) -> None:
        """翻訳音声を購読者へ配信する（聞く主線の収束。話者自身は除外）。"""
        if not audio_data:
            return
        deliveries = [
            sink.deliver_audio(ls.user_id, audio_data, generation_id=generation_id)
            for ls in members
            if ls.wants_audio and ls.user_id != speaker_id
        ]
        if deliveries:
            await asyncio.gather(*deliveries, return_exceptions=True)

    @staticmethod
    def _qoe_event_type(qoe_state: str) -> str:
        """QoE 状態をクライアント向けイベント種別へ変換する。"""
        if qoe_state == "healthy":
            return "qoe_recovered"
        if qoe_state == "queue_overload":
            return "overload_degraded"
        return "qoe_degraded"

    @staticmethod
    def _listener_refs(members: list[Listener]) -> tuple[ListenerRef, ...]:
        """主線受信者を Output Manager のポリシー入力へ変換する。"""
        return tuple(
            ListenerRef(
                user_id=member.user_id,
                target_language=member.target_language,
                wants_audio=member.wants_audio,
                subtitle_enabled=member.subtitle_enabled,
            )
            for member in members
        )

    async def _send_final_subtitle(
        self,
        *,
        output_manager: OutputManager,
        members: list[Listener],
        room_id: str,
        speaker_id: str,
        speaker_label: str | None,
        subtitle_id: str,
        seq: int,
        original_text: str,
        source_language: str,
        target_language: str,
        translated_text: str,
        mainline: str,
        generation_id: int,
        provider: str | None,
        degraded: bool = False,
    ) -> None:
        """確定字幕候補を型付き命令として Output Manager へ引き渡す。"""
        await output_manager.handle(
            FinalSubtitleCommand(
                room_id=room_id,
                speaker_id=speaker_id,
                subtitle_id=subtitle_id,
                seq=seq,
                original_text=original_text,
                source_language=source_language,
                target_language=target_language,
                translated_text=translated_text,
                mainline=mainline,
                listeners=self._listener_refs(members),
                generation_id=generation_id,
                provider=provider,
                degraded=degraded,
                speaker_label=speaker_label,
            )
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
        speaker_label: str | None = None,
        hearing_available: bool = True,
        qoe_state: str = "healthy",
        qoe_changed: bool = False,
        qoe_reason: str | None = None,
        qoe_ui_reason: str | None = None,
        room_id: str = "",
        generation_id: int | None = None,
        output_manager: OutputManager | None = None,
    ) -> OrchestrationResult:
        """目標言語ごとに 2 主線を駆動し、収束候補を Output Manager へ渡す。

        speaker_label は話者分離（P4-A）の表示ラベル。ライブ字幕へ付与して話者帰属を
        即時表示する（未有効時 None）。
        聞く主線の可否は QoE decision のフラグのみを消費し、monitor で再判定しない。
        """
        result = OrchestrationResult()
        manager = output_manager or DefaultOutputManager(
            adapter=OutputSinkTransportAdapter(sink),
            revision_authority=self._revision_authority,
        )

        # 目標言語でグルーピング（同一ペアの主線は 1 回だけ駆動して収束）
        groups: dict[str, list[Listener]] = {}
        for ls in listeners:
            groups.setdefault(ls.target_language, []).append(ls)

        # QoE decision の可否フラグのみを消費（monitor は測定・warning 専用）
        s2s_available = hearing_available

        if not hearing_available or (qoe_changed and qoe_state == "healthy"):
            recovered = qoe_state == "healthy"
            payload: dict = {
                "type": self._qoe_event_type(qoe_state),
                "metric": qoe_state,
                "mainline": "hearing",
                # 旧クライアント向け fallback フラグは維持（加算的に理由コードを付与）
                "should_fallback_to_subtitle": not recovered,
            }
            if qoe_reason:
                payload["reason_code"] = qoe_reason
            if qoe_ui_reason:
                payload["ui_reason"] = qoe_ui_reason
            warning = envelope_event(
                payload,
                room_id=room_id,
                speaker_id=speaker_id,
                utterance_id=subtitle_id,
                generation_id=generation_id or 0,
                sequence_id=seq,
            )
            if not recovered:
                result.qos_warnings.append(warning)
            await self._deliver_event_group(sink, listeners, warning)

        # barge-in: 世代発行は Runtime Port 側。呼出側は generation_id を任意で渡せる。
        active_generation = generation_id

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
            hearing_generation = active_generation

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
                            room_id=room_id,
                            utterance_id=subtitle_id,
                            s2s_provider=decision.s2s_provider,
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
                    await self._send_final_subtitle(
                        output_manager=manager,
                        members=members,
                        room_id=room_id,
                        speaker_id=speaker_id,
                        speaker_label=speaker_label,
                        subtitle_id=subtitle_id,
                        seq=seq,
                        original_text=original_text,
                        source_language=source_language,
                        target_language=target_lang,
                        translated_text=reading_text,
                        mainline="reading",
                        generation_id=hearing_generation or 0,
                        provider=None,
                    )
                    subtitle_sent = True
                    self._finish_interim(
                        room_id=room_id,
                        speaker_id=speaker_id,
                        subtitle_id=subtitle_id,
                        target_language=target_lang,
                    )

            # --- 聞く主線の収束（翻訳音声） ---
            if "hearing" in tasks:
                try:
                    out = await tasks["hearing"]
                    audio_data = out.audio_data
                    hearing_text = out.translated_text
                    if out.generation_id > 0:
                        hearing_generation = out.generation_id
                    if hearing_text and not subtitle_sent:
                        interim = self._interim_message(
                            subtitle_id=subtitle_id,
                            target_language=target_lang,
                            seq=seq,
                            room_id=room_id,
                            speaker_id=speaker_id,
                            text=hearing_text,
                            generation_id=hearing_generation or 0,
                        )
                        await manager.handle(
                            InterimSubtitleCommand(
                                room_id=room_id,
                                speaker_id=speaker_id,
                                subtitle_id=str(
                                    interim.get("utterance_id") or subtitle_id
                                ),
                                seq=seq,
                                target_language=target_lang,
                                text=hearing_text,
                                listeners=self._listener_refs(members),
                                generation_id=hearing_generation or 0,
                                revision=int(interim["revision"]),
                                stream_kind=StreamKind.HEARING_TRANSCRIPT.value,
                            )
                        )
                except asyncio.CancelledError:
                    # barge-in 等で hearing のみキャンセル。reading は維持。
                    logger.info(
                        "[Hybrid] hearing キャンセル(barge-in): lang=%s", target_lang
                    )
                    interrupted = envelope_event(
                        {
                            "type": "translation_interrupted",
                            "mainline": "hearing",
                        },
                        room_id=room_id,
                        speaker_id=speaker_id,
                        utterance_id=subtitle_id,
                        generation_id=hearing_generation or 0,
                        sequence_id=seq,
                    )
                    await self._deliver_event_group(sink, members, interrupted)
                except Exception as e:  # noqa: BLE001
                    logger.warning(
                        "[Hybrid] hearing 主線エラー(%s): %s", target_lang, e
                    )
                if audio_data:
                    await manager.handle(
                        TranslatedAudioCommand(
                            speaker_id=speaker_id,
                            source_language=source_language,
                            target_language=target_lang,
                            audio=audio_data,
                            listeners=self._listener_refs(members),
                            generation_id=hearing_generation or 0,
                        )
                    )

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
                await self._send_final_subtitle(
                    output_manager=manager,
                    members=members,
                    room_id=room_id,
                    speaker_id=speaker_id,
                    speaker_label=speaker_label,
                    subtitle_id=subtitle_id,
                    seq=seq,
                    original_text=original_text,
                    source_language=source_language,
                    target_language=target_lang,
                    translated_text=subtitle_text,
                    mainline=mainline,
                    generation_id=hearing_generation or 0,
                    provider=(decision.s2s_provider if mainline == "hearing" else None),
                )
                self._finish_interim(
                    room_id=room_id,
                    speaker_id=speaker_id,
                    subtitle_id=subtitle_id,
                    target_language=target_lang,
                )
            elif not subtitle_sent and decision.needs_translation and original_text:
                # 全主線失敗時も発話の存在を原文プレースホルダで通知する。
                logger.warning(
                    "[Hybrid] 全主線失敗のため原文プレースホルダを配信(%s): '%s'",
                    target_lang,
                    original_text[:30],
                )
                await self._send_final_subtitle(
                    output_manager=manager,
                    members=members,
                    room_id=room_id,
                    speaker_id=speaker_id,
                    speaker_label=speaker_label,
                    subtitle_id=subtitle_id,
                    seq=seq,
                    original_text=original_text,
                    source_language=source_language,
                    target_language=target_lang,
                    translated_text=original_text,
                    mainline="degraded",
                    generation_id=hearing_generation or 0,
                    provider=None,
                    degraded=True,
                )
                self._finish_interim(
                    room_id=room_id,
                    speaker_id=speaker_id,
                    subtitle_id=subtitle_id,
                    target_language=target_lang,
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
                    "generation_id": hearing_generation,
                }
            )

        await asyncio.gather(*(run_group(t, m) for t, m in groups.items()))
        # §9: 全主線駆動後に QoS 目標逸脱を評価し qos_warning を反映（注入時のみ）。
        await self._emit_qos_warnings(
            sink,
            listeners,
            result,
            room_id=room_id,
            speaker_id=speaker_id,
            utterance_id=subtitle_id,
            generation_id=active_generation or 0,
            sequence_id=seq,
        )
        return result


# モジュール唯一の既定インスタンス（純ロジック＋注入で共有して安全）
hybrid_orchestrator = HybridOrchestrator()
