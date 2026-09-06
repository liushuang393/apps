/**
 * common_services 3 app の auth helper が共通 module に乗ったかを確認する。
 *
 * forge_pay / notification_service は marketing と同じ scaffold（実在しない
 * `/api/auth/login` と架空 credential）だった。auth app 自身の helper だけは
 * 実 login を持っていたが、seed credential 表を独自に複製し、
 * 旧シナリオ互換の role alias（editor / viewer / guest）を抱えていた。
 *
 * auth app の frontend は refresh token も localStorage から読むため、
 * 共通 module は access / refresh の対を返せる必要がある。
 *
 * auth service が起動していない環境では skip する（mock は使わない。
 * 本番同等 E2E の原則: 内部 mock / bypass は禁止）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import * as authApp from '../../tests/apps/common_services/auth/e2e/helpers/auth';
import * as forgePay from '../../tests/apps/common_services/forge_pay/e2e/helpers/auth';
import * as notification from '../../tests/apps/common_services/notification_service/e2e/helpers/auth';
import { createAuthClient } from './auth';

const AUTH_BASE = process.env.E2E_AUTH_API_BASE_URL ?? 'http://127.0.0.1:18010';
const TENANT = process.env.E2E_TENANT_ID ?? 'tenant-demo';

const SHIMS = [
  { name: 'auth', mod: authApp },
  { name: 'forge_pay', mod: forgePay },
  { name: 'notification_service', mod: notification },
];

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

test('3 app の shim は loginAs / fetchBearerToken を export する', () => {
  for (const { name, mod } of SHIMS) {
    expect(typeof mod.loginAs, name).toBe('function');
    expect(typeof mod.fetchBearerToken, name).toBe('function');
  }
});

test('scaffold の架空 credential と未実装 endpoint が shim から消えている', () => {
  const base = resolve(__dirname, '..', '..');
  const files = [
    'tests/apps/common_services/auth/e2e/helpers/auth.ts',
    'tests/apps/common_services/forge_pay/e2e/helpers/auth.ts',
    'tests/apps/common_services/notification_service/e2e/helpers/auth.ts',
  ];
  for (const file of files) {
    const body = readFileSync(resolve(base, file), 'utf8');
    expect(body, file).not.toContain('example.test');
    expect(body, file).not.toContain('/api/auth/login');
    // seed credential 表の複製が残っていないこと（正本は共通 module の SEED_USERS）。
    expect(body, file).not.toContain('tanaka123');
  }
});

test('共通 module は access / refresh の対を返す', async () => {
  test.skip(!(await authServiceIsUp()), `auth service 未起動: ${AUTH_BASE}`);

  const client = createAuthClient({ app: 'auth_service' });
  const pair = await client.fetchTokenPair(TENANT);

  expect(pair.accessToken.split('.')).toHaveLength(3);
  expect(pair.refreshToken.length).toBeGreaterThan(0);
  expect(pair.refreshToken).not.toBe(pair.accessToken);
});

test('auth app の role alias（editor / viewer / guest）は seed ユーザーへ解決する', async () => {
  test.skip(!(await authServiceIsUp()), `auth service 未起動: ${AUTH_BASE}`);

  // 旧世代の生成シナリオが editor / viewer / guest を渡してくる。
  // seed には無い role なので、共通 module へそのまま渡すと fail-loud する。
  const editor = await authApp.fetchBearerToken(TENANT, { role: 'editor' });
  const manager = await authApp.fetchBearerToken(TENANT, { role: 'manager' });
  const admin = await authApp.fetchBearerToken(TENANT, { role: 'admin' });

  const sub = (token: string): unknown =>
    (
      JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >
    ).sub;

  expect(sub(editor)).toBe(sub(manager));
  expect(sub(editor)).not.toBe(sub(admin));
});

test('forge_pay / notification_service は auth service へ実ログインする', async () => {
  test.skip(!(await authServiceIsUp()), `auth service 未起動: ${AUTH_BASE}`);

  for (const mod of [forgePay, notification]) {
    const token = await mod.fetchBearerToken(TENANT);
    const claims = JSON.parse(
      Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
    ) as Record<string, unknown>;
    expect(claims.iss).toBe('auth');
    expect(claims.tenant_id).toBe(TENANT);
  }
});
