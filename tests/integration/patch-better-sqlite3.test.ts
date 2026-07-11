import fs from 'fs';
import os from 'os';
import path from 'path';

// Require a plain-JS CommonJS module from a TS test — the established pattern
// here (see tests/unit/automation-api.test.ts). The repo's ESLint config does
// not forbid `require` in tests.
const { patchBetterSqlite3 } = require('../../scripts/patch-better-sqlite3') as {
  patchBetterSqlite3: (pkgDir?: string) => number;
};

const FROM = 'info.Holder()';
const TO = 'info.HolderV2()';

function makePkg(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsq3-patch-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

const bothUnpatched = {
  'src/objects/database.cpp': `foo(${FROM});`,
  'src/objects/statement.cpp': `bar(${FROM});`,
};

describe('patchBetterSqlite3', () => {
  it('patches both target files and reports replacements', () => {
    const dir = makePkg(bothUnpatched);
    const applied = patchBetterSqlite3(dir);
    expect(applied).toBeGreaterThan(0);
    for (const rel of Object.keys(bothUnpatched)) {
      const out = fs.readFileSync(path.join(dir, rel), 'utf8');
      expect(out).toContain(TO);
      expect(out).not.toContain(FROM);
    }
  });

  it('is idempotent: a second run on already-patched files does not throw', () => {
    const dir = makePkg(bothUnpatched);
    patchBetterSqlite3(dir);
    expect(() => patchBetterSqlite3(dir)).not.toThrow(); // 0 replacements, still OK
  });

  it('throws when the package directory is missing (undefined)', () => {
    expect(() => patchBetterSqlite3(undefined)).toThrow(/package directory not found/i);
  });

  it('throws when a target file is missing', () => {
    const dir = makePkg({ 'src/objects/database.cpp': `foo(${FROM});` }); // no statement.cpp
    expect(() => patchBetterSqlite3(dir)).toThrow(/target file missing/i);
  });

  it('throws when a target file has neither token (silent no-op guard)', () => {
    const dir = makePkg({
      'src/objects/database.cpp': 'no tokens here;',
      'src/objects/statement.cpp': `bar(${FROM});`,
    });
    expect(() => patchBetterSqlite3(dir)).toThrow(/not in the expected patched state/i);
  });
});
