# Sonowa E2E 運用ランブック

理想: **手順どおり一歩一通る**（差分埋めは契約と Sonowa 固有だけ）。  
詳細設計: [e2e-architecture-design.md](./e2e-architecture-design.md)

## 0. 前提

| 項目 | 値 |
|------|-----|
| Frontend | http://127.0.0.1:5273 |
| API | http://127.0.0.1:8090 |
| LiveKit | ws://127.0.0.1:7880 |
| testing-kit | v0.3.0 installed（`.venv-testing-kit` または PATH） |
| 認証 | 実 JWT（bypass 禁止） |

Windows（推奨）で Docker を使う場合は PowerShell:

```powershell
$env:HOST_IP = "<LAN IPv4>"  # LAN 公開時のみ
docker compose up -d --build
docker compose exec backend alembic upgrade head
```

WSL から `docker info` が失敗したら、探索せず PowerShell に切り替える（プロジェクト既知ルール）。

## 1. 初回セットアップ

```bash
cd /mnt/d/apps/language-aware-conferencing-system/sonowa

# kit CLI（例: プロジェクト venv）
python3 -m venv .venv-testing-kit
.venv-testing-kit/bin/pip install dist が無い場合は \
  /home/liush/projects/serverlessAIAgents/testing-kit/dist/testing_kit_py-0.3.0-py3-none-any.whl
# 依存: playwright 等は venv に導入済み想定

export PATH="$PWD/.venv-testing-kit/bin:$PATH"
testing-kit doctor --project-root "$PWD" || true
```

E2E ツリーは既に `e2e/` に展開済み（再 init は `--force` 注意）。

## 2. 差分埋めチェックリスト（プロジェクト固有）

- [ ] `e2e/app.toml` の auth／deployment／ports
- [ ] `e2e/helpers/auth.ts` が JWT + `sonowa-auth` であること
- [ ] 主要 `data-testid` が揃っていること
- [ ] A レーン用 AI 境界（暫定 mock または stub URL）
- [ ] admin が必要なら `E2E_ADMIN_EMAIL`／`E2E_ADMIN_PASSWORD`

## 3. スタック起動確認

```bash
curl -fsS http://127.0.0.1:8090/health
curl -fsS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:5273/
```

Docker が使えない場合（WSL から Desktop sock 権限無し等）:

```bash
bash scripts/start-e2e-local-stack.sh
# SQLite + Redis:6380 + Mock AI + Vite
```

Playwright ブラウザがグローバルキャッシュで使えない場合:

```bash
export PLAYWRIGHT_BROWSERS_PATH="$PWD/.scratch/ms-playwright"
# chromium_headless_shell-1200 / ffmpeg-1011 を配置済みであること
```

A レーン最小は API health。Room／PREF は LiveKit 無しでもシェル UI を断言（接続失敗は soft-skip）。

## 4. A レーン（決定論）

```bash
# 暫定: process mock（最終形は HTTP stub）
export SONOWA_E2E_MOCK_AI=1
export E2E_DEPLOYMENT_MODE=existing-server
export E2E_ALLOW_NO_DB=1

./scripts/e2e_run_a_lane.sh
```

成果物:

- `e2e/playwright-report/`
- `docs/testing/report/e2e-a-lane-*.md`

失敗時:

1. 機能欠陥／契約／flaky／環境に分類
2. Red（再現）→ Green（最小修正）→ 関連回帰 → 全体
3. flaky は複数回で確認（再試行成功だけで閉じない）

## 5. B レーン（実 AI・手動）

```bash
export E2E_ALLOW_REAL_AI=1
# Docker 無しで admin smoke のみ回す場合:
export SONOWA_E2E_SQLITE_PATH="$PWD/.scratch/sonowa_e2e.sqlite3"
# キーは .env 管理。値をログ／レポートに出さない
./scripts/e2e_run_b_lane.sh
```

対象:

1. LiveKit 2 クライアント（ja→en）— Docker + LiveKit:7880 必須。無ければ `BLOCKED`
2. `scripts/smoke_ai_pipeline_settings.py` — SQLite 昇格可

停止条件: quota／認証拒否／外部障害はコード不具合と分離して記録。

## 6. 静的・単体（毎回推奨）

```bash
./scripts/check.sh
cd backend && .venv/bin/pytest tests/test_mock_provider.py -q
# 広範囲: pytest -q --ignore=tests/integration
```

## 7. certify（installed-kit）

```bash
testing-kit certify-project \
  --project-root "$PWD" \
  --app-root . \
  --e2e-dir e2e \
  --strict
```

`--copy-isolated` は vendored kit 配置が必要なため installed-kit では使わない。

## 8. トラブルシュート早見

| 症状 | 確認 |
|------|------|
| health タイムアウト | compose／uvicorn 起動、8090 |
| AUTH-001 register 失敗 | API 到達、DB、email 衝突（RUN_ID） |
| ROOM-001 testid 無し | L1 testid 契約 |
| Docker Permission denied | WSL sock 書込、PowerShell `docker info` |
| admin ケース skip | `E2E_ADMIN_*` 未設定は仕様 |
| B が課金しすぎ | `E2E_ALLOW_REAL_AI` と回数上限 |

## 9. 秘密情報

- `.env` はユーザー管理。エージェントは確認なしに編集しない
- レポートに token／password／API キーを書かない
- Playwright trace に機密 body を残さない運用とする
