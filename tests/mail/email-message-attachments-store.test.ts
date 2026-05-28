import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSqliteMock } from './helpers/sqlite-mock';

const { db, stmt } = createSqliteMock();
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-att-'));

jest.mock('electron', () => ({
  app: { getPath: () => userData },
}));
jest.mock('../../electron/sqlite-service', () => ({ getDb: () => db }));

import {
  getAttachmentById,
  getAttachmentsRootForExport,
  listAttachmentsForMessage,
  persistLocalComposeAttachments,
  persistParsedAttachments,
  purgeAttachmentFilesForAccount,
} from '../../electron/email/email-message-attachments-store';

describe('email-message-attachments-store', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    stmt.all.mockReturnValue([]);
    stmt.get.mockReturnValue(undefined);
    stmt.run.mockReturnValue({ changes: 1, lastInsertRowid: 1 });
  });

  test('list and get attachments', () => {
    stmt.all.mockReturnValueOnce([
      {
        id: 1,
        message_id: 5,
        filename_display: 'a.txt',
        content_type: 'text/plain',
        size_bytes: 1,
        storage_path: '/x',
        created_at: 't',
      },
    ]);
    expect(listAttachmentsForMessage(5)).toHaveLength(1);
    stmt.get.mockReturnValueOnce({ id: 1 });
    expect(getAttachmentById(1)?.id).toBe(1);
    expect(getAttachmentsRootForExport()).toContain('email-attachments');
  });

  test('persistParsedAttachments stores files', async () => {
    const buf = Buffer.from('hello');
    await persistParsedAttachments(7, [
      { filename: 'a.txt', contentType: 'text/plain', content: buf },
      { filename: 'empty', content: Buffer.alloc(0) },
      { filename: 'huge.bin', content: Buffer.alloc(26 * 1024 * 1024) },
    ]);
    expect(stmt.run).toHaveBeenCalled();
  });

  test('persistLocalComposeAttachments stores sent compose files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-att-'));
    const fp = path.join(dir, 'angebot.xlsx');
    fs.writeFileSync(fp, 'spreadsheet');
    persistLocalComposeAttachments(12, [{ filename: 'angebot.xlsx', path: fp }]);
    const storedDir = path.join(userData, 'email-attachments', '12');
    expect(fs.existsSync(path.join(storedDir, 'angebot.xlsx'))).toBe(true);
    expect(stmt.run).toHaveBeenCalled();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('persistParsedAttachments skips when existing on disk', async () => {
    const dir = path.join(userData, 'email-attachments', '9');
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'keep.txt');
    fs.writeFileSync(fp, 'ok');
    stmt.all.mockReturnValueOnce([{ id: 1, storage_path: fp }]);
    await persistParsedAttachments(9, [{ filename: 'n.txt', content: Buffer.from('x') }]);
    expect(stmt.run).not.toHaveBeenCalled();
  });

  test('persistParsedAttachments only omitted meta', async () => {
    const big = Buffer.alloc(26 * 1024 * 1024);
    await persistParsedAttachments(8, [{ filename: 'big.bin', content: big }]);
    expect(stmt.run).toHaveBeenCalled();
  });

  test('persistParsedAttachments clears has_attachments when only empty parts', async () => {
    stmt.all.mockReturnValueOnce([]);
    stmt.get.mockReturnValue({ has_attachments: 1, attachments_json: null });
    await persistParsedAttachments(8, [{ filename: 'e', content: Buffer.alloc(0) }]);
    expect(stmt.run).toHaveBeenCalled();
  });

  test('purgeAttachmentFilesForAccount', async () => {
    const root = path.join(userData, 'email-attachments');
    const msgDir = path.join(root, '11');
    fs.mkdirSync(msgDir, { recursive: true });
    const f = path.join(msgDir, 'f.bin');
    fs.writeFileSync(f, 'x');
    stmt.all.mockReturnValueOnce([{ storage_path: f }]);
    await purgeAttachmentFilesForAccount(1);
    expect(fs.existsSync(f)).toBe(false);
  });
});
