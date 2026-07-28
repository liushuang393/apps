"""チケット06: orchestrator と Output Manager の本番配線を検証する。"""

from __future__ import annotations

import ast
import asyncio
import inspect
import textwrap
from dataclasses import dataclass, field

import pytest

from app.ai_pipeline.orchestrator import (
    HearingOutput,
    HybridOrchestrator,
    Listener,
)
from app.ai_pipeline.output_manager import (
    DefaultOutputManager,
    DeliveryReport,
    FinalSubtitleCommand,
    InterruptedEventCommand,
    OutputCommand,
    PartialSubtitleCommand,
    QosWarningCommand,
    QualityEventCommand,
    RecordingTransportAdapter,
    TranslatedAudioCommand,
)
from app.ai_pipeline.qos import HybridQoSMonitor, READING_P95_TARGET_MS
from app.ai_pipeline.qoe import (
    QoEDecision,
    QoEReason,
    QoEScope,
    QoEState,
    QoEUiReason,
)
from app.ai_pipeline.revision_authority import RevisionAuthority
from app.webrtc.agent import LiveKitAgent
from app.webrtc.processor import SegmentProcessor


@dataclass
class _RecordingOutputManager:
    """主線から渡された型付き出力命令を順番どおり記録する。"""

    commands: list[OutputCommand] = field(default_factory=list)

    async def handle(self, command: OutputCommand) -> DeliveryReport:
        """命令を記録し、成功報告を返す。"""
        self.commands.append(command)
        return DeliveryReport()


class _RejectingSink:
    """Output Manager を迂回した主線配信を検出する Sink。"""

    async def deliver_audio(
        self,
        _user_id: str,
        _audio: bytes,
        *,
        generation_id: int | None = None,
    ) -> None:
        del generation_id
        raise AssertionError("音声が Output Manager を迂回しました")

    async def deliver_subtitle(self, _user_id: str, _message: dict) -> None:
        raise AssertionError("字幕が Output Manager を迂回しました")

    async def deliver_event(self, _user_id: str, _message: dict) -> None:
        raise AssertionError("イベントが Output Manager を迂回しました")


@pytest.mark.asyncio
async def test_mainline_delivery_uses_output_manager_and_keeps_reading_first() -> None:
    """確定字幕と翻訳音声を型付き命令で渡し、読む主線を先に収束する。"""

    async def hearing(
        _audio: bytes,
        _source: str,
        _target: str,
        _speaker: str,
        _original_text: str | None,
    ) -> HearingOutput:
        await asyncio.sleep(0.01)
        return HearingOutput(
            audio_data=b"AUDIO",
            translated_text="hearing",
            generation_id=7,
        )

    async def reading(_text: str, _source: str, _target: str) -> str:
        return "reading"

    manager = _RecordingOutputManager()
    orchestrator = HybridOrchestrator(hearing_fn=hearing, reading_fn=reading)

    await orchestrator.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=_RejectingSink(),
        output_manager=manager,
        mode="hybrid",
        room_id="room-1",
        subtitle_id="utt-1",
        seq=1,
        speaker_id="spk",
    )

    assert [type(command) for command in manager.commands] == [
        FinalSubtitleCommand,
        TranslatedAudioCommand,
    ]
    subtitle = manager.commands[0]
    assert isinstance(subtitle, FinalSubtitleCommand)
    assert subtitle.translated_text == "reading"
    audio = manager.commands[1]
    assert isinstance(audio, TranslatedAudioCommand)
    assert audio.generation_id == 7


def test_segment_processor_explicitly_wires_output_manager() -> None:
    """本番セグメント処理は Sink 直結でなく Output Manager を注入する。"""
    tree = ast.parse(textwrap.dedent(inspect.getsource(SegmentProcessor.process)))
    orchestrate_calls = [
        node
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr == "orchestrate"
    ]

    assert len(orchestrate_calls) == 1
    assert any(
        keyword.arg == "output_manager" for keyword in orchestrate_calls[0].keywords
    )


@pytest.mark.asyncio
async def test_mode_a_interim_is_replaced_by_final_through_output_manager() -> None:
    """Mode A の暫定字幕は同じ発話の確定字幕へ OM 内で収束する。"""

    async def hearing(
        _audio: bytes,
        _source: str,
        _target: str,
        _speaker: str,
        _original_text: str | None,
    ) -> HearingOutput:
        return HearingOutput(
            audio_data=b"AUDIO",
            translated_text="Hello",
            generation_id=1,
        )

    async def reading(_text: str, _source: str, _target: str) -> str:
        return ""

    authority = RevisionAuthority()
    adapter = RecordingTransportAdapter()
    manager = DefaultOutputManager(
        adapter=adapter,
        revision_authority=authority,
    )
    orchestrator = HybridOrchestrator(
        hearing_fn=hearing,
        reading_fn=reading,
        revision_authority=authority,
    )

    await orchestrator.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=_RejectingSink(),
        output_manager=manager,
        mode="a",
        room_id="room-1",
        subtitle_id="utt-1",
        seq=1,
        speaker_id="spk",
    )

    subtitle_events = [payload for _, _, payload in adapter.data]
    assert [event["type"] for event in subtitle_events] == [
        "subtitle_interim",
        "subtitle",
    ]
    assert subtitle_events[0]["revision"] == 1
    assert subtitle_events[1]["is_final"] is True


@pytest.mark.asyncio
async def test_partial_asr_delivery_uses_output_manager_only() -> None:
    """partial ASR は Sink を直送せず、言語別の型付き命令へ収束する。"""
    manager = _RecordingOutputManager()
    orchestrator = HybridOrchestrator()
    listeners = [
        Listener("u1", "en", wants_audio=False, subtitle_enabled=True),
        Listener("u2", "zh", wants_audio=False, subtitle_enabled=True),
    ]

    await orchestrator.deliver_partial_subtitle(
        sink=_RejectingSink(),
        output_manager=manager,
        listeners=listeners,
        room_id="room-1",
        subtitle_id="utt-1",
        seq=3,
        revision=2,
        generation_id=4,
        speaker_id="spk",
        partial_text="hello wor",
        source_language="en",
    )

    assert [type(command) for command in manager.commands] == [
        PartialSubtitleCommand,
        PartialSubtitleCommand,
    ]
    assert {
        command.target_language
        for command in manager.commands
        if isinstance(command, PartialSubtitleCommand)
    } == {"en", "zh"}


@pytest.mark.asyncio
async def test_qoe_event_delivery_uses_output_manager_only() -> None:
    """QoE decision は Sink を直送せず、そのまま型付き命令へ渡す。"""

    async def reading(_text: str, _source: str, _target: str) -> str:
        return "reading"

    decision = QoEDecision(
        state=QoEState.HEARING_DEGRADED,
        primary_reason=QoEReason.AI_HEARING_DEGRADED,
        auxiliary_reasons=(),
        hearing_available=False,
        reading_available=True,
        partial_available=True,
        changed=True,
        scope=QoEScope.SERVER,
        ui_reason=QoEUiReason.DEGRADED,
    )
    manager = _RecordingOutputManager()
    orchestrator = HybridOrchestrator(reading_fn=reading)

    await orchestrator.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=_RejectingSink(),
        output_manager=manager,
        qoe_decision=decision,
        mode="hybrid",
        room_id="room-1",
        subtitle_id="utt-1",
        seq=1,
        speaker_id="spk",
    )

    quality = [
        command
        for command in manager.commands
        if isinstance(command, QualityEventCommand)
    ]
    assert len(quality) == 1
    assert quality[0].decision is decision


@pytest.mark.asyncio
async def test_interrupted_event_delivery_uses_output_manager_only() -> None:
    """hearing 割込みは Sink を直送せず、型付き命令へ渡す。"""

    async def cancelled_hearing(
        _audio: bytes,
        _source: str,
        _target: str,
        _speaker: str,
        _original_text: str | None,
    ) -> HearingOutput:
        raise asyncio.CancelledError

    async def reading(_text: str, _source: str, _target: str) -> str:
        return "reading"

    manager = _RecordingOutputManager()
    orchestrator = HybridOrchestrator(
        hearing_fn=cancelled_hearing,
        reading_fn=reading,
    )

    await orchestrator.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=True, subtitle_enabled=True)],
        sink=_RejectingSink(),
        output_manager=manager,
        mode="a",
        room_id="room-1",
        subtitle_id="utt-1",
        seq=1,
        speaker_id="spk",
        generation_id=8,
    )

    interrupted = [
        command
        for command in manager.commands
        if isinstance(command, InterruptedEventCommand)
    ]
    assert len(interrupted) == 1
    assert interrupted[0].generation_id == 8


@pytest.mark.asyncio
async def test_qos_warning_delivery_uses_output_manager_only() -> None:
    """§9 qos_warning は Sink を直送せず、評価済み型付き命令へ渡す。"""

    async def hearing(
        _audio: bytes,
        _source: str,
        _target: str,
        _speaker: str,
        _original_text: str | None,
    ) -> HearingOutput:
        return HearingOutput(audio_data=b"AUDIO", translated_text="hearing")

    async def reading(_text: str, _source: str, _target: str) -> str:
        return "reading"

    monitor = HybridQoSMonitor()
    monitor.record_latency("reading", READING_P95_TARGET_MS + 1000.0)
    monitor.record_glossary(1, 10)
    manager = _RecordingOutputManager()
    orchestrator = HybridOrchestrator(
        hearing_fn=hearing,
        reading_fn=reading,
        monitor=monitor,
    )

    result = await orchestrator.orchestrate(
        audio_bytes=b"pcm",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", wants_audio=False, subtitle_enabled=True)],
        sink=_RejectingSink(),
        output_manager=manager,
        mode="b",
        room_id="room-1",
        subtitle_id="utt-1",
        seq=1,
        speaker_id="spk",
        generation_id=3,
    )

    warnings = [
        command
        for command in manager.commands
        if isinstance(command, QosWarningCommand)
    ]
    assert {command.metric for command in warnings} == {
        "latency_p95",
        "glossary_hit_rate",
    }
    assert all(command.generation_id == 3 for command in warnings)
    assert {warning["metric"] for warning in result.qos_warnings} == {
        "latency_p95",
        "glossary_hit_rate",
    }


def test_mainline_delivery_has_no_direct_sink_helper_calls() -> None:
    """partial・QoE・割込み・qos_warning の Sink 直送を静的に再導入できないよう検出する。"""
    partial_source = inspect.getsource(HybridOrchestrator.deliver_partial_subtitle)
    orchestrate_source = inspect.getsource(HybridOrchestrator.orchestrate)
    emit_qos_source = inspect.getsource(HybridOrchestrator._emit_qos_warnings)

    assert "_deliver_subtitle_group(" not in partial_source
    assert "_deliver_event_group(" not in orchestrate_source
    assert "_deliver_event_group(" not in emit_qos_source
    assert "deliver_event(" not in emit_qos_source
    assert "QosWarningCommand" in emit_qos_source


def test_agent_passes_authoritative_qoe_decision_without_flattening() -> None:
    """Agent は QoE decision 本体を Processor へ渡し、下流で再構築させない。"""
    source = inspect.getsource(LiveKitAgent._handle_segment)
    partial_source = inspect.getsource(LiveKitAgent._handle_partial)

    assert "qoe_decision=qoe" in source
    assert "revision_authority=self._revision_authority" in partial_source
