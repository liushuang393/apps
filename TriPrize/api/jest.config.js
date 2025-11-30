module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src', '<rootDir>/tests'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.interface.ts',
    '!src/**/index.ts',
  ],
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  testTimeout: 30000, // 增加到30秒,因为webhook测试需要更多时间
  setupFilesAfterEnv: ['<rootDir>/tests/setup.ts'],
  // Fix for "Cannot read properties of undefined (reading 'onlyChanged')" error
  watchman: false,
  // Disable git-related features
  changedSince: undefined,
  onlyChanged: false,
};
