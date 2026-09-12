/**
 * docs/manual.html 用のスクリーンショットを実画面から取得する。
 *
 * 入力: 起動済みの Sonowa（frontend / backend / livekit）
 * 出力: docs/manual/assets/*.png
 * 注意: デモ用アカウントで実際にログインして撮影する。秘密情報は出力しない。
 *
 * 使い方:
 *   PLAYWRIGHT_BROWSERS_PATH=... node scripts/capture_manual_screenshots.mjs
 *
 * 会議室画面を「接続済み」で撮るには LiveKit の ICE 候補がブラウザから到達可能である
 * 必要がある。WSL 等でホスト LAN IP に届かない場合は、撮影中だけ
 *   HOST_IP=127.0.0.1 docker compose up -d livekit
 * としてから実行し、終了後に `docker compose up -d livekit` で元へ戻す。
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
  await page.evaluate(
    (raw) => {
      localStorage.setItem("sonowa-auth", JSON.stringify(raw));
    },
    { state: { ...session, isAuthenticated: true }, version: 0 },
  );
}

/** 1 画面撮影する。settle はレンダリング待ちの追加ミリ秒、full はページ全体 */
async function shot(page, route, name, settle = 1200, full = false) {
  await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(settle);
  await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage: full });
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
  // 会議室一覧はテスト用の部屋も並ぶため、デモ用の 1 行目までを切り取る
  await page.goto(`${BASE}/rooms`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1200);
  await page.screenshot({
    path: path.join(OUT, "06-rooms.png"),
    clip: { x: 0, y: 0, width: 1440, height: 470 },
  });
  console.log("captured 06-rooms (デモ用の行までトリミング)");

  const rooms = await (
    await fetch(`${API}/api/rooms`, { headers: { Authorization: `Bearer ${user.token}` } })
  ).json();
  const roomList = Array.isArray(rooms) ? rooms : (rooms.rooms ?? rooms.items ?? []);
  const room =
    roomList.find((r) => String(r.name ?? "").includes("週次定例")) ?? roomList[0];

  if (room) {
    // 会議記録は先に撮る（会議室に入ると新しい会議セッションが作られ、
    // 「最新 / 進行中」が空のセッションに切り替わってしまうため）
    await page.goto(`${BASE}/room/${room.id}/transcript`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    const transcriptClip = { x: 0, y: 0, width: 1440, height: 640 };
    await page.screenshot({ path: path.join(OUT, "08-transcript.png"), clip: transcriptClip });
    console.log("captured 08-transcript");

    // 表示言語を日本語に切り替えた（翻訳表示）状態
    const langSelect = page.locator("select").first();
    if (await langSelect.count()) {
      await langSelect.selectOption({ label: "日本語" }).catch(() => {});
      await page.waitForTimeout(1200);
      await page.screenshot({
        path: path.join(OUT, "08b-transcript-translated.png"),
        clip: transcriptClip,
      });
      console.log("captured 08b-transcript-translated");
    }

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
      .waitForFunction(() => !document.body.innerText.includes("接続中..."), null, {
        timeout: 30000,
      })
      .catch(() => console.warn("接続完了を待てなかったため接続中の状態で撮影する"));
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, "07-room.png") });
    console.log("captured 07-room");

    // 設定パネル全体（マイク・音声モード・字幕・言語）が入るよう縦長で撮る
    await page.setViewportSize({ width: 1440, height: 1500 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, "07b-room-settings.png") });
    console.log("captured 07b-room-settings");

    // 翻訳音声を選んだ状態
    const translated = page.getByText("翻訳音声", { exact: true }).first();
    if (await translated.count()) {
      await translated.click();
      await page.waitForTimeout(1200);
      await page.screenshot({ path: path.join(OUT, "07c-room-translated.png") });
      console.log("captured 07c-room-translated");
    }
    await page.setViewportSize({ width: 1440, height: 900 });

  } else {
    console.warn("デモ会議室が見つからないため 07/08 をスキップ");
  }

  // --- 管理者画面
  const admin = await login(DEMO_ADMIN);
  await authenticate(page, admin);
  await shot(page, "/menu", "09-menu-admin");
  // 管理者パネルは実ユーザーの個人情報を含むため、統計＋デモ行までで切り取る
  await page.goto(`${BASE}/admin`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.screenshot({
    path: path.join(OUT, "10-admin.png"),
    clip: { x: 0, y: 0, width: 1440, height: 620 },
  });
  console.log("captured 10-admin (個人情報を含む行はトリミング)");
  await shot(page, "/admin/languages", "11-admin-languages", 1500, true);
  await shot(page, "/admin/ai-pipeline", "12-admin-ai-pipeline", 2000, true);
  await page.goto(`${BASE}/admin/experiments`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.screenshot({
    path: path.join(OUT, "13-admin-experiments.png"),
    clip: { x: 0, y: 0, width: 1440, height: 300 },
  });
  console.log("captured 13-admin-experiments");

  await browser.close();
  console.log(`\n出力先: ${OUT}`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
