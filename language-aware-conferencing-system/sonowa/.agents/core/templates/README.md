<!-- sr-managed -->

# Design templates

Skeletons for the design artifacts described in `../common/design-artifacts.md`.

A template owns the _shape_ of a document — headings, order, table columns. The meaning
stays in `design-artifacts.md`. A template may add, reorder and rename headings. It may
never drop a required item.

## Shipped sets

| Set      | For                                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| `jp-si/` | Japanese SI-style design documentation: business flow, ER diagram, CRUD matrix, screen transitions, API list |

## Selecting one

`.agents/local/project.md` section 1:

```text
| Design template set | `.agents/core/templates/jp-si/` |
```

Unset means no shape is imposed: the required content in `design-artifacts.md` applies and
the structure is the assistant's to choose. That is the right default outside the
conventions a set encodes.

## Adding one

Create a sibling directory with files named after the artifacts
(`00-requirements.md`, `01-basic-design.md`, `02-detailed-design.md`) and point
`project.md` at it. A repository-private set belongs in `.agents/local/templates/` instead —
that directory is never overwritten by an install.

Templates are written in the language their users read. `jp-si/` is in Japanese by design.
