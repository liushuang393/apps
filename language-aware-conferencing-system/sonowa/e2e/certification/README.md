# 専用Dockerの正式認証（未合格）

`app.toml` と `app-owned-runtime.json` は共有DBを使わない認証用プロファイル。
前提は既存の固定モデルキャッシュ、GPU、Dockerイメージ、復旧済みTesting Kit。
通常backendと同時にモデルをロードすると12GB VRAMを超えるため、検証中だけ通常backendを停止する。
`.env` を変更せず、既存DB・モデルボリュームを削除しない。

```bash
.venv-testing-kit/bin/testing-kit ai-guide --format text
python3 e2e/scripts/apply_kit_startup_patch.py
.venv-testing-kit/bin/python e2e/tests/test_kit_startup_deadline.py
npm ci --prefix e2e
python3 e2e/scripts/owned_runtime.py prepare
export E2E_DB_URL="$(python3 -c 'import json; s=json.load(open("e2e/.runtime/owned-postgres.json")); print("jdbc:postgresql://127.0.0.1:%s/sonowa_cert_e2e" % s["port"])')"
docker stop sonowa-backend-1
.venv-testing-kit/bin/testing-kit certify-project \
  --project-root . --e2e-dir e2e/certification --strict \
  --evidence output/local-pipeline/testing-kit-contract/next-run
```

成功・失敗にかかわらず専用サービスを停止し、専用DBを復元して後片付けする。
所有権検査が失敗したら共有資源へ操作を広げず、専用状態ファイルと実体を照合する。

```bash
python3 e2e/scripts/owned_runtime.py stop
python3 e2e/scripts/owned_postgres.py restore
python3 e2e/scripts/owned_runtime.py destroy
docker start sonowa-backend-1
```

最新実行は、[起動待ちの互換修正](../../.testing-kit/patches/README.md)を適用したKitで7/18段階を通過。
宣言済み180秒の範囲でモデル準備・正規ログイン・画面探索が成功した。
未修正の配布物による認証とは区別する。
現在は `/room/:roomId` と `/room/:roomId/transcript` の実データに結び付いた観測が不足し、
source/runtime照合で停止している。14静的画面×4権限の56観測は完了したが、
操作数上限による未探索18件も残る。実体がないIDの画面やエラー表示を正常系の代替にしない。
このプロファイルの4シナリオは認証・設定参照・会議室作成の一部のみ。
36 API・16画面・3ロールとローカル音声の未検証範囲は業務パターン台帳でblockedにしている。
最終認証には全業務証拠、restore後の繰り返し、コピー隔離も必要。

認証状態は `e2e/certification/.auth/` に正規ログインで生成し、Git管理から除外する。
ソース抽出は専用プロファイル内の `docs/business-flows/_extracted.yaml` に出力する。
親ディレクトリの認証状態や、3つの開始画面だけへのソース母数の縮退を許さない。

E2Eだけの型検査:

```bash
frontend/node_modules/.bin/tsc --noEmit --strict --target ES2022 \
  --module commonjs --moduleResolution node --esModuleInterop --skipLibCheck \
  --typeRoots e2e/node_modules/@types \
  e2e/playwright.certification.config.ts e2e/certification/*.spec.ts
```

`@types/node` はE2E内に配置する。ルートへ置くとブラウザコードのタイマー型へ影響する。
Playwrightの古い実行結果は、新しい証拠ステップ名・レポーターの実行証拠を代替しない。
