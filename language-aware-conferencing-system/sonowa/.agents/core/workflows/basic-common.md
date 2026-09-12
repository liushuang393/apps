# SR Basic Development — Shared Contract

This shared view contains only facts used by PLAN, BUILD, and VERIFY. The host adapter
loads the common contract, method routing, artifact mapping, and approval gate once.

Destinations below are logical. Resolve them through `../common/artifact-map.md` and
`.agents/local/project.md`.

Artifacts, in `design`:
`00-requirements.md`, `01-basic-design.md`, `02-detailed-design.md`,
`03-implementation-report.md`, `04-verification-report.md`, plus `evidence`.
What each design must contain is `../common/design-artifacts.md`; layout comes from the
template set named in `.agents/local/project.md`.

Trellis is the only lifecycle authority. Each invocation operates on one attached task and
one phase. PLAN approval is bound to requirements, scope, interfaces, data contracts,
security rules, architecture, artifacts, and revision. BUILD approval is additionally bound
to implementation-affecting code, config, dependencies, migrations, and generated assets.
Any material drift invalidates the owning approval and returns work to that phase.

A phase ends with the gate in `../common/approval-gate.md`. No later phase runs in the same
fixed-phase invocation, and no production code is written before the required PLAN
`APPROVE`.
