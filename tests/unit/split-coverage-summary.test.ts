/**
 * @jest-environment node
 */
import { spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const repoRoot = join(__dirname, '..', '..');
const script = join(repoRoot, 'scripts', 'split-coverage-summary.mjs');

function metric(covered: number, total: number) {
  return { total, covered, skipped: 0, pct: total > 0 ? Math.floor((100_000 * covered) / total / 10) / 100 : 100 };
}

function entry(covered: number, total: number) {
  return { lines: metric(covered, total), statements: metric(covered, total), functions: metric(covered, total), branches: metric(covered, total) };
}

describe('split-coverage-summary', () => {
  let dir: string;
  let root: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'split-cov-'));
    root = join(dir, 'repo');
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  function run(summary: Record<string, unknown>) {
    const input = join(dir, 'combined.json');
    writeFileSync(input, JSON.stringify(summary));
    const out = join(dir, 'out');
    const result = spawnSync(process.execPath, [script, '--input', input, '--out-dir', out, '--root', root], { encoding: 'utf8' });
    return { ...result, out };
  }

  const read = (out: string, scope: string) => JSON.parse(readFileSync(join(out, scope, 'coverage-summary.json'), 'utf8'));

  test('teilt nach Scope und rechnet die Summen wie istanbul', () => {
    const server1 = join(root, 'packages/server/src/a.ts');
    const server2 = join(root, 'packages/server/src/db/b.ts');
    const ui1 = join(root, 'src/components/email/c.tsx');
    const ui2 = join(root, 'src/components/email/d.ts');
    const result = run({
      total: entry(0, 0),
      [server1]: entry(1, 2),
      [server2]: entry(1, 1),
      [ui1]: entry(0, 0),
      [ui2]: entry(3, 4),
    });
    expect(result.status).toBe(0);
    const server = read(result.out, 'server');
    expect(Object.keys(server).filter((k) => k !== 'total').sort()).toEqual([server1, server2].sort());
    // 2 von 3 ⇒ 66,66 (abgerundet, nicht 66,67).
    expect(server.total.lines).toEqual({ total: 3, covered: 2, skipped: 0, pct: 66.66 });
    const ui = read(result.out, 'ui');
    expect(Object.keys(ui).filter((k) => k !== 'total').sort()).toEqual([ui1, ui2].sort());
    expect(ui.total.branches).toEqual({ total: 4, covered: 3, skipped: 0, pct: 75 });
    expect(result.stdout).toContain('server: 2 files');
  });

  test('ein Scope ohne Zeilen hat 100 %', () => {
    const result = run({
      [join(root, 'packages/server/src/a.ts')]: entry(0, 0),
      [join(root, 'src/components/email/c.tsx')]: entry(1, 1),
    });
    expect(result.status).toBe(0);
    expect(read(result.out, 'server').total.lines.pct).toBe(100);
  });

  test('Datei außerhalb beider Scopes schlägt fehl', () => {
    const result = run({
      [join(root, 'packages/server/src/a.ts')]: entry(1, 1),
      [join(root, 'src/components/email/c.tsx')]: entry(1, 1),
      [join(root, 'electron/x.ts')]: entry(1, 1),
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unexpected file');
  });

  test('leerer Scope schlägt fehl', () => {
    const result = run({ [join(root, 'packages/server/src/a.ts')]: entry(1, 1) });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('no files');
  });
});
