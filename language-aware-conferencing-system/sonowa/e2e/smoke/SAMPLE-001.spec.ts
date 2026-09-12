/**
 * [SAMPLE-001] フロントエンド / の起動疎通
 *
 * 業務シナリオではなく、existing-server の frontend 到達確認。
 */
import { expect, test } from "@playwright/test";

import { goto } from "../helpers/navigation";
import { freezeTime } from "../helpers/visual";

test.describe("[SAMPLE-001] frontend / 疎通", () => {
  test.beforeEach(async ({ page }) => {
    await freezeTime(page);
  });

  test("[SAMPLE-001] frontend root responds", async ({ page }) => {
    await goto(page, "/");
    const body = page.locator("body");
    await expect(body).toBeVisible({ timeout: 15_000 });
    await expect(async () => {
      const count = await body.evaluate((el) => el.children.length);
      expect(count).toBeGreaterThan(0);
    }).toPass({ timeout: 30_000, intervals: [500, 1000, 2000, 4000] });
  });
});
