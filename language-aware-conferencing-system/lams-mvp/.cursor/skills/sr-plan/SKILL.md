---
name: sr-plan
description: "Plan a software change with Trellis, evidence-first requirements, basic/detailed design, traceable acceptance criteria, and a mandatory human approval gate before implementation."
disable-model-invocation: true
---

# sr-plan

<!-- sr-managed v5.2.0 -->

This is a thin SR host adapter. The canonical workflow is repository-local.

1. Find the nearest repository ancestor containing `.agents/core/`.
2. Read `.agents/local/project.md` if it exists. It overrides core wherever they disagree.
3. Read `.agents/core/common/contract.md`.
4. Read `.agents/core/common/method-router.md`.
5. Read `.agents/core/common/artifact-map.md`.
6. Read `.agents/core/common/approval-gate.md`.
7. Read `.agents/core/workflows/basic-development.md`.
8. Run only the **PLAN** section of the workflow. Do not execute a later phase in the same invocation.

Trellis is the lifecycle authority. Treat external specialist skills as replaceable
methods only, and route everything they write through `artifact-map.md`.

Never skip an `APPROVE` gate that the project's gate policy requires.
