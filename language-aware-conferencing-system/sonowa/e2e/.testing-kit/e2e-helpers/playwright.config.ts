/**
 * testing-kit 共通 E2E helper の単体テスト用 config。
 *
 * app の E2E とは無関係で、browser も web server も起動しない。
 * 実行: npx playwright test --config testing-kit/e2e-helpers/playwright.config.ts
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  testMatch: '**/*.unit.spec.ts',
  fullyParallel: true,
  reporter: 'list',
});
