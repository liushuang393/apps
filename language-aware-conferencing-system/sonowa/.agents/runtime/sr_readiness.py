#!/usr/bin/env python3
"""SR project readiness runner.

`sr_init.py` says what a repository probably has. This says what actually ran. It executes
the commands declared in `<home>/local/checks/*.md` — verbatim, never rewritten — and records
the observation as a baseline: which test ids failed, at which revision, under which
dependency and configuration fingerprint. Later runs are compared by identity, not by
count: five failures before and five after can hide two fixed and two new.

Three things it deliberately is not. It is not the guard — `sr_guard.py` reads the files
this writes and never executes a command (see AUDIT.md, v3.0.0). It is not automatic — a
human invokes `baseline`, names the checks, and gives a reason to replace one. And it keeps
no logs — a baseline holds ids, counts, hashes and an exit code, so nothing a check printed
can end up committed with it.
"""

# sr-managed v5.3.0
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from sr_guard import DEFAULT_HOME, changed_paths, git, sr_home  # noqa: E402  # same dir, above

BASELINE_SCHEMA = 1
KNOWN_BASELINE_SCHEMAS = (1,)
BASELINES_REL = "state/readiness/baselines"
CHECKS_REL = "local/checks"
REPORT_KINDS = ("junit",)
DEFAULT_TIMEOUT = 3600
TAIL_LINES = 20
# Files whose change makes a baseline incomparable: dependency manifests, lockfiles, and
# the configuration of the tools the checks run. Only the ones that exist are hashed.
FINGERPRINT_DEFAULTS = (
    "pyproject.toml",
    "uv.lock",
    "poetry.lock",
    "requirements.txt",
    "requirements-dev.txt",
    "environment.yml",
    "setup.cfg",
    "pytest.ini",
    "tox.ini",
    "ruff.toml",
    ".ruff.toml",
    "mypy.ini",
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "go.mod",
    "go.sum",
    "Cargo.toml",
    "Cargo.lock",
)
STATES = ("UNBOUND", "BOUND", "OBSERVABLE", "BASELINED")


@dataclass
class Check:
    name: str
    path: Path
    command: str
    report: str | None
    invalidation: list[str]


@dataclass
class Observation:
    exit_code: int
    duration: float
    results: dict | None
    mutated_paths: list[str]


class ReadinessError(Exception):
    """A reason no baseline was written. The message is the whole explanation."""


def suite_version() -> str:
    here = Path(__file__).resolve()
    match = re.search(r"^# sr-managed v(\S+)", here.read_text(encoding="utf-8"), re.MULTILINE)
    if match:
        return match.group(1)
    version = here.parents[1] / "VERSION"
    return version.read_text(encoding="utf-8").strip() if version.exists() else "unknown"


def parse_check(path: Path) -> Check | None:
    """The check a file declares, or None when it holds no command.

    The command is the first indented line — the convention `local/checks/README.md`
    documents. `Report: junit <path>` names the machine-readable result the command writes;
    `Invalidation: <path> ...` adds files whose change makes the baseline stale.
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    command = ""
    for line in text.splitlines():
        if re.match(r"^(?: {4}|\t)\S", line):
            command = line.strip()
            break
    if not command:
        return None
    report = None
    match = re.search(r"^Report:[^\S\n]*(.*)$", text, re.MULTILINE)
    if match:
        words = match.group(1).split()
        if len(words) != 2:
            raise ReadinessError(
                f"{path.name}: Report line must be `Report: junit <path>`, got '{match.group(1)}'"
            )
        kind, report = words[0].lower(), words[1]
        if kind not in REPORT_KINDS:
            raise ReadinessError(
                f"{path.name}: Report kind '{kind}' is not supported ({'/'.join(REPORT_KINDS)})"
            )
        if Path(report).is_absolute() or ".." in Path(report).parts:
            # The runner deletes the old report before a run; that must stay inside the repo.
            raise ReadinessError(
                f"{path.name}: Report path {report} must be relative, inside the repo"
            )
    match = re.search(r"^Invalidation:[^\S\n]*(.*)$", text, re.MULTILINE)
    invalidation = match.group(1).split() if match else []
    return Check(path.stem, path, command, report, invalidation)


def declared_checks(repo: Path, home: str | None = None) -> dict[str, Check]:
    directory = sr_home(repo, home) / CHECKS_REL
    checks: dict[str, Check] = {}
    if not directory.is_dir():
        return checks
    for path in sorted(directory.glob("*.md")):
        if path.name == "README.md":
            continue
        check = parse_check(path)
        if check is not None:
            checks[check.name] = check
    return checks


def fingerprint(repo: Path, check: Check) -> tuple[str, dict[str, str]]:
    """Hash of the files whose change makes this check's baseline incomparable.

    Git blob hashes, so an untracked file counts and a missing one reads `missing`. The check
    file itself is always included: a changed command is a different measurement.
    """
    paths = [p for p in FINGERPRINT_DEFAULTS if (repo / p).is_file()]
    paths.append(check.path.resolve().relative_to(repo.resolve()).as_posix())
    for rel in check.invalidation:
        # A declared path has to be hashable: a typo or a directory would read `missing` on
        # both sides forever and the baseline would never go stale.
        if not (repo / rel).is_file():
            raise ReadinessError(f"{check.name}: Invalidation path {rel} is not a file")
    paths.extend(check.invalidation)
    inputs: dict[str, str] = {}
    for rel in dict.fromkeys(paths):
        inputs[rel] = git(repo, "hash-object", "--", rel) or "missing"
    digest = hashlib.sha256(
        "\n".join(f"{rel}={blob}" for rel, blob in inputs.items()).encode("utf-8")
    ).hexdigest()
    return f"sha256:{digest}", inputs


def parse_junit(path: Path, repo: Path) -> dict:
    try:
        root = ET.parse(path).getroot()
    except ET.ParseError as exc:
        raise ReadinessError(
            f"declared report {path.name} is not valid JUnit XML ({exc}); no baseline written"
        ) from exc
    tests = 0
    failed: set[str] = set()
    errors: set[str] = set()
    skipped: set[str] = set()
    prefix = repo.resolve().as_posix() + "/"
    for case in root.iter("testcase"):
        tests += 1
        classname, name = case.get("classname", ""), case.get("name", "")
        if classname.startswith(prefix):
            # ruff writes the absolute file path; an id must survive a checkout elsewhere.
            classname = classname[len(prefix) :]
        case_id = f"{classname}::{name}" if classname else name
        if case.find("failure") is not None:
            failed.add(case_id)
        elif case.find("error") is not None:
            errors.add(case_id)
        elif case.find("skipped") is not None:
            skipped.add(case_id)
    return {
        "tests": tests,
        "failed_ids": sorted(failed),
        "error_ids": sorted(errors),
        "skipped_ids": sorted(skipped),
    }


def workspace(repo: Path) -> set[str]:
    return set(changed_paths(repo))


def tail(text: str) -> str:
    lines = text.splitlines()
    return "\n".join(lines[-TAIL_LINES:])


def run_check(repo: Path, check: Check, timeout: int, ignore_prefix: str = "") -> Observation:
    """Run the declared command verbatim and read back what it produced.

    Raises ReadinessError — and writes nothing — when the run times out or the declared
    report was not produced: a result that cannot be identified must not become a baseline.
    """
    report_path = repo / check.report if check.report else None
    if report_path is not None:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        if report_path.exists():
            report_path.unlink()
    before = workspace(repo)
    started = time.monotonic()
    try:
        proc = subprocess.run(
            check.command,
            shell=True,
            cwd=repo,
            capture_output=True,
            text=True,
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ReadinessError(
            f"{check.name}: timed out after {timeout}s; no baseline written"
        ) from exc
    duration = round(time.monotonic() - started, 1)
    output = tail(proc.stdout + proc.stderr)
    if output:
        print(output)
    mutated = sorted(
        p
        for p in before ^ workspace(repo)
        if p != check.report
        and not p.startswith("tmp/")
        and not (ignore_prefix and p.startswith(ignore_prefix))
    )
    results = None
    if check.report:
        if report_path is None or not report_path.is_file():
            raise ReadinessError(
                f"{check.name}: declared report {check.report} was not produced "
                f"(exit {proc.returncode}); no baseline written"
            )
        results = parse_junit(report_path, repo)
    return Observation(proc.returncode, duration, results, mutated)


def baselines_dir(repo: Path, home: str | None = None) -> Path:
    return sr_home(repo, home) / BASELINES_REL


def state_prefix(repo: Path, home: str | None = None) -> str:
    """The runner's own output directory, repo-relative — not a side effect of a check."""
    return baselines_dir(repo, home).resolve().relative_to(repo.resolve()).as_posix() + "/"


def load_baselines(repo: Path, home: str | None = None) -> dict[str, dict]:
    directory = baselines_dir(repo, home)
    found: dict[str, dict] = {}
    if not directory.is_dir():
        return found
    for path in sorted(directory.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError as exc:
            raise ReadinessError(f"unreadable baseline {path.name}: {exc}") from exc
        if data.get("schema_version") not in KNOWN_BASELINE_SCHEMAS:
            raise ReadinessError(
                f"baseline {path.name} has schema_version {data.get('schema_version')!r}; "
                f"this runtime knows {KNOWN_BASELINE_SCHEMAS}"
            )
        found[path.stem] = data
    return found


def current_fingerprint(
    repo: Path, home: str | None, name: str
) -> tuple[str, dict[str, str]] | None:
    """The fingerprint a check would get now, or None when its check file is gone."""
    check = declared_checks(repo, home).get(name)
    return fingerprint(repo, check) if check else None


def changed_inputs(recorded: dict[str, str], current: dict[str, str]) -> list[str]:
    return sorted(p for p in set(recorded) | set(current) if recorded.get(p) != current.get(p))


def failure_set(results: dict | None) -> set[str]:
    if not results:
        return set()
    return set(results.get("failed_ids", [])) | set(results.get("error_ids", []))


def delta(baseline: dict, observation: Observation) -> dict[str, list[str]]:
    """new / resolved / unchanged failures, by identity — never by count."""
    if baseline.get("report", {}).get("kind") == "junit" and observation.results is not None:
        before, after = failure_set(baseline.get("results")), failure_set(observation.results)
        new = sorted(after - before)
        # What the report cannot show: a command that failed outside its tests (a compound
        # command, a collection error) or a run that collected nothing where tests existed.
        if observation.exit_code != 0 and baseline.get("exit_code", 0) == 0 and not new:
            new.append("exit-code")
        if observation.results.get("tests", 0) == 0 and (baseline.get("results") or {}).get(
            "tests", 0
        ):
            new.append("no-tests-ran")
        return {
            "new": new,
            "resolved": sorted(before - after),
            "unchanged": sorted(before & after),
        }
    # exit-only: the one identity is whether the command fails at all.
    before_fails, after_fails = baseline.get("exit_code", 0) != 0, observation.exit_code != 0
    return {
        "new": ["exit-code"] if after_fails and not before_fails else [],
        "resolved": ["exit-code"] if before_fails and not after_fails else [],
        "unchanged": ["exit-code"] if before_fails and after_fails else [],
    }


def summary(observation: Observation) -> str:
    if observation.results is None:
        return f"exit {observation.exit_code} (exit-only)"
    r = observation.results
    return (
        f"exit {observation.exit_code}, {r['tests']} tests, {len(r['failed_ids'])} failed, "
        f"{len(r['error_ids'])} errors, {len(r['skipped_ids'])} skipped"
    )


def cmd_baseline(
    repo: Path, home: str | None, names: list[str], reason: str | None, timeout: int
) -> int:
    checks = declared_checks(repo, home)
    existing = load_baselines(repo, home)
    directory = baselines_dir(repo, home)
    rc = 0
    for name in names:
        check = checks.get(name)
        if check is None:
            print(f"FAIL  {name}: no check file under {sr_home(repo, home) / CHECKS_REL}")
            rc = 1
            continue
        previous = existing.get(name)
        if previous and not (reason or "").strip():
            print(
                f"FAIL  {name}: a baseline exists (revision {previous.get('revision', '')[:12]}, "
                f"observed {previous.get('observed_at')}). Re-taking it needs --reason; "
                "'newer' is not one."
            )
            rc = 1
            continue
        print(f"run   {name}: {check.command}")
        try:
            fingerprint(repo, check)  # a bad Invalidation path fails before the run, not after
            # The runner's own output directory is not a side effect of the check.
            observation = run_check(repo, check, timeout, state_prefix(repo, home))
            digest, inputs = fingerprint(repo, check)
        except ReadinessError as exc:
            print(f"FAIL  {exc}")
            rc = 1
            continue
        record = {
            "schema_version": BASELINE_SCHEMA,
            "suite_version": suite_version(),
            "check": name,
            "check_file": check.path.resolve().relative_to(repo.resolve()).as_posix(),
            "command": check.command,
            "revision": git(repo, "rev-parse", "HEAD"),
            "observed_at": datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds"),
            "duration_seconds": observation.duration,
            "exit_code": observation.exit_code,
            "report": {"kind": "junit", "path": check.report}
            if check.report
            else {"kind": "exit-only"},
            "results": observation.results,
            "fingerprint": digest,
            "fingerprint_inputs": inputs,
            "mutated_paths": observation.mutated_paths,
            "reason": reason or None,
            "supersedes": {
                "revision": previous.get("revision"),
                "observed_at": previous.get("observed_at"),
                "failed": len(failure_set(previous.get("results")))
                if previous.get("results") is not None
                else None,
            }
            if previous
            else None,
        }
        directory.mkdir(parents=True, exist_ok=True)
        target = directory / f"{name}.json"
        target.write_text(json.dumps(record, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        print(f"ok    {name}: {summary(observation)} -> {target.relative_to(repo)}")
        if observation.mutated_paths:
            print(
                f"WARNING  {name} changed the working tree: "
                + ", ".join(observation.mutated_paths[:10])
            )
    return rc


def cmd_compare(repo: Path, home: str | None, names: list[str], timeout: int) -> int:
    checks = declared_checks(repo, home)
    baselines = load_baselines(repo, home)
    selected = names or sorted(baselines)
    if not selected:
        print(f"FAIL  no baseline under {baselines_dir(repo, home)}; nothing to compare against")
        return 1
    rc = 0
    rows: list[tuple[str, str, str, str]] = []
    for name in selected:
        baseline, check = baselines.get(name), checks.get(name)
        if baseline is None:
            print(f"FAIL  {name}: no baseline recorded")
            rc = 1
            continue
        if check is None:
            print(f"FAIL  {name}: baseline exists but its check file is gone")
            rc = 1
            continue
        try:
            digest, inputs = fingerprint(repo, check)
        except ReadinessError as exc:
            print(f"FAIL  {exc}")
            rc = 1
            continue
        if digest != baseline.get("fingerprint"):
            changed = changed_inputs(baseline.get("fingerprint_inputs", {}), inputs)
            print(
                f"FAIL  {name}: baseline is stale ({', '.join(changed)}); re-baseline with --reason"
            )
            rc = 1
            continue
        print(f"run   {name}: {check.command}")
        try:
            observation = run_check(repo, check, timeout, state_prefix(repo, home))
        except ReadinessError as exc:
            print(f"FAIL  {exc}")
            rc = 1
            continue
        diff = delta(baseline, observation)
        if diff["new"]:
            rc = 1
        rows.append(
            (
                name,
                ", ".join(diff["new"]) or "none",
                ", ".join(diff["resolved"]) or "none",
                str(len(diff["unchanged"])),
            )
        )
    if rows:
        print("\n## Baseline delta\n")
        print("| Check | New | Resolved | Unchanged |")
        print("|---|---|---|---|")
        for row in rows:
            print("| " + " | ".join(row) + " |")
    return rc


def project_state(repo: Path, home: str | None) -> tuple[str, list[str]]:
    home_dir = sr_home(repo, home)
    bound = (home_dir / ".sr-manifest.json").exists() and (home_dir / "local/project.md").exists()
    if not bound:
        return "UNBOUND", [f"no manifest or no local/project.md under {home_dir}"]
    checks = declared_checks(repo, home)
    baselines = load_baselines(repo, home)
    lines: list[str] = []
    all_current = bool(checks)
    for name, check in checks.items():
        baseline = baselines.get(name)
        if baseline is None:
            lines.append(f"missing   {name}")
            all_current = False
            continue
        try:
            digest, inputs = fingerprint(repo, check)
        except ReadinessError as exc:
            lines.append(f"invalid   {name}  ({exc})")
            all_current = False
            continue
        if digest == baseline.get("fingerprint"):
            lines.append(
                f"current   {name}  (revision {baseline.get('revision', '')[:12]}, "
                f"{baseline.get('observed_at')})"
            )
        else:
            changed = changed_inputs(baseline.get("fingerprint_inputs", {}), inputs)
            lines.append(f"stale     {name}  ({', '.join(changed)})")
            all_current = False
    for name in sorted(set(baselines) - set(checks)):
        lines.append(f"orphan    {name}  (baseline with no check file)")
    if not baselines:
        return "BOUND", lines
    return ("BASELINED" if all_current else "OBSERVABLE"), lines


def cmd_status(repo: Path, home: str | None) -> int:
    state, lines = project_state(repo, home)
    print(f"project   {state}")
    for line in lines:
        print(line)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["baseline", "compare", "status"])
    parser.add_argument("--repo", default=".", help="Repository root")
    parser.add_argument(
        "--home",
        default=None,
        help="SR home relative to the repository "
        f"(default: the directory this file is installed in, else {DEFAULT_HOME})",
    )
    parser.add_argument(
        "--check",
        action="append",
        default=[],
        metavar="NAME",
        help="Check to run, by file name under local/checks/ (repeatable). "
        "Required for baseline; compare defaults to every baselined check",
    )
    parser.add_argument(
        "--reason",
        default=None,
        help="Why an existing baseline is being replaced. Required to overwrite one",
    )
    parser.add_argument(
        "--timeout", type=int, default=DEFAULT_TIMEOUT, help="Seconds per check command"
    )
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    if args.home and Path(args.home).is_absolute():
        parser.error("--home is relative to the repository")
    if not (sr_home(repo, args.home) / "core").is_dir():
        raise SystemExit(
            f"No SR home at {sr_home(repo, args.home)} (no core/). Is the SR suite installed here?"
        )
    try:
        if args.command == "baseline":
            if not args.check:
                parser.error("baseline needs at least one --check NAME; it never runs everything")
            return cmd_baseline(repo, args.home, args.check, args.reason, args.timeout)
        if args.command == "compare":
            return cmd_compare(repo, args.home, args.check, args.timeout)
        return cmd_status(repo, args.home)
    except ReadinessError as exc:
        print(f"FAIL  {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
