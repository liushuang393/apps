"""LiveKitAgent のセグメントキュー（欠陥 #11: head-of-line blocking 解消）のテスト。"""
import asyncio

import pytest

from app.webrtc.agent import LiveKitAgent


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
        agent._enqueue_segment("sp", queue, seg)
    await queue.put(None)
    await worker
    assert handled == [b"a", b"b", b"c"]


@pytest.mark.asyncio
async def test_enqueue_drops_oldest_when_full():
    agent = _agent()
    queue: asyncio.Queue = asyncio.Queue(maxsize=2)
    agent._enqueue_segment("sp", queue, b"1")
    agent._enqueue_segment("sp", queue, b"2")
    agent._enqueue_segment("sp", queue, b"3")  # 満杯 → 最古 b"1" を破棄
    items = [queue.get_nowait(), queue.get_nowait()]
    assert items == [b"2", b"3"]


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
    agent._enqueue_segment("sp", queue, b"boom")
    agent._enqueue_segment("sp", queue, b"ok")
    await queue.put(None)
    await worker
    assert handled == [b"ok"]
