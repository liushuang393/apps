# Hook Guidelines

> How custom hooks are written and used in this project.

---

## Overview

Custom hooks live in `src/hooks/` and wrap browser / realtime APIs (LiveKit, Web Audio,
`mediaDevices`, the translate endpoint). There is **no data-fetching library** (no React Query,
no SWR): REST data is fetched inside pages with `useEffect` + `xxxApi` calls.

| Hook | Wraps |
|------|-------|
| `useLiveKit(roomId)` | LiveKit room connect, data messages -> `roomStore`, audio routing |
| `useAudioCapture({ deviceId, enabled, roomRef })` | mic stream, VAD, publish local track |
| `useAudioDevices()` | enumerate mics/speakers, persist selection to `localStorage` |
| `useTranslation()` | `POST /api/translate` with in-memory cache (NOT the i18n hook) |

---

## Custom Hook Patterns

- File `useXxx.ts`, `export function useXxx(...)` (named export), Japanese JSDoc header.
- Options object + explicit return interface for non-trivial hooks:

```ts
// hooks/useAudioCapture.ts
interface UseAudioCaptureOptions { ... }
interface UseAudioCaptureReturn { ... }
export function useAudioCapture({ deviceId, enabled, roomRef }: UseAudioCaptureOptions): UseAudioCaptureReturn {
```

  `useAudioDevices(): UseAudioDevicesReturn` follows the same shape. `useLiveKit` returns an
  inferred object literal (older style) — prefer an explicit `UseXxxReturn` for new hooks.
- Tunables are named module constants with a comment, never inline literals:
  `const STATE_UPDATE_THROTTLE_MS = 100;`, `const QOE_STATS_INTERVAL_MS = 2000;`,
  `const STORAGE_KEY_MIC = 'sonowa-selected-mic';`.
- Pure helpers used by the hook are module-level functions above it
  (`isPreferredDevice`, `selectBestDevice` in `useAudioDevices.ts`; `toStatus`,
  `subtitleDataFromEvent` in `useLiveKit.ts`).
- Mutable non-render state (SDK objects, timers, caches) is kept in `useRef`, and hot-path
  values are mirrored in refs and flushed to state on a throttle (`useAudioCapture.ts`,
  `lastStateUpdateRef` + `STATE_UPDATE_THROTTLE_MS`).
- Returned functions are wrapped in `useCallback`.
- Effects that start async work use a `cancelled` flag and a full cleanup (disconnect, clear
  timers, remove audio elements, `reset()` the store) — see the end of `useLiveKit.ts`.

---

## Data Fetching (in pages)

```ts
// pages/RoomListPage.tsx
const loadRooms = useCallback(async () => {
  try {
    setError(null);
    const [res, languageSettings] = await Promise.all([roomApi.list(), adminApi.getLanguageSettings()]);
    ...
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) { logout(); navigate('/login'); return; }
    ...
  } finally {
    setLoading(false);
  }
}, [logout, navigate]);

useEffect(() => {
  if (!hasHydrated) return;   // wait for persisted auth before calling the API
  ...
```

Always gate first-load API calls on `hasHydrated` from `useAuthStore`.

---

## Naming Conventions

- `use` prefix + camelCase; file name equals hook name.
- Return fields: state nouns (`microphones`, `error`, `loading`, `isMicOn`) and verb actions
  (`selectMicrophone`, `refreshDevices`, `sendPreferenceChange`).

---

## Common Mistakes / Forbidden

- Confusing `hooks/useTranslation` (translate API) with `react-i18next`'s `useTranslation`
  (UI strings). Pages/components use `react-i18next`; only `SubtitleDisplay` uses the local hook.
- Calling `fetch` directly in a new hook. `hooks/useTranslation.ts` does this for legacy
  reasons (own `API_BASE_URL`, swallows errors and falls back to the original text); new code
  should add a method to the matching `src/api/` domain module and use `apiFetch`.
- Adding `// eslint-disable-next-line react-hooks/exhaustive-deps` casually. It exists in exactly
  three places (`App.tsx` AuthValidator, `useLiveKit.ts` connect effect, `useAudioCapture.ts`),
  each for a deliberate "run once per key" effect with a comment explaining why. Any new one
  needs the same justification comment.
- Forgetting cleanup of LiveKit/Web Audio resources — leaks show up as duplicate audio
  or stale subtitles after leaving a room.
