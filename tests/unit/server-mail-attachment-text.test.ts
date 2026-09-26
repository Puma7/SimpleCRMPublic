/**
 * @jest-environment node
 */
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { deflateRawSync } from 'node:zlib';

import JSZip from 'jszip';

import { extractDocxText, extractDocxTextInWorker, extractPdfTextInWorker } from '../../packages/server/src/mail-attachment-docx';
import { extractAttachmentTextFromBuffer } from '../../packages/server/src/mail-attachment-text';

// The DOCX worker loads the TS sources through tsx; map @simplecrm/core to src like Jest does.
process.env.TSX_TSCONFIG_PATH ??= path.resolve(__dirname, '../setup/tsconfig.node-runtime.json');

async function buildDocx(documentXml: string): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
  );
  zip.file('word/document.xml', documentXml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function withDeclaredUncompressedSize(
  archive: Buffer,
  filename: string,
  uncompressedSize: number,
): Buffer {
  const patched = Buffer.from(archive);
  const centralDirectorySignature = Buffer.from([0x50, 0x4b, 0x01, 0x02]);
  let offset = patched.indexOf(centralDirectorySignature);
  while (offset >= 0) {
    const filenameLength = patched.readUInt16LE(offset + 28);
    const currentFilename = patched.toString('utf8', offset + 46, offset + 46 + filenameLength);
    if (currentFilename === filename) {
      patched.writeUInt32LE(uncompressedSize, offset + 24);
      return patched;
    }
    offset = patched.indexOf(centralDirectorySignature, offset + 46 + filenameLength);
  }
  throw new Error(`ZIP central-directory entry not found: ${filename}`);
}

/**
 * ZIP with DEFLATE entries from node:zlib (JSZip's JS deflate is too slow for a
 * 40 MiB bomb). With `announcedEntries` below `files.length` the
 * end-of-central-directory record under-reports the entries: yauzl reads only
 * the announced ones, JSZip (and therefore mammoth) reads every record, and a
 * later record with the same name replaces the earlier one.
 */
function buildDeflatedZip(
  files: Array<[string, Buffer]>,
  announcedEntries = files.length,
): Buffer {
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
  end.writeUInt16LE(announcedEntries, 8);
  end.writeUInt16LE(announcedEntries, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...localParts, centralDirectory, end]);
}

const CONTENT_TYPES_XML = Buffer.from(
  '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
);
const DOCUMENT_XML_PREFIX =
  '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>';
const BOMB_PADDING = Buffer.alloc(40 * 1024 * 1024, 0x20);
const MIB = 1024 * 1024;

/** DOCX inside the inflate budget whose ~30 MiB of empty paragraphs mammoth turns into a multi-GB DOM. */
function buildDomBomb(): Buffer {
  return buildDeflatedZip([
    ['[Content_Types].xml', CONTENT_TYPES_XML],
    ['word/document.xml', Buffer.from(`${DOCUMENT_XML_PREFIX}${'<w:p/>'.repeat(5_000_000)}</w:body></w:document>`)],
  ]);
}

describe('server attachment text extraction', () => {
  test('extracts an ordinary DOCX', async () => {
    const docx = await buildDocx(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hallo CRM</w:t></w:r></w:p></w:body></w:document>',
    );

    await expect(extractAttachmentTextFromBuffer(docx, 'docx')).resolves.toContain('Hallo CRM');
  });

  test('rejects a DOCX whose declared expansion exceeds the safe limit', async () => {
    const docx = withDeclaredUncompressedSize(
      await buildDocx('<w:document/>'),
      'word/document.xml',
      33 * 1024 * 1024,
    );

    await expect(extractAttachmentTextFromBuffer(docx, 'docx'))
      .rejects.toThrow(/DOCX archive exceeds safe expansion limit/);
  });

  // F-A5-04: Geprueft wurde nur die deklarierte Groesse; eine DOCX mit kleinen Angaben und 40 MiB Deflate-Inhalt wurde von mammoth voll entpackt.
  test('rejects a DOCX that inflates beyond the safe limit despite small declared sizes', async () => {
    const docx = withDeclaredUncompressedSize(
      buildDeflatedZip([
        ['[Content_Types].xml', CONTENT_TYPES_XML],
        ['word/document.xml', Buffer.concat([Buffer.from(`${DOCUMENT_XML_PREFIX}</w:body></w:document>`), BOMB_PADDING])],
      ]),
      'word/document.xml',
      100,
    );

    await expect(extractAttachmentTextFromBuffer(docx, 'docx'))
      .rejects.toThrow(/DOCX archive exceeds safe expansion limit/);
  }, 30_000);

  // F-A5-04: Die yauzl-Vorpruefung sah nur die im EOCD angekuendigten Eintraege; mammoth (JSZip) las einen weiteren, 40 MiB grossen document.xml-Eintrag.
  test('rejects a DOCX whose extra central-directory record hides a bomb from the pre-check', async () => {
    const decoy = Buffer.from(`${DOCUMENT_XML_PREFIX}</w:body></w:document>`);
    const bomb = Buffer.concat([
      Buffer.from(`${DOCUMENT_XML_PREFIX}<w:p><w:r><w:t>Bombe</w:t></w:r></w:p></w:body></w:document>`),
      BOMB_PADDING,
    ]);
    const docx = buildDeflatedZip(
      [
        ['[Content_Types].xml', CONTENT_TYPES_XML],
        ['word/document.xml', decoy],
        ['word/document.xml', bomb],
      ],
      2,
    );

    await expect(extractAttachmentTextFromBuffer(docx, 'docx'))
      .rejects.toThrow(/DOCX archive exceeds safe expansion limit/);
  }, 30_000);

  test('extracts a DOCX whose body spans many inflate chunks', async () => {
    const words = 'Rechnung '.repeat(50_000);
    const docx = await buildDocx(
      `${DOCUMENT_XML_PREFIX}<w:p><w:r><w:t>${words}Ende</w:t></w:r></w:p></w:body></w:document>`,
    );

    const text = await extractAttachmentTextFromBuffer(docx, 'docx');
    expect(text.startsWith('Rechnung Rechnung')).toBe(true);
    expect(text.endsWith('Rechnung Ende')).toBe(true);
  });

  test('ordinary DOCX give the worker the same text as the former in-process parse', async () => {
    const documents = [
      `${DOCUMENT_XML_PREFIX}<w:p><w:r><w:t>Hallo CRM</w:t></w:r></w:p></w:body></w:document>`,
      `${DOCUMENT_XML_PREFIX}<w:p><w:r><w:t>Angebot für Müller &amp; Söhne</w:t></w:r></w:p>`
        + '<w:p><w:r><w:t xml:space="preserve">Position 1</w:t><w:tab/><w:t>12,50 €</w:t><w:br/><w:t>Zeile 2</w:t></w:r></w:p>'
        + '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Zelle A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Zelle B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'
        + '</w:body></w:document>',
      `${DOCUMENT_XML_PREFIX}<w:p><w:r><w:t>${'Rechnung '.repeat(80_000)}Ende</w:t></w:r></w:p></w:body></w:document>`,
    ];
    for (const documentXml of documents) {
      const docx = await buildDocx(documentXml);
      const inProcess = await extractDocxText(docx);
      expect(inProcess.length).toBeGreaterThan(0);
      await expect(extractAttachmentTextFromBuffer(docx, 'docx')).resolves.toBe(inProcess);
    }
    await expect(extractAttachmentTextFromBuffer(await buildDocx(documents[1]), 'docx')).resolves.toBe(
      'Angebot für Müller & Söhne Position 1 12,50 €Zeile 2 Zelle A Zelle B',
    );
  }, 60_000);

  // C-A7: Das Parse-Timeout lehnte nur das Promise ab; mammoth rechnete im Hauptprozess weiter. Jetzt wird der Worker beendet.
  test('terminates the parse worker when the timeout expires', async () => {
    const terminate = jest.spyOn(Worker.prototype, 'terminate');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(extractDocxTextInWorker(buildDomBomb(), 300)).rejects.toThrow('DOCX parse stopped: timeout after 300 ms');
    expect(terminate).toHaveBeenCalled();
    await expect(terminate.mock.results[0]!.value).resolves.toEqual(expect.any(Number));
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[mail] attachment text: DOCX parse stopped: timeout'));
  }, 30_000);

  // C-A7: Ein prozessweites --max-old-space-size (NODE_OPTIONS) hebt resourceLimits auf; dann beendet der Elternprozess den Worker.
  test('stops the worker itself when a process-wide heap flag overrides its limit', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const terminate = jest.spyOn(Worker.prototype, 'terminate');
    jest
      .spyOn(Worker.prototype, 'getHeapStatistics')
      .mockResolvedValue({ heap_size_limit: 4096 * MIB, used_heap_size: 600 * MIB } as Awaited<
        ReturnType<Worker['getHeapStatistics']>
      >);

    await expect(extractDocxTextInWorker(buildDomBomb(), 30_000)).rejects.toThrow(
      'DOCX parse stopped: heap limit 512 MB',
    );
    expect(terminate).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[mail] attachment text: DOCX parse stopped: heap limit'));
  }, 30_000);

  test('leaves the stop to V8 while the worker heap limit is in effect', async () => {
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const stats = jest
      .spyOn(Worker.prototype, 'getHeapStatistics')
      .mockResolvedValue({ heap_size_limit: 560 * MIB, used_heap_size: 540 * MIB } as Awaited<
        ReturnType<Worker['getHeapStatistics']>
      >);

    await expect(extractDocxTextInWorker(buildDomBomb(), 500)).rejects.toThrow(
      'DOCX parse stopped: timeout after 500 ms',
    );
    expect(stats).toHaveBeenCalled();
  }, 30_000);
});

/** Minimal single-page PDF containing the given ASCII text. */
function buildMiniPdf(text: string): Buffer {
  const objs: string[] = [];
  objs[1] = '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n';
  objs[2] = '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n';
  objs[3] = '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n';
  const stream = `BT /F1 24 Tf 72 700 Td (${text}) Tj ET`;
  objs[4] = `4 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`;
  objs[5] = '5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n';
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [0];
  for (let i = 1; i <= 5; i += 1) {
    offsets[i] = pdf.length;
    pdf += objs[i];
  }
  const xrefPos = pdf.length;
  pdf += 'xref\n0 6\n0000000000 65535 f \n';
  for (let i = 1; i <= 5; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

// Ein präpariertes PDF konnte pdf.js im Hauptprozess des Servers blockieren, und nach dem
// Timeout lief das Parsen weiter. Jetzt läuft es wie DOCX in einem Worker mit eigener
// Speichergrenze, der beim Timeout beendet wird. Anhänge werden nur gelesen, nie ausgeführt.
describe('server PDF text extraction runs isolated in a worker', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('extracts the text of a PDF through the worker', async () => {
    const terminate = jest.spyOn(Worker.prototype, 'terminate');
    await expect(extractAttachmentTextFromBuffer(buildMiniPdf('Suchtext im PDF'), 'pdf')).resolves.toContain('Suchtext im PDF');
    expect(terminate).toHaveBeenCalled();
  }, 30_000);

  test('terminates the PDF worker when the timeout expires', async () => {
    const terminate = jest.spyOn(Worker.prototype, 'terminate');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(extractPdfTextInWorker(buildMiniPdf('langsam'), 1)).rejects.toThrow('PDF parse stopped: timeout after 1 ms');
    expect(terminate).toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[mail] attachment text: PDF parse stopped: timeout'));
  }, 30_000);

  test('a damaged PDF fails in the worker, not in the server', async () => {
    await expect(extractPdfTextInWorker(Buffer.from('%PDF-1.4 kaputt'), 15_000)).rejects.toThrow();
  }, 30_000);
});
