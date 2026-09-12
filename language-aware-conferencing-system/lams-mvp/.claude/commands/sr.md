---
description: "Classify a natural-language development request into the right SR workflow: intent, risk level, change dimensions, and open unknowns. Recommends and stops; it never implements."
---

<!-- sr-managed v5.3.0 -->

Invoke the `sr-route` SR skill for the current request.
Follow its Trellis ownership rules and stop at every mandatory human `APPROVE` gate.
