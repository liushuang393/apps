/**
 * ticket 32（sales 2 + partner 1 + ecos 1）の shim を確認する。
 *
 * 4 本は機構が 3 通りに分かれる。
 * - messaging_hub … scaffold（架空 credential + 実在しない login endpoint）→ auth service 直
 * - ecos_platform / faq_knowledge_chat … BFF Cookie Session
 * - oem_portal … global-setup が発行する token 束（別 module）
 *
 * ecos は統合前、spec が import する `loginViaApi` を export しておらず、
 * さらに BFF が伏せる access_token を読もうとしていた。同じ壊れ方の回帰テスト。
 */
import { expect, test } from '@playwright/test';

import * as ecos from '../../tests/apps/enterprise_context_operating_system/platform/e2e/helpers/auth';
import * as messagingHub from '../../tests/apps/sales_support_platform/modules/messaging_hub/e2e/helpers/auth';
import * as oemPortal from '../../tests/apps/partner_channel_platform/modules/oem_portal/e2e/helpers/auth';
import { loginViaBffCookie } from './auth';

const AUTH_BASE = process.env.E2E_AUTH_API_BASE_URL ?? 'http://127.0.0.1:18010';
const TENANT = process.env.E2E_TENANT_ID ?? 'tenant-demo';

/** page.request 相当の記録用スタブ。BFF login は browser cookie jar を通るため fetch は使わない。 */
function recordingPage(body: unknown, ok = true, status = 200) {
  const calls: { url: string; data: unknown }[] = [];
  return {
    calls,
    page: {
      request: {
        post: (url: string, opts: { data: unknown }) => {
          calls.push({ url, data: opts.data });
          return Promise.resolve({ ok: () => ok, status: () => status, json: () => Promise.resolve(body) });
        },
      },
    },
  };
}

async function authServiceIsUp(): Promise<boolean> {
  try {
    await fetch(`${AUTH_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return true;
  } catch {
    return false;
  }
}

test('ecos は spec が import する loginViaApi を export する', () => {
  // ECOS-CATALOG-001.spec.ts が import している名前。統合前は未定義だった。
  expect(typeof ecos.loginViaApi).toBe('function');
  expect(typeof ecos.loginAs).toBe('function');
  expect(ecos.ROLE_FIXTURE_USERS.admin?.username).toBe('admin');
});

test('BFF login は role の seed credential を BFF origin へ送る', async () => {
  const { page, calls } = recordingPage({ success: true, user: { username: 'tanaka' } });

  await loginViaBffCookie(
    page,
    { app: 'demo', baseUrl: 'http://127.0.0.1:8910' },
    { role: 'manager' },
  );

  expect(calls[0]?.url).toBe('http://127.0.0.1:8910/api/auth/login');
  expect(calls[0]?.data).toEqual({ username: 'tanaka', password: 'tanaka123' });
});

test('BFF が 200 + success:false を返したら fail-loud する', async () => {
  // BFF は失敗を 200 で返すことがある。status だけ見ると誤 PASS する。
  const { page } = recordingPage({ success: false, message: 'ユーザー名またはパスワードが正しくありません' });

  await expect(
    loginViaBffCookie(page, { app: 'demo', baseUrl: 'http://127.0.0.1:8910' }),
  ).rejects.toThrow(/\[demo\/auth\] login レスポンスが success\/user を含まない/);
});

test('BFF login は token を要求しない（BFF は access_token を伏せる）', async () => {
  // ecos の _browser_safe_auth_response は access/refresh を None にして返す。
  // token を読もうとすると実 backend で必ず落ちる。
  const { page } = recordingPage({ success: true, user: { username: 'admin' } });

  await expect(
    loginViaBffCookie(page, { app: 'ecos_platform', baseUrl: ecos.API_BASE_URL }),
  ).resolves.toBeUndefined();
});

test('oem_portal は token 未発行なら fail-loud する（誤 PASS 防止）', () => {
  // REQ-PCP-001 H-13: 空ヘッダで続行すると「認証なしテスト」が誤 PASS する。
  // 共通 module の既定は空ヘッダなので、この fail-loud は本 app 固有。
  expect(() => oemPortal.authHeaders('未発行 role')).toThrow(/mint_e2e_token\.py/);
  expect(oemPortal.PARTNER_SELF_TENANT).toBe('ptr-partner-e2e-self');
});

test('messaging_hub は auth service へ実ログインする', async () => {
  test.skip(!(await authServiceIsUp()), `auth service 未起動: ${AUTH_BASE}`);

  const token = await messagingHub.fetchBearerToken(TENANT);
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

  expect(claims.iss).toBe('auth');
  expect(claims.tenant_id).toBe(TENANT);
});
