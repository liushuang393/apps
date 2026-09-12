<!-- testing-kit-ai:generated:start -->
# Testing Kit AI Instructions

This file is generated from the Testing Kit package. Do not maintain a second copy of the
workflow here. Refresh it with `testing-kit ai-install` or the source-copy installer.

Kit reference: `{{KIT_REFERENCE}}`

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

{{GUIDANCE}}
<!-- testing-kit-ai:generated:end -->
