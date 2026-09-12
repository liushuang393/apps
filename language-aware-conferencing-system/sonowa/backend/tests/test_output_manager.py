"""
Output Manager（独立 module）の公開 interface 契約テスト。

目的:
    型付き出力命令に対し、誰へ何が配信・抑止されるかを記録型 fake adapter で検証する。
    実 LiveKit と HybridOrchestrator には依存しない（チケット05 の垂直スライス）。
注意:
    配信経路の本番移行はチケット06。本テストは Output Manager 単体のポリシーのみを対象とする。
"""

from __future__ import annotations

from dataclasses import dataclass, field

import pytest

import app.ai_pipeline.output_manager as output_manager_module
from app.ai_pipeline.events import SCHEMA_VERSION
from app.ai_pipeline.output_manager import (
    TOPIC_EVENT,
    TOPIC_SUBTITLE,
    DefaultOutputManager,
    FinalSubtitleCommand,
    InterimSubtitleCommand,
    InterruptedEventCommand,
    ListenerRef,
    PartialSubtitleCommand,
    QosWarningCommand,
    QualityEventCommand,
    RecordingTransportAdapter,
    TranslatedAudioCommand,
)
from app.ai_pipeline.qoe import (
    QoEDecision,
    QoEReason,
    QoEScope,
    QoEState,
    QoEUiReason,
)
from app.ai_pipeline.runtime.generation import GenerationTracker


def _listeners(*rows: tuple[str, str, bool, bool]) -> tuple[ListenerRef, ...]:
    """(user_id, lang, wants_audio, subtitle_enabled) から ListenerRef を組み立てる。"""
    return tuple(
        ListenerRef(
            user_id=user_id,
            target_language=lang,
            wants_audio=wants_audio,
            subtitle_enabled=subtitle_enabled,
        )
        for user_id, lang, wants_audio, subtitle_enabled in rows
    )


@dataclass
class _Harness:
    """Output Manager と記録型 adapter を束ねたテスト用ハーネス。"""

    adapter: RecordingTransportAdapter = field(
        default_factory=RecordingTransportAdapter
    )
    generations: GenerationTracker = field(default_factory=GenerationTracker)
    manager: DefaultOutputManager = field(init=False)

    def __post_init__(self) -> None:
        self.manager = DefaultOutputManager(
            adapter=self.adapter,
            generation_gate=self.generations,
        )


@pytest.mark.asyncio
async def test_reading_mainline_final_subtitle_does_not_wait_for_audio() -> None:
    """読む主線の確定字幕は翻訳音声の成否から独立して配信できる。"""
    h = _Harness()
    listeners = _listeners(("u1", "en", True, True))

    report = await h.manager.handle(
        FinalSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id="utt-1",
            seq=1,
            original_text="こんにちは",
            source_language="ja",
            target_language="en",
            translated_text="Hello",
            mainline="reading",
            listeners=listeners,
            generation_id=1,
        )
    )

    assert report.failures == []
    assert len(h.adapter.data) == 1
    user_id, topic, payload = h.adapter.data[0]
    assert (user_id, topic) == ("u1", TOPIC_SUBTITLE)
    assert payload["type"] == "subtitle"
    assert payload["schema_version"] == SCHEMA_VERSION
    assert payload["translated_text"] == "Hello"
    assert payload["is_final"] is True
    assert payload["mainline"] == "reading"
    assert h.adapter.audio == []


@pytest.mark.asyncio
async def test_speaker_is_excluded_from_translated_audio() -> None:
    """話者本人は翻訳音声を受信せず、他受聴者のみへ配信する。"""
    h = _Harness()
    gen = h.generations.begin()
    listeners = _listeners(
        ("spk", "en", True, True),
        ("u1", "en", True, True),
    )

    await h.manager.handle(
        TranslatedAudioCommand(
            speaker_id="spk",
            source_language="ja",
            target_language="en",
            audio=b"AUDIO",
            listeners=listeners,
            generation_id=gen,
        )
    )

    assert h.adapter.audio == [
        ("spk", "en", b"AUDIO", ["u1"], gen),
    ]


@pytest.mark.asyncio
async def test_subtitle_disabled_listener_is_suppressed() -> None:
    """字幕購読が無効な受聴者には字幕を配信しない。"""
    h = _Harness()
    listeners = _listeners(
        ("u1", "en", True, False),
        ("u2", "en", True, True),
    )

    report = await h.manager.handle(
        FinalSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id="utt-1",
            seq=1,
            original_text="text",
            source_language="ja",
            target_language="en",
            translated_text="text-en",
            mainline="reading",
            listeners=listeners,
        )
    )

    assert [item[0] for item in h.adapter.data] == ["u2"]
    assert any(s.reason == "subtitle_disabled" for s in report.suppressed)


@pytest.mark.asyncio
async def test_same_language_audio_is_suppressed() -> None:
    """同一言語（原文＝目標）では翻訳音声の重複配信を抑止する。"""
    h = _Harness()
    gen = h.generations.begin()
    listeners = _listeners(("u1", "ja", True, True))

    report = await h.manager.handle(
        TranslatedAudioCommand(
            speaker_id="spk",
            source_language="ja",
            target_language="ja",
            audio=b"AUDIO",
            listeners=listeners,
            generation_id=gen,
        )
    )

    assert h.adapter.audio == []
    assert any(s.reason == "same_language" for s in report.suppressed)


@pytest.mark.asyncio
async def test_stale_generation_audio_is_suppressed() -> None:
    """新しい世代が開始された後、旧 generation の翻訳音声は抑止される。"""
    h = _Harness()
    old = h.generations.begin()
    new = h.generations.begin()
    listeners = _listeners(("u1", "en", True, True))

    report = await h.manager.handle(
        TranslatedAudioCommand(
            speaker_id="spk",
            source_language="ja",
            target_language="en",
            audio=b"OLD",
            listeners=listeners,
            generation_id=old,
        )
    )

    assert h.adapter.audio == []
    assert any(s.reason == "stale_generation" for s in report.suppressed)

    await h.manager.handle(
        TranslatedAudioCommand(
            speaker_id="spk",
            source_language="ja",
            target_language="en",
            audio=b"NEW",
            listeners=listeners,
            generation_id=new,
        )
    )
    assert h.adapter.audio == [("spk", "en", b"NEW", ["u1"], new)]


@pytest.mark.asyncio
async def test_individual_delivery_failure_is_isolated() -> None:
    """個別受信者への送信失敗は他受信者配信を止めず、報告に集約される。"""
    h = _Harness()
    h.adapter.fail_users.add("u1")
    listeners = _listeners(
        ("u1", "en", False, True),
        ("u2", "en", False, True),
    )

    report = await h.manager.handle(
        FinalSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id="utt-1",
            seq=1,
            original_text="text",
            source_language="ja",
            target_language="en",
            translated_text="en",
            mainline="reading",
            listeners=listeners,
        )
    )

    assert [item[0] for item in h.adapter.data] == ["u2"]
    assert len(report.failures) == 1
    assert report.failures[0].user_id == "u1"
    assert report.failures[0].channel == "subtitle"


@pytest.mark.asyncio
async def test_final_subtitle_ends_interim_revision_state() -> None:
    """確定字幕の配信後、同一発話の hearing stream は finalize され遅延 interim を拒否する。"""
    from app.ai_pipeline.revision_authority import (
        RevisionAuthority,
        RevisionStreamKey,
        StreamKind,
    )

    auth = RevisionAuthority()
    h = _Harness()
    h.manager = DefaultOutputManager(
        adapter=h.adapter,
        generation_gate=h.generations,
        revision_authority=auth,
    )
    listeners = _listeners(("u1", "en", True, True))
    utterance_id = auth.begin("room-1", "spk", utterance_id="utt-1")
    stream = RevisionStreamKey(kind=StreamKind.HEARING_TRANSCRIPT, language="en")
    token = auth.advance("room-1", "spk", utterance_id, stream)

    interim_report = await h.manager.handle(
        InterimSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id=utterance_id,
            seq=1,
            target_language="en",
            text="hel",
            listeners=listeners,
            generation_id=1,
            revision=token.revision,
            stream_kind=StreamKind.HEARING_TRANSCRIPT.value,
        )
    )
    assert interim_report.delivered_revisions == (1,)
    assert h.adapter.data[0][2]["type"] == "subtitle_interim"
    assert h.adapter.data[0][2]["revision"] == 1

    await h.manager.handle(
        FinalSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id=utterance_id,
            seq=1,
            original_text="hello",
            source_language="ja",
            target_language="en",
            translated_text="hello",
            mainline="hearing",
            listeners=listeners,
            generation_id=1,
        )
    )

    # 確定後の遅延 interim は配信前に拒否される（再採番再開ではない）
    h.adapter.data.clear()
    delayed = await h.manager.handle(
        InterimSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id=utterance_id,
            seq=2,
            target_language="en",
            text="next",
            listeners=listeners,
            generation_id=2,
            revision=token.revision,
            stream_kind=StreamKind.HEARING_TRANSCRIPT.value,
        )
    )
    assert delayed.delivered_revisions == ()
    assert h.adapter.data == []


@pytest.mark.asyncio
async def test_quality_event_consumes_qoe_decision_flags_without_recompute() -> None:
    """QoE decision の可否フラグを再計算せず品質イベントへ写像する。"""
    h = _Harness()
    listeners = _listeners(("u1", "en", True, True))
    decision = QoEDecision(
        state=QoEState.HEARING_DEGRADED,
        primary_reason=QoEReason.AI_HEARING_DEGRADED,
        auxiliary_reasons=(),
        hearing_available=False,
        reading_available=True,
        partial_available=True,
        changed=True,
        scope=QoEScope.SERVER,
        ui_reason=QoEUiReason.DEGRADED,
    )

    await h.manager.handle(
        QualityEventCommand(
            room_id="room-1",
            speaker_id="spk",
            utterance_id="utt-1",
            seq=1,
            generation_id=1,
            listeners=listeners,
            decision=decision,
        )
    )

    assert len(h.adapter.data) == 1
    user_id, topic, payload = h.adapter.data[0]
    assert (user_id, topic) == ("u1", TOPIC_EVENT)
    assert payload["type"] == "qoe_degraded"
    assert payload["should_fallback_to_subtitle"] is True
    assert payload["reason_code"] == QoEReason.AI_HEARING_DEGRADED.value
    assert payload["schema_version"] == SCHEMA_VERSION
    # encoder 経由のため任意辞書ではなく契約適合イベントであること
    assert "original_text" not in payload


@pytest.mark.asyncio
async def test_audio_recipients_are_deduped_per_language_track() -> None:
    """同一目標言語の複数受聴者へは言語トラック単位で 1 回だけ publish する。"""
    h = _Harness()
    gen = h.generations.begin()
    listeners = _listeners(
        ("u1", "en", True, True),
        ("u2", "en", True, True),
        ("u3", "en", False, True),
    )

    await h.manager.handle(
        TranslatedAudioCommand(
            speaker_id="spk",
            source_language="ja",
            target_language="en",
            audio=b"AUDIO",
            listeners=listeners,
            generation_id=gen,
        )
    )

    assert h.adapter.audio == [
        ("spk", "en", b"AUDIO", ["u1", "u2"], gen),
    ]


@pytest.mark.asyncio
async def test_transport_receives_encoded_events_not_raw_command_dicts() -> None:
    """adapter へ渡るのは encoder 済みイベントであり、command 生辞書ではない。"""
    h = _Harness()
    listeners = _listeners(("u1", "en", False, True))

    await h.manager.handle(
        FinalSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id="utt-1",
            seq=1,
            original_text="こんにちは",
            source_language="ja",
            target_language="en",
            translated_text="Hello",
            mainline="reading",
            listeners=listeners,
        )
    )

    raw = h.adapter.raw_payloads[0]
    assert isinstance(raw, (bytes, bytearray))
    # Recording adapter は decode 済み dict も保持するが、生入力は bytes
    assert b'"type":"subtitle"' in raw or b'"type": "subtitle"' in raw


def test_output_command_variants_cover_partial_and_interrupted() -> None:
    """partial ASR と割込みイベントにも専用の型付き命令を公開する。"""
    assert hasattr(output_manager_module, "PartialSubtitleCommand")
    assert hasattr(output_manager_module, "InterruptedEventCommand")


def test_output_command_variants_cover_qos_warning() -> None:
    """§9 qos_warning にも専用の型付き命令を公開する。"""
    assert hasattr(output_manager_module, "QosWarningCommand")


@pytest.mark.asyncio
async def test_partial_asr_uses_canonical_encoder_and_isolates_failure() -> None:
    """partial ASR は canonical 字幕契約で配信し、個別失敗を隔離する。"""
    h = _Harness()
    h.adapter.fail_users.add("u1")
    listeners = _listeners(
        ("u1", "en", False, True),
        ("u2", "en", False, True),
        ("u3", "en", False, False),
    )

    report = await h.manager.handle(
        PartialSubtitleCommand(
            room_id="room-1",
            speaker_id="spk",
            subtitle_id="utt-1",
            seq=3,
            original_text="hello wor",
            source_language="en",
            target_language="en",
            listeners=listeners,
            revision=4,
            generation_id=2,
            trace_id="trace-1",
            model_id="asr-1",
        )
    )

    assert [item[0] for item in h.adapter.data] == ["u2"]
    payload = h.adapter.data[0][2]
    assert payload["type"] == "subtitle"
    assert payload["original_text"] == "hello wor"
    assert payload["translated_text"] is None
    assert payload["is_partial"] is True
    assert payload["is_final"] is False
    assert payload["revision"] == 4
    assert payload["schema_version"] == SCHEMA_VERSION
    assert [failure.user_id for failure in report.failures] == ["u1"]
    assert any(item.user_id == "u3" for item in report.suppressed)


@pytest.mark.asyncio
async def test_interrupted_event_is_encoded_and_failure_isolated() -> None:
    """割込みイベントは canonical encoder 経由で受信者ごとに配信する。"""
    h = _Harness()
    h.adapter.fail_users.add("u1")
    listeners = _listeners(
        ("u1", "en", True, True),
        ("u2", "en", True, True),
    )

    report = await h.manager.handle(
        InterruptedEventCommand(
            room_id="room-1",
            speaker_id="spk",
            utterance_id="utt-1",
            seq=5,
            generation_id=7,
            listeners=listeners,
        )
    )

    assert [item[0] for item in h.adapter.data] == ["u2"]
    user_id, topic, payload = h.adapter.data[0]
    assert (user_id, topic) == ("u2", TOPIC_EVENT)
    assert payload["type"] == "translation_interrupted"
    assert payload["mainline"] == "hearing"
    assert payload["generation_id"] == 7
    assert payload["schema_version"] == SCHEMA_VERSION
    assert [failure.user_id for failure in report.failures] == ["u1"]


@pytest.mark.asyncio
async def test_qos_warning_uses_canonical_encoder_without_reevaluate() -> None:
    """qos_warning は評価済みフィールドを再判定せず canonical 配信する。"""
    h = _Harness()
    h.adapter.fail_users.add("u1")
    listeners = _listeners(
        ("u1", "en", True, True),
        ("u2", "en", True, True),
    )

    report = await h.manager.handle(
        QosWarningCommand(
            room_id="room-1",
            speaker_id="spk",
            utterance_id="utt-1",
            seq=3,
            generation_id=2,
            listeners=listeners,
            metric="latency_p95",
            should_fallback_to_subtitle=True,
            mainline="hearing",
            value_ms=1300.0,
            target_ms=1200.0,
        )
    )

    assert [item[0] for item in h.adapter.data] == ["u2"]
    user_id, topic, payload = h.adapter.data[0]
    assert (user_id, topic) == ("u2", TOPIC_EVENT)
    assert payload["type"] == "qos_warning"
    assert payload["metric"] == "latency_p95"
    assert payload["mainline"] == "hearing"
    assert payload["value_ms"] == 1300.0
    assert payload["target_ms"] == 1200.0
    assert payload["should_fallback_to_subtitle"] is True
    assert payload["schema_version"] == SCHEMA_VERSION
    assert [failure.user_id for failure in report.failures] == ["u1"]


@pytest.mark.asyncio
async def test_partial_asr_preserves_authority_revision_and_rejects_stale() -> None:
    """partial ASR は authority の最新 revision だけを再採番せず配信する。"""
    from app.ai_pipeline.revision_authority import (
        RevisionAuthority,
        RevisionStreamKey,
        StreamKind,
    )

    authority = RevisionAuthority()
    adapter = RecordingTransportAdapter()
    manager = DefaultOutputManager(
        adapter=adapter,
        revision_authority=authority,
    )
    utterance_id = authority.begin("room-1", "spk", utterance_id="utt-1")
    stream = RevisionStreamKey(kind=StreamKind.PARTIAL_ASR)
    stale = authority.advance("room-1", "spk", utterance_id, stream)
    latest = authority.advance("room-1", "spk", utterance_id, stream)
    common = {
        "room_id": "room-1",
        "speaker_id": "spk",
        "subtitle_id": utterance_id,
        "seq": 0,
        "original_text": "hello",
        "source_language": "en",
        "target_language": "en",
        "listeners": _listeners(("u1", "en", False, True)),
    }

    stale_report = await manager.handle(
        PartialSubtitleCommand(revision=stale.revision, **common)
    )
    latest_report = await manager.handle(
        PartialSubtitleCommand(revision=latest.revision, **common)
    )

    assert stale_report.delivered_revisions == ()
    assert latest_report.delivered_revisions == (latest.revision,)
    assert adapter.data[0][2]["revision"] == latest.revision
