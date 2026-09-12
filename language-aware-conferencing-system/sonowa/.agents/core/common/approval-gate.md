# SR Approval Gate

At every phase end, show:

```text
SR <WORKFLOW> — <PHASE> READY FOR HUMAN APPROVAL

Trellis task:
- <task path/link/id>

Approval scope:
- Repository revision: <HEAD/commit when available>
- Artifacts/evidence: <direct links/paths>

Decisions:
- <important decisions>

Companions (project.md section 13):
- <companion> — used | not needed: <why> | not available

Checks:
- [x] <check name> — <command from .agents/local/checks/> — <result>
- [ ] <check name> — not defined in this repository

Open blockers:
- None

Known risks / accepted assumptions:
- <items or None>

Next:
Reply `APPROVE` to unlock <next phase or finish>.
```

If `Open blockers` is not `None`, do not request approval.

When the gate policy in `.agents/local/project.md` section 4 lets this phase continue
without a hard gate, still emit the same block with the final line replaced by:

```text
Next:
Continuing to <next phase> under gate policy `<policy>`. Reply `STOP` to hold.
```

A phase never continues without producing its artifact and stating its decisions.
