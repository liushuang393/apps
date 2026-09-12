"""Sonowa MVP test matrix 同期 CLI (testing-kit テンプレから生成)。

検出パターン:
    - Playwright TS:  ``test('[<DOMAIN>-NNN] ...'``
    - Pytest Python:  関数名 ``def test_<DOMAIN>_NNN_...``

更新ルール:
    - spec に content / negative / DB assertion がある ID → status を ``automated`` に
    - cosmetic/status-only、確認事項、fixme/skip、未解決人間確認がある ID → ``blocked`` に
    - spec で見つからない ID → 既存値維持

``last_run`` は実行結果からのみ更新すべき値なので、この同期 CLI は変更しない。
"""

from __future__ import annotations

import argparse
import csv
import importlib.util
import re
import sys
from collections import defaultdict
from pathlib import Path


APP_NAME = "sonowa"
APP_E2E_ROOT = Path(__file__).resolve().parent.parent
MATRIX_CSV = APP_E2E_ROOT / "docs" / "test-matrix.csv"

# spec をスキャンするルート（app 内に閉じる）
SCAN_DIRS: list[Path] = [
    APP_E2E_ROOT / "smoke",
    APP_E2E_ROOT / "regression",
    APP_E2E_ROOT / "visual",
]

_ID_PATTERN = re.compile(r"\[([A-Z][A-Z0-9]+(?:-[A-Z][A-Z0-9]+)?-\d{3}(?:-[A-Z]\d+)?)\]")
_PYTHON_FUNC_PATTERN = re.compile(r"def\s+test_([A-Z][A-Z0-9]+_\d{3})")
# 確認事項マーカーは全角・半角コロン両対応（regex で strict 化）
_CONFIRM_PATTERN = re.compile(r"(//|#)\s*確認事項[:：]")
# test.fixme / hard test.skip / pytest.mark.skip を含む spec は「実装済み」ではない。
# spec ファイルが存在するだけで blocked→automated に昇格させると占位偽装になる。
_FIXME_PATTERN = re.compile(r"test\.fixme\s*\(|pytest\.mark\.skip")
_HARD_SKIP_PATTERN = re.compile(r"test\.skip\s*\(\s*(?:[`\"']|true\b|\))")
_UNRESOLVED_CONFIRMATION_PATTERN = re.compile(r"^\s*-\s*\[\s\]", re.MULTILINE)

CSV_FIELDS = [
    "id",
    "domain",
    "scenario",
    "type",
    "priority",
    "status",
    "test_file",
    "owner",
    "last_run",
    "notes",
]


def _iter_spec_files() -> list[Path]:
    files: list[Path] = []
    for root in SCAN_DIRS:
        if not root.exists():
            continue
        files.extend(root.rglob("*.spec.ts"))
        files.extend(root.rglob("test_*.py"))
    return files


def _extract_ids_from_file(path: Path) -> tuple[set[str], bool]:
    try:
        content = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        print(f"[{APP_NAME}/sync] read 失敗 {path}: {exc}", file=sys.stderr)
        return set(), False

    ids: set[str] = set()
    for match in _ID_PATTERN.finditer(content):
        ids.add(match.group(1))
    for match in _PYTHON_FUNC_PATTERN.finditer(content):
        ids.add(match.group(1).replace("_", "-"))

    has_confirm = (
        bool(_CONFIRM_PATTERN.search(content))
        or bool(_FIXME_PATTERN.search(content))
        or bool(_HARD_SKIP_PATTERN.search(content))
    )
    return ids, has_confirm


def _testing_kit_scripts_dir() -> Path | None:
    """中央 assertion policy の所在を解決する。見つからなければ fail-closed。"""
    candidates = [Path.cwd(), APP_E2E_ROOT, *APP_E2E_ROOT.parents]
    for base in candidates:
        scripts = base / "testing-kit" / "scripts"
        if (scripts / "check_placeholder_spec.py").exists():
            return scripts
    return None


def _has_business_evidence(path: Path) -> tuple[bool, str]:
    """T01 の共通分類器で real_candidate だけを昇格対象にする。"""
    scripts = _testing_kit_scripts_dir()
    if scripts is None:
        return False, "assertion classifier が見つからない"
    module_spec = importlib.util.spec_from_file_location(
        "testing_kit_check_placeholder_spec",
        scripts / "check_placeholder_spec.py",
    )
    if module_spec is None or module_spec.loader is None:
        return False, "assertion classifier の loader を作成できない"
    module = importlib.util.module_from_spec(module_spec)
    module_spec.loader.exec_module(module)
    classifier = getattr(module, "classify_spec_details", None)
    if not callable(classifier):
        return False, "assertion classifier の API が不正"
    details = classifier(path.read_text(encoding="utf-8", errors="ignore"))
    classification = details["classification"]
    return classification == "real_candidate", classification


def _has_unresolved_human_confirmation() -> bool:
    path = APP_E2E_ROOT / "docs" / "review" / "NEED-HUMAN-CONFIRMATION.md"
    if not path.exists():
        return False
    return bool(_UNRESOLVED_CONFIRMATION_PATTERN.search(path.read_text(encoding="utf-8")))


def _load_matrix() -> list[dict[str, str]]:
    if not MATRIX_CSV.exists():
        return []
    with MATRIX_CSV.open("r", encoding="utf-8", newline="") as fh:
        reader = csv.DictReader(fh)
        return [dict(row) for row in reader]


def _save_matrix(rows: list[dict[str, str]]) -> None:
    MATRIX_CSV.parent.mkdir(parents=True, exist_ok=True)
    with MATRIX_CSV.open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=CSV_FIELDS)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in CSV_FIELDS})


def main() -> int:
    parser = argparse.ArgumentParser(description=f"{APP_NAME} test matrix 同期")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--report-only", action="store_true")
    args = parser.parse_args()

    # ID ごとの主張を全部集めてから決定的に解決する。
    # 旧実装（走査順 first-wins の setdefault）は rglob の非決定順に依存し、
    # SAMPLE spec が実シナリオ ID を名乗った場合に test_file/status を
    # 誤リンクした（2026-06-11 sales_support_platform で実害）。
    spec_claims: dict[str, list[tuple[Path, bool, bool, str]]] = defaultdict(list)
    for spec_path in sorted(_iter_spec_files()):
        ids, has_confirm = _extract_ids_from_file(spec_path)
        has_business_evidence, evidence_reason = _has_business_evidence(spec_path)
        for sid in ids:
            base_id = sid.split("-E")[0] if "-E" in sid else sid
            for key in {base_id, sid}:
                spec_claims[key].append((spec_path, has_confirm, has_business_evidence, evidence_reason))

    spec_ids_by_id: dict[str, tuple[Path, bool, bool, str]] = {}
    for key, claims in spec_claims.items():
        unique_paths = sorted({claim[0] for claim in claims})
        # ファイル名が ID と一致する spec を正とする（重複主張時の決定則）
        preferred = [c for c in claims if c[0].name.split(".")[0] == key]
        chosen = preferred[0] if preferred else claims[0]
        if len(unique_paths) > 1:
            print(
                f"[{APP_NAME}/sync] 警告: ID {key} を複数 spec が主張: "
                f"{[p.name for p in unique_paths]} → {chosen[0].name} を採用",
                file=sys.stderr,
            )
        spec_ids_by_id[key] = chosen

    rows = _load_matrix()
    matrix_ids = {row["id"] for row in rows}
    has_unresolved_human_confirmation = _has_unresolved_human_confirmation()

    for row in rows:
        sid = row["id"]
        if sid in spec_ids_by_id:
            spec_path, has_confirm, has_business_evidence, evidence_reason = spec_ids_by_id[sid]
            try:
                rel = spec_path.relative_to(APP_E2E_ROOT).as_posix()
            except ValueError:
                rel = str(spec_path)
            row["test_file"] = rel
            if has_unresolved_human_confirmation:
                row["status"] = "blocked"
                print(
                    f"[{APP_NAME}/sync] {sid}: 未解決 NEED-HUMAN のため blocked",
                    file=sys.stderr,
                )
            elif has_confirm:
                row["status"] = "blocked"
            elif not has_business_evidence:
                row["status"] = "blocked"
                print(
                    f"[{APP_NAME}/sync] {sid}: {evidence_reason} のため blocked",
                    file=sys.stderr,
                )
            else:
                # 現在の spec が実証可能なら、過去の skip/blocked 状態を残さない。
                # deployment mode ごとの条件 skip は別 mode で実行できるため、
                # stale な matrix status より現行 spec の証拠を正とする。
                row["status"] = "automated"

    summary: dict[str, int] = defaultdict(int)
    for row in rows:
        summary[row.get("status") or "not-automated"] += 1
    summary["total"] = len(rows)

    unregistered = [sid for sid in spec_ids_by_id if sid not in matrix_ids and "-E" not in sid]

    print(f"[{APP_NAME}/sync] {dict(summary)}")
    if unregistered:
        print(
            f"[{APP_NAME}/sync] 警告: matrix 未登録の ID: {unregistered}",
            file=sys.stderr,
        )

    print(f"[{APP_NAME}/sync] 未カバー P1:")
    any_uncovered = False
    for row in rows:
        if row.get("priority") == "P1" and row.get("status") != "automated":
            print(f"  {row['id']} [{row['status']}] {row['scenario']}")
            any_uncovered = True
    if not any_uncovered:
        print("  なし")

    # 改善 9: business-flow と matrix の整合性チェック
    bf_dir = APP_E2E_ROOT / "docs" / "business-flows"
    bf_ids: set[str] = set()
    if bf_dir.exists():
        for md in bf_dir.glob("*.md"):
            m = re.match(r"^([A-Z][A-Z0-9]+(?:-[A-Z][A-Z0-9]+)?-\d{3}(?:-[A-Z]\d+)?)", md.stem)
            if m:
                bf_ids.add(m.group(1))
    md_not_matrix = bf_ids - matrix_ids
    matrix_not_md = matrix_ids - bf_ids
    if md_not_matrix or matrix_not_md:
        print(f"[{APP_NAME}/sync] 整合性:")
        if md_not_matrix:
            print(f"  ⚠ business-flow にあって matrix に無い: {sorted(md_not_matrix)}")
            print("    → matrix に行追加してください")
        if matrix_not_md:
            print(f"  ⚠ matrix にあって business-flow が無い: {sorted(matrix_not_md)}")
            print("    → docs/business-flows/<ID>-*.md を書いてください")

    if not args.dry_run and not args.report_only:
        _save_matrix(rows)
        print(f"[{APP_NAME}/sync] 更新 {MATRIX_CSV.relative_to(APP_E2E_ROOT)}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
