---
name: sr-bug
description: "Repair a non-trivial bug with Trellis: gated diagnosis, regression-first TDD repair, controlled horizontal expansion, independent review, verification, prevention analysis, and knowledge closeout."
disable-model-invocation: true
---

# sr-bug

<!-- sr-managed v5.3.0 -->
<!-- sr-context-profile {"base_common":["contract.md","method-router.md","artifact-map.md","approval-gate.md"],"entrypoint":"sr-bug","phase":null,"workflow":"bug-repair.md"} -->

This is a thin SR host adapter. The canonical workflow is repository-local.

1. Find the nearest repository ancestor containing `.agents/core/`.
2. Read `.agents/local/project.md` if it exists. It overrides core wherever they disagree.
3. Read `.agents/core/common/contract.md`.
4. Read `.agents/core/common/method-router.md`.
5. Read `.agents/core/common/artifact-map.md`.
6. Read `.agents/core/common/approval-gate.md`.
7. Read `.agents/core/workflows/bug-repair.md`.
8. Run the workflow from its current phase/state and stop at every human approval gate.

Trellis is the lifecycle authority. Treat external specialist skills as replaceable methods only, and route every write through `artifact-map.md`.

Never skip an `APPROVE` gate that the project's gate policy requires.
