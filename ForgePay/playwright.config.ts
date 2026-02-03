import { defineConfig, devices } from '@playwright/test'

/**
 * Playwright configuration for ForgePay E2E tests.
 * 
 * Prerequisites:
 * - Backend running on http://localhost:3000
 * - Dashboard running on http://localhost:3001
 * - Test developer created (run: node scripts/setup-test-developer.js)
 * 
 * Run tests: npx playwright test
 * Run with UI: npx playwright test --ui
 * Run specific test: npx playwright test admin-login
 */
export default defineConfig({
  testDir: './src/__tests__/e2e/playwright',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
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

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
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
