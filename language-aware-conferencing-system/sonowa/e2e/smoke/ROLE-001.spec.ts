/**
 * [ROLE-001] ログイン後に従業員権限が見え、管理者メニューは出ない
 */
import { expect, test } from "@playwright/test";

import { getMe, listAdminUsers } from "../helpers/api";
import { loginAsRole } from "../helpers/auth";
import { goto } from "../helpers/navigation";

test.describe("[ROLE-001] 従業員の権限表示", () => {
  test("[ROLE-001] menu shows employee role and hides admin items", async ({
    page,
  }) => {
    const { token, user } = await loginAsRole(page, "user");
    expect(user.role).toBe("user");

    await goto(page, "/menu");
    await expect(page.getByTestId("menu-page")).toBeVisible();
    const roleBadge = page.getByTestId("menu-user-role");
    await expect(roleBadge).toBeVisible();
    await expect(roleBadge).toHaveAttribute("data-role", "user");
    await expect(roleBadge).toHaveText("従業員");

    await expect(page.getByTestId("menu-item-profile")).toBeVisible();
    await expect(page.getByTestId("menu-item-history")).toBeVisible();
    await expect(page.getByTestId("menu-item-admin")).toHaveCount(0);
    await expect(page.getByTestId("menu-item-admin-languages")).toHaveCount(0);
    await expect(page.getByTestId("menu-item-admin-ai-pipeline")).toHaveCount(0);
    await expect(page.getByTestId("menu-item-admin-experiments")).toHaveCount(0);
    await expect(page.getByTestId("menu-item-admin-glossary")).toHaveCount(0);

    await goto(page, "/admin");
    await expect(page).toHaveURL(/\/menu/, { timeout: 15_000 });
    await goto(page, "/admin/glossary");
    await expect(page).toHaveURL(/\/menu/, { timeout: 15_000 });

    const me = await getMe(token);
    expect(me.status).toBe(200);
    expect(me.data?.role).toBe("user");

    const adminUsers = await listAdminUsers(token);
    expect(adminUsers.status).toBe(403);
  });
});
