#!/usr/bin/env python3
"""SR entrypoint の静的コンテキスト面を再現可能に測定する。"""

# sr-managed v5.3.0
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import re
import sys
from pathlib import Path
from typing import Any

DEFAULT_HOME = ".agents"
ESTIMATE_METHOD = "ceil(utf8_bytes/4)"
EXPECTED_ENTRYPOINTS = {
    "sr-route",
    "sr-plan",
    "sr-build",
    "sr-verify",
    "sr-refactor",
    "sr-bug",
    "sr-scan",
    "sr-e2e",
    "sr-investigate",
}
PROFILE_RE = re.compile(r"<!-- sr-context-profile (\{.*\}) -->")
BACKTICK_RE = re.compile(r"`([^`]+\.md)`")
HEADING_RE = re.compile(r"^## (.+)$", re.MULTILINE)


def _load_installer(source: Path) -> Any:
    """source tree の installer を副作用なしで読み込む。"""
    scripts = source / "scripts"
    sys.path.insert(0, str(scripts))
    spec = importlib.util.spec_from_file_location("sr_budget_install", scripts / "install.py")
    if spec is None or spec.loader is None:
        raise ValueError(f"cannot load installer from {scripts}")
    module = importlib.util.module_from_spec(spec)
    sys.modules["sr_budget_install"] = module
    spec.loader.exec_module(module)
    return module


def _profile(adapter: str) -> dict[str, Any]:
    match = PROFILE_RE.search(adapter)
    if not match:
        raise ValueError("adapter has no sr-context-profile")
    return json.loads(match.group(1))


def _metrics(labels: set[str], documents: dict[str, str]) -> dict[str, Any]:
    selected = [documents[label] for label in sorted(labels)]
    byte_count = sum(len(text.encode("utf-8")) for text in selected)
    return {
        "bytes": byte_count,
        "characters": sum(len(text) for text in selected),
        "lines": sum(len(text.splitlines()) for text in selected),
        "estimated_tokens": math.ceil(byte_count / 4),
        "files": sorted(labels),
    }


def _logical_ref(token: str, origin: str, home: str) -> str | None:
    normalized = token.replace(".agents", home).lstrip("/")
    if normalized == f"{home}/local/project.md":
        return "local/project.md"
    core_prefix = f"{home}/core/"
    if normalized.startswith(core_prefix):
        return "core/" + normalized[len(core_prefix) :]
    if token.startswith("../common/"):
        return "core/common/" + token.removeprefix("../common/")
    if token.startswith("./"):
        parent = Path(origin).parent
        return (parent / token.removeprefix("./")).as_posix()
    return None


def _refs(text: str, origin: str, home: str) -> set[str]:
    return {
        label
        for token in BACKTICK_RE.findall(text)
        if (label := _logical_ref(token, origin, home)) is not None
    }


def _required_preamble_refs(text: str, origin: str, home: str) -> tuple[set[str], set[str]]:
    preamble = text.split("\n## ", 1)[0]
    required: set[str] = set()
    conditional: set[str] = set()
    in_required = False
    for line in preamble.splitlines():
        if line.startswith("Required for this invocation:"):
            in_required = True
        elif in_required and not line.strip():
            in_required = False
        if not in_required:
            continue
        target = conditional if "only if" in line.lower() else required
        target.update(_refs(line, origin, home))
    return required, conditional


def _sections(text: str) -> tuple[dict[str, str], str]:
    """大文字の H2 を phase とし、説明用 H2 は条件付き本文として分離する。"""
    matches = list(HEADING_RE.finditer(text))
    if not matches:
        return {"WORKFLOW": text}, ""
    phases: dict[str, str] = {}
    conditional_sections: list[str] = []
    for index, match in enumerate(matches):
        name = match.group(1)
        body = text[
            match.end() : matches[index + 1].start() if index + 1 < len(matches) else None
        ]
        if any(character.isalpha() for character in name) and name == name.upper():
            phases[name] = body
        else:
            conditional_sections.append(body)
    return phases or {"WORKFLOW": text}, "\n".join(conditional_sections)


def _reachable(seed: set[str], documents: dict[str, str], home: str) -> set[str]:
    """trigger 時に到達し得る明示参照を固定点まで展開する。"""
    result = set(seed)
    queue = list(seed)
    while queue:
        label = queue.pop()
        text = documents.get(label)
        if text is None:
            continue
        for ref in _refs(text, label, home):
            if ref in documents and ref not in result:
                result.add(ref)
                queue.append(ref)
    return result


def _entry_report(
    adapter: str,
    profile: dict[str, Any],
    documents: dict[str, str],
    home: str,
) -> dict[str, Any]:
    workflow_label = "core/workflows/" + profile["workflow"]
    declared = {"local/project.md", workflow_label}
    declared.update("core/common/" + name for name in profile["base_common"])
    actual = _refs(adapter, "adapter", home)
    if actual != declared:
        missing = sorted(declared - actual)
        extra = sorted(actual - declared)
        raise ValueError(f"adapter/profile dependency mismatch: missing={missing}, extra={extra}")
    unavailable = sorted(actual - documents.keys())
    if unavailable:
        raise ValueError(f"adapter references unavailable documents: {unavailable}")
    required, conditional = _required_preamble_refs(
        documents[workflow_label], workflow_label, home
    )
    # strict は adapter が無条件で要求する面。phase-required は workflow view が
    # その phase の開始時に追加する companion を含む。
    strict = {"adapter"} | actual
    sections, conditional_body = _sections(documents[workflow_label])
    conditional.update(_refs(conditional_body, workflow_label, home))
    selected_phase = profile.get("phase")
    if selected_phase:
        sections = {
            name: body for name, body in sections.items() if name.upper() == selected_phase.upper()
        }
        if not sections:
            raise ValueError(
                f"workflow {profile['workflow']} has no declared phase {selected_phase}"
            )
    phases: dict[str, Any] = {}
    for phase, body in sections.items():
        phase_labels = strict | required | {
            ref for ref in _refs(body, workflow_label, home) if ref in documents
        }
        triggered = _reachable(phase_labels | conditional, documents, home)
        phases[phase] = {
            "phase_required": _metrics(phase_labels, documents),
            "triggered": _metrics(triggered, documents),
        }
    if not phases:
        phases[selected_phase or "WORKFLOW"] = {
            "phase_required": _metrics(strict, documents),
            "triggered": _metrics(_reachable(strict | conditional, documents, home), documents),
        }
    return {
        "workflow": profile["workflow"],
        "fixed_phase": selected_phase,
        "strict": _metrics(strict, documents),
        "phases": phases,
    }


def _report(
    mode: str,
    home: str,
    entries: dict[str, tuple[str, dict[str, Any], dict[str, str]]],
) -> dict[str, Any]:
    output: dict[str, Any] = {}
    for name in sorted(entries):
        adapter, profile, documents = entries[name]
        if profile.get("entrypoint") != name:
            raise ValueError(
                f"adapter entrypoint mismatch: registry={name}, profile={profile.get('entrypoint')}"
            )
        documents = dict(documents)
        documents["adapter"] = adapter
        output[name] = _entry_report(adapter, profile, documents, home)
    return {
        "schema_version": 1,
        "mode": mode,
        "home": home,
        "estimate_method": ESTIMATE_METHOD,
        "estimate_is_measured_usage": False,
        "host_usage_metadata": "absent",
        "entrypoints": output,
    }


def build_source_report(source: Path, home: str = DEFAULT_HOME) -> dict[str, Any]:
    """source を default install と同じ置換後テキストとして測定する。"""
    source = source.resolve()
    installer = _load_installer(source)
    registry = json.loads((source / "registry.json").read_text(encoding="utf-8"))
    if set(registry) != EXPECTED_ENTRYPOINTS:
        missing = sorted(EXPECTED_ENTRYPOINTS - set(registry))
        extra = sorted(set(registry) - EXPECTED_ENTRYPOINTS)
        raise ValueError(f"registry entrypoint mismatch: missing={missing}, extra={extra}")
    version = (source / "VERSION").read_text(encoding="utf-8").strip()
    documents = {
        "core/" + path.relative_to(source / "core").as_posix(): path.read_text(
            encoding="utf-8"
        ).replace(".agents", home)
        for path in sorted((source / "core").rglob("*.md"))
    }
    documents["local/project.md"] = (source / "local-template/project.md").read_text(
        encoding="utf-8"
    ).replace(".agents", home)
    entries: dict[str, tuple[str, dict[str, Any], dict[str, str]]] = {}
    for name, meta in registry.items():
        adapter = installer.claude_cursor_skill(
            name,
            meta["desc"],
            meta["workflow"],
            meta.get("phase"),
            meta["base_common"],
            version,
            home,
        )
        entries[name] = (adapter, _profile(adapter), documents)
    return _report("source", home, entries)


def _installed_adapters(repo: Path) -> dict[str, str]:
    adapters: dict[str, str] = {}
    patterns = (
        ".claude/skills/*/SKILL.md",
        ".cursor/skills/*/SKILL.md",
        ".agents/skills/*/SKILL.md",
    )
    for pattern in patterns:
        for path in sorted(repo.glob(pattern)):
            text = path.read_text(encoding="utf-8")
            match = PROFILE_RE.search(text)
            if not match:
                continue
            name = json.loads(match.group(1))["entrypoint"]
            if name in adapters and _profile(adapters[name]) != _profile(text):
                raise ValueError(f"installed adapters disagree for entrypoint: {name}")
            adapters.setdefault(name, text)
    return adapters


def build_installed_report(
    repo: Path, home: str = DEFAULT_HOME
) -> dict[str, Any]:
    """installer 済み repository の実ファイルを測定する。"""
    repo = repo.resolve()
    documents = {
        "core/" + path.relative_to(repo / home / "core").as_posix(): path.read_text(
            encoding="utf-8"
        )
        for path in sorted((repo / home / "core").rglob("*.md"))
    }
    local = repo / home / "local/project.md"
    if not local.exists():
        raise ValueError(f"installed binding not found: {local}")
    documents["local/project.md"] = local.read_text(encoding="utf-8")
    entries = {
        name: (adapter, _profile(adapter), documents)
        for name, adapter in _installed_adapters(repo).items()
    }
    if not entries:
        raise ValueError(f"no SR adapters with context profiles found in {repo}")
    if set(entries) != EXPECTED_ENTRYPOINTS:
        missing = sorted(EXPECTED_ENTRYPOINTS - set(entries))
        extra = sorted(set(entries) - EXPECTED_ENTRYPOINTS)
        raise ValueError(f"installed entrypoint mismatch: missing={missing}, extra={extra}")
    return _report("installed", home, entries)


def _print_text(report: dict[str, Any]) -> None:
    print(f"mode: {report['mode']}")
    print(f"home: {report['home']}")
    print(f"estimate: {report['estimate_method']} (comparison estimate; not measured usage)")
    print(f"host usage metadata: {report['host_usage_metadata']}")
    print("entrypoint\tbytes\tcharacters\tlines\testimated_tokens")
    for name, entry in report["entrypoints"].items():
        metric = entry["strict"]
        print(
            f"{name}\t{metric['bytes']}\t{metric['characters']}\t{metric['lines']}\t"
            f"{metric['estimated_tokens']}"
        )


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Measure static SR context bytes/chars/lines and a labeled bytes/4 estimate."
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--source", type=Path, help="SR suite source directory")
    group.add_argument("--installed", type=Path, help="Repository containing installed adapters")
    parser.add_argument("--home", default=DEFAULT_HOME, help="Installed SR home (default: .agents)")
    parser.add_argument("--json", action="store_true", help="Emit stable JSON")
    args = parser.parse_args()
    if args.installed:
        report = build_installed_report(args.installed, args.home)
    else:
        source = args.source or Path(__file__).resolve().parents[1]
        report = build_source_report(source, args.home)
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False))
    else:
        _print_text(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
