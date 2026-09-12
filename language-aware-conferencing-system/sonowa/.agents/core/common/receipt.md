# SR Verification Receipt

The receipt is the durable record that a workflow actually finished, against a specific
revision, with checks that actually ran. It is written to the `receipt` destination
resolved through `./artifact-map.md`.

The approval block in `./approval-gate.md` is what a human reads at the gate. The receipt
is what survives the conversation.

## Content

```markdown
# SR Receipt — <workflow> / <phase>

Schema-Version: 2
Task: <Trellis task path/id>
Revision: <commit at which this phase completed>
Diff base: <the fixed base this phase was reviewed against>
Result: passed | blocked | superseded
Author: <who did the work>
Reviewer: <who reviewed it — never the same as Author>
Test strategy: <specification-tdd, test-on-touch, regression-first, characterization-invariance, differential — comma-separated>

## Envelope

| Class | Path or pattern | Disposition |

## Checks

| Check | Command | Result |

## Baseline delta

| Check | New | Resolved | Unchanged |

## Acceptance criteria

| Criterion | Evidence | Result |

## Criterion to RED

| Criterion | Task | RED test | RED at | GREEN at |

## Module design

| Module | Disposition | Target | Basis |

## Design artifacts

| Artifact | Path |

## Unknowns carried forward

| Unknown | What would resolve it |

## Decisions requiring human authority

| Decision | Who decided | When |
```

`Schema-Version` names the shape this receipt was written to; the current one is `2`. A
receipt without the field predates it and is read as legacy — the guard accepts the two
disposition words such receipts actually used (`add`, `behavior-preserving`), a `Criterion
to RED` that points at the document holding the table, and the absence of `Test strategy`
— and it skips the baseline check, in a project that has no recorded baseline. Baselines
exist only from 5.1.0 on, so where any is recorded a receipt written now cannot be a legacy
one: the field is required. A version the guard does not know is refused, not interpreted
by guessing. Old receipts are never
rewritten to the current schema; a new phase writes a new receipt.

`Result` is one of exactly `passed`, `blocked`, `superseded`. Any other word disables the
cross-checks below, so the guard rejects it rather than accepting a synonym.

The envelope table carries every class from `./change-envelope.md`, including the
`FORBIDDEN` patterns — that is what makes the envelope checkable after the fact rather
than a claim in a report. `DEPENDENCY_REQUIRED` and `INCIDENTAL` rows carry a
`Disposition` of either `child:<task>` or `behavior-preserving:<why>`; see
`./change-envelope.md`.

Every check row names the command from `.agents/local/checks/` that produced it. A check that
could not run is recorded as not run, with the blocker. It is never recorded as passed.

Every criterion row carries evidence a reviewer can open — a path, a command with its
output, a test id. A criterion whose evidence column is empty, `-`, or `(none)` is not
passed, whatever the result column says. This is the row where "we wrote the function"
gets separated from "the product does it".

`Baseline delta` is the output of `.agents/runtime/sr_readiness.py compare`, pasted: for
every recorded project baseline, which failure ids are new, which were resolved, how many
are unchanged. What the guard requires of it is G-6 in `./guard.md`; what an id means is
`./readiness.md`.

`Test strategy` names which kind of evidence was primary, from `./test-evidence.md`. A
receipt whose `Criterion to RED` table has rows is one that built code, and the guard
requires the field on it. When
`differential` is named, the guard also requires either a `differential` check that ran or
an unknown saying why the comparison could not be made. Equivalence between two
implementations is not established by the new one's own tests.

`Criterion to RED` is the decomposition and the test order in one table. The guard
requires it to cover the acceptance criteria exactly — no criterion without a task, no
task claiming a criterion that does not exist, no task appearing twice — and rejects a row
that records GREEN with no RED revision. See `./decomposition.md` and `./test-evidence.md`.

`Module design` carries one row per module derived from the envelope, dispositioned `new`,
`update`, `delete` or `unchanged`. `unchanged` needs a basis; `new` and `update` need a
target document. See `./closeout.md`.

`Design artifacts` records where each PLAN artifact ended up. The guard opens them and
rejects a required section that exists but is empty — an outline is not a design.

`Diff base` is the fixed base the review ran against. The guard also uses it to look for
suppressions introduced by this change.

An unresolved unknown does not prevent a receipt; claiming there are none does. When
`Result` is `passed`, the guard requires the unknowns table to have at least one row —
"none remaining, because <what was verified>" is a row.

## Author and Reviewer

`Author` and `Reviewer` are required when `Result` is `passed`, and must differ. For an AI
workflow, name the model or agent, not the person operating it — the point is that the
judgment came from somewhere other than the process being judged. `./review.md` explains
why this is a floor rather than a preference.

## Revision binding

```text
receipt revision == current revision
```

If the working revision has moved past the receipt, the receipt is stale and the work
cannot be finished on it. Re-verify at the current revision and write a new receipt.

`.agents/runtime/sr_guard.py check` enforces this from the repository state.

## Measurement metadata

Optional, and local only. Record what the repository can produce honestly:

```text
task type          human decision count      checks run
risk level         review blocking findings  final result
start / finish     rework cycles             revision
```

Token or model cost is recorded only when the host exposes it. Missing metadata never
fails a workflow — an absent field is absent, not zero.

## Telemetry

Nothing leaves the repository. No source, no workflow content, no metrics are sent
anywhere by default. Aggregating receipts across tasks, or exporting them, is an explicit
action a human takes, not a side effect of running a workflow.

The suite carries no productivity target. There is no number this workflow is trying to
hit, and a receipt that seems to argue one is being written wrong. Improvement is measured
against the repository's own history, by the people who own it.
