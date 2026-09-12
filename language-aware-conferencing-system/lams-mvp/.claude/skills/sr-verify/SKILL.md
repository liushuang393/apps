---
name: sr-verify
description: "Verify an approved build against spec/design/acceptance criteria, run project checks, reconcile human documentation and durable lessons, then stop for final human approval before close."
disable-model-invocation: true
---

# sr-verify

<!-- sr-managed v5.3.0 -->
<!-- sr-context-profile {"base_common":["contract.md","method-router.md","artifact-map.md","approval-gate.md"],"entrypoint":"sr-verify","phase":"VERIFY","workflow":"basic-verify.md"} -->

This is a thin SR host adapter. The canonical workflow is repository-local.

1. Find the nearest repository ancestor containing `.agents/core/`.
2. Read `.agents/local/project.md` if it exists. It overrides core wherever they disagree.
3. Read `.agents/core/common/contract.md`.
4. Read `.agents/core/common/method-router.md`.
5. Read `.agents/core/common/artifact-map.md`.
6. Read `.agents/core/common/approval-gate.md`.
7. Read `.agents/core/workflows/basic-verify.md`.
8. Run only the **VERIFY** workflow view. Do not execute another phase in this invocation.

Trellis is the lifecycle authority. Treat external specialist skills as replaceable methods only, and route every write through `artifact-map.md`.

Never skip an `APPROVE` gate that the project's gate policy requires.
