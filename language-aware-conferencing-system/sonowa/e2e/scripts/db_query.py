"""DB 構造化クエリヘルパ（helpers/db-assert.ts から呼ばれる）。"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys

APP_NAME = "sonowa"
SAFE_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


def _validate(name: str, kind: str) -> None:
    if not SAFE_NAME.match(name):
        raise SystemExit(f"[db_query] 不正な {kind} 名: {name}")


def _connect(url: str):
    if url.startswith("sqlite"):
        import sqlite3
        m = re.match(r"sqlite(?:\+\w+)?:///(?P<path>.+)$", url)
        if not m:
            raise SystemExit(f"sqlite URL 解釈不能: {url}")
        return sqlite3.connect(m.group("path")), "sqlite"
    if url.startswith(("postgres", "postgresql")):
        try:
            import psycopg2
        except ImportError:
            raise SystemExit("psycopg2 が必要")
        return psycopg2.connect(url), "postgres"
    raise SystemExit(f"未対応 URL: {url}")


def _build_where(where: dict, dialect: str):
    if not where:
        return "", []
    ph = "?" if dialect == "sqlite" else "%s"
    conds = []
    params = []
    for k, v in where.items():
        _validate(k, "カラム")
        conds.append(f"{k} = {ph}")
        params.append(v)
    return " WHERE " + " AND ".join(conds), params


def main() -> int:
    parser = argparse.ArgumentParser(description="DB 構造化クエリ")
    parser.add_argument("--op", required=True, choices=["count", "get"])
    parser.add_argument("--json", required=True)
    args = parser.parse_args()

    url = os.environ.get("E2E_DB_URL")
    if not url:
        print(f"[db_query] FAIL: E2E_DB_URL 未設定", file=sys.stderr)
        return 2

    payload = json.loads(args.json)
    conn, dialect = _connect(url)
    try:
        if args.op == "count":
            table = payload["table"]
            _validate(table, "テーブル")
            w_sql, w_params = _build_where(payload.get("where", {}), dialect)
            cur = conn.cursor()
            cur.execute(f"SELECT COUNT(*) FROM {table}{w_sql}", w_params)
            print(f"COUNT={cur.fetchone()[0]}")
        elif args.op == "get":
            table = payload["table"]
            column = payload["column"]
            _validate(table, "テーブル")
            _validate(column, "カラム")
            w_sql, w_params = _build_where(payload["where"], dialect)
            cur = conn.cursor()
            cur.execute(f"SELECT {column} FROM {table}{w_sql} LIMIT 1", w_params)
            row = cur.fetchone()
            if row is None:
                raise SystemExit(f"[db_query] 該当行なし")
            print(f"VALUE={json.dumps(row[0], default=str)}")
    finally:
        conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
