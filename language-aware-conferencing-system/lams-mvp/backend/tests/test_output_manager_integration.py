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
    OutputCommand,
    RecordingTransportAdapter,
    TranslatedAudioCommand,
)
from app.ai_pipeline.revision_authority import RevisionAuthority
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
