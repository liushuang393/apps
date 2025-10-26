/**
 * Jest 設定ファイル
 *
 * @description
 * VoiceTranslate Pro のテスト環境設定
 *
 * @features
 * - JSDOM テスト環境
 * - カバレッジレポート
 * - テストマッチパターン
 */

module.exports = {
    // TypeScript サポート
    preset: 'ts-jest',

    // テスト環境
    testEnvironment: 'jsdom',

    // テストファイルのパターン
    testMatch: [
        '**/tests/**/*.test.ts',
        '**/tests/**/*.test.js',
        '**/tests/**/*.spec.ts',
        '**/tests/**/*.spec.js'
    ],

    // カバレッジ設定
    collectCoverageFrom: [
        'src/**/*.ts',
        'src/**/*.js',
        '!src/**/*.test.ts',
        '!src/**/*.test.js',
        '!src/**/*.spec.ts',
        '!src/**/*.spec.js',
        '!src/**/*.d.ts',
        '!**/node_modules/**'
    ],

    // カバレッジレポート形式
    coverageReporters: ['text', 'text-summary', 'html', 'lcov'],

    // カバレッジ閾値
    coverageThreshold: {
        global: {
            branches: 50,
            functions: 50,
            lines: 50,
            statements: 50
        }
    },

    // セットアップファイル
    setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],

    // モジュールパス
    moduleDirectories: ['node_modules', 'src'],

    // トランスフォーム設定（ts-jest 設定を統合）
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                tsconfig: {
                    esModuleInterop: true,
                    allowSyntheticDefaultImports: true
                }
            }
        ],
        '^.+\\.js$': 'babel-jest'
    },

    // モジュール拡張子
    moduleFileExtensions: ['ts', 'js', 'json', 'node'],

    // 詳細出力
    verbose: true
};
