import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-backup-roundtrip-'));
const userData = path.join(tmpRoot, 'userData');
const tempDir = path.join(tmpRoot, 'temp');
const attachmentsRoot = path.join(userData, 'email-attachments');

jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => (name === 'temp' ? tempDir : userData),
    relaunch: jest.fn(),
    exit: jest.fn(),
  },
  dialog: {},
}));
jest.mock('../../electron/email/email-message-attachments-store', () => ({
  getAttachmentsRootForExport: () => attachmentsRoot,
}));
jest.mock('../../electron/email/email-imap-services', () => ({
  isEmailBackgroundSyncBusy: () => false,
  startEmailBackgroundServices: jest.fn(),
  stopEmailBackgroundServices: jest.fn(),
}));
jest.mock('../../electron/sqlite-service', () => ({
  closeDatabase: jest.fn(),
  reopenDatabaseConnection: jest.fn(),
}));

const { app } = require('electron') as { app: { relaunch: jest.Mock; exit: jest.Mock } };
const { inspectZipBackup } = require('../../electron/email/email-local-backup') as typeof import('../../electron/email/email-local-backup');
const { exportLocalMailBackupToPath } = require('../../electron/email/email-local-backup-export') as typeof import('../../electron/email/email-local-backup-export');
const {
  previewRestoreLocalMailBackup,
  restoreLocalMailBackup,
  RESTORE_CONFIRM_PHRASE,
} = require('../../electron/email/email-local-restore') as typeof import('../../electron/email/email-local-restore');

function probeRows(): string[] {
  const db = new Database(path.join(userData, 'database.sqlite'), { readonly: true });
  try {
    return (db.prepare('SELECT name FROM probe ORDER BY id').all() as { name: string }[]).map((r) => r.name);
  } finally {
    db.close();
  }
}

describe('local mail backup round trip', () => {
  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  // C-A8: Die Grenzen fuer manifest.json und Eintragszahl duerfen echte eigene Backups nicht treffen.
  test('an exported backup passes inspect, preview and restore', async () => {
    fs.mkdirSync(path.join(attachmentsRoot, '7'), { recursive: true });
    fs.mkdirSync(tempDir, { recursive: true });
    const db = new Database(path.join(userData, 'database.sqlite'));
    db.exec('CREATE TABLE sync_info (key TEXT PRIMARY KEY, value TEXT)');
    db.exec('CREATE TABLE probe (id INTEGER PRIMARY KEY, name TEXT)');
    db.prepare('INSERT INTO probe (name) VALUES (?)').run('aus-dem-backup');
    db.close();
    fs.writeFileSync(path.join(attachmentsRoot, '7', 'rechnung.pdf'), '%PDF-backup');

    const zipPath = path.join(tmpRoot, 'backup.zip');
    expect(await exportLocalMailBackupToPath(zipPath)).toEqual({ ok: true, path: zipPath });

    const inspected = await inspectZipBackup(zipPath);
    expect(inspected).toEqual(expect.objectContaining({ ok: true, hasDatabase: true, hasAttachments: true }));

    const live = new Database(path.join(userData, 'database.sqlite'));
    live.prepare('INSERT INTO probe (name) VALUES (?)').run('nach-dem-backup');
    live.close();
    fs.rmSync(path.join(attachmentsRoot, '7', 'rechnung.pdf'));

    const preview = await previewRestoreLocalMailBackup(zipPath);
    if (!preview.ok) throw new Error(`preview failed: ${preview.error}`);

    const restored = await restoreLocalMailBackup({
      zipPath,
      previewToken: preview.previewToken,
      confirmPhrase: RESTORE_CONFIRM_PHRASE,
      createPreBackup: false,
    });

    expect(restored).toEqual({ ok: true, preBackupPath: undefined });
    expect(probeRows()).toEqual(['aus-dem-backup']);
    expect(fs.readFileSync(path.join(attachmentsRoot, '7', 'rechnung.pdf'), 'utf8')).toBe('%PDF-backup');
    expect(app.relaunch).toHaveBeenCalled();
  });
});
