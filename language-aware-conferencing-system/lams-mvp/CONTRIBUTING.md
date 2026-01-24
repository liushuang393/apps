# 貢献ガイドライン / Contributing Guidelines

LAMSプロジェクトへの貢献に興味を持っていただき、ありがとうございます!

このドキュメントでは、プロジェクトへの貢献方法を説明します。

---

## 📋 目次

1. [行動規範](#行動規範)
2. [開発環境のセットアップ](#開発環境のセットアップ)
3. [貢献の流れ](#貢献の流れ)
4. [コーディング規約](#コーディング規約)
5. [コミット規則](#コミット規則)
6. [プルリクエスト](#プルリクエスト)
7. [Issue報告](#issue報告)

---

## 行動規範

このプロジェクトに参加する全ての人は、以下の行動規範を守ることが求められます:

- 敬意を持ってコミュニケーションする
- 建設的なフィードバックを提供する
- 他者の意見を尊重する
- プロジェクトの目的に沿った貢献をする

---

## 開発環境のセットアップ

### 必要要件

- Docker & Docker Compose
- Node.js 20+
- Python 3.10+
- Git

### セットアップ手順

```bash
# 1. リポジトリをクローン
git clone https://github.com/your-org/lams.git
cd lams/lams-mvp

# 2. 環境変数を設定
cp .env.example .env
# .env ファイルを編集して必要な値を設定

# 3. Docker環境を起動
docker compose up -d --build

# 4. データベースマイグレーション
docker compose exec backend alembic upgrade head

# 5. 動作確認
# フロントエンド: http://localhost:5173
# バックエンド: http://localhost:8000/docs
```

詳細は [README.md](./README.md) を参照してください。

---

## 貢献の流れ

### 1. Issueを確認・作成

- 既存のIssueを確認し、重複がないか確認
- 新しい機能やバグ修正の場合は、まずIssueを作成
- Issueで議論し、実装方針を決定

### 2. ブランチを作成

```bash
# mainブランチから最新を取得
git checkout main
git pull origin main

# 作業用ブランチを作成
git checkout -b feature/your-feature-name
```

ブランチ命名規則:
- `feature/機能名`: 新機能
- `bugfix/バグ名`: バグ修正
- `refactor/対象`: リファクタリング
- `docs/対象`: ドキュメント更新

### 3. コードを実装

- [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) に従って実装
- 適切なコメントを記載
- テストを追加・更新

### 4. 静的解析を実行

```bash
# 全チェック
./scripts/check.sh

# 自動修正
./scripts/check.sh --fix
```

### 5. コミット

```bash
# 変更をステージング
git add .

# コミット（Conventional Commits形式）
git commit -m "feat(websocket): 自動再接続機能を追加"
```

### 6. プッシュ

```bash
git push origin feature/your-feature-name
```

### 7. プルリクエストを作成

- GitHubでプルリクエストを作成
- テンプレートに従って情報を記載
- レビューを待つ

### 8. レビュー対応

- レビューコメントに対応
- 必要に応じて修正をコミット
- 承認されたらマージ

---

## コーディング規約

詳細は [DEVELOPMENT_RULES.md](./DEVELOPMENT_RULES.md) を参照してください。

### 重要なポイント

#### フロントエンド（TypeScript/React）

- ✅ `strict` モードを有効化
- ❌ `any` 型の使用禁止
- ❌ `console.log` の使用禁止
- ✅ 関数コンポーネントを使用
- ✅ カスタムフックで状態ロジックを分離

#### バックエンド（Python/FastAPI）

- ✅ 型ヒントを必ず記載
- ❌ `print()` の使用禁止（ロギングを使用）
- ✅ Pydanticモデルでバリデーション
- ✅ 非同期処理は `async/await` を使用

### 静的解析

コミット前に必ず実行:

```bash
./scripts/check.sh
```

エラーが0になるまで修正してください。

---

## コミット規則

### Conventional Commits形式

```
<type>(<scope>): <subject>

<body>

<footer>
```

### Type

- `feat`: 新機能
- `fix`: バグ修正
- `docs`: ドキュメント変更
- `style`: コードフォーマット
- `refactor`: リファクタリング
- `test`: テスト追加・修正
- `chore`: ビルド・設定変更

### 例

```
feat(auth): JWT認証機能を追加

ユーザー認証にJWTトークンを使用する機能を実装。
トークンの有効期限は1時間に設定。

Closes #123
```

---

## プルリクエスト

### テンプレート

プルリクエスト作成時に自動的にテンプレートが表示されます。
全ての項目を埋めてください。

### マージ条件

- ✅ 静的解析エラー 0
- ✅ テスト通過
- ✅ 最低1名のレビュー承認
- ✅ コンフリクト解消済み
- ✅ ドキュメント更新（必要に応じて）

### レビュープロセス

1. 自動チェック（CI）が通過
2. レビュアーがコードレビュー
3. 必要に応じて修正
4. 承認後、マージ

---

## Issue報告

### バグ報告

バグを発見した場合は、以下の情報を含めてIssueを作成してください:

- バグの概要
- 再現手順
- 期待される動作
- 実際の動作
- 環境情報（OS、ブラウザ、バージョン）
- スクリーンショット（該当する場合）
- エラーログ

### 機能リクエスト

新機能を提案する場合は、以下の情報を含めてください:

- 機能の概要
- 目的・背景
- 詳細な説明
- UI/UXデザイン（該当する場合）
- 技術的な実装案（可能な範囲で）

---

## 質問・サポート

質問がある場合は、以下の方法でお問い合わせください:

- GitHub Discussions（推奨）
- Issue（バグ報告・機能リクエスト）
- メール（緊急の場合）

---

## ライセンス

このプロジェクトに貢献することで、あなたの貢献がMITライセンスの下で公開されることに同意したものとみなされます。

---

<p align="center">
  <sub>貢献に感謝します! 🙏</sub>
</p>

