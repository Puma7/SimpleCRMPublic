import {
  buildEmlForMessage,
  emlFromStorageB64,
  rfc822SourceToStorageB64,
} from '../../electron/email/mail-eml-build';
import type { EmailMessageRow } from '../../electron/email/email-store';

function baseRow(overrides: Partial<EmailMessageRow> = {}): EmailMessageRow {
  return {
    id: 1,
    account_id: 1,
    folder_id: 1,
    uid: 42,
    message_id: '<test@example.com>',
    in_reply_to: null,
    references_header: null,
    subject: 'Test',
    from_json: JSON.stringify({ value: [{ address: 'a@b.com', name: 'A' }] }),
    to_json: JSON.stringify({ value: [{ address: 'c@d.com' }] }),
    cc_json: null,
    date_received: '2026-01-01T12:00:00.000Z',
    snippet: 'Hi',
    body_text: 'Hello plain',
    body_html: '<p>Hello html</p>',
    seen_local: 0,
    archived: 0,
    soft_deleted: 0,
    outbound_hold: 0,
    outbound_block_reason: null,
    thread_id: null,
    ticket_code: null,
    customer_id: null,
    folder_kind: 'inbox',
    imap_thread_id: null,
    has_attachments: 0,
    attachments_json: null,
    assigned_to: null,
    is_spam: 0,
    pop3_uidl: null,
    raw_headers: 'From: a@b.com\r\nSubject: Test',
    raw_rfc822_b64: null,
    auth_spf: null,
    auth_dkim: null,
    auth_dmarc: null,
    auth_arc: null,
    auth_dkim_domains: null,
    auth_error: null,
    rspamd_score: null,
    rspamd_action: null,
    rspamd_symbols: null,
    rspamd_error: null,
    security_checked_at: null,
    created_at: '2026-01-01',
    ...overrides,
  };
}

describe('rfc822SourceToStorageB64', () => {
  it('round-trips source bytes', () => {
    const src = 'From: x@y.z\r\n\r\nBody';
    const b64 = rfc822SourceToStorageB64(Buffer.from(src));
    expect(emlFromStorageB64(b64)).toBe(src);
  });
});

describe('buildEmlForMessage', () => {
  it('returns original when raw_rfc822_b64 is stored', () => {
    const original = 'From: shop@test\r\nTo: me@test\r\n\r\nFull body';
    const row = baseRow({ raw_rfc822_b64: rfc822SourceToStorageB64(original) });
    const { eml, meta } = buildEmlForMessage(row, []);
    expect(meta.source).toBe('original');
    expect(eml).toBe(original);
  });

  it('reconstructs multipart alternative from text and html', () => {
    const row = baseRow();
    const { eml, meta } = buildEmlForMessage(row, []);
    expect(meta.source).toBe('reconstructed');
    expect(eml).toContain('From: a@b.com');
    expect(eml).toContain('multipart/alternative');
    expect(eml).toContain('Hello plain');
    expect(eml).toContain('<p>Hello html</p>');
  });

  it('ignores corrupt raw_headers and synthesizes from row fields', () => {
    const row = baseRow({
      raw_headers: '[object Object]\n[object Object]\n',
      raw_rfc822_b64: null,
    });
    const { eml } = buildEmlForMessage(row, []);
    expect(eml).toMatch(/From: .+a@b\.com/);
    expect(eml).not.toContain('[object Object]');
  });
});
