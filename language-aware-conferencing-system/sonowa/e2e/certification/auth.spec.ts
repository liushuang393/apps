/** 実ログインで生成した状態を使い、画面とAPIのロール境界を照合する。 */
import { expect, test, type Page } from "@playwright/test";

const API = "http://127.0.0.1:18090";

interface AuthStorage {
  state: { token: string };
}

async function tokenFor(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("sonowa-auth");
    if (!raw) throw new Error("real login storage is missing");
    const auth: AuthStorage = JSON.parse(raw);
    if (!auth.state.token) throw new Error("real login token is missing");
    return auth.state.token;
  });
}

test.describe("実ログインした従業員", () => {
  test.use({ storageState: "e2e/certification/.auth/user.json" });
  test("[CERT-AUTH-USER] 従業員の画面と管理API拒否", async ({ page }) => {
    await page.goto("/menu");
    await expect(page.getByTestId("menu-user-role")).toHaveAttribute("data-role", "user");
    await expect(page.getByTestId("menu-item-admin")).toHaveCount(0);
    const response = await page.request.get(`${API}/api/admin/users`, {
      headers: { Authorization: `Bearer ${await tokenFor(page)}` },
    });
    await test.step("[TK-EVIDENCE:CERT-AUTH-USER]", async () => {
      expect(response.status()).toBe(403);
    });
    await page.goto("/admin/ai-pipeline");
    await expect(page).toHaveURL(/\/menu$/);
  });
});

test.describe("実ログインした管理者", () => {
  test.use({ storageState: "e2e/certification/.auth/admin.json" });
  test("[CERT-AUTH-ADMIN] 管理者の画面と完全ローカル設定", async ({ page }) => {
    await page.goto("/menu");
    await expect(page.getByTestId("menu-user-role")).toHaveAttribute("data-role", "admin");
    await expect(page.getByTestId("menu-item-admin-ai-pipeline")).toBeVisible();
    const response = await page.request.get(`${API}/api/admin/settings/ai-pipeline`, {
      headers: { Authorization: `Bearer ${await tokenFor(page)}` },
    });
    expect(response.status()).toBe(200);
    const body: { effective: Record<string, unknown> } = await response.json();
    await test.step("[TK-EVIDENCE:CERT-AUTH-ADMIN]", async () => {
      expect(body.effective).toMatchObject({ asr_provider: "local", mt_provider: "local", tts_provider: "local", llm_correction_enabled: false });
    });
    await page.getByTestId("menu-item-admin-ai-pipeline").click();
    await expect(page).toHaveURL(/\/admin\/ai-pipeline$/);
  });
});

test.describe("実ログインしたモデレーター", () => {
  test.use({ storageState: "e2e/certification/.auth/moderator.json" });
  test("[CERT-AUTH-MODERATOR] モデレーターの管理API拒否", async ({ page }) => {
    await page.goto("/menu");
    await expect(page.getByTestId("menu-user-role")).toHaveAttribute("data-role", "moderator");
    const response = await page.request.get(`${API}/api/admin/users`, {
      headers: { Authorization: `Bearer ${await tokenFor(page)}` },
    });
    await test.step("[TK-EVIDENCE:CERT-AUTH-MODERATOR]", async () => {
      expect(response.status()).toBe(403);
    });
  });
});
