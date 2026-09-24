/**
 * [AUTH-005] パスワードを忘れた利用者を、管理者の再設定リンクで復旧できる
 *
 * 本番はメール送信が無い。管理者が再設定リンクを発行し、本人がリンクを開くと
 * トークンが自動入力され、新しいパスワードでログインできる。
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

  test("[AUTH-005] forgot page without mail tells user to ask admin", async ({ page }) => {
    await goto(page, "/forgot-password");
    await page.locator("#forgot-email").fill(E2E_USERS.user.email());
    await page.locator("form button[type=submit]").click();
    // 開発環境ではトークン付きリンク、本番では管理者への依頼案内のどちらかが出る。
    await expect(
      page.getByTestId("reset-password-link").or(page.getByTestId("reset-ask-admin")),
    ).toBeVisible({ timeout: 15_000 });
  });
});
