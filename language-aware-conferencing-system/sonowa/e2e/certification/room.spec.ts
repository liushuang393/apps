/** 専用DBで会議室を作成し、画面と公開APIの両方で永続化を観測する。 */
import { expect, test } from "@playwright/test";

interface AuthStorage {
  state: { token: string };
}

interface RoomList {
  rooms: Array<{ name: string }>;
}

test.use({ storageState: "e2e/certification/.auth/user.json" });

test("[CERT-ROOM-CREATE] 会議室作成が画面とAPIへ反映される", async ({ page }) => {
  const roomName = "Certification Room";
  await page.goto("/rooms");
  await expect(page.getByTestId("room-list-page")).toBeVisible();
  await page.getByTestId("room-create-open").click();
  const form = page.getByTestId("room-create-form");
  await expect(form).toBeVisible();
  await form.locator('input[type="text"]').first().fill(roomName);
  await page.getByTestId("room-create-submit").click();
  await expect(page).toHaveURL(/\/room\/[^/]+/);
  await expect(page.locator("header h1")).toContainText(roomName);
  await page.goto("/rooms");
  await expect(page.getByText(roomName, { exact: true })).toBeVisible();
  const token = await page.evaluate(() => {
    const raw = localStorage.getItem("sonowa-auth");
    if (!raw) throw new Error("real login storage is missing");
    const auth: AuthStorage = JSON.parse(raw);
    return auth.state.token;
  });
  const response = await page.request.get("http://127.0.0.1:18090/api/rooms", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const payload: RoomList = await response.json();
  await test.step("[TK-EVIDENCE:CERT-ROOM-CREATE]", async () => {
    expect(payload.rooms.filter((room) => room.name === roomName)).toHaveLength(1);
  });
});
