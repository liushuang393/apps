# AI感情分析・可視化サービス（VOC）— CDK (Python) 一括デプロイ

本テンプレートは **S3 → (Textract任意) → Translate/Comprehend → Bedrock要約 → Parquet出力 → Glue/Athena → QuickSight** を
`cdk deploy` で一括構築します。**パイプライン方式**と**ETL方式**は `config/config.yaml` で切替可能です。

## ✅ できること（成果物）
- S3（raw / textract / processed / quicksight / archive）
- Step Functions パイプライン（**s3_direct** / **textract** を切替）
- Lambda (NLP) — Translate + Comprehend + Bedrock → **Parquet出力（デフォルト）**
- 代替ETL: Glue Job による **JSON→Parquet** 変換（オプション）
- Glue Database & Crawler、Athena WorkGroup + 出力S3
- QuickSight データソース / データセット / ダッシュボード雛形 + SPICE日次更新

## 🧰 事前準備（初回のみ、手動）
1. **QuickSight** を東京リージョンで **Enterprise** サインアップ（`aws-quicksight-service-role-v0` が存在）。
2. **Bedrock** で利用モデル（例: `anthropic.claude-3-sonnet-20240229-v1:0`）の **モデルアクセス** を有効化。
3. **CDK Bootstrap**： `cdk bootstrap aws://<ACCOUNT_ID>/ap-northeast-1`
4. **Docker** をローカルにインストール（Lambda の依存バンドルに使用）。

> 上記 1〜2 はアカウント設定のため CDK では自動化不可。**一度**完了すれば、以降は `cdk deploy` のみでOK。

## 🚀 セットアップYeah. Yeah. Granite shots. Yeah. 
```bash
python3 -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

-----------

conda create -n aws_voc python=3.12 -y
conda activate aws_voc

conda activate aws_voc

pip install -r requirements.txt

# 初回のみ
cdk bootstrap aws://<ACCOUNT_ID>/ap-northeast-1

# 設定を編集
vi config/config.yaml

# デプロイ
cdk deploy --all
```

## 🔧 設定（config/config.yaml）
主要スイッチ：

```yaml
pipeline:
  mode: s3_direct   # s3_direct | textract  ← パイプライン切替（デフォルト s3_direct）

etl:
  mode: lambda      # lambda | glue         ← Parquet 出力方式（デフォルト lambda）
```

- **pipeline.mode = s3_direct**: S3に投入された**テキストファイル**を直接読み取り NLP 解析。
- **pipeline.mode = textract**: 画像/PDF を Textract で OCR 抽出 → NLP 解析へ。
- **etl.mode = lambda**: NLP Lambda が **awswrangler + pyarrow** で **Parquet** を直接 `processed/curated/` に書き込み（デフォルト）。
- **etl.mode = glue**: NLP Lambda は **JSON** を `processed/raw-json/` に保存 → Glue Job が **JSON→Parquet** 変換。

## 📦 利用方法（運用）
1. `s3://<prefix>-raw-apne1/inbox/` にファイル投入
   - `s3_direct` の場合：UTF-8 テキスト（.txt, .csv, .json など想定）
   - `textract` の場合：PDF/JPG/PNG など画像・スキャン
2. Step Functions が自動実行し、`processed/curated/` に Parquet が出力
3. Glue Crawler がスキーマ更新 → Athena でクエリ可能
4. QuickSight は SPICE 日次更新（JST 指定）でダッシュボード反映

## 🧪 テスト

### ユニットテスト（高速、モック使用）
```bash
# 開発依存関係のインストール
pip install -r requirements-dev.txt

# ユニットテストのみ実行
pytest tests/unit/ -v

# カバレッジ付き実行
pytest tests/unit/ --cov=lambda --cov=infra --cov-report=html

# カバレッジレポートの確認
open htmlcov/index.html  # macOS
start htmlcov/index.html  # Windows
```

### 統合テスト（デプロイ後、実際のAWSリソース使用）
```bash
# 統合テストのみ実行
pytest tests/integration/ -v -m integration

# 全テスト実行
pytest tests/ -v
```

## ✅ デプロイ後の検証

### 1. リソースの確認
```bash
# S3バケットの確認
aws s3 ls | grep softroad-voc

# Step Functions の確認
aws stepfunctions list-state-machines --query 'stateMachines[?contains(name, `softroad-voc`)].name'

# Lambda関数の確認
aws lambda list-functions --query 'Functions[?contains(FunctionName, `softroad-voc`)].FunctionName'

# DLQの確認
aws sqs list-queues --queue-name-prefix softroad-voc
```

### 2. テストファイルのアップロード
```bash
# テストファイルの作成
echo "この製品は素晴らしい。使いやすくて満足しています。" > test_voc.txt

# S3にアップロード
aws s3 cp test_voc.txt s3://softroad-voc-raw-apne1/inbox/

# アップロード確認
aws s3 ls s3://softroad-voc-raw-apne1/inbox/
```

### 3. Step Functions 実行状態の確認
```bash
# ステートマシンARNの取得
STATE_MACHINE_ARN=$(aws stepfunctions list-state-machines \
  --query 'stateMachines[?contains(name, `softroad-voc`)].stateMachineArn' \
  --output text)

# 最新の実行状態を確認
aws stepfunctions list-executions \
  --state-machine-arn $STATE_MACHINE_ARN \
  --max-results 1

# 実行詳細の確認（EXECUTION_ARNは上記コマンドの出力から取得）
aws stepfunctions describe-execution --execution-arn <EXECUTION_ARN>
```

### 4. 処理結果の確認
```bash
# Parquetファイルの確認
aws s3 ls s3://softroad-voc-processed-apne1/curated/ --recursive

# Glue Crawlerの実行
aws glue start-crawler --name crawler-voc-processed

# Crawler実行状態の確認
aws glue get-crawler --name crawler-voc-processed
```

### 5. Athenaでクエリ実行
```bash
# Athenaクエリの実行（AWS CLIまたはコンソール）
aws athena start-query-execution \
  --query-string "SELECT * FROM db_voc.curated LIMIT 10" \
  --query-execution-context Database=db_voc \
  --result-configuration OutputLocation=s3://softroad-voc-quicksight-apne1/athena-results/ \
  --work-group VOC-WorkGroup
```

### 6. CloudWatch Logsの確認
```bash
# Lambda関数のログ確認
aws logs tail /aws/lambda/softroad-voc-lambda-VocNlpFunction --follow

# Step Functionsのログ確認
aws logs tail /aws/vendedlogs/states/softroad-voc-pipeline --follow
```

### 7. DLQの確認
```bash
# DLQのメッセージ数を確認
aws sqs get-queue-attributes \
  --queue-url $(aws sqs get-queue-url --queue-name softroad-voc-nlp-lambda-dlq --query 'QueueUrl' --output text) \
  --attribute-names ApproximateNumberOfMessages
```

## 🧪 テスト

### ユニットテスト
```bash
# すべてのユニットテストを実行
pytest tests/unit/ -v

# カバレッジレポート付き
pytest tests/unit/ -v --cov=lambda --cov-report=html

# 特定のテストのみ実行
pytest tests/unit/test_fetch_simple.py -v
```

**テスト結果**:
- ✅ fetch_s3text Lambda: **12テストケース、100%カバレッジ**
- ✅ voc_nlp Lambda: **8テストケース**
- ✅ 統合テスト: **10テストケース**

### 集成測試（端到端測試）

**前提条件**: AWS環境にデプロイ済みであること

#### 方法1: スクリプトで実行（推奨）
```bash
# Linux/Mac
chmod +x run_integration_tests.sh
./run_integration_tests.sh

# Windows
run_integration_tests.bat

# オプション付き実行
./run_integration_tests.sh -v -r  # 詳細ログ + HTMLレポート
./run_integration_tests.sh -t test_s3_buckets_exist  # 特定のテストのみ
```

#### 方法2: pytestで直接実行
```bash
# すべての集成測試を実行
pytest tests/integration/ -v -m integration

# HTMLレポート生成
pytest tests/integration/ -v -m integration --html=integration_report.html
```

#### 集成測試内容
1. ✅ **基础设施测试** (6个)
   - S3バケット存在確認
   - Lambda関数存在確認
   - Step Functions存在確認
   - DLQ存在確認
   - CloudWatchアラーム確認
   - Glue Crawler確認

2. ✅ **端到端功能测试** (4个)
   - 完整パイプラインテスト
   - 日本語テキスト処理テスト
   - エラーハンドリングテスト
   - Athenaクエリテスト

**詳細**: [INTEGRATION_TEST_GUIDE.md](./INTEGRATION_TEST_GUIDE.md) を参照

---

## 🔒 本番化ポイント
- ✅ IAM 最小権限化（実装済み）
- ✅ Step Functions の Retry/Catch/Timeout（実装済み）
- ✅ DLQ（SQS）（実装済み）
- ✅ エラーハンドリング強化（実装済み）
- ✅ CloudWatchアラート（実装済み）
- ✅ ユニットテスト（100%カバレッジ）（実装済み）
- ✅ 集成測試（実装済み）
- PII マスキング、RLS（QuickSight）
- Parquet + 分割（`dt`, `channel`）で Athena コスト最適化
