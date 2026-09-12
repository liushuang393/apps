/**
 * [HISTORY-001] 部屋作成だけでは履歴に出ない（participant 未記録）
 */
import { expect, test } from "@playwright/test";

import { createRoom, getHistory } from "../helpers/api";
import { loginAsRole } from "../helpers/auth";
import { goto } from "../helpers/navigation";

test.describe("[HISTORY-001] 利用履歴の範囲", () => {
  test("[HISTORY-001] create room without join → empty history", async ({
    page,
  }) => {
    const { token } = await loginAsRole(page, "user");
    const roomName = `E2E Hist ${Date.now().toString(36)}`;
    const created = await createRoom(token, { name: roomName });
    expect([200, 201]).toContain(created.status);
    expect(created.data?.id).toBeTruthy();

    await goto(page, "/history");
    await expect(page.getByTestId("history-page")).toBeVisible();
    await expect(page.getByTestId("history-empty")).toBeVisible();
    await expect(page.getByText(roomName)).toHaveCount(0);

    const history = await getHistory(token);
    expect(history.status).toBe(200);
    expect(history.data?.some((row) => row.room_name === roomName)).toBe(false);
  });
});
