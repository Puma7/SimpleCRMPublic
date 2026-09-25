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

  // F-A5-01: Die Antwort-Vorbelegung kuerzte '+tag' und schrieb den Local-Part klein; die Antwort ging an eine andere Mailbox.
  it('keeps exact delivery addresses and compares own and duplicate addresses by identity', () => {
    const message = {
      from_json: JSON.stringify({
        value: [{ address: 'Kunde+Shop@Example.com', name: 'Mueller, Hans' }],
      }),
      to_json: JSON.stringify({
        value: [
          { address: 'Me+Ticket@Shop.test' },
          { address: 'Rechnung+2026@Firma.de' },
          { address: 'kunde@example.com' },
        ],
      }),
      cc_json: JSON.stringify({ value: [{ address: 'rechnung+2026@firma.de' }] }),
    };
    const { to, cc } = buildReplyAllRecipients(message, ['me@shop.test']);
    expect(to).toBe('Kunde+Shop@example.com');
    // Own plus alias, the sender's base address and the duplicate stay out, as before.
    expect(cc).toBe('Rechnung+2026@firma.de');
  });

  it('primaryReplyRecipient keeps the Reply-To mailbox exactly', () => {
    expect(primaryReplyRecipient({
      from_json: JSON.stringify({ value: [{ address: 'from@x.de' }] }),
      raw_headers: 'Reply-To: "Support, Team" <Help+Desk@Example.com>\r\n',
    })).toBe('Help+Desk@example.com');
    expect(primaryReplyRecipient({
      from_json: JSON.stringify({ value: [{ address: 'Kunde+Shop@Example.com' }] }),
    })).toBe('Kunde+Shop@example.com');
  });

  it('primaryReplyRecipient uses Reply-To', () => {
    const to = primaryReplyRecipient({
      from_json: JSON.stringify({ value: [{ address: 'from@x.de' }] }),
      raw_headers: 'Reply-To: real@x.de',
    });
    expect(to).toBe('real@x.de');
  });
});
