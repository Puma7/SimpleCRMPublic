import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
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

  test('persistParsedAttachments rejects write failures so sync recovery retries', async () => {
    const write = jest.spyOn(fs, 'writeFileSync').mockImplementationOnce(() => {
      throw new Error('disk full');
    });
    await expect(persistParsedAttachments(17, [
      { filename: 'invoice.pdf', content: Buffer.from('payload') },
    ])).rejects.toThrow(/0 von 1 Anhängen/);
    expect(db.prepare.mock.calls.map(([sql]) => String(sql)).join('\n'))
      .not.toContain('SET has_attachments = 0');
    write.mockRestore();
  });

  test('persistLocalComposeAttachments stores sent compose files', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-att-'));
    const fp = path.join(dir, 'angebot.xlsx');
    fs.writeFileSync(fp, 'spreadsheet');
    const r = persistLocalComposeAttachments(12, [{ filename: 'angebot.xlsx', path: fp }]);
    expect(r).toEqual({ expectedCount: 1, storedCount: 1, failures: [] });
    const storedDir = path.join(userData, 'email-attachments', '12');
    expect(fs.existsSync(path.join(storedDir, 'angebot.xlsx'))).toBe(true);
    expect(stmt.run).toHaveBeenCalled();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('persistLocalComposeAttachments throws when attachment cannot be read', () => {
    expect(() =>
      persistLocalComposeAttachments(12, [{ filename: 'missing.pdf', path: '/no/such/file.pdf' }]),
    ).toThrow(/Nur 0 von 1 Anhängen lokal gespeichert/);
  });

  test('persistParsedAttachments skips when existing on disk', async () => {
    const dir = path.join(userData, 'email-attachments', '9');
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'keep.txt');
    fs.writeFileSync(fp, 'ok');
    stmt.all.mockReturnValueOnce([{
      id: 1,
      storage_path: fp,
      content_sha256: '2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881',
    }]);
    await persistParsedAttachments(9, [{ filename: 'n.txt', content: Buffer.from('x') }]);
    expect(stmt.run).not.toHaveBeenCalled();
  });

  test('persistParsedAttachments hashes legacy rows instead of duplicating them', async () => {
    const dir = path.join(userData, 'email-attachments', '29');
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'legacy.txt');
    const content = Buffer.from('legacy payload');
    fs.writeFileSync(fp, content);
    stmt.all.mockReturnValueOnce([{
      id: 29,
      storage_path: fp,
      content_sha256: null,
    }]);

    await persistParsedAttachments(29, [{ filename: 'legacy.txt', content }]);

    const expectedHash = crypto.createHash('sha256').update(content).digest('hex');
    expect(stmt.run).toHaveBeenCalledWith(expectedHash, 29);
    expect(db.prepare.mock.calls.map(([sql]) => String(sql)).join('\n'))
      .not.toContain('INSERT OR IGNORE INTO email_message_attachments');
  });

  test('persistParsedAttachments preserves existing metadata when a retry omits another part', async () => {
    const dir = path.join(userData, 'email-attachments', '39');
    fs.mkdirSync(dir, { recursive: true });
    const fp = path.join(dir, 'keep.txt');
    const content = Buffer.from('keep me');
    fs.writeFileSync(fp, content);
    stmt.all.mockReturnValueOnce([{
      id: 39,
      storage_path: fp,
      content_sha256: crypto.createHash('sha256').update(content).digest('hex'),
    }]);

    await persistParsedAttachments(39, [
      { filename: 'keep.txt', content },
      { filename: 'huge.bin', content: Buffer.alloc(26 * 1024 * 1024) },
    ]);

    const metadataCall = stmt.run.mock.calls.find(([value]) => typeof value === 'string' && value.startsWith('{'));
    expect(JSON.parse(metadataCall?.[0] as string)).toMatchObject({
      stored: [{ name: 'keep.txt', size: content.length }],
      omitted: [{ name: 'huge.bin', reason: 'too_large' }],
    });
  });

  test('persistParsedAttachments repairs a stale database row whose file is missing', async () => {
    stmt.all.mockReturnValueOnce([{
      id: 91,
      storage_path: path.join(userData, 'missing-attachment.bin'),
      content_sha256: 'stale',
    }]);
    await persistParsedAttachments(19, [{ filename: 'replacement.bin', content: Buffer.from('new') }]);
    expect(db.prepare.mock.calls.map(([sql]) => String(sql)).join('\n'))
      .toContain('DELETE FROM email_message_attachments WHERE id = ?');
    expect(stmt.run).toHaveBeenCalledWith(91);
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
