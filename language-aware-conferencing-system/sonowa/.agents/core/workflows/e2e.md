# SR E2E Workflow

The host adapter loads the base common contract once. Read additional common modules only when the current phase names them.

Artifacts, in `design` under `e2e/`:
`01-journey-plan.md`, `02-implementation-report.md`, `03-verification-report.md`, plus `evidence`.

## JOURNEY DESIGN

1. Attach to/create one Trellis task; read business specs, acceptance criteria, existing tests/E2E config, CI, UI/API/auth contracts, flags, and environment docs.
2. Identify business-critical journeys by user/business risk, not coverage percentage. The kind of oracle a system needs — journey, contract, input→output, differential — follows `project_kind` and the system's shape in `../common/readiness.md`; a library or a batch has no "journey" and is not given one.
3. Build the test matrix from `../common/test-evidence.md`: level, oracle source, runner, evidence, and whether a human must confirm. End-to-end is one level among several, and the wrong one for anything a lower seam can prove.
4. **If the repository has no E2E framework** — no `e2e` entry in `.agents/local/checks/` and no existing harness — do not introduce one inside this workflow. Cover the journeys at the highest seam that already exists, record which journeys stay unproven, and raise adopting a framework as separate approved work at the gate.
5. If `.agents/local/project.md` mandates a specific E2E toolchain or authoring procedure, follow it exactly. A repository-mandated procedure overrides this workflow's defaults.
6. Define each E2E with actor, preconditions, actions, observable outcome, critical negative paths, dependencies, and cleanup.
7. Define environment/data/identity/feature-flag/timezone/network strategy and safe isolation.
8. Reuse the existing E2E framework and fixtures before adding a new framework.
9. Define stable locator strategy, browser/device matrix only from real requirements, flake/retry strategy, and evidence policy.
10. If expected business behavior is ambiguous or contradictory, stop and hand off to SR Investigation; do not encode a guess into a test.
11. Write `01-journey-plan.md` and stop at gate.

## IMPLEMENT

Precondition: approved journey design.

1. Build deterministic setup/cleanup and independent/order-insensitive tests.
2. Implement one journey slice at a time.
3. Keep business logic covered at lower seams; do not use slow E2E as the only TDD loop.
4. Wait on observable conditions; do not use arbitrary sleeps as synchronization.
5. Retries are diagnostic/operational, not correctness evidence.
6. Prefer user-facing/accessibility locators; use test IDs only when justified.
7. Keep helpers/page objects shallow enough that the business journey remains readable.
8. Run the review in `../common/review.md` on the changed E2E and support code. Quality here means specification readability, stable locators, deterministic data, meaningful assertions, cleanup, and secret safety.
9. Run targeted E2E, related lower-level checks from `.agents/local/checks/`, and required CI.
10. If E2E exposes a real application defect, capture evidence into `evidence` and hand off to SR Bug; do not silently repair production code in this workflow.
11. Write `02-implementation-report.md` and stop at gate.

## VERIFY

Precondition: approved E2E implementation.

1. Detect code/test/environment drift.
2. Run from a clean/reproducible environment and execute the approved journey matrix.
3. Repeat runs according to the approved flake strategy. Retry-dependent passes remain suspect.
4. Classify failures: test defect / application defect / environment-infrastructure / flaky timing-data.
5. For environment/infrastructure failures, inspect the nearest runtime health evidence first,
   record the command/exit/primary-error signature from `../common/contract.md`, and circuit-break
   after two identical attempts without new evidence. Move to a known fallback or `blocked` with
   the exact human action; do not restart broad environment discovery.
6. Use traces/screenshots/video/log/network evidence only as needed; sanitize and follow artifact-retention policy.
7. Use Trellis verification/check for changed test/support code and verify required CI.
8. Verify accessibility/keyboard/focus and manual UAT only when required and evidenced.
9. Do not claim production verification unless it actually ran in production with explicit authorization.
10. Run `../common/closeout.md` and the receipt in `../common/receipt.md`, write `03-verification-report.md`, run the finish checkpoint in `../common/guard.md`, and stop at final gate.
11. After `APPROVE`, Trellis finish/archive. Hosted-Git handoff is a separate authorization.
