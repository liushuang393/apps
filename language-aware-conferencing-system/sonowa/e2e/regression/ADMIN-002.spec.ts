/**
 * [ADMIN-002] 管理者ログイン後に権限が見え、管理画面を横断できる
 */
import { expect, test } from "@playwright/test";

import {
  getAiPipelineSettings,
  getLanguageSettings,
  listAdminUsers,
  listExperiments,
  listGlossaryTerms,
} from "../helpers/api";
import { E2E_USERS, loginAsRole, registerUser } from "../helpers/auth";
import { goto } from "../helpers/navigation";

test.describe("[ADMIN-002] 管理者画面", () => {
  test("[ADMIN-002] admin badge and admin screens", async ({ page }) => {
    const employee = {
      email: E2E_USERS.user.email(),
      password: E2E_USERS.user.password(),
      displayName: E2E_USERS.user.displayName(),
    };
    await registerUser(employee);

    const { token, user } = await loginAsRole(page, "admin");
    expect(user.role).toBe("admin");

    await goto(page, "/menu");
    await expect(page.getByTestId("menu-page")).toBeVisible();
    const roleBadge = page.getByTestId("menu-user-role");
    await expect(roleBadge).toHaveAttribute("data-role", "admin");
    await expect(roleBadge).toHaveText("管理者");
    await expect(page.getByTestId("menu-item-admin")).toBeVisible();
    await expect(page.getByTestId("menu-item-admin-languages")).toBeVisible();
    await expect(page.getByTestId("menu-item-admin-ai-pipeline")).toBeVisible();
    await expect(page.getByTestId("menu-item-admin-experiments")).toBeVisible();
    await expect(page.getByTestId("menu-item-admin-glossary")).toBeVisible();

    await goto(page, "/admin");
    await expect(page.getByTestId("admin-page")).toBeVisible();
    await expect(page.getByTestId("admin-user-role")).toHaveAttribute(
      "data-role",
      "admin",
    );
    await page.getByTestId(`admin-edit-${employee.email}`).click();
    await expect(page.getByTestId("admin-user-edit-modal")).toBeVisible();
    await expect(page.getByTestId("admin-user-native-language")).toBeVisible();
    await page.locator(".btn-secondary").click();

    await goto(page, "/admin/languages");
    await expect(page.getByTestId("language-settings-page")).toBeVisible();

    await goto(page, "/admin/ai-pipeline");
    await expect(page.getByTestId("ai-pipeline-page")).toBeVisible();

    await goto(page, "/admin/experiments");
    await expect(page.getByTestId("experiments-page")).toBeVisible();

    await goto(page, "/admin/glossary");
    await expect(page.getByTestId("glossary-page")).toBeVisible();

    const users = await listAdminUsers(token);
    expect(users.status).toBe(200);
    expect(users.data?.some((row) => row.email === employee.email)).toBe(true);

    const languages = await getLanguageSettings(token);
    expect(languages.status).toBe(200);

    const pipeline = await getAiPipelineSettings(token);
    expect(pipeline.status).toBe(200);

    const experiments = await listExperiments(token);
    expect([200, 403]).toContain(experiments.status);

    const glossary = await listGlossaryTerms(token);
    expect(glossary.status).toBe(200);
  });
});
