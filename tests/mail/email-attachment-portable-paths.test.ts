/**
 * @jest-environment node
 *
 * Anhang-Pfade muessen einen Restore auf einem anderen Rechner/Profil
 * ueberstehen: gespeichert wird relativ zum Anhang-Root, absolute Altpfade
 * werden beim Lesen auf den aktuellen Root abgebildet.
 */
import Database from 'better-sqlite3';
import fs from 'fs';
import os from 'os';
import path from 'path';

const db = new Database(':memory:');
db.pragma('foreign_keys = OFF');
let mockUserData = '';

jest.mock('electron', () => ({
  app: { getPath: () => mockUserData },
}));
jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => db,
  getSyncInfo: () => null,
  setSyncInfo: () => undefined,
}));
jest.mock('../../electron/email/attachment-text-extract', () => ({
  queueMessageAttachmentExtraction: jest.fn(),
}));

import { createEmailMessageAttachmentsTable, createEmailMessagesTable } from '../../electron/database-schema';
import {
  getAttachmentById,
  hasCompleteStoredAttachmentsForMessage,
  listAttachmentsForMessage,
  persistParsedAttachments,
} from '../../electron/email/email-message-attachments-store';
import { rewriteLegacyAttachmentStoragePaths } from '../../electron/email/attachment-storage-path';

const tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'crm-att-portable-'));
const machineA = path.join(tmpBase, 'A');
const machineB = path.join(tmpBase, 'B');

function insertMessage(id: number): void {
  db.prepare(
    `INSERT INTO email_messages (id, account_id, folder_id, uid, subject, date_received)
     VALUES (?, 1, 10, ?, 'x', '2026-01-01T00:00:00Z')`,
  ).run(id, id);
}

function insertAttachmentRow(messageId: number, storagePath: string): number {
  return Number(
    db.prepare(
      `INSERT INTO email_message_attachments (message_id, filename_display, content_type, size_bytes, storage_path)
       VALUES (?, 'f', 'application/pdf', 1, ?)`,
    ).run(messageId, storagePath).lastInsertRowid,
  );
}

function writeUnderRoot(userData: string, rel: string, content = 'x'): string {
  const file = path.join(userData, 'email-attachments', rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return file;
}

beforeAll(() => {
  db.exec(createEmailMessagesTable);
  db.exec(createEmailMessageAttachmentsTable);
});

beforeEach(() => {
  db.exec('DELETE FROM email_message_attachments; DELETE FROM email_messages;');
  fs.rmSync(machineA, { recursive: true, force: true });
  fs.rmSync(machineB, { recursive: true, force: true });
});

afterAll(() => {
  fs.rmSync(tmpBase, { recursive: true, force: true });
});

describe('portable attachment storage paths', () => {
  // F-A7b-05: storage_path war absolut und rechnerspezifisch, nach Restore auf anderem Rechner waren alle Anhaenge unauffindbar.
  test('new attachments are stored relative and still resolve after a restore into another profile', async () => {
    mockUserData = machineA;
    insertMessage(7);
    await persistParsedAttachments(7, [{ filename: 'a.pdf', contentType: 'application/pdf', content: Buffer.from('pdf') }]);

    const raw = db.prepare('SELECT storage_path FROM email_message_attachments WHERE message_id = 7').get() as { storage_path: string };
    expect(path.isAbsolute(raw.storage_path)).toBe(false);
    expect(raw.storage_path).toBe('7/a.pdf');

    // Restore: Anhang-Ordner nach B kopieren, A verschwindet.
    fs.cpSync(path.join(machineA, 'email-attachments'), path.join(machineB, 'email-attachments'), { recursive: true });
    fs.rmSync(machineA, { recursive: true, force: true });
    mockUserData = machineB;

    const expected = path.join(machineB, 'email-attachments', '7', 'a.pdf');
    const [row] = listAttachmentsForMessage(7);
    expect(row.storage_path).toBe(expected);
    expect(getAttachmentById(row.id)?.storage_path).toBe(expected);
    const msg = db.prepare('SELECT attachments_json FROM email_messages WHERE id = 7').get() as { attachments_json: string | null };
    expect(hasCompleteStoredAttachmentsForMessage(7, msg.attachments_json)).toBe(true);
  });

  test('legacy absolute paths (Windows and POSIX) are mapped onto the current attachments root', async () => {
    mockUserData = machineB;
    insertMessage(8);
    insertMessage(9);
    const winFile = writeUnderRoot(machineB, path.join('8', 'b.pdf'));
    const posixFile = writeUnderRoot(machineB, path.join('9', 'c.pdf'));
    const winId = insertAttachmentRow(8, 'C:\\Users\\alice\\AppData\\Roaming\\simplecrm\\email-attachments\\8\\b.pdf');
    const posixId = insertAttachmentRow(9, '/home/alice/.config/simplecrm/email-attachments/9/c.pdf');

    expect(getAttachmentById(winId)?.storage_path).toBe(winFile);
    expect(getAttachmentById(posixId)?.storage_path).toBe(posixFile);

    // Erneute Verarbeitung darf die Altzeile nicht als "Datei fehlt" loeschen.
    await persistParsedAttachments(8, [{ filename: 'b.pdf', content: Buffer.from('x') }]);
    expect(db.prepare('SELECT COUNT(*) AS c FROM email_message_attachments WHERE id = ?').get(winId)).toEqual({ c: 1 });
  });

  test('stored paths cannot escape the attachments root', () => {
    mockUserData = machineB;
    insertMessage(10);
    writeUnderRoot(machineB, path.join('10', 'ok.pdf'));
    const outside = path.join(machineB, 'secret.txt');
    fs.writeFileSync(outside, 'secret');

    for (const storagePath of ['../secret.txt', '10/../../secret.txt', outside, '/etc/passwd']) {
      const id = insertAttachmentRow(10, storagePath);
      expect({ storagePath, resolved: getAttachmentById(id)?.storage_path }).toEqual({ storagePath, resolved: '' });
    }
  });

  test('the one-time data fix rewrites only recognisable legacy paths and is idempotent', () => {
    insertMessage(11);
    const legacy = insertAttachmentRow(11, 'D:\\old\\email-attachments\\11\\x.pdf');
    const relative = insertAttachmentRow(11, '11/y.pdf');
    const foreign = insertAttachmentRow(11, '/etc/passwd');

    expect(rewriteLegacyAttachmentStoragePaths(db, 'email_message_attachments')).toBe(1);
    expect(rewriteLegacyAttachmentStoragePaths(db, 'email_message_attachments')).toBe(0);
    const byId = (id: number) =>
      (db.prepare('SELECT storage_path FROM email_message_attachments WHERE id = ?').get(id) as { storage_path: string }).storage_path;
    expect([byId(legacy), byId(relative), byId(foreign)]).toEqual(['11/x.pdf', '11/y.pdf', '/etc/passwd']);
  });
});
