#!/usr/bin/env node
/**
 * Fail if mail-module coverage regresses below the committed baseline, or if the
 * baseline is stale (more than 2 points below the measured value).
 * Run after: pnpm run test:mail
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runRatchetCli } from './lib/coverage-ratchet.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

runRatchetCli({
  label: 'Mail',
  defaultSummaryPath: path.join(root, 'coverage/mail/coverage-summary.json'),
  defaultBaselinePath: path.join(root, 'mail-coverage-baseline.json'),
  measureCommand: 'pnpm run test:mail',
  updateCommand: 'pnpm run test:mail:coverage:update-baseline',
});
