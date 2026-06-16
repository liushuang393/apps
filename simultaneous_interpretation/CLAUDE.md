# CLAUDE.md

Behavioral guidelines to reduce common LLM coding mistakes. Merge with project-specific instructions as needed.
**日本語で答えて**
**Tradeoff:** These guidelines bias toward caution over speed. For trivial tasks, use judgment.

## 1. Think Before Coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:
- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them - don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## 2. Simplicity First

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

## 3. Surgical Changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:
- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it - don't delete it.

When your changes create orphans:
- Remove imports/variables/functions that YOUR changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: Every changed line should trace directly to the user's request.

## 4. Goal-Driven Execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:
- "Add validation" → "Write tests for invalid inputs, then make them pass"
- "Fix the bug" → "Write a test that reproduces it, then make it pass"
- "Refactor X" → "Ensure tests pass before and after"

For multi-step tasks, state a brief plan:
```
1. [Step] → verify: [check]
2. [Step] → verify: [check]
3. [Step] → verify: [check]
```

Strong success criteria let you loop independently. Weak criteria ("make it work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer rewrites due to overcomplication, and clarifying questions come before implementation rather than after mistakes.

---

# Project: VoiceTranslate Pro / 同時通訳

Real-time voice translation for online meetings (Teams, Zoom, Google Meet) and system audio, built on the OpenAI Realtime API (voice↔voice) plus the Chat Completions API (higher-precision text translation). This project lives in `simultaneous_interpretation/` but the git root is the parent `apps/` directory.

## Two parallel, fully independent codebases

The single most important thing to understand before editing. There are **two implementations of the same app that share no code** — synced only by manual porting.

1. **HTML + plain JavaScript** (browser / Chrome extension / Electron renderer)
   - Entry UI: `teams-realtime-translator.html`
   - Logic: the root-level `voicetranslate-*.js` files — `voicetranslate-pro.js` (main), plus `-utils.js`, `-audio-queue.js`, `-path-processors.js`, `-websocket-mixin.js`, `-ui-mixin.js`, `-state-manager.js`, `-audio-capture-strategy.js`.
   - **These root `.js` files are hand-written source, NOT compiled output from `src/`.** Edit them directly; there is no build step. Reload the browser (Ctrl+F5) to see changes. They load in dependency order via `<script>` tags (see the header comment in `voicetranslate-pro.js`).

2. **TypeScript** (`src/` + `electron/`) → compiled to `dist/` for the Electron desktop app. Strongly typed, modular, unit-tested. New features and refactors belong here.

`src/core/*.ts` does **not** import the root `voicetranslate-*.js`, and vice versa. A bug fix affecting both must be ported by hand. A third TypeScript codebase, `browser-extension/src/`, builds the packaged Chrome extension separately. When asked to change behavior, first determine **which runtime** is in play — the file you edit differs completely.

## Commands

```bash
npm install

# Build (TypeScript only — the HTML/JS codebase needs no build)
npm run build:core        # src/**  → dist/**       (tsc)
npm run build:electron    # electron/** → dist/electron/**
npm run build:extension   # browser-extension/src/** → browser-extension/dist/**
npm run build:all         # all three

# Run
npm run dev               # watch-build + launch Electron (NODE_ENV=development)
npm run electron:dev      # build:electron then launch Electron
# HTML/JS version: just open teams-realtime-translator.html in a browser

# Quality gate (must all pass — 0 errors)
npm run quality           # type-check + lint + format:check + check:extension
npm run type-check        # tsc --noEmit (strict mode)
npm run lint              # eslint src/**/*.ts   (lint:all also covers electron/**)
npm run format            # prettier --write

# Tests (Jest + ts-jest, jsdom env)
npm test
npm run test:coverage     # coverage threshold: 50% global (jest.config.js)
npx jest tests/core/VAD.test.ts          # single test file
npx jest -t "should detect speech"       # single test by name

# Chrome extension
npm run check:extension   # validate extension (check-chrome-extension.js)
npm run pack:extension    # build distributable zip (build-extension.js)

# Desktop installers (electron-builder)
npm run dist:win | dist:mac | dist:linux
```

Tests live in `tests/` (mirroring `src/` layout), not co-located with source.

## Architecture (TypeScript codebase)

Three-layer design, wired top-down from `src/config/AppConfig.ts` → `src/core/Config.ts` → `src/core/VoiceTranslateCore.ts`:

- **Electron main** (`electron/`): system audio capture via `desktopCapturer` (`audioCapture.ts`), Realtime WebSocket with `Authorization` header auth (`realtimeWebSocket.ts`), env-var/config loading, SQLite conversation history (`ConversationDatabase.ts`). Talks to the renderer over IPC.
- **Renderer**: UI, Web Audio processing, and VAD. The audio path is a chain-of-responsibility pipeline (`src/audio/AudioPipeline.ts`): `AudioInput → VADProcessor → ResamplerProcessor (→24kHz) → EncoderProcessor (PCM16/Base64) → WebSocket`.
- **OpenAI Realtime API**: speech recognition + voice translation + TTS over WSS.

Core modules: `VoiceTranslateCore` (orchestrator) → `AudioManager`, `WebSocketManager`, `UIManager`, `ResponseQueue`. The `WebSocketAdapter` interface (`src/adapters/`) abstracts Electron vs. browser auth differences (header vs. `sec-websocket-protocol`).

### Two concurrent processing pipelines per utterance
Each input audio segment gets a unique `transcriptId` linking its outputs:
1. **Realtime API** (WebSocket): (1-1) input transcription → left column; (1-2) voice→voice translation → played as audio only.
2. **Chat API** (`gpt-4o`/`gpt-5`): higher-precision text translation → right column.

### Response concurrency (P0 — `conversation_already_has_active_response`)
The Realtime API rejects a new response while one is active. `src/core/ResponseStateManager.ts` enforces a state machine (`IDLE → PENDING → PROCESSING → DONE → IDLE`, with `ERROR → IDLE` forced reset) and `ImprovedResponseQueue.ts` serializes responses with a 50–200ms network-latency guard window. Don't bypass this when touching response handling. (HTML/JS equivalent: `voicetranslate-state-manager.js`.)

### VAD buffering (P1)
Min utterance length ~1s, silence-confirm delay ~500ms, two-stage (client VAD + server VAD) to cut spurious short-audio sends. See `VAD_OPTIMIZATION.md`, `src/audio/AdaptiveVADBuffer.ts`, `src/config/VADPresets.ts`.

## Subscription backend

`api/*.js` are **Vercel serverless functions** (Stripe checkout, subscription check, Stripe webhook) — deployed via `vercel.json`, not part of the app build. `config.js` holds client-side Supabase/Stripe public config for the extension; `.env` (see `.env.example`) holds OpenAI keys and model names used by the Electron/TypeScript side. Extension monetization flow: `subscription.html` → Stripe Checkout → Supabase auth (Google OAuth) → `success.html`.

## Conventions (from `.cursor/rules/`)

- **Comments and docs are written in Japanese**, with JSDoc-style headers (`@param`, `@returns`, `@throws`, `@example`) on functions/classes. Match this.
- `tsconfig.json` is **fully strict** (`noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`, `noPropertyAccessFromIndexSignature`, etc.). No `any`, no `@ts-ignore`.
- Null checks: use `value != null` / explicit `!== null && !== undefined`, not truthiness (`if (value)`).
- No `console.log`, no hardcoded keys/URLs (use `CONFIG`), no magic numbers (name constants like `VAD_ENERGY_THRESHOLD`).
- Prefer `async/await` over `.then()` chains; avoid the `new Promise(async ...)` antipattern.
- Always release resources in `dispose()` (close `AudioContext`, stop `MediaStream` tracks, remove listeners).
- Commit messages: Conventional Commits (`feat(scope): ...`, `fix`, `docs`, `refactor`, `test`, `chore`).
- Source files: UTF-8 **without** BOM.
