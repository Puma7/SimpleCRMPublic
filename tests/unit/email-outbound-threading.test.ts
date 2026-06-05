import {
  buildOutboundThreadingHeaders,
  generateOutboundMessageId,
  normalizeMessageIdHeader,
} from '../../packages/core/src/email';

describe('email outbound threading', () => {
  test('generateOutboundMessageId uses sender domain', () => {
    const id = generateOutboundMessageId('Team <shop@firma.de>');
    expect(id).toMatch(/^<.+\@firma\.de>$/);
  });

  test('buildOutboundThreadingHeaders chains references', () => {
    const headers = buildOutboundThreadingHeaders({
      message_id: '<parent@example.com>',
      references_header: '<a@x.com> <b@x.com>',
    });
    expect(headers.inReplyTo).toBe('<parent@example.com>');
    expect(headers.references).toContain('<parent@example.com>');
    expect(headers.references).toContain('<a@x.com>');
  });

  test('normalizeMessageIdHeader adds angle brackets', () => {
    expect(normalizeMessageIdHeader('abc@x.com')).toBe('<abc@x.com>');
  });
});
