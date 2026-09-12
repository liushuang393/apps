"""確定発話の受理タイミングで進行中の聞く主線を壊さないことを検証する。

背景:
    IngressPipeline は確定発話を queue へ積んだ時点で on_final_accepted を呼ぶ。
    ここで producer 側から ``interrupt_speaker`` を実行すると、直前発話の聞く主線
    （ASR+MT+TTS で数秒かかる）がまだ生成中であるため、その世代が無効化され
    「まだ誰も聞いていない翻訳音声」が破棄される。連続発話では毎発話がこれに
    該当し、翻訳音声が一切届かず字幕へ縮退し続ける。

設計:
    配信済み／配信中の音声に対する barge-in は publisher の GenerationGate が
    フレーム単位で担う（旧世代は capture 拒否）。producer 側で生成中世代を
    無効化する必要はない。
"""

from __future__ import annotations

import types

import pytest

from app.webrtc.agent import LiveKitAgent


class _FrameStream:
    """指定 PCM を返す AudioStream モック。"""

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
    """push_frame／end を記録するテスト用 pipeline。"""

    def __init__(self) -> None:
        self.frames: list[bytes] = []
        self.ended = False

    def push_frame(self, pcm: bytes) -> None:
        self.frames.append(pcm)

    async def end(self) -> None:
        self.ended = True

    async def cancel(self) -> None:
        return None

    def snapshot(self):  # noqa: ANN201
        return types.SimpleNamespace(depth=0, overload=False)


@pytest.mark.asyncio
async def test_final_accept_does_not_interrupt_in_flight_hearing(monkeypatch) -> None:
    """確定発話の受理では進行中の聞く主線世代を無効化しない。"""
    agent = LiveKitAgent("room-t", room=object())  # type: ignore[arg-type]
    interrupts: list[tuple[str, str]] = []

    def record_interrupt(room_id: str, speaker_id: str) -> None:
        """interrupt_speaker の呼び出しを記録する。"""
        interrupts.append((room_id, speaker_id))

    monkeypatch.setattr(agent._processor, "interrupt_speaker", record_interrupt)

    captured: dict[str, object] = {}

    def fake_create_default(**kwargs):  # noqa: ANN003
        captured.update(kwargs)
        return _RecordingPipeline()

    monkeypatch.setattr(
        "app.webrtc.agent.IngressPipeline.create_default", fake_create_default
    )
    monkeypatch.setattr(
        "app.webrtc.agent.rtc.AudioStream", lambda *_a, **_k: _FrameStream([b"pcm"])
    )

    await agent._ingest(
        track=object(), participant=types.SimpleNamespace(identity="sp1")
    )

    hook = captured.get("on_final_accepted")
    if callable(hook):
        hook()

    assert interrupts == [], (
        "確定発話の受理で聞く主線が無効化されている"
        "（生成中の翻訳音声が破棄され字幕へ縮退する）"
    )
