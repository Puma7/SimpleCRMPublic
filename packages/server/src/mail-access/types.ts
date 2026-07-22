import type { MailPermission, MailResource } from '@simplecrm/core';

export type MailAccessActor = Readonly<{
  workspaceId: string;
  userId: string;
  isOwner: boolean;
  isAdmin: boolean;
}>;

export type MailAccessGrant =
  | Readonly<{ resourceType: 'account'; accountId: number; folderId: null; messageId: null }>
  | Readonly<{ resourceType: 'folder'; accountId: number; folderId: number; messageId: null }>
  | Readonly<{
    resourceType: 'message';
    accountId: number;
    folderId: number;
    messageId: number;
  }>;

export type MailSqlScope =
  | Readonly<{ kind: 'all' }>
  | Readonly<{ kind: 'none' }>
  | Readonly<{
    kind: 'restricted';
    accountIds: readonly number[];
    folderIds: readonly number[];
    messageIds: readonly number[];
  }>;

export type ResolveMailAccessGrantsInput = Readonly<{
  workspaceId: string;
  userId: string;
  permission: MailPermission;
}>;

export type MailAclRolloutEvaluationContext = Readonly<{
  workspaceId: string;
}>;

export interface MailAccessPort {
  resolveGrants(
    input: ResolveMailAccessGrantsInput,
    evaluationContext?: MailAclRolloutEvaluationContext,
  ): Promise<readonly MailAccessGrant[]>;
}

export interface MailAccessService {
  assertPermission(input: Readonly<{
    workspaceId: string;
    actor: MailAccessActor;
    permission: MailPermission;
    resource: MailResource;
  }>): Promise<void>;

  resolveScope(input: Readonly<{
    workspaceId: string;
    actor: MailAccessActor;
    permission: MailPermission;
  }>): Promise<MailSqlScope>;
}

export type MailAclRolloutMode = 'shadow' | 'enforce';

export type MailAclRolloutPersistentDiagnosticCode =
  | 'counter_update_failed'
  | 'counter_update_zero_rows'
  | 'counter_saturated';

export type MailAclRolloutDiagnosticCode =
  | MailAclRolloutPersistentDiagnosticCode
  | 'rollout_state_invalid';

export type MailAclRolloutCounters = Readonly<{
  evaluated: bigint;
  legacyAllowNewDeny: bigint;
  legacyDenyNewAllow: bigint;
  notComparable: bigint;
  inFlight: bigint;
}>;

export type MailAclRolloutState = MailAclRolloutCounters & Readonly<{
  mode: MailAclRolloutMode;
  observationStartedAt: string | null;
  observationUpdatedAt: string | null;
  telemetryHealthy: boolean;
  diagnosticCode: MailAclRolloutDiagnosticCode | null;
  diagnosticAt: string | null;
  diagnostic?: string;
}>;

export type MailAclRolloutReadiness = MailAclRolloutState & Readonly<{
  workspaceId: string;
  ready: boolean;
  enforced: boolean;
}>;

export type MailAclRolloutTransitionResult =
  | Readonly<{ ok: true }>
  | Readonly<{
    ok: false;
    code:
      | 'not_shadow'
      | 'no_observations'
      | 'mismatches_present'
      | 'telemetry_unhealthy'
      | 'evaluations_in_flight';
  }>;

export type MailAclRolloutCounterResetResult =
  | Readonly<{ ok: true }>
  | Readonly<{ ok: false; code: 'not_shadow' }>;

export type MailResourceLookupTarget =
  | Readonly<{ kind: 'account'; id: number }>
  | Readonly<{ kind: 'folder'; id: number }>
  | Readonly<{ kind: 'message'; id: number }>
  | Readonly<{ kind: 'attachment'; id: number }>
  // Resolve a stored attachment by its on-disk storage_path to the message(s) that
  // own it, so a caller-supplied compose attachment path can be authorized against
  // mail.attachment.read. Returns [] for a path with no owning attachment row (e.g. a
  // freshly uploaded draft-local file), which the caller must authorize another way.
  | Readonly<{ kind: 'attachment_path'; path: string }>
  | Readonly<{ kind: 'thread'; id: string }>
  | Readonly<{
    kind: 'metadata';
    entity:
      | 'message_tag'
      | 'message_category'
      | 'internal_note'
      | 'read_receipt'
      | 'thread_edge'
      | 'thread_alias'
      | 'account_signature'
      | 'spam_decision'
      | 'spam_learning_event';
    id: number;
  }>
  // Canned responses may be global (account_id null); the resolver returns an
  // account resource for account-scoped rows and [] for global/missing rows.
  | Readonly<{ kind: 'canned_response'; id: number }>
  // A DELETED thread-alias tombstone (email_thread_alias.deleted): the alias row is gone,
  // so authorize against BOTH threads named in the event payload — falling back to the
  // payload account only for an EMPTY thread — reproducing the create/update two-sided
  // visibility rule (the enforcer applies mode 'all'). Both threads empty + accountless
  // → [] (the enforcer then routes to the owner/admin-only gate). (R47-4)
  | Readonly<{
    kind: 'thread_alias_tombstone';
    aliasThreadId: string;
    canonicalThreadId: string;
    accountId: number | null;
  }>;

export interface MailResourceLookupPort {
  resolve(input: Readonly<{
    workspaceId: string;
    target: MailResourceLookupTarget;
  }>): Promise<readonly MailResource[]>;
  classifyWorkflowDelayedJob?(input: Readonly<{
    workspaceId: string;
    delayedJobId: number;
  }>): Promise<WorkflowDelayedJobMailClassification>;
  // A scheduled-send draft's reply parent (email_messages.reply_parent_message_id)
  // plus whether finalizeSentDraft would mark it done — used to recheck
  // mail.triage on the parent before a scheduled reply-send fires. null if the
  // draft no longer exists.
  resolveScheduledDraftReplyParent?(input: Readonly<{
    workspaceId: string;
    draftId: number;
  }>): Promise<Readonly<{ replyParentMessageId: number | null; markParentDone: boolean }> | null>;
  // A scheduled-send draft's stored attachment paths
  // (email_messages.draft_attachment_paths_json), used to recheck mail.attachment.read
  // on each path before a scheduled send transmits it. null if the draft is gone.
  resolveScheduledDraftAttachmentPaths?(input: Readonly<{
    workspaceId: string;
    draftId: number;
  }>): Promise<readonly string[] | null>;
  // The display filenames (email_message_attachments.filename_display) of every stored
  // attachment row whose storage_path equals `path`. Used to classify a compose/scheduled
  // send attachment path with isPotentiallyDangerousAttachment so the send paths enforce
  // mail.attachment.suspicious_download in parity with the download/raw-EML routes (which
  // gate the same bytes). Empty for a path with no owning row (e.g. a draft-local upload).
  resolveAttachmentPathFilenames?(input: Readonly<{
    workspaceId: string;
    path: string;
  }>): Promise<readonly string[]>;
  // The display filenames of every stored attachment row of a MESSAGE (by id), used to
  // classify a workflow forward_copy's forwarded attachments with isPotentiallyDangerousAttachment
  // so the forward gate enforces mail.attachment.suspicious_download in parity with the
  // download/raw-EML/scheduled-send routes. Empty for a message with no attachment rows. (R52-1)
  resolveMessageAttachmentFilenames?(input: Readonly<{
    workspaceId: string;
    messageId: number;
  }>): Promise<readonly string[]>;
  // A workflow's current graph (email_workflows.graph_json), used to reclassify
  // its side-effecting nodes at execution time. null if the workflow is gone.
  loadWorkflowGraphForPolicy?(input: Readonly<{
    workspaceId: string;
    workflowId: number;
  }>): Promise<Readonly<{ graph: unknown }> | null>;
  // The alias/canonical thread ids a stored thread-alias row points at, used to
  // authorize a DELETE against both threads (deletion rebuilds edges across both,
  // which can span accounts the alias row's own account_id does not cover). null
  // if the alias row is gone.
  resolveThreadAliasThreadIds?(input: Readonly<{
    workspaceId: string;
    aliasId: number;
  }>): Promise<Readonly<{ aliasThreadId: string; canonicalThreadId: string }> | null>;
}

export type WorkflowDelayedJobMailClassification =
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'invalid' }>
  | Readonly<{ kind: 'non_mail' }>
  | Readonly<{
    kind: 'message';
    resource: Extract<MailResource, { type: 'message' }>;
  }>;
