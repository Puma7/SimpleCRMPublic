/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import JSZip from 'jszip';

let releaseParse: (value: { value: string }) => void = () => undefined;
const mockExtractRawText = jest.fn(
  () => new Promise<{ value: string }>((resolve) => { releaseParse = resolve; }),
);

jest.mock('mammoth', () => ({ extractRawText: () => mockExtractRawText() }));

import { extractTextForAttachmentRow } from '../../packages/server/src/mail-attachment-text';

const WS = '11111111-1111-4111-8111-111111111111';

type AttachmentUpdate = { content_text: string | null; text_extracted_at: Date; updated_at: Date };

/** Minimal fake Kysely: records every UPDATE of email_message_attachments. */
function fakeDb(updates: AttachmentUpdate[]) {
  const trx = {
    updateTable: () => {
      const builder = {
        set: (values: AttachmentUpdate) => {
          updates.push(values);
          return builder;
        },
        where: () => builder,
        execute: async () => [],
      };
      return builder;
    },
  };
  return { transaction: () => ({ execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx) }) } as never;
}

async function buildMiniDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', '<w:document><w:body><w:p><w:r><w:t>x</w:t></w:r></w:p></w:body></w:document>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('server attachment text extraction crash loop', () => {
  let tmpDir: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scm-srv-att-crash-'));
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // C-A7: Der Server markierte die Zeile erst nach dem Parse; brachte der Parser den Prozess zum Absturz,
  // griff der Backfill-Ticker dieselbe Zeile nach jedem Neustart erneut (Absturzschleife).
  test('marks the row as tried before the parser runs', async () => {
    fs.writeFileSync(path.join(tmpDir, 'bericht.docx'), await buildMiniDocx());
    const updates: AttachmentUpdate[] = [];

    const pending = extractTextForAttachmentRow(
      { db: fakeDb(updates), attachmentsRoot: tmpDir, applyWorkspaceSession: async () => undefined },
      {
        id: 7,
        workspace_id: WS,
        filename_display: 'bericht.docx',
        content_type: null,
        size_bytes: fs.statSync(path.join(tmpDir, 'bericht.docx')).size,
        storage_path: 'bericht.docx',
      },
    );
    for (let i = 0; i < 50 && mockExtractRawText.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(mockExtractRawText).toHaveBeenCalledTimes(1);

    // Parser still running (in production: possibly about to crash the process).
    expect(updates).toEqual([{ content_text: null, text_extracted_at: expect.any(Date), updated_at: expect.any(Date) }]);

    releaseParse({ value: 'Inhalt' });
    await expect(pending).resolves.toBe(true);
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({ content_text: 'Inhalt' });
  });
});
