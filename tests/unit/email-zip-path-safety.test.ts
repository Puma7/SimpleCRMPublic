import fs from 'fs';
import os from 'os';
import path from 'path';

import {
  findDatabaseSqliteInTree,
  resolveSafePathUnderDirectory,
} from '../../packages/core/src/email';

describe('email zip path safety', () => {
  test('resolves only paths inside destination directory', () => {
    const dest = path.join(os.tmpdir(), 'crm-restore-safe-core');

    expect(resolveSafePathUnderDirectory(dest, 'email-attachments/a.dat')).toBe(
      path.resolve(dest, 'email-attachments', 'a.dat'),
    );
    expect(() => resolveSafePathUnderDirectory(dest, '../outside.sqlite')).toThrow(
      /Traversal|Pfad/i,
    );
    expect(() => resolveSafePathUnderDirectory(dest, 'a/../../outside.sqlite')).toThrow(
      /Traversal|Pfad/i,
    );
    expect(() => resolveSafePathUnderDirectory(dest, 'bad\0name')).toThrow(/ZIP-Eintrag/i);
  });

  test('finds database.sqlite under extracted backup tree', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-restore-find-db-core-'));
    try {
      const nestedDir = path.join(tmpDir, 'backup', 'data');
      fs.mkdirSync(nestedDir, { recursive: true });
      const db = path.join(nestedDir, 'database.sqlite');
      fs.writeFileSync(db, '');

      expect(findDatabaseSqliteInTree(tmpDir)).toBe(db);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
