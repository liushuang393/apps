"""partial 字幕（§P2）: Output Manager 事件フィールドと配信、processor.process_partial。"""

from __future__ import annotations

import pytest

from app.ai_pipeline.orchestrator import HybridOrchestrator, Listener
from app.ai_pipeline.output_manager import (
    TOPIC_SUBTITLE,
    DefaultOutputManager,
    FinalSubtitleCommand,
    ListenerRef,
    PartialSubtitleCommand,
    RecordingTransportAdapter,
)
from app.rooms.manager import ParticipantPreference
from app.webrtc.processor import SegmentProcessor


class _CapturingSink(RecordingTransportAdapter):
    """TransportAdapter 観測用。字幕イベントを便利ビューで公開する。"""

    @property
    def subtitles(self) -> list[tuple[str, dict]]:
        """字幕 topic のイベント一覧。"""
        return [
            (uid, ev)
            for uid, topic, ev in self.data
            if topic == TOPIC_SUBTITLE and ev.get("type") == "subtitle"
        ]


@pytest.mark.asyncio
async def test_partial_subtitle_event_fields() -> None:
    """PartialSubtitleCommand 経由の事件は is_partial/revision/is_final/trace_id を持つ。"""
    adapter = RecordingTransportAdapter()
    manager = DefaultOutputManager(adapter=adapter)
    await manager.handle(
        PartialSubtitleCommand(
            room_id="",
            speaker_id="sp",
            subtitle_id="sid",
            seq=3,
            original_text="こんにちは",
            source_language="ja",
            target_language="en",
            listeners=(
                ListenerRef("u1", "en", wants_audio=False, subtitle_enabled=True),
            ),
            revision=2,
            trace_id="t-1",
        )
    )
    assert len(adapter.data) == 1
    msg = adapter.data[0][2]
    assert msg["is_partial"] is True
    assert msg["is_final"] is False
    assert msg["revision"] == 2
    assert msg["sequence_id"] == 3
    assert msg["translated_text"] is None
    assert msg["trace_id"] == "t-1"


@pytest.mark.asyncio
async def test_final_subtitle_defaults_are_backward_compatible() -> None:
    """確定字幕は is_final=True・is_partial=False・revision=0。"""
    adapter = RecordingTransportAdapter()
    manager = DefaultOutputManager(adapter=adapter)
    await manager.handle(
        FinalSubtitleCommand(
            room_id="",
            speaker_id="sp",
            subtitle_id="sid",
            seq=1,
            original_text="hi",
            source_language="en",
            target_language="ja",
            translated_text="やあ",
            mainline="reading",
            listeners=(
                ListenerRef("u1", "ja", wants_audio=False, subtitle_enabled=True),
            ),
        )
    )
    msg = adapter.data[0][2]
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
    assert delivered[0]["room_id"] == "r"
    assert isinstance(delivered[0]["output_manager"], DefaultOutputManager)
    assert delivered[0]["output_manager"]._revision_authority is not None


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
