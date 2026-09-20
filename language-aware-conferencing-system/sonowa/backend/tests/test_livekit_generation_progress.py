"""後続発話の音声を世代更新前の照合で落とさないことを検証する。"""

import pytest

from app.audio.pcm import wrap_wav16
from app.webrtc.publisher import GenerationGate
from app.webrtc.sink import LiveKitOutputSink


@pytest.mark.asyncio
async def test_new_utterance_advances_shared_gate_and_late_old_audio_is_rejected() -> None:
    """別Sinkから届く第2文を配信し、その後の遅延した第1文は再生しない。"""
    gate = GenerationGate()
    captured: list[int | None] = []

    async def capture(
        _speaker: str, _language: str, _pcm: bytes, *, generation_id: int | None = None
    ) -> None:
        captured.append(generation_id)

    async def send(_payload: bytes, _ids: list[str], _topic: str) -> None:
        return None

    for generation in (1, 2, 1):
        sink = LiveKitOutputSink(
            speaker_id="speaker",
            user_language={"listener": "en"},
            capture_audio=capture,
            send_data=send,
            generation_gate=gate,
        )
        await sink.publish_audio(
            speaker_id="speaker",
            language="en",
            audio=wrap_wav16(b"\x01\x00" * 2400, 24000),
            recipient_ids=["listener"],
            generation_id=generation,
        )
    assert captured == [1, 2]
    assert gate.should_capture("speaker", "en", 2)
    assert not gate.should_capture("speaker", "en", 1)


def test_generation_activation_never_rolls_back() -> None:
    """遅れて完了した旧要求が新しい世代を上書きしない。"""
    gate = GenerationGate()
    gate.set_active("speaker", "en", 2)
    gate.set_active("speaker", "en", 1)
    assert gate.should_capture("speaker", "en", 2)
    assert not gate.should_capture("speaker", "en", 1)
