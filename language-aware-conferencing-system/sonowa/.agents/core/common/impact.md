# SR Impact Evidence

How an SR workflow finds out what a change touches, without reading the whole repository.

## The rule this file exists to enforce

Do not load the repository into the model by default. On any repository large enough to
matter, that is slower, more expensive, less stable, and less explainable than collecting
the evidence that actually bears on the question.

```text
Repository topology
      -> deterministic search / index provider
      -> candidate evidence
      -> relationship expansion
      -> relevance cone
      -> selected raw evidence
      -> model reasoning
```

Raw source is read for selected evidence only.

## SR does not build an index

SR owns the evidence contract. It does not own an AST parser, a cross-language dependency
graph, or a code search database. Those are language- and framework-bound, duplicate what
LSP / CodeGraph / compilers / build tools / schema tools already do, and would make the
provider unreplaceable.

If an investigation seems to need one, that is a signal to find the provider the
repository already has — not to start writing one inside a workflow.

Nor does SR keep a ledger of facts across tasks. A fact worth keeping — how a subsystem is
wired, which way a dependency runs — goes into `.agents/local/project.md` section 11 with
the path it was read from, so the next task reads the source and not a summary of it.

## Relevance cone

Expand outward only as far as the question requires, and record where the expansion stopped.

| Layer            | Holds                                                                   |
| ---------------- | ----------------------------------------------------------------------- |
| Topology         | Which subsystems/modules exist and how they are laid out — summary only |
| Direct target    | The assets the request names                                            |
| Caller / callee  | One hop of control and data flow in both directions                     |
| Same concept     | Other implementations of the same business concept, including aliases   |
| Cross-cutting    | Configuration, constants, shared rules, generated artifacts             |
| Reverse consumer | Who depends on the changed contract, including outside this repository  |

A layer that was not expanded is stated as not expanded, with the reason.

## Evidence map

Build this before reading source in bulk. One row per asset.

| Column           | Holds                                                                       |
| ---------------- | --------------------------------------------------------------------------- |
| Asset            | Module / file / symbol / table / endpoint / job                             |
| Relationship     | How it relates to the change (caller, consumer, same rule, schema owner, …) |
| Reason           | Why this row is in the map                                                  |
| Evidence pointer | Where the claim can be checked — path, symbol, query, commit                |
| Confidence       | Confirmed / probable / unknown                                              |
| Owner            | Resolved through `./zones.md`, not invented                                 |
| Revision         | The revision the evidence was taken at                                      |

`Confirmed` requires a pointer a human can open. An assertion with no pointer is
`probable` at best.

## Impact search capability

Route this like any other capability in `./method-router.md`.

```yaml
capability: impact_search
input:
  question: # what the change is trying to establish
  change_type: # dimensions from ./change-envelope.md
  seed_assets: # what the request already names
  revision: # the revision every result must be bound to
output:
  evidence:
    - asset:
      relation:
      source: # which provider produced this row
      confidence:
      revision:
```

Provider preference, best available first:

```text
project-native index or search command
language server / code graph
build graph / dependency manifest
schema or migration tool
version-control history
plain text search
SR's own reading of the code
```

Several providers may contribute to one map. Keep `source` per row so a wrong row can be
traced back to what produced it.

## Affected modules

The change envelope lists files. Two later steps need modules instead: which standing
design documents to read while implementing, and which to reconcile at closeout.

```text
envelope files -> the module each file belongs to -> the affected module set
```

The mapping from file to module is the repository's, declared through `./zones.md` and
`.agents/local/project.md`. Where no zone matches, the module is the nearest directory that
owns a design document, and if there is none, the file has no module and is recorded as
such rather than attached to a neighbouring one.

Derive this set; do not recall it. A module that a person remembers touching and a module
the envelope proves was touched are different sets, and the difference is exactly what
goes stale.

## Context budget

Model-specific token limits are not written here. These principles are.

- Topology is summarized, never pasted.
- Candidates are pointers, not content.
- Raw source is read for selected evidence only.
- The same content is not loaded twice in one workflow.
- Evidence already established is not re-read every turn.
- A sub-agent receives a bounded lane, not the whole map.

## Revision binding

Every evidence row carries the revision it was taken at.

A provider cache is usable only while `cache_revision == target_revision`. Once the
working revision moves, cached rows are stale: re-derive them or mark them stale. Do not
silently carry an old row into a new revision.

## Unknowns

An unknown is a result. It is recorded with what was tried and what access, artifact, or
decision would resolve it.

Never close an unknown because the search was expensive, because a deadline is near, or
because the rest of the map looks complete. An unknown that is closed without evidence is
the failure this whole file exists to prevent.
