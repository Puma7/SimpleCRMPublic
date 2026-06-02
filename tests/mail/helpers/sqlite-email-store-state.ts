/** Stateful in-memory layer for sqlite-email-store-mock branch tests. */
import type { EmailMessageRow } from '../../../electron/email/email-store';

export type EmailStoreState = {
  accounts: Map<number, Record<string, unknown>>;
  folders: Map<number, Record<string, unknown>>;
  messages: Map<number, EmailMessageRow & Record<string, unknown>>;
  tags: Map<number, Set<string>>;
  signatures: Map<number, string>;
  teamMembers: { id: string; display_name: string; role: string; signature_html: string | null; sort_order: number; created_at: string }[];
  nextAccountId: number;
  nextFolderId: number;
  nextMessageId: number;
};

export function createEmailStoreState(): EmailStoreState {
  const state: EmailStoreState = {
    accounts: new Map(),
    folders: new Map(),
    messages: new Map(),
    tags: new Map(),
    signatures: new Map(),
    teamMembers: [],
    nextAccountId: 1,
    nextFolderId: 10,
    nextMessageId: 100,
  };

  const account = {
    id: 1,
    display_name: 'Test',
    email_address: 'a@b.de',
    imap_host: 'imap.example.com',
    imap_port: 993,
    imap_tls: 1,
    imap_username: 'a@b.de',
    keytar_account_key: 'k1',
    smtp_host: null,
    smtp_port: 587,
    smtp_tls: 1,
    smtp_username: null,
    smtp_use_imap_auth: 1,
    smtp_keytar_account_key: null,
    protocol: 'imap',
    pop3_host: null,
    pop3_port: 995,
    pop3_tls: 1,
    oauth_provider: null,
    oauth_refresh_keytar_key: null,
    sent_folder_path: 'Sent',
    imap_sync_seen_on_open: 1,
    vacation_enabled: 0,
    vacation_subject: null,
    vacation_body_text: null,
    request_read_receipt: 0,
    created_at: 't',
    updated_at: 't',
  };
  state.accounts.set(1, account);

  state.folders.set(10, {
    id: 10,
    account_id: 1,
    path: 'INBOX',
    delimiter: '/',
    uidvalidity: 1,
    uidvalidity_str: '1',
    last_uid: 5,
    last_synced_at: 't',
    pop3_uidl_str: null,
  });

  seedMessage(state, {
    id: 100,
    account_id: 1,
    folder_id: 10,
    uid: 6,
    message_id: '<m@x>',
    subject: 'Subj',
    from_json: '[]',
    to_json: '[]',
    cc_json: '[]',
    folder_kind: 'inbox',
    archived: 0,
    is_spam: 0,
    soft_deleted: 0,
    seen_local: 0,
    outbound_hold: 0,
    pop3_uidl: null,
    body_text: 'body',
    snippet: 'hi',
  });

  return state;
}

export function seedMessage(state: EmailStoreState, partial: Record<string, unknown>): EmailMessageRow {
  const id = (partial.id as number) ?? state.nextMessageId++;
  const row = {
    id,
    account_id: 1,
    folder_id: 10,
    uid: 6,
    message_id: null,
    in_reply_to: null,
    references_header: null,
    subject: null,
    from_json: null,
    to_json: null,
    cc_json: null,
    bcc_json: null,
    date_received: null,
    snippet: null,
    body_text: null,
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
    spam_status: 'clean',
    spam_score: null,
    spam_score_label: null,
    spam_decision_source: null,
    spam_score_breakdown_json: null,
    spam_decided_at: null,
    pop3_uidl: null,
    raw_headers: null,
    raw_rfc822_b64: null,
    post_process_done: 1,
    draft_attachment_paths_json: null,
    reply_parent_message_id: null,
    trash_prev_archived: null,
    trash_prev_is_spam: null,
    trash_prev_folder_kind: null,
    created_at: 't',
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
    ...partial,
  } as EmailMessageRow & Record<string, unknown>;
  state.messages.set(id, row);
  return row as EmailMessageRow;
}
