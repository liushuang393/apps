#!/usr/bin/env python3
"""SR finish-checkpoint guard.

Verifies from repository state alone that a phase may be finished: a receipt exists, it is
bound to the current revision, it does not report success over checks or criteria that
never ran or carry no evidence, it was not reviewed by its own author, every derived case
in the envelope was dispositioned, a phase that built code named the test strategy its
evidence rests on, every project baseline it reports against is current and every new
failure it introduced is accounted for, and nothing forbidden by the envelope was modified.

The guard reads the receipt; it does not run the checks. It can prove a receipt is
internally dishonest. It cannot prove a command was really executed — that is what the
Evidence column, and a reviewer who is not the author, are for. The baselines it compares
against were written by `sr_readiness.py`, which a human ran; the guard reads those files
and recomputes their fingerprint, and still executes nothing but git.

A receipt names the schema it was written to. One without `Schema-Version` predates the
field and is read with the vocabulary of its time; one with an unknown version is refused,
not guessed at.

The other three checkpoints in core/common/guard.md (under the SR home) are workflow
obligations. This one is the checkpoint that does not have to depend on the model following
instructions, which is why it is the one written in code.
"""

# sr-managed v5.3.0
from __future__ import annotations

import argparse
import re
import subprocess
from pathlib import Path

# The SR home is the directory holding core/, local/, runtime/ and state/. The installed copy
# of this file lives in <home>/runtime/, so it derives the home from its own location; the
# suite copy under scripts/ falls back to the default the installer uses.
DEFAULT_HOME = ".agents"
RECEIPT_DEFAULT = "state/receipts"
NOT_RUN = ("not run", "not-run", "blocked", "skipped", "n/a")
# A result cell whose verdict word is a failure. Anchored at the start so "pass (0 errors)"
# is a pass and "failed: 3" is not.
FAILED = re.compile(r"^\W*(fail|failed|failure|failing|error|errored|ng)\b", re.IGNORECASE)
ID_BOUNDARY = r"(?<![\w./:-]){}(?![\w./:-])"
RESULT_VOCABULARY = ("passed", "blocked", "superseded")
NO_EVIDENCE = ("", "-", "—", "(none)", "none", "n/a", "na", "tbd", "todo", "pending", "?")
PASSED_REQUIRES_ROWS = (
    "Envelope",
    "Checks",
    "Acceptance criteria",
    "Unknowns carried forward",
    "Criterion to RED",
    "Module design",
    "Design artifacts",
)
DISPOSITION_VOCABULARY = ("new", "update", "delete", "unchanged")
SCHEMA_CURRENT = "2"
# What receipts written before Schema-Version existed actually contain. Read, never written:
# the current vocabulary stays four words.
LEGACY_DISPOSITIONS = {"add": "new", "behavior-preserving": "unchanged"}
PATH_TOKEN = re.compile(r"[\w.\-]+(?:/[\w.\-]+)+")
STRATEGY_VOCABULARY = (
    "specification-tdd",
    "test-on-touch",
    "regression-first",
    "characterization-invariance",
    "differential",
)
BLANK = ("", "-", "—", "(none)", "none", "n/a", "na", "tbd", "todo", "pending", "?", "なし")
REQUIRED_ARTIFACTS = ("00-requirements.md", "01-basic-design.md", "02-detailed-design.md")
SUPPRESSIONS = re.compile(
    r"(noqa|type:\s*ignore|pragma\s*:|@?pytest\.mark\.(skip|xfail)|\bxfail\b"
    r"|\bTODO\b|\bFIXME\b|\bHACK\b|\bXXX\b)",
    re.IGNORECASE,
)
COMMENT_START = ("#", "//", "*", "/*", "<!--", "--")
DERIVED_CLASSES = ("DEPENDENCY_REQUIRED", "INCIDENTAL")
DISPOSITIONS = ("child:", "behavior-preserving:")


def git(repo: Path, *args: str) -> str:
    result = subprocess.run(["git", *args], cwd=repo, capture_output=True, text=True, check=False)
    return result.stdout.strip("\r\n") if result.returncode == 0 else ""


def sr_home(repo: Path, override: str | None = None) -> Path:
    if override:
        return repo / override
    here = Path(__file__).resolve().parent
    if here.name == "runtime":
        return here.parent
    return repo / DEFAULT_HOME


def receipt_dir(repo: Path, home: str | None = None) -> Path:
    """The `receipt` destination, from project.md section 1 if it maps one."""
    home_dir = sr_home(repo, home)
    binding = home_dir / "local/project.md"
    if binding.exists():
        for line in binding.read_text(encoding="utf-8", errors="replace").splitlines():
            cells = [c.strip().strip("`") for c in line.split("|")]
            if len(cells) >= 4 and cells[1] == "receipt" and cells[2]:
                return repo / cells[2]
    return home_dir / RECEIPT_DEFAULT


def latest_receipt(repo: Path, home: str | None = None) -> Path | None:
    directory = receipt_dir(repo, home)
    if not directory.is_dir():
        return None
    receipts = sorted(directory.glob("*.md"), key=lambda p: p.stat().st_mtime)
    return receipts[-1] if receipts else None


def field(text: str, name: str) -> str:
    # Horizontal whitespace only: `\s*` would cross the newline and read an empty field's
    # value off whatever line came next, so a blank field never looked blank.
    match = re.search(rf"^{name}:[^\S\n]*(.*)$", text, re.MULTILINE)
    return match.group(1).strip() if match else ""


def section_body(text: str, heading: str) -> str:
    match = re.search(rf"^##\s+{heading}\s*$(.*?)(?=^##\s|\Z)", text, re.MULTILINE | re.DOTALL)
    return match.group(1) if match else ""


def section_rows(text: str, heading: str) -> list[list[str]]:
    """Table rows under `## <heading>`, excluding the header and separator rows."""
    rows = []
    for line in section_body(text, heading).splitlines():
        if not line.strip().startswith("|"):
            continue
        cells = [c.strip() for c in line.strip().strip("|").split("|")]
        if not cells or set("".join(cells)) <= set("-: "):
            continue
        rows.append(cells)
    return rows[1:] if rows else []


def glob_to_regex(pattern: str) -> re.Pattern[str]:
    out, i = "", 0
    while i < len(pattern):
        char = pattern[i]
        if pattern.startswith("**/", i):
            out += "(?:.*/)?"
            i += 3
        elif pattern.startswith("**", i):
            out += ".*"
            i += 2
        elif char == "*":
            out += "[^/]*"
            i += 1
        elif char == "?":
            out += "[^/]"
            i += 1
        else:
            out += re.escape(char)
            i += 1
    return re.compile(f"^{out}$")


def changed_paths(repo: Path) -> list[str]:
    porcelain = git(repo, "status", "--porcelain", "--untracked-files=all")
    paths = []
    for line in porcelain.splitlines():
        path = line[3:].strip()
        if " -> " in path:  # rename
            path = path.split(" -> ", 1)[1]
        if path:
            paths.append(path.strip('"'))
    return paths


def blank(cell: str) -> bool:
    return cell.strip().strip("`").lower() in BLANK


def references_red_table(repo: Path, body: str) -> bool:
    """A legacy section that points at the document holding the Criterion-to-RED table.

    The token has to be a file, and the file has to hold a table whose header names RED —
    a path that merely exists is prose, not a table.
    """
    for token in PATH_TOKEN.findall(body):
        if ".." in token:
            continue
        target = repo / token.split("#", 1)[0]
        if not target.is_file():
            continue
        for line in target.read_text(encoding="utf-8", errors="replace").splitlines():
            if line.lstrip().startswith("|") and "RED" in line:
                return True
    return False


def resolve_base(repo: Path, base: str) -> str:
    """The commit `Diff base` names, or '' when it names nothing git can verify.

    Author-controlled text goes to git only after `--end-of-options`, so a cell like
    `--output=x` is a bad ref rather than an argument.
    """
    base = base.strip().strip("`") or "HEAD"
    if base.startswith("-"):
        return ""
    return git(repo, "rev-parse", "--verify", "--quiet", "--end-of-options", f"{base}^{{commit}}")


def baseline_delta_problems(repo: Path, home: str | None, text: str) -> tuple[list[str], list[str]]:
    """G-6: the receipt's Baseline delta against the baselines sr_readiness recorded.

    Returns (problems, notes). Reads the baseline files and recomputes their fingerprints;
    runs no check. With no baseline recorded there is nothing to hold the receipt to, and
    that is said in a note rather than invented into a pass or a fail.
    """
    try:
        import sr_readiness  # same directory as this file, installed or in the suite tree
    except ImportError:
        return ["sr_readiness.py is not beside the guard; Baseline delta cannot be verified"], []
    try:
        baselines = sr_readiness.load_baselines(repo, home)
    except sr_readiness.ReadinessError as exc:
        return [str(exc)], []
    if text is None:
        # Asked only whether baselines exist (a legacy receipt in a baselined project).
        return (["recorded baselines exist"] if baselines else []), []
    rows = section_rows(text, "Baseline delta")
    if not baselines:
        if rows:
            return [
                "Baseline delta names checks but no baseline is recorded under "
                f"{sr_readiness.baselines_dir(repo, home)}"
            ], []
        return [], ["no project baseline recorded; Baseline delta not checked"]
    if not rows:
        return [
            "project baselines are recorded but the receipt carries no '## Baseline delta' rows"
        ], []
    problems: list[str] = []
    notes: list[str] = []
    explained = " ".join(
        " ".join(row)
        for heading in ("Unknowns carried forward", "Acceptance criteria")
        for row in section_rows(text, heading)
    ).lower()
    named: set[str] = set()
    for row in rows:
        name = row[0].strip().strip("`") if row else ""
        named.add(name)
        baseline = baselines.get(name)
        if baseline is None:
            problems.append(f"Baseline delta row '{name}' has no recorded baseline")
            continue
        if len(row) < 4:
            problems.append(f"Baseline delta row '{name}' lacks New / Resolved / Unchanged cells")
            continue
        try:
            current = sr_readiness.current_fingerprint(repo, home, name)
        except sr_readiness.ReadinessError as exc:
            problems.append(str(exc))
            continue
        if current is None:
            problems.append(f"baseline '{name}' has no check file any more")
        elif current[0] != baseline.get("fingerprint"):
            changed = sr_readiness.changed_inputs(
                baseline.get("fingerprint_inputs", {}), current[1]
            )
            problems.append(f"baseline for '{name}' is stale: {', '.join(changed)}")
        for case_id in re.split(r"[,\s]+", row[1]):
            case_id = case_id.strip().strip("`")
            if not case_id or blank(case_id) or case_id == "0":
                continue
            if not re.search(ID_BOUNDARY.format(re.escape(case_id.lower())), explained):
                problems.append(
                    f"new failure '{case_id}' in Baseline delta is not explained in "
                    "Unknowns carried forward or Acceptance criteria"
                )
        if baseline.get("supersedes"):
            notes.append(f"baseline '{name}' was re-taken: {baseline.get('reason')}")
    for name in sorted(set(baselines) - named):
        # A stale or regressed baseline left out of the table would otherwise go unexamined.
        problems.append(f"baseline '{name}' is recorded but absent from Baseline delta")
    return problems, notes


def empty_sections(path: Path) -> list[str]:
    """Headings in a markdown file with nothing but whitespace before the next heading."""
    text = path.read_text(encoding="utf-8", errors="replace")
    lines = text.splitlines()
    heads = [(i, ln.strip()) for i, ln in enumerate(lines) if ln.startswith("#")]
    empty = []
    for pos, (index, heading) in enumerate(heads):
        end = heads[pos + 1][0] if pos + 1 < len(heads) else len(lines)
        body = "".join(lines[index + 1 : end]).strip()
        if not body:
            # A heading whose only content is a deeper heading is a container, not a gap.
            if pos + 1 < len(heads) and heads[pos + 1][1].count("#") > heading.count("#"):
                continue
            empty.append(heading)
    return empty


def added_lines(repo: Path, base: str) -> list[str]:
    """`base` is a verified commit from resolve_base(); an empty diff here means no additions."""
    diff = git(repo, "diff", "--unified=0", base)
    return [ln[1:] for ln in diff.splitlines() if ln.startswith("+") and not ln.startswith("+++")]


def new_suppressions(repo: Path, base: str) -> list[str]:
    """Added lines introducing a suppression with no accompanying statement of what breaks.

    Reads a diff, so a suppression added outside this diff is invisible here. The anti-fake
    review lens is what covers that; this only stops the silent ones.
    """
    findings = []
    lines = added_lines(repo, base)
    for index, line in enumerate(lines):
        match = SUPPRESSIONS.search(line)
        if not match:
            continue
        tail = line[match.end() :]
        # Codes directly after the token are the suppression itself, not an explanation:
        # `[attr-defined]`, `no cover`, `F401`.
        tail = re.sub(r"^\s*\[[^\]]*\]", "", tail)
        tail = re.sub(r"^\s*(no\s+cover|no\s+branch)\b", "", tail, flags=re.IGNORECASE)
        explained = bool(re.sub(r"^[\s:,\[\]A-Z0-9_.-]*", "", tail).strip())
        if not explained:
            above = [ln.strip() for ln in lines[max(0, index - 3) : index]]
            explained = any(
                ln.startswith(COMMENT_START) and len(ln) > 3 and not SUPPRESSIONS.search(ln)
                for ln in above
            )
        if not explained:
            findings.append(line.strip()[:100])
    return findings


def check(repo: Path, home: str | None = None) -> int:
    problems: list[str] = []
    notes: list[str] = []

    receipt = latest_receipt(repo, home)
    if receipt is None:
        print(f"FAIL  no receipt found under {receipt_dir(repo, home)}")
        print(
            "      A phase cannot finish without one. "
            f"See {sr_home(repo, home) / 'core/common/receipt.md'}."
        )
        return 1

    text = receipt.read_text(encoding="utf-8", errors="replace")
    print(f"receipt: {receipt.relative_to(repo)}")

    head = git(repo, "rev-parse", "HEAD")
    if not head:
        # Without a resolvable HEAD nothing below can be bound to anything.
        print(f"FAIL  cannot resolve HEAD in {repo}; is this a git repository with a commit?")
        return 1
    recorded = field(text, "Revision")
    if not recorded:
        problems.append("receipt has no Revision field")
    elif len(recorded) < 7:
        print(f"FAIL  receipt revision '{recorded}' is too short to bind (7+ hex digits)")
        return 1
    elif not (recorded.startswith(head[:7]) or head.startswith(recorded[:7])):
        # The receipt belongs to a revision that is not this one: either a phase closed
        # earlier and the tree has moved on, or the author never re-bound it. Both mean
        # there is no receipt for the work being finished now. The old receipt is not
        # re-judged against today's rules — it was accepted at its own revision, and a
        # list of its formatting differences would only hide the one actionable fact.
        print(f"FAIL  receipt revision {recorded} != current revision {head[:12]}")
        print("      No receipt is bound to the current revision. Write one for this phase;")
        print("      a receipt from an earlier, closed phase is not re-checked.")
        return 1

    schema = field(text, "Schema-Version")
    legacy = schema == "" and not re.search(r"^Schema-Version:", text, re.MULTILINE)
    if not legacy and schema != SCHEMA_CURRENT:
        print(f"FAIL  unknown receipt schema '{schema}' (current: {SCHEMA_CURRENT})")
        print("      A receipt in a schema the guard does not know is refused, not guessed at.")
        return 1
    if legacy:
        notes.append("receipt has no Schema-Version; read as legacy (pre-5.1.0 vocabulary)")
        # Baselines only exist from 5.1.0 on. A receipt written now, in a project that has
        # them, cannot be a receipt of an earlier time — dropping the field is not a way out.
        baselined, _ = baseline_delta_problems(repo, home, None)
        if baselined:
            problems.append(
                "project has recorded baselines; a receipt written now must declare "
                f"Schema-Version: {SCHEMA_CURRENT}"
            )
    # A legacy receipt may point Criterion to RED at the document holding the table.
    red_reference = (
        legacy
        and not section_rows(text, "Criterion to RED")
        and references_red_table(repo, section_body(text, "Criterion to RED"))
    )

    result = field(text, "Result").lower().strip().strip(".")
    if not result:
        problems.append("receipt has no Result field")
    elif result not in RESULT_VOCABULARY:
        # A word outside the vocabulary used to disable every cross-check below.
        problems.append(f"Result '{result}' is not one of {'/'.join(RESULT_VOCABULARY)}")
    passed = result == "passed"

    if passed:
        for heading in PASSED_REQUIRES_ROWS:
            if heading == "Criterion to RED" and red_reference:
                continue
            if not section_rows(text, heading):
                problems.append(f"Result is passed but '## {heading}' has no rows")

        author, reviewer = field(text, "Author"), field(text, "Reviewer")
        if blank(author) or blank(reviewer):
            problems.append("Result is passed without both an Author and a Reviewer")
        elif author.lower() == reviewer.lower():
            problems.append(
                f"Author and Reviewer are the same ({author}); review was not independent"
            )

    for row in section_rows(text, "Checks"):
        name, outcome = row[0], (row[-1].lower() if row else "")
        if not outcome:
            problems.append(f"check '{name}' has no result")
        elif passed and (any(word in outcome for word in NOT_RUN) or FAILED.match(outcome)):
            problems.append(f"receipt says passed while check '{name}' reports '{row[-1]}'")

    for row in section_rows(text, "Acceptance criteria"):
        criterion = row[0]
        outcome = row[-1].lower() if row else ""
        evidence = row[1].strip().strip("`").lower() if len(row) >= 3 else ""
        if not outcome:
            problems.append(f"criterion '{criterion}' has no result")
        elif not passed:
            continue
        elif any(word in outcome for word in NOT_RUN) or FAILED.match(outcome):
            problems.append(
                f"receipt says passed while criterion '{criterion}' reports '{row[-1]}'"
            )
        elif evidence in NO_EVIDENCE:
            problems.append(
                f"criterion '{criterion}' is passed with no evidence a reviewer can open"
            )

    envelope = section_rows(text, "Envelope")
    for row in envelope:
        if len(row) < 2 or row[0].strip().upper() not in DERIVED_CLASSES:
            continue
        if row[1].strip().strip("`()（）").lower() in ("", "-", "—", "none", "なし", "n/a"):
            continue  # "this class is empty" is a legitimate row, not a dispositionless path
        note = row[2].strip().lower() if len(row) >= 3 else ""
        if not any(note.startswith(prefix) for prefix in DISPOSITIONS):
            problems.append(
                f"{row[0].strip()} row '{row[1]}' carries no disposition "
                f"({' or '.join(DISPOSITIONS)}) — a derived case is its own task"
            )

    # G-1  every criterion has exactly one task, every task one criterion, RED before GREEN
    criteria = {row[0].strip() for row in section_rows(text, "Acceptance criteria") if row}
    red_rows = section_rows(text, "Criterion to RED")
    mapped, tasks = set(), []
    for row in red_rows:
        if len(row) < 5:
            problems.append(f"Criterion to RED row '{row[0] if row else ''}' is incomplete")
            continue
        criterion, task, _test, red, green = (c.strip() for c in row[:5])
        mapped.add(criterion)
        tasks.append(task)
        if not blank(green) and blank(red):
            problems.append(
                f"criterion '{criterion}' records GREEN at {green} with no RED revision — "
                "the test did not fail first"
            )
        elif passed and blank(green):
            problems.append(f"criterion '{criterion}' has no GREEN revision; it is not done")
    if passed and not red_reference:
        for criterion in sorted(criteria - mapped):
            problems.append(f"acceptance criterion '{criterion}' has no task")
        for criterion in sorted(mapped - criteria):
            problems.append(
                f"a task maps to criterion '{criterion}', which is not an acceptance criterion"
            )
        for task in sorted({t for t in tasks if tasks.count(t) > 1}):
            problems.append(f"task '{task}' maps to more than one acceptance criterion")

    # G-2  every affected module carries a disposition
    for row in section_rows(text, "Module design"):
        module = row[0].strip() if row else ""
        disposition = row[1].strip().lower() if len(row) >= 2 else ""
        if legacy:
            disposition = LEGACY_DISPOSITIONS.get(disposition, disposition)
        if not disposition:
            problems.append(f"module '{module}' carries no design disposition")
        elif disposition not in DISPOSITION_VOCABULARY:
            problems.append(
                f"module '{module}' disposition '{row[1].strip()}' is not one of "
                + "/".join(DISPOSITION_VOCABULARY)
            )
        elif disposition == "unchanged" and (len(row) < 4 or blank(row[3])):
            problems.append(f"module '{module}' is 'unchanged' with no stated basis")
        elif disposition in ("new", "update") and (len(row) < 3 or blank(row[2])):
            problems.append(f"module '{module}' is '{disposition}' with no target document")

    # G-3  the design artifacts exist and carry no present-but-empty required item
    recorded_artifacts = {}
    for row in section_rows(text, "Design artifacts"):
        if len(row) < 2 or not row[0].strip():
            continue
        recorded_artifacts[row[0].strip()] = row[1].strip().strip("`")
    if passed:
        for name in REQUIRED_ARTIFACTS:
            path_text = recorded_artifacts.get(name, "")
            if blank(path_text):
                problems.append(f"no path recorded for design artifact '{name}'")
                continue
            artifact = repo / path_text.lstrip("/")
            if not artifact.is_file():
                problems.append(f"design artifact '{name}' not found at {path_text}")
                continue
            for heading in empty_sections(artifact):
                problems.append(f"{path_text}: section '{heading}' is present but empty")

    # G-5  a phase that built code names the strategy its evidence rests on
    # (the field arrived in 4.1.0; a legacy receipt without it is not asked for it)
    if passed and not (legacy and not field(text, "Test strategy")):
        declared = field(text, "Test strategy").strip("`")
        names = [s.strip().lower() for s in re.split(r"[,/|]| and ", declared) if s.strip()]
        if not names:
            problems.append(
                "receipt records built code with no Test strategy — one of "
                + "/".join(STRATEGY_VOCABULARY)
            )
        for name in names:
            if name not in STRATEGY_VOCABULARY:
                problems.append(
                    f"Test strategy '{name}' is not one of " + "/".join(STRATEGY_VOCABULARY)
                )
        if "differential" in names:
            # Equivalence between two implementations is not established by the new one's
            # own tests, so naming the strategy has to cost either evidence or an unknown.
            ran = any(
                "differential" in row[0].lower()
                and not any(word in row[-1].lower() for word in NOT_RUN)
                for row in section_rows(text, "Checks")
                if row
            )
            stated = any(
                "differential" in " ".join(row).lower()
                for row in section_rows(text, "Unknowns carried forward")
            )
            if not ran and not stated:
                problems.append(
                    "Test strategy names differential with no differential check that ran, "
                    "and no unknown saying why old and new could not be compared"
                )

    # G-6  every project baseline the receipt reports against is current, and every new
    #      failure it introduced is explained (readiness.md)
    if passed and not legacy:
        found, noted = baseline_delta_problems(repo, home, text)
        problems.extend(found)
        notes.extend(noted)

    # G-4  suppressions introduced without saying what breaks if the checker is obeyed
    base = resolve_base(repo, field(text, "Diff base"))
    if not base:
        problems.append(
            f"Diff base '{field(text, 'Diff base')}' does not name a commit; "
            "suppressions and FORBIDDEN paths cannot be checked"
        )
    else:
        for finding in new_suppressions(repo, base):
            problems.append(f"suppression added with no stated failure: {finding}")

    forbidden = [
        row[1] for row in envelope if len(row) >= 2 and row[0].strip().upper() == "FORBIDDEN"
    ]
    if forbidden and base:
        # Uncommitted changes and everything committed since the diff base.
        changed = set(changed_paths(repo)) | set(
            git(repo, "diff", "--name-only", base).splitlines()
        )
        for pattern in forbidden:
            pattern = pattern.strip().strip("`")
            if not any(ch in pattern for ch in "*?") and (repo / pattern).is_dir():
                pattern = pattern.rstrip("/") + "/**"
            matcher = glob_to_regex(pattern)
            for path in sorted(changed):
                if matcher.match(path):
                    problems.append(f"FORBIDDEN path modified: {path} (matches {pattern})")

    for note in notes:
        print(f"note  {note}")
    if problems:
        for problem in problems:
            print(f"FAIL  {problem}")
        return 1

    print("OK    finish checkpoint holds")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=["check"])
    parser.add_argument("--repo", default=".", help="Repository root")
    parser.add_argument(
        "--home",
        default=None,
        help="SR home relative to the repository "
        f"(default: the directory this file is installed in, else {DEFAULT_HOME})",
    )
    args = parser.parse_args()

    repo = Path(args.repo).resolve()
    home_dir = sr_home(repo, args.home)
    if not (home_dir / "core").is_dir():
        raise SystemExit(f"No SR home at {home_dir} (no core/). Is the SR suite installed here?")
    return check(repo, args.home)


if __name__ == "__main__":
    raise SystemExit(main())
