/**
 * Standalone Jest config: server-edition coverage over packages/server/src.
 * Baseline + ratchet only (no hard threshold) — the floor is enforced by
 * scripts/check-server-coverage-ratchet.mjs against server-coverage-baseline.json.
 * Reuses the base config's `unit` + `integration` projects and only overrides
 * the coverage options to scope them to packages/server/src.
 */
const path = require('path');
const base = require('./jest.config.cjs');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  collectCoverage: true,
  coverageProvider: 'v8',
  coverageDirectory: path.join(__dirname, 'coverage/server'),
  coverageReporters: ['text-summary', 'json-summary'],
  collectCoverageFrom: [
    'packages/server/src/**/*.ts',
    '!packages/server/src/**/*.d.ts',
  ],
  // Intentionally empty: no hard global gate. The ratchet script is the floor.
  coverageThreshold: {},
};
