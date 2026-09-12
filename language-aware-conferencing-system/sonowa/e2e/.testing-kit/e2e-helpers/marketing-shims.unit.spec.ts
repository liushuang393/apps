/**
 * marketing_growth_platform 4 app の auth helper が共通 module に乗ったかを確認する。
 *
 * 統合前は 4 本とも同じ scaffold で、実在しない `/api/auth/login` を
 * 各 app の backend port へ叩き、`admin@example.test` / `e2e-admin-pw` という
 * seed に無い credential を送っていた。同じ scaffold が復活しないための回帰テスト。
 *
 * geo_demand / market_insight は backend に login route が無いため auth service 直。
 * growth_command / market_trend は backend が auth service への login proxy を
 * 持つので、本番 front-door であるその proxy を通す。
 *
 * サービスが起動していない環境では skip する（mock は使わない。
 * 本番同等 E2E の原則: 内部 mock / bypass は禁止）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import * as geoDemand from '../../tests/apps/marketing_growth_platform/modules/geo_demand/e2e/helpers/auth';
import * as growthCommand from '../../tests/apps/marketing_growth_platform/modules/growth_command/e2e/helpers/auth';
import * as marketInsight from '../../tests/apps/marketing_growth_platform/modules/market_insight/e2e/helpers/auth';
import * as marketTrend from '../../tests/apps/marketing_growth_platform/modules/market_trend/e2e/helpers/auth';

const AUTH_BASE = process.env.E2E_AUTH_API_BASE_URL ?? 'http://127.0.0.1:18010';
const TENANT = process.env.E2E_TENANT_ID ?? 'tenant-demo';

const SHIMS = [
  { name: 'geo_demand', mod: geoDemand },
  { name: 'growth_command', mod: growthCommand },
  { name: 'market_insight', mod: marketInsight },
  { name: 'market_trend', mod: marketTrend },
];

async function serviceIsUp(base: string, path: string): Promise<boolean> {
  try {
    await fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    return true;
  } catch {
    return false;
  }
}

test('4 app の shim は loginAs / fetchBearerToken を export する', () => {
  for (const { name, mod } of SHIMS) {
    expect(typeof mod.loginAs, name).toBe('function');
    expect(typeof mod.fetchBearerToken, name).toBe('function');
  }
});

test('scaffold の架空 credential と placeholder が shim から消えている', () => {
  const base = resolve(__dirname, '..', '..');
  for (const { name } of SHIMS) {
    const file = `tests/apps/marketing_growth_platform/modules/${name}/e2e/helpers/auth.ts`;
    const body = readFileSync(resolve(base, file), 'utf8');
    expect(body, file).not.toContain('example.test');
    expect(body, file).not.toContain('e2e-admin-pw');
    expect(body, file).not.toContain('確認事項');
  }
});

test('geo_demand は backend に login route が無いので auth service へ直接ログインする', async () => {
  test.skip(!(await serviceIsUp(AUTH_BASE, '/auth/login')), `auth service 未起動: ${AUTH_BASE}`);

  const token = await geoDemand.fetchBearerToken(TENANT);
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

  expect(claims.iss).toBe('auth');
  expect(claims.tenant_id).toBe(TENANT);
  expect(String(token)).not.toContain('stub');
});

test('market_insight も auth service へ直接ログインする', async () => {
  test.skip(!(await serviceIsUp(AUTH_BASE, '/auth/login')), `auth service 未起動: ${AUTH_BASE}`);

  const token = await marketInsight.fetchBearerToken(TENANT);
  expect(token.split('.')).toHaveLength(3);
});

test('growth_command は backend の login proxy を通す（本番 front-door）', async () => {
  const base = growthCommand.API_BASE_URL;
  test.skip(!(await serviceIsUp(base, '/api/auth/login')), `growth_command backend 未起動: ${base}`);

  const token = await growthCommand.fetchBearerToken(TENANT);
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

  expect(claims.tenant_id).toBe(TENANT);
});

test('market_trend は proxy が固定する tenant を既定にする', async () => {
  const base = marketTrend.API_BASE_URL;
  test.skip(!(await serviceIsUp(base, '/api/auth/login')), `market_trend backend 未起動: ${base}`);

  // proxy は MARKET_TREND_LOGIN_TENANT_ID を payload へ上書きするため、
  // 呼び出し側が tenant-demo を要求すると JWT と食い違って fail-loud する。
  const token = await marketTrend.fetchBearerToken(marketTrend.LOGIN_TENANT_ID);
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

  expect(claims.tenant_id).toBe(marketTrend.LOGIN_TENANT_ID);
});
