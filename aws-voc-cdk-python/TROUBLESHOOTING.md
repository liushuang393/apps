# トラブルシューティングガイド

本ドキュメントは、AWS VOC CDK Pythonプロジェクトで発生する可能性のある問題と解決方法をまとめたものです。

## 目次
1. [デプロイ時の問題](#デプロイ時の問題)
2. [Lambda関数の問題](#lambda関数の問題)
3. [Step Functionsの問題](#step-functionsの問題)
4. [Glue/Athenaの問題](#glueathenaの問題)
5. [QuickSightの問題](#quicksightの問題)
6. [パフォーマンスの問題](#パフォーマンスの問題)

---

## デプロイ時の問題

### エラー: "CDK Bootstrap required"
**症状**: `cdk deploy` 実行時に「Bootstrap が必要」というエラーが表示される

**原因**: CDK Bootstrapが実行されていない

**解決方法**:
```bash
cdk bootstrap aws://<ACCOUNT_ID>/ap-northeast-1
```

### エラー: "Docker daemon is not running"
**症状**: Lambda関数のビルド時にDockerエラーが発生

**原因**: Dockerが起動していない

**解決方法**:
1. Dockerを起動
2. 再度 `cdk deploy` を実行

### エラー: "QuickSight user not found"
**症状**: QuickSightスタックのデプロイが失敗

**原因**: QuickSightのEnterpriseサインアップが完了していない

**解決方法**:
1. AWSコンソールでQuickSightにアクセス
2. Enterpriseプランでサインアップ
3. `config/config.yaml` の `quicksight.account_id` と `principal_arn` を更新
4. 再度デプロイ

---

## Lambda関数の問題

### エラー: "Task timed out after 180.00 seconds"
**症状**: NLP Lambda関数がタイムアウト

**原因**: 
- Bedrockの応答が遅い
- テキストが長すぎる
- ネットワーク遅延

**解決方法**:
1. タイムアウトを延長（`infra/lambda_stack.py`）:
```python
timeout=Duration.seconds(300)  # 180 → 300
```

2. テキストの長さを制限（`lambda/voc_nlp/handler.py`）:
```python
MAX_TEXT_LENGTH = 5000  # 10000 → 5000
```

3. 再デプロイ:
```bash
cdk deploy softroad-voc-lambda
```

### エラー: "Memory Size: 2048 MB Max Memory Used: 2048 MB"
**症状**: Lambda関数がメモリ不足

**原因**: awswrangler/pyarrowのメモリ使用量が大きい

**解決方法**:
1. メモリサイズを増加（`infra/lambda_stack.py`）:
```python
memory_size=3008  # 2048 → 3008
```

2. 再デプロイ

### エラー: "Unable to import module 'handler'"
**症状**: Lambda関数の実行時にインポートエラー

**原因**: 依存関係が正しくバンドルされていない

**解決方法**:
1. `lambda/voc_nlp/requirements.txt` を確認
2. Dockerを再起動
3. CDKキャッシュをクリア:
```bash
rm -rf cdk.out
cdk deploy softroad-voc-lambda --force
```

### エラー: "AccessDeniedException: User is not authorized"
**症状**: Bedrock APIへのアクセスが拒否される

**原因**: Bedrockのモデルアクセスが有効化されていない

**解決方法**:
1. AWSコンソール → Bedrock → Model access
2. 使用するモデル（Claude 3 Sonnet）を有効化
3. 数分待ってから再試行

---

## Step Functionsの問題

### エラー: "States.TaskFailed"
**症状**: Step Functionsの実行が失敗

**原因**: Lambda関数のエラー

**解決方法**:
1. 実行履歴を確認:
```bash
aws stepfunctions describe-execution --execution-arn <EXECUTION_ARN>
```

2. CloudWatch Logsを確認:
```bash
aws logs tail /aws/lambda/softroad-voc-lambda-VocNlpFunction --follow
```

3. エラー内容に応じて対処

### エラー: "Execution throttled"
**症状**: 同時実行数の制限に達した

**原因**: 大量のファイルを一度にアップロード

**解決方法**:
1. アップロード速度を制限
2. Lambda予約同時実行数を設定（`infra/lambda_stack.py`）:
```python
reserved_concurrent_executions=10
```

---

## Glue/Athenaの問題

### エラー: "Table not found"
**症状**: Athenaでテーブルが見つからない

**原因**: Glue Crawlerが実行されていない

**解決方法**:
1. Crawlerを手動実行:
```bash
aws glue start-crawler --name crawler-voc-processed
```

2. 実行状態を確認:
```bash
aws glue get-crawler --name crawler-voc-processed
```

3. 完了後、Athenaで再クエリ

### エラー: "HIVE_PARTITION_SCHEMA_MISMATCH"
**症状**: Athenaクエリ時にスキーマ不一致エラー

**原因**: パーティションのスキーマが一致していない

**解決方法**:
1. テーブルを削除:
```sql
DROP TABLE db_voc.curated;
```

2. Crawlerを再実行:
```bash
aws glue start-crawler --name crawler-voc-processed
```

### エラー: "Insufficient permissions"
**症状**: Athenaクエリ実行時に権限エラー

**原因**: IAMロールの権限不足

**解決方法**:
1. QuickSightサービスロールに権限を追加
2. S3バケットポリシーを確認

---

## QuickSightの問題

### エラー: "Data source connection failed"
**症状**: QuickSightがAthenaに接続できない

**原因**: 
- WorkGroupが存在しない
- 権限不足

**解決方法**:
1. WorkGroupの確認:
```bash
aws athena list-work-groups
```

2. QuickSightサービスロールに権限を追加:
   - AmazonAthenaFullAccess
   - S3バケットへの読み取り権限

### エラー: "SPICE capacity exceeded"
**症状**: SPICEの容量不足

**原因**: データセットが大きすぎる

**解決方法**:
1. SPICEキャパシティを購入
2. または、Direct Queryモードに変更

---

## パフォーマンスの問題

### 問題: "処理が遅い"
**症状**: ファイルアップロードから結果出力まで5分以上かかる

**原因**:
- Bedrockの応答が遅い
- Lambda関数のコールドスタート
- ネットワーク遅延

**解決方法**:
1. Lambda Provisioned Concurrencyを設定（コールドスタート削減）
2. Bedrockのモデルを変更（Haiku等の高速モデル）
3. 並列処理の最適化

### 問題: "コストが高い"
**症状**: 月額コストが予想より高い

**原因**:
- Athenaのスキャン量が多い
- Lambda実行時間が長い
- Bedrockの使用量が多い

**解決方法**:
1. Parquetパーティショニングの最適化
2. Athenaクエリの最適化（WHERE句でパーティション指定）
3. Lambda関数のメモリ/タイムアウト調整
4. 不要なログの削除

---

## DLQの確認と対処

### DLQにメッセージが溜まっている場合

**確認方法**:
```bash
# メッセージ数の確認
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name softroad-voc-nlp-lambda-dlq --query 'QueueUrl' --output text) \
  --attribute-names ApproximateNumberOfMessages

# メッセージの内容を確認
aws sqs receive-message \
  --queue-url $(aws sqs get-queue-url --queue-name softroad-voc-nlp-lambda-dlq --query 'QueueUrl' --output text) \
  --max-number-of-messages 1
```

**対処方法**:
1. メッセージ内容からエラー原因を特定
2. 原因を修正
3. メッセージを再処理または削除:
```bash
# メッセージ削除
aws sqs purge-queue \
  --queue-url $(aws sqs get-queue-url --queue-name softroad-voc-nlp-lambda-dlq --query 'QueueUrl' --output text)
```

---

## サポート

上記で解決しない場合は、以下の情報を収集してサポートに連絡してください：

1. エラーメッセージの全文
2. CloudWatch Logsのスクリーンショット
3. 実行したコマンドと出力
4. `config/config.yaml` の内容（秘密情報は除く）
5. CDKバージョン: `cdk --version`
6. Pythonバージョン: `python --version`

