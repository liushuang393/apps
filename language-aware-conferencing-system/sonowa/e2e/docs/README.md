# Sonowa MVP — E2E

> このディレクトリは `testing-kit` から `init-app.py` で展開された E2E 一式。
> 再展開: `python testing-kit/bin/init-app.py --app sonowa --target e2e --reapply`

## 構成

```
e2e/
  app.toml                  ← この app の E2E メタ情報
  playwright.config.ts
  helpers/                  ← 認証・seed・nav・assert helper
  fixtures/scenarios/       ← seed 用 JSON
  smoke/  regression/  visual/
  docs/
    README.md              ← 本ファイル
    business-flows/        ← <ID>-*.md（業務フロー仕様正本）
    data-flow.md
    test-matrix.csv
  scripts/                 ← この app に閉じた seed/reset/sync
```

## このアプリの業務領域

ID プレフィックス: AUTH, ROOM, LIVE, SUBTITLE, PREFERENCE, ADMIN, TRANSCRIPT, QOS

## existing-server / app-owned-runtime

- 既定デプロイは `E2E_DEPLOYMENT_MODE=existing-server`（`e2e/app.toml`）。
- 認証は JWT login のみ。auth bypass は禁止。`helpers/auth.ts` が `sonowa-auth` に zustand persist 形で注入する。
- `seed_mode=self` / `requires_db=false`。共有 DB の wipe は `scripts/safe_noop_data.py` が拒否する。
- `e2e/app-owned-runtime.json` の `data_identity` は共有 DB wipe 禁止のため
  `kind=file` + センチネル `e2e/.runtime/sonowa-shared-no-wipe.marker`（kit schema は file/jdbc/composite_file のみ）。
  実 DB の reset は `scripts/safe_noop_data.py` が拒否する。
- Docker が使える場合の起動は repo 既知手順（compose）。ソケット不可時は localhost:5273/8090 を手動起動して A レーンを使う。

```bash
# A レーン（Playwright smoke+regression）
./scripts/e2e_run_a_lane.sh

# B レーン（実 AI / LiveKit・オプトイン）
E2E_ALLOW_REAL_AI=1 ./scripts/e2e_run_b_lane.sh
```

## よく使うコマンド

```bash
cd e2e

# テスト実行（repo root から config 指定でも可）
npx playwright test --config e2e/playwright.config.ts --project=smoke
npx playwright test --config e2e/playwright.config.ts --project=regression
npx playwright test --project=visual

# matrix 同期
python scripts/sync_test_matrix.py

# 既存コードから業務フロー候補抽出（レガシー）
python scripts/extract.py --out docs/business-flows/_extracted.yaml

# DB リセット・seed
E2E_DB_URL=sqlite:////tmp/sonowa_e2e_test.db python scripts/reset_db.py
E2E_DB_URL=sqlite:////tmp/sonowa_e2e_test.db python scripts/seed_scenario.py --name basic
```

## 新シナリオ追加手順

1. `docs/business-flows/_template.md` をコピー → `<ID>-<slug>.md`
2. `docs/test-matrix.csv` に行追加（status=not-automated）
3. `testing-kit/prompts/generate-test.md` を AI に渡す（変数は本 app のものを使う）
4. 生成された `smoke/` または `regression/` の spec を確認
5. ローカル実行 → PR → CI

## 既存資産の参照

- 旅程地図: `../../../docs/apps_inventory.md`
- 認証モデル: `../../../apps/common_services/auth_service/models/authorization.py`
- app_config: `./app_config.json`
