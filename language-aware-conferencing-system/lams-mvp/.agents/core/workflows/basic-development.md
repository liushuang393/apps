# SR Basic Development Workflow

Read `../common/contract.md`, `../common/method-router.md`, `../common/artifact-map.md`,
`../common/approval-gate.md`, and `../common/closeout.md`.

Per phase: `../common/impact.md`, `../common/change-envelope.md`,
`../common/requirement-interaction.md`, `../common/design-artifacts.md`,
`../common/decomposition.md` and `../common/test-evidence.md` in PLAN;
`../common/guard.md` in BUILD; `../common/review.md`, `../common/anti-fake.md` and
`../common/receipt.md` in VERIFY. `../common/dispatch.md` whenever a sub-agent is used.

Destinations below are logical. Resolve them through `../common/artifact-map.md` and
`.agents/local/project.md`.

Artifacts, in `design`:
`00-requirements.md`, `01-basic-design.md`, `02-detailed-design.md`,
`03-implementation-report.md`, `04-verification-report.md`, plus `evidence`.
What each must contain is `../common/design-artifacts.md`; how it is laid out is the
template set named in `.agents/local/project.md`.

## PLAN

Goal: produce an approved, implementable specification/design without modifying production code.

1. Attach to/create one Trellis task and read relevant `.trellis/spec/`, task history, code, tests, configs, human docs, ADRs, schemas, APIs, dependencies, and UI patterns.
2. Restate goal, business value, in-scope/out-of-scope, measurable acceptance criteria, boundaries, constraints, assumptions, risks, compatibility, and ownership resolved through `../common/zones.md`.
3. Establish impact with `../common/impact.md` — evidence map first, selected source after — and classify the change dimensions in `../common/change-envelope.md`. Each active dimension adds its lens to the coverage you owe.
4. If another requirement or open task touches the same code, classify the interaction using `../common/requirement-interaction.md`. A `CONFLICT` or `UNKNOWN` pair blocks the plan.
5. Write the change envelope: every file this work may modify, classified, plus what is forbidden.
6. Check reuse before proposing new code/dependencies.
7. Resolve repository-answerable questions through investigation. Ask only human-owned decisions.
8. Use architecture/domain/UI/security/research methods when relevant.
9. Define:
   - frontend/backend/API/data ownership and contracts;
   - error/permission/concurrency/idempotency behavior as relevant;
   - migration/recovery/release boundary as relevant;
   - observability/operations as relevant;
   - TDD seams/vertical slices, and the test matrix from `../common/test-evidence.md` —
     level, oracle source, runner, evidence, and whether a human must confirm;
   - E2E/manual UAT only where justified.
10. Produce `00-requirements.md`, `01-basic-design.md` and `02-detailed-design.md` in
    `design`, satisfying `../common/design-artifacts.md`. Decompose into tasks using
    `../common/decomposition.md` — one acceptance criterion, one task — and check the
    decomposition before the gate: no criterion without a task, no task without a
    criterion, no dependency on a task that does not exist.
11. If business behavior changes, update/propose the canonical `business_spec` before approval.
12. Include a traceability table: Acceptance criterion -> design section -> planned
    test/evidence, and start the criterion-to-RED table in `../common/test-evidence.md`.
13. Name the checks this work will have to pass, using the files present in `.agents/local/checks/`. If a needed check kind has no file there, say so in the plan instead of inventing a command. Read the project state from `.agents/runtime/sr_readiness.py status` and record the task's admission (T0–T4) from `../common/readiness.md`: a check this work relies on that has no current baseline is taken first or written down as an assumption, never assumed to exist.
14. Stop at PLAN gate. No production code before `APPROVE`. The approved envelope, the
    interaction classifications, and the test matrix are part of what is approved.

Handoff in: an approved SR Investigation supplies `03-spec-impact-recommendation.md`.
Consume it instead of re-asking questions it already settled.

PLAN approval becomes stale if material requirements, scope, interfaces, data contracts, security rules, or architecture change.

## BUILD

Precondition: approved PLAN, whose task admission (`../common/readiness.md`) is still true:
no baseline the plan relies on has gone stale since.

1. Re-read approved design/spec and verify branch/HEAD has not invalidated assumptions. Evidence bound to a superseded revision is stale — see `../common/impact.md`.
2. Hold the single-writer rule: one writer per asset for the duration of a slice.
3. Search existing project/library/platform capability again before writing new code.
4. Prefer reuse/configuration/removal/simplification when it satisfies the approved design.
5. Before writing any line of a slice, answer three questions and record the answers in
   `03-implementation-report.md`:
   - Does an equivalent capability already exist? Name the paths that were searched. A
     bare "no" is not an answer.
   - Which failing test will drop this acceptance criterion? Name the test file and test
     name. This is the RED declaration.
   - Which existing contract could this break? Confirm nothing outside the envelope is
     required.
     A slice whose three answers are not recorded does not start.
6. Use spec-driven development and TDD for behavior changes:
   - RED: failing executable evidence at the agreed seam, recorded with its revision in
     the criterion-to-RED table. A test that fails for the wrong reason is not RED.
   - GREEN: minimum implementation. GREEN may not be recorded while RED is empty.
   - REFACTOR: improve structure without behavior drift, then re-run affected checks.
     While implementing, the standing design documents in scope are those of the modules the
     envelope touches, and no others (`../common/artifact-map.md`).
7. Bugs discovered during feature work require a regression test. Broad unrelated defects become follow-ups.
8. Keep every edit inside the approved change envelope. A file that turns out to be
   `DEPENDENCY_REQUIRED` is recorded with its reason; `INCIDENTAL` stays at zero.
9. Keep API/FE/BE/data/UI contracts synchronized.
10. Do not silently alter approved public/business behavior. Return to PLAN if needed.
11. Run every check defined in `.agents/local/checks/` that applies, plus required CI. Report each check by name with its command and result.
12. Distinguish baseline from new/worsened warnings/findings.
13. Run the slice checkpoint in `../common/guard.md` at the end of each slice.
14. Produce `03-implementation-report.md` in `design` with changed files against the envelope, reuse decisions, TDD evidence, checks/CI, migrations/config/dependencies, deviations, risks, and revision.
15. Stop at BUILD gate.

If the change is behavior-preserving restructuring rather than new behavior, use the
SR Refactor workflow instead — characterization first, not TDD.

If the change alters existing behavior that no reliable test covers, select
`test-on-touch` from `../common/test-evidence.md`: characterize the touched behavior and
the boundary it crosses first, then RED the intended change against the approved oracle.
Testing the repository, the package, or every class in the module is not a precondition
for the change and is not this workflow's work.

BUILD approval becomes stale if implementation-affecting code/config/dependency/migration/generated artifacts change.

## VERIFY

Precondition: approved BUILD.

1. Verify the exact approved revision against `.trellis/spec/`, PLAN artifacts, acceptance criteria, and final diff.
2. Use Trellis's current verification/check workflow as lifecycle owner.
3. Run the review in `../common/review.md`: nine lenses against a fixed diff base,
   including the anti-fake lens in `../common/anti-fake.md`; review sheet filled with
   evidence before a human sees it; reviewer capability derived from the change and
   resolved through `../common/zones.md`.
4. Run the full set of checks in `.agents/local/checks/` and required CI, and inspect warnings. For every check with a recorded project baseline, run `.agents/runtime/sr_readiness.py compare` and carry its table into the receipt's `Baseline delta`; a `new` failure id needs a reason in the unknowns or the criteria (`../common/readiness.md`).
5. Verify applicable API/FE/BE/UI/data/security/permissions/migration/recovery/compatibility/observability/E2E/manual-UAT dimensions.
6. Build a traceability/evidence table: Acceptance criterion -> implementation -> test/check -> result/evidence.
7. If production/runtime code needs repair, invalidate BUILD approval and return to BUILD; do not silently patch inside VERIFY.
8. If requirement/design scope must change, invalidate PLAN approval and return to PLAN.
9. Reconcile basic/detailed design with the implementation.
10. Run `../common/closeout.md`: experience archive, business/API/ADR/runbook/spec
    documentation disposition, and the module design reconciliation — every module derived
    from the envelope dispositioned as `new` / `update` / `delete` / `unchanged` — then the
    receipt in `../common/receipt.md`.
11. Produce `04-verification-report.md` in `design` with evidence links and final revision.
12. Run the finish checkpoint in `../common/guard.md`, then stop at VERIFY gate.
13. Only after final `APPROVE`, use Trellis finish/archive. Handing the result to a hosted-Git surface is a separate authorization governed by `.agents/local/project.md` section 5.
