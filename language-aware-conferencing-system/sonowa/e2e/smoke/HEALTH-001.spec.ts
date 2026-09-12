/**
 * [HEALTH-001] backend GET /health が ok を返す
 */
import { expect, test } from "@playwright/test";

import { API_BASE_URL } from "../helpers/navigation";

test.describe("[HEALTH-001] API health", () => {
  test("[HEALTH-001] GET /health returns ok", async ({ request }) => {
    const api = (process.env.E2E_API_BASE_URL ?? API_BASE_URL).replace(
      /\/$/,
      "",
    );
    const res = await request.get(`${api}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json().catch(async () => ({ raw: await res.text() }));
    if (body && typeof body === "object" && "status" in body) {
      expect(String((body as { status: unknown }).status).toLowerCase()).toMatch(
        /ok|healthy|up/,
      );
    } else {
      // status フィールドが無い実装でも 200 を成功とする
      expect(res.ok()).toBe(true);
    }
  });
});
