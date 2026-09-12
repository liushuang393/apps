"""
RealtimeRuntimePort 共通 contract suite。

短命・持続の両 factory を同一シナリオで検証する。
内部 WebSocket / private buffer ではなく Port 公開面（open / run_turn / interrupt / close）のみを観測する。
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest

from app.ai_pipeline.qoe import QoEInput, QoEStateMachine
from app.ai_pipeline.runtime.native_persistent import NativePersistentRuntime
from app.ai_pipeline.runtime.per_utterance import PerUtteranceRuntime
from app.ai_pipeline.runtime.port import RealtimeRuntimePort
from app.ai_pipeline.runtime.types import (
    RuntimeEvent,
    RuntimeEventType,
    RuntimeTranslationOutput,
    SessionContext,
    TurnInput,
    TurnResult,
    is_terminal_event,
)


def _translation(
    *, audio_data: bytes | None, translated_text: str
) -> RuntimeTranslationOutput:
    """短命 Runtime と production が共有する翻訳結果を作る。"""
    return RuntimeTranslationOutput(
        translated_text=translated_text,
        audio_data=audio_data,
    )


class _FakeWs:
    """持続経路用の最小 WebSocket フェイク。"""

    def __init__(self) -> None:
        self.closed = False

    async def send(self, _data: str) -> None:
        return None

    async def recv(self) -> str:
        return '{"type":"session.updated"}'

    async def close(self) -> None:
        self.closed = True


async def _ok_turn(
    _ws: Any,
    _audio: bytes,
    _ctx: SessionContext,
    generation_id: int,
    utterance_id: str,
) -> list[RuntimeEvent]:
    """成功ターンのイベント列。"""
    return [
        RuntimeEvent(
            type=RuntimeEventType.TRANSCRIPT_DELTA.value,
            generation_id=generation_id,
            utterance_id=utterance_id,
            text="hello",
        ),
        RuntimeEvent(
            type=RuntimeEventType.AUDIO.value,
            generation_id=generation_id,
            utterance_id=utterance_id,
            audio_data=b"WAV",
            text="hello",
        ),
        RuntimeEvent(
            type=RuntimeEventType.TURN_DONE.value,
            generation_id=generation_id,
            utterance_id=utterance_id,
            text="hello",
        ),
    ]


async def _fail_turn(
    _ws: Any,
    _audio: bytes,
    _ctx: SessionContext,
    _generation_id: int,
    _utterance_id: str,
) -> list[RuntimeEvent]:
    raise ConnectionError("provider down")


@pytest.fixture
def session_ctx() -> SessionContext:
    return SessionContext(
        room_id="room-1",
        speaker_id="spk-a",
        source_language="ja",
        target_language="en",
        provider="gpt_realtime",
    )


def _per_utterance_ok() -> PerUtteranceRuntime:
    async def translate(
        _audio: bytes, _src: str, _tgt: str, _original: str | None = None
    ) -> RuntimeTranslationOutput:
        return _translation(audio_data=b"WAV", translated_text="hello")

    return PerUtteranceRuntime(translate_fn=translate)


def _per_utterance_fail() -> PerUtteranceRuntime:
    async def translate(
        _audio: bytes, _src: str, _tgt: str, _original: str | None = None
    ) -> RuntimeTranslationOutput:
        raise RuntimeError("translate failed")

    return PerUtteranceRuntime(translate_fn=translate)


def _native_ok() -> NativePersistentRuntime:
    async def connect() -> _FakeWs:
        return _FakeWs()

    return NativePersistentRuntime(
        connect_fn=connect,
        turn_fn=_ok_turn,
        reconnect_max=2,
    )


def _native_fail_reconnect() -> NativePersistentRuntime:
    async def connect() -> _FakeWs:
        return _FakeWs()

    async def fallback_translate(
        _audio: bytes, _src: str, _tgt: str, _original: str | None = None
    ) -> RuntimeTranslationOutput:
        return _translation(audio_data=b"FB", translated_text="fallback")

    return NativePersistentRuntime(
        connect_fn=connect,
        turn_fn=_fail_turn,
        reconnect_max=1,
        fallback_runtime=PerUtteranceRuntime(translate_fn=fallback_translate),
    )


@pytest.fixture(
    params=[
        pytest.param(_per_utterance_ok, id="per_utterance"),
        pytest.param(_native_ok, id="native_persistent"),
    ]
)
def runtime_factory(
    request: pytest.FixtureRequest,
) -> Callable[[], RealtimeRuntimePort]:
    return request.param


@pytest.mark.asyncio
async def test_open_session_is_idempotent(
    runtime_factory: Callable[[], RealtimeRuntimePort],
    session_ctx: SessionContext,
) -> None:
    """同一 context での open_session 再呼出は失敗せず、続く turn が実行できる。"""
    runtime = runtime_factory()
    await runtime.open_session(session_ctx)
    await runtime.open_session(session_ctx)
    result = await runtime.run_turn(
        TurnInput(utterance_id="utt-1", audio=b"pcm", original_text="原文")
    )
    await runtime.close_session()
    assert result.generation_id >= 1
    assert any(is_terminal_event(e) for e in result.events)


@pytest.mark.asyncio
async def test_run_turn_completes_with_terminal_event(
    runtime_factory: Callable[[], RealtimeRuntimePort],
    session_ctx: SessionContext,
) -> None:
    """一 turn は必ず終端イベント（turn_done / turn_failed）で閉じる。"""
    runtime = runtime_factory()
    await runtime.open_session(session_ctx)
    result = await runtime.run_turn(
        TurnInput(utterance_id="utt-1", audio=b"pcm", original_text="原文")
    )
    await runtime.close_session()

    assert isinstance(result, TurnResult)
    assert result.generation_id >= 1
    terminals = [e for e in result.events if is_terminal_event(e)]
    assert len(terminals) == 1
    assert terminals[0].utterance_id == "utt-1"
    assert terminals[0].generation_id == result.generation_id
    assert all(e.generation_id == result.generation_id for e in result.events)


@pytest.mark.asyncio
async def test_interrupt_suppresses_stale_audio_after_new_turn(
    runtime_factory: Callable[[], RealtimeRuntimePort],
    session_ctx: SessionContext,
) -> None:
    """interrupt 後、旧 generation は非アクティブになり capture 禁止になる。"""
    runtime = runtime_factory()
    await runtime.open_session(session_ctx)
    first = await runtime.run_turn(TurnInput(utterance_id="utt-1", audio=b"a"))
    runtime.interrupt(first.generation_id)
    assert runtime.is_generation_active(first.generation_id) is False
    assert runtime.should_capture(first.generation_id) is False

    second = await runtime.run_turn(TurnInput(utterance_id="utt-2", audio=b"b"))
    assert second.generation_id > first.generation_id
    assert runtime.is_generation_active(second.generation_id) is True
    assert runtime.should_capture(first.generation_id) is False
    await runtime.close_session()


@pytest.mark.asyncio
async def test_close_session_is_idempotent(
    runtime_factory: Callable[[], RealtimeRuntimePort],
    session_ctx: SessionContext,
) -> None:
    """close_session は冪等で、再呼出しても例外を投げない。"""
    runtime = runtime_factory()
    await runtime.open_session(session_ctx)
    await runtime.run_turn(TurnInput(utterance_id="utt-1", audio=b"pcm"))
    await runtime.close_session()
    await runtime.close_session()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "factory",
    [
        pytest.param(_per_utterance_fail, id="per_utterance"),
        pytest.param(_native_fail_reconnect, id="native_persistent"),
    ],
)
async def test_typed_failure_or_degraded_is_terminal(
    factory: Callable[[], RealtimeRuntimePort],
    session_ctx: SessionContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """
    失敗は型付きイベントで通知される。

    短命: turn_failed。持続: reconnect 上限後に runtime_degraded を含み、終端を持つ。
    """
    import asyncio

    async def _no_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_sleep)

    runtime = factory()
    await runtime.open_session(session_ctx)
    result = await runtime.run_turn(TurnInput(utterance_id="utt-1", audio=b"x"))
    await runtime.close_session()

    assert any(is_terminal_event(e) for e in result.events)
    types = {e.type for e in result.events}
    assert (
        RuntimeEventType.TURN_FAILED.value in types
        or RuntimeEventType.RUNTIME_DEGRADED.value in types
        or RuntimeEventType.TURN_DONE.value in types
    )
    for event in result.events:
        if event.type == RuntimeEventType.TURN_FAILED.value:
            assert "reason_code" in event.payload
            # 秘密情報を契約イベントへ載せない
            blob = str(event.payload)
            assert "Bearer" not in blob
            assert "api_key" not in blob.lower()


@pytest.mark.asyncio
async def test_native_reconnect_limit_emits_runtime_degraded(
    session_ctx: SessionContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """持続実装は再接続上限後に runtime_degraded を一貫して返す。"""
    import asyncio

    async def _no_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_sleep)

    runtime = _native_fail_reconnect()
    await runtime.open_session(session_ctx)
    result = await runtime.run_turn(TurnInput(utterance_id="utt-1", audio=b"x"))
    await runtime.close_session()

    degraded = [
        e for e in result.events if e.type == RuntimeEventType.RUNTIME_DEGRADED.value
    ]
    assert degraded, "上限後は runtime_degraded が必須"
    assert "reason" in degraded[0].payload or "reconnect_attempt" in degraded[0].payload
    assert any(is_terminal_event(e) for e in result.events)


def test_runtime_degraded_aligns_with_qoe_provider_recovering() -> None:
    """
    契約の runtime_degraded は QoE の provider_recovering と矛盾しない。

    hearing は止めても reading は継続可能（読む主線への安全な縮退）。
    """
    machine = QoEStateMachine()
    decision = machine.evaluate(QoEInput(provider_recovering=True))
    assert decision.hearing_available is False
    assert decision.reading_available is True
