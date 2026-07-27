"""共通 DataChannel イベント契約を検証する。"""

from app.ai_pipeline.events import SCHEMA_VERSION, envelope_event


def test_envelope_adds_tracking_fields_without_removing_payload() -> None:
    event = envelope_event(
        {"type": "subtitle", "id": "sub-1", "seq": 3},
        room_id="room-1",
        speaker_id="speaker-1",
        utterance_id="utt-1",
        generation_id=2,
        sequence_id=3,
    )

    assert event["schema_version"] == SCHEMA_VERSION
    assert event["id"] == "sub-1"
    assert event["utterance_id"] == "utt-1"
    assert event["generation_id"] == 2
