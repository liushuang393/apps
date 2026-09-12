/**
 * Sonowa E2E 認証 helper（JWT Bearer / zustand persist）
 *
 * 流れ:
 *   1. POST {API}/api/auth/login → { access_token, user }
 *   2. page.goto(baseURL) 後に localStorage `sonowa-auth` へ zustand persist 形で書き込み
 *   3. 以降の UI は isAuthenticated=true として PrivateRoute を通過
 *
 * 注意:
 *   - auth bypass / stub token は導入しない
 *   - register は常に role=user。admin は env 資格、または Docker postgres で昇格して再ログインする
 *   - 秘密値（password / token）はログに出さない
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";

import type { Page } from "@playwright/test";

import { resolveAppE2ERoot } from "./app-root";
import { API_BASE_URL, FRONTEND_BASE_URL } from "./navigation";

/** フロント User 型と揃えた永続化用ユーザー */
export interface SonowaUser {
  id: string;
  email: string;
  displayName: string;
  nativeLanguage: string;
  role: "admin" | "moderator" | "user";
  isActive: boolean;
}

/** バックエンド User 応答（snake_case） */
interface UserApiResponse {
  id: string;
  email: string;
  display_name: string;
  native_language: string;
  role?: string;
  is_active?: boolean;
}

interface AuthApiResponse {
  access_token: string;
  user: UserApiResponse;
}

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface RegisterInput extends LoginCredentials {
  displayName: string;
  nativeLanguage?: string;
}

/** API User → フロント User */
export function mapApiUser(u: UserApiResponse): SonowaUser {
  const role = (u.role || "user") as SonowaUser["role"];
  return {
    id: u.id,
    email: u.email,
    displayName: u.display_name,
    nativeLanguage: u.native_language,
    role: role === "admin" || role === "moderator" ? role : "user",
    isActive: u.is_active ?? true,
  };
}

/** zustand persist 形式の sonowa-auth ペイロードを組み立てる */
export function buildSonowaAuthStorage(
  token: string,
  user: SonowaUser,
): { state: { token: string; user: SonowaUser; isAuthenticated: true }; version: 0 } {
  return {
    state: {
      token,
      user,
      isAuthenticated: true,
    },
    version: 0,
  };
}

function apiBase(): string {
  return (process.env.E2E_API_BASE_URL ?? API_BASE_URL).replace(/\/$/, "");
}

function baseUrl(): string {
  return (process.env.E2E_BASE_URL ?? FRONTEND_BASE_URL).replace(/\/$/, "");
}

function runId(): string {
  return process.env.E2E_RUN_ID ?? `r${Date.now().toString(36)}`;
}

/**
 * 並列 worker でも衝突しない一意サフィックス。
 * TEST_PARALLEL_INDEX は Playwright が付与。無い場合は時刻＋乱数。
 */
function uniqueSuffix(): string {
  const worker =
    process.env.TEST_PARALLEL_INDEX ??
    process.env.TEST_WORKER_INDEX ??
    "0";
  const rand = Math.random().toString(36).slice(2, 10);
  return `${runId()}.w${worker}.${Date.now().toString(36)}.${rand}`;
}

/**
 * E2E 用ユーザー定義。
 * email は runId + worker + 乱数で一意化し、共有 DB / 並列実行の衝突を避ける。
 */
export const E2E_USERS = {
  user: {
    role: "user" as const,
    email: () => `e2e.user.${uniqueSuffix()}@example.com`,
    password: () => process.env.E2E_USER_PASSWORD ?? "E2eUserPass123!",
    displayName: () => `E2E User ${uniqueSuffix()}`,
  },
  admin: {
    role: "admin" as const,
    /** register では admin になれない。既存 admin を env で渡す */
    email: () => process.env.E2E_ADMIN_EMAIL ?? "",
    password: () => process.env.E2E_ADMIN_PASSWORD ?? "",
    displayName: () => "E2E Admin",
  },
} as const;

export type E2EUserRole = keyof typeof E2E_USERS;

/** admin 資格情報が揃っているか */
export function hasAdminCredentials(): boolean {
  return Boolean(
    process.env.E2E_ADMIN_EMAIL?.trim() && process.env.E2E_ADMIN_PASSWORD?.trim(),
  );
}

/**
 * 管理者ロールのテスト可否を判定する。
 * env が無くても Docker postgres で昇格できるため、通常は null。
 */
export function adminSkipReason(): string | null {
  return null;
}

function repoRoot(): string {
  return path.resolve(resolveAppE2ERoot(), "..");
}

/**
 * 登録済みユーザーを DB 上で admin に昇格する。
 * JWT には古い role が残るため、呼び出し後に再ログインすること。
 */
export function promoteEmailToAdmin(email: string): void {
  const escaped = email.replace(/'/g, "''");
  const sql = `UPDATE users SET role = 'admin' WHERE email = '${escaped}';`;
  const args = [
    "compose",
    "exec",
    "-T",
    "postgres",
    "psql",
    "-U",
    "sonowa",
    "-d",
    "sonowa",
    "-v",
    "ON_ERROR_STOP=1",
    "-c",
    sql,
  ];
  let result = spawnSync("docker", args, {
    cwd: repoRoot(),
    encoding: "utf-8",
  });
  if (result.status !== 0) {
    const quoted = args.map((part) => `'${part.replace(/'/g, "''")}'`).join(" ");
    result = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-Command", `docker ${quoted}`],
      { cwd: repoRoot(), encoding: "utf-8" },
    );
  }
  if (result.status !== 0) {
    throw new Error(
      `[sonowa/auth] admin 昇格に失敗しました (docker compose exec postgres). exit=${result.status}`,
    );
  }
}

/**
 * 新規ユーザーを登録し、DB で admin にして再ログインする。
 * 秘密（password / token）は返却値のみ。ログ禁止。
 */
export async function registerPromotedAdmin(): Promise<{
  token: string;
  user: SonowaUser;
  credentials: LoginCredentials;
}> {
  const credentials = {
    email: E2E_USERS.user.email(),
    password: E2E_USERS.user.password(),
  };
  await registerUser({
    email: credentials.email,
    password: credentials.password,
    displayName: `E2E Admin ${uniqueSuffix()}`,
  });
  promoteEmailToAdmin(credentials.email);
  const { token, user } = await loginViaApi(credentials);
  if (user.role !== "admin") {
    throw new Error("[sonowa/auth] 昇格後の再ログインでも role=admin になりません");
  }
  return { token, user, credentials };
}

/** ログイン API を呼び、トークンとユーザーを返す（秘密は返却値のみ、ログ禁止） */
export async function loginViaApi(
  credentials: LoginCredentials,
): Promise<{ token: string; user: SonowaUser }> {
  const res = await fetch(`${apiBase()}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: credentials.email,
      password: credentials.password,
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `[sonowa/auth] login failed status=${res.status} detail=${detail.slice(0, 200)}`,
    );
  }
  const body = (await res.json()) as AuthApiResponse;
  return {
    token: body.access_token,
    user: mapApiUser(body.user),
  };
}

/**
 * ユーザー登録 API（常に role=user）。
 * 既登録（400）や並列競合（500 UNIQUE）のときは login へフォールバックする。
 */
export async function registerUser(
  input: RegisterInput,
): Promise<{ token: string; user: SonowaUser }> {
  const res = await fetch(`${apiBase()}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: input.email,
      password: input.password,
      display_name: input.displayName,
      native_language: input.nativeLanguage ?? "ja",
    }),
  });
  if (res.ok) {
    const body = (await res.json()) as AuthApiResponse;
    return {
      token: body.access_token,
      user: mapApiUser(body.user),
    };
  }

  const detail = await res.text().catch(() => "");
  const already =
    res.status === 400 ||
    (res.status === 500 && /unique|already|既に登録/i.test(detail));
  if (already) {
    return loginViaApi({ email: input.email, password: input.password });
  }
  throw new Error(
    `[sonowa/auth] register failed status=${res.status} detail=${detail.slice(0, 200)}`,
  );
}

/**
 * page に JWT を注入して認証済み状態にする。
 *
 * 入力: email / password
 * 出力: なし（localStorage 更新 + /menu へ遷移可能な状態）
 */
export async function loginAs(
  page: Page,
  credentials: LoginCredentials,
): Promise<{ token: string; user: SonowaUser }> {
  const { token, user } = await loginViaApi(credentials);
  const payload = buildSonowaAuthStorage(token, user);

  await page.goto(baseUrl() + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate((raw) => {
    localStorage.setItem("sonowa-auth", JSON.stringify(raw));
  }, payload);

  return { token, user };
}

/**
 * ロールに応じた資格情報で loginAs する。
 * admin で env 未設定なら throw（呼び出し側で test.skip 推奨）。
 */
export async function loginAsRole(
  page: Page,
  role: E2EUserRole = "user",
): Promise<{ token: string; user: SonowaUser }> {
  if (role === "admin") {
    if (hasAdminCredentials()) {
      return loginAs(page, {
        email: E2E_USERS.admin.email(),
        password: E2E_USERS.admin.password(),
      });
    }
    const promoted = await registerPromotedAdmin();
    return loginAs(page, promoted.credentials);
  }

  // user: 毎回 register してから login（共有 DB で seed 不要）
  const email = E2E_USERS.user.email();
  const password = E2E_USERS.user.password();
  await registerUser({
    email,
    password,
    displayName: E2E_USERS.user.displayName(),
  });
  return loginAs(page, { email, password });
}
