# 汎用テストフレームワーク (Reusable Test Framework)

設定ファイル駆動の汎用テストフレームワーク。  
`test.config.json` を編集するだけで他のプロジェクトで再利用可能。

---

## クイックスタート

```powershell
# 環境チェック
.\scripts\env-checker.ps1

# 環境チェック + 自動修復
.\scripts\env-checker.ps1 -Fix

# 全テスト実行
.\scripts\test-runner.ps1

# 単体テストのみ
.\scripts\test-runner.ps1 -Unit

# E2E API テストのみ
.\scripts\test-runner.ps1 -E2E

# Playwright UI テストのみ
.\scripts\test-runner.ps1 -Playwright
```

または batch ファイルを使用:

```cmd
scripts\test.bat check      :: 環境チェック
scripts\test.bat setup      :: 環境セットアップ
scripts\test.bat unit       :: 単体テスト
scripts\test.bat e2e        :: E2E API テスト
scripts\test.bat playwright :: Playwright テスト
scripts\test.bat            :: 全テスト
```

---

## ファイル構成

```
scripts/
├── test.config.json       # 設定ファイル（プロジェクト固有の設定）
├── test-runner.ps1        # メインテストランナー
├── env-checker.ps1        # 環境チェック・自動修復
├── test.bat               # Windows バッチラッパー
├── README.md              # このファイル
│
├── templates/             # 新プロジェクト用テンプレート
│   └── jest.config.js     # → ルートにコピー
│
├── setup-test-developer.js # テスト開発者作成（プロジェクト固有）
├── run-e2e-tests.js        # E2E テスト実行（プロジェクト固有）
├── verify-setup.ts         # インフラ検証（プロジェクト固有）
└── start-dev.ps1           # 開発環境起動（プロジェクト固有）
```

---

## 新プロジェクトで使用する手順

### Step 1: ファイルをコピー

```powershell
# 新プロジェクトのディレクトリを作成
mkdir <新プロジェクト>/scripts

# 汎用スクリプトをコピー（5ファイル）
Copy-Item scripts/test.config.json   <新プロジェクト>/scripts/
Copy-Item scripts/test-runner.ps1    <新プロジェクト>/scripts/
Copy-Item scripts/env-checker.ps1    <新プロジェクト>/scripts/
Copy-Item scripts/test.bat           <新プロジェクト>/scripts/
Copy-Item scripts/README.md          <新プロジェクト>/scripts/

# テンプレートフォルダをコピー
Copy-Item -Recurse scripts/templates <新プロジェクト>/scripts/
```

### Step 2: テンプレートファイルをルートに移動

```powershell
# jest.config.js をルートディレクトリにコピー
Copy-Item <新プロジェクト>/scripts/templates/jest.config.js <新プロジェクト>/

# 必要に応じて内容を編集
```

### Step 3: `test.config.json` を編集

プロジェクトに合わせて以下を変更：

```json
{
  "project": {
    "name": "YourProjectName",          // ← プロジェクト名
    "description": "Your description"
  },

  "ports": {
    "backend": 3000,                    // ← バックエンドポート
    "dashboard": 3001                   // ← フロントエンドポート
  },

  "docker": {
    "postgres": {
      "containerName": "your-postgres", // ← Dockerコンテナ名
      ...
    },
    "redis": {
      "containerName": "your-redis",
      ...
    }
  },

  "environment": {
    "requiredPatterns": {
      "testApiKey": "TEST_API_KEY=your_prefix_",  // ← APIキーパターン
      ...
    }
  },

  "scripts": {
    "testUnit": "npm run test:coverage",          // ← テストコマンド
    "testE2eApi": "npm run test:e2e",
    ...
  }
}
```

### Step 4: 動作確認

```powershell
cd <新プロジェクト>

# 環境チェック
.\scripts\env-checker.ps1

# テスト実行
.\scripts\test-runner.ps1 -Unit
```

---

## 設定項目一覧

### project
| キー | 説明 | 例 |
|------|------|-----|
| `name` | プロジェクト名 | `"MyApp"` |
| `description` | プロジェクトの説明 | `"Payment API"` |

### requirements
| キー | 説明 | 例 |
|------|------|-----|
| `nodeVersion` | 必要な Node.js バージョン | `18` |
| `dockerRequired` | Docker が必要か | `true` |

### ports
| キー | 説明 | 例 |
|------|------|-----|
| `backend` | バックエンドのポート | `3000` |
| `dashboard` | フロントエンドのポート | `3001` |

### endpoints
| キー | 説明 | 例 |
|------|------|-----|
| `health` | ヘルスチェックパス | `"/health"` |
| `backendBase` | バックエンドURL | `"http://localhost:3000"` |
| `dashboardBase` | フロントエンドURL | `"http://localhost:3001"` |

### docker
| キー | 説明 | 例 |
|------|------|-----|
| `postgres.containerName` | PostgreSQL コンテナ名 | `"myapp-postgres"` |
| `redis.containerName` | Redis コンテナ名 | `"myapp-redis"` |
| `composeServices` | 起動するサービス | `"postgres redis"` |

### paths
| キー | 説明 | 例 |
|------|------|-----|
| `nodeModules` | node_modules | `"node_modules"` |
| `dashboardModules` | Dashboard の node_modules | `"dashboard/node_modules"` |
| `coverageReport` | カバレッジレポート | `"coverage/lcov-report/index.html"` |

### scripts
| キー | 説明 | 例 |
|------|------|-----|
| `install` | npm インストール | `"npm install"` |
| `migrate` | マイグレーション | `"npm run migrate:up"` |
| `dev` | 開発サーバー起動 | `"npm run dev"` |
| `testUnit` | 単体テスト | `"npm run test:coverage"` |
| `testE2eApi` | E2E API テスト | `"npm run test:e2e:api"` |
| `testPlaywright` | Playwright テスト | `"npx playwright test"` |

### coverage
| キー | 説明 | 例 |
|------|------|-----|
| `thresholds.statements` | ステートメント閾値 | `95` |
| `thresholds.branches` | ブランチ閾値 | `95` |
| `thresholds.functions` | 関数閾値 | `95` |
| `thresholds.lines` | 行閾値 | `95` |

### timeouts
| キー | 説明 | 例 |
|------|------|-----|
| `dockerStartup` | Docker起動待機（秒） | `30` |
| `serverStartup` | サーバー起動待機（秒） | `30` |

### messages
| キー | 説明 |
|------|------|
| `ja.*` | 日本語メッセージ |
| `en.*` | 英語メッセージ |

---

## 多言語対応

```powershell
# 日本語（デフォルト）
.\scripts\test-runner.ps1

# 英語
.\scripts\test-runner.ps1 -Lang en
```

---

## トラブルシューティング

### PowerShell 実行ポリシーエラー

```powershell
# 管理者として実行
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### Docker が起動しない

```powershell
# 既存コンテナを削除して再起動
docker-compose down
docker-compose up -d postgres redis
```

### ポートが使用中

```powershell
# プロセスを確認
netstat -ano | findstr :3000

# プロセスを終了
taskkill /PID <PID> /F
```

---

## プロジェクト固有スクリプト

以下のファイルはプロジェクト固有のため、必要に応じて参考・修正してください：

| ファイル | 用途 |
|----------|------|
| `setup-test-developer.js` | テスト用開発者アカウント作成、APIキー自動設定 |
| `run-e2e-tests.js` | E2Eテスト実行、環境変数設定 |
| `verify-setup.ts` | DB, Redis, Stripe 接続検証 |
| `start-dev.ps1` | 開発環境一括起動（Docker, Backend, Dashboard） |
