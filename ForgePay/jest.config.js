module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  // All tests are in src/__tests__/ folder
  testMatch: [
    '**/src/__tests__/unit/**/*.test.ts',
    '**/src/__tests__/integration/**/*.test.ts',
    '**/src/__tests__/e2e/**/*.e2e.test.ts',
  ],
  testPathIgnorePatterns: [
    '/node_modules/',
    '/src/__tests__/e2e/playwright/',  // Playwright tests run separately
  ],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.test.ts',
    '!src/**/*.spec.ts',
    '!src/types/**',
    '!src/__tests__/**',
    // Bootstrap files - tested via integration tests
    '!src/app.ts',
    '!src/index.ts',
    // Export barrel files - re-exports only, no logic to test
    '!src/middleware/index.ts',
    '!src/repositories/index.ts',
    '!src/services/index.ts',
    '!src/routes/index.ts',
    // Config files - loaded at startup, tested via integration
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
  // Coverage threshold - 95% target achieved
  // Note: Bootstrap files (app.ts, index.ts, config/*) are excluded from coverage
  // and tested via integration tests
  coverageThreshold: {
    global: {
      branches: 95,
      functions: 95,
      lines: 95,
      statements: 95,
    },
  },
};
