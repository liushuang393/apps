"""LiveKit DataChannel へ送る共通イベント契約。"""

import time
import uuid

SCHEMA_VERSION = 1


def envelope_event(
    payload: dict,
    *,
    room_id: str,
    speaker_id: str = "",
    utterance_id: str = "",
    generation_id: int = 0,
    sequence_id: int = 0,
    revision: int = 0,
    runtime: str = "native",
) -> dict:
    """既存 payload を壊さず、追跡用フィールドを加算する。"""
    return {
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
