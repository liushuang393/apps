/**
 * [PROFILE-001] プロフィール保存後に表示名と JWT が更新される
 */
import { expect, test } from "@playwright/test";

import { getMe } from "../helpers/api";
import { loginAsRole } from "../helpers/auth";
import { goto } from "../helpers/navigation";

test.describe("[PROFILE-001] プロフィール自己更新", () => {
  test("[PROFILE-001] save display name updates menu + /me", async ({
    page,
  }) => {
    const { token } = await loginAsRole(page, "user");
    await goto(page, "/profile");
    await expect(page.getByTestId("profile-page")).toBeVisible();
    await expect(page.getByTestId("profile-role")).toHaveValue("従業員");

    const nextName = `E2E Profile ${Date.now().toString(36)}`;
    await page.getByTestId("profile-display-name").fill(nextName);
    await page.getByTestId("profile-save").click();
    await expect(page.getByTestId("profile-success")).toBeVisible();

    await goto(page, "/menu");
    await expect(page.getByTestId("menu-user-name")).toHaveText(nextName);
    await expect(page.getByTestId("menu-user-role")).toHaveText("従業員");

    const me = await getMe(token);
    expect(me.status).toBe(200);
    // 旧 JWT でも /me は現行 DB を返す
    expect(me.data?.display_name).toBe(nextName);
  });
});
