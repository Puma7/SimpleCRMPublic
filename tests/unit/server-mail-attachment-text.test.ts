/**
 * @jest-environment node
 */
import path from 'node:path';
import { Worker } from 'node:worker_threads';
import { deflateRawSync } from 'node:zlib';

import JSZip from 'jszip';

import { extractDocxText, extractDocxTextInWorker } from '../../packages/server/src/mail-attachment-docx';
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
