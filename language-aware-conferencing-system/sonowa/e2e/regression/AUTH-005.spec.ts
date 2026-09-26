/**
 * [AUTH-005] パスワードを忘れた利用者が再設定できる
 *
 * メール送信が無いため、本人は「パスワードを忘れた」からその場で再設定画面へ進める。
 * 管理者が発行した再設定リンクでも、トークンが自動入力されて再設定できる。
 */
import { expect, test } from "@playwright/test";

import { E2E_USERS, loginAsRole, loginViaApi, registerUser } from "../helpers/auth";
import { goto } from "../helpers/navigation";

test.describe("[AUTH-005] パスワード再設定", () => {
  test("[AUTH-005] admin reset link prefills token and new password works", async ({
    page,
    browser,
  }) => {
    const member = {
      email: E2E_USERS.user.email(),
      password: E2E_USERS.user.password(),
      displayName: E2E_USERS.user.displayName(),
    };
    await registerUser(member);

    // 管理者が本人の再設定リンクを発行する。
    await loginAsRole(page, "admin");
    await goto(page, "/admin");
    await page.getByTestId(`admin-edit-${member.email}`).click();
    await page.getByTestId("admin-issue-reset-link").click();
    const link = await page.getByTestId("admin-reset-link").inputValue();
    expect(link).toMatch(/\/reset-password\?token=/);

    // 本人が別ブラウザでリンクを開くと、トークンが入力済みになっている。
    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    const memberPage = await memberContext.newPage();
    const url = new URL(link);
    await goto(memberPage, `${url.pathname}${url.search}`);
    const token = new URL(link).searchParams.get("token") ?? "";
    await expect(memberPage.locator("#reset-token")).toHaveValue(token);

    const newPassword = "Renewed-Pass-123!";
    await memberPage.locator("#new-password").fill(newPassword);
    await memberPage.locator("#confirm-password").fill(newPassword);
    await memberPage.locator("form button[type=submit]").click();
    await expect(memberPage.locator(".success-message")).toBeVisible({ timeout: 15_000 });

    // 新しいパスワードでログインでき、古いパスワードは使えない。
    await expect(loginViaApi({ email: member.email, password: newPassword })).resolves.toBeTruthy();
    await expect(loginViaApi(member)).rejects.toThrow(/401|login failed/);
    await memberContext.close();
  });

  test("[AUTH-005] forgot password lets the user reset it on the spot", async ({ page }) => {
    const member = {
      email: E2E_USERS.user.email(),
      password: E2E_USERS.user.password(),
      displayName: E2E_USERS.user.displayName(),
    };
    await registerUser(member);

    // 未登録のアドレスは、その場でエラーとして伝える。
    await goto(page, "/forgot-password");
    await page.locator("#forgot-email").fill(`missing.${Date.now()}@example.com`);
    await page.locator("form button[type=submit]").click();
    await expect(page.locator(".error")).toContainText("登録されていません");

    // 登録済みなら、トークン入力済みの再設定画面へそのまま進み、新しいパスワードを設定できる。
    await page.locator("#forgot-email").fill(member.email);
    await page.locator("form button[type=submit]").click();
    await expect(page).toHaveURL(/\/reset-password\?token=/);
    await expect(page.locator("#reset-token")).not.toHaveValue("");

    const newPassword = "Forgot-Reset-789!";
    await page.locator("#new-password").fill(newPassword);
    await page.locator("#confirm-password").fill(newPassword);
    await page.locator("form button[type=submit]").click();
    await expect(page.locator(".success-message")).toBeVisible({ timeout: 15_000 });
    await expect(loginViaApi({ email: member.email, password: newPassword })).resolves.toBeTruthy();
  });
});
