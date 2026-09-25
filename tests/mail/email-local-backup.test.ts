import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { PassThrough } from 'stream';
import yauzl from 'yauzl';
import zlib from 'zlib';

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
  readZipEntryText,
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

const BACKUP_MANIFEST = JSON.stringify({ type: 'simplecrm-mail-local-backup', exportedAt: '2026-09-25T00:00:00.000Z' });

/** Writes a ZIP with node:zlib (DEFLATE, empty entries stored); unlike JSZip it keeps duplicate names and stays fast for 10k entries. */
function writeCraftedZip(name: string, entries: [string, string][]): string {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [entryName, content] of entries) {
    const fileName = Buffer.from(entryName);
    const raw = Buffer.from(content);
    const data = raw.length > 0 ? zlib.deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(raw.length > 0 ? 8 : 0, 8);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(zlib.crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    local.copy(central, 10, 8, 30);
    central.writeUInt32LE(offset, 42);
    locals.push(local, fileName, data);
    centrals.push(central, fileName);
    offset += local.length + fileName.length + data.length;
  }
  const centralDir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDir.length, 12);
  end.writeUInt32LE(offset, 16);
  const zipPath = path.join(tmpUserData, name);
  fs.writeFileSync(zipPath, Buffer.concat([...locals, centralDir, end]));
  return zipPath;
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

  // C-A8: inspectZipBackup puffert ein beliebig grosses manifest.json im Main-Prozess, noch vor Typpruefung und Restore-Limits.
  test('inspectZipBackup rejects an oversized manifest without buffering it', async () => {
    const zipPath = writeCraftedZip('big-manifest.zip', [
      ['database.sqlite', 'x'],
      ['manifest.json', JSON.stringify({ type: 'simplecrm-mail-local-backup', pad: 'a'.repeat(2 * 1024 * 1024) })],
    ]);
    expect(fs.statSync(zipPath).size).toBeLessThan(64 * 1024);

    const v = await inspectZipBackup(zipPath);

    expect(v).toEqual({ ok: false, error: 'manifest.json ist zu groß.' });
    fs.unlinkSync(zipPath);
  });

  // C-A8: Jedes weitere manifest.json wurde erneut gelesen und ersetzte das vorige.
  test('inspectZipBackup rejects a second manifest.json', async () => {
    const zipPath = writeCraftedZip('two-manifests.zip', [
      ['database.sqlite', 'x'],
      ['manifest.json', BACKUP_MANIFEST],
      ['manifest.json', BACKUP_MANIFEST],
    ]);

    const v = await inspectZipBackup(zipPath);

    expect(v).toEqual({ ok: false, error: 'ZIP enthält mehr als eine manifest.json.' });
    fs.unlinkSync(zipPath);
  });

  // C-A8: Die Inspektion ging jede Eintragszahl durch; die Restore-Grenze (10.000) griff erst danach.
  test('inspectZipBackup rejects more entries than a restore accepts', async () => {
    const entries: [string, string][] = [
      ['database.sqlite', 'x'],
      ['manifest.json', BACKUP_MANIFEST],
    ];
    for (let i = entries.length; i <= 10_000; i += 1) entries.push([`email-attachments/${i}`, '']);
    const zipPath = writeCraftedZip('many-entries.zip', entries);

    const v = await inspectZipBackup(zipPath);

    expect(v).toEqual({ ok: false, error: 'ZIP enthält zu viele Einträge.' });
    fs.unlinkSync(zipPath);
  });

  // C-A8: Auch ein Eintrag, der mehr liefert als deklariert, wird beim Lesen an der Grenze abgebrochen.
  test('readZipEntryText stops reading at the byte limit', async () => {
    const stream = new PassThrough();
    const destroy = jest.spyOn(stream, 'destroy');
    const zip = { openReadStream: (_entry: unknown, cb: (err: null, s: PassThrough) => void) => cb(null, stream) };

    const read = readZipEntryText(zip as never, { fileName: 'manifest.json', uncompressedSize: 10 } as never, 64 * 1024);
    stream.write(Buffer.alloc(40 * 1024, 0x20));
    stream.write(Buffer.alloc(40 * 1024, 0x20));

    await expect(read).rejects.toThrow('manifest.json ist zu groß.');
    expect(destroy).toHaveBeenCalled();
  });

  test('readZipEntryText rejects a declared size above the limit without opening the entry', async () => {
    const zip = { openReadStream: jest.fn() };
    await expect(readZipEntryText(zip as never, { fileName: 'manifest.json', uncompressedSize: 64 * 1024 + 1 } as never, 64 * 1024))
      .rejects.toThrow('manifest.json ist zu groß.');
    expect(zip.openReadStream).not.toHaveBeenCalled();
  });
});
