#!/usr/bin/env node
/**
 * Teilt die Coverage-Zusammenfassung des gemeinsamen CI-Laufs
 * (jest.ci.config.cjs → coverage/ci/coverage-summary.json) in die Scopes
 * server (packages/server/src) und ui (src/components/email) auf. Ergebnis:
 * coverage/<scope>/coverage-summary.json im selben Format wie die Einzelläufe,
 * damit die Ratchet-Skripte unverändert bleiben.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const METRICS = ['lines', 'statements', 'functions', 'branches'];

function arg(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

// Wie istanbul-lib-coverage/lib/percent.js.
function percent(covered, total) {
  if (total > 0) return Math.floor((1000 * 100 * covered) / total / 10) / 100;
  return 100.0;
}

const root = path.resolve(arg('--root', repoRoot));
const input = path.resolve(arg('--input', path.join(repoRoot, 'coverage/ci/coverage-summary.json')));
const outDir = path.resolve(arg('--out-dir', path.join(repoRoot, 'coverage')));
const scopes = {
  server: `${path.join(root, 'packages/server/src')}${path.sep}`,
  ui: `${path.join(root, 'src/components/email')}${path.sep}`,
};

const summary = JSON.parse(fs.readFileSync(input, 'utf8'));
const files = { server: {}, ui: {} };
let failed = false;
for (const [key, entry] of Object.entries(summary)) {
  if (key === 'total') continue;
  const file = path.resolve(key);
  const scope = Object.keys(scopes).find((name) => file.startsWith(scopes[name]));
  if (!scope) {
    console.error(`unexpected file in coverage summary: ${key}`);
    failed = true;
    continue;
  }
  files[scope][key] = entry;
}

for (const [scope, entries] of Object.entries(files)) {
  const names = Object.keys(entries);
  if (names.length === 0) {
    console.error(`no files for scope ${scope}`);
    failed = true;
    continue;
  }
  const total = {};
  for (const m of METRICS) {
    const sum = { total: 0, covered: 0, skipped: 0 };
    for (const name of names) {
      const metric = entries[name][m] ?? {};
      sum.total += metric.total ?? 0;
      sum.covered += metric.covered ?? 0;
      sum.skipped += metric.skipped ?? 0;
    }
    total[m] = { ...sum, pct: percent(sum.covered, sum.total) };
  }
  fs.mkdirSync(path.join(outDir, scope), { recursive: true });
  fs.writeFileSync(path.join(outDir, scope, 'coverage-summary.json'), JSON.stringify({ total, ...entries }));
  console.log(`${scope}: ${names.length} files, lines ${total.lines.pct}%`);
}
if (failed) process.exit(1);
