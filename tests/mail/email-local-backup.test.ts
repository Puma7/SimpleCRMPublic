import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

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

import {
  exportLocalMailBackup,
  inspectZipBackup,
} from '../../electron/email/email-local-backup';

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

  test('inspectZipBackup rejects invalid zip', async () => {
    const bad = path.join(tmpUserData, 'not-a-backup.zip');
    fs.writeFileSync(bad, 'not zip');
    const v = await inspectZipBackup(bad);
    expect(v.ok).toBe(false);
  });
});
