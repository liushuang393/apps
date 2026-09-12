# SR Task Decomposition

One acceptance criterion is one task.

That is the whole rule. Everything below follows from it.

## Why this unit

Decomposition fails in two directions, and this unit makes both mechanically visible:

```text
an acceptance criterion with no task   -> work that was forgotten
a task with no acceptance criterion    -> work that was invented
```

Any other unit — a file, a module, a commit, a review-sized diff — leaves the first case
undetectable, which is the expensive one.

## The table

Produced in `02-detailed-design.md`, consumed by BUILD and by the guard.

```text
| Task ID | Criterion ID | Depends on | Parallel | Target files | Done when |
```

- `Criterion ID` refers to an acceptance criterion in `00-requirements.md`.
- `Depends on` lists Task IDs, not descriptions.
- `Parallel` is `yes` when the target files do not intersect any concurrent task's and all
  dependencies are complete; `no` when they intersect or the task depends on a contract an
  earlier task establishes.
- `Target files` comes from the change envelope. A file not in the envelope cannot appear.
- `Done when` is the observable condition, not the activity.

`Parallel: yes` records the dependency structure. It is not permission to run concurrent
writers — see `./dispatch.md`.

## Splitting an oversized criterion

Split only when a single criterion cannot be delivered as one vertical slice.

- Children inherit the parent's `Criterion ID` with a suffix.
- The parent is satisfied only when every child is.
- Splitting does not create new acceptance criteria. If a child needs a criterion the
  requirements do not contain, the requirements were incomplete — return to PLAN.

## Checking the decomposition

Before the PLAN gate:

```text
every criterion has at least one task
every task names exactly one criterion
every dependency names a task that exists
every target file appears in the change envelope
no cycle in the dependency graph
```

A failure here is a planning defect, not a build problem. Fix it before approval.
