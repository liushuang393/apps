# SR Review

One review contract for every SR workflow. A workflow says _when_ to review and against
which diff base; what a review consists of is here.

## Nine lenses

Every review covers all nine. A lens with nothing to report says so; it is not omitted.

| Lens         | Asks                                                                                            |
| ------------ | ----------------------------------------------------------------------------------------------- |
| Scope        | Does the diff match the approved envelope, and nothing else?                                    |
| Architecture | Right layer, right boundary, no new coupling or reverse dependency?                             |
| Reuse        | Did this reimplement something the repository, platform, or an existing dependency already has? |
| Correctness  | Does it do what the acceptance criteria say, including the negative paths?                      |
| Failure      | Errors, retries, transactions, idempotency, partial failure, recovery, user-visible message?    |
| Quality      | Readable, tested, no new warnings, no weakened checks, no suppressed rules?                     |
| Security     | Trust boundary, authorization, input handling, secret handling, exposure?                       |
| Evidence     | Is every claim in the report backed by something a human can open?                              |
| Anti-fake    | Is anything green here not actually working? See `./anti-fake.md`.                              |

Review against a fixed diff base. A moving base makes findings unreproducible.

## Standard review sheet

The AI fills the evidence in before a human sees it. Handing a person an empty template
is how review governance fails.

```markdown
# SR Review Sheet — <task> @ <revision>

## Intent / acceptance

## Scope / impact / unknowns

## Architecture / ownership

## Reuse / dependency

## Correctness / business rule

## Failure / recovery

## Quality / compatibility

## Security / trust boundary

## Test / evidence

## Anti-fake

## Open risk

## Reviewer decision
```

Every section but the last is filled by the AI review, with findings and pointers.
The last is the human's. The `Anti-fake` section records one verdict per item in
`./anti-fake.md` — `clean`, `finding`, or `not applicable` with a reason.

A human reviewer's job is not to re-derive the AI's conclusion. It is to judge whether the
evidence supports it and whether anything is missing from `Open risk` and `unknowns`.

If `.agents/local/templates/` holds a sheet with a mandated organizational format, use that
instead of this skeleton.

## Findings

Classify each: `blocking`, `should-fix`, `follow-up`, `accepted`. Blocking findings are
resolved with a test where a test can express them. `follow-up` goes to `tickets`, not to
the end of the report where it dies.

## Reviewer capability routing

The change determines which _capability_ the reviewer must hold. Who holds it is resolved
through `./zones.md` and `.agents/local/project.md` section 9. No person, team, or department
is named in this suite.

| Change                                                      | Required reviewer capability |
| ----------------------------------------------------------- | ---------------------------- |
| Business rule or business-visible behavior                  | Domain                       |
| Shared contract, public interface, cross-zone asset         | Consumer / architecture      |
| Auth, permission, trust boundary, credential, data exposure | Security                     |
| Migration, job, cutover, operational procedure              | Operations                   |
| Data contract change with downstream consumers              | Data / consumer              |

Several capabilities can be required at once. An unresolvable capability is reported as
unresolved, not silently dropped.

## Who reviews

**Floor, not a preference: whoever did the work does not review it.** The review runs in a
separate process, and for an AI workflow on a different model — the same model carries the
same blind spots, and it reviews the code it meant to write rather than the code it wrote.
The receipt records `Author` and `Reviewer`; `.agents/runtime/sr_guard.py check` rejects a
passed receipt where they match. A review that found nothing still gets recorded — an
unrecorded review did not happen.

**Establish who you are before choosing who reviews you.** Name your own model, then pick
a different one that is at least as capable. Skipping the first step is how the second one
goes wrong: an assistant that never asks what it is running as will reach for whichever
reviewer is cheapest or nearest to hand, and discover only afterwards that it delegated
upward-facing work downward. The suite names no models — hosts and lineups differ, and any
list here would be stale within a release. The comparison is yours to make at dispatch
time, against yourself.

**Never review down the capability ladder.** A weaker reviewer is the worst of both
worlds: it spends a review cycle and returns confidence rather than scrutiny. What it
misses is invisible — the gap surfaces as a green receipt instead of a finding, which is
precisely the failure the review exists to catch. It converts a control into a formality,
and a formality is more dangerous than a missing step, because everyone downstream now
believes the work was examined. If the only reviewer available is weaker than the author,
record that in the receipt and treat the review as unperformed rather than banking it.

This is the one lens no amount of care substitutes for. A worked example: a change whose
author filled in every lens honestly, and whose independent reviewers then found
eight further defects the author had not seen, including a regression the author had
introduced and certified as clean. Self-review missed roughly six defects in ten.

Close what you opened. A review process that has finished reporting is stopped, not left
running — an abandoned reviewer keeps waking the session with nothing to say, and the work
loses track of what is still genuinely in flight. Before the receipt, no review process
started for this phase is still registered.

Default: an AI independent review always, and a human review when risk requires it.

Requiring a human on every low-risk reversible change costs more than it catches and
trains people to approve without reading. The risk levels are in `./contract.md`; the gate
policy that acts on them is `project.md` section 4.

Regardless of policy or risk level, a human reviews anything that touches production,
irreversible actions, external systems, credentials, or security posture.
