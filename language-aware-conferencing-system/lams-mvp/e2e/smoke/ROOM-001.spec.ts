/**
 * [ROOM-001] ログイン → 会議室作成 → 一覧に表示（API 二次観測）
 *
 * 注意: UI 作成成功後は `/room/:id` へ遷移する。一覧確認は戻ってから行う。
 */
import { expect, test } from "@playwright/test";

import { listRooms } from "../helpers/api";
import { loginAsRole } from "../helpers/auth";
import { goto } from "../helpers/navigation";

test.describe("[ROOM-001] 会議室作成", () => {
  test("[ROOM-001] create room appears in list + API", async ({ page }) => {
    const { token } = await loginAsRole(page, "user");
    await goto(page, "/rooms");

    await expect(page.getByTestId("room-list-page")).toBeVisible({
      timeout: 15_000,
    });

    const roomName = `E2E Room ${Date.now().toString(36)}`;
    await page.getByTestId("room-create-open").click();
    await expect(page.getByTestId("room-create-form")).toBeVisible();

    await page
      .getByTestId("room-create-form")
      .locator('input[type="text"]')
      .first()
      .fill(roomName);
    await page.getByTestId("room-create-submit").click();

    // 作成後は会議室ページへ遷移（部屋名は API メタ or ストア）
    await expect(page).toHaveURL(/\/room\/[^/]+/, { timeout: 20_000 });
    await expect(page.getByTestId("room-page")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("connection-status")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByTestId("leave-btn")).toBeVisible();
    // roomMeta 取得後にヘッダへ部屋名が出る（LiveKit 不要）
    await expect(page.locator("header h1")).toContainText(roomName, {
      timeout: 20_000,
    });

    // 一覧へ戻して UI 観測
    await goto(page, "/rooms");
    await expect(page.getByTestId("room-list-page")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText(roomName, { exact: false })).toBeVisible({
      timeout: 20_000,
    });

    // API 二次観測
    const listed = await listRooms(token);
    expect(listed.status).toBe(200);
    expect(listed.data?.rooms.some((r) => r.name === roomName)).toBe(true);
  });
});
