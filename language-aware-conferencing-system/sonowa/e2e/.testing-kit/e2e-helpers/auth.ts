/**
 * E2E 共通認証 module（auth-service 実 login）
 *
 * 本番同等経路では ES256/JWKS（iss/aud=auth）を使う。旧 HS256 self-mint
 * （iss/aud=auth-service）は accept_v1=False で拒否されるため使わない。
 * bypass / stub token は導入しない（本番同等 E2E の原則）。
 *
 * tenant_sso（tenant_claim_key=tenant_id）のため、login 時に要求テナントを渡し、
 * JWT の tenant_id と x-tenant-id を一致させる。食い違えば fail-loud で止める。
 *
 * 各 app の e2e/helpers からは createAuthClient() で app 固有の既定値を束ねて使う。
 */

import type { Page } from '@playwright/test';

/** login の既定 endpoint。auth-service の実 path。 */
const DEFAULT_LOGIN_PATH = '/auth/login';
const DEFAULT_AUTH_BASE = 'http://127.0.0.1:18010';
const DEFAULT_USERNAME = 'admin';
const DEFAULT_PASSWORD = 'admin123';

/**
 * BFF Cookie Session でログインする app 向けの設定。
 *
 * ecos_platform / faq_knowledge_chat の backend は login を auth_service へ転送し、
 * access token を伏せて HttpOnly cookie だけを返す。Bearer を localStorage へ
 * 置く経路とは別物なので、共通 module でも別の入口にする。
 */
export interface BffLoginConfig {
  /** エラーメッセージに出す app 識別子。 */
  app: string;
  /** Cookie を載せる origin。BFF を提供している側の URL。 */
  baseUrl: string;
  /** login endpoint の path。既定は /api/auth/login。 */
  loginPath?: string;
}

interface BffLoginResponseBody {
  success?: boolean;
  user?: { username?: string } | null;
  message?: string;
}

/**
 * BFF 経由で実 login し、session cookie を browser context へ載せる。
 *
 * `page.request` は browser の cookie jar を共有するため、ここで受けた
 * Set-Cookie がそのまま後続の画面遷移に効く。token は返らない（BFF が伏せる）ので
 * 呼び出し側で localStorage へ入れようとしないこと。
 */
export async function loginViaBffCookie(
  page: Pick<Page, 'request'>,
  config: BffLoginConfig,
  options: TokenOptions = {},
): Promise<void> {
  const { app } = config;
  const loginUrl = `${config.baseUrl.replace(/\/$/, '')}${config.loginPath ?? '/api/auth/login'}`;
  const seeded = options.role !== undefined ? SEED_USERS[options.role] : undefined;
  if (options.role !== undefined && !seeded) {
    throw new Error(
      `[${app}/auth] seed に無い role: ${options.role}. ` +
        'apps/common_services/auth/db/seed.py の DEFAULT_USERS と一致させること',
    );
  }
  const username = options.username ?? seeded?.username ?? DEFAULT_USERNAME;
  const password =
    options.password ??
    // 解決後の username で seed を引く。role の password を先に見ると
    // username 明示時に別ユーザーの password が付く。
    Object.values(SEED_USERS).find((user) => user.username === username)?.password ??
    seeded?.password ??
    DEFAULT_PASSWORD;

  const response = await page.request.post(loginUrl, { data: { username, password } });
  if (!response.ok()) {
    throw new Error(`[${app}/auth] login 失敗 status=${response.status()} url=${loginUrl}`);
  }
  const body = (await response.json()) as BffLoginResponseBody;
  // BFF は失敗を 200 + success:false で返すことがある。status だけでは判定できない。
  if (!body.success || !body.user) {
    throw new Error(
      `[${app}/auth] login レスポンスが success/user を含まない message=${body.message ?? ''}`,
    );
  }
}

export interface AuthClientConfig {
  /** エラーメッセージに出す app 識別子。 */
  app: string;
  /** auth-service の base URL。既定は E2E_AUTH_API_BASE_URL / E2E_AUTH_BASE_URL / 127.0.0.1:8010。 */
  baseUrl?: string;
  /** login endpoint の path。既定は /auth/login。 */
  loginPath?: string;
  /** 既定の login username。 */
  username?: string;
  /** 既定の login password。 */
  password?: string;
  /**
   * 事前発行済み Bearer token。bearerTenantId と一致する tenant の要求では
   * login せずこれを返す（CI が token を外から渡す運用向け）。
   */
  bearerToken?: string;
  /** bearerToken を適用する tenant。既定は E2E_TENANT_ID または tenant-demo。 */
  bearerTenantId?: string;
  /** fetch の差し替え口（単体テスト用）。既定は global fetch。 */
  fetchImpl?: typeof fetch;
}

/**
 * auth seed が実際に投入するユーザー（正本: apps/common_services/auth/db/seed.py DEFAULT_USERS）。
 *
 * scaffold が吐いていた admin@example.test / e2e-admin-pw のような
 * 架空 credential は使わない。seed 側を変えたらここも合わせる。
 */
export const SEED_USERS: Record<string, { username: string; password: string }> = {
  admin: { username: 'admin', password: 'admin123' },
  manager: { username: 'tanaka', password: 'tanaka123' },
  employee: { username: 'suzuki', password: 'suzuki123' },
  operator: { username: 'migration-operator', password: 'operator123' },
  reviewer: { username: 'migration-reviewer', password: 'reviewer123' },
};

export interface TokenOptions {
  /** seed role（admin / manager / employee / operator / reviewer）。username 明示時はそちらが優先。 */
  role?: string;
  username?: string;
  password?: string;
}

export interface HeaderOptions {
  actorId?: string | null;
  includeTenantHeader?: boolean;
  username?: string;
}

export interface TokenPair {
  accessToken: string;
  /** auth service が refresh を返さない場合は accessToken と同じ値。 */
  refreshToken: string;
}

export interface AuthClient {
  /** 実 login して Bearer token を返す（username:tenant 単位で cache）。 */
  fetchBearerToken(tenantId: string, options?: TokenOptions): Promise<string>;
  /** access / refresh の対。auth app の frontend は refresh も localStorage から読む。 */
  fetchTokenPair(tenantId: string, options?: TokenOptions): Promise<TokenPair>;
  /** 認証付き共通ヘッダ（API 層の x-tenant-id / x-actor-id も同梱）。 */
  authHeaders(tenantId: string, options?: HeaderOptions): Promise<Record<string, string>>;
  /** token cache を捨てる（再 login させたいときだけ使う）。 */
  clearCache(): void;
}

interface LoginResponseBody {
  success?: boolean;
  access_token?: string | null;
  token?: string | null;
  refresh_token?: string | null;
  message?: string;
}

function decodeJwtPayload(app: string, token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2 || !parts[1]) {
    throw new Error(`[${app}/auth] JWT 形式が不正`);
  }
  const padded = parts[1] + '='.repeat((4 - (parts[1].length % 4)) % 4);
  return JSON.parse(Buffer.from(padded, 'base64url').toString('utf8')) as Record<string, unknown>;
}

export function createAuthClient(config: AuthClientConfig): AuthClient {
  const app = config.app;
  const baseUrl =
    config.baseUrl ??
    process.env.E2E_AUTH_API_BASE_URL ??
    process.env.E2E_AUTH_BASE_URL ??
    DEFAULT_AUTH_BASE;
  const loginUrl = `${baseUrl.replace(/\/$/, '')}${config.loginPath ?? DEFAULT_LOGIN_PATH}`;
  const defaultUsername = config.username ?? DEFAULT_USERNAME;
  const bearerTenantId = config.bearerTenantId ?? process.env.E2E_TENANT_ID ?? 'tenant-demo';
  const doFetch = config.fetchImpl ?? fetch;
  const cache = new Map<string, TokenPair>();

  /**
   * role / username / password の優先順を解決する。role は seed に無ければ fail-loud。
   *
   * password は username と対で決まる。独立に解決すると
   * `{ username: 'tanaka' }` に既定 password が付いて login が落ちるため、
   * 明示指定が無ければ解決後の username で seed を引く。
   */
  function resolveCredential(options: TokenOptions): { username: string; password: string } {
    let seeded: { username: string; password: string } | undefined;
    if (options.role !== undefined) {
      seeded = SEED_USERS[options.role];
      if (!seeded) {
        throw new Error(
          `[${app}/auth] seed に無い role: ${options.role}. ` +
            'apps/common_services/auth/db/seed.py の DEFAULT_USERS と一致させること',
        );
      }
    }
    // config の username は「既定 role（seed の admin）の別名」として渡される
    // 上書き経路（例: market_trend の E2E_ADMIN_USERNAME）。seed 側を無条件に
    // 優先すると、この override が黙って無視されて別 principal で login する。
    // 逆に admin 以外の role を要求されたときは role の意味を壊さないよう seed を使う。
    const roleUsername =
      seeded !== undefined && seeded.username !== DEFAULT_USERNAME ? seeded.username : undefined;
    const username = options.username ?? roleUsername ?? defaultUsername;
    const seedPassword = Object.values(SEED_USERS).find(
      (user) => user.username === username,
    )?.password;
    const password =
      options.password ??
      // config の password は既定 username に対して渡されたもの。別 username には使わない。
      (username === defaultUsername ? config.password : undefined) ??
      // seed 表は解決後の username で引く。role の password を先に見ると
      // `{ role: 'manager', username: 'suzuki' }` が suzuki + tanaka123 になる。
      seedPassword ??
      seeded?.password ??
      DEFAULT_PASSWORD;
    return { username, password };
  }

  async function fetchTokenPair(tenantId: string, options: TokenOptions = {}): Promise<TokenPair> {
    const { username, password } = resolveCredential(options);
    const cacheKey = `${username}:${tenantId}`;
    const hit = cache.get(cacheKey);
    if (hit) {
      return hit;
    }

    // 事前発行 token は既定 username 向けに渡されたもの。別 username の要求へ
    // 流用すると、cross-tenant / intruder の否定 assert が特権 principal で
    // 走って誤 PASS する（tenant だけで判定してはいけない）。
    if (config.bearerToken && tenantId === bearerTenantId && username === defaultUsername) {
      const injected = { accessToken: config.bearerToken, refreshToken: config.bearerToken };
      cache.set(cacheKey, injected);
      return injected;
    }

    const response = await doFetch(loginUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username, password, tenant_id: tenantId }),
    });
    if (!response.ok) {
      throw new Error(
        `[${app}/auth] auth login 失敗 status=${response.status} url=${loginUrl} tenant=${tenantId}`,
      );
    }
    const body = (await response.json()) as LoginResponseBody;
    const token = body.access_token ?? body.token;
    if (!token) {
      throw new Error(`[${app}/auth] login レスポンスに token なし message=${body.message ?? ''}`);
    }

    const payload = decodeJwtPayload(app, token);
    const jwtTenant = String(payload.tenant_id ?? '');
    if (jwtTenant && jwtTenant !== tenantId) {
      throw new Error(
        `[${app}/auth] tenant mismatch: requested=${tenantId} jwt=${jwtTenant}. ` +
          'auth seed に当該 tenant membership があるか確認すること',
      );
    }
    const pair: TokenPair = { accessToken: token, refreshToken: body.refresh_token ?? token };
    cache.set(cacheKey, pair);
    return pair;
  }

  async function fetchBearerToken(tenantId: string, options: TokenOptions = {}): Promise<string> {
    return (await fetchTokenPair(tenantId, options)).accessToken;
  }

  async function authHeaders(
    tenantId: string,
    options: HeaderOptions = {},
  ): Promise<Record<string, string>> {
    const token = await fetchBearerToken(tenantId, { username: options.username });
    const headers: Record<string, string> = {
      authorization: `Bearer ${token}`,
    };
    if (options.includeTenantHeader !== false) {
      headers['x-tenant-id'] = tenantId;
    }
    if (options.actorId) {
      headers['x-actor-id'] = options.actorId;
    }
    return headers;
  }

  return {
    fetchBearerToken,
    fetchTokenPair,
    authHeaders,
    clearCache: () => cache.clear(),
  };
}

/**
 * client_credentials で service token を取得する（BlackBox Worker 等の machine principal 用）。
 * base URL の解決は createAuthClient と同じ env（E2E_AUTH_API_BASE_URL / E2E_AUTH_BASE_URL）。
 * 失敗は fail-loud（skip や stub token への fallback をしない）。
 */
export async function fetchServiceToken(
  clientId: string,
  clientSecret: string,
  options: { baseUrl?: string; scope?: string; fetchImpl?: typeof fetch } = {},
): Promise<string> {
  const base = (
    options.baseUrl ??
    process.env.E2E_AUTH_API_BASE_URL ??
    process.env.E2E_AUTH_BASE_URL ??
    DEFAULT_AUTH_BASE
  ).replace(/\/$/, '');
  const doFetch = options.fetchImpl ?? fetch;
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  });
  if (options.scope) {
    body.set('scope', options.scope);
  }
  const resp = await doFetch(`${base}/auth/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  if (!resp.ok) {
    throw new Error(`[auth] client_credentials 発行に失敗: ${resp.status} ${await resp.text()}`);
  }
  const data = (await resp.json()) as { access_token?: string };
  if (!data.access_token) {
    throw new Error('[auth] client_credentials 応答に access_token が無い');
  }
  return data.access_token;
}
