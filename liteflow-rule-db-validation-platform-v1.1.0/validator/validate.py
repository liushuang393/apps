#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import concurrent.futures
import datetime as dt
import json
import math
import os
import statistics
import sys
import time
import urllib.error
import urllib.request
import urllib.parse
import uuid
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

# /reports はコンテナのマウント先。REPORTS_DIR を指定すると同じvalidatorをホストでも実行できる。
REPORT_DIR = Path(os.getenv("REPORTS_DIR", "/reports"))
REPORT_JSON = REPORT_DIR / "validation-report.json"
REPORT_MD = REPORT_DIR / "validation-report.md"
STATE_JSON = REPORT_DIR / "validation-state.json"
BUILD_EVIDENCE_JSON = REPORT_DIR / "build-evidence.json"
BUILD_METADATA_JSON = REPORT_DIR / "build-metadata.json"
JUNIT_DIR = REPORT_DIR / "junit"

A = os.getenv("EXECUTOR_A_URL", "http://executor-a:8080")
B = os.getenv("EXECUTOR_B_URL", "http://executor-b:8080")
PROM = os.getenv("PROMETHEUS_URL", "http://prometheus:9090")
GRAFANA = os.getenv("GRAFANA_URL", "http://grafana:3000")
DASHBOARD_UID = os.getenv("GRAFANA_DASHBOARD_UID", "liteflow-rule-db-validation")

ACTIVE_REPORT: dict[str, Any] | None = None

V1_TRACE = ["validate", "analyze", "transform", "compile", "test", "qualityGate", "report"]
V2_TRACE = ["validate", "analyze", "transform", "compile", "test", "review", "qualityGate", "report"]
V1_EL = "THEN(validate,analyze,transform,compile,test,qualityGate,report)"
V2_EL = "THEN(validate,analyze,transform,compile,test,review,qualityGate,report)"
FAILURE_EL = "THEN(validate,forcedFailure,report)"

# 管理API（/api/rules/**）は SecurityConfig で保護されている。
# 実行API（/api/flows/**）と actuator は無認証のままなので、既存の検査はそのまま通る。
ADMIN_USER = os.getenv("ADMIN_USER", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")
APPROVER_USER = os.getenv("APPROVER_USER", "approver")
APPROVER_PASSWORD = os.getenv("APPROVER_PASSWORD", "approver123")
VIEWER_USER = os.getenv("VIEWER_USER", "viewer")
VIEWER_PASSWORD = os.getenv("VIEWER_PASSWORD", "viewer123")


def basic_auth(user: str, password: str) -> dict[str, str]:
    token = base64.b64encode(f"{user}:{password}".encode("utf-8")).decode("ascii")
    return {"Authorization": f"Basic {token}"}


ADMIN_AUTH = basic_auth(ADMIN_USER, ADMIN_PASSWORD)
APPROVER_AUTH = basic_auth(APPROVER_USER, APPROVER_PASSWORD)
VIEWER_AUTH = basic_auth(VIEWER_USER, VIEWER_PASSWORD)


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def http(method: str, url: str, body: Any = None, timeout: float = 10.0,
         extra_headers: dict[str, str] | None = None) -> tuple[int, Any, float]:
    data = None
    headers = {"Accept": "application/json"}
    if extra_headers:
        headers.update(extra_headers)
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url=url, data=data, headers=headers, method=method)
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read().decode("utf-8", errors="replace")
            status = response.status
    except urllib.error.HTTPError as error:
        raw = error.read().decode("utf-8", errors="replace")
        status = error.code
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    try:
        parsed: Any = json.loads(raw)
    except json.JSONDecodeError:
        parsed = raw
    return status, parsed, elapsed_ms


def wait_endpoint(url: str, timeout_seconds: float = 90.0) -> tuple[bool, Any]:
    deadline = time.time() + timeout_seconds
    last: Any = None
    while time.time() < deadline:
        try:
            status, body, _ = http("GET", url, timeout=4.0)
            last = body
            if 200 <= status < 300:
                return True, body
        except Exception as exc:  # noqa: BLE001
            last = repr(exc)
        time.sleep(1.0)
    return False, last


def publish(base: str, chain_id: str, el: str, expected_version: int | None) -> tuple[int, Any, float]:
    command = {"chainId": chain_id, "el": el}
    if expected_version is not None:
        command["expectedVersion"] = expected_version
    return http("POST", f"{base}/api/rules/chains", command, extra_headers=ADMIN_AUTH)


def execute(base: str, chain_id: str) -> tuple[int, Any, float]:
    return http("POST", f"{base}/api/flows/{chain_id}/execute", {"payload": "validation"})


def poll_trace(base: str, chain_id: str, expected: list[str], timeout_seconds: float = 15.0) -> tuple[bool, Any, float]:
    deadline = time.time() + timeout_seconds
    last: Any = None
    started = time.perf_counter()
    while time.time() < deadline:
        status, body, _ = execute(base, chain_id)
        last = body
        if status == 200 and isinstance(body, dict) and body.get("success") is True and body.get("trace") == expected:
            return True, body, (time.perf_counter() - started) * 1000.0
        time.sleep(0.2)
    return False, last, (time.perf_counter() - started) * 1000.0


def add_check(report: dict[str, Any], check_id: str, name: str, status: str,
              evidence: Any, duration_ms: float | None = None, required: bool = True) -> None:
    report["checks"].append({
        "id": check_id,
        "name": name,
        "status": status,
        "required": required,
        "durationMs": None if duration_ms is None else round(duration_ms, 2),
        "evidence": evidence,
    })


def summarize(report: dict[str, Any]) -> None:
    counts = {"PASS": 0, "FAIL": 0, "WARN": 0, "SKIP": 0}
    for check in report.get("checks", []):
        counts[check["status"]] = counts.get(check["status"], 0) + 1
    required_failures = [c for c in report.get("checks", []) if c.get("required", True) and c["status"] == "FAIL"]
    report["summary"] = counts
    report["overallStatus"] = "FAIL" if required_failures else ("WARN" if counts["WARN"] else "PASS")
    report["recommendation"] = (
        "REJECT_AND_FIX" if required_failures
        else "CONDITIONAL_CONTINUE" if counts["WARN"]
        else "CONTINUE_TO_DOMAIN_POC"
    )
    report["completedAt"] = utc_now()


def percentile(values: list[float], p: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, math.ceil(p * len(ordered)) - 1))
    return ordered[index]


def render_markdown(report: dict[str, Any]) -> str:
    summary = report.get("summary", {})
    lines = [
        "# LiteFlow v2.16.1 Rule-DB 実行検証レポート",
        "",
        f"- 実行ID: `{report.get('runId')}`",
        f"- 開始: {report.get('startedAt')}",
        f"- 完了: {report.get('completedAt')}",
        f"- 総合判定: **{report.get('overallStatus')}**",
        f"- 推奨アクション: **{report.get('recommendation')}**",
        f"- PASS: {summary.get('PASS', 0)} / FAIL: {summary.get('FAIL', 0)} / WARN: {summary.get('WARN', 0)} / SKIP: {summary.get('SKIP', 0)}",
        "",
        "## 重要な適用範囲",
        "",
        "このレポートが証明するのは、LiteFlow Rule-DBを利用したルール公開、複数ノード同期、動的更新、実行、監視、再起動後再ロードである。",
        "",
        "**COBOL構文解析、COBOLとJavaの意味同値性、Java生成精度、実業務の回帰品質は本検証の対象外であり、本結果からCOBOL→Java変換が容易であるとは判断しない。**",
        "",
        "## 検証結果",
        "",
        "| ID | 検証項目 | 判定 | 所要時間(ms) | 証跡概要 |",
        "|---|---|---:|---:|---|",
    ]
    for check in report.get("checks", []):
        evidence = json.dumps(check.get("evidence"), ensure_ascii=False, separators=(",", ":"))
        if len(evidence) > 220:
            evidence = evidence[:217] + "..."
        evidence = evidence.replace("|", "\\|").replace("\n", " ")
        duration = "-" if check.get("durationMs") is None else str(check["durationMs"])
        lines.append(f"| {check['id']} | {check['name']} | **{check['status']}** | {duration} | `{evidence}` |")

    lines += [
        "",
        "## 実測値",
        "",
        "```json",
        json.dumps(report.get("measurements", {}), ensure_ascii=False, indent=2),
        "```",
        "",
        "## 技術評価",
        "",
    ]
    if report.get("overallStatus") == "PASS":
        lines.append("本PoC条件では、LiteFlow v2.16.1 Rule-DBを動的オーケストレーション層として継続評価できる。")
    elif report.get("overallStatus") == "WARN":
        lines.append("必須項目は通過したが、警告項目について追加試験が必要である。")
    else:
        lines.append("必須検証に失敗しているため、本格評価へ進む前に原因修正と再実行が必要である。")

    lines += [
        "",
        "本番採用時は、RulePublisherの認証、承認ワークフロー、ルールBundle、Blue-Green、Actuator分離、秘密情報管理を追加すること。",
        "",
        "## 原始証跡",
        "",
        "完全なHTTP応答、version、sequence、Rule-DB snapshot、メトリクス名は同時生成された `validation-report.json` を参照する。",
    ]
    return "\n".join(lines) + "\n"


def save_report(report: dict[str, Any]) -> None:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    summarize(report)
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    REPORT_MD.write_text(render_markdown(report), encoding="utf-8")


def add_build_checks(report: dict[str, Any]) -> None:
    if not BUILD_EVIDENCE_JSON.exists():
        add_check(report, "BUILD-01", "Docker/Mavenビルド証跡", "FAIL",
                  {"reason": "build-evidence.json not found"})
        add_check(report, "BUILD-02", "LiteFlow 2.16.1依存解決経路", "FAIL",
                  {"reason": "build metadata unavailable"})
        add_check(report, "TEST-01", "JUnit統合テスト証跡", "FAIL",
                  {"reason": "JUnit evidence unavailable"})
        return

    try:
        evidence = json.loads(BUILD_EVIDENCE_JSON.read_text(encoding="utf-8-sig"))
        build_ok = evidence.get("status") == "PASS" and bool(evidence.get("imageId"))
        add_check(report, "BUILD-01", "Dockerイメージ構築とMaven verify",
                  "PASS" if build_ok else "FAIL", evidence)
    except Exception as exc:  # noqa: BLE001
        add_check(report, "BUILD-01", "Dockerイメージ構築とMaven verify", "FAIL",
                  {"reason": repr(exc)})

    if BUILD_METADATA_JSON.exists():
        try:
            metadata = json.loads(BUILD_METADATA_JSON.read_text(encoding="utf-8-sig"))
            mode_ok = metadata.get("resolutionMode") in {"maven-central", "official-source-build"}
            version_ok = metadata.get("liteflowVersion") == "2.16.1"
            add_check(report, "BUILD-02", "LiteFlow 2.16.1依存解決経路",
                      "PASS" if mode_ok and version_ok else "FAIL", metadata)
        except Exception as exc:  # noqa: BLE001
            add_check(report, "BUILD-02", "LiteFlow 2.16.1依存解決経路", "FAIL",
                      {"reason": repr(exc)})
    else:
        add_check(report, "BUILD-02", "LiteFlow 2.16.1依存解決経路", "FAIL",
                  {"reason": "build-metadata.json not found"})

    totals = {"files": 0, "tests": 0, "failures": 0, "errors": 0, "skipped": 0}
    parse_errors: list[str] = []
    for xml_file in sorted(JUNIT_DIR.glob("TEST-*.xml")):
        try:
            root = ET.parse(xml_file).getroot()
            totals["files"] += 1
            totals["tests"] += int(float(root.attrib.get("tests", 0)))
            totals["failures"] += int(float(root.attrib.get("failures", 0)))
            totals["errors"] += int(float(root.attrib.get("errors", 0)))
            totals["skipped"] += int(float(root.attrib.get("skipped", 0)))
        except Exception as exc:  # noqa: BLE001
            parse_errors.append(f"{xml_file.name}: {exc!r}")
    junit_ok = totals["files"] > 0 and totals["tests"] > 0 and totals["failures"] == 0 and totals["errors"] == 0 and not parse_errors
    add_check(report, "TEST-01", "JUnit Rule-DB統合テスト",
              "PASS" if junit_ok else "FAIL", {"summary": totals, "parseErrors": parse_errors})


def new_report(run_id: str) -> dict[str, Any]:
    return {
        "runId": run_id,
        "startedAt": utc_now(),
        "completedAt": None,
        "overallStatus": "RUNNING",
        "scope": {
            "validated": [
                "RulePublisher", "optimistic locking", "two-node convergence", "dynamic chain update",
                "failure chain", "concurrent execution", "restart persistence", "Actuator",
                "Prometheus", "Grafana"
            ],
            "notValidated": [
                "COBOL parser correctness", "COBOL-Java semantic equivalence", "generated Java quality",
                "business regression completeness"
            ]
        },
        "environment": {"executorA": A, "executorB": B, "prometheus": PROM, "grafana": GRAFANA},
        "checks": [],
        "measurements": {},
    }


def add_rule_admin_checks(report: dict[str, Any], run_id: str) -> None:
    """ルール管理基盤（シナリオ#3）の検査。

    LiteFlow は履歴を持たないので、履歴・差分・ロールバック・承認・監査は
    本アプリの rm_* テーブルが担っている。そこが実際に機能しているかを見る。
    認証は管理系（/api/rules/**）にだけ掛かっており、実行API と actuator は
    無認証のままである（そこを変えると既存の検査が一斉に落ちる）。
    """
    chain_id = f"gov_{run_id.replace('-', '')[:16]}"

    # RM-01: 無認証の管理APIは拒否される
    status, body, latency = http("GET", f"{A}/api/rules")
    add_check(report, "RM-01", "無認証の管理API拒否", "PASS" if status == 401 else "FAIL",
              {"httpStatus": status, "expected": 401}, latency)

    # RM-02: 実行APIは無認証のまま（既存32項目の前提を壊していない）
    status, _, latency = http("POST", f"{A}/api/flows/{chain_id}/execute", {"payload": "anon"})
    add_check(report, "RM-02", "実行APIは無認証のまま",
              "PASS" if status not in (401, 403) else "FAIL",
              {"httpStatus": status, "note": "401/403 でなければよい"}, latency)

    # RM-03: 参照専用ユーザーは書けない
    status, _, latency = http("POST", f"{A}/api/rules/chains",
                              {"chainId": chain_id, "el": V1_EL, "expectedVersion": 0},
                              extra_headers=VIEWER_AUTH)
    add_check(report, "RM-03", "参照専用ユーザーの書き込み拒否", "PASS" if status == 403 else "FAIL",
              {"httpStatus": status, "expected": 403}, latency)

    # RM-04: 発行するたびに履歴が残る
    v1 = http("POST", f"{A}/api/rules/chains",
              {"chainId": chain_id, "el": V1_EL, "expectedVersion": 0, "comment": "v1"},
              extra_headers=ADMIN_AUTH)[1]
    poll_trace(A, chain_id, V1_TRACE)
    v2 = http("POST", f"{A}/api/rules/chains",
              {"chainId": chain_id, "el": V2_EL, "expectedVersion": v1.get("version"), "comment": "v2"},
              extra_headers=ADMIN_AUTH)[1]
    poll_trace(A, chain_id, V2_TRACE)
    status, history, latency = http("GET", f"{A}/api/rules/CHAIN/{chain_id}/revisions",
                                    extra_headers=ADMIN_AUTH)
    recorded = history.get("count", 0) if isinstance(history, dict) else 0
    v1_version = v1.get("version") if isinstance(v1, dict) else None
    v2_version = v2.get("version") if isinstance(v2, dict) else None
    add_check(report, "RM-04", "発行ごとの履歴記録",
              "PASS" if recorded >= 2 and v1_version and v2_version else "FAIL",
              {"httpStatus": status, "revisions": recorded, "expectedAtLeast": 2,
               "v1": v1, "v2": v2}, latency)
    if not v1_version or not v2_version:
        # 発行できていないなら以降は成立しない。原因を1件だけ報告して打ち切る。
        for check_id, name in (("RM-05", "版間の差分"), ("RM-06", "ロールバックで旧版の挙動へ復帰"),
                               ("RM-07", "承認フロー（未承認は未反映／承認で反映）"),
                               ("RM-08", "監査ログ")):
            add_check(report, check_id, name, "FAIL",
                      {"skipped": "RM-04 で発行できなかったため判定不能", "v1": v1, "v2": v2})
        return

    # RM-05: 2版の差分が取れる
    status, diff, latency = http(
        "GET", f"{A}/api/rules/CHAIN/{chain_id}/diff?from={v1_version}&to={v2_version}",
        extra_headers=ADMIN_AUTH)
    changed = diff.get("changedLines", 0) if isinstance(diff, dict) else 0
    add_check(report, "RM-05", "版間の差分", "PASS" if status == 200 and changed > 0 else "FAIL",
              {"httpStatus": status, "changedLines": changed}, latency)

    # RM-06: ロールバックで Executor の挙動が旧版へ戻る（版番号は前へ進む）
    status, rollback, latency = http(
        "POST", f"{A}/api/rules/CHAIN/{chain_id}/rollback",
        {"toVersion": v1_version, "comment": "validator rollback"},
        extra_headers=ADMIN_AUTH)
    reverted, _, _ = poll_trace(A, chain_id, V1_TRACE)
    forward = (isinstance(rollback, dict)
               and rollback.get("newVersion", 0) > rollback.get("previousVersion", 0))
    add_check(report, "RM-06", "ロールバックで旧版の挙動へ復帰",
              "PASS" if status == 200 and reverted and forward else "FAIL",
              {"httpStatus": status, "behaviourReverted": reverted,
               "versionMovesForward": forward, "response": rollback}, latency)

    # RM-07: 申請は承認されるまで反映されない → 承認で反映される
    status, request_body, _ = http("POST", f"{A}/api/rules/approvals",
                                   {"targetType": "CHAIN", "targetId": chain_id, "el": None,
                                    "body": V2_EL, "comment": "validator approval"},
                                   extra_headers=ADMIN_AUTH)
    approval_id = request_body.get("id") if isinstance(request_body, dict) else None
    pending_ok = False
    if approval_id is not None:
        _, run_body, _ = execute(A, chain_id)
        pending_ok = isinstance(run_body, dict) and run_body.get("trace") == V1_TRACE
    # 承認権限の無いユーザーは承認できない
    viewer_status = http("POST", f"{A}/api/rules/approvals/{approval_id}/approve", {"note": "no"},
                         extra_headers=VIEWER_AUTH)[0] if approval_id is not None else 0
    status, approved, latency = (http("POST", f"{A}/api/rules/approvals/{approval_id}/approve",
                                      {"note": "validator approve"}, extra_headers=APPROVER_AUTH)
                                 if approval_id is not None else (0, None, None))
    applied_ok, _, _ = poll_trace(A, chain_id, V2_TRACE)
    approval_ok = (pending_ok and viewer_status == 403
                   and isinstance(approved, dict) and approved.get("status") == "APPLIED"
                   and applied_ok)
    add_check(report, "RM-07", "承認フロー（未承認は未反映／承認で反映）",
              "PASS" if approval_ok else "FAIL",
              {"approvalId": approval_id, "pendingNotApplied": pending_ok,
               "viewerApproveStatus": viewer_status, "statusAfterApprove":
                   approved.get("status") if isinstance(approved, dict) else None,
               "behaviourApplied": applied_ok}, latency)

    # RM-09: 申請者は自分の申請を承認できない（職務分離）
    # これが無いと、APPROVER だけを持つ利用者が「申請 → 自己承認」で ADMIN を持たずに
    # 任意の本文を全 Executor へ発行できてしまい、RM-03 の ADMIN 限定が無意味になる。
    status, self_request, _ = http("POST", f"{A}/api/rules/approvals",
                                   {"targetType": "CHAIN", "targetId": chain_id,
                                    "body": V1_EL, "comment": "self approval attempt"},
                                   extra_headers=APPROVER_AUTH)
    self_id = self_request.get("id") if isinstance(self_request, dict) else None
    self_status, self_body, latency = (
        http("POST", f"{A}/api/rules/approvals/{self_id}/approve",
             {"note": "approving my own request"}, extra_headers=APPROVER_AUTH)
        if self_id is not None else (0, None, None))
    # 拒否されたあとも申請は PENDING のまま残り、反映されていないこと
    _, still_pending, _ = http("GET", f"{A}/api/rules/approvals?status=PENDING",
                               extra_headers=ADMIN_AUTH)
    pending_ids = [e.get("id") for e in
                   (still_pending.get("approvals", []) if isinstance(still_pending, dict) else [])]
    separation_ok = (status == 201 and self_status == 403 and self_id in pending_ids)
    add_check(report, "RM-09", "職務分離（申請者は自分の申請を承認できない）",
              "PASS" if separation_ok else "FAIL",
              {"requestHttpStatus": status, "selfApproveHttpStatus": self_status,
               "approvalId": self_id, "stillPending": self_id in pending_ids,
               "message": self_body.get("message") if isinstance(self_body, dict) else None},
              latency)

    # RM-10: 履歴に同じ版が二重に記録されない
    #
    # 発行の直前に pre-image（いま LiteFlow 側にある本文）を履歴へ入れる処理を足した。
    # LiteFlow は上書き保存なので、そこで取らなければ前の版は永久に失われるためである。
    # ただし統制層経由で発行された版は post-image として既に記録されているので、
    # 二重に積まないよう「その版が履歴にあるか」を先に見ている。
    # その判定が MariaDB で効いていないと、発行のたびに履歴が倍に膨らみ、
    # 差分の左右がずれてロールバックの対象を誤る。
    #
    # なお「統制層の外で発行された版へ戻せる」ことは<b>ここでは検証できない</b>。
    # HTTP 経由の発行はすべて統制層を通るため、その状況をこの検査から作れない。
    # 対応する証跡は JUnit の RuleGovernanceTest（H2）にある。
    status, history, latency = http("GET", f"{A}/api/rules/CHAIN/{chain_id}/revisions",
                                    extra_headers=ADMIN_AUTH)
    revisions = history.get("revisions", []) if isinstance(history, dict) else []
    versions = [r.get("version") for r in revisions]
    no_duplicates = len(versions) == len(set(versions))
    add_check(report, "RM-10", "履歴に同じ版を二重に記録しない",
              "PASS" if status == 200 and versions and no_duplicates else "FAIL",
              {"httpStatus": status, "recordedVersions": versions,
               "distinct": len(set(versions)), "noDuplicates": no_duplicates},
              latency)

    # RM-08: 監査ログに一連の操作が残る
    status, audit, latency = http(f"GET", f"{A}/api/rules/audit?limit=200", extra_headers=ADMIN_AUTH)
    entries = [e for e in (audit.get("entries", []) if isinstance(audit, dict) else [])
               if e.get("targetId") == chain_id]
    actions = sorted({e.get("action") for e in entries})
    audit_ok = "ROLLBACK" in actions and "APPROVE" in actions and len(entries) >= 5
    add_check(report, "RM-08", "監査ログ", "PASS" if audit_ok else "FAIL",
              {"httpStatus": status, "entries": len(entries), "actions": actions}, latency)


def phase_main() -> int:
    global ACTIVE_REPORT
    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ") + "-" + uuid.uuid4().hex[:8]
    chain_id = "migration_" + run_id.replace("-", "").replace("T", "").replace("Z", "")[:28]
    failure_chain_id = "failure_" + run_id.replace("-", "").replace("T", "").replace("Z", "")[:28]
    report = new_report(run_id)
    ACTIVE_REPORT = report
    add_build_checks(report)

    for label, base in (("A", A), ("B", B)):
        ok, body = wait_endpoint(f"{base}/actuator/health")
        add_check(report, f"ENV-{label}", f"Executor {label} health", "PASS" if ok else "FAIL", body)

    status, instance_a, latency = http("GET", f"{A}/api/instance")
    add_check(report, "ENV-A-ID", "Executor A識別", "PASS" if status == 200 else "FAIL", instance_a, latency)
    status, instance_b, latency = http("GET", f"{B}/api/instance")
    add_check(report, "ENV-B-ID", "Executor B識別", "PASS" if status == 200 else "FAIL", instance_b, latency)

    status, v1, latency = publish(A, chain_id, V1_EL, 0)
    v1_ok = status == 201 and isinstance(v1, dict) and v1.get("version") == 1
    add_check(report, "RULE-01", "Chain v1新規公開", "PASS" if v1_ok else "FAIL", {"httpStatus": status, "response": v1}, latency)
    v1_version = int(v1.get("version", 0)) if isinstance(v1, dict) else 0

    ok_a, exec_a_v1, convergence_a_v1 = poll_trace(A, chain_id, V1_TRACE)
    add_check(report, "SYNC-01A", "Executor Aでv1実行", "PASS" if ok_a else "FAIL", exec_a_v1, convergence_a_v1)
    ok_b, exec_b_v1, convergence_b_v1 = poll_trace(B, chain_id, V1_TRACE)
    add_check(report, "SYNC-01B", "Executor Bへのv1同期", "PASS" if ok_b else "FAIL", exec_b_v1, convergence_b_v1)

    status, v2, latency = publish(A, chain_id, V2_EL, v1_version)
    v2_ok = status == 201 and isinstance(v2, dict) and v2.get("version") == 2
    add_check(report, "RULE-02", "Chain v2更新", "PASS" if v2_ok else "FAIL", {"httpStatus": status, "response": v2}, latency)
    v2_version = int(v2.get("version", 0)) if isinstance(v2, dict) else 0

    ok_a2, exec_a_v2, convergence_a_v2 = poll_trace(A, chain_id, V2_TRACE)
    add_check(report, "SYNC-02A", "Executor Aでv2実行", "PASS" if ok_a2 else "FAIL", exec_a_v2, convergence_a_v2)
    ok_b2, exec_b_v2, convergence_b_v2 = poll_trace(B, chain_id, V2_TRACE)
    add_check(report, "SYNC-02B", "Executor Bへのv2収束", "PASS" if ok_b2 else "FAIL", exec_b_v2, convergence_b_v2)
    report["measurements"]["v2ConvergenceMs"] = round(convergence_b_v2, 2)
    convergence_status = "PASS" if ok_b2 and convergence_b_v2 <= 5000 else ("WARN" if ok_b2 else "FAIL")
    add_check(report, "SLO-01", "v2同期収束5秒以内", convergence_status,
              {"actualMs": round(convergence_b_v2, 2), "thresholdMs": 5000},
              required=not ok_b2)

    status, conflict, latency = publish(A, chain_id, "THEN(validate,report)", v1_version)
    conflict_ok = status == 409 and isinstance(conflict, dict)
    add_check(report, "LOCK-01", "旧version更新の拒否", "PASS" if conflict_ok else "FAIL", {"httpStatus": status, "response": conflict}, latency)

    status, failure_publish, latency = publish(A, failure_chain_id, FAILURE_EL, 0)
    add_check(report, "FAIL-01", "失敗Chain公開", "PASS" if status == 201 else "FAIL", failure_publish, latency)
    deadline = time.time() + 15.0
    failure_result: Any = None
    failure_ok = False
    while time.time() < deadline:
        _, body, _ = execute(B, failure_chain_id)
        failure_result = body
        if isinstance(body, dict) and body.get("success") is False and "forcedFailure" in body.get("trace", []):
            failure_ok = True
            break
        time.sleep(0.2)
    add_check(report, "FAIL-02", "失敗Chainの検出", "PASS" if failure_ok else "FAIL", failure_result)

    latencies: list[float] = []
    hot_success = 0
    for _ in range(30):
        _, body, elapsed = execute(A, chain_id)
        latencies.append(elapsed)
        if isinstance(body, dict) and body.get("success") and body.get("trace") == V2_TRACE:
            hot_success += 1
    perf_ok = hot_success == 30
    p50 = statistics.median(latencies) if latencies else 0.0
    p95 = percentile(latencies, 0.95)
    report["measurements"]["httpExecutionLatencyMs"] = {
        "samples": len(latencies), "successful": hot_success, "p50": round(p50, 2), "p95": round(p95, 2), "max": round(max(latencies), 2) if latencies else 0.0
    }
    add_check(report, "PERF-01", "連続実行30件", "PASS" if perf_ok else "FAIL", report["measurements"]["httpExecutionLatencyMs"])
    latency_status = "PASS" if perf_ok and p95 <= 500 else ("WARN" if perf_ok else "FAIL")
    add_check(report, "SLO-02", "HTTP実行P95 500ms以内", latency_status,
              {"actualP95Ms": round(p95, 2), "thresholdMs": 500}, required=not perf_ok)

    def concurrent_call(index: int) -> bool:
        base = A if index % 2 == 0 else B
        try:
            _, body, _ = execute(base, chain_id)
            return isinstance(body, dict) and body.get("success") is True and body.get("trace") == V2_TRACE
        except Exception:  # noqa: BLE001
            return False

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        concurrency_results = list(pool.map(concurrent_call, range(50)))
    concurrent_success = sum(1 for value in concurrency_results if value)
    report["measurements"]["concurrency"] = {"requests": 50, "success": concurrent_success, "workers": 10}
    add_check(report, "CONC-01", "50件並列実行", "PASS" if concurrent_success == 50 else "FAIL", report["measurements"]["concurrency"])

    for label, base in (("A", A), ("B", B)):
        status, snapshot, latency = http("GET", f"{base}/actuator/liteflow/ruledb")
        active = status == 200 and isinstance(snapshot, dict) and snapshot.get("active") is True
        failed_targets = snapshot.get("failedTargets", []) if isinstance(snapshot, dict) else []
        snapshot_ok = active and isinstance(failed_targets, list) and len(failed_targets) == 0
        add_check(report, f"OBS-RDB-{label}", f"Executor {label} Rule-DB snapshot", "PASS" if snapshot_ok else "FAIL", snapshot, latency)

        # このエンドポイントは text/plain しか produce しない。既定の Accept: application/json だと
        # メトリクスが描画される前にコンテントネゴシエーションでリクエストが拒否される。
        status, metrics, latency = http("GET", f"{base}/actuator/prometheus",
                                        extra_headers={"Accept": "text/plain;version=0.0.4,*/*"})
        metric_lines = []
        if status == 200 and isinstance(metrics, str):
            metric_lines = sorted({line.split("{")[0].split(" ")[0] for line in metrics.splitlines() if line.startswith("liteflow_") and not line.startswith("#")})
        required_metrics = {
            "liteflow_chain_executions_seconds_count",
            "liteflow_node_executions_seconds_count",
            "liteflow_slot_occupied",
            "liteflow_slot_size",
        }
        missing_metrics = sorted(required_metrics.difference(metric_lines))
        metrics_ok = len(missing_metrics) == 0
        add_check(report, f"OBS-MET-{label}", f"Executor {label} LiteFlowメトリクス", "PASS" if metrics_ok else "FAIL",
                  {"metricCount": len(metric_lines), "required": sorted(required_metrics),
                   "missing": missing_metrics, "metrics": metric_lines[:40]}, latency)

    targets_ok = False
    targets_body: Any = None
    deadline = time.time() + 30.0
    while time.time() < deadline:
        status, targets_body, _ = http("GET", f"{PROM}/api/v1/targets")
        if status == 200 and isinstance(targets_body, dict):
            active_targets = targets_body.get("data", {}).get("activeTargets", [])
            up = [t for t in active_targets if t.get("health") == "up"]
            if len(up) >= 2:
                targets_ok = True
                break
        time.sleep(2.0)
    add_check(report, "OBS-PROM", "Prometheusが2台をScrape", "PASS" if targets_ok else "FAIL", targets_body)

    # scrape_interval は 5 秒で、Prometheus は対象ごとに取得タイミングをずらす。
    # 直前に実行したChainの値が両インスタンス分そろうまで待たないと、
    # 「片方しか出ていない」という取得タイミング依存の偽FAILになる。
    query = urllib.parse.quote("liteflow_chain_executions_seconds_count", safe="")
    metric_instances: list = []
    result: list = []
    status = 0
    latency = None
    deadline = time.time() + 30.0
    while True:
        status, query_body, latency = http("GET", f"{PROM}/api/v1/query?query={query}")
        result = query_body.get("data", {}).get("result", []) if isinstance(query_body, dict) else []
        metric_instances = sorted({item.get("metric", {}).get("instance") for item in result
                                   if item.get("metric", {}).get("instance")})
        if status == 200 and len(metric_instances) >= 2:
            break
        if time.time() >= deadline:
            break
        time.sleep(2.0)
    query_ok = status == 200 and len(metric_instances) >= 2
    add_check(report, "OBS-PROM-DATA", "Prometheusに2台分のChain実測値",
              "PASS" if query_ok else "FAIL",
              {"instances": metric_instances, "seriesCount": len(result)}, latency)

    status, grafana_health, latency = http("GET", f"{GRAFANA}/api/health")
    grafana_ok = status == 200 and isinstance(grafana_health, dict) and grafana_health.get("database") == "ok"
    add_check(report, "OBS-GRAFANA", "Grafana health", "PASS" if grafana_ok else "FAIL", grafana_health, latency)

    token = base64.b64encode(b"admin:admin").decode("ascii")
    dashboard_ok = False
    dashboard: Any = None
    dashboard_latency = 0.0
    deadline = time.time() + 30.0
    while time.time() < deadline:
        status, dashboard, dashboard_latency = http(
            "GET", f"{GRAFANA}/api/dashboards/uid/{DASHBOARD_UID}",
            extra_headers={"Authorization": f"Basic {token}"})
        dashboard_ok = (
            status == 200
            and isinstance(dashboard, dict)
            and dashboard.get("dashboard", {}).get("uid") == DASHBOARD_UID
        )
        if dashboard_ok:
            break
        time.sleep(1.0)
    add_check(report, "OBS-DASHBOARD", "Grafana dashboard自動登録",
              "PASS" if dashboard_ok else "FAIL", dashboard, dashboard_latency)

    state = {
        "runId": run_id,
        "chainId": chain_id,
        "failureChainId": failure_chain_id,
        "expectedTrace": V2_TRACE,
        "version": v2_version,
        "createdAt": utc_now(),
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    STATE_JSON.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")

    add_rule_admin_checks(report, run_id)

    add_check(report, "SCOPE-01", "検証範囲の明示", "PASS", {
        "orchestrationValidated": True,
        "cobolToJavaAccuracyValidated": False,
        "reason": "実COBOL、期待Java、同値性データセットを本PoCに含めていない"
    })

    save_report(report)
    print(render_markdown(report))
    return 0 if report["overallStatus"] != "FAIL" else 1


def phase_persistence() -> int:
    global ACTIVE_REPORT
    if not REPORT_JSON.exists() or not STATE_JSON.exists():
        raise RuntimeError("Main phase report/state not found")
    report = json.loads(REPORT_JSON.read_text(encoding="utf-8"))
    ACTIVE_REPORT = report
    state = json.loads(STATE_JSON.read_text(encoding="utf-8"))

    ok, health = wait_endpoint(f"{B}/actuator/health", timeout_seconds=90.0)
    add_check(report, "RESTART-01", "Executor B再起動後health", "PASS" if ok else "FAIL", health)

    success, execution, elapsed = poll_trace(B, state["chainId"], state["expectedTrace"], timeout_seconds=20.0)
    add_check(report, "RESTART-02", "再起動後にDBルールを再ロードして実行", "PASS" if success else "FAIL", execution, elapsed)

    status, snapshot, latency = http("GET", f"{B}/actuator/liteflow/ruledb")
    active = status == 200 and isinstance(snapshot, dict) and snapshot.get("active") is True
    add_check(report, "RESTART-03", "再起動後Rule-DB snapshot", "PASS" if active else "FAIL", snapshot, latency)

    report.setdefault("measurements", {})["restartReloadMs"] = round(elapsed, 2)
    save_report(report)
    print(render_markdown(report))
    return 0 if report["overallStatus"] != "FAIL" else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--phase", choices=["main", "persistence"], required=True)
    args = parser.parse_args()
    try:
        if args.phase == "main":
            return phase_main()
        return phase_persistence()
    except Exception as exc:  # noqa: BLE001
        report = ACTIVE_REPORT or new_report("fatal-" + uuid.uuid4().hex[:8])
        add_check(report, "FATAL-01", f"{args.phase} phase unexpected failure", "FAIL", {
            "exception": exc.__class__.__name__,
            "message": str(exc),
            "phase": args.phase,
        })
        save_report(report)
        print(render_markdown(report), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
