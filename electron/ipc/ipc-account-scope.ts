import { getEmailMessageById } from '../email/email-store';

/** Channels with `accountScope: number | 'all'` — no single-account gate. */
export const EMAIL_MULTI_ACCOUNT_CHANNELS = new Set<string>([
  'email:list-messages-by-view',
  'email:list-message-ids-by-view',
  'email:search-messages',
  'email:list-conversation-messages',
  'email:category-counts',
  'email:mail-folder-counts',
  'email:list-threads-by-view',
  'email:reporting',
]);

/** Global / admin — no accountScope from payload. */
export const EMAIL_SKIP_ACCOUNT_SCOPE = new Set<string>([
  'email:list-accounts',
  'email:create-account',
  'email:list-workflows',
  'email:get-workflow',
  'email:create-workflow',
  'email:update-workflow',
  'email:delete-workflow',
  'email:compile-workflow-graph',
  'email:backfill-inbound-workflows',
  'email:fire-webhook-workflow',
  'email:list-categories',
  'email:list-canned-responses',
  'email:list-ai-prompts',
  'email:list-team-members',
  'email:get-mail-diagnostics',
  'email:get-google-oauth-app-settings',
  'email:get-microsoft-oauth-app-settings',
  'email:build-microsoft-oauth-url',
  'email:pick-compose-attachments',
  'email:pick-local-mail-backup-zip',
  'email:test-imap',
  'email:test-smtp',
  'email:test-pop3',
  'email:gdpr-export',
  'email:get-reply-suggestion-settings',
  'email:set-reply-suggestion-settings',
  'email:get-snooze-settings',
  'email:set-snooze-settings',
  'email:get-misc-settings',
  'email:set-misc-settings',
  'email:get-mail-security-settings',
  'email:set-mail-security-settings',
  'email:backfill-customer-links',
]);

export function ipcPayloadAccountId(payload: unknown): number | undefined {
  if (typeof payload === 'number' && Number.isInteger(payload) && payload > 0) {
    return payload;
  }
  if (payload == null || typeof payload !== 'object') return undefined;
  const o = payload as Record<string, unknown>;
  for (const key of ['accountId', 'accountScope'] as const) {
    const v = o[key];
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  }
  if (typeof o.id === 'number' && Number.isInteger(o.id) && o.id > 0) {
    return o.id;
  }
  return undefined;
}

export function ipcPayloadMessageId(payload: unknown): number | undefined {
  if (typeof payload === 'number' && Number.isInteger(payload) && payload > 0) {
    return payload;
  }
  if (payload == null || typeof payload !== 'object') return undefined;
  const o = payload as Record<string, unknown>;
  const v = o.messageId ?? o.draftMessageId;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return undefined;
}

export function resolveEmailChannelAccountId(channel: string, payload: unknown): number | undefined {
  if (!channel.startsWith('email:')) return undefined;
  if (EMAIL_SKIP_ACCOUNT_SCOPE.has(channel)) return undefined;
  if (EMAIL_MULTI_ACCOUNT_CHANNELS.has(channel)) {
    const id = ipcPayloadAccountId(payload);
    if (id) return id;
    return undefined;
  }
  const fromPayload = ipcPayloadAccountId(payload);
  if (fromPayload) return fromPayload;
  const messageId = ipcPayloadMessageId(payload);
  if (messageId) {
    return getEmailMessageById(messageId)?.account_id;
  }
  return undefined;
}
