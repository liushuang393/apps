# SR Method Router

Treat external skill names as replaceable implementation details. Route by capability.

```text
one lifecycle owner, many capability providers
```

The lifecycle owner is Trellis, and there is exactly one. Everything else — testing,
debugging, review, search, indexing, security reasoning — is a capability with zero or
more providers, chosen per capability, replaceable without touching a workflow.

## Resolution order

0. Read `.agents/local/project.md` and `.agents/local/methods/`. A repository-declared method
   for a capability wins over everything below. Section 13 of `project.md` lists, per phase,
   the companions the repository wants considered — name each as used or not needed at the
   phase start; that is the one place a skill name is meant to be seen.
1. Use project-native authoritative tooling/methods.
2. Otherwise use one compatible installed specialist skill.
3. Otherwise execute the method directly from the SR workflow.
4. Never fail only because a particular named skill is absent.
5. Never expose method skill names as extra commands the programmer must memorize.

## Capability labels

- `sr_method_tdd`: behavior-first test-driven development.
- `sr_method_debug`: reproduce -> minimize -> hypothesize -> instrument -> root cause.
- `sr_method_review`: independent Standards + Spec/diff review.
- `sr_method_architecture`: boundaries, interfaces, reuse, migration, rollback/recovery.
- `sr_method_domain`: terms, invariants, states, edge cases, contradictions.
- `sr_method_research`: primary-source code/docs/API research.
- `sr_method_questioning`: evidence-first decision interrogation.
- `sr_method_first_principles`: challenge assumptions and derive requirements from ground truths.
- `sr_method_history`: retrieve prior decisions/session context when current artifacts are insufficient.
- `sr_method_multi_agent`: independent parallel investigation/review when work divides cleanly. Dispatch is governed by `./dispatch.md` — shielding reads only, never concurrent writers.
- `sr_method_ui`: UI states, design-system reuse, responsiveness, accessibility.
- `sr_method_security`: defensive threat/security reasoning and remediation validation.
- `sr_method_e2e`: deterministic critical-journey test design and flake diagnosis.
- `sr_method_merge`: intent-preserving conflict resolution.
- `sr_method_human_setup`: credentials/dashboard/cutover steps only a human can perform.
- `sr_method_prototype`: throwaway experiment used to answer a design question.
- `sr_capability_impact_search`: deterministic evidence about what a change touches — see `./impact.md`.
- `sr_capability_ownership`: resolve an asset to its canonical owner — see `./zones.md`.
- `sr_capability_metrics`: local aggregation of receipts — see `./receipt.md`.

## Conflict rules

- Exactly one lifecycle owner. A second one is a defect, not a configuration.
- Zero ambiguous capability providers: if two installed providers claim the same
  capability with no declared preference, state the ambiguity and ask. Do not pick.
- Zero duplicate auto-triggers for the same situation.
- A capability with no provider falls back to the SR workflow doing it directly, and says
  which capability had no provider. It never fails only because a named skill is absent.

`install.py --doctor` checks these at install time.

## Trellis / specialist collision rule

Trellis owns orchestration. Avoid specialist capabilities that duplicate Trellis lifecycle ownership such as parallel PRD/task creation, implementation orchestration, general research ownership, final check ownership, or finish/archive.

A second review or research worker is allowed only when independence adds explicit value; it reports into the same SR/Trellis task, in the form `./dispatch.md` requires.

If an auto-invoked external skill tries to become a second supervisor, retain useful method guidance and ignore its competing lifecycle/artifact/finish instructions.

## Output redirection

A method skill's technique is portable. Its output paths are not.

Every write a method produces goes through `./artifact-map.md`: resolve the skill's
default path to a logical destination, then resolve that destination through
`.agents/local/project.md`. Never let a method write to its own hardcoded path, and never
let a method edit repository-wide configuration files on its own — surface that as a
proposed change at the phase gate.
