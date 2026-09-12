<!-- testing-kit-ai:generated:start -->
# Testing Kit AI Instructions

This file is generated from the Testing Kit package. Do not maintain a second copy of the
workflow here. Refresh it with `testing-kit ai-install` or the source-copy installer.

Kit reference: `installed testing-kit package (outside this project)`

Before planning or running E2E work, execute:

```bash
testing-kit ai-guide --format text
```

If the public command is not installed, resolve the kit root first.

- `Kit reference` above is a project-relative directory when the kit is vendored inside this
  project. Use it directly as the kit root.
- Otherwise the kit is installed outside this project. Print its root with:

```bash
python3 -c "from testing_kit.cli import kit_root; print(kit_root())"
```

Then read `<kit-root>/skills/testing-kit/SKILL.md` and `<kit-root>/docs/00-AI-ENTRY.md` directly.
Never hardcode that absolute path into a tracked file: it is machine-specific.

# Testing Kit portable AI operating contract

This contract is owned by the Testing Kit package and does not depend on root CLAUDE.md.
Entrypoint: docs/00-AI-ENTRY.md
Portable skill: skills/testing-kit/SKILL.md

## Required reads

- docs/00-AI-ENTRY.md
- docs/16-TEST-POLICY.md
- docs/17-PORTABLE-CERTIFICATION.md
- skills/testing-kit/SKILL.md
- docs/19-USER-OPERATIONS-GUIDE.md

## Required workflow

1. Select the kit lane before touching the project
   Command: testing-kit ai-guide --format text
   Rule: A kit installed outside the project uses the certify-project lane and must pass --project-root explicitly; the repository lane and --copy-isolated require a kit vendored inside the project and fail closed otherwise.
2. Inventory every project and module from source
   Command: testing-kit discover-targets --strict
   Rule: Use source-first discovery as the denominator; never infer total scope from existing tests or Compose services.
3. Publish the product to local Docker before E2E
   Command: Run the project-owned canonical Docker publish command
   Rule: Bind every result to Docker publish evidence and use published-only endpoints; do not substitute a host dev server.
4. Collect runtime and browser discovery evidence
   Command: testing-kit browser-discover --help
   Rule: Runtime reachability is evidence, not proof that business behavior is correct.
5. Prove every business pattern
   Command: testing-kit pattern-coverage --help
   Rule: Each priority business pattern needs 独立 observation channel 2 点以上; one response in two formats is one channel.
6. Repair only inside the declared authority boundary
   Command: testing-kit repair-check --help
   Rule: L1 may be automatic, L2 requires bounded review and gate reruns, and L3 HARD STOP forbids automatic semantic changes.
7. Run repeatable project certification
   Command: testing-kit certify-project --help
   Rule: Require Round 1/2 agreement and cleanup restore; missing evidence is a failure, never an implicit skip.

## Hard stops

- Docker publish evidence is missing, stale, or does not match the tested artifact.
- A source project or module is unclassified, silently skipped, or lacks an explicit N/A approval.
- Business correctness is inferred from source existence, route reachability, HTTP status, or UI visibility alone.
- A priority business pattern has fewer than two independent observation channels.
- A repair changes a role, expected value, assertion, business branch, fixture meaning, or skip behavior.
- Cleanup restore fails, Round 1/2 disagree, or required evidence is missing.
- An adapter is guessed despite missing or ambiguous capabilities.
- An external read-only inference API (LLM, speech recognition, machine translation, speech synthesis) is asserted by exact generated text, or its call count and cost cap are not measured in evidence.
<!-- testing-kit-ai:generated:end -->
