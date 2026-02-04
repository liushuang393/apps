# ForgePay テストガイド

## 📋 テスト前の準備チェックリスト

### 必要なソフトウェア
| ソフトウェア | 最低バージョン | 確認コマンド | ダウンロード |
|-------------|---------------|-------------|-------------|
| Node.js | 18.0+ | `node --version` | https://nodejs.org/ |
| Docker Desktop | - | `docker --version` | https://www.docker.com/products/docker-desktop |
| Git | - | `git --version` | https://git-scm.com/ |

### オプション（Stripeテスト用）
| ソフトウェア | 用途 | ダウンロード |
|-------------|------|-------------|
| Stripe CLI | Webhookローカルテスト | https://stripe.com/docs/stripe-cli |

---

## 🚀 クイックスタート

### 方法1: PowerShellスクリプト（推奨）

```powershell
# 1. 環境チェック
.\scripts\env-checker.ps1

# 2. 環境準備
.\scripts\test-runner.ps1 -Setup

# 3. 単体テスト実行
.\scripts\test-runner.ps1 -Unit

# 4. E2Eテスト実行
.\scripts\test-runner.ps1 -E2E

# 5. 全テスト実行
.\scripts\test-runner.ps1
```

### 方法2: バッチスクリプト

```batch
:: 1. 環境チェック
scripts\test.bat check

:: 2. 環境準備
scripts\test.bat setup

:: 3. 単体テスト実行
scripts\test.bat unit

:: 4. E2Eテスト実行
scripts\test.bat e2e
```

### 方法3: 手動実行

```bash
# 1. Dockerサービス起動
npm run docker:up

# 2. サービス起動待ち（約5-10秒）

# 3. データベースマイグレーション
npm run migrate:up

# 4. テストデータ設定
node scripts/setup-test-developer.js

# 5. 単体テスト実行
npm run test:coverage

# 6. サーバー起動（別ターミナル）
npm run dev

# 7. E2E APIテスト実行（別ターミナル）
npm run test:e2e:api
```

---

## 📊 テスト種類の説明

### 1. 単体テスト (Unit Tests)
- **場所:** `src/__tests__/unit/`
- **コマンド:** `npm run test:coverage`
- **カバレッジ目標:** 90%以上
- **レポート場所:** `coverage/lcov-report/index.html`

```bash
# 全単体テスト実行
npm test

# カバレッジ付き実行
npm run test:coverage

# ウォッチモード（開発時）
npm run test:watch

# 特定ファイルのみ実行
npm test -- --testPathPattern="CheckoutService"
```

### 2. 結合テスト (Integration Tests)
- **場所:** `src/__tests__/integration/`
- **特徴:** サービス間の連携をテスト
- **要件:** データベース起動が必要

### 3. E2E APIテスト
- **場所:** `src/__tests__/e2e/`
- **コマンド:** `npm run test:e2e:api`
- **要件:** バックエンドサーバー起動が必要

```bash
# ターミナル1: サーバー起動
npm run dev

# ターミナル2: E2Eテスト実行
npm run test:e2e:api
```

### 4. Playwright UIテスト
- **場所:** `src/__tests__/e2e/playwright/`
- **コマンド:** `npm run test:e2e`
- **要件:** バックエンド + Dashboard両方の起動が必要

```bash
# ターミナル1: バックエンド起動
npm run dev

# ターミナル2: Dashboard起動
cd dashboard && npm run dev

# ターミナル3: Playwrightテスト実行
npm run test:e2e

# UIモード（視覚的デバッグ）
npm run test:e2e:ui

# ヘッドありモード（ブラウザ操作が見える）
npm run test:e2e:headed

# デバッグモード
npm run test:e2e:debug
```

---

## 🔧 よく使うテストコマンド

| コマンド | 説明 |
|---------|------|
| `npm test` | 全単体テスト実行 |
| `npm run test:coverage` | テスト実行 + カバレッジレポート生成 |
| `npm run test:watch` | ウォッチモード（ファイル変更で自動再実行） |
| `npm run test:e2e:api` | E2E APIテスト実行 |
| `npm run test:e2e` | Playwright UIテスト実行 |
| `npm run test:e2e:ui` | Playwright UIモード（視覚化） |
| `npm run test:e2e:headed` | Playwright ヘッドありモード |
| `npm run test:e2e:debug` | Playwright デバッグモード |
| `npm run test:e2e:report` | Playwrightテストレポート表示 |

---

## 🗂️ テストディレクトリ構造

```
src/__tests__/
├── unit/                    # 単体テスト（2,400件以上）
│   ├── services/           # サービス層テスト
│   │   ├── CheckoutService.test.ts
│   │   ├── CouponService.test.ts
│   │   └── ... (16サービス)
│   ├── repositories/       # データアクセス層テスト
│   │   ├── CustomerRepository.test.ts
│   │   └── ... (11リポジトリ)
│   ├── routes/             # ルート/コントローラーテスト
│   │   ├── checkout.test.ts
│   │   └── ... (12ルート)
│   ├── middleware/         # ミドルウェアテスト
│   ├── config/             # 設定テスト
│   └── utils/              # ユーティリティテスト
├── integration/            # 結合テスト
│   ├── services.integration.test.ts
│   └── *.integration.test.ts
└── e2e/                    # エンドツーエンドテスト
    ├── payment-flow.e2e.test.ts  # API E2E (Jest)
    └── playwright/               # UI E2E (Playwright)
        ├── admin-login.spec.ts
        ├── admin-dashboard.spec.ts
        ├── portal-login.spec.ts
        └── ... (9シナリオ)
```

---

## ⚙️ 環境設定

### .envファイルの重要な設定

```env
# テストモード
NODE_ENV=development
STRIPE_MODE=test

# データベース
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forgepaybridge

# Redis
REDIS_URL=redis://localhost:6379

# Stripeテストキー（設定済み）
STRIPE_TEST_SECRET_KEY=sk_test_...
STRIPE_TEST_PUBLISHABLE_KEY=pk_test_...
STRIPE_TEST_WEBHOOK_SECRET=whsec_...

# E2Eテスト
ENABLE_E2E_TESTS=true
TEST_API_KEY=fpb_test_...  # setup-test-developer.jsで生成

# Dashboard URL（Playwright用）
DASHBOARD_URL=http://localhost:3001
```

---

## 🔍 よくある問題と解決方法

### Q1: Dockerサービスが起動しない
```powershell
# Dockerが起動しているか確認
docker info

# サービス再起動
docker-compose down
docker-compose up -d postgres redis

# ログ確認
docker-compose logs postgres
docker-compose logs redis
```

### Q2: データベース接続エラー
```powershell
# PostgreSQLの起動確認
docker exec forgepaybridge-postgres pg_isready -U postgres

# 手動接続テスト
docker exec -it forgepaybridge-postgres psql -U postgres -d forgepaybridge
```

### Q3: テストAPIキーが無効
```powershell
# テストAPIキーを再生成
node scripts/setup-test-developer.js

# .envのTEST_API_KEY値を確認
```

### Q4: Playwrightテストが失敗
```powershell
# Playwrightブラウザをインストール
npx playwright install

# デバッグモードで問題を確認
npm run test:e2e:debug
```

### Q5: ポートが使用中
```powershell
# ポート使用状況確認（Windows）
netstat -ano | findstr :3000
netstat -ano | findstr :3001

# プロセス終了
taskkill /PID <PID> /F
```

---

## 📈 テストレポートの確認

### 単体テストカバレッジレポート
```powershell
# レポート生成
npm run test:coverage

# HTMLレポートを開く（Windows）
start coverage\lcov-report\index.html
```

### Playwrightテストレポート
```powershell
# テスト実行後にレポート表示
npm run test:e2e:report

# または直接開く
start playwright-report\index.html
```

---

## 🎯 テストカバレッジ目標

| カテゴリ | 現在のカバレッジ | 目標 |
|---------|-----------------|------|
| ステートメント | 99.18% ✅ | 95% |
| ブランチ | 96.12% ✅ | 95% |
| 関数 | 99.65% ✅ | 95% |
| 行 | 99.17% ✅ | 95% |

> カバレッジ閾値は `jest.config.js` で設定されています。

---

## 📞 テストコマンド早見表

```powershell
# === 環境準備 ===
npm run docker:up          # Dockerサービス起動
npm run migrate:up         # データベースマイグレーション
node scripts/setup-test-developer.js  # テストデータ作成

# === 単体テスト ===
npm test                   # テスト実行
npm run test:coverage      # カバレッジ付き
npm run test:watch         # ウォッチモード

# === E2Eテスト ===
npm run dev                # バックエンド起動（ターミナル1）
npm run test:e2e:api       # API E2E（ターミナル2）

# === Playwright ===
cd dashboard && npm run dev  # フロントエンド起動（ターミナル2）
npm run test:e2e           # Playwright実行
npm run test:e2e:ui        # UIモード
npm run test:e2e:headed    # ヘッドありモード

# === クリーンアップ ===
npm run docker:down        # Docker停止
```

---

## 🛠️ 環境チェックスクリプト

環境が正しく設定されているか確認するには：

```powershell
# 環境チェック
.\scripts\env-checker.ps1

# 自動修復付き
.\scripts\env-checker.ps1 -Fix
```

このスクリプトは以下を確認します：
- Node.js、npm、Dockerのインストール状態
- Dockerサービスの起動状態
- データベース接続
- 必要な設定ファイルの存在

---

## 📁 テストスクリプト構成

```
scripts/
├── test.config.json      # 設定ファイル（他プロジェクトで編集）
├── test-runner.ps1       # メインテストランナー
├── env-checker.ps1       # 環境チェック・自動修復
├── test.bat              # Windowsバッチラッパー
├── templates/            # 新プロジェクト用テンプレート
│   └── jest.config.js    # → ルートにコピー
└── README.md             # 詳細ドキュメント
```

詳細は `scripts/README.md` を参照してください。
