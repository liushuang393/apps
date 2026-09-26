# Component Guidelines

> How components and pages are built in this project.

---

## Overview

Function components only, named exports, Props declared with `interface`. Every file starts
with a Japanese JSDoc header describing its purpose. UI strings go through `react-i18next`
(`t('...')`). Styling is plain `className` + CSS files; inline `style` is only for dynamic
values (e.g. volume bar width).

---

## Component Structure

File header comment -> imports -> Props interface -> private helpers/sub-components -> exported component.

```tsx
// components/MeetingModePanel.tsx
/**
 * 会議AI主線（a/b/hybrid）切替パネル
 * 部屋作成者またはモデレーターのみ表示。受聴の原音/翻訳切替とは別概念。
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError, meetingsApi } from '../api/client';
import type { MeetingMode, MeetingSessionInfo, User } from '../types';

interface MeetingModePanelProps {
  roomId: string;
  creatorId: string;
  user: User | null;
  roomDefaultMode?: MeetingMode;
}

export function MeetingModePanel({ roomId, creatorId, user, roomDefaultMode = 'hybrid' }: MeetingModePanelProps) {
```

Memoized components (rendered inside the busy `RoomPage`) use an `XxxInner` function plus
`export const Xxx = memo(XxxInner);` — see `components/AudioControlPanel.tsx`,
`ParticipantList.tsx`, `PreferencePanel.tsx`, `SubtitleDisplay.tsx`.

Pages (`pages/*.tsx`) are `export function XxxPage()` with no props; they read route params
via `useParams`, the store via selectors, and call `xxxApi` directly (see `pages/LoginPage.tsx`).

---

## Props Conventions

- `interface XxxProps` directly above the component, destructured in the signature.
- Defaults via destructuring defaults (`roomDefaultMode = 'hybrid'`), not `defaultProps`.
- Newer components mark props `readonly` and document each with `/** ... */`
  (`components/AudioControlPanel.tsx`). Follow that for new components.
- Callbacks are named `onXxx` (`onMicToggle`); nullable data is `T | null`, not `undefined`.
- Small inline wrappers in `App.tsx` use `{ children }: { children: React.ReactNode }` — acceptable
  only for tiny route guards.

---

## Composition / Data Flow

- Pages own data fetching (`useEffect` + `useCallback` loader + local `loading/error` state,
  see `pages/RoomListPage.tsx` `loadRooms`). Presentational components receive props.
- Components that need live room data read `useRoomStore` directly (`SubtitleDisplay`,
  `ParticipantList`) instead of prop-drilling from `RoomPage`.
- Route guarding is done only in `App.tsx` (`AuthValidator`, `PrivateRoute`, `AdminRoute`);
  pages don't re-check auth.

---

## Styling & Accessibility

- Use CSS variables from `styles/_tokens.css` (`var(--text-primary)`, `var(--radius-md)`).
- Add `data-testid` on elements E2E needs; pages list them in a comment, e.g.
  `{/* E2E: login-form / login-email / login-password / login-submit / login-error */}`
  (`pages/LoginPage.tsx`). Don't rename existing test ids — `e2e/` specs depend on them.
- Pair `<label htmlFor>` with input `id`; use `aria-expanded` on collapsible toggles
  (`PreferencePanel.tsx`, `ParticipantList.tsx`) and `aria-label` on sections.

---

## Common Mistakes / Forbidden

- **White or near-white text on a light background.** Commit 33910cd fixed unreadable
  `rgba(255,255,255,0.5)` text on light auth cards (`styles/pages/auth.css`). On light surfaces
  use `--text-primary` / `--text-secondary` or slate darks (`#334155`, `#475569`). Verify
  with a screenshot after any color change.
- Hardcoding Japanese UI strings in new code. Use `t()` and add the key to all four
  `i18n/locales/*.json`.
- Default exports, class components, `React.FC`.
- Importing `useTranslation` from `../hooks/useTranslation` when you meant `react-i18next`.

## Known Debt

All pages and components use `t()` for UI text. Still Japanese in any UI language:
- connection error messages set inside `hooks/useLiveKit.ts` (`setConnectionError('...')`) — hooks
  are not i18n'd yet; return a key/code from the hook if you touch them.
- `LANGUAGE_NAMES` (`constants/languages.ts`) and dates formatted with `toLocaleString('ja-JP')`.

The ja locale text must stay byte-identical when migrating: Playwright E2E runs with
`locale: ja-JP` and may match Japanese text.
