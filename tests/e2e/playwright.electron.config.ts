import path from 'node:path';
import { defineConfig } from '@playwright/test';

const repositoryRoot = process.cwd();

export default defineConfig({
  testDir: '.',
  testMatch: [
    'app-flows.spec.ts',
    'atomic-task-calendar.spec.ts',
    'email-compose-tab-order.spec.ts',
    'crud-workflows.spec.ts',
    'tasks-products.spec.ts',
    'edit-flows.spec.ts',
    'followup-calendar-customfields.spec.ts',
    'remaining-flows.spec.ts',
    'workflow-parity-manual.spec.ts',
  ],
  timeout: 120_000,
  // Keep one worker to bound Electron/SQLite resource usage on CI runners.
  // Each suite still receives its own temporary userData directory.
  workers: 1,
  expect: {
    timeout: 10_000,
  },
  reporter: process.env.CI
    ? [['list'], ['html', { outputFolder: path.join(repositoryRoot, 'playwright-report'), open: 'never' }]]
    : [['list']],
  outputDir: path.join(repositoryRoot, 'test-results'),
  use: {
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
});
