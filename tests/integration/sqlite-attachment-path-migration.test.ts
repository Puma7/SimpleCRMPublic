/**
 * @jest-environment node
 */
jest.mock('electron', () => ({
  app: { getPath: () => `${process.cwd()}/.tmp-tests/simplecrm-attachment-path-migration` },
}));

import Database from 'better-sqlite3';
import { bootstrapFreshDatabaseSchema, closeDatabase } from '../../electron/sqlite-service';

const FLAG = 'email_attachment_relative_paths_v1';

describe('SQLite migration: relative attachment storage paths', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });
    db.pragma('foreign_keys = OFF');
  });

  afterEach(() => {
    closeDatabase();
  });

  function insertAttachment(storagePath: string): number {
    return Number(
      db.prepare(
        `INSERT INTO email_message_attachments (message_id, filename_display, content_type, size_bytes, storage_path)
         VALUES (1, 'f', NULL, 1, ?)`,
      ).run(storagePath).lastInsertRowid,
    );
  }

  // F-A7b-05: Altzeilen mit absolutem storage_path werden beim Start einmalig auf den relativen Pfad umgeschrieben.
  test('an old database (flag missing) gets its absolute attachment paths rewritten once and idempotently', () => {
    const win = insertAttachment('C:\\Users\\alice\\AppData\\Roaming\\simplecrm\\email-attachments\\8\\b.pdf');
    const posix = insertAttachment('/home/alice/.config/simplecrm/email-attachments/9/c.pdf');
    const relative = insertAttachment('10/d.pdf');
    const foreign = insertAttachment('/etc/passwd');
    db.prepare('DELETE FROM sync_info WHERE key = ?').run(FLAG);

    // Neustart nach Restore: Migrationen laufen erneut.
    bootstrapFreshDatabaseSchema(db, { keepDbAssigned: true });

    const paths = Object.fromEntries(
      (db.prepare('SELECT id, storage_path FROM email_message_attachments').all() as { id: number; storage_path: string }[])
        .map((r) => [r.id, r.storage_path]),
    );
    expect(paths).toEqual({
      [win]: '8/b.pdf',
      [posix]: '9/c.pdf',
      [relative]: '10/d.pdf',
      [foreign]: '/etc/passwd',
    });
    expect(db.prepare('SELECT value FROM sync_info WHERE key = ?').get(FLAG)).toEqual({ value: '1' });
  });
});
