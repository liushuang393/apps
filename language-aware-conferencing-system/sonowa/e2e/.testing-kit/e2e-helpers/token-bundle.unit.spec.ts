/**
 * mint_e2e_token 束読み module の単体テスト。
 *
 * global-setup が `testing-kit/scripts/mint_e2e_token.py` で発行した
 * `.auth/tokens.json` を読む経路と、実行時 mint の契約を固定する。
 * 8 app が同じ形で複製していた部分だけを対象にし、suite deployment 判定
 * （app ごとに env 変数も fail 方針も違う）は各 app の shim に残す。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { createTokenBundleClient, findRepoRoot } from './token-bundle';

let counter = 0;

/** tokens.json を持つ一時 e2e ディレクトリを作る。 */
function bundleDir(tokens: unknown | null): string {
  counter += 1;
  const dir = join(tmpdir(), `tk-bundle-${process.pid}-${counter}`);
  mkdirSync(join(dir, '.auth'), { recursive: true });
  if (tokens !== null) {
    writeFileSync(join(dir, '.auth', 'tokens.json'), JSON.stringify(tokens), 'utf8');
  }
  return dir;
}

const ADMIN_TOKEN = { header: 'authorization', value: 'Bearer minted-admin' };

test('authHeaders は tokens.json の role をヘッダ 1 組に変換する', () => {
  const client = createTokenBundleClient({
    app: 'demo',
    tokensPath: join(bundleDir({ admin: ADMIN_TOKEN }), '.auth', 'tokens.json'),
  });

  expect(client.authHeaders('admin')).toEqual({ authorization: 'Bearer minted-admin' });
});

test('role 既定は admin', () => {
  const client = createTokenBundleClient({
    app: 'demo',
    tokensPath: join(bundleDir({ admin: ADMIN_TOKEN }), '.auth', 'tokens.json'),
  });

  expect(client.authHeaders()).toEqual({ authorization: 'Bearer minted-admin' });
});

test('tokens.json が無ければ空ヘッダ（＝認証なし扱い・既存挙動）', () => {
  const client = createTokenBundleClient({
    app: 'demo',
    tokensPath: join(bundleDir(null), '.auth', 'tokens.json'),
  });

  expect(client.authHeaders('admin')).toEqual({});
});

test('未発行 role は空ヘッダ', () => {
  const client = createTokenBundleClient({
    app: 'demo',
    tokensPath: join(bundleDir({ admin: ADMIN_TOKEN }), '.auth', 'tokens.json'),
  });

  expect(client.authHeaders('noscope')).toEqual({});
});

test('tokens.json が壊れていても空ヘッダで済ませる（既存挙動）', () => {
  const dir = bundleDir(null);
  writeFileSync(join(dir, '.auth', 'tokens.json'), '{ not json', 'utf8');
  const client = createTokenBundleClient({ app: 'demo', tokensPath: join(dir, '.auth', 'tokens.json') });

  expect(client.authHeaders('admin')).toEqual({});
});

test('mintTenantHeaders は mint script を app-config / role / tenant 付きで呼ぶ', () => {
  const calls: { file: string; args: readonly string[] }[] = [];
  const client = createTokenBundleClient({
    app: 'demo',
    tokensPath: join(bundleDir({}), '.auth', 'tokens.json'),
    appConfigPath: '/repo/apps/demo/app_config.json',
    execImpl: (file, args) => {
      calls.push({ file, args });
      return JSON.stringify(ADMIN_TOKEN);
    },
  });

  const headers = client.mintTenantHeaders('tenant-x');

  expect(calls).toHaveLength(1);
  expect(calls[0]?.args).toEqual([
    expect.stringContaining('mint_e2e_token.py'),
    '--app-config',
    '/repo/apps/demo/app_config.json',
    '--role',
    'admin',
    '--tenant',
    'tenant-x',
  ]);
  expect(headers).toEqual({ authorization: 'Bearer minted-admin', 'x-tenant-id': 'tenant-x' });
});

test('mint の python は E2E_PYTHON で差し替えられる', () => {
  const seen: string[] = [];
  const client = createTokenBundleClient({
    app: 'demo',
    tokensPath: join(bundleDir({}), '.auth', 'tokens.json'),
    appConfigPath: '/repo/app_config.json',
    python: 'python3.13',
    execImpl: (file) => {
      seen.push(file);
      return JSON.stringify(ADMIN_TOKEN);
    },
  });

  client.mintTenantHeaders('tenant-x');

  expect(seen).toEqual(['python3.13']);
});

test('appConfigPath 未設定で mint を呼んだら app 名付きで fail-loud する', () => {
  const client = createTokenBundleClient({
    app: 'demo',
    tokensPath: join(bundleDir({}), '.auth', 'tokens.json'),
    execImpl: () => JSON.stringify(ADMIN_TOKEN),
  });

  expect(() => client.mintTenantHeaders('tenant-x')).toThrow(/\[demo\/auth\].*appConfigPath/s);
});

test('mint 出力が JSON でなければ app 名付きで fail-loud する', () => {
  const client = createTokenBundleClient({
    app: 'demo',
    tokensPath: join(bundleDir({}), '.auth', 'tokens.json'),
    appConfigPath: '/repo/app_config.json',
    execImpl: () => 'Traceback (most recent call last): ...',
  });

  expect(() => client.mintTenantHeaders('tenant-x')).toThrow(/\[demo\/auth\].*mint/s);
});

test('mint の role は上書きできる', () => {
  const calls: (readonly string[])[] = [];
  const client = createTokenBundleClient({
    app: 'demo',
    tokensPath: join(bundleDir({}), '.auth', 'tokens.json'),
    appConfigPath: '/repo/app_config.json',
    execImpl: (_file, args) => {
      calls.push(args);
      return JSON.stringify(ADMIN_TOKEN);
    },
  });

  client.mintTenantHeaders('tenant-x', { role: 'othertenant' });

  expect(calls[0]).toContain('othertenant');
});

test('findRepoRoot は mint script を持つディレクトリまで遡る', () => {
  const root = findRepoRoot(__dirname);

  expect(root).toBe(join(__dirname, '..', '..').replace(/\/$/, ''));
});
