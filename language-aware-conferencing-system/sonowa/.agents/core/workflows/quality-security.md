# SR Quality / Security Workflow

The host adapter loads the base common contract once. Read additional common modules only when the current phase names them.

Artifacts, in `design` under `quality-security/`:
`01-scope-baseline.md`, `02-remediation.md`, `03-verification.md`, plus `evidence`.

## SCOPE & BASELINE

1. Attach to/create one Trellis task and read project security/quality policies, `.trellis/spec/`, CI, manifests/lockfiles, code ownership, tests, and relevant human docs.
2. Use the scanners declared in `.agents/local/checks/` first. Adding a scanner the repository does not already use is a proposal for the gate, not a step to take silently.
3. Define authorized scope/exclusions and whether any external/staging/production testing is permitted. Honor `.agents/local/project.md` section 5. Where rules differ by location, resolve them through `../common/zones.md` — a finding in a vendor-standard zone is judged by that zone's rules, not the repository average.
4. Select relevant dimensions only: lint/type/static analysis, tests/coverage, SAST, dependency/SCA, secrets, auth/permissions/trust boundaries, injection/deserialization, supply chain/config, license policy, dead code/duplication/complexity, architecture/design smells.
5. Capture baseline before remediation, into `evidence`.
6. Classify findings by severity, confidence, reachability/exposure when relevant, baseline/new/touched-worsened, and true-positive/false-positive/accepted-risk/tool-noise.
7. Remember: a scanner result is not a complete security review. For auth/business-logic/trust-boundary changes, add manual threat/abuse reasoning even if scanners are green.
8. Define remediation order and which decisions require human risk acceptance.
9. Sanitize evidence.
10. Write `01-scope-baseline.md` and stop at gate.

## REMEDIATE

Precondition: approved baseline.

1. Repair true positives in risk order, one class/slice at a time.
2. Prefer minimal reversible changes and add regression/security tests where practical.
3. Dependency findings: inspect actual exposure and compatibility; do not jump major versions blindly.
4. Secret findings: removing a secret from code/history is not credential rotation. Rotation/revocation is a separate authorized action.
5. Do not mass auto-fix or globally suppress rules.
6. Broad architecture refactors become separate approved work — hand off to SR Refactor or SR Plan rather than widening this scope.
7. Run the review in `../common/review.md` on the remediation diff. The Security lens carries the threat and trust-boundary reasoning; the Correctness lens carries behavior integrity.
8. Run the affected checks from `.agents/local/checks/` and required CI.
9. Write `02-remediation.md` and stop at gate.

## VERIFY

Precondition: approved remediation.

1. Rerun the same scans with equivalent configuration and compare by finding identity/category/severity, not only total count.
2. Prove no new high/critical findings, no new task-introduced warnings, no worsened baseline, and resolved findings are actually gone.
3. Use Trellis verification/check and the full set of checks in `.agents/local/checks/` plus required CI.
4. Independently review high-impact security changes even when scanners pass.
5. Any accepted risk must include rationale and, when project practice supports it, owner plus expiry/review trigger.
6. False-positive suppressions must be narrow, documented, and not hide neighboring findings.
7. Run `../common/closeout.md` and the receipt in `../common/receipt.md`, then write `03-verification.md`.
8. Run the finish checkpoint in `../common/guard.md` and stop at final gate; after `APPROVE`, Trellis finish/archive. Hosted-Git handoff is a separate authorization.
