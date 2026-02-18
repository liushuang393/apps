import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';

// .env を読み込み（globalSetup 前に環境変数を準備）
dotenv.config({ path: path.resolve(__dirname, '.env') });

/**
 * ForgePay E2E テスト設定
 *
 * 完全自動化:
 * - globalSetup  → テスト開発者を自動登録（冪等）
 * - globalTeardown → テストデータを自動クリーンアップ
 * - webServer    → バックエンド + ダッシュボードを自動起動
 *
 * ビジネスフロー100%カバレッジ:
 * - 開発者登録・API キー認証
 * - 商品・価格管理
 * - チェックアウトセッション作成
 * - Entitlement 検証
 * - Webhook 監視
 * - 監査ログ
 * - Dashboard UI 全画面
 */
export default defineConfig({
  testDir: './src/__tests__/e2e/playwright',

  // グローバルセットアップ・ティアダウン（テスト開発者の自動管理）
  globalSetup: './src/__tests__/e2e/playwright/global-setup.ts',
  globalTeardown: './src/__tests__/e2e/playwright/global-teardown.ts',

  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  timeout: 60000,

  // レポーター設定（HTML + JUnit + 標準出力）
  reporter: [
    ['html', { open: 'never', outputFolder: 'test-results/html-report' }],
    ['junit', { outputFile: 'test-results/junit-results.xml' }],
    ['list'],
  ],

  use: {
    baseURL: process.env.DASHBOARD_URL || 'http://localhost:3001',
    trace: 'on-first-retry',

    // ビデオ録画設定
    video: {
      mode: 'on',
      size: { width: 1280, height: 720 },
    },

    // スクリーンショット設定（失敗時 + 手動）
    screenshot: 'on',

    // ブラウザ設定
    viewport: { width: 1280, height: 720 },
    actionTimeout: 15000,
    navigationTimeout: 30000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // テスト結果の出力先
  outputDir: 'test-results/artifacts',

  // バックエンド + ダッシュボードのサーバー起動設定
  webServer: [
    {
      command: 'npm run dev',
      port: 3000,
      timeout: 30000,
      reuseExistingServer: true,
      env: {
        NODE_ENV: 'test',
      },
    },
    {
      command: 'npm run dev',
      port: 3001,
      timeout: 30000,
      reuseExistingServer: true,
      cwd: './dashboard',
    },
  ],
});
