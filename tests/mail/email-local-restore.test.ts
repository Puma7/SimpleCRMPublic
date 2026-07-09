import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveSafePathUnderDirectory } from '../../electron/email/email-zip-path-safety';
import { findDatabaseSqliteInTree } from '../../electron/email/email-zip-path-safety';
import { validateRestoreZipEntry } from '../../electron/email/email-local-restore';

describe('email-local-restore path safety', () => {
  const dest = path.join(os.tmpdir(), 'crm-restore-safe');

  test('allows normal relative paths', () => {
    const out = resolveSafePathUnderDirectory(dest, 'database.sqlite');
    expect(path.resolve(out)).toBe(path.resolve(dest, 'database.sqlite'));
  });

  test('allows nested directories', () => {
    const out = resolveSafePathUnderDirectory(dest, 'email-attachments/a/b.dat');
    expect(path.resolve(out)).toBe(path.resolve(dest, 'email-attachments', 'a', 'b.dat'));
  });

  test('rejects parent traversal', () => {
    expect(() => resolveSafePathUnderDirectory(dest, '../outside.sqlite')).toThrow(
      /Traversal|Pfad/i,
    );
  });

  test('rejects embedded traversal segments', () => {
    expect(() => resolveSafePathUnderDirectory(dest, 'email-attachments/../../etc/passwd')).toThrow(
      /Traversal|Pfad/i,
    );
  });
});

describe('findDatabaseSqliteInTree', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-restore-find-db-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('finds root-level database.sqlite', () => {
    const db = path.join(tmpDir, 'database.sqlite');
    fs.writeFileSync(db, '');
    expect(findDatabaseSqliteInTree(tmpDir)).toBe(db);
  });

  test('finds nested database.sqlite', () => {
    const nestedDir = path.join(tmpDir, 'backup', 'data');
    fs.mkdirSync(nestedDir, { recursive: true });
    const db = path.join(nestedDir, 'database.sqlite');
    fs.writeFileSync(db, '');
    expect(findDatabaseSqliteInTree(tmpDir)).toBe(db);
  });
});

describe('restore zip extraction limits', () => {
  const gib = 1024 * 1024 * 1024;

  test('rejects too many entries', () => {
    const state = { entries: 10_000, totalBytes: 0 };
    expect(() => validateRestoreZipEntry('database.sqlite', 1, state)).toThrow(/zu viele/i);
  });

  test('accepts app-produced backups up to the exporter attachment limit', () => {
    expect(() => validateRestoreZipEntry('email-attachments/large.bin', 6 * gib, { entries: 0, totalBytes: 0 })).not.toThrow();
    expect(() => validateRestoreZipEntry('email-attachments/chunk.bin', 3 * gib, { entries: 1, totalBytes: 5 * gib })).not.toThrow();
  });

  test('rejects oversized single entries', () => {
    expect(() => validateRestoreZipEntry('database.sqlite', 8 * gib + 1, { entries: 0, totalBytes: 0 })).toThrow(/zu groß/i);
  });

  test('rejects excessive total uncompressed size', () => {
    const state = { entries: 1, totalBytes: 9 * gib };
    expect(() => validateRestoreZipEntry('email-attachments/a.bin', 1, state)).toThrow(/zu groß/i);
  });
});
