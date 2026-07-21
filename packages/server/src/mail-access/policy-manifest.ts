import type { MailPermission } from '@simplecrm/core';
import { SERVER_MAIL_ROUTE_INVENTORY } from '../api/server-api';
import { SERVER_EVENT_TYPES } from '../api/types';
import type {
  CanonicalApiRoute,
  HttpMethod,
  ServerEventType,
} from '../api/types';

export type PolicyValueSource = 'path' | 'query' | 'body' | 'event' | 'event_payload' | 'job';

export type PolicyValueSelector = Readonly<{
  source: PolicyValueSource;
  field: string;
}>;

export type MailResourceResolution =
  | Readonly<{ kind: 'mail_scope' }>
  | Readonly<{ kind: 'account'; accountId: PolicyValueSelector }>
  // Like 'account', but ALSO authorizes a delegate who reaches the account only through a
  // child (folder/message) grant — matching the read port's parent-aware account visibility
  // (parentAwareAccountVisibility), which shows such a delegate a redacted parent account so
  // the mailbox tree can render it. Used for email_account.updated so a folder/message
  // delegate's tree refreshes the account's visible identity fields (displayName/email). The
  // sanitized payload (accountId + state) is already enumerable by any delegate that renders
  // the parent, so widening delivery this way leaks nothing.
  | Readonly<{ kind: 'account_parent_aware'; accountId: PolicyValueSelector }>
  | Readonly<{
    kind: 'optional_account';
    accountId: PolicyValueSelector;
    // workspace_global → the nonempty-scope gate; owner_admin → owner/admin only
    // (used for accountless deletion tombstones that have no account to resolve).
    whenAbsent: 'workspace_global' | 'owner_admin';
    // How to authorize a PRESENT accountId. Default 'account' → a plain account resource
    // (owner/admin or a direct account grant). 'account_parent_aware' ALSO admits a
    // folder/message delegate who reaches the account only through a child grant, matching
    // the read port's parent-aware visibility — used where the row is legitimately visible
    // to such a delegate (e.g. account-scoped canned responses read via the parent).
    whenPresent?: 'account' | 'account_parent_aware';
  }>
  | Readonly<{ kind: 'folder_lookup'; folderId: PolicyValueSelector }>
  | Readonly<{ kind: 'message_lookup'; messageId: PolicyValueSelector }>
  | Readonly<{
    kind: 'optional_message_lookup';
    messageId: PolicyValueSelector;
    whenAbsent: 'non_mail' | 'mail_scope' | 'deny';
    whenNull?: 'non_mail';
    // A message delete FK-nulls message_id (ON DELETE SET NULL) but leaves
    // message_source_sqlite_id intact — the job/event is still MAIL (orphaned), not
    // non-mail. When set, the whenNull:'non_mail' branch consults this selector and
    // fails closed (owner/admin only) if it is non-null, so an orphaned mail job's
    // workflow/message metadata is never broadcast to every workspace user. Mirrors
    // classifyWorkflowDelayedJob's "non_mail only when BOTH refs are null" rule.
    messageSourceSqliteId?: PolicyValueSelector;
  }>
  | Readonly<{
    kind: 'workflow_execute_message_lookup';
    messageId: Readonly<{ source: 'job'; field: 'messageId' }>;
    delayedJobId: Readonly<{ source: 'job'; field: 'delayedJobId' }>;
  }>
  | Readonly<{
    kind: 'message_or_account_lookup';
    messageId: PolicyValueSelector;
    accountId: PolicyValueSelector;
    whenAbsent: 'mail_scope' | 'deny';
  }>
  | Readonly<{
    kind: 'event_message_then_account_lookup';
    messageId: Readonly<{ source: 'event_payload'; field: 'messageId' }>;
    accountId: Readonly<{ source: 'event_payload'; field: 'accountId' }>;
    whenAbsent: 'deny';
  }>
  | Readonly<{ kind: 'attachment_lookup'; attachmentId: PolicyValueSelector }>
  | Readonly<{ kind: 'thread_lookup'; threadId: PolicyValueSelector }>
  | Readonly<{ kind: 'bulk_message_lookup'; messageIds: PolicyValueSelector }>
  | Readonly<{
    kind: 'metadata_lookup';
    entity: 'message_tag'
      | 'message_category'
      | 'internal_note'
      | 'read_receipt'
      | 'thread_edge'
      | 'thread_alias'
      | 'account_signature'
      | 'spam_decision'
      | 'spam_learning_event';
    id: PolicyValueSelector;
  }>
  // Resolve a canned-response row by id to its account. Unlike metadata_lookup,
  // a canned response may be GLOBAL (account_id null); a global/missing row
  // resolves to the workspace-global scope gate (owner/admin for restricted
  // writes) rather than denying, so global rows stay manageable.
  | Readonly<{ kind: 'canned_response_lookup'; id: PolicyValueSelector }>
  | Readonly<{ kind: 'notice_lookup'; notice: 'uid_validity' | 'imap_auth' }>
  | Readonly<{ kind: 'workspace_global' }>
  // Event-only: the underlying entity no longer exists (e.g. account deletion),
  // so there is nothing to authorize against — deliver to owners/admins only.
  | Readonly<{ kind: 'owner_admin_only' }>
  // Event-only: deliver to owners/admins OR the user the event belongs to (from a
  // payload user id). Used for per-user PGP identity events, whose HTTP list route
  // admits the owning delegate and returns only their own identities.
  | Readonly<{ kind: 'owner_admin_or_event_user'; userId: PolicyValueSelector }>
  // Event-only: authorize BOTH messages named in a deletion tombstone (e.g. a
  // thread edge's parent + child) so neither id leaks to a partial-access viewer.
  | Readonly<{ kind: 'event_message_pair'; firstMessageId: PolicyValueSelector; secondMessageId: PolicyValueSelector }>
  // Event-only: a DELETED thread-alias tombstone. The alias row is gone, so authorize
  // against BOTH threads named in the payload (mode 'all'), falling back to the payload
  // account only for an empty thread — the same two-sided rule the live create/update
  // events use — so a delegate who could see both threads still gets the refresh. (R47-4)
  | Readonly<{
    kind: 'event_thread_alias_tombstone';
    aliasThreadId: PolicyValueSelector;
    canonicalThreadId: PolicyValueSelector;
    accountId: PolicyValueSelector;
  }>;

export type MailRouteExemptionReason =
  | 'signed_public_tracking'
  | 'mail_auth_setup'
  | 'workspace_admin_security';

export type MailRoutePermissionPolicy = Readonly<{
  kind: 'permission';
  permission: MailPermission;
  resource: MailResourceResolution;
}>;

export type MailRouteExemptPolicy = Readonly<{
  kind: 'exempt';
  reason: MailRouteExemptionReason;
}>;

export type MailRoutePolicyEntry =
  | Readonly<{ route: CanonicalApiRoute; policy: MailRoutePermissionPolicy }>
  | Readonly<{ route: CanonicalApiRoute; policy: MailRouteExemptPolicy }>;

export type MailEventPolicyEntry = Readonly<{
  type: ServerEventType;
  permission: Extract<MailPermission, 'mail.metadata.read' | 'mail.content.read' | 'mail.attachment.read' | 'mail.comment' | 'mail.draft.create'>;
  resource: MailResourceResolution;
}>;

const pathValue = (field: string): PolicyValueSelector => ({ source: 'path', field });
const bodyValue = (field: string): PolicyValueSelector => ({ source: 'body', field });
const queryValue = (field: string): PolicyValueSelector => ({ source: 'query', field });
const eventValue = (field: string): PolicyValueSelector => ({ source: 'event', field });
const eventPayloadValue = (field: string): PolicyValueSelector => ({ source: 'event_payload', field });
const spamEventResource = (): MailResourceResolution => ({
  kind: 'event_message_then_account_lookup',
  messageId: { source: 'event_payload', field: 'messageId' },
  accountId: { source: 'event_payload', field: 'accountId' },
  whenAbsent: 'deny',
});

const mailScope = (): MailResourceResolution => ({ kind: 'mail_scope' });
const accountPath = (): MailResourceResolution => ({ kind: 'account', accountId: pathValue('accountId') });
const accountBody = (): MailResourceResolution => ({ kind: 'account', accountId: bodyValue('accountId') });
const accountQuery = (): MailResourceResolution => ({ kind: 'account', accountId: queryValue('accountId') });
const optionalAccount = (source: 'query' | 'body'): MailResourceResolution => ({
  kind: 'optional_account',
  accountId: source === 'query' ? queryValue('accountId') : bodyValue('accountId'),
  whenAbsent: 'workspace_global',
});
const folderPath = (): MailResourceResolution => ({ kind: 'folder_lookup', folderId: pathValue('id') });
const messagePath = (): MailResourceResolution => ({ kind: 'message_lookup', messageId: pathValue('messageId') });
const messageBody = (field = 'messageId'): MailResourceResolution => ({
  kind: 'message_lookup',
  messageId: bodyValue(field),
});
// Spam learning-events / decisions allow messageId to be absent/null (account-only
// records) while requiring accountId. Authorize the message when present, else the
// account — otherwise the enforcer resolves a missing message and 404s every
// account-only write before the owner/admin ACL bypass can run.
const messageOrAccountBody = (): MailResourceResolution => ({
  kind: 'message_or_account_lookup',
  messageId: bodyValue('messageId'),
  accountId: bodyValue('accountId'),
  whenAbsent: 'deny',
});
const optionalMessageBody = (
  field = 'messageId',
  options: { allowNull?: boolean } = {},
): MailResourceResolution => ({
  kind: 'optional_message_lookup',
  messageId: bodyValue(field),
  whenAbsent: 'non_mail',
  ...(options.allowNull ? { whenNull: 'non_mail' as const } : {}),
});
const attachmentPath = (): MailResourceResolution => ({
  kind: 'attachment_lookup',
  attachmentId: pathValue('attachmentId'),
});
const threadPath = (field = 'threadId'): MailResourceResolution => ({
  kind: 'thread_lookup',
  threadId: pathValue(field),
});
const bulkMessages = (source: 'body' | 'query', field: string): MailResourceResolution => ({
  kind: 'bulk_message_lookup',
  messageIds: { source, field },
});
const metadataPath = (
  entity: Extract<MailResourceResolution, { kind: 'metadata_lookup' }>['entity'],
): MailResourceResolution => ({ kind: 'metadata_lookup', entity, id: pathValue('id') });
const cannedResponsePath = (): MailResourceResolution => ({
  kind: 'canned_response_lookup',
  id: pathValue('id'),
});

const permissionPolicy = (
  permission: MailPermission,
  resource: MailResourceResolution,
): MailRoutePermissionPolicy => ({ kind: 'permission', permission, resource });
const exemptPolicy = (reason: MailRouteExemptionReason): MailRouteExemptPolicy => ({ kind: 'exempt', reason });

export const MAIL_ROUTE_POLICY_MANIFEST: readonly MailRoutePolicyEntry[] = Object.freeze(
  buildMailRoutePolicyManifest(),
);
export const MAIL_EVENT_POLICY_MANIFEST: readonly MailEventPolicyEntry[] = Object.freeze(
  buildMailEventPolicyManifest(),
);

function buildMailRoutePolicyManifest(): MailRoutePolicyEntry[] {
  const routeByKey = new Map(SERVER_MAIL_ROUTE_INVENTORY.map((route) => [mailRoutePolicyKey(route), route]));
  const policies = new Map<string, MailRoutePermissionPolicy | MailRouteExemptPolicy>();
  const assign = (
    path: string,
    byMethod: Partial<Record<HttpMethod, MailRoutePermissionPolicy | MailRouteExemptPolicy>>,
  ): void => {
    for (const [method, policy] of Object.entries(byMethod) as Array<[
      HttpMethod,
      MailRoutePermissionPolicy | MailRouteExemptPolicy,
    ]>) {
      const key = `${method} ${path}`;
      if (!routeByKey.has(key)) throw new Error(`mail policy references unregistered route: ${key}`);
      if (policies.has(key)) throw new Error(`duplicate mail route policy: ${key}`);
      policies.set(key, policy);
    }
  };

  const publicTracking = exemptPolicy('signed_public_tracking');
  assign('/t/o/:token.gif', { GET: publicTracking });
  assign('/t/c/:token', { GET: publicTracking });

  const authSetup = exemptPolicy('mail_auth_setup');
  // authorize-url returns only a redirect URL (no secret) and the connection
  // tests run before any account exists, so these stay open to an authenticated
  // principal. finish writes a refresh token to an account, so its handler
  // enforces requireAdmin (OAuth account setup is an admin operation, matching
  // the admin-only app credentials below); it stays exempt so it works before a
  // mail grant exists.
  assign('/api/v1/email/oauth/:provider/authorize-url', { POST: authSetup });
  assign('/api/v1/email/oauth/:provider/finish', { POST: authSetup });
  assign('/api/v1/email/accounts/test-imap', { POST: authSetup });
  assign('/api/v1/email/accounts/test-pop3', { POST: authSetup });
  assign('/api/v1/email/accounts/test-smtp', { POST: authSetup });

  const workspaceSecurity = exemptPolicy('workspace_admin_security');
  // Reading (plaintext client secret) or writing the workspace-wide OAuth
  // application credentials is admin-only; handleEmailOAuthApp enforces
  // requireAdmin. Exempt from the mail ACL so it works before any mail grant.
  assign('/api/v1/email/oauth/:provider/app', { GET: workspaceSecurity, PATCH: workspaceSecurity });
  assign('/api/v1/email/tracking/settings', {
    GET: permissionPolicy('mail.metadata.read', { kind: 'workspace_global' }),
    PATCH: workspaceSecurity,
  });
  assign('/api/v1/email/messages/:messageId/tracking', { DELETE: workspaceSecurity });
  assign('/api/v1/email/messages/:messageId/tracking/revoke', { POST: workspaceSecurity });
  assign('/api/v1/email/messages/:messageId/tracking/reclassify', { POST: workspaceSecurity });
  assign('/api/v1/email/messages/:messageId/tracking/events/:eventId/ip-insight', { GET: workspaceSecurity });

  assign('/api/v1/email/relays', { GET: workspaceSecurity, POST: workspaceSecurity });
  assign('/api/v1/email/relays/:relayId', { PATCH: workspaceSecurity, DELETE: workspaceSecurity });
  assign('/api/v1/email/relays/:relayId/accounts', { POST: workspaceSecurity });
  assign('/api/v1/email/relays/:relayId/accounts/:accountId', { DELETE: workspaceSecurity });
  assign('/api/v1/email/relays/:relayId/credentials', { POST: workspaceSecurity });
  assign('/api/v1/email/relays/:relayId/credentials/:credentialId/revoke', { POST: workspaceSecurity });
  assign('/api/v1/email/relays/:relayId/submissions', { GET: workspaceSecurity });

  assign('/api/v1/email/settings/misc', {
    GET: permissionPolicy('mail.metadata.read', { kind: 'workspace_global' }),
    PATCH: permissionPolicy('mail.account.manage', { kind: 'workspace_global' }),
  });
  assign('/api/v1/email/settings/security', { GET: workspaceSecurity, PATCH: workspaceSecurity });
  assign('/api/v1/email/settings/security/test-rspamd', { POST: workspaceSecurity });
  assign('/api/v1/email/settings/account-mail', {
    GET: permissionPolicy('mail.metadata.read', accountQuery()),
    PATCH: permissionPolicy('mail.account.manage', accountBody()),
  });
  assign('/api/v1/email/settings/snooze', {
    GET: permissionPolicy('mail.metadata.read', { kind: 'workspace_global' }),
    PATCH: permissionPolicy('mail.triage', { kind: 'workspace_global' }),
  });
  assign('/api/v1/email/settings/reply-suggestion', {
    GET: permissionPolicy('mail.metadata.read', optionalAccount('query')),
    PATCH: permissionPolicy('mail.account.manage', optionalAccount('body')),
  });

  assign('/api/v1/email/accounts', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.account.manage', mailScope()),
  });
  assign('/api/v1/email/accounts/:accountId', {
    GET: permissionPolicy('mail.metadata.read', accountPath()),
    PATCH: permissionPolicy('mail.account.manage', accountPath()),
    DELETE: permissionPolicy('mail.account.manage', accountPath()),
  });
  assign('/api/v1/email/accounts/:accountId/sync', { POST: permissionPolicy('mail.account.manage', accountPath()) });
  assign('/api/v1/email/accounts/:accountId/sync-lock', { DELETE: permissionPolicy('mail.account.manage', accountPath()) });
  assign('/api/v1/email/accounts/:accountId/vacation-test', { POST: permissionPolicy('mail.send', accountPath()) });
  assign('/api/v1/email/accounts/:accountId/inbox-archive-recovery', {
    GET: permissionPolicy('mail.metadata.read', accountPath()),
    POST: permissionPolicy('mail.account.manage', accountPath()),
  });

  for (const path of [
    '/api/v1/email/folder-counts',
    '/api/v1/email/diagnostics',
    '/api/v1/email/reporting',
    '/api/v1/email/dmarc/stats',
    '/api/v1/email/messages',
    '/api/v1/email/messages/conversation',
  ]) {
    assign(path, { GET: permissionPolicy('mail.metadata.read', mailScope()) });
  }
  assign('/api/v1/email/gdpr-export', { GET: permissionPolicy('mail.export', mailScope()) });
  assign('/api/v1/email/threads/backfill', { POST: permissionPolicy('mail.account.manage', mailScope()) });
  assign('/api/v1/email/messages/backfill-customer-links', { POST: permissionPolicy('mail.triage', mailScope()) });

  assign('/api/v1/email/messages/bulk/soft-delete', { PATCH: permissionPolicy('mail.delete', bulkMessages('body', 'messageIds')) });
  assign('/api/v1/email/messages/bulk/archive', { PATCH: permissionPolicy('mail.triage', bulkMessages('body', 'messageIds')) });
  assign('/api/v1/email/messages/bulk/done', { PATCH: permissionPolicy('mail.triage', bulkMessages('body', 'messageIds')) });
  assign('/api/v1/email/messages/bulk/spam-status', { PATCH: permissionPolicy('mail.triage', bulkMessages('body', 'messageIds')) });
  assign('/api/v1/email/messages/bulk/local-drafts', { DELETE: permissionPolicy('mail.delete', bulkMessages('body', 'messageIds')) });

  assign('/api/v1/email/compose-drafts', { POST: permissionPolicy('mail.draft.create', accountBody()) });
  assign('/api/v1/email/compose/send', { POST: permissionPolicy('mail.send', messageBody('draftMessageId')) });
  assign('/api/v1/email/compose/validate-outbound', { POST: permissionPolicy('mail.draft.edit', messageBody()) });

  assign('/api/v1/email/messages/:messageId/compose-attachments', { POST: permissionPolicy('mail.draft.edit', messagePath()) });
  assign('/api/v1/email/messages/:messageId/compose-draft', { PATCH: permissionPolicy('mail.draft.edit', messagePath()) });
  assign('/api/v1/email/messages/:messageId/scheduled-send-state', { GET: permissionPolicy('mail.content.read', messagePath()) });
  assign('/api/v1/email/messages/:messageId/compose-draft-recovery-state', { GET: permissionPolicy('mail.content.read', messagePath()) });
  assign('/api/v1/email/messages/:messageId/scheduled-send-failure', { DELETE: permissionPolicy('mail.send', messagePath()) });
  assign('/api/v1/email/messages/:messageId/scheduled-send/retry', { PATCH: permissionPolicy('mail.send', messagePath()) });
  assign('/api/v1/email/messages/:messageId/post-process/retry', { POST: permissionPolicy('mail.triage', messagePath()) });
  assign('/api/v1/email/messages/:messageId/scheduled-send', { PATCH: permissionPolicy('mail.send', messagePath()) });
  assign('/api/v1/email/threads/:threadId/messages', { GET: permissionPolicy('mail.metadata.read', threadPath()) });

  for (const path of [
    '/api/v1/email/messages/:messageId/spam-decision',
    '/api/v1/email/messages/:messageId/security/check',
    '/api/v1/email/messages/:messageId/read-receipt-response',
    '/api/v1/email/messages/:messageId/remote-content-policy/consume',
    '/api/v1/email/messages/:messageId/actions',
  ]) {
    assign(path, { POST: permissionPolicy('mail.triage', messagePath()) });
  }
  for (const path of [
    '/api/v1/email/messages/:messageId/spam-status',
    '/api/v1/email/messages/:messageId/remote-content-policy',
    '/api/v1/email/messages/:messageId/snooze',
    '/api/v1/email/messages/:messageId/restore',
    '/api/v1/email/messages/:messageId/customer-link',
    '/api/v1/email/messages/:messageId/assignment',
    '/api/v1/email/messages/:messageId/archive',
    '/api/v1/email/messages/:messageId/seen',
    '/api/v1/email/messages/:messageId/done',
    '/api/v1/email/messages/:messageId/move',
  ]) {
    assign(path, { PATCH: permissionPolicy('mail.triage', messagePath()) });
  }
  assign('/api/v1/email/messages/:messageId/soft-delete', { PATCH: permissionPolicy('mail.delete', messagePath()) });
  assign('/api/v1/email/messages/:messageId/local-draft', { DELETE: permissionPolicy('mail.delete', messagePath()) });
  assign('/api/v1/email/messages/:messageId/security', { GET: permissionPolicy('mail.content.read', messagePath()) });
  assign('/api/v1/email/messages/:messageId/raw-headers', { GET: permissionPolicy('mail.content.read', messagePath()) });
  assign('/api/v1/email/messages/:messageId/read-receipt-state', { GET: permissionPolicy('mail.metadata.read', messagePath()) });
  assign('/api/v1/email/messages/:messageId/attachments', { GET: permissionPolicy('mail.attachment.read', messagePath()) });
  assign('/api/v1/email/messages/:messageId/reply-suggestion', { GET: permissionPolicy('mail.content.read', messagePath()) });
  // Queuing reply generation reads the body, calls the AI provider (incurring
  // usage) and persists suggestion state, so it needs mail.draft.create, not just
  // read access — otherwise a read-only viewer can force repeated generations.
  assign('/api/v1/email/messages/:messageId/reply-suggestion/ensure', { POST: permissionPolicy('mail.draft.create', messagePath()) });
  assign('/api/v1/email/messages/:messageId/reply-draft', { POST: permissionPolicy('mail.draft.create', messagePath()) });
  assign('/api/v1/email/messages/:messageId/tracking', { GET: permissionPolicy('mail.metadata.read', messagePath()) });
  assign('/api/v1/email/messages/:messageId', { GET: permissionPolicy('mail.content.read', messagePath()) });
  assign('/api/v1/email/attachments/:attachmentId', { GET: permissionPolicy('mail.attachment.read', attachmentPath()) });
  assign('/api/v1/email/attachments/:attachmentId/content', { GET: permissionPolicy('mail.attachment.read', attachmentPath()) });

  assignWorkflowMailPolicies(assign);

  assignMetadataPolicies(assign);
  assignSupplementalProtectedPolicies(assign);

  const missing = SERVER_MAIL_ROUTE_INVENTORY
    .map(mailRoutePolicyKey)
    .filter((key) => !policies.has(key));
  if (missing.length > 0) throw new Error(`unclassified canonical mail routes: ${missing.join(', ')}`);

  return SERVER_MAIL_ROUTE_INVENTORY.map((route) => {
    const policy = policies.get(mailRoutePolicyKey(route));
    if (!policy) throw new Error(`unclassified mail route: ${mailRoutePolicyKey(route)}`);
    return policy.kind === 'permission' ? { route, policy } : { route, policy };
  });
}

function assignWorkflowMailPolicies(assign: AssignRoutePolicy): void {
  assign('/api/v1/workflows/:id/execute', { POST: permissionPolicy('mail.content.read', optionalMessageBody()) });
  assign('/api/v1/workflows/by-source/:sourceId/execute', { POST: permissionPolicy('mail.content.read', optionalMessageBody()) });
  assign('/api/v1/email/messages/:messageId/workflow-runs', { GET: permissionPolicy('mail.content.read', messagePath()) });

  for (const path of [
    '/api/v1/workflows/:id/runs',
    '/api/v1/workflows/by-source/:sourceId/runs',
    '/api/v1/workflow-runs',
    '/api/v1/workflow-runs/:id',
    '/api/v1/workflow-runs/:id/steps',
    '/api/v1/workflow-runs/by-source/:sourceId',
    '/api/v1/workflow-runs/by-source/:sourceId/steps',
    '/api/v1/workflow-run-steps',
    '/api/v1/workflow-run-steps/:id',
    '/api/v1/workflow-message-applied',
    '/api/v1/workflow-message-applied/:id',
    '/api/v1/workflow-forward-dedup',
    '/api/v1/workflow-forward-dedup/:id',
  ]) {
    assign(path, { GET: permissionPolicy('mail.content.read', mailScope()) });
  }
  assign('/api/v1/workflow-delayed-jobs', {
    GET: permissionPolicy('mail.content.read', mailScope()),
    POST: permissionPolicy('mail.content.read', optionalMessageBody('messageId', { allowNull: true })),
  });
  assign('/api/v1/workflow-delayed-jobs/:id', {
    GET: permissionPolicy('mail.content.read', mailScope()),
    PATCH: permissionPolicy('mail.content.read', mailScope()),
    DELETE: permissionPolicy('mail.content.read', mailScope()),
  });
}

type AssignRoutePolicy = (
  path: string,
  byMethod: Partial<Record<HttpMethod, MailRoutePermissionPolicy | MailRouteExemptPolicy>>,
) => void;

function assignMetadataPolicies(assign: AssignRoutePolicy): void {
  assign('/api/v1/email/messages/:messageId/tags', {
    GET: permissionPolicy('mail.metadata.read', messagePath()),
    POST: permissionPolicy('mail.triage', messagePath()),
    DELETE: permissionPolicy('mail.triage', messagePath()),
  });
  assign('/api/v1/email/messages/:messageId/categories', {
    GET: permissionPolicy('mail.metadata.read', messagePath()),
    POST: permissionPolicy('mail.triage', messagePath()),
  });
  assign('/api/v1/email/messages/:messageId/internal-notes', {
    GET: permissionPolicy('mail.comment', messagePath()),
    POST: permissionPolicy('mail.comment', messagePath()),
  });

  assign('/api/v1/email/folders', { GET: permissionPolicy('mail.metadata.read', mailScope()) });
  assign('/api/v1/email/folders/:id', { GET: permissionPolicy('mail.metadata.read', folderPath()) });
  assign('/api/v1/email/tags', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    // The documented top-level tag POST requires a messageId in its body and shares
    // handleCreateEmailMessageTag with POST /messages/:messageId/tags. Authorize it
    // against that message (like the message-scoped route) instead of the workspace
    // scope, so an account/folder/message-scoped delegate can tag a message it can
    // reach — otherwise the restricted-scope write gate denies a tag the renderer
    // can add for the same message.
    POST: permissionPolicy('mail.triage', messageBody()),
  });
  assign('/api/v1/email/tags/:id', {
    GET: permissionPolicy('mail.metadata.read', metadataPath('message_tag')),
    DELETE: permissionPolicy('mail.triage', metadataPath('message_tag')),
  });
  assign('/api/v1/email/categories', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.triage', mailScope()),
  });
  assign('/api/v1/email/categories/:id', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    PATCH: permissionPolicy('mail.triage', mailScope()),
    DELETE: permissionPolicy('mail.triage', mailScope()),
  });
  assign('/api/v1/email/categories/reorder', { PATCH: permissionPolicy('mail.triage', mailScope()) });
  assign('/api/v1/email/category-counts', { GET: permissionPolicy('mail.metadata.read', mailScope()) });

  assign('/api/v1/email/message-categories', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.triage', messageBody()),
  });
  assign('/api/v1/email/message-categories/:id', {
    GET: permissionPolicy('mail.metadata.read', metadataPath('message_category')),
    DELETE: permissionPolicy('mail.triage', metadataPath('message_category')),
  });
  assign('/api/v1/email/internal-notes', {
    GET: permissionPolicy('mail.comment', mailScope()),
    POST: permissionPolicy('mail.comment', messageBody()),
  });
  assign('/api/v1/email/internal-notes/:id', {
    GET: permissionPolicy('mail.comment', metadataPath('internal_note')),
    PATCH: permissionPolicy('mail.comment', metadataPath('internal_note')),
    DELETE: permissionPolicy('mail.comment', metadataPath('internal_note')),
  });

  assign('/api/v1/email/canned-responses', {
    GET: permissionPolicy('mail.draft.create', mailScope()),
    // An account-scoped override carries accountId in the body; authorize it
    // against that account so a delegate with mail.draft.create on the account
    // can create it. Without accountId it is a workspace-global write, which the
    // restricted-scope gate still limits to owner/admin.
    POST: permissionPolicy('mail.draft.create', optionalAccount('body')),
  });
  assign('/api/v1/email/canned-responses/:id', {
    // Resolve the row to its account so an account-level delegate can fetch (GET),
    // autosave (PATCH), or reset (DELETE) an account-scoped override; an out-of-scope
    // account row is denied (no cross-account leak). Global rows resolve to the
    // workspace-global scope gate — admitted for reads (the item is in
    // EMPTY_SCOPE_READ_PATHS, matching the collection) but writes stay owner/admin.
    GET: permissionPolicy('mail.draft.create', cannedResponsePath()),
    PATCH: permissionPolicy('mail.draft.create', cannedResponsePath()),
    DELETE: permissionPolicy('mail.draft.create', cannedResponsePath()),
  });
  assign('/api/v1/email/account-signatures', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.account.manage', accountBody()),
  });
  assign('/api/v1/email/account-signatures/:id', {
    GET: permissionPolicy('mail.metadata.read', metadataPath('account_signature')),
    PATCH: permissionPolicy('mail.account.manage', metadataPath('account_signature')),
    DELETE: permissionPolicy('mail.account.manage', metadataPath('account_signature')),
  });
  assign('/api/v1/email/account-signatures/by-account/:accountId/upsert', {
    POST: permissionPolicy('mail.account.manage', accountPath()),
  });

  assign('/api/v1/email/remote-content-allowlist', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.account.manage', mailScope()),
  });
  assign('/api/v1/email/remote-content-allowlist/:id', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    PATCH: permissionPolicy('mail.account.manage', mailScope()),
    DELETE: permissionPolicy('mail.account.manage', mailScope()),
  });
  assign('/api/v1/email/read-receipts', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.triage', messageBody()),
  });
  assign('/api/v1/email/read-receipts/:id', { GET: permissionPolicy('mail.metadata.read', metadataPath('read_receipt')) });

  assign('/api/v1/email/team-members', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.account.manage', mailScope()),
  });
  assign('/api/v1/email/team-members/:id', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    PATCH: permissionPolicy('mail.account.manage', mailScope()),
    DELETE: permissionPolicy('mail.account.manage', mailScope()),
  });
  assign('/api/v1/email/team-members/:teamMemberId/upsert', { POST: permissionPolicy('mail.account.manage', mailScope()) });

  assign('/api/v1/email/thread-edges', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.triage', messageBody('parentMessageId')),
  });
  assign('/api/v1/email/thread-edges/:id', {
    GET: permissionPolicy('mail.metadata.read', metadataPath('thread_edge')),
    DELETE: permissionPolicy('mail.triage', metadataPath('thread_edge')),
  });
  assign('/api/v1/email/thread-aliases', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    // accountId is optional (an accountless alias is stored workspace-global with
    // account_id null), so resolve it optionally — requiring it would 404 a
    // supported accountless creation even for an owner/admin. The supplemental
    // below still authorizes mail.triage on every message in both threads.
    POST: permissionPolicy('mail.triage', optionalAccount('body')),
  });
  assign('/api/v1/email/thread-aliases/:id', {
    GET: permissionPolicy('mail.metadata.read', metadataPath('thread_alias')),
    PATCH: permissionPolicy('mail.triage', metadataPath('thread_alias')),
    DELETE: permissionPolicy('mail.triage', metadataPath('thread_alias')),
  });
  assign('/api/v1/email/threads', { GET: permissionPolicy('mail.metadata.read', mailScope()) });
  assign('/api/v1/email/threads/:id', { GET: permissionPolicy('mail.metadata.read', threadPath('id')) });
  assign('/api/v1/email/threads/split-message', { POST: permissionPolicy('mail.triage', messageBody()) });
  // accountId is optional on merge too (accountless merges are workspace-global);
  // resolve it optionally so an owner/admin merge without an account still passes.
  // The supplemental authorizes both merged threads regardless.
  assign('/api/v1/email/threads/merge', { POST: permissionPolicy('mail.triage', optionalAccount('body')) });
  assign('/api/v1/email/thread-alias-warnings', { GET: permissionPolicy('mail.metadata.read', mailScope()) });
}

function assignSupplementalProtectedPolicies(assign: AssignRoutePolicy): void {
  assign('/api/v1/email/user-signatures', { GET: permissionPolicy('mail.draft.create', mailScope()) });
  assign('/api/v1/email/user-signatures/by-account/:accountId/upsert', {
    POST: permissionPolicy('mail.draft.create', accountPath()),
  });
  assign('/api/v1/email/notices/uid-validity', {
    GET: permissionPolicy('mail.metadata.read', { kind: 'notice_lookup', notice: 'uid_validity' }),
    // Dismissing a UID-validity (mailbox reset / data-recovery) warning hides it
    // workspace-wide. It is keyed by noticeId (no account handle), so gate the
    // dismissal on account management — via scope this admits owners/admins only,
    // matching the imap-auth dismissal hardening.
    DELETE: permissionPolicy('mail.account.manage', { kind: 'notice_lookup', notice: 'uid_validity' }),
  });
  assign('/api/v1/email/notices/imap-auth', {
    GET: permissionPolicy('mail.metadata.read', { kind: 'notice_lookup', notice: 'imap_auth' }),
    // Dismissing an auth-failure notice hides it workspace-wide from admins and
    // every client, so it is a management action, not a metadata read.
    DELETE: permissionPolicy('mail.account.manage', { kind: 'account', accountId: queryValue('accountId') }),
  });

  assign('/api/v1/locks', { GET: permissionPolicy('mail.metadata.read', bulkMessages('query', 'messageIds')) });
  assign('/api/v1/locks/:messageId', {
    GET: permissionPolicy('mail.metadata.read', messagePath()),
    POST: permissionPolicy('mail.draft.edit', messagePath()),
    DELETE: permissionPolicy('mail.draft.edit', messagePath()),
  });
  assign('/api/v1/locks/:messageId/heartbeat', { PATCH: permissionPolicy('mail.draft.edit', messagePath()) });
  assign('/api/v1/locks/:messageId/takeover', { POST: permissionPolicy('mail.draft.edit', messagePath()) });

  assign('/api/v1/pgp/attachments/:attachmentId/decrypt', { POST: permissionPolicy('mail.attachment.read', attachmentPath()) });
  assign('/api/v1/pgp/attachments/:attachmentId/verify', { POST: permissionPolicy('mail.attachment.read', attachmentPath()) });
  assign('/api/v1/pgp/messages/:messageId/decrypt', { POST: permissionPolicy('mail.content.read', messagePath()) });
  // Detection persists the shared pgp_status / signer fingerprint on the message
  // (updateMessagePgpDetectionStatus), so it is a triage-level mutation, not a
  // read — otherwise a content-only viewer could downgrade the verification state
  // shown to everyone.
  assign('/api/v1/pgp/messages/:messageId/detect', { POST: permissionPolicy('mail.triage', messagePath()) });
  // Verification persists the shared pgp_status / signer fingerprint on the message
  // (updateMessagePgpSignatureStatus), exactly like detect above — a triage-level
  // mutation, not a read. Otherwise a content-only viewer could overwrite the
  // verification state shown to everyone (e.g. downgrade a valid signature to
  // key_missing after peer keys change).
  assign('/api/v1/pgp/messages/:messageId/verify', { POST: permissionPolicy('mail.triage', messagePath()) });

  assign('/api/v1/pgp/identities/generate', { POST: permissionPolicy('mail.account.manage', mailScope()) });
  assign('/api/v1/pgp/peer-keys/import', { POST: permissionPolicy('mail.account.manage', mailScope()) });
  assign('/api/v1/pgp/recipient-key-status', { GET: permissionPolicy('mail.send', mailScope()) });
  assign('/api/v1/pgp/messages/encrypt', { POST: permissionPolicy('mail.send', mailScope()) });
  assign('/api/v1/pgp/messages/sign', { POST: permissionPolicy('mail.send', mailScope()) });
  assign('/api/v1/pgp/identities/by-source/:sourceId/private-key/passphrase', {
    POST: permissionPolicy('mail.account.manage', mailScope()),
  });
  assign('/api/v1/pgp/identities/:identityId/private-key/passphrase', {
    POST: permissionPolicy('mail.account.manage', mailScope()),
  });
  for (const path of [
    '/api/v1/pgp/identities/by-source/:sourceId',
    '/api/v1/pgp/peer-keys/by-source/:sourceId',
    '/api/v1/pgp/identities/:id',
    '/api/v1/pgp/peer-keys/:id',
  ]) {
    assign(path, {
      GET: permissionPolicy('mail.metadata.read', mailScope()),
      PATCH: permissionPolicy('mail.account.manage', mailScope()),
      DELETE: permissionPolicy('mail.account.manage', mailScope()),
    });
  }
  assign('/api/v1/pgp/identities', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.account.manage', mailScope()),
  });
  assign('/api/v1/pgp/peer-keys', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.account.manage', mailScope()),
  });

  assign('/api/v1/spam/list-entries/upsert', { POST: permissionPolicy('mail.triage', mailScope()) });
  assign('/api/v1/spam/list-entries', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.triage', mailScope()),
  });
  assign('/api/v1/spam/list-entries/:id', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    PATCH: permissionPolicy('mail.triage', mailScope()),
    DELETE: permissionPolicy('mail.triage', mailScope()),
  });
  assign('/api/v1/spam/feature-stats', { GET: permissionPolicy('mail.metadata.read', mailScope()) });
  assign('/api/v1/spam/feature-stats/:id', { GET: permissionPolicy('mail.metadata.read', mailScope()) });

  assign('/api/v1/spam/learning-events', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.triage', messageOrAccountBody()),
  });
  assign('/api/v1/spam/learning-events/:id', {
    GET: permissionPolicy('mail.metadata.read', metadataPath('spam_learning_event')),
  });
  assign('/api/v1/spam/decisions', {
    GET: permissionPolicy('mail.metadata.read', mailScope()),
    POST: permissionPolicy('mail.triage', messageOrAccountBody()),
  });
  assign('/api/v1/spam/decisions/:id', {
    GET: permissionPolicy('mail.metadata.read', metadataPath('spam_decision')),
    PATCH: permissionPolicy('mail.triage', metadataPath('spam_decision')),
    DELETE: permissionPolicy('mail.triage', metadataPath('spam_decision')),
  });
}

function buildMailEventPolicyManifest(): MailEventPolicyEntry[] {
  const mailEventTypes = SERVER_EVENT_TYPES.filter((type) => (
    type !== 'email_acl.changed'
    && (type.startsWith('email_')
    || type.startsWith('conversation_lock.')
    || type.startsWith('spam_')
    || type.startsWith('pgp_'))
  ));
  const mailEventPolicies: MailEventPolicyEntry[] = mailEventTypes.map((type) => ({
    type,
    // Internal-note events carry note existence + message/note id + state; the
    // HTTP note routes gate that behind the independent mail.comment permission,
    // so the event stream must too — otherwise a viewer denied comments still
    // learns of every note over the stream. Canned-response events likewise match
    // their read route (mail.draft.create) so an account-level draft delegate that
    // lacks mail.metadata.read still receives compose-template refreshes.
    permission: type.startsWith('email_internal_note.')
      ? 'mail.comment'
      : type.startsWith('email_canned_response.')
        ? 'mail.draft.create'
        : 'mail.metadata.read',
    resource: eventResourceResolution(type),
  }));
  const workflowDelayedJobPolicies: MailEventPolicyEntry[] = [
    {
      type: 'workflow_delayed_job.created',
      permission: 'mail.content.read',
      resource: {
        kind: 'optional_message_lookup',
        messageId: eventPayloadValue('messageId'),
        messageSourceSqliteId: eventPayloadValue('messageSourceSqliteId'),
        whenAbsent: 'deny',
        whenNull: 'non_mail',
      },
    },
    {
      type: 'workflow_delayed_job.updated',
      permission: 'mail.content.read',
      resource: {
        kind: 'optional_message_lookup',
        messageId: eventPayloadValue('messageId'),
        messageSourceSqliteId: eventPayloadValue('messageSourceSqliteId'),
        whenAbsent: 'deny',
        whenNull: 'non_mail',
      },
    },
    {
      type: 'workflow_delayed_job.deleted',
      permission: 'mail.content.read',
      resource: {
        kind: 'optional_message_lookup',
        messageId: eventPayloadValue('messageId'),
        messageSourceSqliteId: eventPayloadValue('messageSourceSqliteId'),
        whenAbsent: 'deny',
        whenNull: 'non_mail',
      },
    },
  ];
  return mailEventPolicies.concat(workflowDelayedJobPolicies);
}

function eventResourceResolution(type: ServerEventType): MailResourceResolution {
  // Deletion events are published AFTER the row is gone, so resolving the
  // vanished entity by its own id finds nothing and the event is dropped for
  // EVERY subscriber (including owners). Authorize instead against the parent
  // identity carried in the deletion payload (a tombstone), which still exists.
  if (type === 'email_account.deleted') {
    // The account itself is gone — nothing to authorize against. Deliver to
    // owners/admins only so other clients can drop it from their UI.
    return { kind: 'owner_admin_only' };
  }
  if (
    type === 'email_message_tag.deleted'
    || type === 'email_message_category.deleted'
    || type === 'email_internal_note.deleted'
  ) {
    return { kind: 'message_lookup', messageId: eventPayloadValue('messageId') };
  }
  if (type === 'email_thread_edge.deleted') {
    // Authorize BOTH the parent and child message (the child id is in the payload),
    // matching the created/read events, so neither leaks to a partial-access viewer.
    return {
      kind: 'event_message_pair',
      firstMessageId: eventPayloadValue('parentMessageId'),
      secondMessageId: eventPayloadValue('childMessageId'),
    };
  }
  if (type === 'email_account_signature.deleted') {
    return { kind: 'account', accountId: eventPayloadValue('accountId') };
  }
  if (type === 'email_thread_alias.deleted') {
    // The alias row is gone, so authorize against BOTH threads named in the tombstone
    // payload — the same two-sided rule the create/update events use (eventMetadataLookup
    // below) — falling back to the payload account only for an empty thread. This delivers
    // the deletion refresh to any delegate who could see both threads (accountless via the
    // messages, or account-scoped via a child grant), where the old plain-account tombstone
    // dropped it. Both threads empty + accountless → owner/admin only. (R47-4)
    return {
      kind: 'event_thread_alias_tombstone',
      aliasThreadId: eventPayloadValue('aliasThreadId'),
      canonicalThreadId: eventPayloadValue('canonicalThreadId'),
      accountId: eventPayloadValue('accountId'),
    };
  }

  if (type.startsWith('spam_learning_event.') || type.startsWith('spam_decision.')) {
    return spamEventResource();
  }
  if (type.startsWith('pgp_identity.')) {
    // PGP identities are strictly per-user (user_id bound); the HTTP list route
    // /api/v1/pgp/identities is deliberately admitted for restricted callers and
    // returns only that user's own identities, and a non-admin account manager may
    // generate / rotate their OWN identity. Deliver the resulting created/updated/
    // deleted event to that owning user (payload.userId) so their PgpPanel reloads —
    // as well as to owners/admins. Peer-key events stay owner/admin only below.
    return { kind: 'owner_admin_or_event_user', userId: eventPayloadValue('userId') };
  }
  if (type.startsWith('spam_') || type.startsWith('pgp_')) {
    // spam list-entry and PGP peer-key activity. Their HTTP list routes
    // (mail.metadata.read on mail_scope, not in RESTRICTED_SCOPE_READ_PATHS) admit
    // only full-scope owner/admin callers, but a workspace_global event resolves to
    // any nonempty scope — so a single-account metadata delegate would otherwise
    // receive every workspace key/spam-policy mutation. Restrict delivery to
    // owner/admin to match the read routes.
    return { kind: 'owner_admin_only' };
  }
  if (type.startsWith('conversation_lock.') || type === 'email_message.updated' || type === 'email_tracking.updated') {
    return { kind: 'message_lookup', messageId: eventValue('entityId') };
  }
  if (type === 'email_account.updated') {
    // A folder/message delegate legitimately renders a redacted parent account, so an
    // account UPDATE (label/identity refresh) must reach them too — the plain 'account'
    // resource authorization drops it because a child grant cannot authorize its parent
    // account. .created/.deleted stay 'account'/owner_admin_only (a brand-new account has
    // no child grants yet; deletions are owner/admin-only tombstones).
    return { kind: 'account_parent_aware', accountId: eventValue('entityId') };
  }
  if (type.startsWith('email_account.')) {
    return { kind: 'account', accountId: eventValue('entityId') };
  }
  if (type.startsWith('email_message_tag.')) return eventMetadataLookup('message_tag');
  if (type.startsWith('email_message_category.')) return eventMetadataLookup('message_category');
  if (type.startsWith('email_internal_note.')) return eventMetadataLookup('internal_note');
  if (type.startsWith('email_account_signature.')) return eventMetadataLookup('account_signature');
  if (type.startsWith('email_read_receipt.')) return eventMetadataLookup('read_receipt');
  if (type.startsWith('email_thread_edge.')) return eventMetadataLookup('thread_edge');
  if (type.startsWith('email_thread_alias.')) return eventMetadataLookup('thread_alias');
  if (type === 'email_thread.updated') {
    return { kind: 'thread_lookup', threadId: eventValue('entityId') };
  }
  if (type.startsWith('email_canned_response.')) {
    // Account-scoped canned responses authorize against their account (from the event
    // payload); global templates (accountId absent) stay workspace-global. Use
    // parent-aware account visibility so a folder/message-scoped mail.draft.create editor
    // — who the read port's cannedResponseVisibilityPredicate deliberately shows the
    // parent account's templates — still receives create/update/delete events for them
    // (a plain account resource rejects such a child grant, dropping the refresh). (R47-3)
    return {
      kind: 'optional_account',
      accountId: eventPayloadValue('accountId'),
      whenAbsent: 'workspace_global',
      whenPresent: 'account_parent_aware',
    };
  }
  if (type.startsWith('email_remote_content_allowlist.')) {
    // The workspace remote-content allowlist is a security setting: its HTTP list
    // route (mail.metadata.read on mail_scope) is deliberately excluded from
    // RESTRICTED_SCOPE_READ_PATHS, so only full-scope owner/admin callers can read
    // it. A workspace_global event would instead reach any nonempty scope, leaking
    // allowlist entry ids/activity to a single-account delegate. Restrict delivery
    // to owner/admin to match the read route (sanitization already drops the value).
    return { kind: 'owner_admin_only' };
  }
  if (
    type.startsWith('email_category.')
    || type.startsWith('email_team_member.')
  ) {
    return { kind: 'workspace_global' };
  }
  throw new Error(`unclassified mail event resource: ${type}`);
}

function eventMetadataLookup(
  entity: Extract<MailResourceResolution, { kind: 'metadata_lookup' }>['entity'],
): MailResourceResolution {
  return { kind: 'metadata_lookup', entity, id: eventValue('entityId') };
}

export function mailRoutePolicyKey(route: Pick<CanonicalApiRoute, 'method' | 'path'>): string {
  return `${route.method} ${route.path}`;
}

export function createMailRoutePolicyIndex(
  entries: readonly MailRoutePolicyEntry[],
): ReadonlyMap<string, MailRoutePolicyEntry> {
  return createUniqueIndex(entries, ({ route }) => mailRoutePolicyKey(route), 'mail route policy');
}

export function createMailEventPolicyIndex(
  entries: readonly MailEventPolicyEntry[],
): ReadonlyMap<string, MailEventPolicyEntry> {
  return createUniqueIndex(entries, ({ type }) => type, 'mail event policy');
}

export function assertMailRoutePolicy(method: HttpMethod, path: string): MailRoutePolicyEntry {
  const entry = MAIL_ROUTE_POLICY_MANIFEST.find(({ route }) => (
    route.method === method && route.pattern.test(path)
  ));
  if (!entry) throw new Error(`unclassified mail route: ${method} ${path}`);
  return entry;
}

export function assertMailEventPolicy(type: string): MailEventPolicyEntry {
  const entry = MAIL_EVENT_POLICY_INDEX.get(type);
  if (!entry) throw new Error(`unclassified mail event: ${type}`);
  return entry;
}

function createUniqueIndex<T>(
  entries: readonly T[],
  keyOf: (entry: T) => string,
  label: string,
): ReadonlyMap<string, T> {
  const index = new Map<string, T>();
  for (const entry of entries) {
    const key = keyOf(entry);
    if (index.has(key)) throw new Error(`duplicate ${label}: ${key}`);
    index.set(key, entry);
  }
  return index;
}

createMailRoutePolicyIndex(MAIL_ROUTE_POLICY_MANIFEST);
const MAIL_EVENT_POLICY_INDEX = createMailEventPolicyIndex(MAIL_EVENT_POLICY_MANIFEST);
