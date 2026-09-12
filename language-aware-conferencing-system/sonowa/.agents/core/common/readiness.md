# SR Readiness

What a repository can prove about a change before the change is made, and what a task has
to have in hand before implementation starts. Two layers, one file.

```text
Project readiness   the repository: which checks run, what they report today, under
                    which dependencies and configuration — observed, not declared
Task readiness      this task: goal, current evidence, a seam that can fail, a
                    boundary — decided at the PLAN gate, not by a runner
```

Readiness is a precondition, not a lifecycle. Trellis owns the task; SR owns the workflow;
this file says what has to be true before either proceeds. Nothing here creates a second
task store, a second supervisor, or a ledger of facts.

## Declaration and observation are different files

```text
.agents/local/checks/unit.md                   "this is the command"     — a human wrote it
.agents/state/readiness/baselines/unit.json    "this is what it did"     — the runner wrote it
```

`sr_init.py` detects what probably exists and writes the declaration. `sr_readiness.py` runs
the declared command — verbatim, never rewritten — and writes the observation. `sr_guard.py`
reads both and executes nothing but git (AUDIT.md, v3.0.0: the guard does not run checks;
that decision stands). The trust behind a baseline is the same as behind a human typing
the command: the check file is `sr-local`, owned by the repository, never overwritten.

## Project state

```bash
python3 .agents/runtime/sr_readiness.py status
```

| State        | Meaning                                                                           |
| ------------ | --------------------------------------------------------------------------------- |
| `UNBOUND`    | No manifest or no `local/project.md` — the suite is not bound here                |
| `BOUND`      | Bound, nothing observed yet                                                       |
| `OBSERVABLE` | At least one baseline exists; some declared checks have none, or one is stale     |
| `BASELINED`  | Every declared check has a current baseline                                       |

Per check, `status` says `current`, `stale` (naming the files that changed), `missing`, or
`orphan` (a baseline whose check file is gone). These four states are facts a runner can
establish. Whether the repository is *ready for this task* is not one of them — see Task
readiness below.

`install.py --doctor` stays the configuration check: manifest, binding, zones, and now the
readiness files themselves (a baseline in an unknown schema, a declared report the command
never writes). `doctor == OK` says the suite is configured. `status == BASELINED` says the
checks were observed. Neither says the change is safe.

## The check file, extended

```markdown
<!-- sr-local -->
# unit

    pytest --junitxml tmp/junit-unit.xml

Report: junit tmp/junit-unit.xml
Invalidation: environment.yml
Pass: exit 0.
Baseline: see .agents/state/readiness/baselines/unit.json
```

- The command is the first indented line, as before. The runner does not add flags to it;
  if a JUnit report is wanted, the command asks for one.
- `Report: junit <path>` names the machine-readable result the command writes. It is the
  only report kind: pytest, ruff, mypy, Maven, Gradle, jest and go all produce it, so one
  parser covers them. A check without `Report:` is `exit-only` — its one identity is
  whether the command fails at all.
- `Invalidation:` adds files whose change makes the baseline incomparable, beyond the
  defaults (dependency manifests, lockfiles, tool configuration, and the check file itself).
  Each has to be a file that exists: a typo or a directory would hash as `missing` on both
  sides and never go stale, so the runner refuses it before the command runs.

## Baseline

```bash
python3 .agents/runtime/sr_readiness.py baseline --check unit --check lint
```

A baseline is a measurement at a revision under a fingerprint. It holds test ids, counts,
hashes and an exit code. It holds no output: nothing a check printed is stored, so nothing
a check printed can be committed with it. Baselines live under `state/readiness/` and are
tracked like receipts — a record of what failed at revision X is durable evidence, and a
reviewer who cannot open it cannot check the delta.

Identity, not count:

```text
before: {a, b, c, d, e}   after: {a, b, c, f, g}
count   5 → 5             regression 0        ← wrong
ids     new {f, g}  resolved {d, e}  unchanged {a, b, c}
```

`compare` re-runs the command and prints exactly that, as the `## Baseline delta` table
the receipt carries. A `new` id is a regression until a row in `Unknowns carried forward`
or `Acceptance criteria` says why it is not; the guard (G-6, `./guard.md`) checks that the
id appears there, and that every recorded baseline appears in the table.

An id is the report's `classname::name`, with the repository path stripped where a tool
(ruff) writes it absolute. Two ids are synthetic, for what the report cannot show:
`exit-code` when the command failed without a failing test (a compound command, a
collection error), and `no-tests-ran` when a run collected nothing where the baseline had
tests. Both are regressions, and are explained like any other id.

A check that writes into the working tree is reported (`mutated_paths`); the runner's own
baseline directory and the declared report are not side effects and are left out.

A declared report that the command did not produce writes no baseline. A run that times out
writes no baseline. A result that cannot be identified is not a measurement.

### Stale

A baseline is stale when its fingerprint no longer matches: a dependency manifest, a
lockfile, a tool configuration, the check file, or an `Invalidation:` path changed. `status`
and `compare` name the files. Moving to a new revision does **not** by itself stale a
baseline — a baseline that expired on every commit could never be the "before" of anything.
Time does not stale it either; a lockfile that changed yesterday does, whatever the date.

What the fingerprint cannot see: a runtime upgraded in place inside the same environment.
Where that matters, the check declares the environment file under `Invalidation:`. And an
id is only as portable as the tool makes it: mypy's per-file ids carry the Python version
and platform, so a baseline taken on one machine reads as all-new on another.

### Re-baseline

```bash
python3 .agents/runtime/sr_readiness.py baseline --check unit --reason "pytest 8 → 9; ids renamed"
```

Replacing a baseline needs `--reason`; "newer" is not one. The new file records the reason
and what it superseded (revision, time, failure count), and the guard prints that on every
receipt that uses it. Whether the reason is good enough — whether a suppression or a weakened
assertion is hiding behind it — is the reviewer's question, and for an R2/R3 change the
approving human's. The runner records; it does not approve.

## Task readiness

Decided in PLAN, recorded in the plan, checked at the BUILD precondition. Five questions;
the workflows already produce the answers to most of them.

| Gate | Holds                                                                                  | Produced by                                  |
| ---- | -------------------------------------------------------------------------------------- | -------------------------------------------- |
| T0   | Goal, business value, in/out of scope, acceptance criteria, non-goals, human authority | PLAN step 2; investigation handoff            |
| T1   | Impact evidence current at the target revision; no stale row; conflicts recorded       | `./impact.md`                                 |
| T2   | A seam that fails when the change is wrong: existing test, characterization, contract, reproduction, critical oracle, compiler | `./test-evidence.md` strategy selection |
| T3   | Change envelope, FORBIDDEN, unknowns classified, assumptions with fallbacks            | `./change-envelope.md`                        |
| T4   | Admission: this project state × this task class                                        | the table below, at the PLAN gate             |

T2 is where a missing seam becomes a plan item — "write the characterization first" — not
an assumption that one exists. T3's unknowns come in three kinds, and only one of them
blocks:

| Unknown      | Treatment                                                                |
| ------------ | ------------------------------------------------------------------------ |
| Blocking     | No implementation. Safety, destruction, public contract, R2/R3 by default |
| Human-owned  | `HUMAN_DECISION_REQUIRED` at the gate                                    |
| Non-blocking | Stated assumption plus a fallback; work continues                        |

### Admission (T4)

| Project state | Task                                       | Admission                          |
| ------------- | ------------------------------------------ | ---------------------------------- |
| `BASELINED`   | Any R0/R1 change                           | `READY`                            |
| `OBSERVABLE`  | Change confined to checks that are current | `READY`                            |
| `OBSERVABLE`  | Change touching a check that is stale or missing | `READY_WITH_ASSUMPTIONS` — the assumption is written down, or the baseline is taken first |
| `OBSERVABLE`  | R2/R3 change                               | `HUMAN_DECISION_REQUIRED`          |
| `BOUND`       | Investigation                              | `READY` — this is what fixes BOUND |
| `BOUND`       | Production code change                     | `DISCOVERY_REQUIRED`               |
| any           | No seam can be built (T2)                  | `BLOCKED` — record what was tried  |

`READY_WITH_ASSUMPTIONS` is a legitimate outcome, and a brownfield repository lives there
for a long time: build passes, twelve unit failures are known by id, e2e is flaky, the
payment contract is strong, the UI has no oracle. An isolated backend fix is admitted; a
UI rewrite is not; both statements are true at once. The admission is per task, never per
repository.

### Existing red is normal

A brownfield repository does not get its failures fixed before SR is allowed to work in
it. The failures get recorded, by id, and every later run is compared against that set.
"Fix the reds first" is a separate approved task, if anyone wants it.

## Which oracle, by project kind

`project_kind` in `.agents/local/project.md` section 12 selects what counts as the
system-level oracle — the thing that catches an outcome regression no unit test sees.

| Kind            | Baseline              | Primary oracle                                          | Normal state                  |
| --------------- | --------------------- | ------------------------------------------------------- | ----------------------------- |
| `greenfield`    | Empty, and that is fine | The first vertical slice's acceptance test; contracts grow from day one | Nothing runs yet |
| `brownfield`    | Existing failures, by id | Characterization on touch; the one to three journeys a failure would be worst in | Constrained |
| `modernization` | The old implementation, captured | `differential` (`./test-evidence.md`): same input through old and new | Equivalence is not correctness |

Not every system has a "journey". The oracle is whatever detects the regression that
matters here:

| System            | Oracle                                        |
| ----------------- | --------------------------------------------- |
| Web application   | A critical user journey                       |
| API service       | Contract plus one representative request       |
| Library           | Public API compatibility plus one example     |
| Batch             | Input → output / database state               |
| Event system      | Message → side effect                         |
| CLI               | Command → exit code, stdout, files            |
| Modernization     | Old / new differential                        |

Count is not a requirement. Greenfield starts at zero and adds one with the first slice;
brownfield starts with the one to three that matter and adds only what pays for itself;
modernization is measured by corpus coverage of the conversion, not by flow count.

## As-is and to-be

Two axes of truth, and they disagree more often than anyone writes down.

```text
as-is  (how it behaves)    runtime trace → reproducible run → source and wiring → tests → docs → AI summary
to-be  (how it should)     approved acceptance criteria → approved spec / contract → ADR → implementation
```

A stale test does not outrank the runtime. A characterization test is as-is, never to-be.
When spec says A, runtime does B and a test expects B, nothing here decides that B is the
specification:

```text
as-is: B      to-be: A      discrepancy: known | unknown      owner: <from section 12>
```

That is a row in the plan's unknowns and a decision for the owner, not a silent edit to
either side. `differential` equivalence has the same shape: old and new agreeing on a bug is
a pass on the comparator and a defect on the product, and the approved list of intentional
differences is where the two are told apart.

## What this file does not introduce

No `.agent/` directory, no knowledge store, no evidence ledger — a fact worth keeping across
tasks goes into `local/project.md` section 11 with the path it was read from
(`./impact.md`). No readiness state beyond the four the runner can establish. No host hook
wiring — the installer generates nothing into a host's configuration, and a checkpoint that
is not wired is reported as not wired (`./guard.md`). No runner for `differential`; the
comparator is the migration's, and SR records whether it ran.
