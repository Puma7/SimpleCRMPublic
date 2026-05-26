import { buildReplyAllRecipients, primaryReplyRecipient } from '../../shared/email-reply-addresses';

describe('buildReplyAllRecipients', () => {
  it('puts sender in To and other recipients in Cc', () => {
    const message = {
      from_json: JSON.stringify({
        value: [{ address: 'sender@example.com', name: 'Sender' }],
      }),
      to_json: JSON.stringify({
        value: [
          { address: 'me@shop.test' },
          { address: 'other@example.com' },
        ],
      }),
      cc_json: JSON.stringify({
        value: [{ address: 'cc@example.com' }],
      }),
    };
    const { to, cc } = buildReplyAllRecipients(message, ['me@shop.test']);
    expect(to).toBe('sender@example.com');
    expect(cc).toContain('other@example.com');
    expect(cc).toContain('cc@example.com');
    expect(cc).not.toContain('me@shop.test');
    expect(cc).not.toContain('sender@example.com');
  });

  it('prefers Reply-To over From for reply-all To', () => {
    const message = {
      from_json: JSON.stringify({
        value: [{ address: 'from@list.com' }],
      }),
      to_json: JSON.stringify({ value: [{ address: 'me@shop.test' }] }),
      cc_json: null,
      raw_headers: 'Reply-To: support@helpdesk.example.com\r\n',
    };
    const { to } = buildReplyAllRecipients(message, ['me@shop.test']);
    expect(to).toBe('support@helpdesk.example.com');
  });

  it('primaryReplyRecipient uses Reply-To', () => {
    const to = primaryReplyRecipient({
      from_json: JSON.stringify({ value: [{ address: 'from@x.de' }] }),
      raw_headers: 'Reply-To: real@x.de',
    });
    expect(to).toBe('real@x.de');
  });
});
