/**
 * [AUTH-004] 起動時のトークン検証: 401 だけログアウトし、一時障害ではセッションを保持する
 */
import { expect, test } from "@playwright/test";

import { loginAsRole } from "../helpers/auth";
import { goto } from "../helpers/navigation";

const ME_ROUTE = "**/api/auth/me";

test.describe("[AUTH-004] 起動時トークン検証", () => {
  test("[AUTH-004] 503 keeps session, 401 logs out", async ({ page }) => {
    await loginAsRole(page, "user");

    // backend 再起動中などの一時障害ではログイン状態を保つ
    await page.route(ME_ROUTE, (route) =>
      route.fulfill({ status: 503, body: "{}" }),
    );
    await goto(page, "/menu");
    await expect(page.getByTestId("menu-page")).toBeVisible();

    // 無効トークン（401）ではログイン画面へ戻す
    await page.unroute(ME_ROUTE);
    await page.route(ME_ROUTE, (route) =>
      route.fulfill({ status: 401, body: '{"detail":"invalid"}' }),
    );
    await goto(page, "/menu");
    await expect(page).toHaveURL(/\/login/, { timeout: 15_000 });
  });
});
