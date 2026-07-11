/**
 * Standalone Jest config: email-UI coverage over src/components/email.
 * Baseline + ratchet only (no hard threshold) — the floor is enforced by
 * scripts/check-ui-coverage-ratchet.mjs against ui-coverage-baseline.json.
 * Kept SEPARATE from jest.server.config.cjs on purpose: folding the ~96
 * mostly-untested email component files into the server scope would drag the
 * server floor down and mask a real packages/server/src regression.
 * Reuses the base config's jsdom `unit` project (where the email `.tsx` tests
 * run) and only overrides the coverage options to scope them to
 * src/components/email.
 */
const path = require('path');
const base = require('./jest.config.cjs');

const unitProject = base.projects.find((project) => project.displayName === 'unit');

/** @type {import('jest').Config} */
module.exports = {
  ...base,
  collectCoverage: true,
  coverageProvider: 'v8',
  coverageDirectory: path.join(__dirname, 'coverage/ui'),
  coverageReporters: ['text-summary', 'json-summary'],
  collectCoverageFrom: [
    'src/components/email/**/*.{ts,tsx}',
    '!src/components/email/**/*.d.ts',
  ],
  // Intentionally empty: no hard global gate. The ratchet script is the floor.
  coverageThreshold: {},
  // The email UI tests are jsdom-only; run just the `unit` project so the node
  // `integration` project (better-sqlite3) never enters this ratchet.
  projects: [unitProject],
};
