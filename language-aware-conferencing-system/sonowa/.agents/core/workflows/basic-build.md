# SR Basic Development — BUILD View

Required for this invocation: `./basic-common.md`, `../common/guard.md`,
`../common/readiness.md`, `../common/impact.md`, and `../common/test-evidence.md`.
Read `../common/dispatch.md` only if a bounded read is delegated.

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
