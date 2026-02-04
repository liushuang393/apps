/**
 * Jest Configuration Template
 * 
 * このファイルを新プロジェクトのルートディレクトリにコピーしてください。
 * Copy this file to the root directory of your new project.
 * 
 * 必要に応じて以下を変更:
 * - testMatch: テストファイルのパターン
 * - collectCoverageFrom: カバレッジ除外ファイル
 * - coverageThreshold: カバレッジ閾値
 */

module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  
  // テストファイルのマッチパターン
  testMatch: [
    '**/src/__tests__/unit/**/*.test.ts',
    '**/src/__tests__/integration/**/*.test.ts',
    '**/src/__tests__/e2e/**/*.e2e.test.ts',
  ],
  
  // 除外パターン（Playwrightは別実行）
  testPathIgnorePatterns: [
    '/node_modules/',
    '/src/__tests__/e2e/playwright/',
  ],
  
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  
  // カバレッジ計測対象
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/types/**',
    '!src/__tests__/**',
    // ブートストラップファイル（統合テストでカバー）
    '!src/app.ts',
    '!src/index.ts',
    // バレルファイル（再エクスポートのみ）
    '!src/middleware/index.ts',
    '!src/repositories/index.ts',
    '!src/services/index.ts',
    '!src/routes/index.ts',
    // 設定ファイル（起動時にロード）
    '!src/config/redis.ts',
    '!src/config/swagger.ts',
    '!src/config/database.ts',
    '!src/config/index.ts',
  ],
  
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
  testTimeout: 10000,
  
  // カバレッジ閾値（プロジェクトに応じて調整）
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
};
