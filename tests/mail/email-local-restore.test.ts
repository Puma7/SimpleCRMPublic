import fs from 'fs';
import os from 'os';
import path from 'path';
import { resolveSafePathUnderDirectory } from '../../electron/email/email-zip-path-safety';
import { findDatabaseSqliteInTree } from '../../electron/email/email-zip-path-safety';

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
