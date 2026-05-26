import {
  listEmailAccounts,
  getEmailMessageById,
  listMessagesForAccountView,
  type AccountMailView,
  type EmailAccountRow,
  type EmailMessageRow,
  setMessageArchived,
  setMessageSeenLocal,
  setMessageSpam,
  addMessageTag,
  setMessageAssignedTo,
} from '../email/email-store';
import { setMessageCustomerId } from '../email/email-crm-store';
import { coercePositiveInt } from '../automation/http-response';

const ALLOWED_VIEWS: AccountMailView[] = [
  'inbox',
  'sent',
  'archived',
  'drafts',
  'spam',
  'trash',
  'snoozed',
  'all',
];

export function sanitizeAccount(row: EmailAccountRow) {
  const {
    keytar_account_key: _k,
    smtp_keytar_account_key: _s,
    oauth_refresh_keytar_key: _o,
    ...safe
  } = row;
  return safe;
}

export function sanitizeMessage(row: EmailMessageRow, includeBody: boolean) {
  const base = {
    id: row.id,
    account_id: row.account_id,
    folder_id: row.folder_id,
    uid: row.uid,
    subject: row.subject,
    snippet: row.snippet,
    date_received: row.date_received,
    from_json: row.from_json,
    to_json: row.to_json,
    seen_local: row.seen_local,
    is_spam: row.is_spam,
    archived: row.archived,
    customer_id: row.customer_id,
    assigned_to: row.assigned_to,
    folder_kind: row.folder_kind,
    ticket_code: row.ticket_code,
    has_attachments: row.has_attachments,
    soft_deleted: row.soft_deleted,
  };
  if (!includeBody) return base;
  const text = row.body_text ?? '';
  return {
    ...base,
    body_text: text.length > 32_000 ? `${text.slice(0, 32_000)}…` : text,
  };
}

export const EmailApiService = {
  listAccounts() {
    return listEmailAccounts().map(sanitizeAccount);
  },

  listMessages(opts: {
    accountId: number;
    view?: string;
    since?: string;
    limit?: number;
    offset?: number;
    includeBody?: boolean;
  }) {
    const view = ALLOWED_VIEWS.includes(opts.view as AccountMailView)
      ? (opts.view as AccountMailView)
      : 'inbox';
    const rows = listMessagesForAccountView(opts.accountId, view, {
      limit: opts.limit ?? 100,
      offset: opts.offset ?? 0,
    });
    let filtered = rows;
    if (opts.since) {
      const sinceMs = Date.parse(opts.since);
      if (Number.isFinite(sinceMs)) {
        filtered = rows.filter((r) => {
          const d = r.date_received ?? r.created_at;
          return d ? Date.parse(d) >= sinceMs : false;
        });
      }
    }
    return filtered.map((r) => sanitizeMessage(r, Boolean(opts.includeBody)));
  },

  getMessage(id: number, includeBody: boolean) {
    const row = getEmailMessageById(id);
    if (!row) return null;
    return sanitizeMessage(row, includeBody);
  },

  applyAction(
    messageId: number,
    action: string,
    payload: Record<string, unknown>,
  ): { success: boolean; error?: string } {
    const row = getEmailMessageById(messageId);
    if (!row) return { success: false, error: 'Nachricht nicht gefunden' };

    switch (action) {
      case 'archive':
        setMessageArchived(messageId, true);
        return { success: true };
      case 'unarchive':
        setMessageArchived(messageId, false);
        return { success: true };
      case 'mark_seen':
        setMessageSeenLocal(messageId, true);
        return { success: true };
      case 'mark_unseen':
        setMessageSeenLocal(messageId, false);
        return { success: true };
      case 'spam':
        setMessageSpam(messageId, true);
        return { success: true };
      case 'not_spam':
        setMessageSpam(messageId, false);
        return { success: true };
      case 'link_customer': {
        if (payload.customerId === null) {
          setMessageCustomerId(messageId, null);
          return { success: true };
        }
        const customerId = coercePositiveInt(payload.customerId);
        if (customerId == null) {
          return { success: false, error: 'customerId muss positive Ganzzahl oder null sein' };
        }
        setMessageCustomerId(messageId, customerId);
        return { success: true };
      }
      case 'assign': {
        const teamMemberId = payload.teamMemberId;
        if (teamMemberId !== null && typeof teamMemberId !== 'string') {
          return { success: false, error: 'teamMemberId muss string oder null sein' };
        }
        setMessageAssignedTo(messageId, teamMemberId as string | null);
        return { success: true };
      }
      case 'add_tag': {
        const tag = payload.tag;
        if (typeof tag !== 'string' || !tag.trim()) {
          return { success: false, error: 'tag ist erforderlich' };
        }
        addMessageTag(messageId, tag);
        return { success: true };
      }
      default:
        return {
          success: false,
          error:
            'Unbekannte action (archive, unarchive, mark_seen, mark_unseen, spam, not_spam, link_customer, assign, add_tag)',
        };
    }
  },
};
