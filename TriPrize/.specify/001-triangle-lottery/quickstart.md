# クイックスタート: 三角形抽選販売アプリケーション

**日付**: 2025-11-11 | **フィーチャー**: [spec.md](./spec.md)

このドキュメントはローカル開発環境のセットアップ手順を記載します。

---

## 前提条件

### 必須ツール

- **Node.js**: 20 LTS以上
- **Flutter**: 3.16以上、Dart 3.2以上
- **PostgreSQL**: 16以上
- **Redis**: 7以上
- **Git**: 最新版

### 開発ツール（推奨）

- **Visual Studio Code** + Flutter/Dart拡張機能
- **Postman** または **Thunder Client** (API テスト用)
- **pgAdmin** または **DBeaver** (PostgreSQL GUI)
- **RedisInsight** (Redis GUI)
- **Stripe CLI** (Webhook テスト用)
- **Firebase CLI** (エミュレータ用)

---

## セットアップ手順

### 1. リポジトリのクローン

```bash
git clone https://github.com/your-org/triprize.git
cd triprize
```

### 2. 依存関係のインストール

#### Node.js API

```bash
cd api
npm install
```

#### Flutter モバイルアプリ

```bash
cd mobile
flutter pub get
```

---

## データベースセットアップ

### PostgreSQL

#### インストール（macOS）

```bash
brew install postgresql@16
brew services start postgresql@16
```

#### インストール（Windows）

1. [PostgreSQL公式サイト](https://www.postgresql.org/download/windows/)からインストーラーをダウンロード
2. インストーラーを実行し、デフォルト設定で進める
3. パスワードを設定（例: `postgres`）

#### データベースとユーザーの作成

```bash
# PostgreSQLに接続
psql -U postgres

# データベース作成
CREATE DATABASE triprize_dev;

# 開発用ユーザー作成
CREATE USER triprize_user WITH PASSWORD 'your_secure_password';

# 権限付与
GRANT ALL PRIVILEGES ON DATABASE triprize_dev TO triprize_user;

# 接続テスト
\c triprize_dev
\q
```

#### マイグレーション実行

```bash
cd api

# マイグレーションファイルを実行
psql -U triprize_user -d triprize_dev -f migrations/001_initial_schema.sql

# または npm scriptを使用
npm run migrate
```

### Redis

#### インストール（macOS）

```bash
brew install redis
brew services start redis
```

#### インストール（Windows）

```bash
# Chocolateyを使用
choco install redis-64

# または WSL2を使用
wsl --install
wsl
sudo apt-get update
sudo apt-get install redis-server
sudo service redis-server start
```

#### 接続テスト

```bash
redis-cli
> ping
PONG
> exit
```

---

## 環境変数の設定

### API（Node.js）

`api/.env` ファイルを作成:

```bash
cp api/.env.example api/.env
```

`api/.env` を編集:

```env
# Server
NODE_ENV=development
PORT=3000
API_BASE_URL=http://localhost:3000

# Database
DATABASE_URL=postgresql://triprize_user:your_secure_password@localhost:5432/triprize_dev
DATABASE_POOL_MIN=10
DATABASE_POOL_MAX=50

# Redis
REDIS_URL=redis://localhost:6379
REDIS_CACHE_TTL=3600

# Firebase
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com

# Stripe（Stripeダッシュボードから取得）
STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY
STRIPE_PUBLISHABLE_KEY=YOUR_STRIPE_PUBLISHABLE_KEY
STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET

# AWS S3
AWS_REGION=ap-northeast-1
AWS_ACCESS_KEY_ID=AKIAXXXXXXXXXXXXXXXX
AWS_SECRET_ACCESS_KEY=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_S3_BUCKET=triprize-dev-images

# JWT
JWT_SECRET=your_jwt_secret_key_at_least_32_characters_long

# Logging
LOG_LEVEL=debug
```

### Flutter モバイルアプリ

`mobile/.env` ファイルを作成:

```bash
cp mobile/.env.example mobile/.env
```

`mobile/.env` を編集:

```env
# API
API_BASE_URL=http://localhost:3000/v1

# Firebase
FIREBASE_PROJECT_ID=your-firebase-project-id
FIREBASE_API_KEY=AIzaSyXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
FIREBASE_APP_ID_IOS=1:123456789:ios:abcdef1234567890
FIREBASE_APP_ID_ANDROID=1:123456789:android:abcdef1234567890

# Stripe
STRIPE_PUBLISHABLE_KEY=pk_test_xxxxxxxxxxxxxxxxxxxxxxxx

# Environment
ENVIRONMENT=development
```

---

## Firebaseセットアップ

### Firebase Console設定

1. [Firebase Console](https://console.firebase.google.com/)にアクセス
2. 新しいプロジェクトを作成
3. **Authentication**を有効化
   - Email/Password認証を有効化
   - Google認証を有効化（オプション）
   - Apple認証を有効化（オプション）
4. **Cloud Messaging**を有効化
   - iOSアプリを追加し、APNs証明書をアップロード
   - Androidアプリを追加し、`google-services.json`をダウンロード

### サービスアカウントキーの取得

1. Firebase Console > プロジェクト設定 > サービスアカウント
2. 「新しい秘密鍵の生成」をクリック
3. ダウンロードした JSON ファイルを `api/config/firebase-service-account.json` に保存
4. `.env` ファイルに認証情報を転記

### Firebase CLI インストール

```bash
npm install -g firebase-tools
firebase login
firebase projects:list
```

### Flutter アプリへの設定ファイル追加

```bash
# iOS
# firebase-service-account.json から GoogleService-Info.plist をダウンロード
# mobile/ios/Runner/GoogleService-Info.plist に配置

# Android
# google-services.json を mobile/android/app/ に配置
```

---

## Stripeセットアップ

### Stripeアカウント作成

1. [Stripe](https://stripe.com/)にサインアップ
2. ダッシュボードで「開発者」→「APIキー」を開く
3. **公開可能キー**（`pk_test_...`）と**シークレットキー**（`sk_test_...`）をコピー
4. `.env` ファイルに貼り付け

### Webhook設定

#### Stripe CLI インストール

```bash
# macOS
brew install stripe/stripe-cli/stripe

# Windows
scoop install stripe

# Linux
wget https://github.com/stripe/stripe-cli/releases/download/vX.XX.X/stripe_X.XX.X_linux_x86_64.tar.gz
tar -xvf stripe_X.XX.X_linux_x86_64.tar.gz
sudo mv stripe /usr/local/bin/
```

#### Webhook リスニング開始

```bash
stripe login
stripe listen --forward-to localhost:3000/v1/webhooks/stripe
```

出力される **Webhook署名シークレット**（`whsec_...`）を `api/.env` の `STRIPE_WEBHOOK_SECRET` に設定。

### Konbiniテストモード有効化

Stripeダッシュボードで「設定」→「支払い方法」→「Konbini」を有効化。

---

## AWS S3セットアップ

### S3バケット作成

```bash
aws configure
aws s3 mb s3://triprize-dev-images --region ap-northeast-1
```

### バケットポリシー設定

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicRead",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::triprize-dev-images/*"
    }
  ]
}
```

### CORS設定

```json
[
  {
    "AllowedHeaders": ["*"],
    "AllowedMethods": ["GET", "PUT", "POST"],
    "AllowedOrigins": ["http://localhost:3000", "http://localhost:*"],
    "ExposeHeaders": ["ETag"]
  }
]
```

---

## 開発サーバーの起動

### API（Node.js）

```bash
cd api

# 開発モードで起動（ホットリロード有効）
npm run dev

# または通常モード
npm start
```

**起動確認**:
```bash
curl http://localhost:3000/health
# {"status":"ok","database":"connected","redis":"connected"}
```

### Flutter（iOS）

```bash
cd mobile

# iOSシミュレータを起動
open -a Simulator

# アプリを実行
flutter run
```

### Flutter（Android）

```bash
cd mobile

# Androidエミュレータを起動
flutter emulators --launch <emulator_id>

# アプリを実行
flutter run
```

---

## データベース初期データの投入

### シードデータスクリプト実行

```bash
cd api
npm run seed
```

これにより以下のデータが投入されます:

- **管理者ユーザー**: `admin@example.com` / `admin123`
- **テストユーザー**: `user1@example.com` / `user123`
- **サンプルキャンペーン**: 3件（下書き、公開中、完了）

---

## API動作確認

### Health Check

```bash
curl http://localhost:3000/health
```

### ユーザー登録

```bash
curl -X POST http://localhost:3000/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "test@example.com",
    "password": "Test123!",
    "displayName": "Test User"
  }'
```

### キャンペーン一覧取得

```bash
curl http://localhost:3000/v1/campaigns
```

---

## テストの実行

### API（Node.js）

```bash
cd api

# 全テストを実行
npm test

# ユニットテストのみ
npm run test:unit

# インテグレーションテストのみ
npm run test:integration

# カバレッジレポート生成
npm run test:coverage
```

### Flutter

```bash
cd mobile

# ユニットテスト
flutter test

# ウィジェットテスト
flutter test test/widget

# インテグレーションテスト
flutter test integration_test
```

---

## ログの確認

### API ログ

```bash
# リアルタイムログ表示
cd api
npm run dev

# または専用ログファイル
tail -f logs/app.log
```

### データベースログ

```bash
# PostgreSQLログ
tail -f /usr/local/var/log/postgresql@16.log
```

### Redisログ

```bash
# Redisログ
tail -f /usr/local/var/log/redis.log

# または redis-cli モニター
redis-cli monitor
```

---

## よくある問題と解決方法

### 1. データベース接続エラー

**エラー**: `ECONNREFUSED 127.0.0.1:5432`

**解決方法**:
```bash
# PostgreSQLが起動しているか確認
brew services list

# 起動していない場合
brew services start postgresql@16

# 接続テスト
psql -U postgres -d triprize_dev
```

### 2. Redis接続エラー

**エラー**: `ECONNREFUSED 127.0.0.1:6379`

**解決方法**:
```bash
# Redisが起動しているか確認
redis-cli ping

# 起動していない場合
brew services start redis
```

### 3. Firebase認証エラー

**エラー**: `Firebase: Error (auth/invalid-api-key)`

**解決方法**:
- `.env` ファイルの `FIREBASE_API_KEY` が正しいか確認
- Firebase Consoleでプロジェクト設定を確認
- `GoogleService-Info.plist`（iOS）と `google-services.json`（Android）が正しい場所にあるか確認

### 4. Stripe Webhookが受信されない

**解決方法**:
```bash
# Stripe CLIが起動しているか確認
stripe listen --forward-to localhost:3000/v1/webhooks/stripe

# Webhookシークレットを .env に設定
# STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

### 5. Flutter ビルドエラー

**エラー**: `CocoaPods not installed`

**解決方法**:
```bash
# macOS
sudo gem install cocoapods
cd mobile/ios
pod install
```

### 6. ポート競合エラー

**エラー**: `EADDRINUSE: address already in use :::3000`

**解決方法**:
```bash
# ポート3000を使用しているプロセスを確認
lsof -i :3000

# プロセスを終了
kill -9 <PID>

# または別のポートを使用
PORT=3001 npm run dev
```

---

## 開発ワークフロー

### 1. 新機能開発

```bash
# 機能ブランチ作成
git checkout -b feature/new-feature

# コードを実装

# テストを実行
npm test

# コミット
git add .
git commit -m "feat: add new feature"

# プッシュ
git push origin feature/new-feature
```

### 2. APIエンドポイント追加

1. `api/src/routes/` に新しいルートファイルを作成
2. `api/src/controllers/` にコントローラーを作成
3. `api/src/services/` にビジネスロジックを作成
4. `api/tests/integration/` にインテグレーションテストを作成
5. OpenAPI仕様書（`contracts/api-openapi.yaml`）を更新

### 3. データベーススキーマ変更

1. `api/migrations/` に新しいマイグレーションファイルを作成
2. マイグレーションを実行: `npm run migrate`
3. `data-model.md` を更新

---

## デバッグ

### VS Code デバッグ設定

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug API",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/api/src/index.ts",
      "preLaunchTask": "tsc: build - api/tsconfig.json",
      "outFiles": ["${workspaceFolder}/api/dist/**/*.js"],
      "env": {
        "NODE_ENV": "development"
      }
    },
    {
      "name": "Debug Flutter",
      "type": "dart",
      "request": "launch",
      "program": "${workspaceFolder}/mobile/lib/main.dart"
    }
  ]
}
```

### Chrome DevTools（Flutter Web）

```bash
cd mobile
flutter run -d chrome --web-renderer html
```

ブラウザの DevTools でネットワーク、コンソール、パフォーマンスをデバッグ可能。

---

## パフォーマンステスト

### k6によるロードテスト

```bash
# k6 インストール
brew install k6

# ロードテストスクリプト実行
k6 run api/tests/load/purchase-flow.js
```

`purchase-flow.js` の例:

```javascript
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  vus: 500, // 500並行ユーザー
  duration: '1m',
};

export default function () {
  const url = 'http://localhost:3000/v1/purchases';
  const payload = JSON.stringify({
    campaignId: 'test-campaign-id',
    layerNumber: 1,
  });
  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer test-token',
      'Idempotency-Key': `${__VU}-${__ITER}`,
    },
  };

  const res = http.post(url, payload, params);

  check(res, {
    'status is 201': (r) => r.status === 201,
    'response time < 500ms': (r) => r.timings.duration < 500,
  });

  sleep(1);
}
```

---

## 本番環境へのデプロイ

### 環境変数の設定

本番環境では以下の環境変数を設定:

```env
NODE_ENV=production
DATABASE_URL=<production-database-url>
REDIS_URL=<production-redis-url>
STRIPE_SECRET_KEY=sk_live_xxxxx
STRIPE_WEBHOOK_SECRET=whsec_xxxxx
```

### ビルドとデプロイ

```bash
# APIビルド
cd api
npm run build

# 本番サーバーで起動
npm start

# または Docker
docker build -t triprize-api .
docker run -p 3000:3000 triprize-api
```

### Flutter リリースビルド

```bash
cd mobile

# iOS
flutter build ios --release
open ios/Runner.xcworkspace
# Xcode でアーカイブとアップロード

# Android
flutter build appbundle --release
# Google Play Console にアップロード
```

---

## サポート

問題が解決しない場合:

- **Slack**: `#triprize-dev` チャンネル
- **GitHub Issues**: https://github.com/your-org/triprize/issues
- **ドキュメント**: https://docs.triprize.example.com

---

**作成者**: Claude Code | **最終更新**: 2025-11-11
