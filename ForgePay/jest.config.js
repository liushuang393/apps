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
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  verbose: true,
  testTimeout: 10000,
  // Coverage threshold set to 90% (target: 95%)
  // Current coverage: 92.7% - some config/app files are hard to unit test
  coverageThreshold: {
    global: {
      branches: 90,
      functions: 85,
      lines: 90,
      statements: 90,
    },
  },
};
