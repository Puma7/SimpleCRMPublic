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
