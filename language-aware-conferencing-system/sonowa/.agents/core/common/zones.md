# SR Zone and Ownership Resolution

In a repository of any size, the rule that applies and the person who must approve depend
on *where* in the repository the change lands. One global standard either forces
heterogeneous subsystems into a shape that does not fit them, or is so weak it stops
meaning anything.

This file owns the mechanism. `.agents/local/project.md` sections 8 and 9 own the content.

## Zones

A zone is a named region of the repository with its own rules and its own owner.

Declared in `project.md` section 8: a zone id, one or more path globs, an optional rule
set, an optional ownership source. Names and paths belong to the repository.

Resolution for any path:

1. Match the path against every declared zone glob.
2. Exactly one match — that zone's rules apply.
3. No match — no zone rules apply; the project-level rules apply unchanged.
4. More than one match at the same specificity — this is a configuration error. Stop and
   report it. Do not pick one.
5. More than one match at different specificities — the most specific glob wins.

A repository with no section 8 has no zones. That is a valid configuration: every path
resolves to the project level. Never invent a zone because the directory layout suggests one.

`install.py --doctor` runs this resolution over the declared globs and fails on an
equal-specificity collision.

## Rule overlay

```text
SR safety floor  <  organization policy  <  project rule  <  zone rule  <  task decision
```

Later layers narrow earlier ones. **Safety is stricter-wins:** a zone rule or a task
decision can add a constraint, never remove one. If a zone appears to permit something the
safety floor forbids, the safety floor holds and the conflict is reported.

The safety floor is what `./contract.md` marks as always required regardless of gate
policy: human authorization for production, destructive, irreversible, privileged, or
external-system actions, and the prohibitions in `project.md` section 5.

## Ownership

SR keeps no roster of people. Ownership is resolved from whatever the repository already
treats as canonical, listed in `project.md` section 9 — a `CODEOWNERS`-style file, module
metadata, an existing ownership document, or the zone declaration itself.

- Resolve owner per asset, not per task.
- An asset with no resolvable owner is reported as unowned, not assigned to a guess.
- Ownership feeds `./review.md` as a *required capability*, and the repository decides who
  holds it.

When a change spans zones, list every affected owner and say which zone each one owns.
Whether one person or several should carry that work is an organizational question this
suite does not answer.

## Shared assets

A change to an asset that several zones depend on is not a local change. Treat it as
cross-cutting in `./change-envelope.md`, and expand the reverse-consumer layer of the
relevance cone in `./impact.md` before planning it.
