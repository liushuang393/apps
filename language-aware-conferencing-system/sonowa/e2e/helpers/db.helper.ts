/**
 * Sonowa MVP DB 検証 helper
 *
 * 同一 app の scripts/db_query.py（--op count|get）を呼び、業務結果を DB で検証する。
 * 「UI だけで成功判定しない（UI/API/DB/Audit のうち最低 2 点）」原則の DB 軸を担う。
 * E2E_DB_URL 未設定なら CLI 側で fail-closed。
 *
 * 注: __dirname / import.meta.url 非依存（CJS/ESM 両対応）。CWD は playwright が config dir に切替。
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { expect } from '@playwright/test';
import { resolveAppE2ERoot } from './app-root';

const APP_E2E_ROOT = resolveAppE2ERoot();

function runDbQuery(args: string[]): string {
  const pythonBin = process.env.E2E_APP_PYTHON ?? process.env.E2E_PYTHON ?? 'python';
  const scriptPath = path.join(APP_E2E_ROOT, 'scripts', 'db_query.py');
  const result = spawnSync(pythonBin, [scriptPath, ...args], {
    cwd: APP_E2E_ROOT,
    encoding: 'utf-8',
    env: process.env,
  });
  if (result.status !== 0) {
    const stderr = result.stderr ?? '';
    const stdout = result.stdout ?? '';
    throw new Error(
      `[sonowa/db] db_query.py 失敗 (exit=${result.status})\n` +
        `stdout: ${stdout}\nstderr: ${stderr}`,
    );
  }
  return (result.stdout ?? '').trim();
}

/** table の where 条件に一致する行数を返す。 */
export function dbCount(table: string, where?: Record<string, unknown>): number {
  const payload = JSON.stringify({ table, where: where ?? {} });
  const out = runDbQuery(['--op', 'count', '--json', payload]);
  const match = out.match(/COUNT=(\d+)/);
  if (!match) {
    throw new Error(`[sonowa/db] COUNT 取得失敗: ${out}`);
  }
  return Number(match[1]);
}

/** table の where 条件に一致する最初の行の column 値を返す（無ければ null）。 */
export function dbValue(table: string, column: string, where?: Record<string, unknown>): unknown {
  const payload = JSON.stringify({ table, column, where: where ?? {} });
  const out = runDbQuery(['--op', 'get', '--json', payload]);
  const match = out.match(/VALUE=(.*)/s);
  if (!match) {
    return null;
  }
  return JSON.parse(match[1]);
}

/** 件数アサーション（業務結果の DB 反映を検証）。 */
export function expectDbCount(
  table: string,
  expected: number,
  where?: Record<string, unknown>,
): void {
  expect(dbCount(table, where)).toBe(expected);
}
