# SR Sub-agent Dispatch

A sub-agent is a shield, not a workforce.

## When to dispatch

One situation only: a read that would pollute the main context — investigation, impact
analysis, independent review, a scan. The sub-agent reads widely and returns a conclusion.

Writing code is never dispatched. The main session holds the single writer for the
duration of a slice (`./requirement-interaction.md`), and a writer that cannot see the
other writers' edits is how contracts drift apart without anyone noticing.

`Parallel: yes` in a decomposition table records dependency structure. It does not
authorize concurrent writers.

## The brief

Six fields. A dispatch missing any of them is not sent.

| Field      | Content                                                               |
| ---------- | --------------------------------------------------------------------- |
| Background | What the whole change is trying to do. One paragraph.                 |
| Purpose    | What this dispatch must settle. One sentence.                         |
| Position   | Which phase and which task this is part of.                           |
| Input      | An explicit list of files, with the revision.                         |
| Output     | The three-section template below.                                     |
| Prohibited | No writes. No reading outside the input list. No guessed conclusions. |

`Input` is the field that decides whether this works. "Read the repository", "look at the
codebase", or a directory with no boundary hands the sub-agent the same unbounded problem
the dispatch was supposed to contain. Name the files. If the right files are not yet
known, that discovery is itself the dispatch, and its output is the list.

## The return

Three sections. Nothing else comes back.

```text
## Conclusion
The answer to Purpose. "Cannot determine" is a valid conclusion.

## Evidence
path:line rows. Something a reader can open. A summary is not evidence.

## Unresolved
What was attempted, and what access, artifact or decision would settle it.
```

A conclusion with no evidence rows is rejected and re-dispatched, not accepted with a
caveat.

## Persistence

At risk R2 and above, write the brief and the return to `evidence` before acting on them.
Below R2, do not: a disposable investigation should not leave files behind.

## Failure modes this prevents

```text
the sub-agent reads everything and returns a summary of the repository
the main session receives raw file dumps it never asked for
two sub-agents edit the same file and the conflict surfaces at integration
a conclusion is trusted because it sounds confident, with nothing to open
```
