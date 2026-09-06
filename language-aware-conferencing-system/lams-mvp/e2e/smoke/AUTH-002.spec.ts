/**
 * [AUTH-002] 未認証で /rooms にアクセスすると /login へリダイレクト
 */
import { expect, test } from "@playwright/test";

import { goto } from "../helpers/navigation";

test.describe("[AUTH-002] 未認証ガード", () => {
  test("[AUTH-002] /rooms → /login", async ({ page }) => {
    await page.context().clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("lams-auth"));

    await goto(page, "/rooms");

    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(page.locator("#login-email")).toBeVisible();
    await expect(page.locator("#login-password")).toBeVisible();
  });
});
