const SAFE_INLINE_ATTACHMENT_MIME_TYPES = new Set([
  'application/pdf',
  'image/avif',
  'image/bmp',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

/** Active formats (HTML/SVG/XML/scripts) must never execute in the CRM origin. */
export function isSafeAttachmentMimeTypeForInlineOpen(contentType: string | null | undefined): boolean {
  const mimeType = contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  return SAFE_INLINE_ATTACHMENT_MIME_TYPES.has(mimeType);
}
