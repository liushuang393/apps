/**
 * docs/manual.html 用のスクリーンショットを実画面から取得する。
 *
 * 入力: 起動済みの Sonowa（frontend / backend）
 * 出力: docs/manual/assets/*.png
 * 注意: デモ用アカウントで実際にログインして撮影する。秘密情報は出力しない。
 *
 * 使い方:
 *   node scripts/capture_manual_screenshots.mjs
 *   MANUAL_BASE_URL=http://127.0.0.1:5273 MANUAL_API_URL=http://127.0.0.1:8090 node ...
 */
import { chromium } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const BASE = (process.env.MANUAL_BASE_URL ?? "http://127.0.0.1:5273").replace(/\/$/, "");
const API = (process.env.MANUAL_API_URL ?? "http://127.0.0.1:8090").replace(/\/$/, "");
const OUT = path.resolve("docs/manual/assets");

// デモ用アカウント（本番資格情報ではない）
const DEMO_PASSWORD = process.env.MANUAL_DEMO_PASSWORD ?? "SonowaDemo123!";
const DEMO_USER = process.env.MANUAL_DEMO_USER ?? "tanaka@sonowa.example";
const DEMO_ADMIN = process.env.MANUAL_DEMO_ADMIN ?? "admin@sonowa.example";

/** ログインして token と user を得る */
async function login(email) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password: DEMO_PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${email} (${res.status})`);
  const body = await res.json();
  return {
    token: body.access_token,
    user: {
      id: body.user.id,
      email: body.user.email,
      displayName: body.user.display_name,
      nativeLanguage: body.user.native_language,
      role: body.user.role ?? "user",
      isActive: body.user.is_active ?? true,
    },
  };
}

/** zustand persist 形式で認証状態を注入する */
async function authenticate(page, session) {
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
  await page.evaluate((raw) => {
    localStorage.setItem("sonowa-auth", JSON.stringify(raw));
  }, { state: { ...session, isAuthenticated: true }, version: 0 });
}

/** 1 画面撮影する。settle はレンダリング待ちの追加ミリ秒 */
async function shot(page, route, name, settle = 1200) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(settle);
  await page.screenshot({ path: path.join(OUT, `${name}.png`) });
  console.log(`captured ${name}  <- ${route}`);
}

async function main() {
  await mkdir(OUT, { recursive: true });

  const browser = await chromium.launch({
    args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    locale: "ja-JP",
    permissions: ["microphone"],
  });
  const page = await context.newPage();

  // --- 未ログイン画面
  await shot(page, "/login", "01-login");
  await shot(page, "/register", "02-register");
  await shot(page, "/forgot-password", "03-forgot-password");
  await shot(page, "/reset-password?token=demo-token", "04-reset-password");

  // --- 参加者画面
  const user = await login(DEMO_USER);
  await authenticate(page, user);
  await shot(page, "/menu", "05-menu");
  await shot(page, "/rooms", "06-rooms");

  const rooms = await (
    await fetch(`${API}/api/rooms`, { headers: { Authorization: `Bearer ${user.token}` } })
  ).json();
  const roomList = Array.isArray(rooms) ? rooms : (rooms.rooms ?? rooms.items ?? []);
  const room =
    roomList.find((r) => String(r.name ?? "").includes("週次定例")) ?? roomList[0];
  if (room) {
    // 撮影環境からは LAN IP の LiveKit に届かないことがあるため、
    // トークン応答の server_url だけをループバックへ書き換える（撮影時限定）。
    if (process.env.MANUAL_LIVEKIT_LOOPBACK !== "0") {
      await page.route("**/api/rooms/*/token", async (route) => {
        const response = await route.fetch();
        const body = await response.json();
        if (typeof body.server_url === "string") {
          body.server_url = body.server_url.replace(/\/\/[^:/]+:/, "//127.0.0.1:");
        }
        await route.fulfill({ response, json: body });
      });
    }

    // LiveKit 接続完了（設定パネルの「接続中...」が消える）まで待ってから撮る
    await page.goto(`${BASE}/room/${room.id}`, { waitUntil: "domcontentloaded" });
    await page
      .locator("text=接続中...")
      .waitFor({ state: "detached", timeout: 30000 })
      .catch(() => console.warn("接続完了を待てなかったため接続中の状態で撮影する"));
    await page.waitForTimeout(2000);
    await page.screenshot({ path: path.join(OUT, "07-room.png") });
    console.log("captured 07-room");
    await shot(page, `/room/${room.id}/transcript`, "08-transcript", 2000);
  } else {
    console.warn("デモ会議室が見つからないため 07/08 をスキップ");
  }

  // --- 管理者画面
  const admin = await login(DEMO_ADMIN);
  await authenticate(page, admin);
  await shot(page, "/menu", "09-menu-admin");
  await shot(page, "/admin", "10-admin");
  await shot(page, "/admin/languages", "11-admin-languages");
  await shot(page, "/admin/ai-pipeline", "12-admin-ai-pipeline", 2000);
  await shot(page, "/admin/experiments", "13-admin-experiments", 2000);

  await browser.close();
  console.log(`\n出力先: ${OUT}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
