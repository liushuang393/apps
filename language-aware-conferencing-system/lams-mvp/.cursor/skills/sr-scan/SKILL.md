---
name: sr-scan
description: "Run a gated quality and defensive security scan/remediation with baseline classification, safe test-backed fixes, independent review, re-scan, CI, and risk/documentation closeout."
disable-model-invocation: true
---

# sr-scan

<!-- sr-managed v5.2.0 -->

This is a thin SR host adapter. The canonical workflow is repository-local.

1. Find the nearest repository ancestor containing `.agents/core/`.
2. Read `.agents/local/project.md` if it exists. It overrides core wherever they disagree.
3. Read `.agents/core/common/contract.md`.
4. Read `.agents/core/common/method-router.md`.
5. Read `.agents/core/common/artifact-map.md`.
6. Read `.agents/core/common/approval-gate.md`.
7. Read `.agents/core/workflows/quality-security.md`.
8. Run the workflow from its current phase/state and stop at every human approval gate.

Trellis is the lifecycle authority. Treat external specialist skills as replaceable
methods only, and route everything they write through `artifact-map.md`.

Never skip an `APPROVE` gate that the project's gate policy requires.
