import { outboundApprovalFingerprint, outboundDraftFingerprint } from '../../packages/core/src/email/outbound-approval-marker';

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

describe('outboundApprovalFingerprint', () => {
  const content = { subject: 'Angebot', bodyText: 'Hallo', bodyHtml: null, to: 'kunde@example.com', cc: null, bcc: null, attachmentPaths: null };

  test('bindet das Absenderkonto', () => {
    expect(outboundApprovalFingerprint({ ...content, accountId: 1 })).not.toBe(outboundApprovalFingerprint({ ...content, accountId: 2 }));
  });

  test('Konto-ID als Zahl oder Text ist gleich', () => {
    expect(outboundApprovalFingerprint({ ...content, accountId: 501 })).toBe(outboundApprovalFingerprint({ ...content, accountId: '501' }));
  });

  test('eigenes Format, verschieden vom reinen Inhalts-Fingerprint', () => {
    const value = outboundApprovalFingerprint({ ...content, accountId: 1 });
    expect(value).toMatch(/^[0-9a-f]{32}$/);
    expect(value).not.toBe(outboundDraftFingerprint(content));
  });
});
