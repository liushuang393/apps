/**
 * Jest グローバルセットアップ
 * 全テストファイルの実行前に一度だけ読み込まれる
 *
 * 単体テストでは OpenAI・ForgePay をモックするため実際の通信は発生しない。
 * 環境変数は本番設定と同じ形式で揃えておくことで、設定漏れを早期に発見できる。
 */

process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = ':memory:';

// OpenAI API キー（テスト中は openaiService をモックするため実通信なし）
process.env.OPENAI_API_KEY = process.env.OPENAI_API_KEY ?? 'sk-test-dummy-key-for-tests';

// アプリ基本設定
process.env.APP_URL = 'http://localhost:3002';
process.env.BASE_URL = 'http://localhost:3002';
process.env.FREE_QUESTION_LIMIT = '3';
process.env.ASK_RATE_LIMIT_MAX = '100'; // テスト中はレート制限を緩く設定

// ForgePay 接続設定
// 単体テストでは forgePayService をモックするため実通信は発生しない
// 実際の登録済み API キーを使うことで、設定の整合性を確認できる
process.env.FORGEPAY_API_URL = 'http://localhost:3000';
process.env.FORGEPAY_API_KEY = 'fpb_test_Lvfh-UeROmrkGekiDQFeW1fgqTpWSihl';

// Stripe 商品の Price ID（English Teacher Premium Plan: 1,000円）
// テスト中は ForgePay をモックするため実際の決済は発生しない
process.env.STRIPE_PRICE_ID = 'price_1T3U35D2OGoEQuqPHewspuGk';
