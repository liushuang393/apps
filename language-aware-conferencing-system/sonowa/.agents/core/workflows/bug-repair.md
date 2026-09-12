# SR Bug Repair Workflow

The host adapter loads the base common contract once. Read additional common modules only when the current phase names them.

Artifacts, in `design` under `bug/`:
`01-diagnosis.md`, `02-repair-report.md`, `03-verification-and-prevention.md`, plus `evidence`.

## DIAGNOSE

Do not edit production code.

1. Attach to/create one Trellis task; inspect specs, code, tests, config, logs/evidence, human docs, ADRs, recent history, and prior-session memory when useful.
2. Separate symptom, expected behavior, impact/severity, environment, facts, and hypotheses.
3. Build the tightest red-capable feedback loop available. Prefer executable reproduction: unit/integration/E2E, HTTP/CLI/browser harness, trace replay, minimal harness, property/fuzz loop, bisection/differential loop.
4. If no reliable loop can be built, stop with what was tried and the exact access/artifact/instrumentation needed. Do not guess root cause. This is `DISCOVERY_REQUIRED` in `../common/readiness.md`: the task is not admitted to REPAIR until a seam that can fail exists.
5. Reproduce and minimize.
6. Generate multiple falsifiable hypotheses when root cause is not obvious; gather discriminating evidence one variable at a time.
7. Establish root cause/confidence, the correct regression-test seam, and the minimal repair plan. Establish blast radius through `../common/impact.md` and write the change envelope from `../common/change-envelope.md` — a bug fix has an envelope like any other change.
8. For urgent hotfixes, separate temporary containment from root fix and prevention. Temporary mitigation needs risk, monitoring, recovery, and removal/review condition.
9. Write `01-diagnosis.md` and stop at DIAGNOSE gate.

Handoff in: SR E2E supplies failure evidence when a journey proved an application defect.

## REPAIR

Precondition: approved DIAGNOSE.

1. Confirm diagnosis still matches current revision.
2. Regression-first TDD: failing test/evidence -> minimum root-cause fix -> passing test -> cleanup/refactor.
3. Re-run the original un-minimized reproduction loop.
4. Perform controlled horizontal expansion using the root-cause signature across analogous callers/layers/configs/contracts.
5. Classify each candidate: confirmed same defect / suspicious / false positive / out of scope.
6. Do not automatically fix out-of-scope candidates; ask or create follow-up in `tickets`.
7. Run the review in `../common/review.md` against a fixed diff base. The Correctness lens asks whether the intended behavior is restored without scope creep; the Scope lens compares the diff to the envelope.
8. Resolve blocking findings with tests; unrelated review smells become follow-ups unless they block correctness/safety.
9. Run the applicable checks from `.agents/local/checks/` and required CI; remove temporary debug instrumentation. Where a project baseline is recorded, `.agents/runtime/sr_readiness.py compare` says whether the repair introduced a failure the baseline did not have (`../common/readiness.md`).
10. Write `02-repair-report.md` and stop at REPAIR gate.

Handoff out: if the correct behavior itself must change, this is a specification decision.
Stop and hand off to SR Plan. Do not disguise a product decision as a bug fix.

## VERIFY & LEARN

Precondition: approved REPAIR.

1. Verify revision has not drifted.
2. Use Trellis's verification/check workflow.
3. Re-run regression and original reproduction loop plus justified adjacent/cross-layer/E2E checks.
4. Verify horizontal-expansion classifications.
5. Analyze prevention:
   - root-cause category;
   - why prior safeguards failed;
   - missing contract/spec/test/architecture/process signal;
   - same-class risk;
   - prevention mechanism.
6. If code needs further repair, invalidate REPAIR approval and return to REPAIR.
7. Run `../common/closeout.md`: durable lesson to `lessons`, human `business_spec`/`adr`/`runbook` docs, `.trellis/spec/`, follow-ups to `tickets`, then the receipt in `../common/receipt.md`.
8. Write `03-verification-and-prevention.md`, run the finish checkpoint in `../common/guard.md`, and stop at final gate.
9. After final `APPROVE`, Trellis finish/archive. Hosted-Git handoff is a separate authorization.
