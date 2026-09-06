# SR Common Contract

## Prerequisites

SR requires Trellis to be initialized in the repository. Trellis owns task lifecycle,
PRD/task state, `.trellis/spec/`, workspace/journal context, project verification, and
finish/archive. SR does not reimplement any of it.

If `.trellis/` is absent, report that the SR workflow requires Trellis project setup.
Do not invent Trellis state or commands, and do not substitute an SR-owned task store.

## Project binding

Read `.agents/local/project.md` before anything else. It belongs to the repository and
overrides this core wherever the two disagree — destinations, output language,
verification commands, gate policy, prohibited actions.

An absent section in `project.md` means "core default applies". An absent
`project.md` means the repository has not been bound yet: ask for the missing values
rather than guessing them.

Write output in the language declared in `project.md` section 2.

Section 13 names the companions — skills, sub-agents, tools — this repository wants
considered at each phase. At the start of a phase, read its rows (plus `any`) and say, in
the first lines of the phase, which you are using and which you are not and why; report
the same at the gate (`./approval-gate.md`). This is a reminder the repository configured
so the person does not have to repeat it, not a gate: a companion that is absent from the
host is `not available`, never a failure (`./method-router.md`). What is a failure is the
phase that never looked.

Resolve every write destination through `./artifact-map.md`. Never write to a raw path
that neither the workflow nor `project.md` named.

## Human approval

Every SR phase ends at a human gate. The gate policy is declared in `project.md`
section 4; the default is `all`.

- The only approval token is `APPROVE`.
- Silence, vague agreement, or continued conversation is not approval.
- Do not present an approval gate while a blocking question remains.
- Approval covers a concrete artifact set and repository revision, not merely a phase name.
- Record HEAD/commit and artifact links when available.
- If approved scope/design changes, invalidate the relevant prior approval and return to the owning phase.
- After final approval, any implementation/spec/design/evidence change invalidates final approval before close.

Under `risk-based` or `minimal`, a phase that continues without a gate still writes its
phase artifact and still states what it decided. A skipped gate is never a skipped record.

Regardless of policy, always stop for a human when the phase touches production,
destructive or irreversible actions, external systems, publicly observable behavior,
credentials, or security posture.

## Risk levels

What `risk-based` gate policy acts on, and what `./review.md` uses to decide whether a
human reviewer is required. Classify the phase, not the whole task; a task can start at
R1 and reach R3.

| Level | Shape                                                                                | Default treatment                                    |
| ----- | ------------------------------------------------------------------------------------ | ---------------------------------------------------- |
| R0    | Local, reversible, no contract or behavior change                                    | AI review; no hard gate under `risk-based`           |
| R1    | Behavior change confined to one module, covered by tests                             | AI review; hard gate under `all`                     |
| R2    | Public interface, data contract, cross-zone or cross-consumer impact                 | Human review with the capability the change requires |
| R3    | Production, irreversible, privileged, external system, security posture, credentials | Human authorization, always, under every policy      |

When two levels are arguable, take the higher one and say why.

### Security auto-trigger

Treat the phase as at least R2 and run the security lens whenever the change involves:
authentication, authorization or permissions, tokens or credentials, tenancy or data
isolation, payment, personal data, SQL or query construction, shell or process execution,
file upload, webhooks, deserialization, or any externally supplied input.

A green scanner does not clear this. Reasoning about the trust boundary is a separate step
from running a tool.

## Companion contracts

Read the ones the current phase needs; they are not all needed at once.

| File                           | Needed when                                                    |
| ------------------------------ | -------------------------------------------------------------- |
| `./impact.md`                  | Working out what a change touches                              |
| `./zones.md`                   | Rules or ownership differ by location in the repository        |
| `./change-envelope.md`         | Deciding what may be modified, and what kind of change this is |
| `./requirement-interaction.md` | More than one requirement touches the same code                |
| `./review.md`                  | Any review, AI or human                                        |
| `./test-evidence.md`           | Choosing a test strategy, test levels and oracles              |
| `./receipt.md`                 | Closing a phase                                                |
| `./guard.md`                   | The four checkpoints every workflow honors                     |
| `./readiness.md`               | What the project can prove before a change; what a task needs before BUILD |

## Scope and change discipline

Do repository/code/history research before asking humans for facts.

Ask humans only for intent, priority, product/UX/risk decisions, missing external
knowledge, or high-impact authorization.

Do not widen scope silently. Create a follow-up or ask for approval when a newly found
issue is outside the approved scope.

Do not claim success for checks that could not run. State the blocker and required
human action.

## Out-of-band requests

A workflow is a constraint on what may be _changed_, never on what may be _answered_.

While a phase is running, a person may ask something the phase has no opinion about — an
explanation, a summary, a number, a document for a different audience. Answer it in the
same turn. A gated process that goes quiet on everything outside its own scope is not
disciplined; it has become a machine the person has to work around.

Three rules keep this from eroding the gate:

```text
answer now             the answer is not a phase deliverable and does not wait for one
change nothing         no production edit outside the approved envelope, whatever was asked
say where it landed    if the answer is worth keeping, name the file it went to
```

Deciding where it lands:

| The answer is                          | Where it goes                                                |
| -------------------------------------- | ------------------------------------------------------------ |
| Only useful in this conversation       | The reply. No file.                                          |
| A durable artifact of this task        | The `design` destination for this task                       |
| A durable asset unrelated to this task | Its own home, resolved through `./artifact-map.md`           |
| A change to how work is done here      | `.agents/local/` or the repository's rules, proposed at the gate |

The third row is the one that gets lost: an asset produced during a task, belonging to
something else, and left in the chat because the task had nowhere to put it. Give it a
file, then return to the phase.

### Which interruptions the phase survives

| Interruption                                | Effect on the phase                    | After answering                                   |
| ------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| A question, explanation, summary, or number | None                                   | Resume at the same step                           |
| An asset for a different audience           | None. Write the file                   | Resume at the same step                           |
| A correction to a fact the phase relies on  | Evidence is stale                      | Re-derive that evidence, then resume              |
| A new or changed requirement                | PLAN approval is stale                 | Return to PLAN. Do not continue the current phase |
| "Change this code now"                      | Not out-of-band — it is a scope change | Envelope and gate decide, not the request         |
| "Stop" / "switch to something else"         | Phase suspended                        | Record the next action before leaving             |

Only the first two rows resume where they left off. The rest change what the phase is
allowed to assume, and continuing as if they had not happened is how a phase finishes
against a specification nobody holds any more.

### Resuming

The resume point lives in the task artifacts, never in the conversation. Before answering
an out-of-band request, the current phase and the next action are already recorded — if
they are not, record them first, then answer. Recording after the fact depends on
remembering, and the interruption is exactly the moment that fails.

Return by saying which task and which step is resuming. A silent return leaves the person
unable to tell whether the interruption cost them the thread.

## Handing a decision to a person

A gate is where a person approves. It is not the same thing as a question, and the two
get confused in the direction that costs the most: a workflow that asks at every fork
turns approval into a reflex, and a reflex approves the one thing that mattered.

Ask a person mid-phase only when **both** hold:

```text
the answer changes what gets built, not merely how it is written
AND proceeding on any assumption would be unsafe, or would waste the work if wrong
```

Everything else is decided, recorded, and reported — not asked.

| Situation                                                                 | Ask, or decide                                |
| ------------------------------------------------------------------------- | --------------------------------------------- |
| A contract must change in a way that touches other people's code          | Ask                                           |
| The specification and the codebase disagree on a fact the design rests on | Ask                                           |
| Two designs are both defensible and the choice is a business preference   | Ask                                           |
| A requirement turns out to be **narrower** than written, with evidence    | Decide. Record the evidence and the narrowing |
| A requirement turns out to be wider, or a new one appears                 | Ask — this is scope                           |
| Naming, file layout, helper structure, test shape                         | Decide                                        |
| An interpretation with one sensible default                               | Decide, state the assumption                  |

The fourth row is the one usually got wrong. A requirement written against a premise that
turned out to be false is not a scope change when it is corrected downward — the work
those words asked for never existed. Correct it, record why, keep going. Asking there
spends a person's attention on confirming that something imaginary is imaginary.

Stopping is also a decision, and it is not free. A phase that stops has cost someone a
context switch; if the answer was going to be "yes, obviously", the stop was a defect in
the workflow, not diligence.

## Quality baseline

Use the verification commands declared in `.agents/local/checks/`. A check kind with no
file there does not exist in this repository — say so instead of inventing a command.
Where `project.md` is silent, prefer repository-defined tooling and conventions.

- Do not suppress lint/type/security/test rules merely to pass.
- Distinguish pre-existing baseline findings from new or worsened findings.
- Introduce zero new warnings/findings unless explicitly accepted.
- Do not weaken or delete tests merely to make implementation pass.
- Treat required CI as authoritative when it exists.
- Sanitize logs, traces, screenshots, scan output, and examples before storing evidence.

## External / destructive actions

Honor `project.md` section 5 (prohibited actions) as a hard constraint. A prohibited
action is not negotiable by a workflow step that seems to require it — report the
blocker instead.

Require explicit human authorization for destructive, irreversible, privileged,
production, or external-system actions.

Examples: destructive migrations, credential rotation, production E2E, deleting data,
infrastructure mutation, public writes, or active exploitation.

Prefer staging/sandbox/mocks when they validate the contract safely.

## Knowledge ownership

One canonical destination per kind of knowledge. Logical names are defined in
`./artifact-map.md` and resolved in `project.md`:

- Trellis owns current work, PRD, and lifecycle state.
- `.trellis/spec/` holds durable AI-facing implementation contracts and conventions.
- `design`, `evidence`, `spec`, `tickets`, `adr`, `business_spec`, `runbook`,
  `glossary`, `lessons`, `scratch` resolve through the project binding.
- Code and tests remain the executable implementation truth.

Do not duplicate the full same rule across stores. Link to the canonical source.

Archive a lesson only if it is likely to recur, costly/risky to rediscover, stable
beyond the task, actionable, and specific.

## Close

Do not finish, archive, or close the request until the workflow's final human `APPROVE`.

Handing work to a hosted-Git surface (branch push, pull request, merge, release,
deploy) is a separate authorization. Final approval never implies it, and
`project.md` section 5 may forbid it outright. When it is forbidden, stop at the local
working tree and report what is ready.
