/**
 * @jest-environment node
 */
import { deflateRawSync } from 'node:zlib';

import JSZip from 'jszip';

import { extractAttachmentTextFromBuffer } from '../../packages/server/src/mail-attachment-text';

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
});
