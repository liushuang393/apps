"""共通 DataChannel イベント契約を検証する。"""

import json
import subprocess
from pathlib import Path

import pytest

from app.ai_pipeline.event_contract import render_typescript_contract
from app.ai_pipeline.events import SCHEMA_VERSION, encode_event, envelope_event

_REPOSITORY_ROOT = Path(__file__).resolve().parents[2]
_FIXTURES = json.loads(
    (Path(__file__).parent / "fixtures" / "live_events_v1.json").read_text(
        encoding="utf-8"
    )
)
_GENERATED_CONTRACT = (
    _REPOSITORY_ROOT / "frontend" / "src" / "contracts" / "liveEvent.generated.ts"
)
_CLIENT_DECODER = (
    _REPOSITORY_ROOT / "frontend" / "src" / "contracts" / "decodeLiveEvent.ts"
)


def test_envelope_adds_tracking_fields_without_removing_payload() -> None:
    event = envelope_event(
        {
            "type": "subtitle",
            "id": "sub-1",
            "seq": 3,
            "original_text": "こんにちは",
            "source_language": "ja",
            "is_final": True,
        },
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


def test_generated_client_contract_matches_canonical_schema() -> None:
    """クライアント生成物がサーバ側 canonical schema と一致する。"""
    assert (
        _GENERATED_CONTRACT.read_text(encoding="utf-8") == render_typescript_contract()
    )


def test_server_encoder_round_trips_shared_fixtures_through_client_decoder() -> None:
    """同じ fixture をサーバで encode し、クライアント境界で decode する。"""
    valid_events = [
        json.loads(encode_event(case["event"])) for case in _FIXTURES["valid"]
    ]
    client_input = {
        "valid": valid_events,
        "legacy": [case["event"] for case in _FIXTURES["legacy_valid"]],
        "invalid": [case["event"] for case in _FIXTURES["invalid"]],
    }
    script = f"""
import {{ decodeLiveEvent }} from {json.dumps(_CLIENT_DECODER.as_uri())};
let input = "";
for await (const chunk of process.stdin) input += chunk;
const fixtures = JSON.parse(input);
const result = {{
  valid: fixtures.valid.map((event) => decodeLiveEvent(event)?.type ?? null),
  legacy: fixtures.legacy.map((event) => decodeLiveEvent(event)?.type ?? null),
  invalid: fixtures.invalid.map((event) => decodeLiveEvent(event)?.type ?? null),
}};
process.stdout.write(JSON.stringify(result));
"""
    completed = subprocess.run(
        [
            "node",
            "--experimental-strip-types",
            "--input-type=module",
            "--eval",
            script,
        ],
        input=json.dumps(client_input, ensure_ascii=False),
        text=True,
        capture_output=True,
        check=True,
    )
    decoded = json.loads(completed.stdout)

    assert decoded["valid"] == [case["name"] for case in _FIXTURES["valid"]]
    assert decoded["legacy"] == ["subtitle"]
    assert decoded["invalid"] == [None] * len(_FIXTURES["invalid"])


@pytest.mark.parametrize("case", _FIXTURES["invalid"], ids=lambda case: case["name"])
def test_server_encoder_rejects_invalid_contract_event(case: dict) -> None:
    """不正・未知・機密本文付きイベントを送信前に拒否する。"""
    with pytest.raises(ValueError):
        encode_event(case["event"])
