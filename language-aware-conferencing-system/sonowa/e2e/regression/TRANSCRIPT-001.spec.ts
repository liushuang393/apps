/**
 * [TRANSCRIPT-001] 空記録の議事録メッセージ。離線再処理は管理者のみ
 */
import { expect, test } from "@playwright/test";

import { createRoom, getMinutes, rerunSession } from "../helpers/api";
import { loginAsRole } from "../helpers/auth";
import { goto } from "../helpers/navigation";

test.describe("[TRANSCRIPT-001] 議事録と再処理の権限", () => {
  test("[TRANSCRIPT-001] employee sees minutes, not rerun", async ({
    page,
  }) => {
    const { token } = await loginAsRole(page, "user");
    const created = await createRoom(token, {
      name: `E2E Tr ${Date.now().toString(36)}`,
    });
    expect([200, 201]).toContain(created.status);
    const roomId = created.data?.id;
    expect(roomId).toBeTruthy();

    await goto(page, `/room/${roomId}/transcript`);
    await expect(page.getByTestId("transcript-page")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByTestId("transcript-minutes-btn")).toBeVisible();
    await expect(page.getByTestId("transcript-rerun-btn")).toHaveCount(0);

    await page.getByTestId("transcript-minutes-btn").click();
    await expect(page.getByTestId("transcript-minutes-error")).toContainText(
      "会議記録が空のため議事録を生成できません",
    );

    const minutes = await getMinutes(token, roomId as string);
    expect([200, 400, 404, 503]).toContain(minutes.status);

    const deniedRerun = await rerunSession(token, "not-a-session");
    expect([401, 403, 404]).toContain(deniedRerun.status);
  });

  test("[TRANSCRIPT-001] admin sees rerun button", async ({ page }) => {
    const { token } = await loginAsRole(page, "admin");
    const created = await createRoom(token, {
      name: `E2E TrA ${Date.now().toString(36)}`,
    });
    expect([200, 201]).toContain(created.status);
    const roomId = created.data?.id;
    expect(roomId).toBeTruthy();

    await goto(page, `/room/${roomId}/transcript`);
    await expect(page.getByTestId("transcript-page")).toBeVisible({
      timeout: 20_000,
    });
    const rerun = page.getByTestId("transcript-rerun-btn");
    await expect(rerun).toBeVisible();
    await expect(rerun).toBeDisabled();
  });
});
