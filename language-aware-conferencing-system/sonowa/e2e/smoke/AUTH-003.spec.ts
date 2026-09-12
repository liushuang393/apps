/**
 * [AUTH-003] 未認証で新規画面へ行くと /login へ戻る
 */
import { expect, test } from "@playwright/test";

import { goto } from "../helpers/navigation";

test.describe("[AUTH-003] 未認証ガード（プロフィール / 履歴 / 用語集）", () => {
  test("[AUTH-003] /profile /history /admin/glossary → /login", async ({
    page,
  }) => {
    await page.context().clearCookies();
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate(() => localStorage.removeItem("sonowa-auth"));

    for (const path of ["/profile", "/history", "/admin/glossary"]) {
      await goto(page, path);
      await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
      await expect(page.getByTestId("login-email")).toBeVisible();
    }
  });
});
