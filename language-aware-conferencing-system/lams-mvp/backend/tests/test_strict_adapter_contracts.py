"""本番経路の厳密 adapter contract を検証する。"""

from __future__ import annotations

import pytest

from app.ai_pipeline.orchestrator import HybridOrchestrator
from app.ai_pipeline.runtime.per_utterance import PerUtteranceRuntime
from app.ai_pipeline.runtime.types import SessionContext, TurnInput
from app.webrtc.sink import LiveKitOutputSink


@pytest.mark.asyncio
async def test_hearing_rejects_non_hearing_output() -> None:
    """任意 object を空の HearingOutput へ暗黙変換しない。"""

    async def invalid_hearing(
        _audio: bytes,
        _source: str,
        _target: str,
        _speaker: str,
        _original_text: str | None,
    ) -> object:
        return object()

    orchestrator = HybridOrchestrator(hearing_fn=invalid_hearing)

    with pytest.raises(TypeError, match="HearingOutput"):
        await orchestrator._hearing(b"pcm", "ja", "en", "spk", "原文")


@pytest.mark.asyncio
async def test_per_utterance_rejects_non_translation_result() -> None:
    """Runtime adapter は不正 provider 戻り値を空イベントへ変換しない。"""

    async def invalid_translate(
        _audio: bytes,
        _source: str,
        _target: str,
        _original_text: str | None,
    ) -> object:
        return object()

    runtime = PerUtteranceRuntime(translate_fn=invalid_translate)
    await runtime.open_session(
        SessionContext(
            room_id="room-1",
            speaker_id="spk",
            source_language="ja",
            target_language="en",
            provider="test",
        )
    )

    with pytest.raises(TypeError, match="RuntimeTranslationOutput"):
        await runtime.run_turn(TurnInput(utterance_id="utt-1", audio=b"pcm"))


def test_sink_rejects_legacy_three_argument_capture() -> None:
    """旧三引数 capture は本番 sink の構築時に拒否する。"""

    async def legacy_capture(
        _speaker_id: str,
        _language: str,
        _pcm48: bytes,
    ) -> None:
        return None

    async def send_data(
        _payload: bytes,
        _identities: list[str],
        _topic: str,
    ) -> None:
        return None

    with pytest.raises(TypeError, match="generation_id"):
        LiveKitOutputSink(
            user_language={"u1": "en"},
            capture_audio=legacy_capture,
            send_data=send_data,
            speaker_id="spk",
        )


def test_sink_rejects_wrong_capture_positional_shape() -> None:
    """generation_id だけを持つ不完全 callback も構築時に拒否する。"""

    async def invalid_capture(
        _speaker_id: str,
        *,
        generation_id: int | None = None,
    ) -> None:
        del generation_id
        return None

    async def send_data(
        _payload: bytes,
        _identities: list[str],
        _topic: str,
    ) -> None:
        return None

    with pytest.raises(TypeError, match="固定 signature"):
        LiveKitOutputSink(
            user_language={"u1": "en"},
            capture_audio=invalid_capture,
            send_data=send_data,
            speaker_id="spk",
        )
