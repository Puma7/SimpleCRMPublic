import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import yauzl from 'yauzl';

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-backup-'));

jest.mock('electron', () => ({
  app: { getPath: () => tmpUserData },
  dialog: {
    showSaveDialog: jest.fn().mockResolvedValue({
      canceled: false,
      filePath: path.join(tmpUserData, 'out.zip'),
    }),
  },
}));

jest.mock('../../electron/email/email-message-attachments-store', () => ({
  getAttachmentsRootForExport: () => path.join(tmpUserData, 'email-attachments'),
}));

const {
  exportLocalMailBackup,
  inspectZipBackup,
} = require('../../electron/email/email-local-backup') as typeof import('../../electron/email/email-local-backup');
const { exportLocalMailBackupToPath } = require('../../electron/email/email-local-backup-export') as typeof import('../../electron/email/email-local-backup-export');

function extractZipEntry(zipPath: string, entryName: string, target: string): Promise<void> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (openErr, zip) => {
      if (openErr || !zip) return reject(openErr ?? new Error('zip open failed'));
      zip.on('entry', (entry) => {
        if (entry.fileName !== entryName) return zip.readEntry();
        zip.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) return reject(streamErr ?? new Error('zip stream failed'));
          const out = fs.createWriteStream(target);
          out.on('close', () => {
            zip.close();
            resolve();
          });
          stream.pipe(out);
        });
      });
      zip.on('end', () => reject(new Error(`${entryName} not in zip`)));
      zip.readEntry();
    });
  });
}

describe('email-local-backup', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tmpUserData, 'email-attachments', '1'), { recursive: true });
    const dbPath = path.join(tmpUserData, 'database.sqlite');
    try {
      fs.unlinkSync(dbPath);
    } catch {
      /* fresh db each test */
    }
    const db = new Database(dbPath);
    db.exec('CREATE TABLE sync_info (key TEXT PRIMARY KEY, value TEXT)');
    db.close();
    fs.writeFileSync(path.join(tmpUserData, 'email-attachments', '1', 'a.bin'), 'att');
  });

  test('exportLocalMailBackup creates zip', async () => {
    const r = await exportLocalMailBackup();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(fs.existsSync(r.path)).toBe(true);
      expect(fs.statSync(r.path).size).toBeGreaterThan(0);
      fs.unlinkSync(r.path);
    }
  });

  test('exportLocalMailBackup fails without database', async () => {
    fs.unlinkSync(path.join(tmpUserData, 'database.sqlite'));
    const r = await exportLocalMailBackup();
    expect(r.ok).toBe(false);
  });

  test('inspectZipBackup accepts exported zip', async () => {
    const r = await exportLocalMailBackup();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const v = await inspectZipBackup(r.path);
    if (!v.ok) {
      throw new Error(`inspect failed: ${v.error}`);
    }
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.manifest.type).toBe('simplecrm-mail-local-backup');
      expect(v.hasDatabase).toBe(true);
      expect(v.hasAttachments).toBe(true);
    }
    fs.unlinkSync(r.path);
  });

  // F-A7b-02: Die Live-DB laeuft im WAL-Modus; die Dateikopie liess alle noch nicht checkpointeten Daten weg.
  test('the backup contains data that is still only in the WAL of the open live connection', async () => {
    const dbPath = path.join(tmpUserData, 'database.sqlite');
    const live = new Database(dbPath);
    try {
      live.pragma('journal_mode = WAL');
      live.pragma('wal_autocheckpoint = 0');
      live.exec('CREATE TABLE customers_probe (id INTEGER PRIMARY KEY, name TEXT)');
      live.pragma('wal_checkpoint(TRUNCATE)');
      const insert = live.prepare('INSERT INTO customers_probe (name) VALUES (?)');
      for (let i = 0; i < 20; i += 1) insert.run(`kunde-${i}`);

      const zipPath = path.join(tmpUserData, 'wal.zip');
      const result = await exportLocalMailBackupToPath(zipPath);
      expect(result.ok).toBe(true);

      const extracted = path.join(tmpUserData, 'extracted.sqlite');
      await extractZipEntry(zipPath, 'database.sqlite', extracted);
      const copy = new Database(extracted, { readonly: true });
      try {
        expect(copy.prepare('SELECT COUNT(*) AS c FROM customers_probe').get()).toEqual({ c: 20 });
      } finally {
        copy.close();
      }
      // The live connection keeps working with all its rows.
      expect(live.prepare('SELECT COUNT(*) AS c FROM customers_probe').get()).toEqual({ c: 20 });
      fs.rmSync(zipPath, { force: true });
      fs.rmSync(extracted, { force: true });
    } finally {
      live.close();
    }
  });

  test('inspectZipBackup rejects invalid zip', async () => {
    const bad = path.join(tmpUserData, 'not-a-backup.zip');
    fs.writeFileSync(bad, 'not zip');
    const v = await inspectZipBackup(bad);
    expect(v.ok).toBe(false);
  });
});
