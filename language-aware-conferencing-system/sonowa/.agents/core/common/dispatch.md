# SR Sub-agent Dispatch

A sub-agent shields the main context from one bounded read; it is not a parallel writer.
Writing code is never dispatched. `Parallel: yes` records dependency structure only.

## Discovery then bounded work

If paths are unknown, run one discovery dispatch. It returns the evidence manifest below.
Every later dispatch receives that manifest, reads only its `Paths`, and may search outside the
manifest only to close a named `Unresolved` item. Update the manifest before another dispatch.

## Evidence manifest

| Field | Required content |
| --- | --- |
| Revision | Exact repository revision used for discovery |
| Paths | Explicit bounded path list; never “the repository” or an unbounded directory |
| Evidence | Openable path:line references supporting inclusion |
| Already-read hashes | Content hashes for material already inspected |
| Unresolved | Missing fact and what would settle it |
| Stop boundary | Condition at which reading stops |

A manifest missing any field is not dispatched. A later agent that reads outside the manifest
without closing a named unresolved item is rejected.

## Brief

The brief states Background, Purpose, Position, Input manifest, Output template, and Prohibited
actions. `Input` includes the manifest and revision. `Prohibited` says: no writes, no guessed
conclusions, no reads beyond the bounded rule above.

## Return

```text
## Conclusion
The answer to Purpose. "Cannot determine" is valid.

## Evidence
path:line rows a reader can open.

## Unresolved
What was attempted and what access, artifact, or decision would settle it.
```

A conclusion with no evidence row is rejected. At R2 or above, persist brief, manifest, and
return to `evidence`; below R2 keep disposable research out of the repository.
