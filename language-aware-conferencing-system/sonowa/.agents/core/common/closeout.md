# SR Knowledge / Human Documentation Closeout

Run before a final approval gate when the workflow changed or clarified meaningful behavior.

For each category, explicitly choose `Update`, `No change`, or `Follow-up`:

| Category                                    | Logical destination                                        |
| ------------------------------------------- | ---------------------------------------------------------- |
| Reusable engineering rule                   | `.trellis/spec/`                                           |
| Durable lesson worth keeping past this task | `lessons`                                                  |
| Human business behavior/rules               | `business_spec`                                            |
| Architecture rationale                      | `adr`                                                      |
| API/reference/changelog                     | `design` (or the repository's existing reference location) |
| Operations/recovery                         | `runbook`                                                  |
| Domain vocabulary                           | `glossary`                                                 |
| One-off evidence                            | `evidence`                                                 |

Destinations resolve through `./artifact-map.md` and `.agents/local/project.md`.
An unmapped destination is a question for a human, not a path to invent.

Ask:

- Did behavior visible to users/operators change?
- Did code/tests reveal existing docs are wrong?
- Would a new engineer/product/operator misunderstand the current behavior after reading the docs?
- Did API/schema/migration/recovery behavior change?
- Did an important architectural reason emerge?
- Is this lesson durable enough to archive?

Update required human-readable docs before final approval so the human can inspect the
actual diff/link. Write them in the language declared in `.agents/local/project.md` section 2.

If the documentation gap is large and outside scope, create a follow-up and state
whether close is safe without it.

## Module design reconciliation

Separate from the categories above, and not optional.

Derive the affected module set mechanically: the change envelope lists the files this work
modified; each file belongs to a module; that set is the scope. Do not recall it from
memory and do not narrow it to the modules that felt important.

Every module in that set gets exactly one disposition:

| Module | Disposition | Target | Basis |
| ------ | ----------- | ------ | ----- |

| Disposition | When                                                                | What happens                                                                       |
| ----------- | ------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `new`       | The module has no standing design                                   | Copy this task's design artifacts in as the first edition. No merging is involved. |
| `update`    | A standing design exists and its content is now wrong or incomplete | Merge into the specific section. Name the section in `Target`.                     |
| `delete`    | The design describes something this work removed                    | Remove that part, and say what replaced it if anything did                         |
| `unchanged` | Behavior visible from outside the module did not move               | State why in `Basis`. "Only types changed" is a reason; blank is not.              |

Rules:

- A module with no disposition blocks the finish checkpoint. `.agents/runtime/sr_guard.py check`
  enforces this against the recorded envelope.
- If an `update` cannot be placed in a section, do not fall back to `new` and do not append
  to the end of the document. Record it as a confirmation item and resolve it before close.
- `unchanged` is a claim about externally visible behavior, not about diff size.
- If `module_design` is unmapped in `.agents/local/project.md`, record one follow-up saying the
  repository keeps no standing module designs, and state whether closing is safe without it.

This is the step that stops task artifacts from accumulating while the standing design
quietly goes stale.

Then write the verification receipt described in `./receipt.md`. Closeout decides what the
knowledge stores should say; the receipt records that this phase actually completed, at
which revision, with which checks.
