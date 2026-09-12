# SR Basic Development — PLAN View

Required for this invocation: `./basic-common.md`, `../common/impact.md`,
`../common/change-envelope.md`, `../common/requirement-interaction.md`,
`../common/design-artifacts.md`, `../common/decomposition.md`,
`../common/test-evidence.md`, and `../common/readiness.md`. Read
`../common/dispatch.md` only if a bounded read is delegated.

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
