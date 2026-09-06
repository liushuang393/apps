/**
 * testing-kit 共通 E2E 認証 module の単体テスト。
 *
 * 実 auth service は起動せず、fetch seam に fake を注入して契約を固定する。
 * app E2E spec ではないため *.unit.spec.ts 命名にしている。
 */
import { expect, test } from '@playwright/test';

import { SEED_USERS, createAuthClient } from './auth';

/** payload だけ本物の形にした JWT（署名は検証しないので固定文字列）。 */
function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: object): string =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${encode({ alg: 'ES256', typ: 'JWT' })}.${encode(payload)}.sig`;
}

type Call = { url: string; body: Record<string, unknown> };

/** 呼び出しを記録する fake fetch。responses を順に返す。 */
function recordingFetch(responses: Response[]): { fetch: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  let index = 0;
  const impl = (async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(input),
      body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>,
    });
    const response = responses[Math.min(index, responses.length - 1)];
    index += 1;
    if (!response) {
      throw new Error('fake fetch: レスポンスが足りない');
    }
    return response.clone();
  }) as unknown as typeof fetch;
  return { fetch: impl, calls };
}

function okLogin(payload: Record<string, unknown> = { tenant_id: 'tenant-demo' }): Response {
  return new Response(JSON.stringify({ success: true, access_token: fakeJwt(payload) }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

test('login は baseUrl + loginPath へ username / password / tenant_id を POST する', async () => {
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({
    app: 'demo',
    baseUrl: 'http://127.0.0.1:18010/',
    username: 'admin',
    password: 'admin123',
    fetchImpl: fetch,
  });

  await client.fetchBearerToken('tenant-demo');

  expect(calls).toHaveLength(1);
  expect(calls[0]?.url).toBe('http://127.0.0.1:18010/auth/login');
  expect(calls[0]?.body).toEqual({
    username: 'admin',
    password: 'admin123',
    tenant_id: 'tenant-demo',
  });
});

test('access_token が無い場合は token field へ fallback する', async () => {
  const body = JSON.stringify({ success: true, token: fakeJwt({ tenant_id: 'tenant-demo' }) });
  const { fetch } = recordingFetch([
    new Response(body, { status: 200, headers: { 'content-type': 'application/json' } }),
  ]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await expect(client.fetchBearerToken('tenant-demo')).resolves.toContain('.');
});

test('login が失敗したら status / url / tenant を含めて throw する', async () => {
  const { fetch } = recordingFetch([new Response('nope', { status: 401 })]);
  const client = createAuthClient({ app: 'demo', baseUrl: 'http://auth.test', fetchImpl: fetch });

  await expect(client.fetchBearerToken('tenant-x')).rejects.toThrow(
    /\[demo\/auth\].*status=401.*http:\/\/auth\.test\/auth\/login.*tenant-x/s,
  );
});

test('レスポンスに token が無ければ message 付きで throw する', async () => {
  const { fetch } = recordingFetch([
    new Response(JSON.stringify({ success: false, message: 'invalid credentials' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await expect(client.fetchBearerToken('tenant-demo')).rejects.toThrow(/invalid credentials/);
});

test('JWT の tenant_id が要求 tenant と食い違えば throw する', async () => {
  const { fetch } = recordingFetch([okLogin({ tenant_id: 'tenant-other' })]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await expect(client.fetchBearerToken('tenant-demo')).rejects.toThrow(
    /tenant mismatch: requested=tenant-demo jwt=tenant-other/,
  );
});

test('JWT に tenant_id claim が無い場合は mismatch 扱いしない', async () => {
  const { fetch } = recordingFetch([okLogin({ sub: 'admin' })]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await expect(client.fetchBearerToken('tenant-demo')).resolves.toContain('.');
});

test('JWT 形式が壊れていれば throw する', async () => {
  const { fetch } = recordingFetch([
    new Response(JSON.stringify({ access_token: 'not-a-jwt' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await expect(client.fetchBearerToken('tenant-demo')).rejects.toThrow(/JWT 形式が不正/);
});

test('同一 username / tenant の 2 回目は cache から返し login しない', async () => {
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  const first = await client.fetchBearerToken('tenant-demo');
  const second = await client.fetchBearerToken('tenant-demo');

  expect(second).toBe(first);
  expect(calls).toHaveLength(1);
});

test('tenant が違えば cache を共有せず login し直す', async () => {
  const { fetch, calls } = recordingFetch([
    okLogin({ tenant_id: 'tenant-a' }),
    okLogin({ tenant_id: 'tenant-b' }),
  ]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await client.fetchBearerToken('tenant-a');
  await client.fetchBearerToken('tenant-b');

  expect(calls.map((call) => call.body.tenant_id)).toEqual(['tenant-a', 'tenant-b']);
});

test('username が違えば cache を共有せず login し直す', async () => {
  const { fetch, calls } = recordingFetch([okLogin(), okLogin()]);
  const client = createAuthClient({ app: 'demo', username: 'admin', fetchImpl: fetch });

  await client.fetchBearerToken('tenant-demo');
  await client.fetchBearerToken('tenant-demo', { username: 'tanaka' });

  expect(calls.map((call) => call.body.username)).toEqual(['admin', 'tanaka']);
});

test('clearCache 後は login し直す', async () => {
  const { fetch, calls } = recordingFetch([okLogin(), okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await client.fetchBearerToken('tenant-demo');
  client.clearCache();
  await client.fetchBearerToken('tenant-demo');

  expect(calls).toHaveLength(2);
});

test('bearerToken が渡された tenant では login せずそれを返す', async () => {
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({
    app: 'demo',
    bearerToken: 'pre-issued-token',
    bearerTenantId: 'tenant-demo',
    fetchImpl: fetch,
  });

  await expect(client.fetchBearerToken('tenant-demo')).resolves.toBe('pre-issued-token');
  expect(calls).toHaveLength(0);
});

test('bearerToken は対象外 tenant には使わず login する', async () => {
  const { fetch, calls } = recordingFetch([okLogin({ tenant_id: 'tenant-other' })]);
  const client = createAuthClient({
    app: 'demo',
    bearerToken: 'pre-issued-token',
    bearerTenantId: 'tenant-demo',
    fetchImpl: fetch,
  });

  await client.fetchBearerToken('tenant-other');

  expect(calls).toHaveLength(1);
});

test('authHeaders は authorization と x-tenant-id を返す', async () => {
  const { fetch } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  const headers = await client.authHeaders('tenant-demo');

  expect(headers.authorization).toMatch(/^Bearer /);
  expect(headers['x-tenant-id']).toBe('tenant-demo');
  expect(headers['x-actor-id']).toBeUndefined();
});

test('authHeaders は includeTenantHeader:false で x-tenant-id を落とす', async () => {
  const { fetch } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  const headers = await client.authHeaders('tenant-demo', { includeTenantHeader: false });

  expect(headers['x-tenant-id']).toBeUndefined();
});

test('authHeaders は actorId が有れば x-actor-id を足す', async () => {
  const { fetch } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  const headers = await client.authHeaders('tenant-demo', { actorId: 'auditor-1' });

  expect(headers['x-actor-id']).toBe('auditor-1');
});

test('authHeaders は username を login へ引き継ぐ', async () => {
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', username: 'admin', fetchImpl: fetch });

  await client.authHeaders('tenant-demo', { username: 'tanaka' });

  expect(calls[0]?.body.username).toBe('tanaka');
});

test('SEED_USERS は auth seed の DEFAULT_USERS と同じ実 credential を持つ', () => {
  expect(SEED_USERS).toEqual({
    admin: { username: 'admin', password: 'admin123' },
    manager: { username: 'tanaka', password: 'tanaka123' },
    employee: { username: 'suzuki', password: 'suzuki123' },
    operator: { username: 'migration-operator', password: 'operator123' },
    reviewer: { username: 'migration-reviewer', password: 'reviewer123' },
  });
});

for (const [role, username, password] of [
  ['operator', 'migration-operator', 'operator123'],
  ['reviewer', 'migration-reviewer', 'reviewer123'],
] as const) {
  test(`migration role ${role} は実 seed credential で login する`, async () => {
    const { fetch, calls } = recordingFetch([okLogin()]);
    const client = createAuthClient({ app: 'code-migration', fetchImpl: fetch });

    await client.fetchBearerToken('tenant-demo', { role });

    expect(calls[0]?.body).toMatchObject({ username, password, tenant_id: 'tenant-demo' });
  });
}

test('role 指定で seed ユーザーの credential を使って login する', async () => {
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await client.fetchBearerToken('tenant-demo', { role: 'manager' });

  expect(calls[0]?.body).toMatchObject({ username: 'tanaka', password: 'tanaka123' });
});

test('seed に無い role は seed の正本を指す message で throw する', async () => {
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await expect(client.fetchBearerToken('tenant-demo', { role: 'viewer' })).rejects.toThrow(
    /\[demo\/auth\] seed に無い role: viewer.*seed\.py/s,
  );
  expect(calls).toHaveLength(0);
});

test('username を明示したら role より優先する', async () => {
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await client.fetchBearerToken('tenant-demo', { role: 'manager', username: 'suzuki' });

  expect(calls[0]?.body.username).toBe('suzuki');
});

test('role 違いは cache を共有しない', async () => {
  const { fetch, calls } = recordingFetch([okLogin(), okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await client.fetchBearerToken('tenant-demo', { role: 'admin' });
  await client.fetchBearerToken('tenant-demo', { role: 'employee' });

  expect(calls.map((call) => call.body.username)).toEqual(['admin', 'suzuki']);
});

test('username だけ渡したら seed の対になる password で login する', async () => {
  // 実 auth service は tanaka/admin123 を拒否する（seed の password は tanaka123）。
  // username と password を独立に解決すると既定 password が付いて login が落ちる。
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await client.fetchBearerToken('tenant-demo', { username: 'tanaka' });

  expect(calls[0]?.body).toEqual({
    username: 'tanaka',
    password: 'tanaka123',
    tenant_id: 'tenant-demo',
  });
});

test('authHeaders 経由の username も seed の対になる password を使う', async () => {
  // DOCUMENT-003 の cross-tenant / intruder 判定がこの経路を通る。
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await client.authHeaders('tenant-demo', { username: 'suzuki' });

  expect(calls[0]?.body.password).toBe('suzuki123');
});

test('既定 username が seed ユーザーなら password も seed に合わせる', async () => {
  // DOC_E2E_USERNAME だけ渡して DOC_E2E_PASSWORD を省いた場合。
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', username: 'tanaka', fetchImpl: fetch });

  await client.fetchBearerToken('tenant-demo');

  expect(calls[0]?.body.password).toBe('tanaka123');
});

test('password を明示したら seed より優先する', async () => {
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({
    app: 'demo',
    username: 'tanaka',
    password: 'rotated-pw',
    fetchImpl: fetch,
  });

  await client.fetchBearerToken('tenant-demo');

  expect(calls[0]?.body.password).toBe('rotated-pw');
});

test('seed に無い username は既定 password のまま（従来挙動）', async () => {
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({ app: 'demo', fetchImpl: fetch });

  await client.fetchBearerToken('tenant-demo', { username: 'intruder' });

  expect(calls[0]?.body.password).toBe('admin123');
});

test('loginPath は上書きできる', async () => {
  const { fetch, calls } = recordingFetch([okLogin()]);
  const client = createAuthClient({
    app: 'demo',
    baseUrl: 'http://auth.test',
    loginPath: '/api/v1/login',
    fetchImpl: fetch,
  });

  await client.fetchBearerToken('tenant-demo');

  expect(calls[0]?.url).toBe('http://auth.test/api/v1/login');
});
