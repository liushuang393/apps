# SR Conditional Interaction

Read this module only when an interruption, correction, scope change, stop/switch request, or
human-owned decision occurs. Normal phase execution does not load it.

## Answer versus phase work

A workflow constrains what may be changed, not what may be answered. Answer a question,
explanation, summary, or number in the same turn without changing phase scope. If the answer is
durable, resolve its destination through `./artifact-map.md`; otherwise keep it in the reply.
Never treat continued conversation, agreement, or a question as `APPROVE`.

## Preserve or invalidate

- A plain question or audience-specific asset preserves the current phase and resume step.
- A corrected fact makes dependent evidence stale; re-derive it before resuming.
- A narrower requirement supported by evidence may be decided and recorded.
- A wider/new requirement or code-change request is a scope change: invalidate PLAN approval and
  return to PLAN. Do not continue under the old envelope.
- `Stop` or switch suspends the phase immediately.

Before answering an interruption or suspending, record the task, current phase, completed step,
and exact next action in task artifacts. Resume by naming that task and next action; conversation
memory is not the resume source.

## Human decision test

Ask mid-phase only when the answer changes what is built and every assumption would be unsafe or
wasteful. Ask for business preference, external knowledge, cross-owner contract choice, wider
scope, or high-impact authorization. Decide naming, helper layout, test shape, and one-sensible-
default implementation choices; record the rationale. A question is never an approval gate.
