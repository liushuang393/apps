/**
 * Sonowa MVP テストデータ helper
 *
 * resetDatabase() / seedScenario() は同一 app の scripts/ 配下の Python CLI を呼ぶ。
 * E2E_DB_URL 未設定なら CLI 側で fail-closed。
 *
 * 注: 起動 CWD に依存せず app root resolver を共有する。
 */
import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import { resolveAppE2ERoot } from './app-root';

const APP_E2E_ROOT = resolveAppE2ERoot();

function runPython(scriptName: string, args: string[]): void {
  const pythonBin = process.env.E2E_APP_PYTHON ?? process.env.E2E_PYTHON ?? 'python';
  const scriptPath = path.join(APP_E2E_ROOT, 'scripts', scriptName);
  const result = spawnSync(pythonBin, [scriptPath, ...args], {
    cwd: APP_E2E_ROOT,
    encoding: 'utf-8',
    env: process.env,
  });
  if (result.status !== 0) {
    const stderr = result.stderr ?? '';
    const stdout = result.stdout ?? '';
    throw new Error(
      `[sonowa/test-data] ${scriptName} 失敗 (exit=${result.status})\n` +
        `stdout: ${stdout}\nstderr: ${stderr}`,
    );
  }
}

export async function resetDatabase(options?: { alembicIni?: string }): Promise<void> {
  const args: string[] = [];
  if (options?.alembicIni) {
    args.push('--alembic-ini', options.alembicIni);
  }
  runPython('reset_db.py', args);
}

export async function seedScenario(
  name: string,
  options?: { fixturesDir?: string },
): Promise<void> {
  const args = ['--name', name];
  if (options?.fixturesDir) {
    args.push('--fixtures-dir', options.fixturesDir);
  }
  runPython('seed.py', args);
}

export async function snapshotDatabase(snapshotPath: string): Promise<void> {
  runPython('reset_db.py', ['--snapshot', snapshotPath]);
}

export async function restoreDatabase(snapshotPath: string): Promise<void> {
  runPython('reset_db.py', ['--restore', snapshotPath]);
}
