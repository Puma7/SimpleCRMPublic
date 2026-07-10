#!/usr/bin/env node
/**
 * Fail if email-UI coverage regresses below the committed baseline.
 * Run after: npm run test:ui:coverage
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const summaryPath = path.join(root, 'coverage/ui/coverage-summary.json');
const baselinePath = path.join(root, 'ui-coverage-baseline.json');

const metrics = ['statements', 'branches', 'functions', 'lines'];
const update = process.argv.includes('--update-baseline');

if (!fs.existsSync(summaryPath)) {
  console.error(`Missing ${summaryPath}. Run: npm run test:ui:coverage`);
  process.exit(1);
}

const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
const total = summary.total;
if (!total) {
  console.error('coverage-summary.json has no total');
  process.exit(1);
}

const snapshot = {};
for (const m of metrics) {
  snapshot[m] = total[m]?.pct ?? 0;
}

if (update) {
  fs.writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Updated ${baselinePath}:`, snapshot);
  process.exit(0);
}

if (!fs.existsSync(baselinePath)) {
  console.error(`Missing ${baselinePath}. Run: npm run test:ui:coverage:update-baseline`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
// Tolerance absorbs v8 coverage variance between the environment that generated
// the baseline and the environment that enforces it (e.g. a different Node/v8
// version in CI reports the same code ~0.5pt differently). It stays tight enough
// to still catch a real regression (an accidentally dropped test file moves
// coverage by whole points, not fractions).
const TOLERANCE = 1;
let failed = false;
for (const m of metrics) {
  const current = snapshot[m];
  const floor = baseline[m];
  if (current + TOLERANCE < floor) {
    console.error(`Coverage regressed for ${m}: ${current}% < baseline ${floor}%`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('Email UI coverage meets baseline:', snapshot);
