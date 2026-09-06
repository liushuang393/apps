/**
 * LAMS MVP E2E グローバルセットアップ
 *
 * 全テスト開始前: 現在の DB を snapshot として保存
 *
 * 注: 起動 CWD に依存せず --config / E2E_APP_ROOT から app root を解決する。
 *
 * TK-028: requires_db=true なのに E2E_DB_URL 未設定なら静默 skip せず fail-closed。
 * seed_mode（準備方法）と requires_db（保存先契約）は独立して扱う。
 */
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { resolveAppE2ERoot } from './helpers/app-root';
import { resolveRuntimeProfile } from './helpers/runtime-profile';

const APP_E2E_ROOT = resolveAppE2ERoot();
const SNAPSHOT_DIR = path.join(APP_E2E_ROOT, '.snapshots');
const SNAPSHOT_PATH = path.join(SNAPSHOT_DIR, 'baseline.snap');
const runtimeProfile = resolveRuntimeProfile();

interface DataContract {
  seedMode: string;
  requiresDb: boolean;
}

function readDataContract(): DataContract {
  const tomlPath = path.join(APP_E2E_ROOT, 'app.toml');
  if (!fs.existsSync(tomlPath)) {
    return { seedMode: 'fixture', requiresDb: true };
  }
  const text = fs.readFileSync(tomlPath, 'utf-8');
  let inData = false;
  let seedMode = 'fixture';
  let requiresDb: boolean | undefined;
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (s.startsWith('[') && s.endsWith(']')) {
      inData = s === '[data]';
      continue;
    }
    if (inData && s.startsWith('seed_mode')) {
      const m = s.match(/seed_mode\s*=\s*"([^"]+)"/);
      if (m) {
        seedMode = m[1];
      }
    }
    if (inData && s.startsWith('requires_db')) {
      const m = s.match(/requires_db\s*=\s*(true|false)/);
      if (m) {
        requiresDb = m[1] === 'true';
      }
    }
  }
  return {
    seedMode,
    requiresDb: requiresDb ?? ['fixture', 'external'].includes(seedMode),
  };
}

function runPython(args: string[]): void {
  const pythonBin = process.env.E2E_APP_PYTHON ?? process.env.E2E_PYTHON ?? 'python';
  const scriptPath = path.join(APP_E2E_ROOT, 'scripts', 'reset_db.py');
  const result = spawnSync(pythonBin, [scriptPath, ...args], {
    cwd: APP_E2E_ROOT,
    encoding: 'utf-8',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(
      `[lams/global-setup] reset_db ${args.join(' ')} 失敗\n` +
        `stdout: ${result.stdout}\nstderr: ${result.stderr}`,
    );
  }
}

async function globalSetup(): Promise<void> {
  if (!runtimeProfile.runGlobalSetup) return;
  // E2E_RUN_ID 未指定なら run 毎に一意な値を既定にする。固定値（"local" 等）だと
  // 永続 DB への再実行で email/username 等の unique 制約に衝突する（forge_pay 409 実害）。
  // globalSetup での process.env 変更は worker プロセスへ引き継がれる。
  if (!process.env.E2E_RUN_ID) {
    process.env.E2E_RUN_ID = `r${Date.now().toString(36)}`;
  }
  const { seedMode, requiresDb } = readDataContract();
  if (!process.env.E2E_DB_URL) {
    if (!requiresDb || process.env.E2E_ALLOW_NO_DB === '1') {
      console.log(
        `[lams/global-setup] E2E_DB_URL 未設定 → snapshot 省略 ` +
          `(seed_mode=${seedMode}, requires_db=${requiresDb})`,
      );
      return;
    }
    throw new Error(
      `[lams/global-setup] FAIL: seed_mode=${seedMode}, requires_db=true なのに ` +
        `E2E_DB_URL 未設定。静默 skip は禁止（TK-028）。DB 無しなら app.toml で ` +
        `requires_db=false、` +
        `やむを得ない省略のみ E2E_ALLOW_NO_DB=1。`,
    );
  }
  // 「reset → seed-all → snapshot」を 1 操作で
  console.log(`[lams/global-setup] bootstrap baseline: ${SNAPSHOT_PATH}`);
  runPython(['--bootstrap-baseline', '--snapshot', SNAPSHOT_PATH]);
}

export default globalSetup;
