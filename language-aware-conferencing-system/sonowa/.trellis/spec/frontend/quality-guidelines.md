# Quality Guidelines

> Code quality standards for frontend development.

---

## Overview

Quality gates are ESLint + `tsc` (no Prettier config, no frontend unit-test runner) plus
Playwright E2E in the separate `e2e/` package. Both `npm run lint` and `npm run type-check`
pass cleanly on the current tree — any new warning fails lint (`--max-warnings 0`).

---

## Required Checks

```bash
cd frontend
npm run lint          # eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0
npm run type-check    # tsc --noEmit
npm run build         # tsc && vite build
# or from repo root:
./scripts/check.sh --frontend      # lint + type-check (CLAUDE.md: required before commit)
```

Note: `scripts/check.sh` only exits non-zero on **type** errors; an ESLint failure just prints
a red line and continues. Read its output — don't rely on the exit code.

ESLint config (`frontend/.eslintrc.cjs`): `eslint:recommended`,
`@typescript-eslint/recommended`, `react-hooks/recommended`, `react-refresh/only-export-components`
(warn), `@typescript-eslint/no-unused-vars` with `argsIgnorePattern: '^_'` (prefix unused args with `_`).

---

## Testing

- **No Vitest/Jest** in `frontend/`. Don't add a unit-test framework unless the task asks.
- **E2E**: Playwright in `e2e/` (`e2e/playwright.config.ts`, base URL `http://127.0.0.1:5273`,
  locale `ja-JP`, light color scheme). Suites: `smoke/`, `regression/`, `meeting/`,
  `certification/`, `visual/`. Before planning/running E2E, read `.testing-kit/AI-INSTRUCTIONS.md`
  and run `testing-kit ai-guide --format text` (CLAUDE.md).
- Spec file = scenario ID: `e2e/regression/AUTH-004.spec.ts`, titles start with the ID
  (`test.describe("[AUTH-004] ...")`) — enforced by `e2e/helpers/test-id.ts`.
- Bug fixes get a regression spec that fails before the fix and passes after (commit c8bd871
  added `AUTH-004`; 33910cd added `PROFILE-002`). Tests locate elements by `data-testid`
  and mock the API with `page.route`.
- UI/color changes: verify readability with a screenshot (commit 33910cd).

---

## Required Patterns

- Japanese comments: file-level JSDoc header on every file; JSDoc on exported functions
  stating purpose / input / output / caveats (see `loadRooms` in `pages/RoomListPage.tsx`:
  `入力: なし / 出力: ... / 注意: ...`).
- Named constants for numbers/strings with meaning (`QOE_STATS_INTERVAL_MS`, `STORAGE_KEY_MIC`,
  `LOSS_DEGRADE_RATIO` in `qoe/listenerLocalQoE.ts`).
- New UI text via `t()` with keys added to all of `i18n/locales/{ja,en,zh,vi}.json`
  (currently identical key sets, 218 keys each).
- Colors via `styles/_tokens.css` variables; light surfaces need dark text.

---

## Forbidden Patterns

| Pattern | Why / evidence |
|---------|----------------|
| `console.log` (and new `console.*`) | CLAUDE.md. Only one exists: `console.error` in `hooks/useLiveKit.ts` connect failure (debt). Surface errors via UI state (`setConnectionError`, `setError`). |
| `any`, `@ts-ignore` | CLAUDE.md; zero occurrences today |
| Magic numbers | CLAUDE.md; use named constants |
| Hardcoded secrets / API URLs | API base is always relative `/api` via Vite proxy (`api/client.ts` `API_BASE`) |
| White/near-white text on light backgrounds | fixed in `styles/pages/auth.css` (33910cd) |
| Logging out on non-401 errors | `App.tsx` AuthValidator, commit c8bd871 |
| Unjustified `eslint-disable` | only 3 exist, each with an explanatory comment |
| Editing `contracts/liveEvent.generated.ts` | generated; checked by `backend/tests/test_events.py` |

---

## File Size

CLAUDE.md: 500 lines recommended, hard limit 1000 (global) / 1500 (sonowa CLAUDE.md) — treat
1000 as the limit. Current oversize files (debt, split when touching heavily):
`api/client.ts` 902, `styles/pages/room.css` 916, `hooks/useLiveKit.ts` 597.

---

## Code Review Checklist

- [ ] `npm run lint` and `npm run type-check` clean
- [ ] No `any` / `console.*` / magic numbers / new hardcoded UI strings
- [ ] snake_case -> camelCase done in `api/client.ts`
- [ ] Token-issuing responses go through `setAuth(token, user)`; 401-only logout
- [ ] Existing `data-testid`s preserved; regression E2E added for bug fixes
- [ ] Text contrast checked on light backgrounds
