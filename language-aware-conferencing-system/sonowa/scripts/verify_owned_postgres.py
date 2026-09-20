#!/usr/bin/env python3
"""専用PostgreSQLの実マイグレーション・改変拒否・2回の復元を検証する。

入力: owned_postgres.py create が生成した専用状態。
出力: 非秘密の証拠JSON。成功・失敗のいずれでも専用コンテナだけを破棄する。
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import logging
import os
import time
from pathlib import Path

logger = logging.getLogger(__name__)
ROOT = Path(__file__).resolve().parents[1]


def verify(output: Path) -> int:
    """実DBの行と追加テーブルを変え、全体復元と拒否経路を観測する。"""
    spec = importlib.util.spec_from_file_location(
        "owned_postgres", ROOT / "e2e/scripts/owned_postgres.py"
    )
    assert spec and spec.loader
    owned = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owned)
    state = owned.load_state()
    previous_url = os.environ.get("E2E_DB_URL")
    os.environ["E2E_DB_URL"] = owned.jdbc_url(state)
    report: dict[str, object] = {
        "passed": False,
        "backend_image": state["backend_image"],
        "postgres_image": state["postgres_image"],
        "container_id": state["container_id"],
        "rounds": [],
        "cleanup_complete": False,
    }
    rounds: list[dict[str, object]] = []
    report["rounds"] = rounds
    started = time.monotonic()
    try:
        report["identity"] = owned.check_target(state)
        os.environ["E2E_DB_URL"] = "jdbc:postgresql://127.0.0.1:5432/sonowa"
        try:
            owned.sql(state, "SELECT 1;")
        except ValueError:
            report["wrong_database_rejected"] = True
        else:
            raise AssertionError("異なるDBのURLを拒否しなかった")
        finally:
            os.environ["E2E_DB_URL"] = owned.jdbc_url(state)
        owned.reset(state)
        report["migration"] = owned.sql(
            state, "SELECT version_num FROM alembic_version;"
        )
        table_query = (
            "SELECT schemaname || '.' || tablename FROM pg_tables "
            "WHERE left(schemaname, 3) <> 'pg_' AND schemaname <> 'information_schema' "
            "ORDER BY schemaname, tablename;"
        )
        owned.sql(
            state,
            "CREATE TABLE certification_restore_probe (id integer PRIMARY KEY, value text);"
            "INSERT INTO certification_restore_probe VALUES (1, 'baseline');",
        )
        tables_before = owned.sql(state, table_query)
        assert (
            "public.users" in tables_before.splitlines()
        ), "製品マイグレーションが未実行"
        report["table_count"] = len(tables_before.splitlines())
        owned.snapshot(state)
        snapshot = owned.SNAPSHOT.read_bytes()
        report["snapshot_sha256"] = hashlib.sha256(snapshot).hexdigest()
        owned.write_private(owned.SNAPSHOT, snapshot + b"tamper")
        try:
            owned.restore(state)
        except ValueError:
            report["tampered_snapshot_rejected"] = True
        else:
            raise AssertionError("改変したダンプを拒否しなかった")
        finally:
            owned.write_private(owned.SNAPSHOT, snapshot)
        for number in (1, 2):
            owned.sql(
                state,
                "UPDATE certification_restore_probe SET value='mutated' WHERE id=1;"
                "INSERT INTO certification_restore_probe VALUES (2, 'added');"
                "CREATE TABLE certification_after_snapshot (id integer);"
                "CREATE SCHEMA pga; CREATE TABLE pga.after_snapshot (id integer);",
            )
            mutated = owned.sql(
                state, "SELECT count(*) FROM certification_restore_probe;"
            )
            assert mutated == "2", "復元前の改変が成立していない"
            owned.restore(state)
            rows = owned.sql(
                state,
                "SELECT id || ':' || value FROM certification_restore_probe ORDER BY id;",
            )
            tables = owned.sql(state, table_query)
            result = {
                "round": number,
                "baseline_rows_restored": rows == "1:baseline",
                "schema_restored": tables == tables_before,
                "tables_sha256": hashlib.sha256(tables.encode()).hexdigest(),
            }
            rounds.append(result)
            assert result["baseline_rows_restored"], "DB行が基準状態へ復元されていない"
            assert result["schema_restored"], "追加テーブルが復元後も残っている"
        report["passed"] = len(rounds) == 2
    except Exception as exc:
        report["error"] = str(exc)
        logger.exception("専用DBの実機検証に失敗")
    finally:
        try:
            owned.check_target(state)
            owned.docker(["rm", "-f", state["container_id"]])
            remaining = owned.docker(
                ["ps", "-a", "-q", "--filter", f"id={state['container_id']}"]
            ).strip()
            assert not remaining, "専用DBコンテナが残っている"
            owned.STATE.unlink()
            report["cleanup_complete"] = True
        except Exception as exc:
            report["passed"] = False
            report["cleanup_error"] = str(exc)
        if previous_url is None:
            os.environ.pop("E2E_DB_URL", None)
        else:
            os.environ["E2E_DB_URL"] = previous_url
        report["duration_s"] = time.monotonic() - started
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if report["passed"] else 1


def main() -> int:
    """専用DBの実機証拠を指定パスへ保存する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    return verify(args.output)


if __name__ == "__main__":
    raise SystemExit(main())
