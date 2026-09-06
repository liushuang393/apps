/**
 * platform ルートの auth helper 2 本が共通 module に乗ったかを確認する。
 *
 * control_plane / legacy_modernization_platform のルート helper は
 * ticket 27-32 の移行対象から漏れており、架空 credential
 * （admin@example.test / e2e-admin-pw）と実在しない `/api/auth/login` を
 * 抱えたままだった。control_plane 側はさらに `E2E_AUTH_MODE=bypass` で
 * `stub-${role}-token` を localStorage に置く分岐を持っていた。
 *
 * bypass gate（check_e2e_no_auth_bypass.py）は tests/apps しか走査して
 * いなかったため、この違反を検出できていなかった。
 *
 * auth service に到達できない環境でも走るよう、login 到達性ではなく
 * 「bypass せず実 login を試みて fail-loud するか」を見る。
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { expect, test } from '@playwright/test';

import * as legacyPlatform from '../../tests/apps/legacy_modernization_platform/e2e/helpers/auth';
import * as controlPlane from '../../tests/control_plane/e2e/helpers/auth';

const SHIMS = [
  {
    name: 'control_plane',
    mod: controlPlane,
    file: 'tests/control_plane/e2e/helpers/auth.ts',
  },
  {
    name: 'legacy_modernization_platform',
    mod: legacyPlatform,
    file: 'tests/apps/legacy_modernization_platform/e2e/helpers/auth.ts',
  },
];

/** addInitScript の呼び出しだけ記録する最小の Page 代替。 */
function recordingPage(): { calls: unknown[]; addInitScript: (...args: unknown[]) => Promise<void> } {
  const calls: unknown[] = [];
  return {
    calls,
    addInitScript: async (...args: unknown[]) => {
      calls.push(args);
    },
  };
}

test('2 本とも loginAs を export する', () => {
  for (const { name, mod } of SHIMS) {
    expect(typeof mod.loginAs, name).toBe('function');
  }
});

test('架空 credential と未実装 endpoint が消えている', () => {
  const base = resolve(__dirname, '..', '..');
  for (const { name, file } of SHIMS) {
    const source = readFileSync(resolve(base, file), 'utf8');
    expect(source, `${name}: 架空 credential`).not.toContain('example.test');
    expect(source, `${name}: 架空 password`).not.toContain('e2e-admin-pw');
    expect(source, `${name}: 実在しない endpoint`).not.toContain('/api/auth/login');
    expect(source, `${name}: 共通 module 未使用`).toContain('testing-kit/e2e-helpers/auth');
  }
});

test('未知の role は fail-loud（無言で通さない）', async () => {
  for (const { name, mod } of SHIMS) {
    const page = recordingPage();
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      mod.loginAs(page as any, 'unknown-role'),
      name,
    ).rejects.toThrow(/未知の role/);
    expect(page.calls, `${name}: 失敗しても init script を仕込まない`).toHaveLength(0);
  }
});

test('E2E_AUTH_MODE=bypass でも stub token を置かず実 login を試みる', async () => {
  const previous = process.env.E2E_AUTH_MODE;
  process.env.E2E_AUTH_MODE = 'bypass';
  try {
    const page = recordingPage();
    // 到達不能な port を渡す。bypass 分岐が残っていれば例外なく
    // stub token が入り、この expect が落ちる。
    await expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      controlPlane.loginAs(page as any, 'admin', { authBaseUrl: 'http://127.0.0.1:1' }),
    ).rejects.toThrow();
    expect(page.calls, 'bypass 時に init script を仕込んではいけない').toHaveLength(0);
  } finally {
    if (previous === undefined) {
      delete process.env.E2E_AUTH_MODE;
    } else {
      process.env.E2E_AUTH_MODE = previous;
    }
  }
});
