/** Pure dispatch/cap logic for attachment text extraction (Suche Phase 2).
 * The actual pdf/docx parsing lives in thin per-side wrappers (electron,
 * server) so core stays dependency-free. */

/** Files larger than this are skipped entirely. */
export const ATTACHMENT_TEXT_MAX_BYTES = 15 * 1024 * 1024;

/** Extracted text is capped at this many characters. */
export const ATTACHMENT_TEXT_MAX_CHARS = 500_000;

/**
 * Bumped whenever a new format becomes extractable: attachments tried with an
 * older version and without text are extracted once more.
 */
export const ATTACHMENT_TEXT_EXTRACTOR_VERSION = 2;

export type AttachmentTextKind =
  | 'text'
  | 'html'
  | 'pdf'
  | 'docx'
  | 'xlsx'
  | 'xlsb'
  | 'xls'
  | 'ods'
  | 'odt'
  | 'rtf'
  | 'doc'
  | 'pptx';

const EXTENSION_KINDS: Record<string, AttachmentTextKind> = {
  txt: 'text',
  text: 'text',
  md: 'text',
  markdown: 'text',
  csv: 'text',
  tsv: 'text',
  tab: 'text',
  log: 'text',
  json: 'text',
  xml: 'text',
  yaml: 'text',
  yml: 'text',
  ics: 'text',
  vcf: 'text',
  html: 'html',
  htm: 'html',
  pdf: 'pdf',
  docx: 'docx',
  docm: 'docx',
  dotx: 'docx',
  xlsx: 'xlsx',
  xlsm: 'xlsx',
  xltx: 'xlsx',
  xltm: 'xlsx',
  xlsb: 'xlsb',
  xls: 'xls',
  xlt: 'xls',
  ods: 'ods',
  ots: 'ods',
  odt: 'odt',
  ott: 'odt',
  odp: 'odt',
  otp: 'odt',
  rtf: 'rtf',
  doc: 'doc',
  dot: 'doc',
  pptx: 'pptx',
  pptm: 'pptx',
  ppsx: 'pptx',
};

const CONTENT_TYPE_KINDS: Record<string, AttachmentTextKind> = {
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/x-markdown': 'text',
  'text/csv': 'text',
  'text/tab-separated-values': 'text',
  'text/calendar': 'text',
  'text/vcard': 'text',
  'text/x-vcard': 'text',
  'text/xml': 'text',
  'application/xml': 'text',
  'application/json': 'text',
  'text/html': 'html',
  'application/pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-excel.sheet.macroenabled.12': 'xlsx',
  'application/vnd.ms-excel.sheet.binary.macroenabled.12': 'xlsb',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.oasis.opendocument.spreadsheet': 'ods',
  'application/vnd.oasis.opendocument.text': 'odt',
  'application/vnd.oasis.opendocument.presentation': 'odt',
  'application/rtf': 'rtf',
  'text/rtf': 'rtf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
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

function startsWith(head: Uint8Array, bytes: readonly number[]): boolean {
  return bytes.every((byte, index) => head[index] === byte);
}

/**
 * The kind by the file's first bytes where names lie: an "xls" that is really
 * CSV or HTML (common exports), a "doc" that is RTF, an "xls" that is a zip.
 */
export function refineAttachmentTextKind(kind: AttachmentTextKind, head: Uint8Array): AttachmentTextKind {
  const isCompound = startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
  const isZip = startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
  const isPdf = startsWith(head, [0x25, 0x50, 0x44, 0x46]);
  const isRtf = startsWith(head, [0x7b, 0x5c, 0x72, 0x74, 0x66]);
  if (isPdf) return 'pdf';
  if (isRtf) return 'rtf';
  if (kind === 'xls' || kind === 'doc') {
    if (isCompound) return kind;
    if (isZip) return kind === 'xls' ? 'xlsx' : 'docx';
    const start = new TextDecoder('latin1').decode(head.subarray(0, 512)).trimStart().toLowerCase();
    return start.startsWith('<') ? 'html' : 'text';
  }
  return kind;
}

const TEXT_UTF8 = new TextDecoder('utf-8', { fatal: true });

/**
 * Text files as their authors wrote them: BOM (UTF-8, UTF-16 LE/BE), UTF-16
 * without BOM (Excel "Unicode text"), UTF-8, else Windows-1252 (Excel CSV).
 */
export function decodeAttachmentText(data: Uint8Array): string {
  if (startsWith(data, [0xef, 0xbb, 0xbf])) return new TextDecoder('utf-8').decode(data.subarray(3));
  if (startsWith(data, [0xff, 0xfe])) return new TextDecoder('utf-16le').decode(data.subarray(2));
  if (startsWith(data, [0xfe, 0xff])) return new TextDecoder('utf-16be').decode(data.subarray(2));
  const sample = data.subarray(0, 4096);
  let oddZeros = 0;
  let evenZeros = 0;
  for (let i = 0; i + 1 < sample.length; i += 2) {
    if (sample[i] === 0) evenZeros += 1;
    if (sample[i + 1] === 0) oddZeros += 1;
  }
  const pairs = Math.floor(sample.length / 2);
  if (pairs > 0 && oddZeros / pairs > 0.3 && evenZeros / pairs < 0.05) return new TextDecoder('utf-16le').decode(data);
  if (pairs > 0 && evenZeros / pairs > 0.3 && oddZeros / pairs < 0.05) return new TextDecoder('utf-16be').decode(data);
  try {
    return TEXT_UTF8.decode(data);
  } catch {
    try {
      return new TextDecoder('windows-1252').decode(data);
    } catch {
      return new TextDecoder('latin1').decode(data);
    }
  }
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
