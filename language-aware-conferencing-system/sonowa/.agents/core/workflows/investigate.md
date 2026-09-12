# SR Investigation / Specification Workflow

The host adapter loads the base common contract once. Read additional common modules only when the current phase names them.

Artifacts, in `design` under `investigation/`:
`01-question-scope.md`, `02-findings-map.md`, `03-spec-impact-recommendation.md`, plus `evidence`.

This workflow does not implement production code. It may run the read-only checks
declared in `.agents/local/checks/` to find out what currently passes. It does not run
anything that writes to a shared or production system, and a check that cannot be run
safely is recorded as unknown rather than assumed.

## FRAME INTENT

1. Determine the question type: current behavior, business/spec discovery, impact analysis, architecture/design, historical decision, dependency/API/tool research, project onboarding/readiness, or other decision support.
2. Inspect immediate repo evidence before asking humans.
3. Use session/history recall only when the answer is not already in current artifacts/code/history.
4. State purpose, decision this investigation must enable, success criteria, scope, and non-goals.
5. Challenge solution-shaped assumptions with first-principles reasoning when useful.
6. Ask user-owned decisions only; give recommendation/trade-off. If knowledge belongs to another stakeholder, prepare a targeted questionnaire rather than guessing.
7. Write `01-question-scope.md` and stop at gate.

FRAME approval becomes stale if purpose, decision, scope, or non-goals materially change.

## INVESTIGATE

Precondition: approved frame.

1. Follow `../common/impact.md`: build the evidence map through an impact-search provider
   before reading source in bulk, expand the relevance cone only as far as the question
   needs, bind every row to a revision, and keep unknowns as unknowns.
2. Build a relevance coverage matrix. Mark every dimension `Relevant + Checked`, `Not relevant`, or `Blocked/Unknown`:
   - business/domain and terminology;
   - user journey/UI;
   - API/contracts;
   - service/domain logic;
   - data/schema;
   - async/events/jobs;
   - auth/security/privacy;
   - config/flags/env;
   - external integrations;
   - tests;
   - observability;
   - operations/release;
   - architecture/ADR;
   - history/tasks;
   - human docs/spec;
   - consumers/blast radius;
   - ownership — resolved through `../common/zones.md`, never guessed.
3. Prefer primary evidence: source/tests, official specs/API/docs, schema/contracts, authoritative business docs, ADR/history/tasks.
4. Use one research owner. Parallel workers are fine only for clearly independent lanes and must merge into one evidence set. Research output lands in `evidence`, never in a research skill's own default directory.
5. Use domain modeling for ambiguous terms/invariants and test edge-case scenarios.
6. Use a throwaway prototype only to answer a design question; it lives in `scratch` and never becomes production work.
7. Map relationships, not file lists: business rule -> UI/journey -> API -> domain/service -> data/events/external -> consumers, with tests/docs/ops attached.
8. Search aliases/old terminology and surprising history so renamed concepts are not missed.
9. Record contradictions, confidence, and missing evidence. Do not arbitrarily choose between code/docs/tests/user intent when they disagree. For a tool or environment failure, record the command/exit/primary-error signature and apply the two-attempt circuit breaker in `../common/contract.md`; after it opens, use a known fallback or record the exact blocker instead of repeating broad discovery.
10. Stop research when:
   - all relevant coverage rows are checked or explicitly blocked;
   - the approved decision can be made with cited evidence;
   - another research pass is unlikely to change the conclusion materially.
11. Write `02-findings-map.md` and stop at gate. Include the evidence map and the cone
    layers that were not expanded.

If material new evidence changes a core conclusion after approval, return to INVESTIGATE.

## SYNTHESIZE & SPEC IMPACT

1. Answer the approved question directly.
2. Separate confirmed facts, user intent, inference/recommendation, and unknowns.
3. Explain causal/ownership relationships and blast radius.
4. Identify impact on `business_spec`, `glossary`, API/contracts, `adr`, `runbook`, `.trellis/spec/`, tests/acceptance criteria, and reference docs as applicable.
5. For contradictions, recommend which source should become canonical and what human decision is required.
6. If code/product work is needed, define handoff scope and acceptance criteria for SR Plan,
   plus the change dimensions from `../common/change-envelope.md` that the work will activate.
7. When — and only when — an estimate was requested, add an estimate-ready section:
   confirmed affected assets, probable affected assets, unknown/blocked, change dimensions,
   dependency coupling, test surfaces, migration/data risk, owners, external decisions,
   confidence. With no historical calibration in `.agents/local/project.md` section 10, give
   relative complexity, a range, the assumptions, and the unknowns. Never produce a precise
   person-day figure that the evidence cannot support.
8. Write `03-spec-impact-recommendation.md` and stop at gate.
9. After final `APPROVE`: apply documentation/spec-only corrections only if explicitly in scope; otherwise close investigation or hand off to SR Plan.

Handoff out: `03-spec-impact-recommendation.md` is the file SR Plan reads. Keep the
approved decision, acceptance criteria, and open questions in it — a downstream workflow
must not have to re-read the whole investigation to find them.

## Project readiness

Only when the question type is project onboarding — a repository that has just been bound
and has never been changed through this workflow. The deliverable is not a new document.
It is a set of answers written into the places that already hold them, so that the next
change reads one source rather than a summary of one.

| Answered                                                        | Written into                                  |
| ---------------------------------------------------------------- | --------------------------------------------- |
| What this project is, and what it does                          | `.agents/local/project.md` §11.1, §11.2           |
| Main modules and which way the dependencies run                 | `.agents/local/project.md` §11.3                  |
| Runtime entry points, how it is built, how it is started        | `.agents/local/project.md` §11.3, §11.4, §11.5    |
| Which checks exist and what a pass looks like                   | `.agents/local/checks/*.md`, §11.6                |
| Where each check writes its machine-readable result             | the `Report:` line of each check file         |
| Which of them have been observed, and which observations are stale | `.agents/runtime/sr_readiness.py status` |
| What each check currently reports, and what already fails       | `.agents/runtime/sr_readiness.py baseline --check <name>`, by failure id |
| What kind of project this is, and where truth lives when documents and code disagree | `.agents/local/project.md` §12 |
| The business journeys a failure would be worst in — a handful   | `02-findings-map.md`, named, not enumerated   |
| What is unknown or inaccessible, and what would resolve it      | the investigation's unknowns, and the receipt |

Two things this is not. It is not repository-wide test creation: a journey with no harness
to run it is recorded as `identified, unproven`, and adopting a harness is separate
approved work (`../common/test-evidence.md`). And a baseline is a measurement — a check
that could not run has no baseline, and writing a plausible one there is worse than
leaving `unknown`, because every later comparison is then made against a number nobody
took.

Readiness is reached when the questions above are answered or explicitly blocked. It is
not a gate of its own; it is the state the first real change assumes. `../common/readiness.md`
names the states (`BOUND` → `OBSERVABLE` → `BASELINED`) and the admission each allows; a
repository that is only `BOUND` admits this workflow and nothing that edits production
code, which is why investigation is the way out of `BOUND`, not something it waits for.
