# SR Anti-fake Lens

Green that is not working.

This lens exists because a workflow that certifies its own output will certify work that
does not run. It is applied in review (`./review.md`, lens 9) and partly enforced by the
guard (`./guard.md`).

## What it checks

### 1. Fail-open

A path that cannot decide must not fall through to permit. In security, permission,
governance and policy code, every ALLOW is suspect until the reason it must exist is
stated. Silence is not consent.

Ask: what happens when the dependency is down, the config is absent, the token is
malformed, the rule set is empty? If the answer is "it allows", that is the finding.

### 2. Fake implementation

Fixed values, canned JSON, hardcoded success responses, demo stubs. The question is not
whether they exist — it is whether they can be reached in production. Trace the wiring,
not the comment.

### 3. Suppression

`noqa`, `type: ignore`, `pragma`, `skip`, baseline entries. A new one is acceptable only
when following the checker demonstrably breaks production, and the comment says **what
breaks and how to reproduce it** — not why it is safe. A suppression that reasons about
safety instead of naming a failure is unproven.

Suppressions added in bulk by a script are never proven, because proof is per-case.

### 4. Hollowed tests

An assertion weakened until it passes. A test that no longer calls the thing it names. A
mock that returns the expected answer regardless of input. Coverage that counts lines the
test never asserts on.

### 5. Completion claimed over a marker

Unfinished markers left in code while the work is reported as done, or replaced with
vaguer wording. If something must remain unfinished, it is recorded in the specification
as an open item and the code says concretely what fails and what would verify it.

### 6. Baseline by assertion

"That failure is pre-existing and unrelated" is a measurement, not a judgement. Requires
the distribution: does it fail at the base revision, on a clean tree, for every case of
that shape? A dismissed baseline has hidden a reproducible product defect before.

## How to run it

Against the fixed diff base used by the rest of the review. For each of the six, record
`clean`, `finding`, or `not applicable` with the path that was examined. `not applicable`
needs a reason.

## What the guard can and cannot see

The guard detects new suppressions in a diff without a stated failure (item 3) and
unfinished markers (item 5). It cannot see fail-open, fake implementations, hollowed
tests, or an asserted baseline. Those are the reviewer's, and the reviewer is independent
of the author for exactly this reason.
