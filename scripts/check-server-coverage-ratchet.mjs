#!/usr/bin/env node
/**
 * Fail if server-edition coverage regresses below the committed baseline, or if the
 * baseline is stale (more than 2 points below the measured value).
 * Run after: pnpm run test:server:coverage
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runRatchetCli } from './lib/coverage-ratchet.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

runRatchetCli({
  label: 'Server',
  defaultSummaryPath: path.join(root, 'coverage/server/coverage-summary.json'),
  defaultBaselinePath: path.join(root, 'server-coverage-baseline.json'),
  measureCommand: 'pnpm run test:server:coverage',
  updateCommand: 'pnpm run test:server:coverage:update-baseline',
});
