"""DataChannel 公開イベントの canonical schema と生成処理。"""

from __future__ import annotations

import json
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Final

SCHEMA_VERSION: Final = 1

_COMMON_FIELDS: Final = {
    "schema_version": "integer",
    "type": "string",
    "event_id": "string",
    "timestamp_ms": "integer",
    "room_id": "string",
    "speaker_id": "string",
    "utterance_id": "string",
    "generation_id": "integer",
    "sequence_id": "integer",
    "revision": "integer",
    "runtime": "string",
    "trace_id": "string",
}

_DIAGNOSTIC_FORBIDDEN_FIELDS: Final = [
    "original_text",
    "translated_text",
    "text",
    "token",
    "authorization",
    "api_key",
    "openai_api_key",
    "deepgram_api_key",
]

EVENT_CONTRACT: Final = {
    "schema_version": SCHEMA_VERSION,
    "common": _COMMON_FIELDS,
    "events": {
        "subtitle": {
            "required": {
                "id": "string",
                "seq": "integer",
                "original_text": "string",
                "source_language": "string",
                "is_final": "boolean",
            },
            "optional": {
                "translated_text": "nullable_string",
                "target_language": "string",
                "is_translated": "boolean",
                "is_partial": "boolean",
                "degraded": "boolean",
                "mainline": "string",
                "provider": "nullable_string",
                "model_id": "nullable_string",
                "speaker_label": "nullable_string",
            },
            "forbidden": [],
        },
        "subtitle_interim": {
            "required": {
                "id": "string",
                "seq": "integer",
                "text": "string",
                "is_final": "boolean",
            },
            "optional": {},
            "forbidden": [],
        },
        "qos_warning": {
            "required": {
                "metric": "string",
                "should_fallback_to_subtitle": "boolean",
            },
            "optional": {
                "mainline": "string",
                "value": "number",
                "value_ms": "number",
                "target": "number",
                "target_ms": "number",
            },
            "forbidden": _DIAGNOSTIC_FORBIDDEN_FIELDS,
        },
        "qoe_degraded": {
            "required": {
                "metric": "string",
                "mainline": "string",
                "should_fallback_to_subtitle": "boolean",
            },
            "optional": {
                "reason_code": "string",
                "ui_reason": "string",
            },
            "forbidden": _DIAGNOSTIC_FORBIDDEN_FIELDS,
        },
        "qoe_recovered": {
            "required": {
                "metric": "string",
                "mainline": "string",
                "should_fallback_to_subtitle": "boolean",
            },
            "optional": {},
            "forbidden": _DIAGNOSTIC_FORBIDDEN_FIELDS,
        },
        "overload_degraded": {
            "required": {
                "metric": "string",
                "mainline": "string",
                "should_fallback_to_subtitle": "boolean",
            },
            "optional": {
                "reason_code": "string",
                "ui_reason": "string",
            },
            "forbidden": _DIAGNOSTIC_FORBIDDEN_FIELDS,
        },
        "translation_interrupted": {
            "required": {
                "mainline": "string",
            },
            "optional": {},
            "forbidden": _DIAGNOSTIC_FORBIDDEN_FIELDS,
        },
    },
}

_TYPESCRIPT_TYPES: Final = {
    "string": "string",
    "nullable_string": "string | null",
    "integer": "number",
    "number": "number",
    "boolean": "boolean",
}


class EventContractError(ValueError):
    """公開イベントがcanonical契約へ適合しないことを示す。"""


def _matches_kind(value: object, kind: str) -> bool:
    """値がcanonical schemaのプリミティブ型へ適合するか判定する。"""
    if kind == "string":
        return isinstance(value, str)
    if kind == "nullable_string":
        return value is None or isinstance(value, str)
    if kind == "boolean":
        return isinstance(value, bool)
    if kind == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if kind == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    raise RuntimeError(f"未対応の契約型です: {kind}")


def _validate_fields(
    event: Mapping[str, object],
    fields: Mapping[str, str],
    *,
    required: bool,
) -> None:
    """必須または任意フィールドの存在と値型を検証する。"""
    for field, kind in fields.items():
        if field not in event:
            if required:
                raise EventContractError(f"必須フィールドがありません: {field}")
            continue
        if not _matches_kind(event[field], kind):
            raise EventContractError(f"フィールド型が不正です: {field} ({kind})")


def validate_event(event: Mapping[str, object]) -> None:
    """version 1公開イベントを検証し、不正時は送信前に例外を送出する。"""
    if event.get("schema_version") != SCHEMA_VERSION:
        raise EventContractError("未知のschema versionです")
    event_type = event.get("type")
    if not isinstance(event_type, str):
        raise EventContractError("event typeが文字列ではありません")
    definition = EVENT_CONTRACT["events"].get(event_type)
    if definition is None:
        raise EventContractError(f"未知のevent typeです: {event_type}")

    _validate_fields(event, _COMMON_FIELDS, required=True)
    _validate_fields(event, definition["required"], required=True)
    _validate_fields(event, definition["optional"], required=False)
    forbidden = set(definition["forbidden"])
    included_forbidden = forbidden.intersection(event)
    if included_forbidden:
        fields = ", ".join(sorted(included_forbidden))
        raise EventContractError(f"診断イベントの禁止フィールドです: {fields}")


def _typescript_interface_name(event_type: str) -> str:
    """wire event type を生成TypeScriptのinterface名へ変換する。"""
    return "".join(part.capitalize() for part in event_type.split("_")) + "Event"


def render_typescript_contract() -> str:
    """canonical schema からクライアント用の型とvalidator定義を生成する。"""
    contract_json = json.dumps(
        EVENT_CONTRACT,
        ensure_ascii=False,
        separators=(",", ":"),
    )
    event_types = list(EVENT_CONTRACT["events"])
    lines = [
        "/**",
        " * 自動生成ファイル。直接編集しないこと。",
        " * 生成元: backend/app/ai_pipeline/event_contract.py",
        " */",
        f"export const LIVE_EVENT_SCHEMA_VERSION = {SCHEMA_VERSION} as const;",
        "",
        f"export const LIVE_EVENT_CONTRACT = {contract_json} as const;",
        "",
        "export type LiveEventType = keyof typeof LIVE_EVENT_CONTRACT.events;",
        "",
        "export interface LiveEventEnvelope {",
    ]
    for field, kind in _COMMON_FIELDS.items():
        field_type = (
            "typeof LIVE_EVENT_SCHEMA_VERSION"
            if field == "schema_version"
            else "LiveEventType"
            if field == "type"
            else _TYPESCRIPT_TYPES[kind]
        )
        lines.append(f"  {field}: {field_type};")
    lines.extend(["}", ""])

    for event_type, definition in EVENT_CONTRACT["events"].items():
        interface_name = _typescript_interface_name(event_type)
        lines.extend(
            [
                f"export interface {interface_name} extends LiveEventEnvelope {{",
                f"  type: '{event_type}';",
            ]
        )
        for field, kind in definition["required"].items():
            lines.append(f"  {field}: {_TYPESCRIPT_TYPES[kind]};")
        for field, kind in definition["optional"].items():
            lines.append(f"  {field}?: {_TYPESCRIPT_TYPES[kind]};")
        lines.extend(["}", ""])

    union = "\n  | ".join(_typescript_interface_name(name) for name in event_types)
    lines.extend(["export type LiveEvent =", f"  | {union};", ""])
    return "\n".join(lines)


def _main() -> None:
    """指定先へTypeScript契約生成物を書き出す。"""
    if len(sys.argv) != 2:
        raise SystemExit("出力先を1つ指定してください")
    Path(sys.argv[1]).write_text(render_typescript_contract(), encoding="utf-8")


if __name__ == "__main__":
    _main()
