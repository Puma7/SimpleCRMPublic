import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
jest.mock('../../electron/sqlite-service', () => ({ getDb: () => db }));
jest.mock('electron', () => ({
  dialog: { showSaveDialog: jest.fn() },
}));
jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn(),
}));
jest.mock('../../electron/email/email-message-attachments-store', () => ({
  listAttachmentsForMessage: jest.fn(() => []),
}));
jest.mock('../../electron/email/mail-eml-build', () => ({
  buildEmlForMessage: jest.fn(),
}));

import { dialog } from 'electron';
import { getEmailMessageById } from '../../electron/email/email-store';
import { buildEmlForMessage } from '../../electron/email/mail-eml-build';
import {
  exportMessageAsEml,
  listDueScheduledDraftIds,
  messageLooksEncrypted,
  setDraftScheduledSendAt,
  setMessageSnoozedUntil,
  SNOOZE_FILTER_SQL,
} from '../../electron/email/email-message-features';

describe('email-message-features', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.all.mockReturnValue([{ id: 3 }]);
    stmt.run.mockReturnValue({ changes: 1 });
  });

  test('setDraftScheduledSendAt clears outbound hold when scheduling', () => {
    setDraftScheduledSendAt(2, '2026-06-14T21:05:00.000Z');
    const sql = String(db.prepare.mock.calls.at(-1)?.[0] ?? '');
    expect(sql).toContain('outbound_hold = 0');
    expect(stmt.run).toHaveBeenCalledWith('2026-06-14T21:05:00.000Z', 2);
  });

  test('snooze and scheduled draft sql helpers', () => {
    setMessageSnoozedUntil(1, '2026-01-01T00:00:00.000Z');
    setDraftScheduledSendAt(2, null);
    expect(listDueScheduledDraftIds(5)).toEqual([3]);
    expect(SNOOZE_FILTER_SQL).toContain('datetime(m.snoozed_until)');
  });

  test('messageLooksEncrypted detects pgp and headers', () => {
    expect(messageLooksEncrypted({ raw_headers: 'Content-Type: multipart/encrypted', body_text: '' })).toBe(true);
    expect(messageLooksEncrypted({ raw_headers: '', body_text: '-----BEGIN PGP MESSAGE-----\n' })).toBe(true);
    expect(messageLooksEncrypted({ raw_headers: null, body_text: 'plain' })).toBe(false);
  });

  test('exportMessageAsEml saves file', async () => {
    (getEmailMessageById as jest.Mock).mockReturnValue({
      subject: 'Test Mail',
      raw_headers: 'Subject: t',
      body_text: 'body',
      body_html: null,
    });
    (buildEmlForMessage as jest.Mock).mockReturnValue({
      eml: 'raw eml content',
      meta: { source: 'reconstructed', attachmentCount: 0 },
    });
    const out = path.join(os.tmpdir(), 'out.eml');
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: false, filePath: out });
    const r = await exportMessageAsEml(9);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(fs.existsSync(r.path)).toBe(true);
      fs.unlinkSync(r.path);
    }
  });

  test('exportMessageAsEml error paths', async () => {
    (getEmailMessageById as jest.Mock).mockReturnValue(undefined);
    expect((await exportMessageAsEml(1)).ok).toBe(false);
    (getEmailMessageById as jest.Mock).mockReturnValue({ subject: 'x', raw_headers: null, body_text: null, body_html: null });
    (buildEmlForMessage as jest.Mock).mockReturnValue({
      eml: '   ',
      meta: { source: 'reconstructed', attachmentCount: 0 },
    });
    expect((await exportMessageAsEml(1)).ok).toBe(false);
    (buildEmlForMessage as jest.Mock).mockReturnValue({
      eml: 'x',
      meta: { source: 'reconstructed', attachmentCount: 0 },
    });
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: true });
    expect((await exportMessageAsEml(1)).ok).toBe(false);
  });

  test('exportMessageAsEml uses raw_rfc822_b64 when reconstructed eml empty', async () => {
    (getEmailMessageById as jest.Mock).mockReturnValue({
      subject: 'Raw',
      raw_headers: null,
      body_text: null,
      body_html: null,
      raw_rfc822_b64: Buffer.from('Subject: Raw\r\n\r\nbody').toString('base64'),
    });
    (buildEmlForMessage as jest.Mock).mockReturnValue({
      eml: '',
      meta: { source: 'reconstructed', attachmentCount: 0 },
    });
    const out = path.join(os.tmpdir(), 'raw.eml');
    (dialog.showSaveDialog as jest.Mock).mockResolvedValue({ canceled: false, filePath: out });
    const r = await exportMessageAsEml(11);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(fs.readFileSync(r.path, 'utf8')).toContain('body');
      fs.unlinkSync(r.path);
    }
  });
});
