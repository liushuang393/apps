<!-- sr-local -->

# SR Project Binding

This file is owned by THIS repository. The SR installer never overwrites it.

Anything declared here overrides `.agents/core/`. Delete a section you do not need — an
absent section means "core default applies", it does not mean "forbidden".

See `project.example.md` for a filled-in example.

If this repository already keeps a canonical rule corpus of its own, do not restate it
here. Name it once — for example `.agents/local/rules/` — and point the sections below at
it. `.agents/local/` is the one place the installer never writes, never deletes as stale,
and preserves on `--uninstall`, so a repository-owned rule corpus is safe there. A
second copy of a rule is a second thing to drift.

Canonical rules already in this repository (cite, do not copy): `CLAUDE.md`, `AGENTS.md`,
`DEVELOPMENT_RULES.md`, `.cursor/rules/docker-windows-startup.mdc`.

## 1. Artifact destinations

Map each logical destination to a real path in this repository. `.agents/core/` and
`.agents/core/common/artifact-map.md` only ever refer to the left column.

| Logical destination   | Real path in this repository |
| --------------------- | ---------------------------- |
| `spec` | `.trellis/tasks/<task>/prd.md` |
| `tickets` | `.trellis/tasks/<task>/implement.md` |
| `design` | `docs/designs/<YYYY-MM-DD>-<slug>/` |
| `module_design`       |                              |
| `evidence` | `docs/designs/<YYYY-MM-DD>-<slug>/evidence/` |
| `adr`                 |                              |
| `business_spec`       |                              |
| `runbook`             |                              |
| `glossary`            |                              |
| `lessons` | `.trellis/spec/lessons/` |
| `scratch` | `.scratch/` |
| `receipt`             |                              |
| `design_template_set` | `.agents/core/templates/jp-si/` |

Unmapped destination: ask before writing. Never invent a new top-level directory.
`receipt` may be left blank — it defaults to `.agents/state/receipts/`.

`module_design` is where a module's standing design lives, expressed relative to the
module — for example `<module>/docs/`. Leave it blank if this repository keeps no standing
module designs; closeout will record that as a follow-up instead of inventing a location.

`design_template_set` is not a destination. It names the directory holding the design
document skeletons, such as `.agents/core/templates/jp-si/`. Blank means no imposed shape: the
required content in `.agents/core/common/design-artifacts.md` still applies.

Existing design notes live as loose files under `docs/`. New task design goes under
`docs/designs/<date>-<slug>/` so the trail stays searchable. Do not create a new
top-level directory for artifacts.

## 2. Output language

Language for design documents, reports, and commit messages: Japanese

Language for code comments: Japanese

## 3. Verification commands

Defined in `.agents/local/checks/`. Present here: `format`, `lint`, `types`, `unit`, `build`.
No `integration`, `security`, or `e2e` file — those checks are not a single declared
command in this repository (Playwright is listed at repo root but has no config).
Human-facing wrapper: `./scripts/check.sh` (lint/format/frontend types; does not run pytest).

## 4. Gate policy

`gates:` one of `all` | `risk-based` | `minimal`. Default `all`.

- `all` — every phase ends at a human `APPROVE` gate.
- `risk-based` — hard gate only when the phase touches production, destructive or
  irreversible actions, external systems, publicly observable behavior, or security.
  Other phases continue automatically but still write their phase artifact.
- `minimal` — hard gate at the first phase and the final phase only.

gates: all
## 5. Prohibited actions

Actions the SR workflows must never take in this repository, and what to do instead.
If a canonical rule document already lists them, cite it here instead of copying it.

- Never edit `.env` or `.env.example` without explicit per-change confirmation. Propose
  the diff and wait. Secrets stay in `.env` only (`AGENTS.md`).
- Never dump or commit secret values (API keys, JWT, LiveKit secrets).
- Never push, open a PR, merge, or call a hosted-Git API unless the human asked. Stop at
  the local working tree and report what is ready.
- Never `git push --force`, `git reset --hard`, or skip hooks (`--no-verify`).
- Never explore Docker/compose/Dockerfiles from scratch; follow
  `.cursor/rules/docker-windows-startup.mdc`. After WSL `docker info` fails, switch to
  PowerShell — do not tell the user to restart Docker Desktop as the first step.
- Never rewrite `AI_PROVIDER` in env to switch AI mode; use `/admin/ai-pipeline`.
- Never invent a check command. Missing `.agents/local/checks/<kind>.md` means that
  check does not exist here.

## 6. Available Trellis capabilities

What this repository's Trellis installation actually provides (commands, sub-agents,
spec locations, memory search, multi-agent channel). Leave blank if unknown.

- Platforms for SR adapters: Cursor (`.cursor/`) and Codex (`.agents/skills/`).
  Claude Code SR adapters are not installed here (claude と cursor は同時に入れない)。
  Trellis の `.claude/` ファイルが残っていても、SR の `sr-*` は `.cursor` と Codex のみ。
- Task lifecycle: `python3 ./.trellis/scripts/task.py create|start|list|current|finish|archive`
- Spec store: `.trellis/spec/` (frontend + guides from init)
- Step detail: `python3 ./.trellis/scripts/get_context.py --mode phase --step <X.Y>`
- Sub-agents: `trellis-implement`, `trellis-check`, `trellis-research`
- Multi-agent: `trellis channel`
- Memory search (`trellis mem`): not verified on this install — treat as unknown until used.

## 7. Language / framework notes

Facts a workflow needs before touching code here. If a canonical rule document already
states them (typing policy, layer direction, entry points), cite the section instead of
restating it.

TypeScript / Python policy, file-size limits, and forbidden debug leftovers: `CLAUDE.md`
and `AGENTS.md`. Docker startup: `.cursor/rules/docker-windows-startup.mdc`.

Per-language method overrides live in `.agents/local/methods/`. List which ones exist:

- `.agents/local/methods/python.md`
- `.agents/local/methods/typescript.md`

## 8. Zones

Regions of this repository with their own rules or their own owner. Leave the table empty
if one standard applies everywhere — that is a valid configuration, not a gap.

| Zone id | Path globs | Rule set | Ownership source |
| ------- | ---------- | -------- | ---------------- |
|         |            |          |                  |

One project-level standard applies. Backend and frontend use different tools, but the
same contract; checks already encode the split.

Rule detail per zone lives in `.agents/local/zones/<zone id>.md`.
Two zones matching the same path at the same specificity is a configuration error;
`install.py --doctor` reports it.

## 9. Ownership sources

Where this repository already records who owns what. SR reads these; it keeps no roster.

| Source | Path or command |
| ------ | --------------- |
|        |                 |

No CODEOWNERS or OWNERS files. An asset with no resolvable owner is reported as unowned,
never assigned to a guess.

## 10. Risk and estimate calibration

Risk levels are defined in `.agents/core/common/contract.md`. Record here only what differs
in this repository — a path that is always R3, a change type this repository treats as
higher risk than the default.

- Touching `.env`, credentials, LiveKit keys, JWT, or production-facing compose ports is
  always R3.
- Alembic migrations and `backend/alembic/` are R3 (schema / data).
- Changes under `backend/app/ai_pipeline/` and `backend/app/websocket/` are at least R2
  (real-time media path, external AI, publicly observable meeting behavior).
- Historical actuals: none kept. Estimates stay relative — complexity, range, assumptions,
  unknowns. Do not produce person-day figures.

## 11. Project brief

What this repository is, in the fewest lines that let someone act. Filled once at
configuration time and updated when it stops being true — **an existing answer is
revised, never replaced wholesale.** A section already answered by a human is theirs;
only a blank one gets filled in from scratch.

Keep every answer short. This section is read at the start of most work, so length here
is a tax on everything. If a real README already says it well, point at the file instead
of copying it — a second copy is a second thing to keep true.

Detail: `README.md`, `CLAUDE.md`.

### 11.1 What it is

LAMS（Language-Aware Meeting System）。社内多言語会議向けのリアルタイム音声翻訳・字幕。
参加者は原声か翻訳音声を選べ、聴いている音声と同じ言語の字幕だけが出る。言語: ja / en / zh / vi。

### 11.2 What it does

| Capability | One line |
| ---------- | -------- |
| 音声選択 | 原声 / 翻訳音声を各自切替（既定は原声） |
| 字幕同期 | 聴いている音声と同一言語の字幕のみ |
| 変換パイプライン | ASR → 翻訳 → TTS。遅延目標 ≤1200ms（超過時は字幕のみ） |
| AI 経路 | 管理者 UI `/admin/ai-pipeline` で切替。env はブートストラップ既定 |
| 会議記録 | 発言の記録と言語別エクスポート |
| 権限 | JWT + RBAC（admin / moderator / user） |
| LAN | `HOST_IP` で同一 LAN の端末から参加 |

### 11.3 How it is built

- `backend/` — Python 3.10+ / FastAPI / SQLAlchemy 2 / Alembic。入口 `app.main:app`、ポート 8090。
- `frontend/` — React 18 + Vite + Zustand。ポート 5273。ブラウザは frontend のみ。`/api` を backend へプロキシ。
- Compose: postgres / redis / livekit / coturn / backend / frontend。
- 依存の向き: ブラウザ → frontend → backend → (livekit / postgres / redis / 外部 AI)。
  frontend から backend 以外を直接叩かない。設定の正本は `backend/app/config.py`。

### 11.4 Running it locally

ローカル uvicorn/vite と Docker Compose は混在させない。既定は Compose。
前提: Docker Desktop（Compose v2）。WSL bash から `docker info` が失敗したら PowerShell に切替。
秘密はユーザーが `.env` を管理。エージェントは `.env` を編集しない。

Windows PowerShell:

```text
docker compose up -d --build
docker compose exec backend alembic upgrade head
```

LAN 公開時のみ先に `$env:HOST_IP = "<LAN IPv4>"`。WSL/Linux のみ
`./scripts/start-docker.sh --build --host-ip <LAN_IP>`。

### 11.5 Running it integrated

Compose が postgres / redis / livekit / coturn / backend / frontend をまとめて立てる。
ローカル単体起動と分岐しない。LAN 複数端末は README のファイアウォールと
insecure-origin 手順。実運用は HTTPS。

```text
docker compose ps
curl -f http://localhost:8090/health
```

### 11.6 Checking it works

```text
curl -f http://localhost:8090/health
curl -f http://localhost:5273
```

両方 200 なら起動成功。ブラウザは http://localhost:5273 のみ。
2026-09-06 時点: この環境から両 URL は到達できず、smoke は未実行。動くとは書かない。

## 12. Project readiness profile

Read by `.agents/core/common/readiness.md`. One value per line; a blank line is an honest
answer, a guessed one is not.

`project_kind` is one of `greenfield` (nothing runs yet and that is normal), `brownfield`
(existing failures are normal and are recorded, not fixed first), `modernization` (one
implementation is replacing another and the old one is the oracle, as far as it is the
contract).

```text
project_kind: brownfield
```

Where the truth lives when documents and code disagree. `as_is` is what decides how the
system behaves today (runtime, then code, then tests); `to_be` is what decides how it
should (approved acceptance criteria, then spec, then ADR). A conflict between them is
recorded and handed to `conflict_owner`, never resolved by picking the more convenient one.

```text
as_is: running process, then code, then tests
to_be: approved acceptance criteria, then task spec (.trellis/tasks/<task>/prd.md), then docs/designs/
conflict_owner: human (repository owner)
```

## 13. Phase companions

The skills, sub-agents and tools this repository wants **considered** at each phase — a
reminder the workflow reads at the phase start and reports at the gate, not a gate of its
own. Name what exists in this host; the workflow says `used` or `not needed: <why>` for
each, and never fails because one is absent (`.agents/core/common/method-router.md`).
Leave the table empty to run on core defaults.

| Phase | Companions | For |
| ----- | ---------- | --- |
| PLAN | trellis-research | 仕様・影響の調査 |
| BUILD | trellis-implement | 実装 |
| VERIFY | trellis-check | 検証 |
| DIAGNOSE | trellis-research | 再現と原因の調査 |
| INVESTIGATE | trellis-research | 影響範囲の確定 |
| closeout | trellis-check | 仕上げ前の確認 |

Phase names as the workflows use them: `clarify` (the router found an unknown about the
request itself), `PLAN`, `BUILD`, `VERIFY`, `DIAGNOSE`, `REPAIR`, `CHARACTERIZE`,
`TRANSFORM`, `JOURNEY DESIGN`, `IMPLEMENT`, `FRAME INTENT`, `INVESTIGATE`, `closeout`
(every workflow's last step), `any` (every phase).
