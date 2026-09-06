/**
 * [AUTH-001] ユーザー登録 → メニュー表示
 *
 * 期待: register API + JWT 注入後、/menu でメニュー UI が見える。
 */
import { expect, test } from "@playwright/test";

import {
  E2E_USERS,
  buildLamsAuthStorage,
  registerUser,
} from "../helpers/auth";
import { goto } from "../helpers/navigation";

test.describe("[AUTH-001] 登録後メニュー表示", () => {
  test("[AUTH-001] register → menu visible", async ({ page }) => {
    const email = E2E_USERS.user.email();
    const password = E2E_USERS.user.password();
    const { token, user } = await registerUser({
      email,
      password,
      displayName: E2E_USERS.user.displayName(),
    });

    expect(token.length).toBeGreaterThan(10);
    expect(user.role).toBe("user");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page.evaluate((raw) => {
      localStorage.setItem("lams-auth", JSON.stringify(raw));
    }, buildLamsAuthStorage(token, user));

    await goto(page, "/menu");

    const menu = page.getByTestId("menu-page");
    if (await menu.count()) {
      await expect(menu).toBeVisible({ timeout: 15_000 });
    } else {
      // data-testid が無い環境向けフォールバック
      await expect(page.locator(".menu-page")).toBeVisible({ timeout: 15_000 });
    }

    await expect(page.getByTestId("menu-item-rooms").or(page.locator('a[href="/rooms"]'))).toBeVisible();
    await expect(page.getByTestId("menu-logout").or(page.locator(".btn-logout"))).toBeVisible();
  });
});
