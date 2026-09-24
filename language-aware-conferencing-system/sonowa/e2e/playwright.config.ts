/**
 * Sonowa MVP E2E Playwright 設定
 * （testing-kit/bin/init-app.py で生成、adapter=python-react-fastapi）
 *
 * 注: __dirname や import.meta.url に依存せず、CJS/ESM 両対応に
 *     相対パスは playwright が config dir 基準で解釈する
 */
import { defineConfig, devices } from "@playwright/test";
import { resolveRuntimeProfile } from "./helpers/runtime-profile";

const frontendPort = Number(process.env.E2E_FRONTEND_PORT ?? "5273");
const apiPort = Number(process.env.E2E_API_PORT ?? "8090");
const baseURL =
  process.env.E2E_BASE_URL ?? `http://127.0.0.1:${frontendPort}`;
const apiBaseURL =
  process.env.E2E_API_BASE_URL ?? `http://127.0.0.1:${apiPort}`;
const shouldStartServer = process.env.E2E_START_SERVER === "1";
const runtimeProfile = resolveRuntimeProfile({ legacyStartServer: shouldStartServer });
// 証拠 capture（成功時も残す）: 既定は失敗時のみ。env で opt-in する
// - E2E_SCREENSHOT_ON_PASS=1 : 全テストで screenshot + video を保存
// - E2E_TRACE_ON_PASS=1      : 全テストで trace を保存（network request/response 込み）
const screenshotOnPass = process.env.E2E_SCREENSHOT_ON_PASS === "1";
const traceOnPass = process.env.E2E_TRACE_ON_PASS === "1";

export default defineConfig({
  testDir: ".",
  // DB 再現性保証: 全テスト前後で baseline snapshot を取って復元
  globalSetup: runtimeProfile.runGlobalSetup ? "./global-setup.ts" : undefined,
  globalTeardown: runtimeProfile.runGlobalSetup ? "./global-teardown.ts" : undefined,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  // JSON reporter は CI 既定 on。ローカルでも E2E_JSON_REPORT=1 で opt-in できる
  // （summarize_failures.py が playwright-report/results.json を最優先入力にする）。
  reporter:
    process.env.CI || process.env.E2E_JSON_REPORT === "1"
      ? [
          ["list"],
          ["html", { outputFolder: "playwright-report", open: "never" }],
          ["json", { outputFile: "playwright-report/results.json" }],
        ]
      : "list",
  // ============================================================
  // 決定性設定: 2 回目以降の実行で結果が変わらないように環境を固定
  // ============================================================
  use: {
    baseURL,
    // 本番構成は社内 LAN 向け自己署名証明書のため、HTTPS 入口ではその検証だけを外す。
    ignoreHTTPSErrors: baseURL.startsWith("https://"),
    trace: traceOnPass ? "on" : "on-first-retry",
    screenshot: screenshotOnPass ? "on" : "only-on-failure",
    video: screenshotOnPass ? "on" : "retain-on-failure",
    viewport: { width: 1280, height: 720 },
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    colorScheme: "light",
    reducedMotion: "reduce",
    deviceScaleFactor: 1,
    extraHTTPHeaders: {
      "x-e2e-app": "sonowa",
    },
  },
  expect: {
    // Real Docker flows often include auth proxies and first-page API hydration.
    timeout: 15_000,
    toHaveScreenshot: {
      maxDiffPixels: 100,
      animations: "disabled",
      caret: "hide",
    },
    toMatchSnapshot: {
      maxDiffPixelRatio: 0.01,
    },
  },
  projects: [
    {
      name: "smoke",
      testDir: "./smoke",
      use: { ...devices["Desktop Chrome"] },
      timeout: 30_000,
    },
    {
      name: "regression",
      testDir: "./regression",
      use: { ...devices["Desktop Chrome"] },
      timeout: 60_000,
    },
    {
      // 実ブラウザ2台の会議（擬似マイク・GPU・本番相当スタックが必要）。明示指定時のみ実行する。
      name: "meeting",
      testDir: "./meeting",
      use: { ...devices["Desktop Chrome"] },
      timeout: 300_000,
    },
    {
      name: "visual",
      testDir: "./visual",
      use: { ...devices["Desktop Chrome"] },
      timeout: 60_000,
    },
  ],
  webServer: runtimeProfile.startServer
    ? {
        cwd: "../frontend",
        command: "npm run dev",
        port: frontendPort,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        env: {
          E2E_API_BASE_URL: apiBaseURL,
          E2E_API_PORT: String(apiPort),
          E2E_FRONTEND_PORT: String(frontendPort),
        },
      }
    : undefined,
});
