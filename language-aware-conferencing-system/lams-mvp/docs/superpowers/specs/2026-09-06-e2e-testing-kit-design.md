# E2E Testing Kit Integration Design

Date: 2026-09-06  
Status: Approved direction (Approach B)  
Canonical copy for agents: also see [`docs/testing/e2e-architecture-design.md`](../../testing/e2e-architecture-design.md)

## Summary

Integrate testing-kit v0.3.0 (installed-kit) with LAMS so the default path is:

`doctor → init → declare contracts → health → A-lane → fix loop → B-lane → certify`

Common procedure lives in the kit. Project fills only auth mapping, LiveKit, scenario oracles, and testids.

## Documents (archive)

| Doc | Path |
|-----|------|
| Index | `docs/testing/README.md` |
| Architecture | `docs/testing/e2e-architecture-design.md` |
| Runbook | `docs/testing/runbook.md` |
| Kit backlog | `docs/testing/kit-improvement-backlog.md` |
| LAMS backlog | `docs/testing/lams-improvement-backlog.md` |
| Reports | `docs/testing/report/` |

## Decision

- **Approach B**: strengthen kit contracts; LAMS owns domain deltas only.
- A-lane: deterministic (HTTP stub final; process mock transitional).
- B-lane: real AI, two primary flows only, manual gate.
- No auth bypass. No silent skip of missing capabilities. No production DB wipe.

## Non-goals

Second Playwright canon beside kit format; full language-matrix on first B run; infinite monitoring.
