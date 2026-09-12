"""LiveKitOutputSink の Output Manager transport 契約を検証する。"""

from __future__ import annotations

import pytest

from app.webrtc.sink import LiveKitOutputSink


@pytest.mark.asyncio
async def test_output_manager_data_failure_propagates_to_delivery_report() -> None:
    """OM向け送信は例外を伝播し、受信者単位の失敗集約を可能にする。"""

    async def capture(
        _speaker_id: str,
        _language: str,
        _pcm: bytes,
        *,
        generation_id: int | None,
    ) -> None:
        del generation_id

    async def fail_send(_payload: bytes, _ids: list[str], _topic: str) -> None:
        raise RuntimeError("channel closed")

    sink = LiveKitOutputSink(
        user_language={"u1": "en"},
        capture_audio=capture,
        send_data=fail_send,
        speaker_id="spk",
    )

    with pytest.raises(RuntimeError, match="channel closed"):
        await sink.send_data(
            user_id="u1",
            topic="subtitle",
            payload=b'{"type":"subtitle"}',
        )


@pytest.mark.asyncio
async def test_output_manager_audio_publishes_once_per_language_track() -> None:
    """同一言語の複数受信者を一つの翻訳音声トラックへ publish する。"""
    captured: list[tuple[str, str, int | None]] = []

    async def capture(
        speaker_id: str,
        language: str,
        _pcm: bytes,
        *,
        generation_id: int | None,
    ) -> None:
        captured.append((speaker_id, language, generation_id))

    async def send(_payload: bytes, _ids: list[str], _topic: str) -> None:
        return None

    sink = LiveKitOutputSink(
        user_language={"u1": "en", "u2": "en"},
        capture_audio=capture,
        send_data=send,
        speaker_id="spk",
    )

    await sink.publish_audio(
        speaker_id="spk",
        language="en",
        audio=b"\x01\x00" * 240,
        recipient_ids=["u1", "u2"],
        generation_id=3,
    )

    assert captured == [("spk", "en", 3)]
