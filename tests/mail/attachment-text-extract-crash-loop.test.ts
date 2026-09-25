/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

let db: Database.Database;
let releaseParse: (text: string) => void = () => undefined;
// The DOCX parse runs in a worker thread (C-A7); the test holds it at that call.
const mockExtractDocx = jest.fn(
  (): Promise<string> => new Promise<string>((resolve) => { releaseParse = resolve; }),
);

jest.mock('../../electron/email/attachment-text-docx', () => ({
  extractDocxTextInWorker: () => mockExtractDocx(),
}));
jest.mock('../../electron/sqlite-service', () => {
  const actual = jest.requireActual('../../electron/sqlite-service');
  return { ...actual, getDb: () => db };
});

import { bootstrapFreshDatabaseSchema } from '../../electron/sqlite-service';
import { extractTextForAttachmentRow } from '../../electron/email/attachment-text-extract';

async function buildMiniDocx(): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('attachment text extraction crash loop', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scm-att-crash-'));
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db);
    db.pragma('foreign_keys = OFF');
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // F-A7b-12: Die Zeile wurde erst nach dem Parse als versucht markiert; ein Absturz im Parse liess den Backfill sie bei jedem Start erneut greifen.
  test('marks the row as tried before the parser runs', async () => {
    const file = path.join(tmpDir, 'bericht.docx');
    fs.writeFileSync(file, await buildMiniDocx());
    const id = Number(
      db.prepare(
        `INSERT INTO email_message_attachments (message_id, filename_display, content_type, size_bytes, storage_path)
         VALUES (1, 'bericht.docx', NULL, ?, ?)`,
      ).run(fs.statSync(file).size, file).lastInsertRowid,
    );

    const pending = extractTextForAttachmentRow(
      { id, filename_display: 'bericht.docx', content_type: null, size_bytes: fs.statSync(file).size, storage_path: file },
      { attachmentsRoot: tmpDir },
    );
    for (let i = 0; i < 50 && mockExtractDocx.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(mockExtractDocx).toHaveBeenCalledTimes(1);

    // Parser still running (in production: possibly about to crash the process).
    const during = db.prepare('SELECT text_extracted_at FROM email_message_attachments WHERE id = ?').get(id) as {
      text_extracted_at: string | null;
    };
    expect(during.text_extracted_at).not.toBeNull();

    releaseParse('Inhalt');
    await expect(pending).resolves.toBe(true);
    expect(db.prepare('SELECT text_content FROM email_message_attachments WHERE id = ?').get(id)).toEqual({
      text_content: 'Inhalt',
    });
  });

  // C-A7: Stoesst der Parser-Worker an sein Heap-Limit oder das Timeout, bleibt die Zeile ohne Text markiert.
  test('a worker stopped at its heap limit leaves the row marked without text', async () => {
    const file = path.join(tmpDir, 'bombe.docx');
    fs.writeFileSync(file, await buildMiniDocx());
    mockExtractDocx.mockImplementationOnce(() => Promise.reject(new Error('DOCX parse stopped: heap limit 512 MB')));
    const id = Number(
      db.prepare(
        `INSERT INTO email_message_attachments (message_id, filename_display, content_type, size_bytes, storage_path)
         VALUES (1, 'bombe.docx', NULL, ?, ?)`,
      ).run(fs.statSync(file).size, file).lastInsertRowid,
    );

    await expect(
      extractTextForAttachmentRow(
        { id, filename_display: 'bombe.docx', content_type: null, size_bytes: fs.statSync(file).size, storage_path: file },
        { attachmentsRoot: tmpDir },
      ),
    ).resolves.toBe(false);
    const row = db.prepare('SELECT text_content, text_extracted_at FROM email_message_attachments WHERE id = ?').get(id) as {
      text_content: string | null;
      text_extracted_at: string | null;
    };
    expect(row.text_content).toBeNull();
    expect(row.text_extracted_at).not.toBeNull();
  });
});
