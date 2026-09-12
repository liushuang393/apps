---
name: sr-build
description: "Build an approved Trellis plan using spec-driven development, mandatory TDD, reuse-first implementation, static checks and CI, then stop for human approval before verification."
disable-model-invocation: true
---

# sr-build

<!-- sr-managed v5.3.0 -->
<!-- sr-context-profile {"base_common":["contract.md","method-router.md","artifact-map.md","approval-gate.md"],"entrypoint":"sr-build","phase":"BUILD","workflow":"basic-build.md"} -->

This is a thin SR host adapter. The canonical workflow is repository-local.

1. Find the nearest repository ancestor containing `.agents/core/`.
2. Read `.agents/local/project.md` if it exists. It overrides core wherever they disagree.
3. Read `.agents/core/common/contract.md`.
4. Read `.agents/core/common/method-router.md`.
5. Read `.agents/core/common/artifact-map.md`.
6. Read `.agents/core/common/approval-gate.md`.
7. Read `.agents/core/workflows/basic-build.md`.
8. Run only the **BUILD** workflow view. Do not execute another phase in this invocation.

Trellis is the lifecycle authority. Treat external specialist skills as replaceable methods only, and route every write through `artifact-map.md`.

Never skip an `APPROVE` gate that the project's gate policy requires.
