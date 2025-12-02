/**
 * Jest environment setup file
 * 目的: モジュールがロードされる前に環境変数を設定する
 * 注意点: jest.config.js の setupFiles で指定（setupFilesAfterEnv より前に実行）
 */

// テスト環境フラグ
process.env.NODE_ENV = 'test';

// データベース接続（Docker PostgreSQL）
// 注意: この設定は docker-compose.yml と ENVIRONMENT_SETUP.md に一致する
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL || 'postgresql://triprize:triprize_password@localhost:5432/triprize';

// Redis 接続
process.env.REDIS_URL = process.env.TEST_REDIS_URL || 'redis://localhost:6379';

// JWT シークレット
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';

// Stripe テストキー（モック支払い用）
process.env.USE_MOCK_PAYMENT = 'true';
process.env.STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || 'sk_test_dummy_key_for_jest_only';
process.env.STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || 'whsec_test_secret';
