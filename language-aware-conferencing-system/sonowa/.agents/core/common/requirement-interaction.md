# SR Requirement Interaction

Several requirements landing on the same code is normal, not an exception. Deciding how
they interact is a planning step, not something to discover during a merge.

Run this whenever more than one requirement, ticket, or open task touches the same change
envelope. Record the result in the planning artifact.

## Interaction matrix

One row per pair of overlapping requirements.

| Classification | Meaning | What to do |
|---|---|---|
| `INDEPENDENT` | Overlap is incidental — different seams, different behavior | Separate slices, parallel work allowed |
| `ORDERED_DEPENDENCY` | One needs the other's result | Fix the order and say why |
| `COHESIVE_COMBINE` | Same business seam or contract; changing it twice is riskier than once | One implementation slice |
| `CONFLICT` | The two ask for incompatible behavior | Human decision. Never auto-merge |
| `UNKNOWN` | Not enough evidence to classify | Stays unknown until investigated |

`COHESIVE_COMBINE` combines the *implementation*, never the accounting: each requirement
keeps its own acceptance criteria and its own evidence, so a later reader can still see
which one is satisfied.

`CONFLICT` is not resolved by picking the newer requirement, the louder stakeholder, or
the smaller diff. State both positions and what each would cost, and stop.

`UNKNOWN` is not a soft `INDEPENDENT`. Parallel implementation is not allowed while a
pair is unknown.

## Single writer

For any one asset:

```text
parallel investigation      allowed
parallel independent review allowed
parallel implementation     one writer
```

Independent agents writing the same file concurrently produce merge conflicts, and worse,
semantic conflicts that merge cleanly. Assign a single writer per asset for the duration
of the slice, and record who — or which lane — holds it.

## Scope of this file

SR tracks related requirements, work packages, shared evidence, overlap, and dependency
order. It does not become a program-management system: no portfolio view, no campaign
dashboard, no scheduling. A change large enough to need those belongs in the
organization's existing planning tool, with SR handling one work package at a time.
