/** Pure dispatch/cap logic for attachment text extraction (Suche Phase 2).
 * The actual pdf/docx parsing lives in thin per-side wrappers (electron,
 * server) so core stays dependency-free. */

/** Files larger than this are skipped entirely. */
export const ATTACHMENT_TEXT_MAX_BYTES = 15 * 1024 * 1024;

/** Extracted text is capped at this many characters. */
export const ATTACHMENT_TEXT_MAX_CHARS = 500_000;

export type AttachmentTextKind = 'text' | 'html' | 'pdf' | 'docx';

const EXTENSION_KINDS: Record<string, AttachmentTextKind> = {
  txt: 'text',
  md: 'text',
  csv: 'text',
  log: 'text',
  html: 'html',
  htm: 'html',
  pdf: 'pdf',
  docx: 'docx',
};

const CONTENT_TYPE_KINDS: Record<string, AttachmentTextKind> = {
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/csv': 'text',
  'text/html': 'html',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
};

/** Extraction kind by filename extension / content type; null = unsupported. */
export function attachmentTextKind(
  filename: string | null | undefined,
  contentType?: string | null,
): AttachmentTextKind | null {
  const ext = (filename ?? '').toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext && EXTENSION_KINDS[ext]) return EXTENSION_KINDS[ext];
  const ct = (contentType ?? '').toLowerCase().split(';')[0]!.trim();
  if (ct && CONTENT_TYPE_KINDS[ct]) return CONTENT_TYPE_KINDS[ct];
  return null;
}

/** Collapse whitespace and cap for storage/indexing. */
export function capAttachmentText(text: string, cap = ATTACHMENT_TEXT_MAX_CHARS): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  return collapsed.length > cap ? collapsed.slice(0, cap) : collapsed;
}

/** DOCX (ZIP) budget for text extraction: entry count and bytes actually inflated. */
export const DOCX_MAX_ARCHIVE_ENTRIES = 2_048;
export const DOCX_MAX_INFLATED_BYTES = 32 * 1024 * 1024;

type DocxZipStream = {
  on(event: 'data', listener: (chunk: Uint8Array) => void): DocxZipStream;
  on(event: 'error', listener: (error: Error) => void): DocxZipStream;
  on(event: 'end', listener: () => void): DocxZipStream;
  resume(): DocxZipStream;
  pause(): DocxZipStream;
};

/** The slice of JSZip's API the inflate check needs (JSZip itself is a mammoth dependency). */
export type DocxZipLoader = {
  loadAsync(data: Uint8Array): Promise<{
    files: Record<string, { dir: boolean; internalStream(type: 'uint8array'): DocxZipStream }>;
  }>;
};

/**
 * Zip-bomb guard before handing a DOCX to mammoth. Declared entry sizes are
 * attacker-controlled and JSZip only compares them after inflating
 * everything, so this inflates every entry and counts the bytes actually
 * produced, stopping at the budget. `jszip` must be the JSZip mammoth itself
 * loads: a different ZIP parser (e.g. yauzl) can be shown other entries than
 * mammoth reads by a crafted central directory.
 */
export async function assertDocxInflatesWithinLimit(
  buf: Uint8Array,
  jszip: DocxZipLoader,
): Promise<void> {
  const unsafe = () => new Error('DOCX archive exceeds safe expansion limit');
  const zip = await jszip.loadAsync(buf);
  const entries = Object.values(zip.files);
  if (entries.length > DOCX_MAX_ARCHIVE_ENTRIES) throw unsafe();
  let inflatedBytes = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    await new Promise<void>((resolve, reject) => {
      const stream = entry.internalStream('uint8array');
      let settled = false;
      stream
        .on('data', (chunk) => {
          if (settled) return;
          inflatedBytes += chunk.length;
          if (inflatedBytes > DOCX_MAX_INFLATED_BYTES) {
            settled = true;
            stream.pause();
            reject(unsafe());
          }
        })
        // A corrupt entry only fails once mammoth reads it (as before); its
        // bytes up to the error are already counted.
        .on('error', () => {
          settled = true;
          resolve();
        })
        .on('end', () => {
          settled = true;
          resolve();
        })
        .resume();
    });
  }
}
