# SR Guard

Four checkpoints every SR workflow honors, regardless of host. Three are self-checks the
workflow performs; the fourth is also machine-verifiable.

| Checkpoint | When                                                                | Verifies                                                                                        |
| ---------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| pre-action | Before an action with external, destructive, or irreversible effect | The action is authorized by gate policy and not in `project.md` section 5                       |
| post-edit  | After each edit                                                     | The path is inside the approved change envelope                                                 |
| slice      | At the end of an implementation slice                               | Slice checks ran; no new warnings; the envelope did not grow silently                           |
| finish     | Before the final gate                                               | Receipt exists, is bound to the current revision, and carries no unrun check reported as passed |

## Machine check

```bash
python3 .agents/runtime/sr_guard.py check
```

Verifies from repository state alone:

- a receipt exists for the current task and its revision equals the current revision;
- `Result` is one of `passed` / `blocked` / `superseded`, not a synonym that would slip
  past every cross-check below;
- when `Result` is `passed`: the envelope, checks, acceptance-criteria, and unknowns
  tables each carry at least one row, so a section cannot be omitted into silence;
- when `Result` is `passed`: `Author` and `Reviewer` are both named and differ — the
  process does not get to certify itself;
- no check and no acceptance criterion is reported as passed while marked not run or
  while its verdict word is a failure;
- `Diff base` names a commit git can verify — it is checked before it reaches any other
  git command — and `FORBIDDEN` is judged over uncommitted changes and everything committed
  since that base;
- no acceptance criterion is passed with an empty, `-`, or `(none)` evidence cell;
- every `DEPENDENCY_REQUIRED` / `INCIDENTAL` envelope row carries a disposition of
  `child:<task>` or `behavior-preserving:<why>`;
- no tracked file matching a `FORBIDDEN` envelope pattern has been modified;
- **G-1** every acceptance criterion maps to exactly one task and every task to exactly one
  criterion, and no criterion-to-RED row carries a GREEN revision with an empty RED
  revision (`./decomposition.md`, `./test-evidence.md`);
- **G-2** every module derived from the change envelope carries one of `new` / `update` /
  `delete` / `unchanged` in the closeout reconciliation table (`./closeout.md`);
- **G-3** each produced design artifact carries the information `./design-artifacts.md`
  requires of it, and no required item is present-but-empty;
- **G-4** no line added by this change introduces a suppression — `noqa`, `type: ignore`,
  `pragma`, a skip marker, or an unfinished marker — without an adjacent statement of what
  breaks if the checker is obeyed, and how to reproduce it (`./anti-fake.md` item 3 and 5);
- **G-5** a receipt that built code names its `Test strategy`, and one naming `differential`
  either ran a differential check or says why the comparison could not be made
  (`./test-evidence.md`);
- **G-6** when the project has recorded baselines under `.agents/state/readiness/`, the
  receipt carries a `Baseline delta` table in which every recorded baseline appears, each is
  still current under its fingerprint, and every `New` failure id is explained in the
  unknowns or the acceptance criteria (`./readiness.md`). With no baseline recorded this is
  a note, not a pass and not a fail; with one recorded, a receipt without `Schema-Version`
  is refused rather than read as legacy.

Before any of these, the receipt's `Schema-Version` is read: absent means legacy and is
checked with the vocabulary of its time, `2` is current, anything else is refused. The
guard does not guess at a schema it does not know (`./receipt.md`).

Exit `0` means the finish checkpoint holds. Non-zero prints what failed.

Where a repository already owns a checker covering part of this ground — unfinished
markers, for instance — register it in `.agents/local/checks/`. The two findings will overlap
on that part; the repository's own message is the one to act on, because it knows the
local convention. G-4 still covers what that checker does not.

## What this cannot verify

The guard parses the receipt and the baseline files, and recomputes a fingerprint with
`git hash-object`. It runs no check — that stays with `.agents/runtime/sr_readiness.py`,
which a human invokes (`./readiness.md`). It proves the receipt is not internally dishonest
and not stale against the project's own baselines; it does not prove a command ran. A receipt that names a command never executed, with fabricated
evidence, passes. Nothing in a text file can close that — an independent `Reviewer` who
opens the evidence is the control, which is why the field is mandatory rather than nice.

## Host hooks

The installer does not wire this into any host's hook configuration, and does not edit
`CLAUDE.md`, `AGENTS.md`, or CI. A repository that wants `pre-action` or `post-edit`
enforced at the tool-call level wires the guard itself — see `INSTALLATION.md`.

Until then, those two checkpoints are obligations of the workflow, which means they are as
reliable as instructions ever are. The `finish` checkpoint is the one that does not depend
on that, which is why it is the one that got code.
