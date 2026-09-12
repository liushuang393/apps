/**
 * [PREF-001] 会議室ページで preference / connection-status 要素が存在する
 *
 * LiveKit 未起動時は接続エラーになり得るため、理由付きで soft-skip する。
 */
import { expect, test } from "@playwright/test";

import { createRoom } from "../helpers/api";
import { loginAsRole } from "../helpers/auth";
import { goto } from "../helpers/navigation";

test.describe("[PREF-001] preference panel", () => {
  test("[PREF-001] room page shows preference / connection UI", async ({
    page,
  }) => {
    const { token } = await loginAsRole(page, "user");
    const created = await createRoom(token, {
      name: `E2E Pref ${Date.now().toString(36)}`,
    });
    expect([200, 201]).toContain(created.status);
    const roomId = created.data?.id;
    expect(roomId).toBeTruthy();

    await goto(page, `/room/${roomId}`);

    const roomPage = page.getByTestId("room-page");
    await expect(roomPage).toBeVisible({ timeout: 20_000 });

    const connection = page.getByTestId("connection-status");
    await expect(connection).toBeVisible({ timeout: 15_000 });

    // preference-panel は myPreference 初期化後に出る。LiveKit 失敗時はエラー文言で soft-skip
    const preference = page.getByTestId("preference-panel");
    const fatal = page.locator('.error[role="alert"]');
    const deadline = Date.now() + 25_000;
    let seenPreference = false;
    while (Date.now() < deadline) {
      if (await preference.count()) {
        seenPreference = true;
        break;
      }
      const errText = ((await fatal.textContent()) ?? "").trim();
      if (errText && /livekit|token|接続|websocket|failed|発行/i.test(errText)) {
        test.skip(
          true,
          `LiveKit / 入室トークンが利用できないため preference 断言を soft-skip: ${errText.slice(0, 120)}`,
        );
      }
      await page.waitForTimeout(500);
    }
    if (!seenPreference) {
      const errText = ((await fatal.textContent()) ?? "").trim();
      if (errText) {
        test.skip(
          true,
          `preference-panel 未表示（接続系エラー）: ${errText.slice(0, 120)}`,
        );
      }
      throw new Error("preference-panel が見つからない（connection は表示済み）");
    }
    await expect(preference).toBeVisible();
  });
});
