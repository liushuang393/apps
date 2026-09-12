"""LiveKitAgent を frame／end adapter として検証する（チケット10）。

取り込み政策（VAD／Queue／worker／soft-hard）は IngressPipeline 側にあり、
agent は PCM 変換と lifecycle 配線に限定されることを公開挙動で確認する。
"""

from __future__ import annotations

import ast
import types
from pathlib import Path

import pytest

from app.webrtc.agent import LiveKitAgent
from app.webrtc.ingress_pipeline import IngressPipeline


def _agent() -> LiveKitAgent:
    """rtc.Room を作らないようダミー room を注入する。"""
    return LiveKitAgent("room-t", room=object())  # type: ignore[arg-type]


class _FrameStream:
    """指定 PCM を 1 フレームだけ返す AudioStream モック。"""

    def __init__(self, frames: list[bytes]) -> None:
        self._frames = list(frames)
        self.closed = False

    def __aiter__(self):
        return self

    async def __anext__(self):
        if not self._frames:
            raise StopAsyncIteration
        pcm = self._frames.pop(0)
        return types.SimpleNamespace(frame=types.SimpleNamespace(data=pcm))

    async def aclose(self) -> None:
        self.closed = True


class _RecordingPipeline:
    """push_frame／end／cancel を記録するテスト用 pipeline。"""

    def __init__(self) -> None:
        self.frames: list[bytes] = []
        self.ended = False
        self.cancelled = False

    def push_frame(self, pcm: bytes) -> None:
        self.frames.append(pcm)

    async def end(self) -> None:
        self.ended = True

    async def cancel(self) -> None:
        self.cancelled = True

    def snapshot(self):  # noqa: ANN201
        return types.SimpleNamespace(depth=0, overload=False)


def test_agent_module_does_not_own_vad_or_segmenter() -> None:
    """agent.py は VAD／SpeechSegmenter を直接 import しない（所有は pipeline）。"""
    source = Path("app/webrtc/agent.py").read_text(encoding="utf-8")
    tree = ast.parse(source)
    imported: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom):
            module = node.module or ""
            for alias in node.names:
                imported.add(f"{module}.{alias.name}")
        elif isinstance(node, ast.Import):
            for alias in node.names:
                imported.add(alias.name)
    assert "app.webrtc.segmenter.SpeechSegmenter" not in imported
    assert "app.audio.vad.build_vad" not in imported
    assert "app.audio.vad.resolve_backend" not in imported
    assert "app.webrtc.ingress.SegmentIngress" not in imported


def test_agent_tracks_pipelines_not_segment_ingress() -> None:
    """agent は話者別 IngressPipeline を持ち、SegmentIngress 辞書は持たない。"""
    agent = _agent()
    assert hasattr(agent, "_pipelines")
    assert isinstance(agent._pipelines, dict)
    assert not hasattr(agent, "_ingresses")
    assert not hasattr(agent, "_ingress")


@pytest.mark.asyncio
async def test_ingest_passes_frames_then_end_via_pipeline(monkeypatch) -> None:
    """track の PCM は pipeline.push_frame へ渡り、離脱時に end される。"""
    agent = _agent()
    recorded = _RecordingPipeline()
    created: list[_RecordingPipeline] = []

    def fake_create_default(**_kwargs):  # noqa: ANN003
        created.append(recorded)
        return recorded

    stream = _FrameStream([b"pcm-a", b"pcm-b"])
    monkeypatch.setattr("app.webrtc.agent.rtc.AudioStream", lambda *_a, **_k: stream)
    monkeypatch.setattr(
        "app.webrtc.agent.IngressPipeline.create_default", fake_create_default
    )

    participant = types.SimpleNamespace(identity="sp1")
    await agent._ingest(track=object(), participant=participant)

    assert created == [recorded]
    assert recorded.frames == [b"pcm-a", b"pcm-b"]
    assert recorded.ended is True
    assert stream.closed is True
    assert "sp1" not in agent._pipelines


@pytest.mark.asyncio
async def test_ingest_registers_pipeline_per_speaker(monkeypatch) -> None:
    """話者ごとに独立した pipeline instance が登録される。"""
    agent = _agent()
    pipelines: list[_RecordingPipeline] = []

    def fake_create_default(**_kwargs):  # noqa: ANN003
        pipe = _RecordingPipeline()
        pipelines.append(pipe)
        return pipe

    # 最初のフレーム後に他話者の登録状態を観測できるよう、ブロックする stream
    release = __import__("asyncio").Event()

    class _BlockingStream(_FrameStream):
        async def __anext__(self):
            await release.wait()
            return await super().__anext__()

    monkeypatch.setattr(
        "app.webrtc.agent.IngressPipeline.create_default", fake_create_default
    )
    monkeypatch.setattr(
        "app.webrtc.agent.rtc.AudioStream",
        lambda *_a, **_k: _BlockingStream([b"x"]),
    )

    import asyncio

    t1 = asyncio.create_task(
        agent._ingest(track=object(), participant=types.SimpleNamespace(identity="a"))
    )
    t2 = asyncio.create_task(
        agent._ingest(track=object(), participant=types.SimpleNamespace(identity="b"))
    )
    # 双方が create_default するまで待つ
    for _ in range(50):
        if len(pipelines) >= 2 and set(agent._pipelines) >= {"a", "b"}:
            break
        await asyncio.sleep(0.01)
    assert agent._pipelines["a"] is not agent._pipelines["b"]
    release.set()
    await asyncio.gather(t1, t2)


@pytest.mark.asyncio
async def test_leave_cancels_pipeline_and_clears_registration(monkeypatch) -> None:
    """退室時に当該話者の pipeline を cancel し、登録を外す（zombie 防止）。"""
    agent = _agent()
    pipe = _RecordingPipeline()
    agent._pipelines["u1"] = pipe  # type: ignore[assignment]
    agent._speaker_overloaded["u1"] = True

    async def fake_remove(room_id: str, pid: str) -> int:  # noqa: ARG001
        return 1

    monkeypatch.setattr("app.webrtc.agent.room_manager.remove_participant", fake_remove)

    await agent._handle_participant_leave("u1")
    assert pipe.cancelled is True
    assert "u1" not in agent._pipelines
    assert "u1" not in agent._speaker_overloaded


@pytest.mark.asyncio
async def test_create_default_owns_segmenter_and_limits() -> None:
    """create_default は segmenter／limit を settings から構築し注入不要にする。"""
    finals: list[bytes] = []

    async def on_final(pcm: bytes) -> None:
        finals.append(pcm)

    async def on_partial(pcm: bytes) -> None:  # noqa: ARG001
        return None

    # segmenter を渡さず構築できること（所有が pipeline 側にある）
    pipeline = IngressPipeline.create_default(
        on_final=on_final,
        on_partial=on_partial,
        segmenter=_ScriptedForDefault(flush_tail=b"from-default"),
    )
    await pipeline.end()
    assert finals == [b"from-default"]


class _ScriptedForDefault:
    """create_default の注入経路を検証する最小 segmenter。"""

    def __init__(self, *, flush_tail: bytes = b"") -> None:
        self._flush_tail = flush_tail

    def push_events(self, pcm: bytes) -> list:  # noqa: ARG002
        return []

    def flush(self) -> bytes:
        return self._flush_tail
