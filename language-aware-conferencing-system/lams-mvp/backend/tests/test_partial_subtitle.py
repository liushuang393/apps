"""partial 字幕（§P2）: orchestrator 事件フィールドと配信、processor.process_partial。"""

import pytest

from app.ai_pipeline.orchestrator import HybridOrchestrator, Listener
from app.rooms.manager import ParticipantPreference
from app.webrtc.processor import SegmentProcessor


class _CapturingSink:
    """deliver_subtitle を記録するダミー Sink。"""

    def __init__(self) -> None:
        self.subtitles: list[tuple[str, dict]] = []

    async def deliver_audio(self, user_id: str, audio: bytes) -> None:  # noqa: ARG002
        pass

    async def deliver_subtitle(self, user_id: str, message: dict) -> None:
        self.subtitles.append((user_id, message))


def test_subtitle_message_partial_fields() -> None:
    """_subtitle_message は is_partial/revision/is_final/trace_id を持つ（事件協議）。"""
    orch = HybridOrchestrator()
    msg = orch._subtitle_message(
        subtitle_id="sid",
        seq=3,
        speaker_id="sp",
        original_text="こんにちは",
        source_language="ja",
        target_lang="en",
        subtitle_text="",
        mainline="partial",
        s2s_provider=None,
        is_partial=True,
        revision=2,
        trace_id="t-1",
    )
    assert msg["is_partial"] is True
    assert msg["is_final"] is False
    assert msg["revision"] == 2
    assert msg["sequence_id"] == 3
    assert msg["translated_text"] is None
    assert msg["trace_id"] == "t-1"


def test_final_message_defaults_are_backward_compatible() -> None:
    """既定（partial 引数なし）は従来どおり is_final=True・is_partial=False。"""
    orch = HybridOrchestrator()
    msg = orch._subtitle_message(
        subtitle_id="sid",
        seq=1,
        speaker_id="sp",
        original_text="hi",
        source_language="en",
        target_lang="ja",
        subtitle_text="やあ",
        mainline="reading",
        s2s_provider=None,
    )
    assert msg["is_final"] is True
    assert msg["is_partial"] is False
    assert msg["revision"] == 0
    assert msg["translated_text"] == "やあ"


@pytest.mark.asyncio
async def test_deliver_partial_subtitle_groups_by_language() -> None:
    """暫定字幕は各受聴者へ原文のみ（訳文None・is_partial）で配信される。"""
    orch = HybridOrchestrator()
    sink = _CapturingSink()
    listeners = [
        Listener("u_en", "en", wants_audio=False, subtitle_enabled=True),
        Listener("u_zh", "zh", wants_audio=False, subtitle_enabled=True),
        Listener("u_off", "vi", wants_audio=False, subtitle_enabled=False),
    ]
    await orch.deliver_partial_subtitle(
        sink=sink,
        listeners=listeners,
        subtitle_id="",
        seq=0,
        revision=1,
        speaker_id="sp",
        partial_text="hello wor",
        source_language="ja",
    )
    # subtitle_enabled=True の 2 名のみ受信。
    assert {u for u, _ in sink.subtitles} == {"u_en", "u_zh"}
    for _, msg in sink.subtitles:
        assert msg["is_partial"] is True
        assert msg["original_text"] == "hello wor"
        assert msg["translated_text"] is None
        assert msg["revision"] == 1


@pytest.mark.asyncio
async def test_deliver_partial_empty_text_noop() -> None:
    """空 partial は配信しない。"""
    orch = HybridOrchestrator()
    sink = _CapturingSink()
    await orch.deliver_partial_subtitle(
        sink=sink,
        listeners=[Listener("u", "en", wants_audio=False, subtitle_enabled=True)],
        subtitle_id="",
        seq=0,
        revision=1,
        speaker_id="sp",
        partial_text="",
        source_language="ja",
    )
    assert sink.subtitles == []


@pytest.mark.asyncio
async def test_process_partial_delivers_asr_original() -> None:
    """process_partial は ASR 原文を interim 配信し、翻訳/永続化はしない。"""
    delivered: list[dict] = []

    class _FakeOrch:
        async def deliver_partial_subtitle(self, **kwargs) -> None:
            delivered.append(kwargs)

    async def fake_detect(_wav: bytes, hint: str) -> tuple[str, str]:  # noqa: ARG001
        return "partial text", "ja"

    proc = SegmentProcessor(orchestrator=_FakeOrch(), detect_fn=fake_detect)
    sink = _CapturingSink()
    participants = {
        "sp": ParticipantPreference("sp", "Speaker", "ja"),
        "u_en": ParticipantPreference("u_en", "L", "en", subtitle_enabled=True),
    }
    await proc.process_partial(
        room_id="r",
        speaker_id="sp",
        pcm16=b"\x01\x02" * 320,
        speaker_lang_hint="ja",
        participants=participants,
        sink_factory=lambda _ul, _sp: sink,
        revision=4,
    )
    assert len(delivered) == 1
    assert delivered[0]["partial_text"] == "partial text"
    assert delivered[0]["revision"] == 4
    assert delivered[0]["source_language"] == "ja"


@pytest.mark.asyncio
async def test_process_partial_skips_empty_asr() -> None:
    """ASR が空なら interim を配信しない。"""
    delivered: list[dict] = []

    class _FakeOrch:
        async def deliver_partial_subtitle(self, **kwargs) -> None:
            delivered.append(kwargs)

    async def empty_detect(_wav: bytes, _hint: str) -> tuple[str, str]:
        return "", "ja"

    proc = SegmentProcessor(orchestrator=_FakeOrch(), detect_fn=empty_detect)
    await proc.process_partial(
        room_id="r",
        speaker_id="sp",
        pcm16=b"\x01\x02" * 320,
        speaker_lang_hint="ja",
        participants={"sp": ParticipantPreference("sp", "S", "ja")},
        sink_factory=lambda _ul, _sp: _CapturingSink(),
        revision=1,
    )
    assert delivered == []
