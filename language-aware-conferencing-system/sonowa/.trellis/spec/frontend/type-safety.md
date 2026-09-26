# Type Safety

> TypeScript conventions in this project.

---

## Overview

`frontend/tsconfig.json`: `strict: true`, `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`, `isolatedModules`, `moduleResolution: bundler`.
ESLint uses `@typescript-eslint/recommended` (no `any` rule override). Current code has
**zero** `any`, `@ts-ignore`, or `@ts-expect-error` — keep it that way.
No runtime validation library (no zod/yup); runtime checks are hand-written type guards.

---

## Type Organization

| Location | Contents |
|----------|----------|
| `src/types/index.ts` | shared domain types in camelCase: `User`, `Room`, `SupportedLanguage`, `AudioMode`, `MeetingMode`, `SubtitleData`, `QosWarningData`, `RoomMediaState` |
| `src/api/client.ts` | API DTOs: private snake_case `XxxApiResponse` interfaces + exported camelCase result types (`TranscriptData`, `AdminUser`, `GlossaryTerm`) |
| `src/api/pipelineSettings.ts` | split-out DTOs + `mapPipelineSettings` / `toPipelineSettingsPutBody` |
| `src/contracts/liveEvent.generated.ts` | generated LiveKit event types (`LiveEvent`, `SubtitleEvent`, ...) — do not edit |
| Component / hook file | its own `XxxProps`, `UseXxxReturn`, internal interfaces |

- Use `interface` for object shapes (Props, state, DTOs); `type` for unions and aliases
  (`export type AudioMode = 'original' | 'translated';`, `export type ConnectionStatus = ...` in `roomStore.ts`).
- Use `import type { ... }` / inline `type` specifiers for type-only imports
  (`import type { User } from '../types';`).
- Derive types from constants instead of duplicating:
  `export const SUPPORTED_LANGUAGES = ['ja', 'en', 'zh', 'vi'] as const;`
  `export type UILanguage = (typeof SUPPORTED_LANGUAGES)[number];` (`i18n/index.ts`).
- `Record<Union, T>` for exhaustive lookup tables (`LANGUAGE_NAMES: Record<AllLanguageCode, string>` in `constants/languages.ts`).

---

## API Boundary (snake_case -> camelCase)

Backend JSON is snake_case; the UI uses camelCase. Convert in `api/client.ts`, never in components:

```ts
interface UserApiResponse { id: string; display_name: string; native_language: string; role: string; ... }

function convertUser(u: UserApiResponse): User {
  return {
    id: u.id,
    displayName: u.display_name,
    nativeLanguage: u.native_language as SupportedLanguage,
    role: (u.role || 'user') as User['role'],
    ...
  };
}
```

Exception (legacy): auth endpoints return `{ access_token: string; user: User }` with a
snake_case key; keep that shape since `setAuth(res.access_token, res.user)` is used in several places.

---

## Validation

- Untrusted input is typed `unknown` and narrowed with guards. Canonical example
  `contracts/decodeLiveEvent.ts`:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
export function decodeLiveEvent(value: unknown): LiveEvent | null { ... }
```

  `useLiveKit.ts` decodes every data message via `decodeLiveEvent(raw)` and drops `null`.
- Errors: `catch (err)` then narrow — `err instanceof ApiError && err.status === 401`, or
  `err instanceof Error ? err.message : t('auth.loginFailed')`. `App.tsx` annotates `(err: unknown)`.

---

## Common Mistakes / Forbidden

- `any` (CLAUDE.md) — use `unknown` + a guard.
- Non-null assertions / double casts to silence errors. The one `as unknown as LiveEvent` in
  `decodeLiveEvent.ts` is allowed only because every field was validated right before it.
- Editing `liveEvent.generated.ts` by hand, or adding a live-event field only on the frontend.
  Change `backend/app/ai_pipeline/event_contract.py`, regenerate, and let `backend/tests/test_events.py` verify.
- Leaking snake_case DTOs into components or stores.
- Redefining language unions locally — import `SupportedLanguage` / `AllLanguageCode` from `types`.

## Known Debt

`api/client.ts` casts backend strings to unions without checking
(`r.default_audio_mode as AudioMode`, `languageSettings.enabledLanguages as SupportedLanguage[]`
in `RoomListPage.tsx`) — ~39 `as X` casts overall. Tolerated at the API boundary; don't spread it into UI code.
