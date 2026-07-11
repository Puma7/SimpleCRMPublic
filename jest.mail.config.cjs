/** Standalone Jest config: mail module tests + 100% coverage on electron/email. */
const path = require('path');

/** @type {import('jest').Config} */
module.exports = {
  displayName: 'mail',
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/electron', '<rootDir>/shared', '<rootDir>/tests'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^@shared/(.*)$': '<rootDir>/shared/$1',
    '^@simplecrm/core$': '<rootDir>/packages/core/src',
    '^@simplecrm/core/(.*)$': '<rootDir>/packages/core/src/$1',
    '^keytar$': '<rootDir>/tests/setup/keytar-mock.ts',
    '^kysely$': '<rootDir>/tests/setup/kysely-mock.ts',
  },
  testMatch: [
    '<rootDir>/tests/mail/**/*.test.ts',
    '<rootDir>/tests/unit/email*.test.ts',
    '<rootDir>/tests/unit/imap*.test.ts',
    '<rootDir>/tests/unit/pop3*.test.ts',
    '<rootDir>/tests/unit/mail-*.test.ts',
    '<rootDir>/tests/unit/cron*.test.ts',
    '<rootDir>/tests/unit/workflow-trigger*.test.ts',
    '<rootDir>/tests/unit/workflow-inbound*.test.ts',
    '<rootDir>/tests/unit/workflow-scheduled*.test.ts',
    '<rootDir>/tests/unit/workflow-spam*.test.ts',
    '<rootDir>/tests/unit/workflow-sender*.test.ts',
    '<rootDir>/tests/unit/workflow-logic*.test.ts',
    '<rootDir>/tests/unit/workflow-ai-score*.test.ts',
    '<rootDir>/tests/unit/delayed-jobs*.test.ts',
    '<rootDir>/tests/unit/sync-info*.test.ts',
    '<rootDir>/tests/unit/customer-email*.test.ts',
    '<rootDir>/tests/unit/email-forward-copy.test.ts',
    '<rootDir>/tests/unit/rspamd-url.test.ts',
  ],
  setupFiles: ['<rootDir>/tests/setup/jest.mail.electron-mock.ts'],
  setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      // isolatedModules is set in tsconfig.electron.json.
      { tsconfig: '<rootDir>/tsconfig.electron.json' },
    ],
  },
  collectCoverage: true,
  coverageProvider: 'v8',
  coverageDirectory: path.join(__dirname, 'coverage/mail'),
  coverageReporters: ['text', 'lcov', 'json-summary'],
  collectCoverageFrom: ['electron/email/**/*.ts', '!electron/email/**/*.d.ts'],
  coveragePathIgnorePatterns: [
    '/node_modules/',
    '/dist/',
    '/dist-electron/',
    '/coverage/',
  ],
  coverageThreshold: {
    global: {
      statements: 90,
      branches: 80,
      functions: 93,
      lines: 90,
    },
  },
};
