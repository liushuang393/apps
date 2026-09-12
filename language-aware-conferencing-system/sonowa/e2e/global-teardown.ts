/**
 * Sonowa MVP E2E グローバル teardown
 *
 * 全テスト終了後: baseline snapshot から DB を復元
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveAppE2ERoot } from './helpers/app-root';

const APP_E2E_ROOT = resolveAppE2ERoot();
const SNAPSHOT_PATH = path.join(APP_E2E_ROOT, '.snapshots', 'baseline.snap');

function runPython(args: string[]): void {
  const pythonBin = process.env.E2E_APP_PYTHON ?? process.env.E2E_PYTHON ?? 'python';
  const scriptPath = path.join(APP_E2E_ROOT, 'scripts', 'reset_db.py');
  const result = spawnSync(pythonBin, [scriptPath, ...args], {
    cwd: APP_E2E_ROOT,
    encoding: 'utf-8',
    env: process.env,
  });
  if (result.status !== 0) {
    console.warn(
      `[sonowa/global-teardown] reset_db ${args.join(' ')} 警告\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

async function globalTeardown(): Promise<void> {
  if (!process.env.E2E_DB_URL) {
    return;
  }
  if (!fs.existsSync(SNAPSHOT_PATH)) {
    console.warn(`[sonowa/global-teardown] snapshot 未生成: ${SNAPSHOT_PATH}`);
    return;
  }
  console.log(`[sonowa/global-teardown] restore from ${SNAPSHOT_PATH}`);
  runPython(['--restore', SNAPSHOT_PATH]);
}

export default globalTeardown;
