#!/usr/bin/env node
/**
 * Fail if mail coverage regresses below committed baseline.
 * Run after: npm run test:mail:coverage
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const summaryPath = path.join(root, 'coverage/mail/coverage-summary.json');
const baselinePath = path.join(root, 'mail-coverage-baseline.json');

const metrics = ['statements', 'branches', 'functions', 'lines'];
const update = process.argv.includes('--update-baseline');

if (!fs.existsSync(summaryPath)) {
  console.error(`Missing ${summaryPath}. Run: npm run test:mail:coverage`);
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
  console.error(`Missing ${baselinePath}. Run: npm run test:mail:coverage:update-baseline`);
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
let failed = false;
for (const m of metrics) {
  const current = snapshot[m];
  const floor = baseline[m];
  if (current + 0.05 < floor) {
    console.error(`Coverage regressed for ${m}: ${current}% < baseline ${floor}%`);
    failed = true;
  }
}
if (failed) process.exit(1);
console.log('Mail coverage meets baseline:', snapshot);
