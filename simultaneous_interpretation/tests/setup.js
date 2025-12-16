/**
 * Jest テストセットアップファイル
 *
 * @description
 * 全てのテストの前に実行される共通設定
 */

// TextEncoder/TextDecoder polyfill for Node.js
const { TextEncoder, TextDecoder } = require('util');
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// グローバルタイムアウトを設定
jest.setTimeout(10000);

// コンソール出力を抑制（テスト中）
global.console = {
    ...console,
    // console.log を無効化（テスト出力をクリーンに保つ）
    log: jest.fn(),
    debug: jest.fn(),
    info: jest.fn(),
    // エラーと警告は保持
    warn: console.warn,
    error: console.error,
};

