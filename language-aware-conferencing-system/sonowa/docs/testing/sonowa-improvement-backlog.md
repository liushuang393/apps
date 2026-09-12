# Sonowa 本体 改善バックログ（テスト／観測／境界）

対象: `sonowa`  
目的: testing-kit 共通手順に乗せられる観測契約・データ境界・品質ゲートを揃える。  
作成日: 2026-09-06

## 優先度凡例

- P0: A レーン安定／手順自動化の前提
- P1: B レーン・方針整合
- P2: CI／運用体験

---

## P0

### L1. data-testid 契約の完成

**状態**: **完了**（2026-09-06）。Login／Menu／RoomList／Room／Preference／Subtitle／AiPipeline に配置。ROOM-001／PREF-001 が testid で通過。

**必須 ID（契約）**:

| testid | 画面 |
|--------|------|
| `login-form` / `login-email` / `login-password` / `login-submit` / `login-error` | Login |
| `menu-page` / `menu-item-rooms` / `menu-logout` | Menu |
| `room-list-page` / `room-create-open` / `room-create-form` / `room-create-submit` / `room-card` | Rooms |
| `room-page` / `connection-status` / `leave-btn` | Room |
| `preference-panel` / `audio-mode-original` / `audio-mode-translated` / `target-language` | Preference |
| `subtitle-display` / `subtitle-item` | Subtitle |
| `ai-pipeline-page` / `ai-pipeline-save` | Admin AI |

**受入**: ROOM-001／PREF-001／ADMIN UI が role／文言フォールバック無しで通る。

### L2. E2E データ境界

**現行**: `seed_mode=self` + email `e2e.user.<runId>.w<worker>.<rand>@...`（共有 DB wipe 禁止）。並列衝突は login フォールバック＋サーバ側 IntegrityError→400。

**推奨**:

- Postgres DB `sonowa_e2e`（URL に `e2e` を含め kit reset 可能）
- または明示 cleanup スクリプト（`e2e_*` ユーザー／ルーム削除）

**受入**: 再実行で unique 制約衝突しない。本番相当 DB を wipe しない。

### L3. A レーン入口の一本化

- [`scripts/e2e_run_a_lane.sh`](../../scripts/e2e_run_a_lane.sh) を正
- health 待ち → auth_setup → smoke+regression → `docs/testing/report/` summary
- `E2E_ALLOW_NO_DB=1` 既定（共有 DB）

### L4. 品質ゲート接続

| 段階 | コマンド |
|------|----------|
| 静的 | `./scripts/check.sh` |
| 単体 | `cd backend && pytest -q`（integration 除外可） |
| A | `./scripts/e2e_run_a_lane.sh` |

`check.sh` への pytest 同梱は別承認（現状は文書で順序を固定）。

---

## P1

### L5. AI 境界の最終形

**暫定**: `MockAIProvider`（`SONOWA_E2E_MOCK_AI=1`／`ai_provider=mock`）  
**最終**: OpenAI 互換 HTTP stub へ `base_url` 差し替え（kit K5 と連携）

注意: process mock は kit `14-MOCK-BOUNDARY` の release 正本と一致しない。移行完了後に管理画面からの本番選択を制限または警告。

### L6. B レーン正式化

**状態**: **部分完了**（2026-09-06）。

- [`scripts/e2e_run_b_lane.sh`](../../scripts/e2e_run_b_lane.sh): `E2E_ALLOW_REAL_AI=1` 必須 + preflight（Docker/LiveKit/API）
- LIVE-001: Docker/7880 不可時は `BLOCKED`（失敗にしない）
- ADMIN-AI: `scripts/smoke_ai_pipeline_settings.py`（`SONOWA_E2E_SQLITE_PATH` で Docker 無し admin 昇格可）→ GREEN
- 回数上限・固定短音声・秘密非記録

### L7. LiveKit E2E helper（固有）

- 2 browser context
- fake media／短い PCM
- data channel 字幕 assert
- `translation-{lang}-{speakerId}` track assert

kit は context 骨格のみ。中身は Sonowa 固有。

### L8. シナリオ正本の充足

業務フロー MD＋`test-matrix.csv` を P0 全 ID で埋め、占位 automated を禁止。

---

## P2

### L9. CI

- PR: check.sh + unit（integration 除外）
- Nightly／手動: A レーン（Docker 可用 runner）
- B: workflow_dispatch のみ

### L10. pytest 依存の宣言

`backend/pyproject.toml` optional-dependencies に pytest／pytest-asyncio／httpx／aiosqlite（ユーザー確認後）。

### L11. フロント単体の最小

- `decodeLiveEvent`／`applyPreferenceChange` の単体（architecture deepening seam）

---

## 完了判定（Sonowa）

- [ ] P0 testid 契約が揃い A レーンが安定緑
- [ ] データ境界が文書どおり運用されている
- [ ] B レーンがゲート付きで 2 フロー実行可能
- [ ] process mock から HTTP stub への移行計画が実行されている（または明示延期）
- [ ] 本バックログと [`e2e-architecture-design.md`](./e2e-architecture-design.md) が乖離していない
