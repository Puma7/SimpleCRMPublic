/**
 * CI: unit + integration EINMAL mit Coverage. Deckt die Scopes von jest.server.config.cjs
 * (packages/server/src) und jest.ui.config.cjs (src/components/email) gleichzeitig ab;
 * scripts/split-coverage-summary.mjs teilt das Ergebnis danach in coverage/server und
 * coverage/ui auf, sodass die Ratchet-Skripte unverändert bleiben.
 */
const path = require('path');
const base = require('./jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  collectCoverage: true,
  coverageProvider: 'v8',
  coverageDirectory: path.join(__dirname, 'coverage/ci'),
  coverageReporters: ['text-summary', 'json-summary'],
  collectCoverageFrom: [
    'packages/server/src/**/*.ts',
    '!packages/server/src/**/*.d.ts',
    'src/components/email/**/*.{ts,tsx}',
    '!src/components/email/**/*.d.ts',
  ],
  coverageThreshold: {},
};
