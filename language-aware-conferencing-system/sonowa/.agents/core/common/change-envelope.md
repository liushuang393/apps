# SR Change Envelope and Change Dimensions

Two questions, answered before implementation starts: _what is this change allowed to
touch_, and _what kind of change is it_.

## Change envelope

Every file the work will modify is classified. The envelope is written during planning and
checked before the work is declared done.

| Class                 | Meaning                                                                  |
| --------------------- | ------------------------------------------------------------------------ |
| `PLANNED`             | Named in the approved design                                             |
| `DEPENDENCY_REQUIRED` | Not named, but the change cannot compile/pass without it                 |
| `INCIDENTAL`          | Touched for convenience — formatting, a nearby cleanup, an unrelated fix |
| `FORBIDDEN`           | Must not be modified by this work at all                                 |

## Derived cases

`DEPENDENCY_REQUIRED` and `INCIDENTAL` are where a second piece of work hides inside the
first. The classes are a detector, not a permission slip. Each such row answers one
question and records the answer as its `Disposition`:

> Does this edit change behavior?

| Answer                                                            | Disposition                 | What it means                                                   |
| ----------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------- |
| No — a rename followed through, an import path, a type annotation | `behavior-preserving:<why>` | Stays in this task                                              |
| Yes                                                               | `child:<task>`              | Its own task, with its own criteria, tests, review, and receipt |
| Unsure                                                            | `child:<task>`              | Unsure is a yes                                                 |

A one-word addition to a routing condition, an enum value, a default, or a threshold is a
behavior change, however small the diff and however plainly the parent change forced it.
Carrying it as "we had to touch this" is how a change nobody designed, nobody reviewed,
and nobody tested rides into a release inside a task that did have all three.

`.agents/runtime/sr_guard.py check` rejects a receipt with a dispositionless row.

Rules:

- `DEPENDENCY_REQUIRED` is recorded with the reason it became required. A growing list of
  these means the design missed something — say so rather than absorbing it silently.
- `INCIDENTAL` defaults to zero. Anything genuinely worth doing becomes a follow-up in
  `tickets`, not a passenger in this diff.
- A write to a `FORBIDDEN` path stops the work. It is not resolved by a workflow step that
  seems to need it.
- The envelope is part of what a human approves. Widening it invalidates that approval.

`.agents/runtime/sr_guard.py check` verifies the working tree against a recorded envelope.

## Change dimensions

Detect the nature of the change instead of inventing a workflow per change pattern.
Several dimensions can be active at once.

```text
business-rule        public-interface     security       migration
data-contract        cross-cutting        compatibility  behavior-preserving
dependency           performance
```

Each active dimension turns on a lens. A lens is extra impact coverage, not a separate
process.

## Data contract lens

Active when a field, type, width, nullability, encoding, or format changes.

```text
schema                  API / DTO / message shape
serialization           file / report / export format
validation              consumers, including outside this repository
migration               backward and forward compatibility window
test data / fixtures    generated code and clients
```

The specific field, table, or width is the repository's business. The coverage list is not.

## Cross-cutting lens

Active when a shared business concept, constant, or policy changes — the kind of change
whose fan-out is much larger than the request implies.

```text
the concept itself      configuration and environment
its aliases and legacy names   rule implementations that duplicate it
constants and enumerations     consumers, tests, and documentation
```

Search aliases and superseded terminology explicitly. A renamed concept is exactly the
case a name-based search misses.

## Compatibility lens

Active on runtime, platform, browser, framework, or dependency version changes.

```text
supported runtime / platform matrix     build and runtime configuration
deprecated or removed usage             affected tests and environments
```

The supported versions and the banned constructs are declared by the repository, in
`.agents/local/checks/` or `project.md`. This lens says to check them; it does not name them.

## Dependency lens

Active when a dependency is added, removed, or moved to a different major version.

Adding a dependency is a decision with a maintenance tail, not a convenience. Work down
this ladder and stop at the first rung that holds:

```text
1  the language's standard library covers it
2  a capability already present in this repository covers it
3  a dependency already installed covers it
4  a few lines of local code cover it
5  a new dependency is genuinely warranted
```

Reaching rung 5 owes four answers, recorded in the design:

```text
what it replaces        the rungs above, and why each failed
supply state            maintenance status, release cadence, known advisories
licence                 compatible with this repository's declared terms
exit                    what removing it later would cost
```

A version bump across a major boundary is this lens plus the compatibility lens.

## Migration lens

Active when persisted data, a public API, or an on-disk or on-wire format changes shape.

A migration is not the schema edit. It is the plan for the window in which both shapes
exist.

```text
forward step            how existing data reaches the new shape
window                  what runs while old and new coexist, and for how long
readers and writers     every producer and consumer, including outside this repository
reversal                how to get back, and until when it is possible
proof                   how the migrated result is verified, not assumed
destructive edits       column drops, type narrowing, deletions — staged, never in one step
```

A migration with no stated reversal is not approved. "We will restore from backup" is a
reversal only if someone has restored from that backup.

## Performance lens

Active when the acceptance criteria contain a timing, throughput, memory, or cost
condition, or when the change touches a path already known to be constrained.

```text
baseline                measured before the change, at a named revision
metric                  latency, throughput, memory, query count, token count
method                  how it was measured, and with what input
after                   the same measurement, same method, same input
```

Baseline first. A number produced only after the change proves nothing.

If the repository has no way to measure the relevant metric, that is an unknown and is
recorded as one (`./impact.md`). Do not estimate. An invented number is worse than an
acknowledged gap because it ends the conversation.

## Behavior-preserving

If every dimension is `behavior-preserving`, this is the SR Refactor workflow, and the
invariance boundary replaces the acceptance criteria. Do not run a restructuring through
a workflow that assumes behavior may change.

## Automated rewrites

A tool that rewrites code across the repository is a change like any other, and the envelope
applies to it. "The formatter did it" is not a disposition.

Formatting and rewriting are different acts. Reordering lines and adjusting whitespace cannot
change what a module exports; removing an import the tool believes is unused can, and a
re-export exists precisely to be unused inside its own file. Run the two separately: the
formatter over the whole tree if you like, the rewriter only over the files the change
already touches, and read its diff for each one.

When a rewrite lands anyway, the check is not the linter that produced it. Ask what the tool
cannot see: the names a module promises to export, the imports that exist for their side
effects, the annotations a framework reads at runtime. Import every module the rewrite
touched and confirm its declared exports still resolve. That check finds in seconds what a
green lint run and a green type check both miss, because both of them agree with the tool
that the deleted line was unused.

The scale of the rewrite is also the reason it hides. A gate that runs only on changed files
has never seen the code that was always broken; stage the whole tree once and it all arrives
at the same time, mixed in with the damage the rewrite just did. Separate the two before
concluding either way — compare each finding against the same file before the rewrite, and
report the counts, not the impression.
