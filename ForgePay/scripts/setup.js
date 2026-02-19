#!/usr/bin/env node
/**
 * ForgePay インタラクティブセットアップスクリプト
 *
 * 初回セットアップを対話形式でガイドする:
 * 1. .env ファイルの生成
 * 2. Stripe キーの入力
 * 3. JWT シークレットの自動生成
 * 4. Docker 起動 + マイグレーション実行
 * 5. 開発者アカウント登録（API キー取得）
 *
 * 使用方法:
 *   node scripts/setup.js
 *   npm run setup
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { execSync, spawn } = require('child_process');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const ENV_PATH = path.join(ROOT, '.env');
const ENV_EXAMPLE_PATH = path.join(ROOT, '.env.example');
const API_BASE_URL = 'http://localhost:3000';

// ──────────────────────────────────────────────
// ユーティリティ
// ──────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

/** プロンプト（Promise ラッパー） */
function prompt(question, defaultValue = '') {
  return new Promise((resolve) => {
    const hint = defaultValue ? ` [${defaultValue}]` : '';
    rl.question(`${question}${hint}: `, (answer) => {
      resolve(answer.trim() || defaultValue);
    });
  });
}

/** シークレットプロンプト（入力を非表示） */
function promptSecret(question) {
  return new Promise((resolve) => {
    process.stdout.write(`${question}: `);
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');

    let value = '';
    stdin.on('data', function handler(char) {
      if (char === '\r' || char === '\n') {
        stdin.removeListener('data', handler);
        stdin.setRawMode(false);
        stdin.pause();
        process.stdout.write('\n');
        resolve(value);
      } else if (char === '\u0003') {
        // Ctrl+C
        process.exit(0);
      } else if (char === '\u007f') {
        // バックスペース
        if (value.length > 0) {
          value = value.slice(0, -1);
          process.stdout.clearLine(0);
          process.stdout.cursorTo(0);
          process.stdout.write(`${question}: ${'*'.repeat(value.length)}`);
        }
      } else {
        value += char;
        process.stdout.write('*');
      }
    });
  });
}

/** 色付きログ */
const log = {
  info: (msg) => console.log(`\x1b[36m  ℹ ${msg}\x1b[0m`),
  ok: (msg) => console.log(`\x1b[32m  ✔ ${msg}\x1b[0m`),
  warn: (msg) => console.log(`\x1b[33m  ⚠ ${msg}\x1b[0m`),
  error: (msg) => console.log(`\x1b[31m  ✘ ${msg}\x1b[0m`),
  step: (n, total, msg) => console.log(`\n\x1b[1m[${n}/${total}] ${msg}\x1b[0m`),
  divider: () => console.log(`\n${'─'.repeat(60)}`),
};

/** コマンド実行 */
function exec(cmd, options = {}) {
  try {
    return execSync(cmd, { cwd: ROOT, stdio: 'inherit', ...options });
  } catch {
    return null;
  }
}

/** HTTP リクエスト */
async function httpPost(url, body) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, data: await res.json() };
}

/** サーバー起動待機 */
async function waitForServer(maxRetries = 20, intervalMs = 2000) {
  for (let i = 1; i <= maxRetries; i++) {
    try {
      const res = await fetch(`${API_BASE_URL}/health`);
      if (res.ok) return true;
    } catch { /* 接続失敗は想定内 */ }
    process.stdout.write(i === 1 ? '  サーバー起動待機中 ' : '.');
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  process.stdout.write('\n');
  return false;
}

// ──────────────────────────────────────────────
// メイン処理
// ──────────────────────────────────────────────

async function main() {
  console.clear();
  console.log('\x1b[1m\x1b[35m');
  console.log('  ███████╗ ██████╗ ██████╗  ██████╗ ███████╗██████╗  █████╗ ██╗   ██╗');
  console.log('  ██╔════╝██╔═══██╗██╔══██╗██╔════╝ ██╔════╝██╔══██╗██╔══██╗╚██╗ ██╔╝');
  console.log('  █████╗  ██║   ██║██████╔╝██║  ███╗█████╗  ██████╔╝███████║ ╚████╔╝ ');
  console.log('  ██╔══╝  ██║   ██║██╔══██╗██║   ██║██╔══╝  ██╔═══╝ ██╔══██║  ╚██╔╝  ');
  console.log('  ██║     ╚██████╔╝██║  ██║╚██████╔╝███████╗██║     ██║  ██║   ██║   ');
  console.log('  ╚═╝      ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚══════╝╚═╝     ╚═╝  ╚═╝   ╚═╝  ');
  console.log('\x1b[0m');
  console.log('  セットアップウィザードへようこそ\n');

  const TOTAL_STEPS = 5;

  // ──────────────────────────────────────────────
  // Step 1: .env ファイルの生成
  // ──────────────────────────────────────────────
  log.step(1, TOTAL_STEPS, '.env ファイルの設定');

  if (fs.existsSync(ENV_PATH)) {
    const overwrite = await prompt('  .env ファイルが既に存在します。上書きしますか？ (y/N)', 'N');
    if (overwrite.toLowerCase() !== 'y') {
      log.info('.env ファイルの上書きをスキップしました');
    } else {
      await createEnvFile();
    }
  } else {
    await createEnvFile();
  }

  // ──────────────────────────────────────────────
  // Step 2: Docker 起動
  // ──────────────────────────────────────────────
  log.step(2, TOTAL_STEPS, 'Docker (PostgreSQL + Redis) の起動');

  const dockerCheck = exec('docker info', { stdio: 'ignore' });
  if (dockerCheck === null) {
    log.warn('Docker が起動していません。手動で PostgreSQL と Redis を起動してください。');
  } else {
    log.info('PostgreSQL + Redis を起動します...');
    exec('npm run docker:up');
    log.ok('Docker コンテナ起動完了');
    // DB が準備されるまで少し待機
    await new Promise((r) => setTimeout(r, 3000));
  }

  // ──────────────────────────────────────────────
  // Step 3: DB マイグレーション
  // ──────────────────────────────────────────────
  log.step(3, TOTAL_STEPS, 'データベースマイグレーション');
  log.info('マイグレーションを実行します...');
  exec('npm run migrate:up');
  log.ok('マイグレーション完了');

  // ──────────────────────────────────────────────
  // Step 4: バックエンドサーバー起動
  // ──────────────────────────────────────────────
  log.step(4, TOTAL_STEPS, 'バックエンドサーバーの起動確認');

  let serverReady = false;
  try {
    const res = await fetch(`${API_BASE_URL}/health`);
    if (res.ok) {
      serverReady = true;
      log.ok('バックエンドサーバーはすでに起動しています');
    }
  } catch { /* 未起動 */ }

  if (!serverReady) {
    log.info('バックエンドサーバーを起動します...');
    const devProcess = spawn('npm', ['run', 'dev'], {
      cwd: ROOT,
      detached: true,
      stdio: 'ignore',
    });
    devProcess.unref();

    serverReady = await waitForServer();
    if (serverReady) {
      process.stdout.write('\n');
      log.ok('バックエンドサーバー起動完了');
    } else {
      log.error('サーバーの起動がタイムアウトしました。');
      log.info('別のターミナルで npm run dev を実行してから再試行してください。');
      rl.close();
      process.exit(1);
    }
  }

  // ──────────────────────────────────────────────
  // Step 5: 開発者登録（API キー取得）
  // ──────────────────────────────────────────────
  log.step(5, TOTAL_STEPS, '開発者アカウントの登録');

  const email = await prompt('  メールアドレスを入力してください');
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    log.error('有効なメールアドレスを入力してください。');
    rl.close();
    process.exit(1);
  }

  const { status, data } = await httpPost(`${API_BASE_URL}/api/v1/onboarding/register`, {
    email,
    testMode: true,
  });

  if (status === 409) {
    log.warn('このメールアドレスはすでに登録済みです。');
    log.info('API キーを忘れた場合: POST /api/v1/onboarding/forgot-key でメール再送できます。');
    rl.close();
    process.exit(0);
  }

  if (status !== 201) {
    log.error(`登録失敗 (${status}): ${data.error || JSON.stringify(data)}`);
    rl.close();
    process.exit(1);
  }

  const apiKey = data.apiKey.key;

  // .env の TEST_API_KEY を更新
  updateEnvKey('TEST_API_KEY', apiKey);

  // ──────────────────────────────────────────────
  // 完了メッセージ
  // ──────────────────────────────────────────────
  log.divider();
  console.log('\n\x1b[1m\x1b[32m  ✅ セットアップ完了！\x1b[0m\n');

  console.log('  ┌─────────────────────────────────────────────────────┐');
  console.log(`  │  Email :  ${email.padEnd(43)} │`);
  console.log(`  │  API Key: ${apiKey.padEnd(43)} │`);
  console.log('  └─────────────────────────────────────────────────────┘');
  console.log('');
  console.log('  \x1b[33m⚠️  この API キーは一度しか表示されません。今すぐ保存してください。\x1b[0m');
  console.log('');
  console.log('  次のステップ:');
  console.log('  1. ダッシュボード起動: cd dashboard && npm run dev');
  console.log(`  2. ブラウザで http://localhost:3001 を開く`);
  console.log('  3. 上記の API キーでログイン');
  console.log('  4. Settings → Stripe API Keys で Stripe を接続');
  console.log('');
  log.divider();

  rl.close();
}

// ──────────────────────────────────────────────
// .env ファイル生成
// ──────────────────────────────────────────────

async function createEnvFile() {
  log.info('Stripe キーを入力してください（Stripe Dashboard → Developers → API keys）');
  log.info('テスト用は https://dashboard.stripe.com/test/apikeys から取得できます\n');

  const stripeSecretKey = await prompt('  Stripe Secret Key (sk_test_...)', '');
  const stripePublishableKey = await prompt('  Stripe Publishable Key (pk_test_...)', '');
  const stripeWebhookSecret = await prompt('  Stripe Webhook Secret (whsec_... / 後で設定可)', '');
  const jwtSecret = crypto.randomBytes(32).toString('hex');

  log.info(`JWT シークレットを自動生成しました`);

  // .env.example が存在する場合はそれをベースにする
  let envContent = '';
  if (fs.existsSync(ENV_EXAMPLE_PATH)) {
    envContent = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');
    envContent = envContent
      .replace(/^DATABASE_URL=.*$/m, `DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forgepaybridge`)
      .replace(/^STRIPE_TEST_SECRET_KEY=.*$/m, `STRIPE_TEST_SECRET_KEY=${stripeSecretKey}`)
      .replace(/^STRIPE_TEST_PUBLISHABLE_KEY=.*$/m, `STRIPE_TEST_PUBLISHABLE_KEY=${stripePublishableKey}`)
      .replace(/^STRIPE_TEST_WEBHOOK_SECRET=.*$/m, `STRIPE_TEST_WEBHOOK_SECRET=${stripeWebhookSecret}`)
      .replace(/^JWT_SECRET=.*$/m, `JWT_SECRET=${jwtSecret}`);
  } else {
    envContent = `NODE_ENV=development
PORT=3000
API_BASE_URL=http://localhost:3000
STRIPE_MODE=test
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/forgepaybridge
DATABASE_POOL_MIN=2
DATABASE_POOL_MAX=10
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=
STRIPE_TEST_SECRET_KEY=${stripeSecretKey}
STRIPE_TEST_PUBLISHABLE_KEY=${stripePublishableKey}
STRIPE_TEST_WEBHOOK_SECRET=${stripeWebhookSecret}
JWT_SECRET=${jwtSecret}
JWT_EXPIRES_IN=5m
LOG_LEVEL=info
LOG_FORMAT=json
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=100
EMAIL_PROVIDER=console
EMAIL_FROM=noreply@forgepay.io
DASHBOARD_URL=http://localhost:3001
TEST_API_KEY=
`;
  }

  fs.writeFileSync(ENV_PATH, envContent);
  log.ok('.env ファイルを生成しました');
}

/** .env の特定キーを更新 */
function updateEnvKey(key, value) {
  if (!fs.existsSync(ENV_PATH)) return;
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content += `\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, content);
}

main().catch((err) => {
  console.error('\n\x1b[31mセットアップ失敗:', err.message, '\x1b[0m');
  rl.close();
  process.exit(1);
});
