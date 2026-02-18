/**
 * Playwright グローバルティアダウン
 *
 * 全テスト終了後に一度だけ走る:
 * 1. テスト開発者と関連データを DB から削除
 * 2. .e2e-state.json を削除
 *
 * CI 環境では DB が使い捨てなのでスキップ可能（SKIP_E2E_CLEANUP=true）。
 */
import path from 'path';

const SETUP_SCRIPT = path.resolve(__dirname, '../../../../scripts/setup-test-developer.js');

async function globalTeardown() {
  if (process.env.SKIP_E2E_CLEANUP === 'true') {
    console.log('\nglobalTeardown: SKIP_E2E_CLEANUP=true — スキップ\n');
    return;
  }

  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  Playwright E2E — グローバルティアダウン  ║');
  console.log('╚══════════════════════════════════════╝\n');

  try {
    const { cleanupTestDeveloper } = require(SETUP_SCRIPT);
    await cleanupTestDeveloper();
    console.log('globalTeardown 完了\n');
  } catch (error) {
    // テストが失敗していてもクリーンアップエラーで失敗にしない
    console.warn('globalTeardown 警告:', (error as Error).message);
  }
}

export default globalTeardown;
