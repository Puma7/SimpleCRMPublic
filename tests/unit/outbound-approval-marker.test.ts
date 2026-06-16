import { outboundDraftFingerprint } from '../../packages/core/src/email/outbound-approval-marker';

describe('outboundDraftFingerprint', () => {
  test('normalizes display-name recipient formatting to bare email addresses', () => {
    const base = {
      subject: 'Test',
      bodyText: 'Hello',
      bodyHtml: null as string | null,
      cc: null as string | null,
      bcc: null as string | null,
      attachmentPaths: null as readonly string[] | null,
    };

    const plain = outboundDraftFingerprint({
      ...base,
      to: 'user@example.com',
    });
    const display = outboundDraftFingerprint({
      ...base,
      to: 'John Doe <user@example.com>',
    });

    expect(display).toBe(plain);
  });

  test('treats mixed recipient lists with equivalent addresses as equal', () => {
    const left = outboundDraftFingerprint({
      subject: 'Test',
      bodyText: 'Hello',
      to: 'a@example.com, b@example.com',
      cc: 'Team <cc@example.com>',
    });
    const right = outboundDraftFingerprint({
      subject: 'Test',
      bodyText: 'Hello',
      to: 'A <a@example.com>; B <b@example.com>',
      cc: 'cc@example.com',
    });

    expect(left).toBe(right);
  });
});
