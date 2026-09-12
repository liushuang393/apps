/**
 * [GLOSSARY-001] 管理者は用語 CRUD、従業員は 403
 */
import { expect, test } from "@playwright/test";

import {
  createGlossaryTerm,
  deleteGlossaryTerm,
  listGlossaryTerms,
} from "../helpers/api";
import { loginAsRole } from "../helpers/auth";
import { goto } from "../helpers/navigation";

test.describe("[GLOSSARY-001] 用語集権限", () => {
  test("[GLOSSARY-001] employee API denied, admin UI create", async ({
    page,
  }) => {
    const employee = await loginAsRole(page, "user");
    const denied = await listGlossaryTerms(employee.token);
    expect(denied.status).toBe(403);

    const { token } = await loginAsRole(page, "admin");
    await goto(page, "/admin/glossary");
    await expect(page.getByTestId("glossary-page")).toBeVisible();

    const sourceTerm = `承認フロー ${Date.now().toString(36)}`;
    await page.getByTestId("glossary-add").click();
    await page.getByTestId("glossary-source-input").fill(sourceTerm);
    await expect(page.getByTestId("glossary-save")).toBeDisabled();
    await page.getByTestId("glossary-target-input").fill("approval flow");
    await expect(page.getByTestId("glossary-save")).toBeEnabled();
    await page.getByTestId("glossary-save").click();

    await expect(page.getByText(sourceTerm, { exact: false })).toBeVisible({
      timeout: 15_000,
    });

    const listed = await listGlossaryTerms(token);
    expect(listed.status).toBe(200);
    const created = listed.data?.find((row) => row.source_term === sourceTerm);
    expect(created).toBeTruthy();
    if (created) {
      const removed = await deleteGlossaryTerm(token, created.id);
      expect([200, 204]).toContain(removed.status);
    }
  });

  test("[GLOSSARY-001] employee create API → 403", async ({ page }) => {
    const { token } = await loginAsRole(page, "user");
    const created = await createGlossaryTerm(token, {
      source_language: "ja",
      target_language: "en",
      source_term: "forbidden",
      target_term: "forbidden",
    });
    expect(created.status).toBe(403);
  });
});
