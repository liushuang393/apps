# SR Router

The entry point for someone who should not have to know which SR workflow their request is.

Read `../common/contract.md` and `../common/method-router.md`.

This workflow **routes and stops**. It does not investigate, plan, implement, remediate,
or verify. It reads enough to classify honestly, then hands over.

## CLASSIFY

1. Attach to the current Trellis task, or note that no task exists yet.
2. Restate the request in one sentence. If the restatement is wrong, everything after it is.
3. Determine the intent. More than one can apply; say so rather than forcing one.

| Intent | Workflow |
|---|---|
| Answer a question, map behavior, assess impact, produce an estimate | `sr-investigate` |
| Build or change intended behavior | `sr-plan` -> `sr-build` -> `sr-verify` |
| Restructure without changing observable behavior | `sr-refactor` |
| Something is broken and should not be | `sr-bug` |
| Find or fix quality/security findings | `sr-scan` |
| Prove a business-critical journey end to end | `sr-e2e` |

4. Determine the risk level using the table in `../common/contract.md`, and name what makes
   it that level.
5. Determine the change dimensions using `../common/change-envelope.md`, if any code is
   likely to change. Several may be active.
6. State what is still unknown about the request itself — not about the code. An unknown
   here is exactly what makes a router pick wrong.
7. Read `.agents/local/project.md` section 13. List the companions declared for the
   recommended workflow's first phase, and — when step 6 found an unknown — the `clarify`
   row first: that is where the unknown gets resolved before any workflow starts.

## HAND OVER

Report:

```text
SR ROUTER

Request:        <one sentence>
Intent:         <intent(s)>
Recommended:    <workflow(s), in order>
Risk:           <R0-R3, and why>
Dimensions:     <active dimensions, or none expected>
Unknown:        <what would change this recommendation, or None>
Companions:     <section 13 rows for `clarify` (if Unknown is not None) and the first phase, or none declared>

Next: run <workflow> to start, or say which one you want instead.
```

Then stop.

## Why this stops

The eight workflows differ in what they are authorized to do — one only reads, one repairs
production code, one runs destructive checks. Choosing on someone's behalf and then acting
on the choice puts a classification error and an authorization decision in the same
uninterrupted step. Recommending costs one line of typing and removes that failure entirely.

If the request is unambiguous and low risk, say so plainly. A router that hedges on
everything is as useless as one that guesses.
