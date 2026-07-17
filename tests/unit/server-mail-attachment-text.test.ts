/**
 * @jest-environment node
 */
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
});
