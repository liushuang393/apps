# SR Artifact Map

Where anything written during an SR workflow goes.

Two halves. This file owns the left half and ships with the suite; it is generic
knowledge about SR and about common external skills. `.agents/local/project.md` owns the
right half and belongs to the repository.

## Logical destinations

Workflows and this file only ever name these. They never name a real path.

| Logical destination | Holds                                                              |
| ------------------- | ------------------------------------------------------------------ |
| `spec`              | Approved requirement/specification for the current work            |
| `tickets`           | Decomposed units of work and their ordering                        |
| `design`            | Requirements, basic/detailed design and phase reports for one task |
| `module_design`     | The standing design of one module, kept next to that module's code |
| `evidence`          | Run output, traces, screenshots, scan results, reports             |
| `adr`               | Architecture decision records                                      |
| `business_spec`     | Human-facing business behavior specification                       |
| `runbook`           | Operations and recovery procedures                                 |
| `glossary`          | Domain vocabulary                                                  |
| `lessons`           | Durable engineering lessons worth keeping past this task           |
| `scratch`           | Disposable working files, deleted when the task closes             |
| `receipt`           | Verification receipts — see `./receipt.md`                         |

Resolve each to a real path through `.agents/local/project.md` section 1.

`receipt` is the one destination with a default: `.agents/state/receipts/`. That directory is
SR's own, not the repository's, so it needs no binding to work. Map it in section 1 if the
repository wants receipts somewhere its own tooling can see.

If a destination is unmapped, stop and ask. Do not guess a path and do not create a
new top-level directory.

## External skill redirection

Specialist skills carry their own default output paths. Those defaults were written
for a repository that has no SR/Trellis lifecycle, and following them creates a second
specification store, a second ticket ledger, or evidence that lands outside the task.

When a method skill is about to write, redirect it. Keep its technique, replace its path.

| External default                                | Redirect to                                     | Why                                                        |
| ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------- |
| `.scratch/<feature-slug>/spec.md`               | `spec`                                          | Otherwise a second PRD competes with the lifecycle owner's |
| `.scratch/<feature-slug>/issues/<NN>-<slug>.md` | `tickets`                                       | Otherwise a second ticket ledger                           |
| `.scratch/<effort>/map.md`                      | `tickets`                                       | Same ledger, different name                                |
| `.out-of-scope/<concept>.md`                    | `tickets` (as a follow-up, marked out of scope) | Rejected work is still work the lifecycle owner tracks     |
| `<tmpdir>/*-review-<timestamp>.html`            | `evidence`                                      | A temp file is not evidence — it disappears                |
| `research/<name>`                               | `evidence`                                      | Research backing a decision belongs with the decision      |
| `/prototype/<name>`                             | `scratch`                                       | A throwaway experiment must be visibly throwaway           |
| `./learning-records/`, `./lessons/`             | `lessons`                                       | One place for durable lessons                              |
| `CONTEXT.md`                                    | `glossary`                                      | Only if the repository uses it as a glossary               |
| `docs/adr/`, `src/*/docs/adr/`                  | `adr`                                           | Follow the repository's actual ADR location                |

Reading an external default path is fine. Writing to one is not.

## Skills that edit repository-wide configuration

Some setup-style skills edit root-level files such as `CLAUDE.md`, `AGENTS.md`, or
`docs/agents/*.md` directly. Inside an SR workflow, never let that happen implicitly:
report the proposed edit at the phase gate and let a human apply or approve it.

## `design` versus `module_design`

`design` is one task's record: what was decided, built and verified, at a revision. It is
never rewritten by a later task.

`module_design` is the standing truth about a module. It is rewritten by every task that
changes that module's behavior. It lives next to the code so that the set of design
documents relevant to a change is derivable rather than searched for:

```text
change envelope -> the files it touches -> the modules those files belong to
                -> those modules' module_design, and nothing else
```

While implementing, read only that set. The wider reconciliation happens once, in
closeout (`./closeout.md`), where every affected module is dispositioned.

If `module_design` is unmapped, the repository keeps no standing module designs. Closeout
records that as a follow-up rather than inventing a location.

## Naming

Within a `design` directory, use the artifact names the workflow specifies
(`00-requirements.md`, `01-basic-design.md`, `02-detailed-design.md`, …). Do not renumber,
do not translate the filename, and do not combine several artifacts into one file.

Skeletons resolve in this order: the design template set named in `.agents/local/project.md`
section 1, then a matching filename in `.agents/local/templates/`, then the built-in structure.
A skeleton may add, reorder and rename headings; it may never drop a required item from
`./design-artifacts.md`.
