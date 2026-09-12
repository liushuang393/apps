/**
 * app 側 helper が共通 module を解決でき、実 auth service へ本当にログインできるかを確認する。
 *
 * 統合前は jwt.ts が未定義 symbol（fetchBearerToken / DEFAULT_USERNAME）を
 * 参照し、mintJwt を 2 重宣言していたため 6 本の spec が動かなかった。
 * 同じ壊れ方を再発させないための回帰テスト。
 *
 * auth service が起動していない環境では skip する（mock は使わない。
 * 本番同等 E2E の原則: 内部 mock / bypass は禁止）。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import * as decisionAuth from '../../tests/apps/governance_risk_platform/modules/decision_governance/e2e/helpers/auth';
import * as docAuth from '../../tests/apps/governance_risk_platform/modules/document_compliance/e2e/helpers/auth';
import * as docJwt from '../../tests/apps/governance_risk_platform/modules/document_compliance/e2e/helpers/jwt';

const AUTH_BASE = process.env.E2E_AUTH_API_BASE_URL ?? 'http://127.0.0.1:18010';
const TENANT = process.env.E2E_TENANT_ID ?? 'tenant-demo';

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

test('document_compliance/jwt.ts は spec が import する symbol を export する', () => {
  expect(typeof docJwt.fetchBearerToken).toBe('function');
  expect(typeof docJwt.authHeaders).toBe('function');
  expect(typeof docJwt.mintJwt).toBe('function');
});

test('governance の auth.ts shim は loginAs / authHeaders を export する', () => {
  for (const mod of [docAuth, decisionAuth]) {
    expect(typeof mod.loginAs).toBe('function');
    expect(typeof mod.authHeaders).toBe('function');
    expect(typeof mod.fetchBearerToken).toBe('function');
  }
});

test('scaffold の架空 credential と未実装 endpoint が shim から消えている', () => {
  const base = resolve(__dirname, '..', '..');
  const files = [
    'tests/apps/governance_risk_platform/modules/document_compliance/e2e/helpers/auth.ts',
    'tests/apps/governance_risk_platform/modules/decision_governance/e2e/helpers/auth.ts',
    'tests/apps/governance_risk_platform/modules/document_compliance/e2e/helpers/jwt.ts',
  ];
  for (const file of files) {
    const body = readFileSync(resolve(base, file), 'utf8');
    expect(body, file).not.toContain('example.test');
    expect(body, file).not.toContain('/api/auth/login');
    expect(body, file).not.toContain('確認事項');
  }
});

test('実 auth service へログインし ES256 の Bearer を得る', async () => {
  test.skip(!(await authServiceIsUp()), `auth service 未起動: ${AUTH_BASE}`);

  const token = await docJwt.fetchBearerToken(TENANT);
  const claims = JSON.parse(
    Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8'),
  ) as Record<string, unknown>;

  // 旧 HS256 self-mint は iss=auth-service。実 login は iss=auth。
  expect(claims.iss).toBe('auth');
  expect(claims.tenant_id).toBe(TENANT);
  expect(String(token)).not.toContain('stub');
});

test('authHeaders は実 login 由来の authorization と x-tenant-id を返す', async () => {
  test.skip(!(await authServiceIsUp()), `auth service 未起動: ${AUTH_BASE}`);

  const headers = await docJwt.authHeaders(TENANT, { actorId: 'compliance-officer-e2e' });

  expect(headers.authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
  expect(headers['x-tenant-id']).toBe(TENANT);
  expect(headers['x-actor-id']).toBe('compliance-officer-e2e');
});

test('seed に存在しない tenant を要求したら tenant mismatch で止まる', async () => {
  test.skip(!(await authServiceIsUp()), `auth service 未起動: ${AUTH_BASE}`);

  // membership の無い tenant では auth service が別 tenant の JWT を返すか login を拒む。
  // どちらでも「気付かず通す」ことだけは無いことを保証する。
  await expect(docJwt.fetchBearerToken('tenant-does-not-exist')).rejects.toThrow(
    /\[document_compliance\/auth\]/,
  );
});

test('intruder（tanaka）でも実 login が通り admin と別 subject の JWT を得る', async () => {
  test.skip(!(await authServiceIsUp()), `auth service 未起動: ${AUTH_BASE}`);

  // DOCUMENT-003 の cross-tenant 判定はこの経路。tanaka に admin の password を
  // 付けると auth service が拒否し、intruder 側の assert が実行されないまま落ちる。
  const intruder = await docJwt.mintJwt(TENANT, 'intruder');
  const owner = await docJwt.mintJwt(TENANT);
  const sub = (token: string): unknown =>
    (
      JSON.parse(Buffer.from(token.split('.')[1] ?? '', 'base64url').toString('utf8')) as Record<
        string,
        unknown
      >
    ).sub;

  expect(sub(intruder)).not.toBe(sub(owner));
});
