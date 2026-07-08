"""LiveKitAgent のセグメントキュー（欠陥 #11: head-of-line blocking 解消）のテスト。"""
import asyncio
import types

import pytest

from app.webrtc.agent import LiveKitAgent
from app.webrtc.segmenter import SegmentEvent


def _final(pcm: bytes) -> SegmentEvent:
    return SegmentEvent(pcm, False)


def _partial(pcm: bytes) -> SegmentEvent:
    return SegmentEvent(pcm, True)


def _agent() -> LiveKitAgent:
    # rtc.Room を作らないようダミー room を注入（run しない限り rtc 依存なし）
    return LiveKitAgent("room-t", room=object())  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_worker_processes_in_order(monkeypatch):
    agent = _agent()
    handled: list[bytes] = []

    async def fake_handle(speaker_id: str, seg: bytes) -> None:  # noqa: ARG001
        handled.append(seg)

    monkeypatch.setattr(agent, "_handle_segment", fake_handle)
    queue: asyncio.Queue = asyncio.Queue(maxsize=8)
    worker = asyncio.ensure_future(agent._segment_worker("sp", queue))
    for seg in (b"a", b"b", b"c"):
        agent._enqueue_segment("sp", queue, _final(seg))
    await queue.put(None)
    await worker
    assert handled == [b"a", b"b", b"c"]


@pytest.mark.asyncio
async def test_partial_routes_to_handle_partial(monkeypatch):
    """partial イベントは _handle_partial、final は _handle_segment へ振り分けられる。"""
    agent = _agent()
    finals: list[bytes] = []
    partials: list[bytes] = []

    async def fake_final(speaker_id: str, seg: bytes) -> None:  # noqa: ARG001
        finals.append(seg)

    async def fake_partial(speaker_id: str, seg: bytes) -> None:  # noqa: ARG001
        partials.append(seg)

    monkeypatch.setattr(agent, "_handle_segment", fake_final)
    monkeypatch.setattr(agent, "_handle_partial", fake_partial)
    queue: asyncio.Queue = asyncio.Queue(maxsize=8)
    worker = asyncio.ensure_future(agent._segment_worker("sp", queue))
    agent._enqueue_segment("sp", queue, _partial(b"p1"))
    agent._enqueue_segment("sp", queue, _final(b"f1"))
    await queue.put(None)
    await worker
    assert partials == [b"p1"]
    assert finals == [b"f1"]


@pytest.mark.asyncio
async def test_enqueue_drops_oldest_when_full():
    agent = _agent()
    queue: asyncio.Queue = asyncio.Queue(maxsize=2)
    agent._enqueue_segment("sp", queue, _final(b"1"))
    agent._enqueue_segment("sp", queue, _final(b"2"))
    agent._enqueue_segment("sp", queue, _final(b"3"))  # 満杯 → 最古 b"1" を破棄
    items = [queue.get_nowait().pcm, queue.get_nowait().pcm]
    assert items == [b"2", b"3"]


@pytest.mark.asyncio
async def test_enqueue_full_drops_partial_keeps_finals():
    """満杯時、partial は破棄され既存 final は退避されない（final 漏れ防止）。"""
    agent = _agent()
    queue: asyncio.Queue = asyncio.Queue(maxsize=2)
    agent._enqueue_segment("sp", queue, _final(b"1"))
    agent._enqueue_segment("sp", queue, _final(b"2"))
    agent._enqueue_segment("sp", queue, _partial(b"p"))  # 満杯 → partial は捨てる
    items = [queue.get_nowait().pcm, queue.get_nowait().pcm]
    assert items == [b"1", b"2"]  # final は温存される


@pytest.mark.asyncio
async def test_worker_survives_handler_error(monkeypatch):
    agent = _agent()
    handled: list[bytes] = []

    async def flaky(speaker_id: str, seg: bytes) -> None:  # noqa: ARG001
        if seg == b"boom":
            raise RuntimeError("provider down")
        handled.append(seg)

    monkeypatch.setattr(agent, "_handle_segment", flaky)
    queue: asyncio.Queue = asyncio.Queue(maxsize=8)
    worker = asyncio.ensure_future(agent._segment_worker("sp", queue))
    agent._enqueue_segment("sp", queue, _final(b"boom"))
    agent._enqueue_segment("sp", queue, _final(b"ok"))
    await queue.put(None)
    await worker
    assert handled == [b"ok"]


class _RaisingStream:
    """途中で例外を投げる AudioStream モック（異常切断を再現）。"""

    def __aiter__(self):
        return self

    async def __anext__(self):
        raise RuntimeError("connection dropped")


class _TailSegmenter:
    """push_events は何も返さず、flush で末尾セグメントを返すモック。"""

    def __init__(self, *args, **kwargs) -> None:  # noqa: ARG002
        pass

    def push_events(self, pcm: bytes) -> list:  # noqa: ARG002
        return []

    def flush(self) -> bytes:
        return b"tail"


@pytest.mark.asyncio
async def test_ingest_flushes_tail_on_abnormal_disconnect(monkeypatch):
    """異常切断（async for 中の例外）でも tail flush が emit される（改善点 M3）。"""
    agent = _agent()
    handled: list[bytes] = []

    async def capture(speaker_id: str, seg: bytes) -> None:  # noqa: ARG001
        handled.append(seg)

    monkeypatch.setattr(agent, "_handle_segment", capture)
    # AudioStream / SpeechSegmenter を差し替え（rtc 依存を排除）
    monkeypatch.setattr(
        "app.webrtc.agent.rtc.AudioStream", lambda *_a, **_k: _RaisingStream()
    )
    monkeypatch.setattr("app.webrtc.agent.SpeechSegmenter", _TailSegmenter)

    participant = types.SimpleNamespace(identity="sp")
    # 例外は finally で tail を flush した後に再送出される（本番では _spawn が捕捉）。
    with pytest.raises(RuntimeError, match="connection dropped"):
        await agent._ingest(track=object(), participant=participant)

    assert handled == [b"tail"]


@pytest.mark.asyncio
async def test_room_empty_leave_forgets_sequencer_state(monkeypatch):
    """改善点 M5: 最後の参加者退室で processor.forget_room が呼ばれる。"""
    agent = _agent()
    forgotten: list[str] = []
    monkeypatch.setattr(agent._processor, "forget_room", forgotten.append)

    async def fake_remove(room_id: str, pid: str) -> int:  # noqa: ARG001
        return 0  # 退室後の残り 0 = room 空

    async def fake_end(room_id: str) -> None:  # noqa: ARG001
        pass

    monkeypatch.setattr("app.webrtc.agent.room_manager.remove_participant", fake_remove)
    monkeypatch.setattr("app.webrtc.agent.end_session", fake_end)

    await agent._handle_participant_leave("last-user")
    assert forgotten == ["room-t"]


@pytest.mark.asyncio
async def test_leave_clears_partial_revision(monkeypatch):
    """退室で当該話者の partial リビジョンが破棄される（残留/再入室連番防止）。"""
    agent = _agent()
    agent._partial_rev["u1"] = 5
    agent._partial_rev["u2"] = 2

    async def fake_remove(room_id: str, pid: str) -> int:  # noqa: ARG001
        return 1  # まだ残っている（room は空でない）

    monkeypatch.setattr("app.webrtc.agent.room_manager.remove_participant", fake_remove)

    await agent._handle_participant_leave("u1")
    assert "u1" not in agent._partial_rev
    assert agent._partial_rev.get("u2") == 2  # 他話者は保持
