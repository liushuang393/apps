"""
RealtimeRuntimePort / GenerationTracker / 持続セッションの単体テスト。

I/O（実 WebSocket）は注入フェイクで置換し、観測可能な振る舞いのみを検証する。
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any

import pytest

from app.ai_pipeline.orchestrator import HearingOutput
from app.ai_pipeline.runtime.factory import RuntimeRegistry, create_realtime_runtime
from app.ai_pipeline.runtime.generation import GenerationTracker
from app.ai_pipeline.runtime.native_persistent import NativePersistentRuntime
from app.ai_pipeline.runtime.per_utterance import PerUtteranceRuntime
from app.ai_pipeline.runtime.types import (
    RuntimeEvent,
    RuntimeTranslationOutput,
    SessionContext,
    TurnInput,
    make_session_key,
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
    """持続ランタイム用の最小 WebSocket フェイク。"""

    def __init__(self, *, fail_recv_times: int = 0) -> None:
        self.sent: list[str] = []
        self.closed = False
        self._fail_recv_times = fail_recv_times
        self._turn = 0

    async def send(self, data: str) -> None:
        self.sent.append(data)

    async def recv(self) -> str:
        if self._fail_recv_times > 0:
            self._fail_recv_times -= 1
            raise ConnectionError("simulated disconnect")
        # commit 後の response.create に対し完了イベントを返す
        import json

        if any('"response.create"' in s for s in self.sent):
            self._turn += 1
            # session 系は send 済みとみなし、done を返す
            return json.dumps(
                {
                    "type": "response.done",
                    "response": {"status": "completed"},
                }
            )
        return json.dumps({"type": "session.updated"})

    async def close(self) -> None:
        self.closed = True

    async def __aenter__(self) -> _FakeWs:
        return self

    async def __aexit__(self, *_args: object) -> None:
        await self.close()


@pytest.fixture
def session_ctx() -> SessionContext:
    return SessionContext(
        room_id="room-1",
        speaker_id="spk-a",
        source_language="ja",
        target_language="en",
        provider="gpt_realtime",
    )


def test_make_session_key_joins_components(session_ctx: SessionContext) -> None:
    """session_key は room/speaker/lang/provider で構成される。"""
    key = make_session_key(session_ctx)
    assert key == "room-1:spk-a:en:gpt_realtime"


def test_session_key_rejects_empty_components() -> None:
    """空要素の SessionContext は open 拒否の材料になる。"""
    ctx = SessionContext(
        room_id="",
        speaker_id="s",
        source_language="ja",
        target_language="en",
        provider="gpt_realtime",
    )
    with pytest.raises(ValueError):
        make_session_key(ctx)


def test_generation_tracker_monotonic_and_interrupt() -> None:
    """generation_id は単調増加し、interrupt 後は旧世代が非アクティブになる。"""
    tracker = GenerationTracker()
    g1 = tracker.begin()
    assert g1 == 1
    assert tracker.is_active(g1) is True
    g2 = tracker.begin()
    assert g2 == 2
    assert tracker.is_active(g1) is False
    assert tracker.is_active(g2) is True
    tracker.interrupt(g2)
    assert tracker.is_active(g2) is False
    assert tracker.should_capture(g2) is False


def test_generation_interrupt_latency_under_300ms() -> None:
    """割込みから旧世代 capture 拒否までが目標 300ms 以内（純ロジック計測）。"""
    tracker = GenerationTracker()
    old = tracker.begin()
    start = time.perf_counter()
    tracker.begin()  # 新世代発行で旧を無効化
    assert tracker.should_capture(old) is False
    elapsed_ms = (time.perf_counter() - start) * 1000.0
    assert elapsed_ms <= 300.0


@pytest.mark.asyncio
async def test_per_utterance_commit_emits_events(session_ctx: SessionContext) -> None:
    """PerUtterance: commit_turn 後に audio/transcript/turn_done が得られる。"""
    calls: list[tuple[bytes, str, str]] = []

    async def translate(
        audio: bytes, src: str, tgt: str, _original: str | None = None
    ) -> RuntimeTranslationOutput:
        calls.append((audio, src, tgt))
        return _translation(audio_data=b"WAV", translated_text="hello")

    runtime = PerUtteranceRuntime(translate_fn=translate)
    await runtime.open_session(session_ctx)
    await runtime.append_audio(b"pcm-or-wav")
    gen = await runtime.commit_turn("utt-1")
    events = [e async for e in runtime.events()]
    await runtime.close_session()

    assert len(calls) == 1
    assert gen >= 1
    types = [e.type for e in events]
    assert "turn_done" in types
    audio_events = [e for e in events if e.type == "audio"]
    assert audio_events and audio_events[0].audio_data == b"WAV"
    assert all(e.generation_id == gen for e in events)
    assert all(e.utterance_id == "utt-1" for e in events)


@pytest.mark.asyncio
async def test_per_utterance_interrupt_drops_old_audio(
    session_ctx: SessionContext,
) -> None:
    """interrupt 後、旧 generation の音声イベントは配信対象外になる。"""
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_translate(
        _audio: bytes, _src: str, _tgt: str, _original: str | None = None
    ) -> RuntimeTranslationOutput:
        started.set()
        await release.wait()
        return _translation(audio_data=b"OLD", translated_text="old")

    runtime = PerUtteranceRuntime(translate_fn=slow_translate)
    tracker = runtime.generation_tracker
    await runtime.open_session(session_ctx)
    await runtime.append_audio(b"a")
    commit_task = asyncio.create_task(runtime.commit_turn("utt-1"))
    await started.wait()
    # commit 中に現行世代を割り込み（begin 前でも current を読む）
    # commit_turn 内で begin 済みのはずなので短時間待つ
    await asyncio.sleep(0)
    gen1 = tracker.current
    runtime.interrupt(gen1)
    release.set()
    finished_gen = await commit_task
    events = [e async for e in runtime.events()]
    assert finished_gen == gen1
    assert tracker.should_capture(gen1) is False
    for e in events:
        if e.type == "audio":
            assert tracker.should_capture(e.generation_id) is False


@pytest.mark.asyncio
async def test_native_persistent_reuses_connection(session_ctx: SessionContext) -> None:
    """同一 session_key では connect を発話ごとに作り直さない。"""
    connects = {"n": 0}
    sockets: list[_FakeWs] = []

    async def connect() -> _FakeWs:
        connects["n"] += 1
        ws = _FakeWs()
        sockets.append(ws)
        return ws

    runtime = NativePersistentRuntime(
        connect_fn=connect,
        reconnect_max=3,
        # テスト用: 実 API 収集の代わりに簡易ターン実行
        turn_fn=_fake_turn,
    )
    await runtime.open_session(session_ctx)
    await runtime.append_audio(b"seg1")
    await runtime.commit_turn("utt-1")
    _ = [e async for e in runtime.events()]
    await runtime.append_audio(b"seg2")
    await runtime.commit_turn("utt-2")
    _ = [e async for e in runtime.events()]
    await runtime.close_session()

    assert connects["n"] == 1


async def _fake_turn(
    _ws: Any,
    _audio: bytes,
    _ctx: SessionContext,
    generation_id: int,
    utterance_id: str,
) -> list[RuntimeEvent]:
    """持続ランタイムの 1 ターン結果を返す注入関数。"""
    return [
        RuntimeEvent(
            type="audio",
            generation_id=generation_id,
            utterance_id=utterance_id,
            audio_data=b"A",
            text="",
        ),
        RuntimeEvent(
            type="transcript_delta",
            generation_id=generation_id,
            utterance_id=utterance_id,
            text="hi",
        ),
        RuntimeEvent(
            type="turn_done",
            generation_id=generation_id,
            utterance_id=utterance_id,
        ),
    ]


async def _always_fail_turn(
    _ws: Any,
    _audio: bytes,
    _ctx: SessionContext,
    _generation_id: int,
    _utterance_id: str,
) -> list[RuntimeEvent]:
    raise ConnectionError("provider down")


@pytest.mark.asyncio
async def test_native_interrupt_suppresses_stale_audio(
    session_ctx: SessionContext,
) -> None:
    """新 generation 発行後、旧 generation 音声は should_capture で拒否される。"""

    async def connect() -> _FakeWs:
        return _FakeWs()

    runtime = NativePersistentRuntime(
        connect_fn=connect,
        turn_fn=_fake_turn,
    )
    await runtime.open_session(session_ctx)
    await runtime.append_audio(b"a")
    g1 = await runtime.commit_turn("utt-1")
    events1 = [e async for e in runtime.events()]
    runtime.interrupt(g1)
    await runtime.append_audio(b"b")
    g2 = await runtime.commit_turn("utt-2")
    assert g2 > g1
    assert runtime.generation_tracker.should_capture(g1) is False
    assert runtime.generation_tracker.should_capture(g2) is True
    assert any(e.generation_id == g1 for e in events1)


@pytest.mark.asyncio
async def test_native_persistent_reconnect_then_fallback(
    session_ctx: SessionContext,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """切断後は再接続を試し、上限超過で per_utterance 相当へ切り戻す。"""
    connects = {"n": 0}

    async def connect() -> _FakeWs:
        connects["n"] += 1
        return _FakeWs()

    fallback_calls = {"n": 0}

    async def fallback_translate(
        _audio: bytes, _src: str, _tgt: str, _original: str | None = None
    ) -> RuntimeTranslationOutput:
        fallback_calls["n"] += 1
        return _translation(audio_data=b"FB", translated_text="fallback")

    async def _no_sleep(_delay: float) -> None:
        return None

    monkeypatch.setattr(asyncio, "sleep", _no_sleep)

    fallback = PerUtteranceRuntime(translate_fn=fallback_translate)
    runtime = NativePersistentRuntime(
        connect_fn=connect,
        reconnect_max=2,
        turn_fn=_always_fail_turn,
        fallback_runtime=fallback,
    )
    await runtime.open_session(session_ctx)
    await runtime.append_audio(b"x")
    await runtime.commit_turn("utt-1")
    events = [e async for e in runtime.events()]
    await runtime.close_session()

    assert connects["n"] >= 1
    assert runtime.is_fallback is True
    assert fallback_calls["n"] == 1
    assert any(e.type == "runtime_degraded" for e in events) or any(
        e.type == "turn_done" for e in events
    )


@pytest.mark.asyncio
async def test_factory_default_is_per_utterance(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """未設定相当（既定）では PerUtteranceRuntime が選ばれる。"""
    from app.config import settings

    monkeypatch.setattr(settings, "realtime_runtime", "per_utterance")
    rt = create_realtime_runtime()
    assert isinstance(rt, PerUtteranceRuntime)


@pytest.mark.asyncio
async def test_factory_native_persistent(monkeypatch: pytest.MonkeyPatch) -> None:
    """native_persistent 設定では NativePersistentRuntime が選ばれる。"""
    from app.config import settings

    monkeypatch.setattr(settings, "realtime_runtime", "native_persistent")
    rt = create_realtime_runtime()
    assert isinstance(rt, NativePersistentRuntime)


@pytest.mark.asyncio
async def test_registry_owns_session_for_both_modes(
    session_ctx: SessionContext,
) -> None:
    """
    Registry は mode によらず同一 session_key の Runtime を所有・再利用する。

    接続再利用は持続 capability。短命も tracker 共有のため instance を保持する。
    """
    persistent = RuntimeRegistry(mode="native_persistent")
    a = persistent.get_or_create(session_ctx)
    b = persistent.get_or_create(session_ctx)
    assert a is b

    short_lived = RuntimeRegistry(mode="per_utterance")
    short_a = short_lived.get_or_create(session_ctx)
    short_b = short_lived.get_or_create(session_ctx)
    assert short_a is short_b

    other = SessionContext(
        room_id="room-1",
        speaker_id="spk-b",
        source_language="ja",
        target_language="en",
        provider="gpt_realtime",
    )
    c = persistent.get_or_create(other)
    assert c is not a


@pytest.mark.asyncio
async def test_registry_releases_speaker_sessions(
    session_ctx: SessionContext,
) -> None:
    """退室話者のセッションを解放し、同じキーを再作成できる。"""
    registry = RuntimeRegistry(max_sessions=1, mode="native_persistent")
    first = registry.get_or_create(session_ctx)

    await registry.release_speaker(session_ctx.room_id, session_ctx.speaker_id)
    second = registry.get_or_create(session_ctx)

    assert second is not first


@pytest.mark.asyncio
async def test_registry_room_release_closes_all_speakers(
    session_ctx: SessionContext,
) -> None:
    """capability: room release は同一会議室の全 speaker session を閉じる。"""
    registry = RuntimeRegistry(mode="native_persistent")
    other = SessionContext(
        room_id=session_ctx.room_id,
        speaker_id="spk-b",
        source_language="ja",
        target_language="en",
        provider="gpt_realtime",
    )
    first = registry.get_or_create(session_ctx)
    second = registry.get_or_create(other)

    await registry.release_room(session_ctx.room_id)

    again_a = registry.get_or_create(session_ctx)
    again_b = registry.get_or_create(other)
    assert again_a is not first
    assert again_b is not second


@pytest.mark.asyncio
async def test_registry_close_all_is_idempotent_after_partial_failure(
    session_ctx: SessionContext,
) -> None:
    """
    close_all は冪等で、途中失敗後も残セッションの解放を試みる。
    """
    registry = RuntimeRegistry(mode="native_persistent")
    other = SessionContext(
        room_id="room-2",
        speaker_id="spk-z",
        source_language="ja",
        target_language="zh",
        provider="gpt_realtime",
    )
    first = registry.get_or_create(session_ctx)
    second = registry.get_or_create(other)

    calls = {"n": 0}
    original_close = first.close_session

    async def boom_then_ok() -> None:
        calls["n"] += 1
        if calls["n"] == 1:
            raise RuntimeError("close failed once")
        await original_close()

    first.close_session = boom_then_ok  # type: ignore[method-assign]
    await registry.close_all()
    await registry.close_all()
    # 失敗後も第二セッションは解放され、再取得は新規になる
    assert registry.get_or_create(session_ctx) is not first
    assert registry.get_or_create(other) is not second


@pytest.mark.asyncio
async def test_registry_interrupt_speaker_without_external_tracker(
    session_ctx: SessionContext,
) -> None:
    """Registry 所有の Runtime へ generation_id 省略で現行世代を interrupt できる。"""

    async def translate(
        _audio: bytes, _src: str, _tgt: str, _original: str | None
    ) -> RuntimeTranslationOutput:
        return _translation(audio_data=b"A", translated_text="T")

    def factory(
        mode: str | None = None,
        *,
        generation_tracker: GenerationTracker | None = None,
    ) -> PerUtteranceRuntime:
        del mode
        return PerUtteranceRuntime(
            translate_fn=translate, generation_tracker=generation_tracker
        )

    registry = RuntimeRegistry(mode="per_utterance", runtime_factory=factory)
    runtime = registry.get_or_create(session_ctx)
    await runtime.open_session(session_ctx)
    turn = await runtime.run_turn(TurnInput(utterance_id="utt-1", audio=b"x"))
    assert runtime.should_capture(turn.generation_id) is True

    registry.interrupt_speaker(session_ctx.room_id, session_ctx.speaker_id)
    assert runtime.should_capture(turn.generation_id) is False
    await runtime.close_session()


@pytest.mark.asyncio
async def test_publisher_rejects_stale_generation() -> None:
    """旧 generation の音声は publisher に載らない。"""
    from app.webrtc.publisher import GenerationGate

    gate = GenerationGate()
    gate.set_active("spk", "en", 2)
    assert gate.should_capture("spk", "en", 2) is True
    assert gate.should_capture("spk", "en", 1) is False
    flushed = gate.flush("spk", "en")
    assert flushed == 2
    # flush 後も世代は維持し、不一致のみ拒否
    assert gate.should_capture("spk", "en", 1) is False


@pytest.mark.asyncio
async def test_sink_skips_stale_generation_audio() -> None:
    """sink は generation 不一致の翻訳音声を capture しない。"""
    from app.webrtc.publisher import GenerationGate
    from app.webrtc.sink import LiveKitOutputSink

    captured: list[tuple[str, str, int | None]] = []
    gate = GenerationGate()
    gate.set_active("sp", "en", 5)

    async def capture(
        speaker_id: str, lang: str, _pcm: bytes, *, generation_id: int | None = None
    ) -> None:
        captured.append((speaker_id, lang, generation_id))

    async def send(_p: bytes, _ids: list[str], _t: str) -> None:
        return None

    sink = LiveKitOutputSink(
        user_language={"u1": "en"},
        capture_audio=capture,
        send_data=send,
        speaker_id="sp",
        generation_gate=gate,
    )
    await sink.deliver_audio("u1", b"\x00\x00" * 240, generation_id=3)
    assert captured == []
    await sink.deliver_audio("u1", b"\x00\x00" * 240, generation_id=5)
    assert captured == [("sp", "en", 5)]


@dataclass
class _HearingState:
    """orchestrator barge-in 検証用の共有状態。"""

    started: asyncio.Event = field(default_factory=asyncio.Event)
    release: asyncio.Event = field(default_factory=asyncio.Event)
    delivered: list[int] = field(default_factory=list)


@pytest.mark.asyncio
async def test_orchestrator_barge_in_does_not_cancel_reading() -> None:
    """
    barge-in 相当で旧 hearing 音声は抑止され、reading は完走する。

    世代抑止の契約は Port suite / registry 側。本テストは orchestrator が
    reading をキャンセルしないことだけを注入スタブで観測する。
    """
    from app.ai_pipeline.orchestrator import HybridOrchestrator, Listener

    state = _HearingState()
    reading_done = asyncio.Event()
    cancelled = {"v": False}

    async def hearing(
        _a: bytes, _s: str, _t: str, _spk: str, _o: str | None
    ) -> HearingOutput:
        state.started.set()
        await state.release.wait()
        if cancelled["v"]:
            return HearingOutput(audio_data=None, translated_text="")
        state.delivered.append(1)
        return HearingOutput(audio_data=b"A", translated_text="H")

    async def reading(_text: str, _src: str, _tgt: str) -> str:
        reading_done.set()
        return "R:en"

    class _Sink:
        def __init__(self) -> None:
            self.audio: list[bytes] = []
            self.subtitles: list[dict] = []
            self.events: list[dict] = []

        async def deliver_audio(
            self, _uid: str, audio: bytes, *, generation_id: int | None = None
        ) -> None:
            del generation_id
            self.audio.append(audio)

        async def deliver_subtitle(self, _uid: str, message: dict) -> None:
            self.subtitles.append(message)

        async def deliver_event(self, _uid: str, message: dict) -> None:
            self.events.append(message)

    sink = _Sink()
    orch = HybridOrchestrator(hearing_fn=hearing, reading_fn=reading)
    task = asyncio.create_task(
        orch.orchestrate(
            audio_bytes=b"x",
            source_language="ja",
            original_text="文1",
            listeners=[Listener("u1", "en", True, True)],
            sink=sink,
            mode="hybrid",
            speaker_id="spk",
            generation_id=1,
        )
    )
    await state.started.wait()
    await reading_done.wait()
    cancelled["v"] = True
    state.release.set()
    res = await task
    assert res.translations.get("en") == "R:en"
    assert sink.audio == []
    assert state.delivered == []
