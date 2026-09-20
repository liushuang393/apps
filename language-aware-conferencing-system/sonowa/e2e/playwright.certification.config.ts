/** 専用Dockerランタイム向け。DB復元は認証ランナーが所有する。 */
import { defineConfig, devices } from "@playwright/test";
import path from "node:path";

const evidenceReport = process.env.E2E_EVIDENCE_STEPS_FILE;
const kitRoot = process.env.TESTING_KIT_ROOT;
if (evidenceReport && !kitRoot) {
  throw new Error("TESTING_KIT_ROOT is required for evidence reporting");
}
const evidenceReporter = evidenceReport && kitRoot
  ? path.join(kitRoot, "capabilities/playwright-skill/lib/evidence-reporter.js")
  : undefined;

export default defineConfig({
  metadata: {
    testingKitRunNonce: process.env.E2E_RUN_NONCE ?? "",
    testingKitRunNumber: process.env.E2E_RUN_NUMBER ?? "",
    testingKitConfigSha256: process.env.E2E_CONFIG_SHA256 ?? "",
    testingKitSpecManifestSha256: process.env.E2E_SPEC_MANIFEST_SHA256 ?? "",
  },
  testDir: "./certification",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: "./test-results/certification",
  forbidOnly: true,
  timeout: 30_000,
  reporter: [
    ["list"],
    ...(evidenceReporter ? [[evidenceReporter] as [string]] : []),
    ["json", { outputFile: process.env.E2E_RESULTS_FILE ?? "report/certification-results.json" }],
  ],
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "http://127.0.0.1:15273",
    locale: "ja-JP",
    timezoneId: "Asia/Tokyo",
    screenshot: "on",
    trace: "retain-on-failure",
  },
});
