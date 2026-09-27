/**
 * @jest-environment node
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');
type Metrics = { statements: number; branches: number; functions: number; lines: number };

function all(value: number): Metrics {
  return { statements: value, branches: value, functions: value, lines: value };
}

describe.each(['server', 'ui', 'mail'])('Coverage-Ratchet %s', (scope) => {
  const script = join(repoRoot, 'scripts', `check-${scope}-coverage-ratchet.mjs`);
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'ratchet-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(measured: Metrics, baseline: Partial<Metrics>, extra: string[] = []) {
    const summaryPath = join(dir, 'summary.json');
    const baselinePath = join(dir, 'baseline.json');
    const total = Object.fromEntries(Object.entries(measured).map(([m, pct]) => [m, { pct }]));
    writeFileSync(summaryPath, JSON.stringify({ total }));
    writeFileSync(baselinePath, JSON.stringify(baseline));
    const result = spawnSync(process.execPath, [script, '--summary', summaryPath, '--baseline', baselinePath, ...extra], { encoding: 'utf8' });
    return { ...result, baselinePath };
  }

  test('über der Baseline: in Ordnung', () => {
    expect(run(all(80.5), all(80)).status).toBe(0);
  });

  test('innerhalb der Toleranz von 1 Punkt: in Ordnung', () => {
    expect(run(all(79.2), all(80)).status).toBe(0);
  });

  test('mehr als 1 Punkt darunter: Rückschritt', () => {
    const result = run({ ...all(80), lines: 78.5 }, all(80));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('regressed for lines');
  });

  test('mehr als 2 Punkte darüber: Baseline veraltet, mit Befehl zum Anheben', () => {
    const result = run({ ...all(80), lines: 82.5 }, all(80));
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('stale');
    expect(result.stderr).toContain(`test:${scope}:coverage:update-baseline`);
  });

  test('knapp 2 Punkte darüber: noch in Ordnung', () => {
    expect(run({ ...all(80), lines: 81.9 }, all(80)).status).toBe(0);
  });

  test('fehlende Kennzahl in der Baseline schlägt fehl', () => {
    const { branches: _drop, ...rest } = all(80);
    const result = run(all(80), rest);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing/invalid');
  });

  test('--update-baseline schreibt die gemessenen Werte', () => {
    const result = run(all(83.25), all(80), ['--update-baseline']);
    expect(result.status).toBe(0);
    expect(JSON.parse(readFileSync(result.baselinePath, 'utf8'))).toEqual(all(83.25));
  });

  test('die gemessenen Werte stehen immer im Log', () => {
    const ok = run(all(80.5), all(80));
    const failed = run({ ...all(80), lines: 70 }, all(80));
    expect(ok.stdout).toContain('80.5');
    expect(failed.stdout).toContain('70');
  });
});
