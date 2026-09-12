# Aレーン 失敗分類と反復結果（2026-09-06）

## 初期状態 → 最終

| 反復 | 結果 | 主因 |
|------|------|------|
| 1 | 7 failed | Playwright browser revision / ffmpeg 欠落 |
| 2 | 5 failed | 並列 register email 衝突、ROOM ヘッダ名が LiveKit 依存 |
| 3 | 8 passed / 1 skipped | 修正後グリーン |
| 4（flaky 確認） | 8 passed / 1 skipped | flaky 0 |

## 分類

| ID | 分類 | 対応 | 状態 |
|----|------|------|------|
| ENV-BROWSER | 環境依存 | `.scratch/ms-playwright` に chromium-1200 alias + ffmpeg-1011 | 解消 |
| TEST-AUTH-RACE | テスト基盤 | email を worker+乱数一意化、400/500 UNIQUE は login フォールバック | 解消 |
| PROD-REGISTER-500 | 機能欠陥 | `IntegrityError` → 400 正規化（`auth/routes.py`） | 解消 |
| PROD-ROOM-NAME | UX/観測 | `roomMeta?.name` をヘッダ表示（LiveKit 未接続でも名前表示） | 解消 |
| TEST-CREATE-STATUS | 契約 | create room は 201 を許容 | 解消 |
| SKIP-ADMIN | 任意 | `E2E_ADMIN_*` 未設定時 admin GET スキップ | 想定通り |

## 未解決（管理不能）

なし（A レーン scope）。

## 再発防止

- `e2e/helpers/auth.ts` の uniqueSuffix
- ローカルブラウザパス（runbook に記載）
- ROOM-001 が connection-status / leave-btn / ヘッダ名を断言
