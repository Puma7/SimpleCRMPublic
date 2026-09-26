/**
 * @jest-environment node
 */
import fs from 'fs';
import os from 'os';
import path from 'path';

import JSZip from 'jszip';

let releaseParse: (text: string) => void = () => undefined;
// The DOCX parse runs in a worker thread (C-A7); the test holds it at that call.
const mockExtractDocx = jest.fn(
  (): Promise<string> => new Promise<string>((resolve) => { releaseParse = resolve; }),
);

jest.mock('../../packages/server/src/mail-attachment-docx', () => ({
  extractDocxTextInWorker: () => mockExtractDocx(),
}));

import { ATTACHMENT_TEXT_EXTRACTOR_VERSION } from '../../packages/core/src/email/attachment-text';
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
    for (let i = 0; i < 50 && mockExtractDocx.mock.calls.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(mockExtractDocx).toHaveBeenCalledTimes(1);

    // Parser still running (in production: possibly about to crash the process).
    // The mark carries the current extractor version, so a crash is not retried
    // by the re-extraction of rows older versions left without text either.
    expect(updates).toEqual([{
      content_text: null,
      text_extracted_at: expect.any(Date),
      text_extractor_version: ATTACHMENT_TEXT_EXTRACTOR_VERSION,
      updated_at: expect.any(Date),
    }]);

    releaseParse('Inhalt');
    await expect(pending).resolves.toBe(true);
    expect(updates).toHaveLength(2);
    expect(updates[1]).toMatchObject({ content_text: 'Inhalt' });
  });

  // C-A7: Stoesst der Parser-Worker an sein Heap-Limit oder das Timeout, bleibt die Zeile ohne Text markiert.
  test('a worker stopped at its heap limit leaves the row marked without text', async () => {
    fs.writeFileSync(path.join(tmpDir, 'bombe.docx'), await buildMiniDocx());
    mockExtractDocx.mockImplementationOnce(() => Promise.reject(new Error('DOCX parse stopped: heap limit 512 MB')));
    const updates: AttachmentUpdate[] = [];

    await expect(
      extractTextForAttachmentRow(
        { db: fakeDb(updates), attachmentsRoot: tmpDir, applyWorkspaceSession: async () => undefined },
        {
          id: 8,
          workspace_id: WS,
          filename_display: 'bombe.docx',
          content_type: null,
          size_bytes: fs.statSync(path.join(tmpDir, 'bombe.docx')).size,
          storage_path: 'bombe.docx',
        },
      ),
    ).resolves.toBe(false);
    // Marked before the parse, marked again after the worker stopped: never with text.
    expect(updates).toHaveLength(2);
    expect(updates.every((update) => update.content_text === null)).toBe(true);
  });
});
