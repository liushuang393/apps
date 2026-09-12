<!-- sr-managed -->
# SR Project Binding — Example

A filled-in example. Copy the shape, not the values.
This file IS overwritten by the installer. Write your real settings in `project.md`.

## 1. Artifact destinations

| Logical destination | Real path in this repository |
|---|---|
| `spec` | `.trellis/tasks/<task>/prd.md` |
| `tickets` | `.trellis/tasks/<task>/implement.md` |
| `design` | `docs/designs/<YYYY-MM-DD>-<slug>/` |
| `evidence` | `docs/designs/<YYYY-MM-DD>-<slug>/evidence/` |
| `adr` | `docs/adr/` |
| `business_spec` | `docs/specs/business/` |
| `runbook` | `docs/runbooks/` |
| `glossary` | `CONTEXT.md` |
| `lessons` | `.trellis/spec/lessons/` |
| `scratch` | `tmp/` (git-ignored, deleted when the task closes) |
| `receipt` | `.agents/state/receipts/` (the default; listed here for visibility) |

## 2. Output language

Language for design documents, reports, and commit messages: Japanese

Language for code comments: Japanese or English

## 3. Verification commands

Defined in `.agents/local/checks/`. Present here: `format`, `lint`, `types`, `unit`, `build`.
No `integration` or `security` file — those checks do not exist in this repository yet.

## 4. Gate policy

gates: all

## 5. Prohibited actions

- Never push, open a PR, merge, or call any hosted-Git API. Stop at the local working tree
  and report what is ready.
- Never run `git checkout` / `reset` / `restore` / `stash` without explicit permission.
- Never use `--force` on any command.

## 6. Available Trellis capabilities

- Task lifecycle: `python3 ./.trellis/scripts/task.py create|start|list|current`
- Spec store: `.trellis/spec/` with per-package index files
- Step detail: `python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>`
- Sub-agents: `trellis-implement`, `trellis-check`, `trellis-research`
- Past-conversation search: `trellis mem`
- Multi-agent collaboration: `trellis channel`

## 7. Language / framework notes

`.agents/local/methods/python.md` — conda environment, import rules, type policy.

## 8. Zones

| Zone id | Path globs | Rule set | Ownership source |
|---|---|---|---|
| `shared` | `shared/**`, `packages/common/**` | `.agents/local/zones/shared.md` | codeowners |
| `product-a` | `apps/product-a/**` | `.agents/local/zones/product-a.md` | codeowners |
| `product-b` | `apps/product-b/**` | `.agents/local/zones/product-b.md` | `apps/product-b/OWNERS` |

`shared` is stricter than either product zone: a change there needs a consumer/architecture
reviewer because both products depend on it.

## 9. Ownership sources

| Source | Path or command |
|---|---|
| Code owners | `.github/CODEOWNERS` |
| Module metadata | `apps/*/module.json`, field `owner` |

## 10. Risk and estimate calibration

- Anything under `infra/**` or touching a migration is R3 regardless of size.
- `apps/product-b/**` is a vendor-maintained zone: interface changes there are R2 even when
  the diff is small.
- Historical actuals: none kept. Estimates stay relative — complexity, range, assumptions,
  unknowns. Do not produce person-day figures.
