---
name: sr-route
description: "Classify a natural-language development request into the right SR workflow: intent, risk level, change dimensions, and open unknowns. Recommends and stops; it never implements."
disable-model-invocation: true
---

# sr-route

<!-- sr-managed v5.3.0 -->
<!-- sr-context-profile {"base_common":["contract.md","method-router.md"],"entrypoint":"sr-route","phase":null,"workflow":"router.md"} -->

This is a thin SR host adapter. The canonical workflow is repository-local.

1. Find the nearest repository ancestor containing `.agents/core/`.
2. Read `.agents/local/project.md` if it exists. It overrides core wherever they disagree.
3. Read `.agents/core/common/contract.md`.
4. Read `.agents/core/common/method-router.md`.
5. Read `.agents/core/workflows/router.md`.
6. Run the workflow from its current phase/state and stop at every human approval gate.

Trellis is the lifecycle authority. Treat external specialist skills as replaceable methods only.

Never skip an `APPROVE` gate that the project's gate policy requires.
