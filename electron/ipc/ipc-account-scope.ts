import { getEmailMessageById, getMessageAccountIds } from '../email/email-store';
import { getAttachmentById } from '../email/email-message-attachments-store';
import { getAiPromptById, getCannedResponseById, getInternalNoteMessageId } from '../email/email-crm-store';
import { getSpamListEntry } from '../email/email-spam-store';
import { getKnowledgeBaseById } from '../workflow/knowledge-base';
import { getWorkflowRunMessageId } from '../workflow/run-steps';

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
  'email:list-workflows',
  'email:list-canned',
  'email:list-ai-prompts',
  'email:list-spam-list-entries',
  'workflow:list-knowledge-bases',
]);

/** Global / admin — no accountScope from payload. */
export const EMAIL_SKIP_ACCOUNT_SCOPE = new Set<string>([
  'email:list-accounts',
  'email:create-account',
  'email:get-workflow',
  'email:create-workflow',
  'email:update-workflow',
  'email:delete-workflow',
  'email:compile-workflow-graph',
  'email:backfill-inbound-workflows',
  'email:fire-webhook-workflow',
  'email:list-categories',
  'email:list-team-members',
  'email:get-mail-diagnostics',
  'email:get-google-oauth-app',
  'email:get-microsoft-oauth-app',
  'email:build-microsoft-oauth-url',
  'email:pick-compose-attachments',
  'email:register-dropped-compose-attachments',
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

/**
 * Channels whose payload carries an id that names no mailbox object, with the
 * reason the IPC gate resolves no account for them. Every other email:/workflow:
 * channel with an id payload must resolve (see resolveEmailChannelAccountScope).
 */
export const EMAIL_GLOBAL_OBJECT_CHANNELS = new Map<string, string>([
  ['email:create-category', 'Categories are workspace-wide (no account_id); parentId names a category.'],
  ['email:update-category', 'Categories are workspace-wide (no account_id).'],
  ['email:delete-category', 'Categories are workspace-wide (no account_id).'],
  ['email:save-ai-profile', 'AI profiles are workspace-wide (no account_id).'],
  ['email:delete-ai-profile', 'AI profiles are workspace-wide (no account_id).'],
  ['email:set-ai-profile-api-key', 'AI profiles are workspace-wide (no account_id).'],
  ['email:clear-ai-profile-api-key', 'AI profiles are workspace-wide (no account_id).'],
  ['email:test-ai-profile', 'AI profiles are workspace-wide (no account_id).'],
  ['email:save-team-member', 'Team members are workspace-wide (no account_id).'],
  ['email:set-google-oauth-app', 'clientId is the workspace OAuth app, not a record; owner/admin only.'],
  ['email:set-microsoft-oauth-app', 'clientId is the workspace OAuth app, not a record; owner/admin only.'],
  [
    'email:ai-transform-text',
    'promptId is only looked up among global prompts (listAiPrompts without account); customerId is a CRM record.',
  ],
  [
    'email:list-thread-messages',
    'Aliases can join a thread across mailboxes; the handler filters the messages by the session (accountAccessSql).',
  ],
  [
    'workflow:list-runs',
    'Workflows are not account-gated here (like email:get-workflow); the list carries run status only, log and steps resolve the run message.',
  ],
  ['workflow:cancel-delayed-job', 'Local stub without effect; delayed jobs are server-only.'],
  ['workflow:export-bundle', 'Workflow definition; workflow channels are not account-gated (like email:get-workflow).'],
  ['workflow:export-bundle-to-file', 'Workflow definition; workflow channels are not account-gated (like email:get-workflow).'],
  ['workflow:list-versions', 'Workflow definition; workflow channels are not account-gated (like email:get-workflow).'],
  ['workflow:save-version', 'Workflow definition; workflow channels are not account-gated (like email:get-workflow).'],
  ['workflow:restore-version', 'Workflow definition; workflow channels are not account-gated (like email:get-workflow).'],
]);

/** IPC channels whose sole numeric payload is an account id (not message id). */
const EMAIL_BARE_ACCOUNT_ID_CHANNELS = new Set<string>([
  'email:delete-account',
  'email:sync-account',
  'email:clear-account-sync-lock',
  'email:test-vacation-auto-reply',
  'email:preview-restore-inbox-from-archive',
]);

/** IPC channels whose sole numeric payload is a message id. */
const EMAIL_BARE_MESSAGE_ID_CHANNELS = new Set<string>([
  'email:get-message',
  'email:list-message-tags',
  'email:get-message-category',
  'email:list-message-categories',
  'email:list-internal-notes',
  'email:get-reply-suggestion',
  'email:soft-delete-message',
  'email:restore-message',
  'email:list-message-attachments',
  'email:export-message-eml',
  'email:get-scheduled-send-draft-state',
  'email:retry-scheduled-send-draft',
  'email:clear-scheduled-send-draft-failure',
  'email:get-message-raw-headers',
  'email:get-message-security',
  'email:run-mail-security-check',
  'email:get-latest-workflow-run-for-message',
  'email:delete-compose-draft',
  'email:get-compose-draft-recovery-state',
]);

/** IPC channels whose payload `{ attachmentId }` names a stored message attachment. */
const EMAIL_ATTACHMENT_ID_CHANNELS = new Set<string>([
  'email:save-attachment-to-disk',
  'email:open-attachment-path',
]);

function accountIdFromObject(payload: unknown): number | undefined {
  if (payload == null || typeof payload !== 'object') return undefined;
  const o = payload as Record<string, unknown>;
  for (const key of ['accountId', 'accountScope'] as const) {
    const v = o[key];
    if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  }
  return undefined;
}

function messageIdFromObject(payload: unknown): number | undefined {
  if (payload == null || typeof payload !== 'object') return undefined;
  const o = payload as Record<string, unknown>;
  const v = o.messageId ?? o.draftMessageId;
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v;
  return undefined;
}

/** Mailboxes an IPC payload touches, as seen by the account gate in register.ts. */
export type EmailChannelAccountScope =
  /** Global channel, or the payload names no mailbox object. */
  | { kind: 'none' }
  /** Every listed account must pass the ACL before the handler runs. */
  | { kind: 'accounts'; accountIds: number[] }
  /** The payload names an object that maps to no mailbox (e.g. unknown id): owner/admin only. */
  | { kind: 'unresolved' };

const NO_ACCOUNT: EmailChannelAccountScope = { kind: 'none' };
const UNRESOLVED: EmailChannelAccountScope = { kind: 'unresolved' };

function forAccounts(accountIds: Iterable<number>): EmailChannelAccountScope {
  const ids = [...new Set(accountIds)];
  return ids.length > 0 ? { kind: 'accounts', accountIds: ids } : NO_ACCOUNT;
}

function positiveInt(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : undefined;
}

function field(payload: unknown, key: string): unknown {
  return payload != null && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;
}

function messageScope(messageId: unknown): EmailChannelAccountScope {
  const id = positiveInt(messageId);
  const accountId = id ? getEmailMessageById(id)?.account_id : undefined;
  return accountId != null ? forAccounts([accountId]) : UNRESOLVED;
}

/** Bulk `{ messageIds, accountId? }`: every message's account plus the filter; one unknown id fails closed. */
function messageListScope(payload: unknown): EmailChannelAccountScope {
  const raw = field(payload, 'messageIds');
  const ids = Array.isArray(raw) ? raw.map(positiveInt) : [];
  if (ids.some((id) => id === undefined)) return UNRESOLVED;
  const owners = getMessageAccountIds(ids as number[]);
  const accountIds: number[] = [];
  for (const id of ids as number[]) {
    const accountId = owners.get(id);
    if (accountId == null) return UNRESOLVED;
    accountIds.push(accountId);
  }
  const filter = positiveInt(field(payload, 'accountId'));
  return forAccounts(filter ? [...accountIds, filter] : accountIds);
}

type AccountBoundRow = { account_id: number | null } | undefined;

/** An existing row that is either global (account_id NULL) or bound to one mailbox. */
function rowScope(rowId: unknown, lookup: (id: number) => AccountBoundRow): EmailChannelAccountScope {
  const id = positiveInt(rowId);
  const row = id ? lookup(id) : undefined;
  if (!row) return UNRESOLVED;
  return row.account_id != null ? forAccounts([row.account_id]) : NO_ACCOUNT;
}

/**
 * Save `{ id?, accountId? }` on an account-override row: the target account must
 * not replace the owner, so both the existing row's account and the target count.
 */
function savedRowScope(payload: unknown, lookup: (id: number) => AccountBoundRow): EmailChannelAccountScope {
  const target = positiveInt(field(payload, 'accountId'));
  const targets = target ? [target] : [];
  if (field(payload, 'id') === undefined) return forAccounts(targets);
  const existing = rowScope(field(payload, 'id'), lookup);
  if (existing.kind === 'unresolved') return existing;
  return forAccounts([...(existing.kind === 'accounts' ? existing.accountIds : []), ...targets]);
}

function internalNoteScope(noteId: unknown): EmailChannelAccountScope {
  const id = positiveInt(noteId);
  const messageId = id ? getInternalNoteMessageId(id) : undefined;
  return messageId ? messageScope(messageId) : UNRESOLVED;
}

/** Runs without a message (cron, webhook) belong to the workflow, not to a mailbox. */
function workflowRunScope(runId: unknown): EmailChannelAccountScope {
  const id = positiveInt(runId);
  const run = id ? getWorkflowRunMessageId(id) : undefined;
  if (!run) return UNRESOLVED;
  return run.message_id == null ? NO_ACCOUNT : messageScope(run.message_id);
}

/** Notice ids are `${accountId}:${timestamp}` (email-uidvalidity-reset.ts). */
function uidValidityNoticeScope(payload: unknown): EmailChannelAccountScope {
  const match = /^(\d+):/.exec(String(field(payload, 'noticeId') ?? ''));
  const accountId = match ? positiveInt(Number(match[1])) : undefined;
  return accountId ? forAccounts([accountId]) : UNRESOLVED;
}

/** Channels whose payload names an object other than a plain account or message id. */
const EMAIL_OBJECT_SCOPE_RESOLVERS: Record<string, (payload: unknown) => EmailChannelAccountScope> = {
  'email:bulk-soft-delete-messages': messageListScope,
  'email:bulk-set-messages-archived': messageListScope,
  'email:bulk-set-message-spam': messageListScope,
  'email:bulk-set-message-spam-status': messageListScope,
  'email:bulk-set-message-done': messageListScope,
  'email:bulk-delete-compose-drafts': messageListScope,
  'email:update-internal-note': (p) => internalNoteScope(field(p, 'noteId')),
  'email:delete-internal-note': internalNoteScope,
  'email:save-canned': (p) => savedRowScope(p, getCannedResponseById),
  'email:delete-canned': (p) => rowScope(p, getCannedResponseById),
  'email:save-ai-prompt': (p) => savedRowScope(p, getAiPromptById),
  'email:delete-ai-prompt': (p) => rowScope(p, getAiPromptById),
  'email:reorder-ai-prompt': (p) => rowScope(field(p, 'id'), getAiPromptById),
  'email:save-spam-list-entry': (p) => savedRowScope(p, getSpamListEntry),
  'email:delete-spam-list-entry': (p) => rowScope(p, getSpamListEntry),
  'email:dismiss-uidvalidity-notice': uidValidityNoticeScope,
  'workflow:approve-draft-send': (p) => messageScope(field(p, 'draftId')),
  'workflow:dismiss-draft-approval': (p) => messageScope(field(p, 'draftId')),
  'workflow:update-knowledge-base': (p) => savedRowScope(p, getKnowledgeBaseById),
  'workflow:delete-knowledge-base': (p) => rowScope(p, getKnowledgeBaseById),
  'workflow:add-knowledge-chunk': (p) => rowScope(field(p, 'knowledgeBaseId'), getKnowledgeBaseById),
  'workflow:get-knowledge-base-document': (p) => rowScope(p, getKnowledgeBaseById),
  'workflow:save-knowledge-base-document': (p) => rowScope(field(p, 'knowledgeBaseId'), getKnowledgeBaseById),
  'workflow:export-knowledge-base-document': (p) => rowScope(p, getKnowledgeBaseById),
  'workflow:import-knowledge-file': (p) => rowScope(field(p, 'knowledgeBaseId'), getKnowledgeBaseById),
  'workflow:get-run-log': workflowRunScope,
  'workflow:list-run-steps': workflowRunScope,
};

/** Object keys that name a record (`id`, `messageId`, `messageIds`, ...). */
const ID_KEY = /^(id|.+Id|.+Ids)$/;

function namesObject(payload: unknown): boolean {
  if (payload == null || typeof payload !== 'object' || Array.isArray(payload)) return false;
  return Object.entries(payload).some(
    ([key, v]) => ID_KEY.test(key) && v != null && v !== '' && !(Array.isArray(v) && v.length === 0),
  );
}

export function resolveEmailChannelAccountScope(channel: string, payload: unknown): EmailChannelAccountScope {
  if (!channel.startsWith('email:') && !channel.startsWith('workflow:')) return NO_ACCOUNT;
  if (EMAIL_SKIP_ACCOUNT_SCOPE.has(channel) || EMAIL_GLOBAL_OBJECT_CHANNELS.has(channel)) return NO_ACCOUNT;

  const resolveObject = EMAIL_OBJECT_SCOPE_RESOLVERS[channel];
  if (resolveObject) return resolveObject(payload);

  if (typeof payload === 'number' && Number.isInteger(payload) && payload > 0) {
    if (EMAIL_BARE_ACCOUNT_ID_CHANNELS.has(channel)) return forAccounts([payload]);
    if (EMAIL_BARE_MESSAGE_ID_CHANNELS.has(channel)) return messageScope(payload);
    if (EMAIL_MULTI_ACCOUNT_CHANNELS.has(channel)) return forAccounts([payload]);
    // A bare number on an unlisted channel could name anything: fail closed.
    return UNRESOLVED;
  }

  if (EMAIL_MULTI_ACCOUNT_CHANNELS.has(channel)) {
    const accountId = accountIdFromObject(payload);
    return accountId ? forAccounts([accountId]) : NO_ACCOUNT;
  }

  if (EMAIL_ATTACHMENT_ID_CHANNELS.has(channel)) {
    const attachmentId = positiveInt(field(payload, 'attachmentId'));
    const messageId = attachmentId ? getAttachmentById(attachmentId)?.message_id : undefined;
    return messageId ? messageScope(messageId) : UNRESOLVED;
  }

  // The draft is named by messageId; an optional accountId is the move target,
  // which the handler checks separately. Gate on the draft's current account.
  if (channel === 'email:update-compose-draft') {
    return messageScope(messageIdFromObject(payload));
  }

  if (channel === 'email:update-account' || channel === 'email:delete-account') {
    const id = positiveInt(field(payload, 'id'));
    if (id) return forAccounts([id]);
  }

  const fromAccount = accountIdFromObject(payload);
  if (fromAccount) return forAccounts([fromAccount]);

  const messageId = messageIdFromObject(payload);
  if (messageId) return messageScope(messageId);

  return namesObject(payload) ? UNRESOLVED : NO_ACCOUNT;
}

/** First account of {@link resolveEmailChannelAccountScope}; the IPC gate checks all of them. */
export function resolveEmailChannelAccountId(channel: string, payload: unknown): number | undefined {
  const scope = resolveEmailChannelAccountScope(channel, payload);
  return scope.kind === 'accounts' ? scope.accountIds[0] : undefined;
}
