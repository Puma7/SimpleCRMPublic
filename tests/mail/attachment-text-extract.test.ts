/**
 * @jest-environment node
 *
 * Attachment text extraction against real files (txt/html/pdf/docx) and a
 * real SQLite database: extraction results, size caps, error paths and the
 * backfill batch loop.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

let db: Database.Database;

jest.mock('../../electron/sqlite-service', () => {
  const actual = jest.requireActual('../../electron/sqlite-service');
  return {
    ...actual,
    getDb: () => db,
  };
});

import { bootstrapFreshDatabaseSchema } from '../../electron/sqlite-service';
import {
  EMAIL_ACCOUNTS_TABLE,
  EMAIL_FOLDERS_TABLE,
  EMAIL_MESSAGE_ATTACHMENTS_TABLE,
  EMAIL_MESSAGES_TABLE,
} from '../../electron/database-schema';
import {
  extractAttachmentTextFromBuffer,
  extractTextForAttachmentRow,
  runAttachmentTextBackfillBatch,
} from '../../electron/email/attachment-text-extract';

/** Minimal single-page PDF containing the given ASCII text. */
function buildMiniPdf(text: string): Buffer {
  const objs: string[] = [];
  objs[1] = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;
  objs[2] = `2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n`;
  objs[3] = `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n`;
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  objs[4] = `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  objs[5] = `5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n`;
  let pdf = `%PDF-1.4\n`;
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i++) {
    offsets[i] = pdf.length;
    pdf += objs[i];
  }
  const xrefPos = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n`;
  for (let i = 1; i <= 5; i++) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

/** Minimal docx (zip with content types + one paragraph) via jszip (mammoth dep). */
async function buildMiniDocx(text: string): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body>
</w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('attachment text extraction', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scm-att-'));
    db = new Database(':memory:');
    bootstrapFreshDatabaseSchema(db);
    db.prepare(
      `INSERT INTO ${EMAIL_ACCOUNTS_TABLE}
         (id, display_name, email_address, imap_host, imap_username, keytar_account_key)
       VALUES (1, 'Test', 'test@firma.de', 'imap.firma.de', 'test', 'k1')`,
    ).run();
    db.prepare(`INSERT INTO ${EMAIL_FOLDERS_TABLE} (id, account_id, path) VALUES (1, 1, 'INBOX')`).run();
    db.prepare(
      `INSERT INTO ${EMAIL_MESSAGES_TABLE} (id, account_id, folder_id, uid, subject) VALUES (1, 1, 1, 1, 'Mit Anhang')`,
    ).run();
  });

  afterAll(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function seedAttachment(row: {
    filename: string;
    contentType?: string | null;
    sizeBytes: number;
    storagePath: string;
  }): number {
    const r = db
      .prepare(
        `INSERT INTO ${EMAIL_MESSAGE_ATTACHMENTS_TABLE}
           (message_id, filename_display, content_type, size_bytes, storage_path)
         VALUES (1, ?, ?, ?, ?)`,
      )
      .run(row.filename, row.contentType ?? null, row.sizeBytes, row.storagePath);
    return Number(r.lastInsertRowid);
  }

  function rowById(id: number): { text_content: string | null; text_extracted_at: string | null } {
    return db
      .prepare(
        `SELECT text_content, text_extracted_at FROM ${EMAIL_MESSAGE_ATTACHMENTS_TABLE} WHERE id = ?`,
      )
      .get(id) as { text_content: string | null; text_extracted_at: string | null };
  }

  test('buffer extraction: txt and html', async () => {
    expect(await extractAttachmentTextFromBuffer(Buffer.from('Hallo  Welt\n'), 'text')).toBe(
      'Hallo Welt',
    );
    expect(
      await extractAttachmentTextFromBuffer(
        Buffer.from('<p>Hallo <b>Welt</b></p><style>p{}</style>'),
        'html',
      ),
    ).toBe('Hallo Welt');
  });

  // pdf-parse (pdfjs) laedt seinen Worker per dynamischem ESM-Import, was in
  // Jests CJS-VM ohne --experimental-vm-modules nicht funktioniert. Derselbe
  // Codepfad ist unter echtem Node verifiziert (siehe PR-/Report-Notiz):
  //   new PDFParse({data}) -> getText() liefert den Textinhalt des Mini-PDFs.
  test.skip('buffer extraction: pdf (pdf-parse) — nur unter echtem Node lauffaehig', async () => {
    const text = await extractAttachmentTextFromBuffer(buildMiniPdf('Suchtext PDF Inhalt'), 'pdf');
    expect(text).toContain('Suchtext PDF Inhalt');
  });

  test('buffer extraction: docx (mammoth)', async () => {
    const docx = await buildMiniDocx('Suchtext DOCX Inhalt');
    const text = await extractAttachmentTextFromBuffer(docx, 'docx');
    expect(text).toContain('Suchtext DOCX Inhalt');
  });

  test('row extraction stores text and marks the row', async () => {
    const file = path.join(tmpDir, 'brief.txt');
    fs.writeFileSync(file, 'Vertraulicher Briefinhalt');
    const id = seedAttachment({ filename: 'brief.txt', sizeBytes: 25, storagePath: file });
    const ok = await extractTextForAttachmentRow({
      id,
      filename_display: 'brief.txt',
      content_type: 'text/plain',
      size_bytes: 25,
      storage_path: file,
    });
    expect(ok).toBe(true);
    const row = rowById(id);
    expect(row.text_content).toBe('Vertraulicher Briefinhalt');
    expect(row.text_extracted_at).not.toBeNull();
  });

  test('unsupported type and oversized files are marked as tried without text', async () => {
    const file = path.join(tmpDir, 'bild.png');
    fs.writeFileSync(file, 'PNGDATA');
    const pngId = seedAttachment({ filename: 'bild.png', sizeBytes: 7, storagePath: file });
    expect(
      await extractTextForAttachmentRow({
        id: pngId,
        filename_display: 'bild.png',
        content_type: 'image/png',
        size_bytes: 7,
        storage_path: file,
      }),
    ).toBe(false);
    expect(rowById(pngId).text_extracted_at).not.toBeNull();
    expect(rowById(pngId).text_content).toBeNull();

    const bigId = seedAttachment({
      filename: 'riesig.txt',
      sizeBytes: 20 * 1024 * 1024,
      storagePath: file,
    });
    expect(
      await extractTextForAttachmentRow({
        id: bigId,
        filename_display: 'riesig.txt',
        content_type: 'text/plain',
        size_bytes: 20 * 1024 * 1024,
        storage_path: file,
      }),
    ).toBe(false);
    expect(rowById(bigId).text_content).toBeNull();
  });

  test('read errors are non-fatal and mark the row as tried', async () => {
    const id = seedAttachment({
      filename: 'weg.txt',
      sizeBytes: 10,
      storagePath: path.join(tmpDir, 'gibt-es-nicht.txt'),
    });
    expect(
      await extractTextForAttachmentRow({
        id,
        filename_display: 'weg.txt',
        content_type: 'text/plain',
        size_bytes: 10,
        storage_path: path.join(tmpDir, 'gibt-es-nicht.txt'),
      }),
    ).toBe(false);
    expect(rowById(id).text_extracted_at).not.toBeNull();
  });

  test('backfill batch processes remaining candidates and then stops', async () => {
    const file = path.join(tmpDir, 'faq.html');
    fs.writeFileSync(file, '<p>Antworten auf alles</p>');
    const id = seedAttachment({ filename: 'faq.html', sizeBytes: 26, storagePath: file });
    const processed = await runAttachmentTextBackfillBatch(10);
    expect(processed).toBeGreaterThanOrEqual(1);
    expect(rowById(id).text_content).toBe('Antworten auf alles');
    expect(await runAttachmentTextBackfillBatch(10)).toBe(0);
  });

  test('extracted text is searchable via the attachments FTS index', () => {
    const hits = db
      .prepare(
        `SELECT rowid FROM email_attachments_fts WHERE email_attachments_fts MATCH '"vertraulich"*'`,
      )
      .all();
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });
});
