# コードレビュー記録

## 実施範囲

2026-09-20 に、リポジトリ直下の各工程をセキュリティ、障害耐性、品質、テスト容易性の観点で確認した。

## 工程整理

- `ConverSight`: 提案資料のみで実行工程ではなく、保守対象外との依頼に基づき削除した。
- `AiToEarn`: Gitlink のみが登録されているが `.gitmodules` に取得先がなく、ソースが存在しないためレビュー不能。
- `sokuji`: `.gitignore` の除外対象で、管理対象ソースが存在しないためレビュー不能。
- その他の工程: 静的レビューと利用可能なテストを実施する。

## 初回レビュー結果

| 工程 | 主な確認事項 | 対応方針 |
| --- | --- | --- |
| ForgePay | Webhook・Entitlement API のテナント分離不足、GET 検証によるトークン消費、Redis 障害時の fail-open | 認可テストを追加し、所有権検証と fail-closed を実装 |
| TriPrize | 決済確認・コンビニ情報取得の所有権検証不足、本番でのモック認証、開発用固定パスワード | 所有権検証と本番起動ガードを追加 |
| language-aware-conferencing-system | パスワードリセットトークンの応答露出、公開会議の参加者検証不足、弱い JWT 既定値 | 回帰テストと安全な本番設定を追加 |
| simultaneous_interpretation | チェックアウトの商品・遷移先をクライアントが指定可能、無認証状態照会、CORS 設定矛盾 | サーバ側 allowlist とオリジン制約を追加 |
| aws-voc-cdk-python | Lambda テスト間の同名モジュール衝突、import 時のリージョン依存、過剰 IAM | まずテスト分離と遅延初期化を修正 |
| gcal_twilio_reminder | TwiML の未エスケープ、送信前の送信済み記録、`.env` 未読込 | 送信処理をテスト可能に分離して修正 |
| liteflow-rule-db-validation-platform-v1.1.0 | 実行 API・Actuator の無認証公開、弱い固定資格情報、ヘルス詳細露出 | PoC 互換性を維持しつつ安全な既定公開範囲へ変更 |

## 判断基準

- 実際のコードから再現できる問題を優先する。
- 認証・認可、金銭処理、秘密情報、外部送信の欠陥を最優先とする。
- 大規模な設計変更が必要な項目は、無理な局所修正を行わず残存リスクとして記録する。
- 変更には可能な限り回帰テストを追加し、既存品質ゲートを維持する。

## 検証結果

| 工程 | 実行結果 |
| --- | --- |
| ForgePay | 対象 Jest 66件成功。本番変更箇所の ESLint 成功。全体 TypeScript ビルドは変更外の既存型エラー2件で失敗 |
| TriPrize | 追加テスト成功、TypeScript ビルド成功。互換範囲の依存更新後、高・重大 npm 脆弱性は0件 |
| language-aware-conferencing-system | 追加テスト2件成功。変更3ファイルの Ruff lint・format 成功 |
| simultaneous_interpretation | チェックアウトテスト10件成功、本番変更ファイルの ESLint 成功。全体品質ゲートは変更外ファイルの既存 Prettier 違反1件で失敗 |
| aws-voc-cdk-python | ユニットテスト18件成功 |
| gcal_twilio_reminder | Python 構文検査と内部テスト成功 |
| liteflow-rule-db-validation-platform-v1.1.0 | preflight 18項目中16件成功。既存コーパスの `output/` 欠損1件で失敗、Docker 検査はツール不在でスキップ |
| AiToEarn | 取得先のない Gitlink のため検証不能 |
| sokuji | 管理対象ソースが存在しないため検証不能 |

## 実施した是正

- ForgePay の GET 検証を読み取り専用にし、ブラウザの再試行や先読みでトークンを消費しないようにした。
- TriPrize は本番で `USE_MOCK_AUTH=true` を拒否し、互換範囲内の依存更新で高・重大脆弱性を解消した。
- Sonowa は本番 JWT シークレットを起動時検証し、本番のパスワードリセット応答からトークンを除外した。
- 同時通訳の決済商品とリダイレクト先をサーバ設定だけから決定するようにした。
- AWS VOC の同名 Lambda ハンドラーをテストごとに分離し、一括実行時の衝突を解消した。
- Google Calendar リマインダーは TwiML を XML エスケープし、送信成功後だけ送信済みを記録するようにした。
- Liteflow のヘルス詳細を認証時だけに制限し、Compose 公開ポートを loopback に限定した。
- Git 管理されていた Python キャッシュを削除し、再混入を防止した。

## 追加是正（第2次）

初回レビューで残存としていた項目のうち、再現できたものを是正した。

### ForgePay

- 管理 API の Webhook 参照・再試行で、ペイロードに記録された開発者IDを検証し他テナントのイベントを遮断した。
- `GET /admin/entitlements?status=` を開発者配下の顧客経由で取得するよう変更し、テナント横断の参照を排除した。
- エンタイトルメント参照系に所有権検証を追加し、他テナントの資源を 404 とした。
- ビルドを失敗させていた型エラー2件を解消した。QuickPay のアドホック決済が呼ぶ `createAdHocCheckoutSession` を `StripeClient` に実装し、`payment_intent.succeeded` 処理で Stripe 顧客IDが未特定の場合に顧客を確定させるようにした。

### TriPrize

- 決済確認・カード決済確認・コンビニ情報取得に PaymentIntent の所有者検証を追加した。
- 初期スキーマに存在しなかった `layers` / `positions` / `prizes` の `created_at` / `updated_at` を追加した。サービス層は常に両列を指定しており、キャンペーン作成が必ず SQL エラーになっていた。
- `lottery_results.user_id` を `users.user_id` と同じ UUID 型へ変換した。型不一致のため抽選結果取得 API が常に 500 を返していた。
- `seed.ts` の層格子数計算が旧仕様のままで同ファイル内の位置生成と矛盾していたため、共通ユーティリティに統一した。
- 実装仕様に追随していなかったテストを修正した（エラー応答の `success` フラグ、JWT 返却、409 Conflict、コンビニ決済の `requires_action`、三角形の層番号定義、認証必須となった抽選結果参照など）。
- レート制限カウンタをテストごとに初期化し、連続リクエストによる 429 の誤検知を解消した。

## 第2次検証結果

| 工程 | 実行結果 |
| --- | --- |
| ForgePay | Jest 全 1243 件成功（3スイートはスキップ）。`tsc` ビルド成功 |
| TriPrize | Jest 全 231 件成功（19件スキップ、1スイートはスキップ）。当初 90 件失敗から解消。`tsc` 型検査成功 |

TriPrize の結合・契約テストは実 PostgreSQL を必要とするため、検証環境に PostgreSQL 16 を導入し、マイグレーション適用後に実行した。

## 残存リスク

- ForgePay の管理 Webhook はイベントペイロードの `developer_id` に依存して所有権を判定している。`webhook_events` テーブルに `developer_id` 列を持たせる方が確実であり、スキーマ変更を伴う改善余地が残る。
- ForgePay の本番依存には破壊的メジャー更新が必要な高・重大脆弱性が残る。`bcrypt` と `uuid` の更新には認証・移行・実行環境の互換試験が必要。
- TriPrize には `firebase-admin` のメジャー更新が必要な中重要度脆弱性8件が残る。
- TriPrize の Jest はテスト完了後もオープンハンドルが残り、`--forceExit` なしでは終了しない。接続の後始末を整理する余地がある。
- Sonowa の公開会議アクセス制御、同時通訳の無認証サブスクリプション照会とクライアント API キー保存は、認証・データモデルを含む設計変更が必要。
- Liteflow の実行 API 無認証は既存 validator 契約で明示的に維持されている。本番投入時は validator・スクリプトと同時に認証化する必要がある。
- AiToEarn は `.gitmodules` に取得先を登録しない限りレビューできない。
