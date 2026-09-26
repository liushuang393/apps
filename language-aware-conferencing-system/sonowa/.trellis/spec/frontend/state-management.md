# State Management

> How state is managed in this project.

---

## Overview

- **Global state**: Zustand v5, exactly two stores: `store/authStore.ts` and `store/roomStore.ts`.
- **Server state**: no cache library; pages fetch via `api/client` into local `useState`.
- **Local UI state**: `useState` in the page/component.
- **Persisted client prefs**: `localStorage` directly for small things
  (`useAudioDevices.ts` mic/speaker ids; i18next caches UI language under its own key).

---

## State Categories

| Where | What | Example |
|-------|------|---------|
| `useAuthStore` (persisted, key `sonowa-auth`) | `token`, `user`, `isAuthenticated`; runtime `hasHydrated` | login, route guards, `apiFetch` bearer |
| `useRoomStore` (in-memory) | current room, participants, subtitles, interim subtitles, connection status, QoS warnings, `mediaState` | written by `useLiveKit`, read by `SubtitleDisplay`, `ParticipantList` |
| Page `useState` | lists, forms, `loading`, `error` | `pages/RoomListPage.tsx` (`rooms`, `formState`, `creating`) |
| `useRef` in hooks | SDK objects, timers, caches | `useLiveKit.ts` `roomRef`, `audioEntriesRef` |

---

## Store Patterns

```ts
// store/authStore.ts
export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      ...
      setAuth: (token, user) => set({ token, user, isAuthenticated: true }),
      logout: () => set({ token: null, user: null, isAuthenticated: false }),
    }),
    {
      name: 'sonowa-auth',
      partialize: (state) => ({ token: state.token, user: state.user, isAuthenticated: state.isAuthenticated }),
      onRehydrateStorage: () => (state) => { state?.setHasHydrated(true); },
    }
  )
);
```

- State interface declares data **and** actions together (`interface RoomState { ...; addSubtitle: (...) => void; reset: () => void; }`).
- Updates are immutable: copy `Map`s before mutating (`const newMap = new Map(state.participants)`),
  spread records (`{ ...state.interimBySpeaker }`).
- Subscribe with selectors: `useAuthStore((s) => s.setAuth)`. `ParticipantList.tsx` defines
  module-level selectors (`const selectParticipants = (s: ReturnType<typeof useRoomStore.getState>) => s.participants;`).
  Some older code destructures the whole store (`const { user, logout, hasHydrated } = useAuthStore();`
  in `RoomListPage.tsx`, `useLiveKit.ts`) — acceptable but re-renders on any change; prefer selectors.
- Outside React use `useStore.getState()`: `apiFetch` reads the token that way
  (`api/client.ts`), and `preferences/applyPreferenceChange.ts` calls
  `useRoomStore.getState().updateMyPreference(patch)`.
- `roomStore.reset()` must be called when leaving a room (done in `useLiveKit` cleanup).

---

## When to Use Global State

Only when multiple unrelated components need it or it must survive navigation:
auth session, and the live room state pushed by LiveKit. Admin lists, glossary, transcript,
history, settings forms are page-local. Don't add a third store for one page's data.

---

## Common Mistakes / Forbidden

- **Updating token and user separately.** `setAuth(token, user)` replaces both at once. Every
  endpoint that returns a new token (`login`, `register`, profile update in `ProfilePage.tsx`,
  password change in `PasswordChangeForm.tsx`) must call `setAuth(res.access_token, res.user)`
  — the backend revokes old tokens on password change (commits 20c1771, 7b2f8cf).
- **Logging out on any error.** On startup `AuthValidator` (`App.tsx`) logs out **only** on
  `ApiError` with `status === 401`; network errors and 5xx keep the session (commit c8bd871,
  regression `e2e/regression/AUTH-004.spec.ts`). Apply the same rule elsewhere.
- Calling the API before `hasHydrated` is true — the token isn't loaded yet.
- Persisting `hasHydrated` or room state. `partialize` intentionally excludes `hasHydrated`;
  `roomStore` is not persisted.
- Adding a server-cache library or context providers for data already handled by the pattern above.

## Caps

`roomStore.addSubtitle` keeps the latest `MAX_SUBTITLES` (module-level constant) confirmed
subtitles; follow the same named-constant pattern for any new buffer limit.
