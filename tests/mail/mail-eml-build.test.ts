import fs from 'fs';
import os from 'os';
import path from 'path';
import type { EmailMessageRow } from '../../electron/email/email-store';
import type { EmailAttachmentRow } from '../../electron/email/email-message-attachments-store';
import {
  buildEmlForMessage,
  emlFromStorageB64,
  formatEmlDisplayAppendix,
  rfc822SourceToStorageB64,
} from '../../electron/email/mail-eml-build';

function messageRow(overrides: Partial<EmailMessageRow> = {}): EmailMessageRow {
  return {
    id: 1,
    account_id: 2,
    folder_id: 3,
    uid: 100,
    message_id: '<m@x>',
    in_reply_to: null,
    references_header: null,
    subject: 'Test',
    from_json: JSON.stringify({ value: [{ address: 'from@test.de', name: 'From' }] }),
    to_json: JSON.stringify({ value: [{ address: 'to@test.de' }] }),
    cc_json: null,
    bcc_json: null,
    date_received: 'Mon, 1 Jan 2024 00:00:00 +0000',
    snippet: 'snip',
    body_text: 'Hello',
    body_html: '<p>Hello</p>',
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
    raw_rfc822_b64: null,
    created_at: 't',
    auth_spf: 'pass',
    auth_dkim: 'pass',
    auth_dmarc: 'fail',
    auth_arc: null,
    auth_dkim_domains: null,
    ...overrides,
  };
}

describe('mail-eml-build', () => {
  test('rfc822SourceToStorageB64 and emlFromStorageB64 roundtrip', () => {
    const src = 'From: a@b.de\r\n\r\nHi';
    const b64 = rfc822SourceToStorageB64(src);
    expect(emlFromStorageB64(b64)).toBe(src);
    expect(rfc822SourceToStorageB64(Buffer.from(src))).toBe(b64);
  });

  test('buildEmlForMessage returns original when raw b64 present', () => {
    const raw = 'From: a@b.de\r\n\r\nbody';
    const row = messageRow({ raw_rfc822_b64: rfc822SourceToStorageB64(raw) });
    const { eml, meta } = buildEmlForMessage(row, []);
    expect(eml).toBe(raw);
    expect(meta.source).toBe('original');
  });

  test('buildEmlForMessage reconstructs plain, alt, and attachments', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eml-'));
    const attPath = path.join(tmp, 'doc.pdf');
    fs.writeFileSync(attPath, Buffer.from('%PDF-1.4'));
    const att: EmailAttachmentRow = {
      id: 1,
      message_id: 1,
      filename_display: 'doc.pdf',
      content_type: 'application/pdf',
      size_bytes: 8,
      storage_path: attPath,
      created_at: 't',
    };

    const plainOnly = buildEmlForMessage(messageRow({ body_html: null }), []);
    expect(plainOnly.meta.source).toBe('reconstructed');
    expect(plainOnly.eml).toContain('Hello');

    const alt = buildEmlForMessage(messageRow(), []);
    expect(alt.eml).toContain('multipart/alternative');

    const withAtt = buildEmlForMessage(messageRow({ raw_headers: 'From: x@y.de' }), [att]);
    expect(withAtt.eml).toContain('multipart/mixed');
    expect(withAtt.eml).toContain('doc.pdf');

    const missingAtt = buildEmlForMessage(messageRow(), [
      { ...att, storage_path: path.join(tmp, 'missing.pdf') },
    ]);
    expect(missingAtt.meta.note).toMatch(/nicht auf Platte/);

    const noHeaders = buildEmlForMessage(messageRow({ raw_headers: null }), []);
    expect(noHeaders.meta.note).toMatch(/Keine Original-Rohmail/);

    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('formatEmlDisplayAppendix', () => {
    const appendix = formatEmlDisplayAppendix(
      messageRow({ pop3_uidl: 'uidl-1' }),
      { source: 'reconstructed', attachmentCount: 2, note: 'note' },
    );
    expect(appendix).toContain('Rekonstruktion');
    expect(appendix).toContain('POP3 UIDL');
    expect(appendix).toContain('Auth:');
  });
});
