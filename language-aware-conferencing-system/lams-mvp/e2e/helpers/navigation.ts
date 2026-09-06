/**
 * LAMS MVP ナビゲーション helper
 */
import type { Page } from "@playwright/test";

const FRONTEND_PORT = process.env.E2E_FRONTEND_PORT ?? "5273";
export const FRONTEND_BASE_URL =
  process.env.E2E_BASE_URL ?? `http://127.0.0.1:${FRONTEND_PORT}`;
// ポート解決順: E2E_API_BASE_URL > E2E_API_PORT（playwright.config と共有）> 既定 8090。
// playwright.config.ts が E2E_API_PORT で webServer を起動するのに spec 側がここで
// 既定固定だと「別ポート接続→誤 401/誤 PASS」のサイレント不整合が起きるため一致させる。
const API_PORT = process.env.E2E_API_PORT ?? "8090";
export const API_BASE_URL =
  process.env.E2E_API_BASE_URL ?? `http://127.0.0.1:${API_PORT}`;

export async function goto(page: Page, route = "/"): Promise<void> {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  await page.goto(`${FRONTEND_BASE_URL}${normalized}`, {
    waitUntil: "domcontentloaded",
  });
}

export async function gotoApi(page: Page, route: string): Promise<void> {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  await page.goto(`${API_BASE_URL}${normalized}`);
}
