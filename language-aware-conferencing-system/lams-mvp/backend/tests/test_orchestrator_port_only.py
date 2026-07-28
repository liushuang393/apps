"""
チケット08: orchestrator は Port／registry 公開面だけに依存する。

検証観点:
    - get_or_create に mode / generation_tracker を渡さない
    - GenerationTracker を begin / should_capture しない
    - settings.realtime_runtime を読まない
    - 音声抑止は runtime.should_capture のみ
"""

from __future__ import annotations

import ast
import inspect
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import pytest

from app.ai_pipeline.orchestrator import (
    HearingOutput,
    HybridOrchestrator,
    Listener,
    RuntimeRegistryPort,
)
from app.ai_pipeline.runtime.port import RealtimeRuntimePort
from app.ai_pipeline.runtime.types import (
    RuntimeEvent,
    RuntimeEventType,
    SessionContext,
    TurnInput,
    TurnResult,
)


@dataclass
class _RecordingRegistry:
    """呼び出し引数を記録する最小レジストリ。"""

    runtime: RealtimeRuntimePort
    calls: list[dict[str, Any]] = field(default_factory=list)
    interrupt_calls: list[tuple[str, str, int | None]] = field(default_factory=list)

    def get_or_create(self, context: SessionContext) -> RealtimeRuntimePort:
        """公開契約どおり context のみ受け取る。"""
        self.calls.append({"context": context})
        return self.runtime

    def interrupt_speaker(
        self, room_id: str, speaker_id: str, generation_id: int | None = None
    ) -> None:
        self.interrupt_calls.append((room_id, speaker_id, generation_id))

    async def release_speaker(self, _room_id: str, _speaker_id: str) -> None:
        return None

    async def release_room(self, _room_id: str) -> None:
        return None


@dataclass
class _FakeRuntime:
    """Port 公開メソッドだけを持つ最小 Runtime。"""

    events: tuple[RuntimeEvent, ...]
    generation_id: int = 1
    capture_ok: bool = True
    open_count: int = 0
    turn_inputs: list[TurnInput] = field(default_factory=list)

    async def open_session(self, context: SessionContext) -> None:
        del context
        self.open_count += 1

    async def run_turn(self, turn: TurnInput) -> TurnResult:
        self.turn_inputs.append(turn)
        return TurnResult(generation_id=self.generation_id, events=self.events)

    def interrupt(self, generation_id: int) -> None:
        del generation_id

    def is_generation_active(self, generation_id: int) -> bool:
        return self.capture_ok and generation_id == self.generation_id

    def should_capture(self, generation_id: int) -> bool:
        return self.capture_ok and generation_id == self.generation_id

    async def close_session(self) -> None:
        return None


class _Sink:
    """音声・字幕の配信先スタブ。"""

    def __init__(self) -> None:
        self.audio: list[tuple[str, bytes, int | None]] = []
        self.subtitles: list[dict] = []

    async def deliver_audio(
        self, user_id: str, audio: bytes, *, generation_id: int | None = None
    ) -> None:
        self.audio.append((user_id, audio, generation_id))

    async def deliver_subtitle(self, user_id: str, message: dict) -> None:
        del user_id
        self.subtitles.append(message)


def _ok_events(generation_id: int = 1) -> tuple[RuntimeEvent, ...]:
    return (
        RuntimeEvent(
            type=RuntimeEventType.AUDIO.value,
            generation_id=generation_id,
            utterance_id="utt-1",
            audio_data=b"PCM",
            text="hello",
        ),
        RuntimeEvent(
            type=RuntimeEventType.TURN_DONE.value,
            generation_id=generation_id,
            utterance_id="utt-1",
            text="hello",
        ),
    )


def test_orchestrator_source_has_no_tracker_or_mode_ops() -> None:
    """
    orchestrator ソースが GenerationTracker 操作・mode 参照を含まない。

    AST で import / 属性参照を静的検査し、実行時の逃げ道を防ぐ。
    """
    source_path = (
        Path(__file__).resolve().parents[1] / "app" / "ai_pipeline" / "orchestrator.py"
    )
    tree = ast.parse(source_path.read_text(encoding="utf-8"))
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            for alias in node.names:
                imported.add(alias.name)
        if isinstance(node, ast.Attribute) and isinstance(node.attr, str):
            assert node.attr != "realtime_runtime", (
                "settings.realtime_runtime 参照は禁止"
            )
            assert node.attr != "GenerationTracker", "GenerationTracker 参照は禁止"
    assert "GenerationTracker" not in imported
    assert "RuntimeMode" not in imported


def test_runtime_registry_port_get_or_create_signature() -> None:
    """RuntimeRegistryPort.get_or_create は context のみを必須引数とする。"""
    params = inspect.signature(RuntimeRegistryPort.get_or_create).parameters
    assert list(params) == ["self", "context"]


@pytest.mark.asyncio
async def test_hearing_calls_registry_without_mode_or_tracker() -> None:
    """聞く主線は registry.get_or_create(context) のみで Runtime を得る。"""
    runtime = _FakeRuntime(events=_ok_events())
    registry = _RecordingRegistry(runtime=runtime)
    orch = HybridOrchestrator(
        runtime_registry=registry,
        reading_fn=_empty_reading,
    )

    result = await orch.orchestrate(
        audio_bytes=b"wav",
        source_language="ja",
        original_text="こんにちは",
        listeners=[Listener("u1", "en", True, True)],
        sink=_Sink(),
        mode="hybrid",
        speaker_id="spk-a",
        room_id="room-1",
        subtitle_id="utt-1",
    )

    assert len(registry.calls) == 1
    call = registry.calls[0]
    assert set(call.keys()) == {"context"}
    ctx = call["context"]
    assert isinstance(ctx, SessionContext)
    assert ctx.room_id == "room-1"
    assert ctx.speaker_id == "spk-a"
    assert ctx.target_language == "en"
    assert runtime.open_count == 1
    assert len(runtime.turn_inputs) == 1
    assert runtime.turn_inputs[0].generation_id is None
    assert result.translations.get("en") == "hello"


@pytest.mark.asyncio
async def test_hearing_respects_runtime_should_capture_only() -> None:
    """旧世代は runtime.should_capture=False で音声が収束に載らない。"""
    runtime = _FakeRuntime(events=_ok_events(generation_id=1), capture_ok=False)
    registry = _RecordingRegistry(runtime=runtime)
    orch = HybridOrchestrator(
        runtime_registry=registry,
        reading_fn=_empty_reading,
    )
    sink = _Sink()

    await orch.orchestrate(
        audio_bytes=b"wav",
        source_language="ja",
        original_text="文",
        listeners=[Listener("u1", "en", True, True)],
        sink=sink,
        mode="hybrid",
        speaker_id="spk-a",
        room_id="room-1",
    )

    assert sink.audio == []


@pytest.mark.asyncio
async def test_interrupt_speaker_delegates_to_registry_without_tracker() -> None:
    """barge-in は registry.interrupt_speaker へ委譲し tracker を触らない。"""
    runtime = _FakeRuntime(events=_ok_events())
    registry = _RecordingRegistry(runtime=runtime)
    orch = HybridOrchestrator(runtime_registry=registry)

    orch.interrupt_speaker("room-1", "spk-a")
    orch.interrupt_speaker("room-1", "spk-a", 3)

    assert registry.interrupt_calls == [
        ("room-1", "spk-a", None),
        ("room-1", "spk-a", 3),
    ]


@pytest.mark.asyncio
async def test_orchestrate_accepts_no_generation_tracker_kwarg() -> None:
    """orchestrate は generation_tracker キーワードを受け付けない。"""
    orch = HybridOrchestrator(
        hearing_fn=lambda *_a, **_k: _async_hearing(),
        reading_fn=lambda *_a, **_k: _async_reading(),
    )
    with pytest.raises(TypeError):
        await orch.orchestrate(
            audio_bytes=b"x",
            source_language="ja",
            original_text="文",
            listeners=[Listener("u1", "en", True, True)],
            sink=_Sink(),
            mode="hybrid",
            generation_tracker=object(),  # type: ignore[arg-type]
        )


async def _async_hearing(*_a: object, **_k: object) -> HearingOutput:
    return HearingOutput(audio_data=b"A", translated_text="H")


async def _async_reading(*_a: object, **_k: object) -> str:
    return "R"


async def _empty_reading(*_a: object, **_k: object) -> str:
    return ""
