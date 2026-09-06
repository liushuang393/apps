"""seed fixture の共通 fail-closed 契約（kit-managed）。"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Never


if TYPE_CHECKING:
    from pathlib import Path


def _fail(message: str) -> Never:
    raise SystemExit(message)


def load_fixture(path: Path, app_name: str) -> dict[str, list[dict[str, object]]]:
    """実 row を 1 件以上含む fixture だけを正規化して返す。"""
    if not path.is_file():
        _fail(f"[{app_name}/seed] fixture が無い: {path}")
    try:
        raw: object = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        _fail(f"[{app_name}/seed] fixture JSON 不正: {path}: {exc}")
    if not isinstance(raw, dict):
        _fail(f"[{app_name}/seed] fixture は object: {path}")

    fixture: dict[str, list[dict[str, object]]] = {}
    for table, rows in raw.items():
        if not isinstance(table, str):
            _fail(f"[{app_name}/seed] table key は文字列: {path}")
        if table.startswith("_"):
            continue
        if not isinstance(rows, list):
            _fail(f"[{app_name}/seed] {table} は row list: {path}")
        normalized_rows: list[dict[str, object]] = []
        for index, row in enumerate(rows):
            if not isinstance(row, dict) or not row:
                _fail(f"[{app_name}/seed] {table}[{index}] は非空 object: {path}")
            if not all(isinstance(key, str) for key in row):
                _fail(f"[{app_name}/seed] {table}[{index}] の key は文字列: {path}")
            normalized_rows.append({key: value for key, value in row.items() if isinstance(key, str)})
        fixture[table] = normalized_rows

    row_count = sum(len(rows) for rows in fixture.values())
    if row_count == 0:
        _fail(f"[{app_name}/seed] 空 fixture は成功扱いにできない: {path}")
    return fixture
