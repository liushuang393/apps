# SR Test Evidence and Oracle Ownership

There is no separate "AI testing" process. There is one question per behavior: at which
level is it tested, who or what says the expected result is correct, and what evidence is
enough.

## Strategy selection

Before the matrix: which kind of evidence is primary for this change. The inputs are
already known — the workflow the router selected, the change dimensions from
`./change-envelope.md`, and the coverage that was _observed_ over the boundary being
touched. Nothing new is classified here, and no repository-wide profile is assigned: one
repository holds new modules, legacy modules and modules being replaced at the same time,
so the strategy follows the change, not the address.

| The change                                                                        | Primary evidence                                                                               | Oracle                                                                   |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| New behavior with an approved specification                                       | `specification-tdd` — RED before GREEN, one per acceptance criterion                           | Specification                                                            |
| Existing behavior touched, with no reliable coverage across the boundary it crosses | `test-on-touch` — characterize the touched behavior and boundary, then RED the intended change | Existing behavior for the characterization; specification for the change |
| A defect                                                                          | `regression-first` — the narrowest seam that can actually fail, failing first                  | Specification or external authority                                      |
| Every dimension `behavior-preserving`                                             | `characterization-invariance` — pre/post comparison against the recorded baseline              | Existing behavior                                                        |
| The `migration` dimension is active — one implementation replaces another         | `differential` — the same input through both, compared. Unit tests are supplementary           | The replaced implementation, only as far as it is the contract           |

More than one row can apply: a legacy module gaining a new rule is `test-on-touch` for
what it already does and `specification-tdd` for what is being added. Record every
strategy that applies in the receipt; `.agents/runtime/sr_guard.py check` rejects a passed
receipt that built code without naming one.

"Existing coverage" is what was run, not what exists. A suite that does not execute the
boundary — excluded from the default check command, skipped, or asserting nothing about
it — is absent coverage with a reassuring name.

### Existing behavior is not an approved specification

A characterization test records what the code does today, including what it does wrong. It
is an oracle for invariance, and for nothing else. Promoting one into `business_spec`
needs the human who owns that rule to say the observed behavior is the intended behavior.
The run that produced the observation is not that person.

### Test on touch

Scope is the behavior this task changes and the boundary this change could break — not the
module, not the package, not the repository. Where coverage over that scope already exists,
reuse it; where it does not, characterize before changing, and only there.

```text
generating tests for the repository before the first change
generating a test per class because a tool can produce them
a coverage percentage as the goal
freezing a current defect as the expected value without a human confirming it is intended
```

None of those four is this strategy. The last is the one that costs most, because it
converts a bug into a requirement and every later change then has to preserve it.

### Differential evidence

SR does not implement a comparator. It records when differential evidence is required,
which command produces it, what was compared, and passed / failed / unknown.

```text
same input
   |
old implementation ---- new implementation
        |                      |
     output A              output B
        +----- comparator -----+
```

What "output" means is the repository's to declare: return value, API response, database
state, output file, exit code, emitted event, error code, state transition, report.

The contract a differential check declares, in the migration's own files — SR reads it,
it does not define the values:

```text
source_runner:            how the old implementation is invoked
target_runner:            how the new one is
input_corpus:             which inputs, anonymized and classified
normalizer:               what is stripped before comparing (timestamps, ids, ordering)
compare:                  stdout / files / database / messages / errors / side effects
intentional_delta:        the approved list of differences, and where it was approved
timeout_policy:
nondeterminism_policy:
```

What a comparison of the old and new most often misses: encoding (EBCDIC / UTF-8), packed
decimals and rounding, dates and timezones, fixed-width records, collation, the meaning of
null / space / zero, batch and commit boundaries, duplicate and retry handling, file naming,
report pagination, message ordering, error codes and abends, external calls, performance.

Equivalence is not correctness. Old and new agreeing on a defect is a pass on the comparator
and a defect on the product; `intentional_delta` is where a corrected behavior is told apart
from a regression, and it needs an approved source — a spec, a known issue, a human decision
(`./readiness.md`, as-is and to-be).

The case list and the old/new commands are written by whoever owns the migration. A
comparator that ships with no configured cases proves nothing, and a repository with no
`differential` file in `.agents/local/checks/` says the check does not exist here rather than
claiming equivalence some other way. Every test on the new side can be green while the two
implementations disagree — that suite is the new code agreeing with itself.

## Test matrix

Produced during planning, verified during verification. One row per behavior worth proving.

| Column             | Holds                                              |
| ------------------ | -------------------------------------------------- |
| Behavior / risk    | What could go wrong, in one line                   |
| Strategy           | From the strategy selection above                  |
| Test level         | From the list below                                |
| Oracle source      | What establishes the expected result               |
| Runner             | Which check from `.agents/local/checks/` executes it   |
| Evidence           | What a reviewer opens to confirm it ran and passed |
| Human confirmation | Required / not required, and why                   |

A row with no runner is not a test. Either a check exists in `.agents/local/checks/` or the
row says the behavior stays unproven and why that is acceptable.

## Criterion-to-RED table

The test matrix says what will be proven. This table says it was proven in the right
order. It is started in planning and completed during the build.

| Criterion ID | Task ID | RED test | RED at revision | GREEN at revision |
| ------------ | ------- | -------- | --------------- | ----------------- |

- One row per acceptance criterion. The IDs are the ones from `./decomposition.md`.
- `RED test` names the test file and test name, not a description.
- `RED at revision` is the revision at which that test was observed failing, for the
  intended reason. A test that fails because it does not import is not RED.
- `GREEN at revision` may not be filled while `RED at revision` is empty.

This table is the single place where specification-driven and test-driven meet. The
specification decides which rows exist; the test order decides which columns can be
filled. Filling GREEN without RED means the test was written to match code that already
existed, which proves the code agrees with itself.

`.agents/runtime/sr_guard.py check` rejects a receipt whose criteria are not covered by this
table, and a row with GREEN but no RED.

## Reachability

For every function, method, or endpoint the work newly exposes, the evidence names a
**caller outside the tests** — file and line. A symbol whose only callers are its own tests
is not a delivered behavior, and a criterion resting on one is not passed however green the
suite is.

Tests reach into a seam. Users arrive from the other side of it. A change can be fully
tested at the seam and completely disconnected one layer above, and no amount of unit
testing detects that, because the tests are calling the thing the product never calls. Ask
for the caller, not the test.

The same question, one level up: for anything reachable over HTTP or through a UI, start
the service and exercise the real path once. Record the status code and the deciding field
of the response. A tightened producer whose consumer still calls the old way stays green in
every suite and returns the wrong thing to every user.

Registering is not mounting. Where a framework keeps one list of available components and
a separate list of the ones the application actually composes, adding to the first changes
nothing a user can reach. The evidence for a new surface is an assertion against the
**composed application object** — the one the process serves — not against a fixture the
test built for itself. A test that constructs its own app and attaches the component under
test proves the component works and says nothing about whether the product includes it, and
it will keep saying nothing for as long as the component stays unmounted. When the two lists
exist, the durable fix is one check that they agree; then the next component cannot repeat
it.

The same trap has a non-HTTP form: a component wired into a private instance of a shared
service. The tests pass because they hold that instance. Production reads the shared one and
finds nothing. Ask which instance the running process uses, and assert against that.

## Test levels

```text
static                        integration
unit                          system / end-to-end
contract                      manual business acceptance
                              operational verification
```

Choose the cheapest level that can actually fail when the behavior breaks. Pushing
business logic up to end-to-end because the seam is inconvenient makes a slow suite that
proves less.

## Oracle source

| Oracle             | Example                                                   |
| ------------------ | --------------------------------------------------------- |
| Specification      | An approved requirement or business rule                  |
| Existing behavior  | A characterization baseline, for behavior-preserving work |
| External authority | A standard, protocol, schema, or vendor contract          |
| Human judgment     | An ambiguous or newly interpreted business rule           |

When the oracle is human judgment, the test cannot be written until a human supplies the
expected result. Do not encode a guess into an assertion — a wrong test is worse than a
missing one, because it looks like proof.

## What the AI does

```text
test discovery                  static and lint checks
unit test generation            repeatable execution
regression test generation      evidence collection
boundary case generation        failure classification
```

## What stays with a human

```text
ambiguous business oracle       high-risk acceptance
new policy interpretation       production cutover
accepted business difference    irreversible operation
```

These are authority, not effort. They do not become AI work because the AI could produce
plausible text for them.

## Framework absence

If a level has no harness in this repository — no matching file in `.agents/local/checks/` and
no existing suite — do not introduce a framework inside the current workflow. Cover the
behavior at the highest level that already exists, record what stays unproven, and raise
adopting a framework as separate approved work.
