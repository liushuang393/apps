"""LiveKit DataChannel へ送る共通イベント契約。"""

import json
import time
import uuid
from collections.abc import Mapping

from app.ai_pipeline.event_contract import SCHEMA_VERSION, validate_event


def envelope_event(
    payload: Mapping[str, object],
    *,
    room_id: str,
    speaker_id: str = "",
    utterance_id: str = "",
    generation_id: int = 0,
    sequence_id: int = 0,
    revision: int = 0,
    runtime: str = "native",
) -> dict[str, object]:
    """既存payloadへ追跡情報を加え、canonical契約への適合を検証する。"""
    event = {
        **payload,
        "schema_version": SCHEMA_VERSION,
        "event_id": str(uuid.uuid4()),
        "room_id": room_id,
        "speaker_id": speaker_id or payload.get("speaker_id", ""),
        "utterance_id": utterance_id,
        "generation_id": generation_id,
        "sequence_id": sequence_id,
        "revision": revision,
        "runtime": runtime,
        "trace_id": payload.get("trace_id") or f"{room_id}:{speaker_id}:{sequence_id}",
        "timestamp_ms": int(time.time() * 1000),
    }
    validate_event(event)
    return event


def encode_event(event: Mapping[str, object]) -> bytes:
    """型付き公開イベントを検証し、DataChannel用UTF-8 JSONへ変換する。"""
    validate_event(event)
    return json.dumps(event, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
