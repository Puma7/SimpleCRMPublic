import { isSafeAttachmentMimeTypeForInlineOpen } from '../../shared/email-attachment-open-policy';

describe('email attachment inline-open policy', () => {
  it.each([
    'text/html',
    'image/svg+xml',
    'application/xhtml+xml',
    'text/xml',
    'application/javascript',
    'application/octet-stream',
    '',
  ])('blocks active or unknown content type %p', (contentType) => {
    expect(isSafeAttachmentMimeTypeForInlineOpen(contentType)).toBe(false);
  });

  it.each([
    'application/pdf',
    'application/pdf; charset=binary',
    'image/png',
    'image/jpeg',
    'image/gif',
    'image/webp',
    'image/avif',
  ])('allows passive browser-rendered content type %p', (contentType) => {
    expect(isSafeAttachmentMimeTypeForInlineOpen(contentType)).toBe(true);
  });
});
