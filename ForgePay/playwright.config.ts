import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright E2E テスト設定
 * 
 * 前提条件:
 * - バックエンド起動中 (http://localhost:3000)
 * - Dashboard起動中 (http://localhost:3001)
 * - テスト開発者作成済み (node scripts/setup-test-developer.js)
 * 
 * 実行方法:
 *   npx playwright test           # 全テスト実行
 *   npx playwright test --ui      # UIモード
 *   npx playwright test admin-login  # 特定テストのみ
 */
export default defineConfig({
  testDir: './src/__tests__/e2e/playwright',
  
  // 1つのテストが失敗したら即座に全体を停止
  // これにより、共通エラー（認証失敗等）で全テスト失敗を防ぐ
  maxFailures: 1,
  
  fullyParallel: false,  // 順次実行で問題を特定しやすく
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,  // 1ワーカーで順次実行
  
  // タイムアウト設定
  timeout: 30000,  // 各テスト30秒
  expect: {
    timeout: 5000,  // アサーション5秒
  },
  
  reporter: [
    ['list'],
    ['html', { outputFolder: 'playwright-report' }],
  ],
  use: {
    baseURL: 'http://localhost:3001',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  // デフォルトはChromiumのみ（高速化のため）
  // 全ブラウザテスト: npx playwright test --project=all
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    // 以下は必要に応じて有効化
    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],

  /* Run backend and dashboard before tests */
  webServer: [
    {
      command: 'npm run dev',
      url: 'http://localhost:3000/health',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
    {
      command: 'cd dashboard && npm run dev',
      url: 'http://localhost:3001',
      reuseExistingServer: !process.env.CI,
      timeout: 120000,
    },
  ],
})
