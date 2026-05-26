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

import { exportLocalMailBackup } from '../../electron/email/email-local-backup';

describe('email-local-backup', () => {
  beforeEach(() => {
    fs.mkdirSync(path.join(tmpUserData, 'email-attachments', '1'), { recursive: true });
    fs.writeFileSync(path.join(tmpUserData, 'database.sqlite'), 'sqlite-data');
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
});
