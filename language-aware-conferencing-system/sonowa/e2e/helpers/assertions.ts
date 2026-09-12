/**
 * Sonowa MVP 意味的 assertion helper
 */
import { expect, type Page } from "@playwright/test";

export async function expectScenarioCompleted(
  page: Page,
  id: string,
): Promise<void> {
  await page.evaluate((sid: string) => {
    if (typeof window !== "undefined") {
      (window as unknown as { __E2E_COMPLETED__?: string[] }).__E2E_COMPLETED__ ??=
        [];
      (
        window as unknown as { __E2E_COMPLETED__: string[] }
      ).__E2E_COMPLETED__.push(sid);
    }
  }, id);
}

export async function expectTestId(
  page: Page,
  testId: string,
  options: { visible?: boolean; text?: string | RegExp } = {},
): Promise<void> {
  const locator = page.getByTestId(testId);
  await expect(locator).toBeVisible({ timeout: 10_000 });
  if (options.text !== undefined) {
    await expect(locator).toContainText(options.text);
  }
}

export async function expectNotAccessible(
  page: Page,
  expected:
    | { redirectsTo: string | RegExp }
    | { statusCode: number },
): Promise<void> {
  if ("redirectsTo" in expected) {
    await expect(page).toHaveURL(expected.redirectsTo, { timeout: 10_000 });
    return;
  }
  const response = await page.waitForResponse(
    (resp) => resp.url().includes(page.url()),
    { timeout: 10_000 },
  );
  expect(response.status()).toBe(expected.statusCode);
}
