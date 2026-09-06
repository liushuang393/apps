/**
 * [ADMIN-001] 非 admin は ai-pipeline PUT が 403。admin 資格があれば GET 200。
 */
import { expect, test } from "@playwright/test";

import {
  getAiPipelineSettings,
  putAiPipelineSettings,
} from "../helpers/api";
import {
  adminSkipReason,
  loginAsRole,
  loginViaApi,
  E2E_USERS,
} from "../helpers/auth";

test.describe("[ADMIN-001] AI pipeline 権限", () => {
  test("[ADMIN-001] non-admin PUT → 403", async ({ page }) => {
    const { token } = await loginAsRole(page, "user");
    const denied = await putAiPipelineSettings(token, {
      default_mode: "hybrid",
    });
    expect(denied.status).toBe(403);
  });

  test("[ADMIN-001] admin GET settings → 200 (optional)", async () => {
    const reason = adminSkipReason();
    test.skip(reason !== null, reason ?? "admin env missing");

    const { token } = await loginViaApi({
      email: E2E_USERS.admin.email(),
      password: E2E_USERS.admin.password(),
    });
    const res = await getAiPipelineSettings(token);
    expect(res.status).toBe(200);
    expect(res.data).toBeTruthy();
  });
});
