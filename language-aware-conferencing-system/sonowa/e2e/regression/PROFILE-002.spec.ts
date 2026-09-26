/**
 * [PROFILE-002] ログイン中の本人がプロフィール画面でパスワードを変更できる
 */
import { expect, test } from "@playwright/test";

import { E2E_USERS, loginAs, loginViaApi, registerUser } from "../helpers/auth";
import { goto } from "../helpers/navigation";

test.describe("[PROFILE-002] パスワード変更", () => {
  test("[PROFILE-002] wrong current password is rejected, correct one changes it", async ({
    page,
  }) => {
    const member = {
      email: E2E_USERS.user.email(),
      password: E2E_USERS.user.password(),
      displayName: E2E_USERS.user.displayName(),
    };
    await registerUser(member);
    await loginAs(page, member);
    await goto(page, "/profile");
    const form = page.getByTestId("password-change-form");
    await expect(form).toBeVisible();

    const newPassword = "Changed-Pass-456!";
    await form.locator("#current-password").fill("not-my-password");
    await form.locator("#profile-new-password").fill(newPassword);
    await form.locator("#profile-confirm-password").fill(newPassword);
    await page.getByTestId("password-change-submit").click();
    await expect(page.getByTestId("password-change-error")).toContainText(
      "現在のパスワード",
    );

    await form.locator("#current-password").fill(member.password);
    await page.getByTestId("password-change-submit").click();
    await expect(page.getByTestId("password-change-success")).toBeVisible();

    await expect(loginViaApi({ email: member.email, password: newPassword })).resolves.toBeTruthy();
    await expect(loginViaApi(member)).rejects.toThrow(/401|login failed/);
  });
});
