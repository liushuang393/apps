---
name: sr-investigate
description: "Investigate questions and specifications without production implementation: clarify intent, inspect evidence comprehensively, map relationships and contradictions, then produce approved spec impact and handoff."
disable-model-invocation: true
---

# sr-investigate

<!-- sr-managed v5.2.0 -->

This is a thin SR host adapter. The canonical workflow is repository-local.

1. Find the nearest repository ancestor containing `.agents/core/`.
2. Read `.agents/local/project.md` if it exists. It overrides core wherever they disagree.
3. Read `.agents/core/common/contract.md`.
4. Read `.agents/core/common/method-router.md`.
5. Read `.agents/core/common/artifact-map.md`.
6. Read `.agents/core/common/approval-gate.md`.
7. Read `.agents/core/workflows/investigate.md`.
8. Run the workflow from its current phase/state and stop at every human approval gate.

Trellis is the lifecycle authority. Treat external specialist skills as replaceable
methods only, and route everything they write through `artifact-map.md`.

Never skip an `APPROVE` gate that the project's gate policy requires.
