/**
 * E2E テスト用開発者セットアップスクリプト（冪等）
 *
 * 何度実行しても安全に動作する:
 * - 既存の開発者がいれば DB から削除して再登録
 * - API キーを .env と .e2e-state.json に自動保存
 *
 * 前提条件:
 *   - バックエンドサーバー起動中 (http://localhost:3000)
 *   - PostgreSQL 起動中
 *
 * 使用方法:
 *   node scripts/setup-test-developer.js           # セットアップ
 *   node scripts/setup-test-developer.js --clean    # テストデータ削除のみ
 *
 * プログラムから使う場合:
 *   const { ensureTestDeveloper, cleanupTestDeveloper } = require('./setup-test-developer');
 */

const fs = require('fs');
const path = require('path');

// dotenv で .env を読み込み
const dotenvPath = path.join(__dirname, '..', '.env');
if (fs.existsSync(dotenvPath)) {
  require('dotenv').config({ path: dotenvPath });
}

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3000';
const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/forgepaybridge';
const TEST_EMAIL = 'e2e-test@forgepay.io';
const ENV_FILE_PATH = dotenvPath;
const STATE_FILE_PATH = path.join(__dirname, '..', '.e2e-state.json');

// ============================================================
// DB ヘルパー（pg 直接操作で確実に削除）
// ============================================================

/**
 * DB から既存テスト開発者を削除する
 * 外部キー制約に対応し、関連データも全て削除
 *
 * テーブル依存関係（マイグレーションから):
 *   developers
 *     ├── products (developer_id, CASCADE)
 *     │     ├── prices (product_id, CASCADE)
 *     │     ├── checkout_sessions (product_id, RESTRICT)
 *     │     └── entitlements (product_id, RESTRICT)
 *     ├── customers (developer_id, CASCADE)
 *     │     ├── checkout_sessions (customer_id, SET NULL)
 *     │     └── entitlements (customer_id, CASCADE)
 *     ├── checkout_sessions (developer_id, CASCADE)
 *     └── audit_logs (developer_id, SET NULL)
 *
 *   webhook_events — developer_id なし（グローバル）
 *   used_tokens    — developer_id なし（JTI ベース）
 */
async function deleteTestDeveloperFromDB() {
  const { Pool } = require('pg');
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    const client = await pool.connect();
    try {
      // テスト開発者の ID を取得
      const devResult = await client.query(
        'SELECT id FROM developers WHERE email = $1',
        [TEST_EMAIL]
      );

      if (devResult.rowCount === 0) {
        console.log('  (DB にテスト開発者なし — スキップ)');
        return false;
      }

      const developerId = devResult.rows[0].id;
      console.log(`  開発者 ID: ${developerId}`);

      // トランザクションで関連データごと削除
      await client.query('BEGIN');
      try {
        // 外部キー制約を考慮した削除順序:
        // 1. 末端テーブルから先に削除（RESTRICT 制約を回避）
        // 2. CASCADE 設定のテーブルは親削除時に自動削除されるが、明示的に削除する

        // entitlements は customer_id (CASCADE) と product_id (RESTRICT) を持つ
        // → 先に削除しないと products の削除が RESTRICT で失敗する
        const entResult = await client.query(
          `DELETE FROM entitlements WHERE customer_id IN (
            SELECT id FROM customers WHERE developer_id = $1
          )`,
          [developerId]
        );
        logDeleteCount('entitlements', entResult.rowCount);

        // checkout_sessions は developer_id (CASCADE), product_id (RESTRICT), price_id (RESTRICT)
        const csResult = await client.query(
          'DELETE FROM checkout_sessions WHERE developer_id = $1',
          [developerId]
        );
        logDeleteCount('checkout_sessions', csResult.rowCount);

        // prices は product_id (CASCADE) だが、明示的に削除
        const prResult = await client.query(
          `DELETE FROM prices WHERE product_id IN (
            SELECT id FROM products WHERE developer_id = $1
          )`,
          [developerId]
        );
        logDeleteCount('prices', prResult.rowCount);

        // products
        const pdResult = await client.query(
          'DELETE FROM products WHERE developer_id = $1',
          [developerId]
        );
        logDeleteCount('products', pdResult.rowCount);

        // customers
        const cuResult = await client.query(
          'DELETE FROM customers WHERE developer_id = $1',
          [developerId]
        );
        logDeleteCount('customers', cuResult.rowCount);

        // audit_logs（SET NULL なので削除しなくてもいいが、テストデータはクリーンに）
        const alResult = await client.query(
          'DELETE FROM audit_logs WHERE developer_id = $1',
          [developerId]
        );
        logDeleteCount('audit_logs', alResult.rowCount);

        // 最後に開発者本体を削除
        await client.query('DELETE FROM developers WHERE id = $1', [developerId]);
        console.log('  developers: 1 件削除');

        await client.query('COMMIT');
        return true;
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/** 削除件数のログ出力（0 件はスキップ） */
function logDeleteCount(table, count) {
  if (count && count > 0) {
    console.log(`  ${table}: ${count} 件削除`);
  }
}

// ============================================================
// ファイル更新ヘルパー
// ============================================================

/**
 * .env ファイルの TEST_API_KEY を更新
 */
function updateEnvFile(apiKey) {
  try {
    let envContent = '';
    if (fs.existsSync(ENV_FILE_PATH)) {
      envContent = fs.readFileSync(ENV_FILE_PATH, 'utf8');
    }

    const regex = /^TEST_API_KEY=.*$/m;
    const newLine = `TEST_API_KEY=${apiKey}`;

    if (regex.test(envContent)) {
      envContent = envContent.replace(regex, newLine);
    } else {
      envContent = envContent.trimEnd() + '\n' + newLine + '\n';
    }

    fs.writeFileSync(ENV_FILE_PATH, envContent);
    console.log('  .env — TEST_API_KEY 更新済み');
    return true;
  } catch (error) {
    console.error('  .env 更新失敗:', error.message);
    return false;
  }
}

/**
 * .e2e-state.json にテスト状態を保存（Playwright globalSetup 用）
 */
function saveStateFile(data) {
  try {
    fs.writeFileSync(STATE_FILE_PATH, JSON.stringify(data, null, 2));
    console.log('  .e2e-state.json — 保存済み');
    return true;
  } catch (error) {
    console.error('  .e2e-state.json 保存失敗:', error.message);
    return false;
  }
}

/**
 * .e2e-state.json を読み取る
 */
function loadStateFile() {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      return JSON.parse(fs.readFileSync(STATE_FILE_PATH, 'utf8'));
    }
  } catch {
    // 読み込み失敗は無視
  }
  return null;
}

/**
 * .e2e-state.json を削除する
 */
function removeStateFile() {
  try {
    if (fs.existsSync(STATE_FILE_PATH)) {
      fs.unlinkSync(STATE_FILE_PATH);
    }
  } catch {
    // 削除失敗は無視
  }
}

// ============================================================
// サーバーヘルスチェック
// ============================================================

/**
 * サーバーが起動するまで待機（リトライ付き）
 */
async function waitForServer(maxRetries = 15, intervalMs = 2000) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const response = await fetch(`${API_BASE_URL}/health`);
      if (response.ok) {
        return true;
      }
    } catch {
      // 接続失敗は想定内
    }
    if (i < maxRetries) {
      console.log(`  サーバー待機中... (${i}/${maxRetries})`);
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
  throw new Error(
    `サーバーに接続できません (${API_BASE_URL})。\n` +
    '  バックエンドを起動してください: npm run dev'
  );
}

// ============================================================
// メイン処理
// ============================================================

/**
 * テスト開発者を確実にセットアップする（冪等）
 *
 * 1. サーバーヘルスチェック
 * 2. 開発者登録を試みる
 * 3. 409 (既存) なら DB から削除して再登録
 * 4. API キーを .env と .e2e-state.json に保存
 * 5. API キーが有効か検証
 *
 * @returns {{ apiKey: string, developerId: string, email: string }}
 */
async function ensureTestDeveloper() {
  console.log('=== E2E テスト開発者セットアップ ===\n');

  // Step 1: サーバーヘルスチェック
  console.log('[1/5] サーバーヘルスチェック...');
  await waitForServer();
  console.log('  OK\n');

  // Step 2: 開発者登録を試みる
  console.log('[2/5] 開発者登録...');
  let registerResponse = await fetch(`${API_BASE_URL}/api/v1/onboarding/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: TEST_EMAIL, testMode: true }),
  });

  // Step 3: 既存なら削除して再登録
  if (registerResponse.status === 409) {
    console.log('  既存開発者を検出 — 自動削除して再登録します\n');

    console.log('[3/5] 既存データ削除...');
    await deleteTestDeveloperFromDB();
    console.log('');

    console.log('  再登録中...');
    registerResponse = await fetch(`${API_BASE_URL}/api/v1/onboarding/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, testMode: true }),
    });
  } else {
    console.log('  新規登録\n');
    console.log('[3/5] (既存データなし — スキップ)\n');
  }

  if (!registerResponse.ok) {
    const error = await registerResponse.text();
    throw new Error(`登録失敗 (${registerResponse.status}): ${error}`);
  }

  const registerData = await registerResponse.json();
  const apiKey = registerData.apiKey.key;
  const developerId = registerData.developer.id;

  console.log(`  開発者 ID: ${developerId}`);
  console.log(`  Email:     ${TEST_EMAIL}`);
  console.log('');

  // Step 4: API キーを保存
  console.log('[4/5] API キー保存...');
  console.log('');
  console.log('  ┌──────────────────────────────────────────────────┐');
  console.log(`  │ API Key: ${apiKey} │`);
  console.log('  └──────────────────────────────────────────────────┘');
  console.log('');

  updateEnvFile(apiKey);
  saveStateFile({
    apiKey,
    developerId,
    email: TEST_EMAIL,
    createdAt: new Date().toISOString(),
  });
  console.log('');

  // Step 5: API キー検証
  console.log('[5/5] API キー検証...');
  const verifyResponse = await fetch(`${API_BASE_URL}/api/v1/onboarding/me`, {
    headers: { 'X-API-Key': apiKey },
  });

  if (verifyResponse.ok) {
    const meData = await verifyResponse.json();
    const dev = meData.developer || meData;
    console.log(`  開発者 ID: ${dev.id}`);
    console.log(`  テストモード: ${dev.testMode ?? dev.test_mode}`);
    console.log('  OK\n');
  } else {
    const errorData = await verifyResponse.json().catch(() => ({}));
    throw new Error(`API キー検証失敗: ${errorData.error?.message || verifyResponse.status}`);
  }

  console.log('=== セットアップ完了 ===\n');

  return { apiKey, developerId, email: TEST_EMAIL };
}

/**
 * テスト開発者のデータを全て削除する（クリーンアップ）
 */
async function cleanupTestDeveloper() {
  console.log('=== E2E テストデータ クリーンアップ ===\n');

  try {
    await deleteTestDeveloperFromDB();
    removeStateFile();
    console.log('\nクリーンアップ完了\n');
  } catch (error) {
    console.error('クリーンアップ失敗:', error.message);
    throw error;
  }
}

// ============================================================
// CLI 実行
// ============================================================

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--clean') || args.includes('--cleanup')) {
    cleanupTestDeveloper()
      .then(() => process.exit(0))
      .catch(() => process.exit(1));
  } else {
    ensureTestDeveloper()
      .then(() => process.exit(0))
      .catch(error => {
        console.error('\n❌ セットアップ失敗:', error.message);
        process.exit(1);
      });
  }
}

// プログラム利用向けエクスポート
module.exports = {
  ensureTestDeveloper,
  cleanupTestDeveloper,
  loadStateFile,
  removeStateFile,
  waitForServer,
  TEST_EMAIL,
  API_BASE_URL,
  STATE_FILE_PATH,
};
