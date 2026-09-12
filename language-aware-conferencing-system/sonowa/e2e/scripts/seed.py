"""Sonowa MVP シナリオ seed CLI (testing-kit テンプレから生成)。"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path
from typing import Any

from seed_contract import load_fixture


try:
    import sqlalchemy
    from sqlalchemy import text
except ImportError:
    sqlalchemy = None  # type: ignore[assignment]
    text = None  # type: ignore[assignment]

APP_NAME = "sonowa"
APP_E2E_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FIXTURES_DIR = APP_E2E_ROOT / "fixtures" / "scenarios"


def _seed(url: str, fixture: dict[str, list[dict[str, Any]]]) -> None:
    if sqlalchemy is None or text is None:
        message = f"[{APP_NAME}/seed] sqlalchemy 未導入"
        raise SystemExit(message)
    engine = sqlalchemy.create_engine(url)
    with engine.begin() as conn:
        for table, rows in fixture.items():
            for row in rows:
                cols = ", ".join(row.keys())
                placeholders = ", ".join(f":{k}" for k in row)
                stmt = text(f"INSERT INTO {table} ({cols}) VALUES ({placeholders}) ON CONFLICT DO NOTHING")
                conn.execute(stmt, row)
    print(f"[{APP_NAME}/seed] 投入完了 ({len(fixture)} テーブル)")


def main() -> int:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} シナリオ seed")
    parser.add_argument("--name", default=None)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--fixtures-dir", type=Path, default=DEFAULT_FIXTURES_DIR)
    args = parser.parse_args()

    url = os.environ.get("E2E_DB_URL")
    if not url:
        print(f"[{APP_NAME}/seed] FAIL: E2E_DB_URL 未設定", file=sys.stderr)
        return 2

    if args.all:
        targets = sorted(args.fixtures_dir.glob("*.json"))
    elif args.name:
        targets = [args.fixtures_dir / f"{args.name}.json"]
    else:
        print(f"[{APP_NAME}/seed] --name または --all 必要", file=sys.stderr)
        return 2
    if not targets:
        print(f"[{APP_NAME}/seed] fixture 無し", file=sys.stderr)
        return 3
    for target in targets:
        _seed(url, load_fixture(target, APP_NAME))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
