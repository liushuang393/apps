<!-- sr-managed -->
# Verification commands

One file per check kind. This directory ships empty on purpose.

Recommended file names — create only the ones that exist in this repository:

```
format.md  lint.md  types.md  unit.md  integration.md  build.md  security.md  e2e.md
differential.md
```

Each file holds the exact command, plus what a pass looks like and any known
pre-existing baseline failures. Keep it short:

```markdown
# lint

    ruff check . --output-format junit -o tmp/junit-lint.xml

Report: junit tmp/junit-lint.xml
Pass: exit 0.
Baseline: see .agents/state/readiness/baselines/lint.json
```

`Report: junit <path>` names the JUnit XML the command writes, so
`.agents/runtime/sr_readiness.py baseline` records which ids fail rather than how many.
The runner never adds the flag itself — the command asks for the report, the line declares
it. Without the line the check is exit-only. `Invalidation: <path> ...` adds files whose
change makes the baseline stale, beyond the dependency and tool-config defaults. See
`.agents/core/common/readiness.md`.

`differential.md` exists only where one implementation is replacing another and a
comparator already runs both against the same input. It names that command; the case
list and the old/new invocations belong to the migration, not to this file.

A missing file means the check does not exist here. SR workflows must say so
rather than inventing a command.
