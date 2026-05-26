jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getCustomerById: jest.fn(() => null),
}));

import type { EmailMessageRow } from '../../electron/email/email-store';
import { canSuggestReplyForMessage } from '../../electron/email/email-reply-ai';

function baseRow(over: Partial<EmailMessageRow>): EmailMessageRow {
  return {
    id: 1,
    account_id: 1,
    folder_id: 1,
    uid: 10,
    message_id: '<a@b>',
    in_reply_to: null,
    references_header: null,
    subject: 'Test',
    from_json: JSON.stringify({ value: [{ address: 'user@example.com' }] }),
    to_json: null,
    cc_json: null,
    bcc_json: null,
    date_received: new Date().toISOString(),
    snippet: 'Hello world body text',
    body_text: 'Hello world body text',
    body_html: null,
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
    raw_headers: null,
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
    draft_attachment_paths_json: null,
    created_at: new Date().toISOString(),
    ...over,
  };
}

describe('canSuggestReplyForMessage guards', () => {
  it('rejects mailer-daemon', () => {
    const row = baseRow({
      from_json: JSON.stringify({ value: [{ address: 'MAILER-DAEMON@googlemail.com' }] }),
    });
    expect(canSuggestReplyForMessage(row)).toBe(false);
  });

  it('rejects auto-submitted mail', () => {
    const row = baseRow({
      raw_headers: 'Auto-Submitted: auto-replied',
    });
    expect(canSuggestReplyForMessage(row)).toBe(false);
  });

  it('allows normal inbound', () => {
    expect(canSuggestReplyForMessage(baseRow({}))).toBe(true);
  });
});
