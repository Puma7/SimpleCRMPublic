/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

let db: Database.Database;
let releaseParse: (value: { value: string }) => void = () => undefined;
const mockExtractRawText = jest.fn(
  () => new Promise<{ value: string }>((resolve) => { releaseParse = resolve; }),
);

jest.mock('mammoth', () => ({ extractRawText: () => mockExtractRawText() }));
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
    for (let i = 0; i < 50 && mockExtractRawText.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(mockExtractRawText).toHaveBeenCalledTimes(1);

    // Parser still running (in production: possibly about to crash the process).
    const during = db.prepare('SELECT text_extracted_at FROM email_message_attachments WHERE id = ?').get(id) as {
      text_extracted_at: string | null;
    };
    expect(during.text_extracted_at).not.toBeNull();

    releaseParse({ value: 'Inhalt' });
    await expect(pending).resolves.toBe(true);
    expect(db.prepare('SELECT text_content FROM email_message_attachments WHERE id = ?').get(id)).toEqual({
      text_content: 'Inhalt',
    });
  });
});
