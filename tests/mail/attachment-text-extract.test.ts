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
import { execFileSync } from 'node:child_process';
import { deflateRawSync } from 'zlib';
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

/** Alle Aufrufe nutzen tmpDir als Attachments-Root (Pfad-Confinement). */

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

/** ZIP with DEFLATE entries from node:zlib (JSZip's JS deflate is too slow for a 40 MiB bomb). */
function buildDeflatedZip(files: Array<[string, Buffer]>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name);
    const compressed = deflateRawSync(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt32LE(offset, 42);
    localParts.push(local, nameBytes, compressed);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + compressed.length;
  }
  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

/** DOCX whose document.xml inflates far beyond its compressed size. */
async function buildExpandingDocx(uncompressedTextBytes: number): Promise<Buffer> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types/>');
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${'a'.repeat(uncompressedTextBytes)}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 1 } });
}

/** Rewrites the central-directory uncompressed size of every entry (lying archive). */
function forgeDeclaredSizes(zipBuf: Buffer, declared: number): Buffer {
  const out = Buffer.from(zipBuf);
  for (let i = out.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])); i >= 0; i = out.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]), i + 4)) {
    out.writeUInt32LE(declared, i + 24);
  }
  return out;
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

  // Use real Node workers outside Jest's CJS VM, with the production source.
  test('buffer extraction: pdf through desktop and server Node runtimes', () => {
    const script = `
      import { readFileSync } from 'node:fs';
      import { extractAttachmentTextFromBuffer as desktop } from './electron/email/attachment-text-extract.ts';
      import { extractAttachmentTextFromBuffer as server } from './packages/server/src/mail-attachment-text.ts';
      const input = readFileSync(0);
      process.stdout.write(JSON.stringify({
        desktop: await desktop(input, 'pdf'),
        server: await server(input, 'pdf'),
      }));
    `;
    const output = execFileSync(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
      cwd: path.resolve(__dirname, '../..'),
      env: {
        ...process.env,
        // Match Jest's source aliases; a fresh checkout has no core/dist yet.
        TSX_TSCONFIG_PATH: path.resolve(__dirname, '../setup/tsconfig.node-runtime.json'),
      },
      input: buildMiniPdf('Suchtext PDF Inhalt'),
      encoding: 'utf8',
      timeout: 15_000,
      windowsHide: true,
    });
    const result = JSON.parse(output) as { desktop: string; server: string };
    expect(result.desktop).toContain('Suchtext PDF Inhalt');
    expect(result.server).toContain('Suchtext PDF Inhalt');
  }, 20_000);

  test('buffer extraction: docx (mammoth)', async () => {
    const docx = await buildMiniDocx('Suchtext DOCX Inhalt');
    const text = await extractAttachmentTextFromBuffer(docx, 'docx');
    expect(text).toContain('Suchtext DOCX Inhalt');
  });

  // F-A5-04: DOCX wurde ohne jede Groessenpruefung an mammoth gegeben; ein kleines Archiv mit 40 MiB Deflate-Inhalt wurde voll entpackt.
  test('buffer extraction: docx zip bomb is rejected before mammoth inflates it', async () => {
    const docx = buildDeflatedZip([
      [
        '[Content_Types].xml',
        Buffer.from(
          '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
        ),
      ],
      [
        'word/document.xml',
        Buffer.concat([
          Buffer.from(
            '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Bombe</w:t></w:r></w:p></w:body></w:document>',
          ),
          Buffer.alloc(40 * 1024 * 1024, 0x20),
        ]),
      ],
    ]);
    expect(docx.length).toBeLessThan(1024 * 1024);

    await expect(extractAttachmentTextFromBuffer(docx, 'docx')).rejects.toThrow(
      /DOCX archive exceeds safe expansion limit/,
    );
  }, 30_000);

  // F-A7b-12: Nur die komprimierte Groesse war begrenzt; eine DOCX-Zip-Bombe wurde im Hauptprozess vollstaendig entpackt und geparst.
  test('buffer extraction: docx archives that expand beyond the limit are rejected before parsing', async () => {
    const bomb = await buildExpandingDocx(34 * 1024 * 1024);
    expect(bomb.length).toBeLessThan(1024 * 1024);
    await expect(extractAttachmentTextFromBuffer(bomb, 'docx')).rejects.toThrow(/expansion/i);
  }, 60_000);

  test('buffer extraction: docx archives with forged small entry sizes are still stopped', async () => {
    const forged = forgeDeclaredSizes(await buildExpandingDocx(34 * 1024 * 1024), 64);
    await expect(extractAttachmentTextFromBuffer(forged, 'docx')).rejects.toThrow();
  }, 60_000);

  test('buffer extraction: docx archives with too many entries are rejected', async () => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    for (let i = 0; i < 2100; i += 1) zip.file(`word/part${i}.xml`, '<x/>');
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(extractAttachmentTextFromBuffer(buf, 'docx')).rejects.toThrow(/expansion/i);
  }, 60_000);

  test('row extraction stores text and marks the row', async () => {
    const file = path.join(tmpDir, 'brief.txt');
    fs.writeFileSync(file, 'Vertraulicher Briefinhalt');
    const id = seedAttachment({ filename: 'brief.txt', sizeBytes: 25, storagePath: file });
    const ok = await extractTextForAttachmentRow(
      {
        id,
        filename_display: 'brief.txt',
        content_type: 'text/plain',
        size_bytes: 25,
        storage_path: file,
      },
      { attachmentsRoot: tmpDir },
    );
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
      await extractTextForAttachmentRow(
        {
          id: pngId,
          filename_display: 'bild.png',
          content_type: 'image/png',
          size_bytes: 7,
          storage_path: file,
        },
        { attachmentsRoot: tmpDir },
      ),
    ).toBe(false);
    expect(rowById(pngId).text_extracted_at).not.toBeNull();
    expect(rowById(pngId).text_content).toBeNull();

    const bigId = seedAttachment({
      filename: 'riesig.txt',
      sizeBytes: 20 * 1024 * 1024,
      storagePath: file,
    });
    expect(
      await extractTextForAttachmentRow(
        {
          id: bigId,
          filename_display: 'riesig.txt',
          content_type: 'text/plain',
          size_bytes: 20 * 1024 * 1024,
          storage_path: file,
        },
        { attachmentsRoot: tmpDir },
      ),
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
      await extractTextForAttachmentRow(
        {
          id,
          filename_display: 'weg.txt',
          content_type: 'text/plain',
          size_bytes: 10,
          storage_path: path.join(tmpDir, 'gibt-es-nicht.txt'),
        },
        { attachmentsRoot: tmpDir },
      ),
    ).toBe(false);
    expect(rowById(id).text_extracted_at).not.toBeNull();
  });

  test('paths outside the attachments root are rejected (confinement)', async () => {
    const outside = path.join(os.tmpdir(), `scm-outside-${Date.now()}.txt`);
    fs.writeFileSync(outside, 'geheimes Systemfile');
    try {
      const id = seedAttachment({ filename: 'evil.txt', sizeBytes: 20, storagePath: outside });
      expect(
        await extractTextForAttachmentRow(
          {
            id,
            filename_display: 'evil.txt',
            content_type: 'text/plain',
            size_bytes: 20,
            storage_path: outside,
          },
          { attachmentsRoot: tmpDir },
        ),
      ).toBe(false);
      expect(rowById(id).text_content).toBeNull();
      expect(rowById(id).text_extracted_at).not.toBeNull();
      // Traversal-Variante wird ebenfalls abgelehnt.
      const traversal = path.join(tmpDir, '..', path.basename(outside));
      const id2 = seedAttachment({ filename: 'evil2.txt', sizeBytes: 20, storagePath: traversal });
      expect(
        await extractTextForAttachmentRow(
          {
            id: id2,
            filename_display: 'evil2.txt',
            content_type: 'text/plain',
            size_bytes: 20,
            storage_path: traversal,
          },
          { attachmentsRoot: tmpDir },
        ),
      ).toBe(false);
      expect(rowById(id2).text_content).toBeNull();
    } finally {
      fs.rmSync(outside, { force: true });
    }
  });

  test('backfill batch processes remaining candidates and then stops', async () => {
    const file = path.join(tmpDir, 'faq.html');
    fs.writeFileSync(file, '<p>Antworten auf alles</p>');
    const id = seedAttachment({ filename: 'faq.html', sizeBytes: 26, storagePath: file });
    const processed = await runAttachmentTextBackfillBatch(10, { attachmentsRoot: tmpDir });
    expect(processed).toBeGreaterThanOrEqual(1);
    expect(rowById(id).text_content).toBe('Antworten auf alles');
    expect(await runAttachmentTextBackfillBatch(10, { attachmentsRoot: tmpDir })).toBe(0);
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
