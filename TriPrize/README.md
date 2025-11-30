# TriPrize - 三角形抽選販売システム

日本市場向けの三角形抽選販売プラットフォーム。iOS/Android モバイルアプリと Node.js REST API で構成されています。

---

## 📚 ドキュメント索引

詳細なドキュメントは [`docs/`](./docs/) フォルダにあります:

- **[docs/INDEX.md](./docs/INDEX.md)** - 📖 完全なドキュメント索引
- **[.specify/001-triangle-lottery/spec.md](./.specify/001-triangle-lottery/spec.md)** - 📋 機能仕様書

---

## 🎯 機能一覧

### ユーザー機能
- ✅ **三角形キャンペーン閲覧** - リアルタイム進捗表示
- ✅ **ランダムポジション購入** - 層選択後、自動割当
- ✅ **日本決済対応** - クレジットカード、デビットカード、コンビニ決済
- ✅ **購入履歴管理** - 過去の購入記録確認
- ✅ **抽選結果通知** - プッシュ通知で即座にお知らせ

### 管理者機能
- ✅ **キャンペーン作成・管理** - 三角形構造の設定
- ✅ **自動抽選実行** - 全ポジション販売完了時に自動実行
- ✅ **売上統計** - リアルタイム売上確認
- ✅ **ユーザー管理** - 購入者情報管理

### 技術的特徴
- ✅ **同時購入制御** - PostgreSQL FOR UPDATE SKIP LOCKEDで0%オーバーセリング保証
- ✅ **冪等性保証** - Redis + SHA-256で重複購入防止
- ✅ **トランザクション分離** - REPEATABLE READでデータ整合性保証
- ✅ **Webhook処理** - Stripe Webhookで決済状態同期

---

## 🛠️ 技術アーキテクチャ
````mermaid mode=EXCERPT
flowchart LR
  Web[Flutter Web] --> API[Node.js REST API]
  Mobile[Flutter iOS/Android] --> API
  API --> Postgres[(PostgreSQL 16)]
  API --> Redis[(Redis 7)]
  API --> Uploads[(Local File Storage: api/uploads)]
  API --> Stripe[(Stripe Payments)]
  API --> Firebase[(Firebase Auth & Admin)]
````

### Backend (API)
- **Node.js 20 LTS** + Express.js
- **TypeScript 5.x** (Strict mode)
- **PostgreSQL 16** (トランザクション分離)
- **Redis 7** (キャッシング、冪等性)
- **Stripe** (決済処理)
- **Firebase Admin SDK** (認証)
- **AWS S3** (画像ストレージ)

### Mobile (iOS/Android)
- **Flutter 3.16+** (Dart 3.2+)
- **Clean Architecture** (BLoC pattern)
- **Firebase Authentication** (ユーザー認証)
- **Firebase Cloud Messaging** (プッシュ通知)
- **Stripe Flutter SDK** (決済UI)

### Infrastructure
- **Docker Compose** (ローカル開発環境)
- **PostgreSQL 16** (メインデータベース)
- **Redis 7** (キャッシュ・セッション管理)

---

## 🚀 ローカル開発環境セットアップ

### 前提条件
- **Docker Desktop** がインストール済み
- **Node.js 20 LTS** 以上
- **Flutter 3.16+** (モバイルアプリ開発時)
- **Chrome ブラウザ** (Web版テスト時)

### 手順1: リポジトリのクローン

```bash
git clone https://github.com/your-org/triprize.git
cd TriPrize
```

### 手順2: Docker でデータベース起動

```bash
# PostgreSQL + Redis を起動
docker-compose down
docker-compose up -d postgres redis

# 起動確認 (healthy と表示されることを確認)
docker-compose ps
```

**期待される出力:**
```
NAME                IMAGE                COMMAND                  SERVICE    STATUS
triprize-postgres   postgres:16-alpine   ...                      postgres   Up (healthy)
triprize-redis      redis:7-alpine       ...                      redis      Up (healthy)
```

### 手順3: API セットアップ(１回のみ)

```bash
cd api

# 依存関係のインストール
npm install

# 環境変数ファイルを確認 (.env が存在し、適切に設定されているか)
# 既に .env が用意されている場合はそのまま使用可能

# データベースマイグレーション実行
npm run migrate
```

**期待される出力:**
```
✓ Migration completed: 003_add_firebase_uid_to_users.sql
✓ Migration completed: 004_make_campaigns_fields_nullable.sql
✓ All migrations completed successfully
```

### 手順4: API サーバー起動

```bash
# 開発サーバー起動 (ホットリロード有効)
cd api
npm run dev
```

**期待される出力:**
```
✓ Database connection successful
✓ Redis connection successful
✓ Firebase initialized
✓ Server running at http://0.0.0.0:3000
✓ Health check: http://0.0.0.0:3000/health
```

API が http://localhost:3000 で起動します。

### 手順5: Flutter アプリ起動 (テスト用)

新しいターミナルを開いて:

```bash
cd mobile

# 依存関係のインストール (初回のみ)
flutter pub global activate flutterfire_cli
flutterfire configure --platforms=android,ios,web
flutter clean
flutter pub get
# iOS シミュレータで起動方式選択できる
# flutter run

# 環境変数ファイルを確認
# mobile/.env の API_BASE_URL が http://localhost:3000 になっていることを確認

# Chrome ブラウザで起動 (推奨)
flutter run -d chrome --web-port=8888
```

**初回起動時の注意:**
- Flutter の初回ビルドには 2-3 分かかります
- Chrome ブラウザが自動的に開きます
- キャンペーン一覧が表示されれば成功です

**期待される出力:**
```
✓ Built build\web\main.dart.js
[TriPrize] [INFO] Firebase initialized
[TriPrize] [INFO] App initialization complete
[TriPrize] [INFO] Successfully fetched 4 campaigns
```

### 起動確認

1. **API サーバー:** http://localhost:3000/health にアクセスして `{"status":"healthy"}` が返ることを確認
2. **Flutter アプリ:** http://localhost:8888 でキャンペーン一覧が表示されることを確認
显示名：管理者
メールアドレス：admin@triprize.com
パスワード：admin1234AQ!
Get-Content d:\apps\TriPrize\check_admin.sql | docker exec -i triprize-postgres psql -U triprize -d triprize
---

## 🧪 テスト実行

### Backend API テスト

```bash
cd api

# 全テスト実行
npm test

# カバレッジレポート
npm test -- --coverage

# 特定のテストのみ
npm test -- payment-webhook.test.ts
```

### Mobile アプリテスト

```bash
cd mobile

# Lintチェック
flutter analyze

# 全テスト実行
flutter test

# カバレッジ付き
flutter test --coverage
```

---

## 📱 本番アプリのビルドと公開手順

### Android アプリ → Google Play Store 公開

#### ステップ1: 署名鍵の生成

```bash
cd mobile/android

# JKS キーストアを生成
keytool -genkey -v -keystore triprize.jks \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -alias triprize
```

**入力項目:**
- キーストアのパスワード (安全に保管)
- キーのパスワード (安全に保管)
- 組織情報 (名前、組織名、都市、国など)

#### ステップ2: 署名設定ファイルの作成

`mobile/android/key.properties` を作成:

```properties
storePassword=your-keystore-password
keyPassword=your-key-password
keyAlias=triprize
storeFile=../triprize.jks
```

**⚠️ 重要:** `key.properties` と `triprize.jks` は `.gitignore` に追加し、Git にコミットしないこと

#### ステップ3: Release ビルドの実行

```bash
cd mobile

# App Bundle をビルド (Google Play 推奨形式)
flutter build appbundle --release

# または APK をビルド (直接配布用)
flutter build apk --release --split-per-abi
```

**ビルド成果物の場所:**
- **App Bundle:** `mobile/build/app/outputs/bundle/release/app-release.aab`
- **APK:** `mobile/build/app/outputs/flutter-apk/app-arm64-v8a-release.apk`

#### ステップ4: Google Play Console へのアップロード

1. **Google Play Console** にアクセス: https://play.google.com/console
2. アプリを選択または新規作成
3. **製品版 → リリース → 製作版** を選択
4. `app-release.aab` をアップロード
5. **リリースノート**を日本語で記入
6. **審査に提出**

**審査期間:** 通常 1-3 日

---

### iOS アプリ → App Store 公開

#### 前提条件

- **Apple Developer Program** への登録 ($99/年)
- **macOS** 搭載の Mac (iOS ビルドには必須)
- **Xcode** 最新版のインストール

#### ステップ1: Apple Developer アカウントの設定

1. https://developer.apple.com/programs/ で登録
2. Apple Developer Program に加入 ($99/年)
3. App Store Connect でアプリを新規登録

#### ステップ2: Xcode で署名設定

```bash
cd mobile
open ios/Runner.xcworkspace
```

**Xcode での設定:**

1. プロジェクトナビゲータで **Runner** を選択
2. **Signing & Capabilities** タブを開く
3. **Team** で Apple Developer アカウントを選択
4. **Bundle Identifier** を設定 (例: `com.yourcompany.triprize`)
5. **Automatically manage signing** にチェック

#### ステップ3: Release ビルドの実行

```bash
cd mobile

# iOS Release ビルド
flutter build ios --release
```

#### ステップ4: Archive と App Store Connect へのアップロード

**Xcode での操作:**

1. メニューから **Product → Archive** を選択
2. Archive が完了するまで待機 (10-20分程度)
3. **Window → Organizer** を開く
4. 作成された Archive を選択
5. **Distribute App** をクリック
6. **App Store Connect** を選択
7. 証明書とプロビジョニングプロファイルを確認
8. **Upload** をクリック

#### ステップ5: App Store Connect での申請

1. **App Store Connect** にアクセス: https://appstoreconnect.apple.com
2. アプリを選択
3. **App Store** タブで新しいバージョンを追加
4. **ビルド** セクションでアップロードしたビルドを選択
5. **スクリーンショット** をアップロード (必須):
   - 6.7インチ (iPhone 15 Pro Max) - 最低3枚
   - 6.5インチ (iPhone 14 Plus) - 最低3枚
6. **説明文** と **キーワード** を日本語で記入
7. **プライバシーポリシー URL** を設定
8. **審査用情報** を記入
9. **審査に提出**

**スクリーンショット推奨サイズ:**
- iPhone 6.7": 1290 x 2796 pixels
- iPhone 6.5": 1284 x 2778 pixels

**審査期間:** 通常 1-2 日

---

## 🔧 トラブルシューティング

### 1. Docker 関連

**エラー: `Cannot connect to the Docker daemon`**
```bash
# 解決方法: Docker Desktop を起動
# Windows: スタートメニューから "Docker Desktop" を起動
# Mac: アプリケーションから "Docker" を起動
```

**エラー: コンテナが起動しない**
```bash
# コンテナを再起動
docker-compose down
docker-compose up -d postgres redis

# ログを確認
docker-compose logs postgres
docker-compose logs redis
```

### 2. データベースマイグレーション関連

**エラー: `column "firebase_uid" does not exist`**

このエラーは最新のマイグレーションファイルで修正済みです。以下を実行:
```bash
cd api
npm run migrate
```

### 3. Flutter 関連

**エラー: Lint エラーが発生**
```bash
cd mobile
flutter analyze
# エラー内容を確認して修正
```

**エラー: ビルドが遅い**
- 初回ビルドは 2-3 分かかります (正常)
- 2回目以降は数秒で完了します

**エラー: Chrome が自動で開かない**
```bash
# 手動でブラウザを開く
# http://localhost:8888 にアクセス
```

### 4. CORS エラー

**エラー: `Not allowed by CORS`**

API サーバーの CORS 設定は localhost の全ポートを許可しています。
エラーが発生する場合は API サーバーを再起動:

```bash
cd api
# Ctrl+C で停止
npm run dev
```

### 5. API 接続エラー

**エラー: `Network error` または `Connection refused`**

原因チェックリスト:
1. API サーバーが起動しているか確認: http://localhost:3000/health
2. `mobile/.env` の `API_BASE_URL=http://localhost:3000` を確認
3. Docker コンテナが起動しているか確認: `docker-compose ps`

---

## 📝 環境変数設定

### API (.env)

主要な設定項目:
```env
NODE_ENV=development
PORT=3000
DATABASE_URL=postgresql://triprize:triprize_password@localhost:5432/triprize
REDIS_URL=redis://localhost:6379
STRIPE_SECRET_KEY=sk_test_xxx (本番では sk_live_xxx)
STRIPE_PUBLISHABLE_KEY=pk_test_xxx (本番では pk_live_xxx)
```

### Mobile (.env)

主要な設定項目:
```env
API_BASE_URL=http://localhost:3000
STRIPE_PUBLISHABLE_KEY=pk_test_xxx (本番では pk_live_xxx)
ENABLE_DEBUG_LOGGING=true
```

**⚠️ 本番環境では:**
- `API_BASE_URL` を本番 API の URL に変更
- `ENABLE_DEBUG_LOGGING=false` に設定
- Stripe のテストキーを本番キーに変更

---

## 📁 プロジェクト構造と主要ファイル

### 主要ディレクトリ

#### `api/` - バックエンド API サーバー
**目的**: Node.js + Express.js で構築された REST API サーバー

**主要サブディレクトリ:**
- `src/` - ソースコード
  - `config/` - データベース、Redis、Firebase、Stripe、S3 の設定ファイル
  - `controllers/` - リクエストハンドラー（キャンペーン、抽選、決済、購入、ユーザー管理）
  - `middleware/` - 認証、エラーハンドリング、レート制限、ロールチェック、バリデーション
  - `models/` - データベースエンティティ（Campaign、Lottery、Purchase、Payment、User）
  - `routes/` - Express ルーティング定義
  - `services/` - ビジネスロジック（購入処理、抽選処理、決済処理、通知送信）
  - `utils/` - ユーティリティ（暗号化、ロガー、ポジション計算、マイグレーション）
- `migrations/` - PostgreSQL データベースマイグレーションファイル（SQL）
- `tests/` - テストコード
  - `unit/` - ユニットテスト（コントローラー、サービス、ミドルウェア、ユーティリティ）
  - `integration/` - 統合テスト（認証フロー、購入フロー、抽選フロー、決済フロー）
  - `contract/` - コントラクトテスト（Stripe API、Webhook）
- `scripts/` - ユーティリティスクリプト（ユーザーロール更新、シードデータ生成）

**主要ファイル:**
- `package.json` - Node.js 依存関係とスクリプト定義
- `tsconfig.json` - TypeScript コンパイラ設定
- `Dockerfile` - Docker イメージビルド設定
- `.eslintrc.json` - ESLint 設定（コード品質チェック）
- `jest.config.js` - Jest テストフレームワーク設定

**ビルド・実行コマンド:**
```bash
cd api
npm install          # 依存関係インストール
npm run dev          # 開発サーバー起動（ホットリロード）
npm run build        # TypeScript を JavaScript にコンパイル
npm start            # 本番サーバー起動
npm run migrate      # データベースマイグレーション実行
npm test             # 全テスト実行
npm run lint         # コード品質チェック
```

#### `mobile/` - Flutter モバイルアプリ
**目的**: iOS/Android/Web 対応のクロスプラットフォームアプリケーション

**主要サブディレクトリ:**
- `lib/` - Dart ソースコード
  - `core/` - コア機能（ネットワーク、ストレージ、依存性注入、定数、ユーティリティ）
  - `features/` - 機能別モジュール（Clean Architecture パターン）
    - `auth/` - 認証機能（Firebase Authentication）
    - `campaign/` - キャンペーン閲覧機能
    - `purchase/` - 購入機能（Stripe 決済統合）
    - `lottery/` - 抽選結果表示機能
    - `admin/` - 管理者機能（キャンペーン作成、ユーザー管理）
    - 各機能は `data/`（データ層）、`domain/`（ドメイン層）、`presentation/`（UI層）に分離
- `android/` - Android プラットフォーム固有設定
  - `app/build.gradle.kts` - Android ビルド設定
  - `app/src/main/AndroidManifest.xml` - Android マニフェスト
- `ios/` - iOS プラットフォーム固有設定
  - `Runner.xcodeproj/` - Xcode プロジェクト設定
  - `GoogleService-Info.plist` - Firebase iOS 設定
- `web/` - Web プラットフォーム固有設定
  - `index.html` - Web エントリーポイント
  - `manifest.json` - PWA マニフェスト
- `test/` - Flutter テストコード

**主要ファイル:**
- `pubspec.yaml` - Flutter 依存関係とアセット定義
- `analysis_options.yaml` - Dart アナライザー設定（コード品質チェック）
- `.env.example` - 環境変数テンプレート

**ビルド・実行コマンド:**
```bash
cd mobile
flutter pub get              # 依存関係インストール
flutter run                  # 開発モードで起動
flutter run -d chrome        # Chrome ブラウザで起動
flutter build apk --release  # Android APK ビルド
flutter build appbundle      # Android App Bundle ビルド（Google Play 用）
flutter build ios --release  # iOS リリースビルド
flutter build web --release  # Web リリースビルド
flutter analyze              # コード品質チェック
flutter test                 # テスト実行
```

#### `docs/` - プロジェクトドキュメント
**目的**: 開発、デプロイ、運用に関する詳細ドキュメント

**主要ファイル:**
- `INDEX.md` - ドキュメント索引（推奨読書順序）
- `ENVIRONMENT_SETUP.md` - 環境セットアップガイド
- `FIREBASE_CONFIGURATION.md` - Firebase 設定手順
- `MOBILE_BUILD_GUIDE.md` - モバイルアプリビルドガイド
- `PAYMENT_SETUP_GUIDE.md` - Stripe 決済設定ガイド
- `STORAGE_SOLUTION.md` - 画像ストレージ（AWS S3）設定ガイド

#### `.specify/` - 仕様書・設計ドキュメント
**目的**: 機能仕様、設計計画、タスク管理

**主要サブディレクトリ:**
- `001-triangle-lottery/` - 三角形抽選販売機能の仕様書
  - `spec.md` - 機能仕様書
  - `plan.md` - 実装計画
  - `data-model.md` - データモデル設計
  - `contracts/` - API コントラクト（OpenAPI、Firebase イベント、Stripe Webhook）
- `templates/` - ドキュメントテンプレート
- `scripts/` - PowerShell スクリプト（環境チェック、機能作成支援）

#### `tests/` - E2E テスト
**目的**: エンドツーエンドテスト（Playwright 使用）

**主要ファイル:**
- `e2e/api-business-flow.test.ts` - API ビジネスフローテスト
- `e2e/full-business-flow.spec.ts` - 完全なビジネスフローテスト

#### `.github/workflows/` - CI/CD パイプライン
**目的**: GitHub Actions による自動テスト・ビルド

**主要ファイル:**
- `ci.yml` - CI パイプライン定義
  - API テスト（PostgreSQL + Redis サービス使用）
  - モバイルアプリテスト（Flutter アナライザー、テスト実行）
  - ビルドチェック（API とモバイルアプリのビルド確認）
  - Docker イメージビルドチェック

### ルートディレクトリの主要ファイル

#### `docker-compose.yml` - Docker Compose 設定
**目的**: ローカル開発環境のコンテナ定義

**サービス:**
- `postgres` - PostgreSQL 16 データベース（ポート 5432）
- `redis` - Redis 7 キャッシュサーバー（ポート 6379）
- `api` - API サーバーコンテナ（ポート 3000、オプション）

**使用方法:**
```bash
docker-compose up -d postgres redis  # データベースと Redis を起動
docker-compose ps                     # コンテナ状態確認
docker-compose logs postgres          # ログ確認
docker-compose down                   # コンテナ停止・削除
```

#### `.env.example` - 環境変数テンプレート
**目的**: 環境変数の設定例を提供（実際の値は `.env` に設定）

#### `.gitignore` - Git 除外設定
**目的**: 機密情報、ビルド成果物、依存関係を Git から除外

**除外対象:**
- `.env` ファイル（機密情報）
- `node_modules/`（Node.js 依存関係）
- `dist/`（TypeScript コンパイル成果物）
- `build/`（Flutter ビルド成果物）
- `*.jks`（Android 署名鍵）
- `key.properties`（Android 署名設定）

#### `package.json` - ルートパッケージ設定
**目的**: モノレポ全体のスクリプト定義（現在は API とモバイルが独立）

### ビルド・リリース関連ディレクトリ

#### `dist/` - API コンパイル成果物
**目的**: TypeScript から JavaScript へのコンパイル結果（本番デプロイ用）

#### `mobile/build/` - Flutter ビルド成果物
**目的**: Flutter アプリのビルド成果物

**主要パス:**
- `mobile/build/app/outputs/bundle/release/app-release.aab` - Android App Bundle（Google Play 用）
- `mobile/build/app/outputs/flutter-apk/app-release.apk` - Android APK
- `mobile/build/web/` - Web ビルド成果物

#### `test-results/` / `test-reports/` - テスト結果
**目的**: Playwright テストの実行結果とレポート（HTML 形式）

### 業務フロー関連

#### 購入フロー
1. **ユーザー認証** (`mobile/lib/features/auth/`) → Firebase Authentication
2. **キャンペーン閲覧** (`mobile/lib/features/campaign/`) → API `/api/campaigns`
3. **ポジション選択・購入** (`mobile/lib/features/purchase/`) → API `/api/purchases`
4. **決済処理** (`mobile/lib/features/purchase/`) → Stripe SDK → API `/api/payments`
5. **Webhook 処理** (`api/src/controllers/payment.controller.ts`) → Stripe Webhook → 決済状態同期
6. **抽選実行** (`api/src/services/lottery.service.ts`) → 全ポジション販売完了時に自動実行
7. **結果通知** (`api/src/services/notification.service.ts`) → Firebase Cloud Messaging

#### 管理者フロー
1. **管理者認証** (`mobile/lib/features/auth/`) → Firebase Authentication（admin ロール）
2. **キャンペーン作成** (`mobile/lib/features/admin/presentation/pages/create_campaign_page.dart`) → API `/api/campaigns`
3. **ユーザー管理** (`mobile/lib/features/admin/presentation/pages/user_management_page.dart`) → API `/api/users`
4. **統計確認** (`mobile/lib/features/admin/presentation/pages/admin_dashboard_page.dart`) → API `/api/campaigns/:id/stats`

---

## 📄 ライセンス

このプロジェクトは MIT ライセンスの下でライセンスされています。

---

## 📧 サポート

問題が発生した場合は、GitHub Issues でレポートしてください。
