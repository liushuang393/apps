# SR Design Artifacts

What each design artifact must contain, independent of how it is laid out.

This file owns the _meaning_. A template in `.agents/core/templates/` owns the _shape_. Keep
them separate: a repository that mandates a document format changes the template, never
this file.

## The three PLAN artifacts

| Artifact                | Answers                                                        |
| ----------------------- | -------------------------------------------------------------- |
| `00-requirements.md`    | What is being asked for, and how we will know it was delivered |
| `01-basic-design.md`    | How the system behaves after the change                        |
| `02-detailed-design.md` | What has to be built, in what order, proven by what            |

`03-implementation-report.md` and `04-verification-report.md` are phase reports, not
design. They are described in the workflow that produces them.

## Required content

### `00-requirements.md`

- Goal and business value.
- In scope / out of scope, stated as two lists. An empty out-of-scope list is a defect.
- Actors and their permissions.
- Acceptance criteria — measurable, individually testable, each with a stable ID.
- Constraints: compatibility, performance, security, operational.
- Assumptions, each marked as verified or unverified.
- Open questions, each with what would settle it.

### `01-basic-design.md`

- Business flow, normal path and failure paths. A flow with no failure path is a defect.
- Processing flow — the sequence of responsibilities, not the call stack.
- Data flow — what moves where, and what crosses a trust or process boundary.
- Principal data structures and their relationships.
- External interfaces — one row per interface, with direction and owner.
- Reuse decision for every capability the change needs: reused, extended, or new, with
  the path that was searched. "New" without a searched path is a defect.
- Confirmation items — everything that could not be established from evidence.

### `02-detailed-design.md`

- Screens, transitions and field definitions — only when the change has a UI. Say "no UI"
  rather than leaving the section empty.
- Uniform failure output: error classes, response shape, status mapping, and what is
  logged versus returned.
- API contract: one row per endpoint with input, output, authorization, and error codes.
- Interface and layer-boundary contract for anything crossing a module boundary.
- Data definitions with constraints, and the migration boundary if data changes shape.
- Task decomposition table — see `./decomposition.md`.
- Unit test case list per task: normal, abnormal, boundary, with expected results. This
  list is the RED material the build phase turns into failing tests first.

## Rules that apply to all three

- A section that cannot be filled from evidence is not filled from guessing. It becomes a
  confirmation item naming what is missing.
- An empty section is a defect. "Not applicable" is a valid value; blank is not.
- Every acceptance criterion carries an ID that survives into the decomposition table, the
  test evidence table, and the verification report.
- Write them in the language declared in `.agents/local/project.md` section 2.

## Template resolution

1. If `.agents/local/project.md` section 1 names a design template set, use the file in it
   whose name matches the artifact.
2. Otherwise, if `.agents/local/templates/` holds a file with that name, use it.
3. Otherwise, satisfy the required content above with a structure of your own.

A template never removes a required item. It may add, reorder, and rename headings.
