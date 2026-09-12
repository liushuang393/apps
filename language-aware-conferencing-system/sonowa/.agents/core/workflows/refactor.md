# SR Refactor Workflow

The host adapter loads the base common contract once. Read additional common modules only when the current phase names them.

Artifacts, in `design` under `refactor/`:
`01-characterization.md`, `02-transformation-report.md`, `03-invariance-verification.md`,
plus `evidence`.

Use this workflow when observable behavior must not change and the structure must.
If any observable behavior is meant to change, that part is SR Basic Development, not
this workflow. Do not smuggle a behavior change into a refactor.

## CHARACTERIZE

Do not restructure production code yet.

1. Attach to/create one Trellis task; read `.trellis/spec/`, the target code, its callers, tests, contracts, and any ADR explaining why the current shape exists.
2. State the motivation in terms of a cost being paid today — change cost, defect cluster, duplication, coupling, unreadability — not aesthetics. A refactor with no named cost is not approved work.
3. Establish who consumes the target through `../common/impact.md` — the reverse-consumer layer of the cone is the one that decides whether this refactor is safe — and write the change envelope from `../common/change-envelope.md`. Every dimension should come out `behavior-preserving`; any that does not belongs in SR Basic Development.
4. Define the invariance boundary precisely: which public API, wire contract, database shape, log/metric, timing characteristic, and error behavior must be identical afterwards, and what is explicitly allowed to differ.
5. Inventory existing coverage across that boundary. Where behavior is unproven, write **characterization tests** that assert what the code does today, including behavior that looks wrong. A characterization test is not a specification — mark any surprising assertion so it is not mistaken for intent.
6. Run the new characterization tests green against unmodified code. A characterization test that fails before any change is not characterizing, it is a bug report — stop and hand off to SR Bug.
7. Capture the pre-change baseline into `evidence`: check results from `.agents/local/checks/` taken with `.agents/runtime/sr_readiness.py baseline --check <name>` so failures are recorded by id rather than by count (`../common/readiness.md`), and any performance or output snapshot the invariance boundary includes. Where `project_kind` is `modernization` and the slice replaces one implementation with another, the `differential` strategy in `../common/test-evidence.md` applies.
8. Plan the transformation as an ordered series of individually reversible steps, each one leaving the tests green.
9. Write `01-characterization.md` and stop at gate.

## TRANSFORM

Precondition: approved characterization.

1. Confirm the baseline still reproduces on the current revision.
2. Apply one planned step at a time. After each step run the characterization tests plus the affected checks. Never carry two red steps at once.
3. Prefer mechanical, tool-assisted transformations over hand edits where the language provides them.
4. Do not change behavior, do not fix bugs found on the way, and do not widen the invariance boundary. Record each into `tickets` as a follow-up.
5. If a step cannot keep the tests green, revert that step and re-plan. Do not weaken or delete a characterization test to make a step pass — that erases the only proof the refactor is safe.
6. Delete what the restructuring made dead, but only what this change orphaned.
7. Run the review in `../common/review.md` against a fixed diff base. For this workflow the Correctness lens is behavior identity, and the Architecture lens asks whether the named cost actually went down and whether the result is simpler than what it replaced.
8. Run the applicable checks from `.agents/local/checks/` and required CI.
9. Write `02-transformation-report.md` with the step sequence, what each step moved, follow-ups raised, and any step that was reverted. Stop at gate.

## VERIFY & PROVE INVARIANCE

Precondition: approved transformation.

1. Verify revision has not drifted.
2. Use Trellis's verification/check workflow.
3. Re-run the full characterization suite and the full set of checks in `.agents/local/checks/` plus required CI.
4. Compare post-change evidence against the pre-change baseline item by item across the declared invariance boundary — `.agents/runtime/sr_readiness.py compare` for the checks, by failure id, its table into the receipt's `Baseline delta` — public API, wire contract, data shape, logs/metrics, error behavior, performance where declared. Report differences, including ones judged acceptable, rather than only reporting "no change".
5. Confirm every consumer identified in CHARACTERIZE still compiles, passes, and behaves identically.
6. State plainly whether the named cost went down, with the measure used.
7. If behavior did drift, invalidate TRANSFORM approval and return to TRANSFORM. If the drift turns out to be desirable, that is a new specification decision — hand off to SR Plan.
8. Decide the fate of the characterization tests: promote the ones that encode real intent into the normal suite, and retire the ones that only pinned incidental behavior.
9. Run `../common/closeout.md` and the receipt in `../common/receipt.md`, write `03-invariance-verification.md`, run the finish checkpoint in `../common/guard.md`, and stop at final gate.
10. After `APPROVE`, Trellis finish/archive. Hosted-Git handoff is a separate authorization.
