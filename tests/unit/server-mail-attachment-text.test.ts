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

describe('server attachment text extraction', () => {
  test('extracts an ordinary DOCX', async () => {
    const docx = await buildDocx(
      '<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>Hallo CRM</w:t></w:r></w:p></w:body></w:document>',
    );

    await expect(extractAttachmentTextFromBuffer(docx, 'docx')).resolves.toContain('Hallo CRM');
  });

  test('rejects a DOCX whose declared expansion exceeds the safe limit', async () => {
    const docx = await buildDocx('A'.repeat(33 * 1024 * 1024));

    await expect(extractAttachmentTextFromBuffer(docx, 'docx'))
      .rejects.toThrow(/DOCX archive exceeds safe expansion limit/);
  });
});
