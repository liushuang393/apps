/**
 * [NAV-004] データ画面の API が一時失敗（502）しても読込表示で固まらない
 *
 * 目的: API を 502 に差し替えると読込表示が消えてエラーと再試行が出て、
 *       再試行で正常表示に戻ることを全データ画面で確認する。
 *       2026-09-27 の /admin/ai-pipeline 読込固着バグの回帰テスト。
 * 注意: 502 は page.route で差し替える（backend は実物）。再試行時は差し替えを外す。
 */
import { expect, test, type Page } from "@playwright/test";

import { loginAsRole } from "../helpers/auth";
import { goto } from "../helpers/navigation";

/** ja UI の読込表示（common.loading） */
const LOADING_TEXT = "読み込み中...";

/**
 * url にマッチする API を失敗させ、解除関数を返す。
 * 入力: page / URL パターン
 * 出力: 解除関数（以降のリクエストは実 backend へ通す）
 */
async function failApi(page: Page, url: string | RegExp): Promise<() => void> {
  let failing = true;
  await page.route(url, async (route) => {
    if (failing) {
      await route.fulfill({ status: 502, contentType: "text/html", body: "Bad Gateway" });
      return;
    }
    await route.fallback();
  });
  return () => {
    failing = false;
  };
}

test.describe("[NAV-004] API 失敗時の読込固着防止", () => {
  test("[NAV-004] ai-pipeline 502 → error and retry → settings form", async ({ page }) => {
    await loginAsRole(page, "admin");
    const recover = await failApi(page, "**/api/admin/settings/ai-pipeline");

    await goto(page, "/admin/ai-pipeline");
    await expect(page.getByTestId("ai-pipeline-page")).toBeVisible();
    await expect(page.getByTestId("ai-pipeline-load-error")).toBeVisible();
    await expect(page.getByText(LOADING_TEXT)).toHaveCount(0);

    recover();
    await page.getByTestId("ai-pipeline-retry").click();
    await expect(page.getByTestId("ai-pipeline-save")).toBeVisible();
    await expect(page.getByTestId("ai-pipeline-load-error")).toHaveCount(0);
  });
});
