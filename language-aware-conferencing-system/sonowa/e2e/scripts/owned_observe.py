#!/usr/bin/env python3
"""専用ランタイムのブラウザー実行・実DB・外部通信遮断を独立に照合する。

認証/部屋作成の部分検証であり、音声品質やTesting Kit総合認証を合格にしない。
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from owned_runtime import ROOT, load_state, postgres, resources

EXPECTED_SCENARIOS = {
    "CERT-AUTH-USER",
    "CERT-AUTH-ADMIN",
    "CERT-AUTH-MODERATOR",
    "CERT-ROOM-CREATE",
}
NETWORK_PROBE = """
import errno, json, socket, sys
routes = open('/proc/net/route').read().splitlines()[1:]
defaults = [row for row in routes if row.split()[1] == '00000000']
connection = socket.socket()
connection.settimeout(2)
error = connection.connect_ex(('1.1.1.1', 443))
connection.close()
sys.stdout.write(json.dumps({'default_route_count': len(defaults),
    'external_connect_errno': error, 'blocked': not defaults and error == errno.ENETUNREACH}))
"""


def browser_results(report: dict) -> list[dict]:
    """空・skip・失敗を含む実行結果を受け入れず、実行済み4シナリオを返す。"""
    if report.get("errors"):
        raise ValueError("Playwright reported global errors")
    results: list[dict] = []

    def visit(suite: dict) -> None:
        """レポートの階層を走査し、実際に実行した結果だけを数える。"""
        for spec in suite.get("specs", []):
            for test in spec.get("tests", []):
                runs = test.get("results", [])
                if len(runs) != 1 or runs[0].get("status") != "passed":
                    raise ValueError(
                        "Playwright execution was skipped, retried or failed"
                    )
                results.append({"title": spec["title"], "status": runs[0]["status"]})
        for child in suite.get("suites", []):
            visit(child)

    visit(report)
    if len(results) != len(EXPECTED_SCENARIOS) or any(
        sum(f"[{scenario}]" in r["title"] for r in results) != 1
        for scenario in EXPECTED_SCENARIOS
    ):
        raise ValueError("required browser scenarios were not all executed")
    return results


def main() -> int:
    """変更前後のDB行数と、実ブラウザーの全結果を指定ファイルへ保存する。"""
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "phase", choices=["round1", "restored", "round2", "cleanup-restored"]
    )
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    state = load_state()
    db = postgres()
    db_state = db.load_state()
    values = json.loads(
        db.sql(
            db_state,
            "SELECT json_build_object('room_count', (SELECT count(*) FROM rooms), "
            "'user_count', (SELECT count(*) FROM users), 'migration', "
            "(SELECT version_num FROM alembic_version), 'seed_owner', "
            "(SELECT owner_id FROM certification_identity));",
        )
    )
    restored = args.phase in {"restored", "cleanup-restored"}
    if (
        values["room_count"] != (0 if restored else 1)
        or values["user_count"] != 3
        or values["seed_owner"] != state["owner_id"]
    ):
        raise ValueError("database observation differs from the expected round state")
    result = {
        "phase": args.phase,
        "passed": True,
        "database": values,
        "images": state["images"],
        "scope": "authentication and room creation only; certification incomplete",
    }
    if not restored:
        path = ROOT / "e2e/report/certification-results.json"
        result["browser"] = browser_results(json.loads(path.read_text()))
        result["browser_report_sha256"] = hashlib.sha256(path.read_bytes()).hexdigest()
        _, containers = resources(state)
        backend = next(
            c
            for c in containers
            if c["Config"]["Labels"]["sonowa.certification.role"] == "backend"
        )
        probe = json.loads(
            db.docker(["exec", backend["Id"], "python", "-c", NETWORK_PROBE])
        )
        if probe["blocked"] is not True:
            raise ValueError("model container has an external network route")
        result["network"] = probe
        result["backend_container"] = backend["Id"]
        result["source_sha256"] = {
            name: hashlib.sha256((ROOT / name).read_bytes()).hexdigest()
            for name in [
                "docker-compose.certification.yml",
                "e2e/certification-nginx.conf",
                "e2e/scripts/owned_runtime.py",
                "e2e/scripts/owned_postgres.py",
                "e2e/scripts/certification_app.py",
                "e2e/scripts/certification_seed.py",
                "e2e/playwright.certification.config.ts",
                "e2e/certification/auth.spec.ts",
                "e2e/certification/room.spec.ts",
            ]
        }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
