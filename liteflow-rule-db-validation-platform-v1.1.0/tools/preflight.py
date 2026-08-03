#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
REPORT_DIR = ROOT / "reports"
REPORT_JSON = REPORT_DIR / "preflight-report.json"
REPORT_MD = REPORT_DIR / "preflight-report.md"


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat()


def run(command: list[str], cwd: Path | None = None) -> tuple[int, str]:
    result = subprocess.run(command, cwd=cwd or ROOT, text=True, capture_output=True)
    output = (result.stdout or "") + (result.stderr or "")
    return result.returncode, output.strip()


def add(report: dict[str, Any], check_id: str, name: str, status: str, evidence: Any) -> None:
    report["checks"].append({"id": check_id, "name": name, "status": status, "evidence": evidence})


def file_sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def check_rule_profiles() -> tuple[str, dict[str, Any]]:
    """変換ルール表（templates/*.json）の最低条件を Docker 無しで検査する。

    ここでは「Python でも確実に言えること」だけを見る。すなわち JSON として読めること、
    ルールに id / pattern / template があること、id が重複しないこと。

    **正規表現の妥当性はここでは見ない。** パターンは Java の正規表現であり、
    名前付きグループの書き方が違う（Java は (?<name>) / Python は (?P<name>)）。
    Python の re に通すと、正しい Java パターンを不正と言い、
    Java だけの構文（所有量指定子など）を見逃す。両方向に間違える検査は置かない。

    **フィールド名の妥当性（appliesToFiles のような綴り間違い）もここでは見ない。**
    既知フィールドの一覧をここに書き写すと真実が2か所になり、
    模型クラスを1つ触るたびにずれて誤検知を出す仕組みになってしまう。

    どちらも ProfileDiagnosticsTest（= local-verify）が本物の java.util.regex.Pattern と
    模型クラスの setter を使って判定する。
    """
    root = ROOT / "app" / "src" / "main" / "resources" / "templates"
    problems: list[str] = []
    profiles: dict[str, Any] = {}
    if not root.is_dir():
        return "FAIL", {"error": "templates ディレクトリが存在しません", "profiles": {}}

    files = sorted(root.glob("*.json"))
    if not files:
        return "FAIL", {"error": "プロファイルが1つもありません", "profiles": {}}

    for path in files:
        name = path.name
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as error:
            problems.append(f"{name}: JSON として読めません ({error})")
            continue
        rules = data.get("rules") or []
        seen: set[str] = set()
        for index, rule in enumerate(rules):
            where = f"{name} rules[{index}]"
            rule_id = rule.get("id")
            if not rule_id:
                problems.append(f"{where}: id がありません")
            elif rule_id in seen:
                problems.append(f"{where}: id '{rule_id}' が重複しています")
            else:
                seen.add(rule_id)
            if not rule.get("pattern"):
                problems.append(f"{where}: pattern がありません")
            if rule.get("template") is None:
                problems.append(f"{where}: template がありません（捨てるなら \"\" を明示）")
        profiles[name] = {
            "profile": data.get("profile"),
            "version": data.get("version"),
            "rules": len(rules),
            "structure": len(data.get("structure") or []),
            "facts": len(data.get("facts") or []),
            "artifacts": len(data.get("artifacts") or []),
        }

    status = "FAIL" if problems else "PASS"
    return status, {"profiles": profiles, "problems": problems}


def check_corpus_families() -> tuple[str, dict[str, Any]]:
    """corpus/families/<家族>/cases/<ケース>/ の構造を機械的に検査する。

    ケースは meta.json と input/（1ファイル以上）と output/ の3点を必ず持つ。
    input が変換元、output が期待する正解であり、実結果は reports/ にしか出さない
    という約束を、ここで強制している。
    """
    root = ROOT / "corpus" / "families"
    problems: list[str] = []
    families: dict[str, Any] = {}
    if not root.is_dir():
        return "FAIL", {"error": "corpus/families が存在しません", "families": {}}

    family_dirs = sorted(p for p in root.iterdir() if p.is_dir())
    if not family_dirs:
        return "FAIL", {"error": "family が1つもありません", "families": {}}

    for family in family_dirs:
        name = family.name
        meta_path = family / "family.json"
        if not meta_path.is_file():
            problems.append(f"{name}: family.json がありません")
            continue
        if not (family / "README.md").is_file():
            problems.append(f"{name}: README.md がありません")
        try:
            family_meta = json.loads(meta_path.read_text(encoding="utf-8"))
        except Exception as exc:
            problems.append(f"{name}/family.json: parse error {exc!r}")
            continue
        for key in ("family", "title", "templateProfile", "chainEl", "inputMode", "grading"):
            if not family_meta.get(key):
                problems.append(f"{name}/family.json: '{key}' が未設定です")
        if family_meta.get("inputMode") not in {"single", "multi"}:
            problems.append(f"{name}/family.json: inputMode は single か multi のみ")

        case_root = family / "cases"
        cases = sorted(p for p in case_root.iterdir() if p.is_dir()) if case_root.is_dir() else []
        if not cases:
            problems.append(f"{name}: cases/ にケースがありません")
        negatives = 0
        for case in cases:
            label = f"{name}/{case.name}"
            case_meta_path = case / "meta.json"
            if not case_meta_path.is_file():
                problems.append(f"{label}: meta.json がありません")
            else:
                try:
                    case_meta = json.loads(case_meta_path.read_text(encoding="utf-8"))
                    gate = case_meta.get("expectQualityGate", "PASS")
                    if gate not in {"PASS", "FAIL"}:
                        problems.append(f"{label}: expectQualityGate は PASS か FAIL のみ (現在 {gate!r})")
                    if gate == "FAIL":
                        negatives += 1
                    if not case_meta.get("title"):
                        problems.append(f"{label}: title がありません")
                except Exception as exc:
                    problems.append(f"{label}/meta.json: parse error {exc!r}")
            input_dir = case / "input"
            if not input_dir.is_dir() or not any(p.is_file() for p in input_dir.iterdir()):
                problems.append(f"{label}: input/ に変換元ファイルがありません")
            if not (case / "output").is_dir():
                problems.append(f"{label}: output/ がありません")
        if cases and negatives == 0:
            problems.append(f"{name}: 負例（expectQualityGate=FAIL）が1件もありません")
        families[name] = {"cases": len(cases), "negatives": negatives}

    return ("PASS" if not problems else "FAIL"), {"families": families, "problems": problems}


def summarize(report: dict[str, Any]) -> None:
    counts = {"PASS": 0, "FAIL": 0, "WARN": 0, "SKIP": 0}
    for item in report["checks"]:
        counts[item["status"]] = counts.get(item["status"], 0) + 1
    report["summary"] = counts
    report["overallStatus"] = "FAIL" if counts["FAIL"] else ("WARN" if counts["WARN"] or counts["SKIP"] else "PASS")
    report["completedAt"] = now()


def markdown(report: dict[str, Any]) -> str:
    lines = [
        "# LiteFlow Rule-DB Platform Preflight Report",
        "",
        f"- Started: {report['startedAt']}",
        f"- Completed: {report['completedAt']}",
        f"- Overall: **{report['overallStatus']}**",
        f"- PASS: {report['summary']['PASS']} / FAIL: {report['summary']['FAIL']} / WARN: {report['summary']['WARN']} / SKIP: {report['summary']['SKIP']}",
        "",
        "This report contains checks actually executed in the packaging environment. It is not a substitute for Docker/MariaDB end-to-end execution.",
        "",
        "| ID | Check | Result | Evidence |",
        "|---|---|---:|---|",
    ]
    for item in report["checks"]:
        evidence = json.dumps(item["evidence"], ensure_ascii=False, separators=(",", ":"))
        if len(evidence) > 300:
            evidence = evidence[:297] + "..."
        evidence = evidence.replace("|", "\\|").replace("\n", " ")
        lines.append(f"| {item['id']} | {item['name']} | **{item['status']}** | `{evidence}` |")
    lines += [
        "",
        "## Interpretation",
        "",
        "- PASS means the listed check ran and succeeded in this environment.",
        "- SKIP means the required runtime tool was unavailable; it is not treated as success.",
        "- The final Rule-DB decision must use `reports/validation-report.md` generated by `run-all.cmd` or `run-all.sh` on a Docker-enabled machine.",
    ]
    return "\n".join(lines) + "\n"


def main() -> int:
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report: dict[str, Any] = {
        "startedAt": now(),
        "completedAt": None,
        "overallStatus": "RUNNING",
        "environment": {
            "python": sys.version,
            "platform": sys.platform,
            "cwd": str(ROOT),
        },
        "checks": [],
    }

    required = [
        "README.md", "CLAUDE.md", "START_HERE.txt", "VERSION.txt", "package-metadata.json", "docker-compose.yml",
        "docs/TECHNICAL_REPORT.md", "docs/CHANGELOG.md", "docs/STRUCTURE_REPORT.md",
        "docs/COBOL_EXTENSION_BOUNDARY.md", "docs/USE_CASE_SCENARIOS.md",
        "scripts/install.sh", "scripts/validate.sh", "scripts/run-all.sh",
        "scripts/install.ps1", "scripts/validate.ps1", "scripts/run-all.ps1",
        "scripts/_common.ps1",
        "app/src/main/resources/templates/compilable-v1.json",
        "corpus/README.md",
        "corpus/families/cobol-statements/family.json",
        "corpus/families/cobol-statements/README.md",
        "corpus/families/cobol-programs/family.json",
        "corpus/families/cobol-programs/README.md",
        "app/src/main/resources/templates/cobol-programs-v1.json",
        "corpus/families/struts-springboot/family.json",
        "corpus/families/struts-springboot/README.md",
        "corpus/families/struts-springboot/apps/legacy-struts1/pom.xml",
        "corpus/families/struts-springboot/apps/target-springboot41/pom.xml",
        "app/src/main/resources/templates/struts-to-boot-v1.json",
        "scripts/samples-build.ps1", "scripts/samples-build.cmd",
        "scripts/rule-admin-demo.ps1", "scripts/rule-admin-demo.cmd",
        "scripts/summary.ps1", "scripts/summary.cmd",
        "app/src/main/resources/schema.sql",
        "app/src/main/resources/static/admin/index.html",
        "app/boot41-classpath.pom.xml",
        "app/Dockerfile", "app/pom.xml",
        "app/src/main/resources/application.properties",
        "app/src/test/java/jp/co/softroad/liteflow/RuleDbPlatformIntegrationTest.java",
        # 変換・解析の意味を持つ純粋なクラス。ノードはこれを呼ぶだけの adapter である。
        "app/src/main/java/jp/co/softroad/liteflow/transform/RuleEngine.java",
        "app/src/main/java/jp/co/softroad/liteflow/transform/SourceAnalyzer.java",
        "app/src/main/java/jp/co/softroad/liteflow/transform/InlineTemplates.java",
        "app/src/main/java/jp/co/softroad/liteflow/transform/ProfileValidator.java",
        # 起動不要の作業ループ。ここが消えるとルール表の確認手段が25秒に戻る。
        "app/src/test/java/jp/co/softroad/liteflow/RuleEngineTest.java",
        "app/src/test/java/jp/co/softroad/liteflow/RuleEngineCorpusTest.java",
        "app/src/test/java/jp/co/softroad/liteflow/CorpusSnapshotTest.java",
        "app/src/test/java/jp/co/softroad/liteflow/ProfileDiagnosticsTest.java",
        "app/src/test/java/jp/co/softroad/liteflow/RuleUsageTest.java",
        "app/src/test/java/jp/co/softroad/liteflow/corpus/CorpusCases.java",
        "app/src/test/java/jp/co/softroad/liteflow/corpus/TransformSnapshot.java",
        "validator/validate.py", "validator/test_validate.py",
        "monitoring/prometheus.yml",
        "monitoring/grafana/dashboards/liteflow-dashboard.json",
    ]
    missing = [name for name in required if not (ROOT / name).exists()]
    add(report, "PF-01", "Required files", "PASS" if not missing else "FAIL", {"missing": missing, "requiredCount": len(required)})

    code, output = run([sys.executable, "-m", "py_compile", "validator/validate.py", "validator/test_validate.py", "tools/static_compile.py", "tools/preflight.py"])
    add(report, "PF-02", "Python syntax", "PASS" if code == 0 else "FAIL", {"exitCode": code, "output": output[-2000:]})

    code, output = run([sys.executable, "-m", "unittest", "discover", "-s", "validator", "-p", "test_*.py", "-v"])
    add(report, "PF-03", "Validator unit tests", "PASS" if code == 0 else "FAIL", {"exitCode": code, "output": output[-4000:]})

    bash = shutil.which("bash")
    if bash:
        shell_files = sorted(str(p.relative_to(ROOT)).replace("\\", "/") for p in ROOT.glob("scripts/*.sh"))
        failures: dict[str, str] = {}
        for relative in shell_files:
            code, output = run([bash, "-n", relative])
            if code != 0:
                failures[relative] = output
        add(report, "PF-04", "Bash syntax", "PASS" if not failures else "FAIL", {"files": shell_files, "failures": failures})
    else:
        add(report, "PF-04", "Bash syntax", "SKIP", {"reason": "bash not found"})

    try:
        root = ET.parse(ROOT / "app" / "pom.xml").getroot()
        ns = {"m": "http://maven.apache.org/POM/4.0.0"}
        parent_version = root.findtext("m:parent/m:version", namespaces=ns)
        liteflow_version = root.findtext("m:properties/m:liteflow.version", namespaces=ns)
        java_version = root.findtext("m:properties/m:java.version", namespaces=ns)
        ok = parent_version == "4.0.6" and liteflow_version == "2.16.1" and java_version == "17"
        add(report, "PF-05", "Maven POM parse and pinned versions", "PASS" if ok else "FAIL", {
            "springBootParent": parent_version, "liteflow": liteflow_version, "java": java_version,
        })
    except Exception as exc:
        add(report, "PF-05", "Maven POM parse and pinned versions", "FAIL", {"error": repr(exc)})

    try:
        dashboard = json.loads((ROOT / "monitoring/grafana/dashboards/liteflow-dashboard.json").read_text(encoding="utf-8"))
        validator_text = (ROOT / "validator/validate.py").read_text(encoding="utf-8")
        match = re.search(r'DASHBOARD_UID\s*=\s*os\.getenv\([^,]+,\s*"([^"]+)"\)', validator_text)
        validator_uid = match.group(1) if match else None
        dashboard_uid = dashboard.get("uid")
        ok = dashboard_uid == validator_uid and bool(dashboard.get("panels"))
        add(report, "PF-06", "Grafana dashboard JSON and validator UID", "PASS" if ok else "FAIL", {
            "dashboardUid": dashboard_uid, "validatorUid": validator_uid, "panelCount": len(dashboard.get("panels", [])),
        })
    except Exception as exc:
        add(report, "PF-06", "Grafana dashboard JSON and validator UID", "FAIL", {"error": repr(exc)})

    yaml_files = [
        ROOT / "docker-compose.yml",
        ROOT / "monitoring" / "prometheus.yml",
        ROOT / "monitoring" / "grafana" / "provisioning" / "dashboards" / "default.yml",
        ROOT / "monitoring" / "grafana" / "provisioning" / "datasources" / "prometheus.yml",
    ]
    try:
        import yaml  # type: ignore
        yaml_errors: dict[str, str] = {}
        for yaml_file in yaml_files:
            try:
                yaml.safe_load(yaml_file.read_text(encoding="utf-8"))
            except Exception as exc:
                yaml_errors[str(yaml_file.relative_to(ROOT))] = repr(exc)
        add(report, "PF-07A", "YAML parse", "PASS" if not yaml_errors else "FAIL", {
            "files": [str(x.relative_to(ROOT)) for x in yaml_files], "errors": yaml_errors,
        })
    except ImportError:
        add(report, "PF-07A", "YAML parse", "SKIP", {"reason": "PyYAML not installed"})

    compose_text = (ROOT / "docker-compose.yml").read_text(encoding="utf-8")
    expected_services = ["mariadb", "executor-a", "executor-b", "prometheus", "grafana", "validator"]
    missing_services = [service for service in expected_services if not re.search(rf"^  {re.escape(service)}:\s*$", compose_text, re.MULTILINE)]
    images = dict(re.findall(r"^  ([a-z0-9-]+):\n(?:.*\n)*?    image:\s*([^\s]+)", compose_text, re.MULTILINE))
    add(report, "PF-07", "Compose service structure", "PASS" if not missing_services else "FAIL", {
        "missingServices": missing_services,
        "images": images,
    })

    docker = shutil.which("docker")
    if docker:
        code, output = run([docker, "compose", "config"])
        add(report, "PF-08", "Docker Compose config", "PASS" if code == 0 else "FAIL", {"exitCode": code, "output": output[-4000:]})
    else:
        add(report, "PF-08", "Docker Compose config", "SKIP", {"reason": "docker not found"})

    code, output = run([sys.executable, "tools/static_compile.py"])
    add(report, "PF-09", "Java syntax/internal type compile with API stubs", "PASS" if code == 0 else "FAIL", {"exitCode": code, "output": output[-4000:]})

    dockerfile = (ROOT / "app/Dockerfile").read_text(encoding="utf-8")
    commit_match = re.search(r"ARG LITEFLOW_COMMIT=([0-9a-f]{40})", dockerfile)
    fallback_tokens = ["dependency:get", "git fetch --depth 1", "mvn -B -ntp clean verify", "build-metadata.json"]
    missing_tokens = [token for token in fallback_tokens if token not in dockerfile]
    add(report, "PF-10", "Docker build reproducibility guards", "PASS" if commit_match and not missing_tokens else "FAIL", {
        "sourceCommit": commit_match.group(1) if commit_match else None,
        "missingTokens": missing_tokens,
    })

    validator_text = (ROOT / "validator/validate.py").read_text(encoding="utf-8")
    error_guards = ["FATAL-01", "ACTIVE_REPORT", "save_report(report)"]
    missing_error_guards = [token for token in error_guards if token not in validator_text]
    cmd_text = (ROOT / "scripts/run-all.cmd").read_text(encoding="utf-8", errors="replace").lower()
    add(report, "PF-11", "Failure evidence and keep-window behavior", "PASS" if not missing_error_guards and "pause" in cmd_text else "FAIL", {
        "missingValidatorGuards": missing_error_guards,
        "runAllCmdHasPause": "pause" in cmd_text,
    })

    try:
        metadata = json.loads((ROOT / "package-metadata.json").read_text(encoding="utf-8"))
        metadata_ok = (
            metadata.get("packageVersion") == (ROOT / "VERSION.txt").read_text(encoding="utf-8").strip()
            and metadata.get("liteflowVersion") == "2.16.1"
            and metadata.get("springBootVersion") == "4.0.6"
            and metadata.get("runtimeImages", {}).get("mariadb") in compose_text
            and metadata.get("runtimeImages", {}).get("prometheus") in compose_text
            and metadata.get("runtimeImages", {}).get("grafana") in compose_text
        )
        add(report, "PF-12", "Package metadata consistency", "PASS" if metadata_ok else "FAIL", metadata)
    except Exception as exc:
        add(report, "PF-12", "Package metadata consistency", "FAIL", {"error": repr(exc)})

    cmd_files = ["scripts/install.cmd", "scripts/validate.cmd", "scripts/run-all.cmd",
                 "scripts/preflight.cmd", "scripts/local-verify.cmd", "scripts/corpus-run.cmd",
                 "scripts/samples-build.cmd", "scripts/rule-admin-demo.cmd",
                 "scripts/summary.cmd"]
    cmd_failures: dict[str, Any] = {}
    for relative in cmd_files:
        text = (ROOT / relative).read_text(encoding="utf-8", errors="replace")
        checks = {
            "echoOff": text.lower().lstrip().startswith("@echo off"),
            "setlocal": "setlocal" in text.lower(),
            "balancedParentheses": text.count("(") == text.count(")"),
        }
        if relative == "scripts/run-all.cmd":
            checks["keepsWindowOpen"] = "pause" in text.lower()
        if not all(checks.values()):
            cmd_failures[relative] = checks
    add(report, "PF-13", "Windows CMD structural checks", "PASS" if not cmd_failures else "FAIL", {
        "files": cmd_files, "failures": cmd_failures,
    })

    ps_files = ["scripts/install.ps1", "scripts/validate.ps1", "scripts/run-all.ps1",
                "scripts/preflight.ps1", "scripts/stop.ps1", "scripts/_common.ps1",
                "scripts/local-verify.ps1", "scripts/local-demo.ps1", "scripts/local-corpus.ps1",
                "scripts/demo-transform.ps1", "scripts/corpus-run.ps1",
                "scripts/samples-build.ps1", "scripts/rule-admin-demo.ps1",
                "scripts/summary.ps1"]
    ps_missing = []
    ps_structure: dict[str, Any] = {}
    for relative in ps_files:
        text = (ROOT / relative).read_text(encoding="utf-8", errors="replace")
        checks = {
            # _common.ps1 はドットソース用のライブラリなので、呼び出し側が設定する
            # $ErrorActionPreference をここで再設定する必要はない。
            "errorActionStop": relative.endswith("_common.ps1")
                               or '$ErrorActionPreference = "Stop"' in text,
            "balancedBraces": text.count("{") == text.count("}"),
            "balancedParentheses": text.count("(") == text.count(")"),
        }
        ps_structure[relative] = checks
        if not all(checks.values()):
            ps_missing.append(relative)
    add(report, "PF-14", "PowerShell structural checks", "PASS" if not ps_missing else "FAIL", {
        "files": ps_structure, "failed": ps_missing,
        "note": "Structural scan only; PowerShell runtime was not available in the packaging environment.",
    })

    failure_test = REPORT_DIR / "failure-path-test.txt"
    failure_text = failure_test.read_text(encoding="utf-8") if failure_test.exists() else ""
    failure_ok = "INSTALL_FAILURE_PATH_PASS" in failure_text and "RUN_ALL_FAILURE_PATH_PASS" in failure_text
    add(report, "PF-15", "Shell failure evidence path", "PASS" if failure_ok else "WARN", {
        "evidenceFile": str(failure_test.relative_to(ROOT)) if failure_test.exists() else None,
        "content": failure_text.strip(),
    })

    ignored_parts = {"reports", "__pycache__", "target", ".git"}
    source_files = sorted(p for p in ROOT.rglob("*") if p.is_file() and not (ignored_parts & set(p.parts)))
    add(report, "PF-16", "Source inventory", "PASS", {
        "fileCount": len(source_files),
        "javaCount": sum(1 for p in source_files if p.suffix == ".java"),
        "sha256": {str(p.relative_to(ROOT)): file_sha256(p) for p in source_files if p.name in {"pom.xml", "Dockerfile", "docker-compose.yml", "validate.py"}},
    })

    add(report, "PF-17", "Corpus family structure", *check_corpus_families())
    add(report, "PF-18", "Rule profile sanity", *check_rule_profiles())

    summarize(report)
    REPORT_JSON.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    REPORT_MD.write_text(markdown(report), encoding="utf-8")
    print(markdown(report))
    return 1 if report["overallStatus"] == "FAIL" else 0


if __name__ == "__main__":
    raise SystemExit(main())
