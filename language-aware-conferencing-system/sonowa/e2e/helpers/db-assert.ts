/**
 * Sonowa MVP DB 整合性 assertion helper
 *
 * test 中 / 後の DB 状態を「意味的」に検証する。
 * 直接 SQL を spec に書かない（保守性 / セキュリティ）。
 *
 * 設計:
 *   - 各 assert は scripts/reset_db.py と同じ E2E_DB_URL を読む
 *   - sqlite3 / postgres を adapter ごとに判別
 *   - spec の test 内で呼ぶ:
 *       await expectDbRowCount("users", 3);
 *       await expectDbValue("orders", { id: "o1" }, "status", "paid");
 *
 * 境界:
 *   - DB 状態は test の責務、helper は「直接 SQL を spec から隔離」
 *
 * 制約:
 *   - テーブル名 / カラム名は正規表現で validate (SQL injection 防止)
 *   - 直接 SQL execute は禁止、構造化 query のみ
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { expect } from '@playwright/test';
import { resolveAppE2ERoot } from './app-root';

const APP_E2E_ROOT = resolveAppE2ERoot();
const SAFE_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

function runPyHelper(sqlOp: string, payload: object): { ok: boolean; out: string } {
  const pythonBin = process.env.E2E_APP_PYTHON ?? process.env.E2E_PYTHON ?? 'python';
  const helperPath = path.join(APP_E2E_ROOT, 'scripts', 'db_query.py');
  const result = spawnSync(
    pythonBin,
    [helperPath, '--op', sqlOp, '--json', JSON.stringify(payload)],
    {
      cwd: APP_E2E_ROOT,
      encoding: 'utf-8',
      env: process.env,
    },
  );
  return { ok: result.status === 0, out: (result.stdout || '') + (result.stderr || '') };
}

function validateName(name: string, kind: string): void {
  if (!SAFE_NAME.test(name)) {
    throw new Error(`[db-assert] 不正な ${kind} 名 (英数字+_のみ): ${name}`);
  }
}

/** テーブルの行数を検証。 */
export async function expectDbRowCount(
  table: string,
  expected: number,
  where?: Record<string, unknown>,
): Promise<void> {
  validateName(table, 'テーブル');
  if (where) {
    for (const k of Object.keys(where)) validateName(k, 'カラム');
  }
  const { ok, out } = runPyHelper('count', { table, where: where ?? {} });
  if (!ok) throw new Error(`[db-assert] count 失敗: ${out}`);
  const m = out.match(/COUNT=(\d+)/);
  if (!m) throw new Error(`[db-assert] count 出力解析不能: ${out}`);
  const actual = parseInt(m[1], 10);
  expect(actual, `${table} 行数`).toBe(expected);
}

/** 特定行のカラム値を検証。 */
export async function expectDbValue(
  table: string,
  where: Record<string, unknown>,
  column: string,
  expected: unknown,
): Promise<void> {
  validateName(table, 'テーブル');
  validateName(column, 'カラム');
  for (const k of Object.keys(where)) validateName(k, 'カラム');
  const { ok, out } = runPyHelper('get', { table, where, column });
  if (!ok) throw new Error(`[db-assert] get 失敗: ${out}`);
  const m = out.match(/VALUE=(.+)$/m);
  if (!m) throw new Error(`[db-assert] get 出力解析不能: ${out}`);
  const actual = JSON.parse(m[1]);
  expect(actual, `${table}.${column}`).toEqual(expected);
}

/** 行が存在することを検証。 */
export async function expectDbExists(table: string, where: Record<string, unknown>): Promise<void> {
  validateName(table, 'テーブル');
  for (const k of Object.keys(where)) validateName(k, 'カラム');
  const { ok, out } = runPyHelper('count', { table, where });
  if (!ok) throw new Error(`[db-assert] exists 失敗: ${out}`);
  const m = out.match(/COUNT=(\d+)/);
  const actual = m ? parseInt(m[1], 10) : 0;
  expect(actual, `${table} に該当行`).toBeGreaterThan(0);
}
