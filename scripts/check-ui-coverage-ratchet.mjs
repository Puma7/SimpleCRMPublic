#!/usr/bin/env node
/**
 * Fail if email-UI coverage regresses below the committed baseline, or if the
 * baseline is stale (more than 2 points below the measured value).
 * Run after: pnpm run test:ui:coverage
 */
import path from 'path';
import { fileURLToPath } from 'url';
import { runRatchetCli } from './lib/coverage-ratchet.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

runRatchetCli({
  label: 'Email UI',
  defaultSummaryPath: path.join(root, 'coverage/ui/coverage-summary.json'),
  defaultBaselinePath: path.join(root, 'ui-coverage-baseline.json'),
  measureCommand: 'pnpm run test:ui:coverage',
  updateCommand: 'pnpm run test:ui:coverage:update-baseline',
});
