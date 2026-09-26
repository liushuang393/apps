# Directory Structure

> How frontend code is organized in this project (`frontend/`, React 18 + TypeScript + Vite).

---

## Overview

Flat, type-based layout under `frontend/src/` (no feature folders). Routing is a single
`<Routes>` table in `src/App.tsx`. All HTTP calls live in `src/api/` (domain modules re-exported by `client.ts`). Global state
is two Zustand stores. Styles are plain CSS (no CSS modules / Tailwind), one file per page.

---

## Directory Layout

```
frontend/src/
├── App.tsx              # BrowserRouter, AuthValidator, PrivateRoute/AdminRoute, route table
├── main.tsx             # entry
├── api/
│   ├── client.ts        # re-export barrel (public names only; apiFetch stays internal)
│   ├── http.ts          # API_BASE, ApiError, apiFetch
│   ├── auth.ts / rooms.ts / admin.ts / glossary.ts / meetings.ts  # xxxApi + DTOs + convertXxx
│   ├── __tests__/       # Vitest characterization tests (via ../client)
│   └── pipelineSettings.ts  # snake_case <-> camelCase mapping for AI pipeline settings
├── components/          # reusable UI used by pages (AudioControlPanel, SubtitleDisplay, ...)
├── constants/languages.ts   # LANGUAGE_NAMES, ALL_LANGUAGE_CODES, DEFAULT_ENABLED_LANGUAGES
├── contracts/
│   ├── liveEvent.generated.ts  # GENERATED from backend/app/ai_pipeline/event_contract.py
│   └── decodeLiveEvent.ts      # runtime validator for LiveKit data messages
├── hooks/               # useLiveKit, useAudioCapture, useAudioDevices, useTranslation
├── i18n/
│   ├── index.ts         # i18next init, SUPPORTED_LANGUAGES, LANGUAGE_DISPLAY_NAMES
│   └── locales/{ja,en,zh,vi}.json
├── pages/               # one route = one *Page.tsx (15 files)
├── preferences/applyPreferenceChange.ts  # small non-React domain helper
├── qoe/listenerLocalQoE.ts               # plain class, no React
├── store/               # authStore.ts, roomStore.ts (Zustand)
├── styles/
│   ├── main.css         # imports _tokens.css, _base.css, _shared.css only
│   ├── _tokens.css      # CSS variables (colors, shadows, radii)
│   └── pages/*.css      # page-specific CSS, imported by the page TSX
└── types/index.ts       # shared domain types (User, Room, SubtitleData, ...)
```

Unit tests live in `__tests__/` beside the module (Vitest). E2E tests live outside the frontend
package in `e2e/` (Playwright; see quality-guidelines.md).

`src/api/` is split by domain: `http.ts` (`API_BASE`, `ApiError`, `apiFetch`; imports no other api
module), `auth.ts`, `rooms.ts`, `admin.ts`, `glossary.ts`, `meetings.ts`, `pipelineSettings.ts`.
`client.ts` is a re-export barrel — pages keep importing from `../api/client`; add new endpoints to
the domain module and re-export the public names from `client.ts`.

---

## Module Organization

- **New screen**: add `src/pages/XxxPage.tsx`, register it in `src/App.tsx` wrapped in
  `<PrivateRoute>` (and `<AdminRoute>` for `/admin/*`), add `src/styles/pages/xxx.css`
  and import it from the page: `import '../styles/pages/admin.css';` (see `pages/AdminPage.tsx`).
- **New API call**: add a method to the matching `xxxApi` object in its domain module (`src/api/admin.ts` etc.),
  plus the snake_case response interface and a `convertXxx` mapper when needed.
- **Non-React logic** (pure functions, classes) goes in a small domain folder like
  `src/qoe/` or `src/preferences/`, not in `hooks/`.
- **Shared types** go in `src/types/index.ts`; API-only response types stay in the `src/api/` domain module.
- **Never hand-edit** `contracts/liveEvent.generated.ts`. It is regenerated from the backend
  (`python -m app.ai_pipeline.event_contract <out>`), and `backend/tests/test_events.py`
  fails if it drifts from the canonical schema.
- **Do not add styles to `main.css`** (its header says so) — put them in `styles/pages/*.css`,
  or `_shared.css` only if used by several pages.

---

## Naming Conventions

| Kind | Rule | Example |
|------|------|---------|
| Page | `PascalCase` + `Page.tsx`, named export | `pages/RoomListPage.tsx` -> `export function RoomListPage()` |
| Component | `PascalCase.tsx`, named export | `components/MeetingModePanel.tsx` |
| Hook | `useCamelCase.ts` | `hooks/useAudioDevices.ts` |
| Store | `xxxStore.ts`, hook `useXxxStore` | `store/authStore.ts` -> `useAuthStore` |
| Page CSS | `kebab-case.css` | `styles/pages/language-settings.css` |
| Generated | `*.generated.ts` | `contracts/liveEvent.generated.ts` |

No default exports (only `i18n/index.ts` exports `default i18n`). No barrel `index.ts`
files except `types/index.ts` and `i18n/index.ts`.

---

## Known Debt

- `src/hooks/useLiveKit.ts` is 597 lines; `styles/pages/room.css` is 916 lines.
- `useTranslation` exists both in `hooks/useTranslation.ts` (subtitle text translation API)
  and in `react-i18next` (UI strings). Check the import path — only
  `components/SubtitleDisplay.tsx` uses the local hook.
