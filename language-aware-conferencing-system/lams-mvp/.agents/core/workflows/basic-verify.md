# SR Basic Development — VERIFY View

Required for this invocation: `./basic-common.md`, `../common/review.md`,
`../common/anti-fake.md`, `../common/test-evidence.md`, `../common/readiness.md`,
`../common/receipt.md`, and `../common/guard.md`. Read `../common/dispatch.md` only
if a bounded independent review is delegated.

## VERIFY

Precondition: approved BUILD.

1. Verify the exact approved revision against `.trellis/spec/`, PLAN artifacts, acceptance criteria, and final diff.
2. Use Trellis's current verification/check workflow as lifecycle owner.
3. Record distinct `Author` and independent `Reviewer`, then run the review in `../common/review.md`: nine lenses against a fixed diff base,
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
