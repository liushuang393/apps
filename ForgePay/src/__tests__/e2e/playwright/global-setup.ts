/**
 * Playwright グローバルセットアップ
 *
 * 全テスト実行前に一度だけ走る:
 * 1. サーバーヘルスチェック
 * 2. テスト開発者の登録（冪等 — 既存なら削除→再登録）
 * 3. API キーを .e2e-state.json と .env に保存
 *
 * これにより、手動で setup-test-developer.js を実行する必要がなくなる。
 */
import path from 'path';

const SETUP_SCRIPT = path.resolve(__dirname, '../../../../scripts/setup-test-developer.js');

async function globalSetup() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║  Playwright E2E — グローバルセットアップ  ║');
  console.log('╚══════════════════════════════════════╝\n');

  // setup-test-developer.js をプログラム的に呼び出す
  const { ensureTestDeveloper } = require(SETUP_SCRIPT);
  const result = await ensureTestDeveloper();

  // process.env に設定（Playwright worker に渡る）
  process.env.TEST_API_KEY = result.apiKey;

  console.log('globalSetup 完了 — テスト開始\n');
}

export default globalSetup;
