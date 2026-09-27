/**
 * Gemeinsame Ratchet-Prüfung für die Coverage-Baselines (Server, E-Mail-UI,
 * Mail). Sie schlägt fehl, wenn die Coverage mehr als TOLERANCE Punkte unter
 * die Baseline fällt oder mehr als STALE_MARGIN Punkte darüber liegt (dann ist
 * die Baseline veraltet und muss angehoben werden, sonst ratschen sie nicht).
 */
import fs from 'fs';

export const METRICS = ['statements', 'branches', 'functions', 'lines'];
// v8-Abweichung zwischen Umgebungen (lokal vs. CI bis ~0,8 Punkte gemessen).
export const TOLERANCE = 1;
// Mehr als 2 Punkte über der Baseline = Baseline veraltet.
export const STALE_MARGIN = 2;

export function snapshotFromSummary(summary) {
  const total = summary?.total;
  if (!total) throw new Error('coverage-summary.json has no total');
  const snapshot = {};
  for (const m of METRICS) snapshot[m] = total[m]?.pct ?? 0;
  return snapshot;
}

export function evaluateRatchet(snapshot, baseline, { tolerance = TOLERANCE, staleMargin = STALE_MARGIN } = {}) {
  const invalid = [];
  const regressions = [];
  const stale = [];
  for (const m of METRICS) {
    const current = snapshot[m];
    const floor = baseline?.[m];
    // Ein fehlender Wert würde jeden Vergleich stillschweigend bestehen lassen.
    if (typeof floor !== 'number' || Number.isNaN(floor)) {
      invalid.push(m);
      continue;
    }
    if (current + tolerance < floor) regressions.push(m);
    else if (current > floor + staleMargin) stale.push(m);
  }
  return { invalid, regressions, stale };
}

function argValue(argv, name) {
  const index = argv.indexOf(name);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function runRatchetCli({ label, defaultSummaryPath, defaultBaselinePath, measureCommand, updateCommand, argv = process.argv.slice(2) }) {
  const summaryPath = argValue(argv, '--summary') ?? defaultSummaryPath;
  const baselinePath = argValue(argv, '--baseline') ?? defaultBaselinePath;
  const update = argv.includes('--update-baseline');

  if (!fs.existsSync(summaryPath)) {
    console.error(`Missing ${summaryPath}. Run: ${measureCommand}`);
    process.exit(1);
  }
  let snapshot;
  try {
    snapshot = snapshotFromSummary(JSON.parse(fs.readFileSync(summaryPath, 'utf8')));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
  console.log(`${label} coverage measured:`, snapshot);

  if (update) {
    fs.writeFileSync(baselinePath, `${JSON.stringify(snapshot, null, 2)}\n`);
    console.log(`Updated ${baselinePath}:`, snapshot);
    process.exit(0);
  }
  if (!fs.existsSync(baselinePath)) {
    console.error(`Missing ${baselinePath}. Run: ${updateCommand}`);
    process.exit(1);
  }
  const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
  const { invalid, regressions, stale } = evaluateRatchet(snapshot, baseline);
  for (const m of invalid) console.error(`Baseline missing/invalid metric ${m}`);
  for (const m of regressions) {
    console.error(`Coverage regressed for ${m}: ${snapshot[m]}% < baseline ${baseline[m]}% (tolerance ${TOLERANCE})`);
  }
  for (const m of stale) {
    console.error(`Coverage baseline is stale for ${m}: measured ${snapshot[m]}% > baseline ${baseline[m]}% + ${STALE_MARGIN}. Raise it: ${updateCommand}`);
  }
  if (invalid.length + regressions.length + stale.length > 0) process.exit(1);
  console.log(`${label} coverage meets baseline:`, snapshot);
}
