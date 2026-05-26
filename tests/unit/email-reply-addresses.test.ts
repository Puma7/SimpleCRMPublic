import { buildReplyAllRecipients } from '../../shared/email-reply-addresses';

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
});
