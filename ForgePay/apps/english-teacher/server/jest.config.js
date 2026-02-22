/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // テストファイルの場所
  testMatch: ['**/src/__tests__/**/*.test.ts'],
  // 各テストファイルの実行前に呼ぶセットアップ
  setupFilesAfterEnv: ['<rootDir>/src/__tests__/setup.ts'],
  // テストのタイムアウト（外部 API モックでも余裕を持たせる）
  testTimeout: 15000,
  // カバレッジ対象
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/__tests__/**',
    '!src/index.ts',
    '!src/db/init.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'json-summary'],
  // TypeScript 設定
  transform: {
    '^.+\\.ts$': ['ts-jest', {
      tsconfig: {
        // テスト用に rootDir 制約を緩和
        rootDir: '.',
      },
    }],
  },
  // モジュールマッピング（必要に応じて拡張）
  moduleFileExtensions: ['ts', 'js', 'json'],
  // 詳細ログ
  verbose: true,
};
