import type { MailResource } from '@simplecrm/core';
import {
  collectWorkflowSendDraftStaticDraftIds,
  workflowGraphHasAnyNodeType,
  workflowGraphHasNodeType,
  workflowGraphHasSideEffectNode,
} from '@simplecrm/core';

import type {
  AuthenticatedPrincipal,
  ServerEvent,
  ServerEventPort,
} from '../api/types';
import { SERVER_EVENT_TYPES } from '../api/types';
import {
  assertMailEventPolicy,
  MAIL_EVENT_POLICY_MANIFEST,
  type MailEventPolicyEntry,
  type MailResourceResolution,
  type PolicyValueSelector,
} from './policy-manifest';
import {
  assertServerJobPolicy,
  isTrustedServiceJobPayload,
  MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD,
  POST_PROCESS_RETRY_JOB_MARKER_FIELD,
  type ServerJobPolicyEntry,
} from '../jobs/policy';
import type { MailJobAuthorization, QueuedJob } from '../jobs/types';
import { MailAccessDeniedError } from './service';
import type {
  MailAccessActor,
  MailAccessService,
  MailResourceLookupPort,
  MailResourceLookupTarget,
} from './types';

export class MailAsyncAuthorizationError extends Error {
  readonly code = 'mail_async_authorization_denied' as const;

  readonly nonRetryable = true;

  constructor(cause?: unknown) {
    super(cause instanceof Error ? cause.message : 'mail_access_denied');
    this.name = 'MailAsyncAuthorizationError';
  }
}

export type MailAsyncPolicyPorts = Readonly<{
  mailAccess?: MailAccessService;
  mailResourceLookup?: MailResourceLookupPort;
  auth?: Readonly<{
    listUsers?: (input: { workspaceId: string }) => Promise<readonly {
      id: string;
      role: 'owner' | 'admin' | 'user';
      disabledAt: string | null;
    }[]>;
    // Workspace-scoped single-user lookup used to resolve a queued job's actor
    // without scanning the whole user list. Optional so ports that only expose
    // listUsers still work (via the fallback in resolveUserActor).
    getUser?: (input: { workspaceId: string; userId: string }) => Promise<{
      id: string;
      role: 'owner' | 'admin' | 'user';
      disabledAt: string | null;
    } | null>;
  }>;
}>;

export type MailEventFilterContext = Readonly<{
  principal: AuthenticatedPrincipal;
  ports: MailAsyncPolicyPorts;
}>;

type ResolvedResources =
  | Readonly<{ kind: 'non_mail' }>
  | Readonly<{ kind: 'scope' }>
  | Readonly<{ kind: 'owner_admin' }>
  | Readonly<{ kind: 'owner_admin_or_user'; userId: string }>
  | Readonly<{ kind: 'resources'; resources: readonly MailResource[]; mode: 'all' | 'any' }>;

type ResolvedJobResources = Readonly<{
  resources: ResolvedResources;
  authorization?: MailJobAuthorization;
}>;

const MAIL_EVENT_POLICY_TYPES = new Set(MAIL_EVENT_POLICY_MANIFEST.map((entry) => entry.type));
const SERVER_EVENT_TYPE_SET = new Set<string>(SERVER_EVENT_TYPES);

const EVENT_PAYLOAD_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'email_acl.changed': ['bindingId', 'targetUserId', 'state', 'resourceType', 'accountId', 'folderId'],
  'email_account.created': ['accountId', 'state'],
  'email_account.updated': ['accountId', 'state'],
  'email_account.deleted': ['accountId', 'state'],
  'email_message.updated': ['messageId', 'accountId', 'folderId', 'state'],
  'email_message_tag.created': ['messageId', 'tagId', 'state'],
  'email_message_tag.deleted': ['messageId', 'tagId', 'state'],
  'email_message_category.created': ['messageId', 'categoryId', 'state'],
  'email_message_category.deleted': ['messageId', 'categoryId', 'state'],
  'email_internal_note.created': ['messageId', 'noteId', 'state'],
  'email_internal_note.updated': ['messageId', 'noteId', 'state'],
  'email_internal_note.deleted': ['messageId', 'noteId', 'state'],
  'email_thread_edge.created': ['parentMessageId', 'childMessageId', 'state'],
  'email_thread_edge.deleted': ['parentMessageId', 'childMessageId', 'state'],
  'email_thread_alias.created': ['accountId', 'threadId', 'state'],
  'email_thread_alias.updated': ['accountId', 'threadId', 'state'],
  'email_thread_alias.deleted': ['accountId', 'threadId', 'state'],
  'email_thread.updated': ['threadId', 'state'],
  'email_account_signature.created': ['accountId', 'signatureId', 'state'],
  'email_account_signature.updated': ['accountId', 'signatureId', 'state'],
  'email_account_signature.deleted': ['accountId', 'signatureId', 'state'],
  // accountId (null for a global template) lets the event filter authorize an
  // account-scoped canned response against its account; clients treat these as a
  // refetch signal, so no other payload field needs to survive sanitization.
  'email_canned_response.created': ['accountId'],
  'email_canned_response.updated': ['accountId'],
  'email_canned_response.deleted': ['accountId'],
  'email_read_receipt.created': ['messageId', 'state'],
  'email_tracking.updated': ['messageId', 'state'],
  'conversation_lock.acquired': ['messageId', 'state', 'reason'],
  'conversation_lock.heartbeat': ['messageId', 'state', 'reason'],
  'conversation_lock.released': ['messageId', 'state', 'reason'],
  'conversation_lock.force_takeover': ['messageId', 'state', 'reason'],
  // PGP identity events deliver to the owning user (and owners/admins); userId is the
  // event filter's authorization key and the client's "whose identity changed" signal.
  // Nothing else (email/fingerprint/key material) survives sanitization.
  'pgp_identity.created': ['userId'],
  'pgp_identity.updated': ['userId'],
  'pgp_identity.deleted': ['userId'],
  'spam_learning_event.created': ['messageId', 'accountId', 'state'],
  'spam_decision.created': ['messageId', 'accountId', 'state'],
  'spam_decision.updated': ['messageId', 'accountId', 'state'],
  'spam_decision.deleted': ['messageId', 'accountId', 'state'],
  'workflow_delayed_job.created': ['id', 'sourceSqliteId', 'workflowId', 'workflowSourceSqliteId', 'messageId', 'messageSourceSqliteId', 'resumeNodeId', 'executeAt', 'status'],
  'workflow_delayed_job.updated': ['id', 'sourceSqliteId', 'workflowId', 'workflowSourceSqliteId', 'messageId', 'messageSourceSqliteId', 'resumeNodeId', 'executeAt', 'status'],
  'workflow_delayed_job.deleted': ['id', 'sourceSqliteId', 'workflowId', 'workflowSourceSqliteId', 'messageId', 'messageSourceSqliteId', 'resumeNodeId', 'executeAt', 'status'],
});

export async function enforceMailJobPolicy(
  job: QueuedJob,
  ports: MailAsyncPolicyPorts | undefined,
): Promise<MailJobAuthorization | undefined> {
  const policy = assertServerJobPolicy(job.type);
  if (policy.kind === 'non_mail') return undefined;
  if (!ports?.mailAccess || !ports.mailResourceLookup) {
    throw new MailAsyncAuthorizationError();
  }
  const requiredPorts = {
    ...ports,
    mailAccess: ports.mailAccess,
    mailResourceLookup: ports.mailResourceLookup,
  };

  const actor = await resolveJobActor(job, policy, ports);
  // Reclassify a workflow.execute graph BEFORE resource resolution: a message-less
  // execution resolves to non_mail and returns early below, skipping every check,
  // yet still runs side-effecting nodes under the system role. Runs for user actors
  // only (trusted service jobs stay authorized).
  if (actor.kind === 'user') {
    await assertWorkflowExecuteSideEffectPrivilege(job, actor.actor, requiredPorts);
    assertWorkflowChildSideEffectPrivilege(job, actor.actor);
    assertPostProcessRetryPrivilege(job, actor.actor);
  }
  const resolved = await resolveJobResources(job, policy, requiredPorts);
  // A compose-originated (user) ai.pick_canned loads canned templates under the
  // system role and feeds their titles/bodies to the AI provider; scope that query
  // to the initiating user's mail.draft.create accounts so it cannot surface (or copy
  // into a draft) templates from accounts they cannot reach. Service/automatic runs
  // carry no per-user scope and stay unrestricted. Resolved here (before the non_mail
  // early return) so a message-less pick_canned is scoped too.
  const pickCannedAuthorization = job.type === 'ai.pick_canned' && actor.kind === 'user'
    ? {
      kind: 'ai_pick_canned_scope' as const,
      cannedScope: await requiredPorts.mailAccess.resolveScope({
        workspaceId: job.workspaceId,
        actor: actor.actor,
        permission: 'mail.draft.create',
      }),
    }
    : undefined;
  if (resolved.resources.kind === 'non_mail') return pickCannedAuthorization ?? resolved.authorization;
  if (actor.kind === 'service') {
    assertServiceResources(resolved.resources);
    return resolved.authorization;
  }
  try {
    await assertResolvedResources({
      workspaceId: job.workspaceId,
      actor: actor.actor,
      permission: policy.permission,
      resources: resolved.resources,
      ports: requiredPorts,
    });
    // A scheduled reply-send marks the reply parent done by default, a mail.triage
    // mutation the base mail.send policy never covers — recheck it on the parent.
    await assertScheduledSendReplyParentTriage(job, actor.actor, requiredPorts);
    // A scheduled send transmits the STORED draft's body/recipients + attachment paths
    // through the system-backed sender, which does no per-actor check — so at execution
    // recheck mail.draft.edit on the draft itself (arming another user's draft for send
    // is a draft mutation the base mail.send policy never covers) plus mail.attachment.read
    // on each stored attachment path, catching a revocation after the send was scheduled.
    // Mirrors the HTTP compose/send + scheduled-send enforcer. User actors only;
    // trusted-service sends returned above.
    await assertScheduledSendDraftAndAttachmentAccess(job, actor.actor, requiredPorts);
    // Reply generation (mail.draft.create), message classification (mail.triage),
    // message-attributed workflow HTTP requests (mail.metadata.read), and spam scoring
    // (mail.triage) all read the message body — snippet/body_text/combined_text, or the
    // raw RFC822/headers/bodies that runSecurityCheck ships to Rspamd — and send it
    // onward, so the base permission is not enough; also require mail.content.read on
    // the message. This runs at EXECUTION time (for user actors only — service jobs
    // returned above), so a content grant revoked after the job was queued (while the
    // user retained the base grant) is caught here rather than slipping through the
    // queue window; trusted-service inbound scoring stays unchanged. (A message-less
    // http_request resolves to non_mail and returns above, so this only gates
    // message-attributed ones.)
    if (
      (
        job.type === 'ai.reply_suggestion'
        || job.type === 'ai.classify'
        || job.type === 'workflow.http_request'
        || job.type === 'mail.spam.score'
      )
      && resolved.resources.kind === 'resources'
    ) {
      for (const resource of resolved.resources.resources) {
        await requiredPorts.mailAccess.assertPermission({
          workspaceId: job.workspaceId,
          actor: actor.actor,
          permission: 'mail.content.read',
          resource,
        });
      }
    }
    // A compose-originated ai.agent / ai.pick_canned with createDraft:true calls
    // createPostgresComposeDraftInTransaction() under the SYSTEM role, minting a reply
    // draft the base content.read policy never covers. Recheck mail.draft.create on the
    // message at EXECUTION time so a delegate lacking it (or whose grant was revoked
    // after the workflow.execute parent enqueued this child) cannot create drafts.
    if (
      (job.type === 'ai.agent' || job.type === 'ai.pick_canned')
      && job.payload.createDraft === true
      && resolved.resources.kind === 'resources'
    ) {
      for (const resource of resolved.resources.resources) {
        await requiredPorts.mailAccess.assertPermission({
          workspaceId: job.workspaceId,
          actor: actor.actor,
          permission: 'mail.draft.create',
          resource,
        });
      }
    }
    // A compose- or workflow-originated ai.review mutates its message under the
    // SYSTEM role when the model returns BLOCK: an outbound review sets
    // outbound_hold/outbound_block_reason on the draft (a draft edit), while an
    // inbound review adds the ki-review-block tag (a triage action). The base
    // mail.content.read policy covers neither, so recheck the matching mutation
    // permission at EXECUTION time — a delegate whose draft.edit/triage was revoked
    // after the parent enqueued this child cannot mutate the message through it.
    if (job.type === 'ai.review' && resolved.resources.kind === 'resources') {
      const reviewMutationPermission = job.payload.direction === 'outbound'
        ? 'mail.draft.edit' as const
        : 'mail.triage' as const;
      for (const resource of resolved.resources.resources) {
        await requiredPorts.mailAccess.assertPermission({
          workspaceId: job.workspaceId,
          actor: actor.actor,
          permission: reviewMutationPermission,
          resource,
        });
      }
    }
    // A workflow.forward_copy job transmits (SMTP-sends) a copy of the message —
    // including its content and attachments — to arbitrary recipients under the
    // account's SYSTEM identity (createPostgresWorkflowForwardCopyPort sends via
    // withWorkspaceTransaction role:'system', authing with the account's stored
    // secrets, never the initiating user's live send grant). The base policy only
    // requires mail.export, so a delegate whose mail.send was revoked (but who kept
    // mail.export) could still exfiltrate content by forwarding. Recheck mail.send on
    // the message at EXECUTION time — forwarding IS sending. User actors only;
    // trusted-service forwards returned above.
    if (job.type === 'workflow.forward_copy' && resolved.resources.kind === 'resources') {
      for (const resource of resolved.resources.resources) {
        await requiredPorts.mailAccess.assertPermission({
          workspaceId: job.workspaceId,
          actor: actor.actor,
          permission: 'mail.send',
          resource,
        });
      }
    }
    // A workflow.execute whose CURRENT graph contains an email.delete_server node
    // PERMANENTLY deletes the message on the IMAP server (plus a local soft-delete)
    // under the system role when that node runs (deleteWorkflowMessageOnImap), yet the
    // base workflow.execute policy only requires mail.content.read. So a user-attributed
    // run reaching a delete node — an inbound/continuation workflow, or a delegate who
    // kept content.read but lost mail.delete — could destroy server mail without the
    // delete grant. Recheck mail.delete on the resolved message at EXECUTION time,
    // inspecting the CURRENT graph so a delete node added after enqueue is still caught.
    // User actors only (service jobs returned above).
    if (job.type === 'workflow.execute' && resolved.resources.kind === 'resources') {
      await assertWorkflowExecuteDeleteNodePrivilege(
        job,
        actor.actor,
        resolved.resources.resources,
        requiredPorts,
      );
      await assertWorkflowExecuteTriageNodePrivilege(
        job,
        actor.actor,
        resolved.resources.resources,
        requiredPorts,
      );
      await assertWorkflowExecuteDraftCreateNodePrivilege(
        job,
        actor.actor,
        resolved.resources.resources,
        requiredPorts,
      );
      await assertWorkflowExecuteReleaseOutboundNodePrivilege(
        job,
        actor.actor,
        resolved.resources.resources,
        requiredPorts,
      );
      await assertWorkflowExecuteSendDraftStaticTargetPrivilege(job, actor.actor, requiredPorts);
    }
    return pickCannedAuthorization ?? resolved.authorization;
  } catch (error) {
    if (isAccessDenied(error)) throw new MailAsyncAuthorizationError(error);
    throw error;
  }
}

// R9-5: a demoted user's queued workflow.execute would otherwise run its
// side-effecting nodes under the system role with no per-node ACL. Reclassify the
// workflow's CURRENT graph at execution time and deny a non-owner/admin actor when
// it contains side-effecting nodes, mirroring the HTTP route's admin gate. The
// workflows.manage capability is not resolvable from the job actor, so this covers
// the demotion (admin → user) scenario; non-side-effecting graphs stay allowed.
// Side-effect child jobs a live/manual workflow queues. Each is produced ONLY by
// the workflow runtime and is a side-effecting node type (graph-validate READ_ONLY
// allowlist), so a workflow.execute run already required owner/admin for a non-admin
// actor. There is no direct user producer for any of them, so gating on job.type is
// safe. The message-optional ones (http_request + AI children) resolve to non_mail
// when the node has no message and skip every check; the message-scoped ones
// (forward_copy = SMTP send, ai.classify = message tag, dmarc_ingest = persists
// parsed DMARC reports under the system role) DO get a per-message ACL check, but
// that verifies only mail.export / mail.triage / mail.attachment.read — NOT the
// admin the graph required — so a demoted admin who retains those grants would
// still run the effect.
// (ai.reply_suggestion IS included: its child ensure() calls the external AI provider
// and writes email_messages.reply_suggestion_* under the system role — not read-only —
// so a manual admin-gated run whose initiator was demoted before the child executes
// must be re-denied here too. It keeps its own mail.content.read supplemental as well.)
const WORKFLOW_CHILD_SIDE_EFFECT_JOB_TYPES: ReadonlySet<string> = new Set([
  'workflow.http_request',
  'ai.agent',
  'ai.pick_canned',
  'ai.review',
  'ai.transform_text',
  'ai.reply_suggestion',
  'workflow.forward_copy',
  'ai.classify',
  'workflow.dmarc_ingest',
]);

// R12-2/R13-1 (R22-2: scoped to marked jobs): re-deny a non-owner/admin actor for a
// workflow side-effect child that belongs to a MANUAL admin-gated run — the marker is
// stamped on the manual live-execute workflow.execute and propagated to its delayed
// continuations and side-effect children. This catches an admin demoted between
// enqueue and the child's execution, for both the message-less children (which
// otherwise hit the non_mail early return) and the message-scoped ones (whose
// per-message check does not re-establish admin). Compose/inbound children are
// unmarked → exempt from this admin recheck but still pass their per-message ACL.
// Trusted-service children (automatic/inbound runs) are actor.kind==='service' and
// never reach here.
function assertWorkflowChildSideEffectPrivilege(job: QueuedJob, actor: MailAccessActor): void {
  if (!WORKFLOW_CHILD_SIDE_EFFECT_JOB_TYPES.has(job.type)) return;
  if (job.payload[MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD] !== true) return;
  if (actor.isOwner || actor.isAdmin) return;
  throw new MailAsyncAuthorizationError();
}

// R18-5: the admin-only post-process/retry route enqueues a mail.spam.score job that
// re-runs the system-role security check, writes message status, and re-enqueues
// inbound workflows. The base mail.spam.score policy only rechecks mail.triage, so a
// delegate/admin demoted between enqueue and execution — who retains triage — could
// still complete those system-role side effects. The route stamps a server-only
// marker (never set from request bodies, so not forgeable); re-verify current
// owner/admin status for marked jobs. Unmarked mail.spam.score jobs (the ordinary
// inbound scoring path) are unaffected.
function assertPostProcessRetryPrivilege(job: QueuedJob, actor: MailAccessActor): void {
  if (job.type !== 'mail.spam.score') return;
  if (job.payload[POST_PROCESS_RETRY_JOB_MARKER_FIELD] !== true) return;
  if (actor.isOwner || actor.isAdmin) return;
  throw new MailAsyncAuthorizationError();
}

// R9-5/R13-1 (R22-2: scoped to marked jobs): a demoted admin's queued MANUAL
// workflow.execute would otherwise run its side-effecting nodes under the system role
// with no per-node ACL. Reclassify the workflow's CURRENT graph at execution time and
// deny a non-owner/admin actor when it has side-effecting nodes — but ONLY for jobs
// the manual live-execute route marked as admin-gated at enqueue (propagated to
// delayed continuations). Compose-originated outbound-review workflow.execute jobs
// (non-admin senders holding mail.send) are unmarked → exempt here, still bound by the
// per-message mail.content.read ACL that runs after this gate.
async function assertWorkflowExecuteSideEffectPrivilege(
  job: QueuedJob,
  actor: MailAccessActor,
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailResourceLookup'>>,
): Promise<void> {
  if (job.type !== 'workflow.execute') return;
  if (job.payload[MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD] !== true) return;
  if (actor.isOwner || actor.isAdmin) return;
  const workflowId = optionalPositiveInt(job.payload.workflowId);
  if (workflowId === null || !ports.mailResourceLookup.loadWorkflowGraphForPolicy) return;
  const loaded = await ports.mailResourceLookup.loadWorkflowGraphForPolicy({
    workspaceId: job.workspaceId,
    workflowId,
  });
  if (loaded && workflowGraphHasSideEffectNode(loaded.graph)) {
    throw new MailAsyncAuthorizationError();
  }
}

// R36-2: server workflow runs execute under a system role with no per-node ACL, so a
// user-attributed workflow.execute reaching an email.delete_server node (which issues a
// permanent IMAP messageDelete + local soft-delete) would destroy server mail while the
// base policy only checks mail.content.read. Load the CURRENT graph and, when it holds a
// delete node, require mail.delete on each resolved message so a delegate lacking it (or
// whose grant was revoked after enqueue, or a delete node added after enqueue) is denied.
// The graph is loaded via the same port the interim side-effect gate uses; a graph with
// no delete node, an unresolvable workflowId, or an unavailable loader adds no
// requirement — the executor blocks a missing/definition-only graph anyway, and the
// delete node additionally needs the workspace opt-in flag.
async function assertWorkflowExecuteDeleteNodePrivilege(
  job: QueuedJob,
  actor: MailAccessActor,
  resources: readonly MailResource[],
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailAccess' | 'mailResourceLookup'>>,
): Promise<void> {
  if (job.type !== 'workflow.execute') return;
  const workflowId = optionalPositiveInt(job.payload.workflowId);
  if (workflowId === null || !ports.mailResourceLookup.loadWorkflowGraphForPolicy) return;
  const loaded = await ports.mailResourceLookup.loadWorkflowGraphForPolicy({
    workspaceId: job.workspaceId,
    workflowId,
  });
  if (!loaded || !workflowGraphHasNodeType(loaded.graph, 'email.delete_server')) return;
  for (const resource of resources) {
    await ports.mailAccess.assertPermission({
      workspaceId: job.workspaceId,
      actor,
      permission: 'mail.delete',
      resource,
    });
  }
}

// R38-1: the triage-class workflow nodes — tag / category / archive / mark-seen /
// assign / spam-status / spam / IMAP-move / customer-link — mutate the message row (or
// its tag/category child rows, or its IMAP flags/folder) under the system role with no
// per-actor ACL, exactly like email.delete_server. The base workflow.execute policy
// only requires mail.content.read, so a user-attributed run (user-triggered sync) whose
// actor kept content.read but lacks/lost mail.triage would still mutate. Each of these
// nodes' HTTP equivalent requires mail.triage (verified against policy-manifest), so
// recheck mail.triage on the resolved message when the CURRENT graph contains any of
// them. The set carries BOTH the registry dotted form and the legacy canvas action
// alias, because sideEffectRuntimeType returns the bare actionType for action nodes.
// (email.delete_server → mail.delete and email.create_draft → mail.draft.create are
// each their own permission and handled by dedicated rechecks above/below, not here.)
const WORKFLOW_TRIAGE_NODE_TYPES: ReadonlySet<string> = new Set<string>([
  'email.tag', 'tag',
  'email.set_category', 'set_category',
  'email.tag_attachment_meta', 'tag_attachment_meta',
  'email.set_priority',
  'email.mark_seen', 'mark_seen',
  'email.archive', 'archive',
  'email.set_spam_status',
  'email.mark_spam',
  'email.move_imap',
  'email.assign',
  'crm.link_customer', 'link_customer',
]);

async function assertWorkflowExecuteTriageNodePrivilege(
  job: QueuedJob,
  actor: MailAccessActor,
  resources: readonly MailResource[],
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailAccess' | 'mailResourceLookup'>>,
): Promise<void> {
  if (job.type !== 'workflow.execute') return;
  const workflowId = optionalPositiveInt(job.payload.workflowId);
  if (workflowId === null || !ports.mailResourceLookup.loadWorkflowGraphForPolicy) return;
  const loaded = await ports.mailResourceLookup.loadWorkflowGraphForPolicy({
    workspaceId: job.workspaceId,
    workflowId,
  });
  if (!loaded || !workflowGraphHasAnyNodeType(loaded.graph, WORKFLOW_TRIAGE_NODE_TYPES)) return;
  for (const resource of resources) {
    await ports.mailAccess.assertPermission({
      workspaceId: job.workspaceId,
      actor,
      permission: 'mail.triage',
      resource,
    });
  }
}

// R39-2: an email.create_draft workflow node calls createWorkflowComposeDraft, which
// persists a reply/compose draft on the message under the SYSTEM-role transaction with
// no per-actor ACL, exactly like the ai.agent/ai.pick_canned createDraft children the
// job policy already gates. The base workflow.execute policy only requires
// mail.content.read, so a user-attributed run (e.g. a user-triggered sync) whose actor
// lacks — or has since lost — mail.draft.create could still mint a draft through the
// node. Recheck mail.draft.create on the resolved message when the CURRENT graph
// contains an email.create_draft node (matching its HTTP-equivalent permission). Only
// the registry runtime type exists (no legacy canvas action alias).
async function assertWorkflowExecuteDraftCreateNodePrivilege(
  job: QueuedJob,
  actor: MailAccessActor,
  resources: readonly MailResource[],
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailAccess' | 'mailResourceLookup'>>,
): Promise<void> {
  if (job.type !== 'workflow.execute') return;
  const workflowId = optionalPositiveInt(job.payload.workflowId);
  if (workflowId === null || !ports.mailResourceLookup.loadWorkflowGraphForPolicy) return;
  const loaded = await ports.mailResourceLookup.loadWorkflowGraphForPolicy({
    workspaceId: job.workspaceId,
    workflowId,
  });
  if (!loaded || !workflowGraphHasNodeType(loaded.graph, 'email.create_draft')) return;
  for (const resource of resources) {
    await ports.mailAccess.assertPermission({
      workspaceId: job.workspaceId,
      actor,
      permission: 'mail.draft.create',
      resource,
    });
  }
}

// R40-4 (A): an email.release_outbound node clears the workflow message's outbound-review
// hold — and in autoSend mode rewrites its body/subject/ticket and arms scheduled_send_at
// — under the SYSTEM role. Its target is always the workflow's own message
// (context.messageId), i.e. resolved.resources here, and the base policy only requires
// mail.content.read. So a user-attributed run whose actor lacks/lost mail.draft.edit could
// mutate the draft (and stamp the outbound-review approval marker) through the node.
// Recheck mail.draft.edit on the resolved message when the CURRENT graph holds a release
// node. (The eventual SMTP send is separately blocked by the mail.send.scheduled recheck.)
async function assertWorkflowExecuteReleaseOutboundNodePrivilege(
  job: QueuedJob,
  actor: MailAccessActor,
  resources: readonly MailResource[],
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailAccess' | 'mailResourceLookup'>>,
): Promise<void> {
  if (job.type !== 'workflow.execute') return;
  const workflowId = optionalPositiveInt(job.payload.workflowId);
  if (workflowId === null || !ports.mailResourceLookup.loadWorkflowGraphForPolicy) return;
  const loaded = await ports.mailResourceLookup.loadWorkflowGraphForPolicy({
    workspaceId: job.workspaceId,
    workflowId,
  });
  if (!loaded || !workflowGraphHasNodeType(loaded.graph, 'email.release_outbound')) return;
  for (const resource of resources) {
    await ports.mailAccess.assertPermission({
      workspaceId: job.workspaceId,
      actor,
      permission: 'mail.draft.edit',
      resource,
    });
  }
}

// R40-4 (B): an email.send_draft node arms an EXISTING draft for send — rewriting its
// body/subject/ticket, clearing its review hold, and stamping the outbound-review approval
// marker — under the SYSTEM role. Its target is a SEPARATE draft (not the workflow's
// message): a static config.draftId (resolvable here) or a runtime draftIdVariable (only
// known at execution — that case's actual send is still blocked downstream by the
// mail.send.scheduled recheck, and its variable target is the run's own just-created
// draft). For each STATIC target id in the current graph, resolve it and require
// mail.draft.edit so a user-attributed run cannot mutate an arbitrary other user's draft.
async function assertWorkflowExecuteSendDraftStaticTargetPrivilege(
  job: QueuedJob,
  actor: MailAccessActor,
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailAccess' | 'mailResourceLookup'>>,
): Promise<void> {
  if (job.type !== 'workflow.execute') return;
  const workflowId = optionalPositiveInt(job.payload.workflowId);
  if (workflowId === null || !ports.mailResourceLookup.loadWorkflowGraphForPolicy) return;
  const loaded = await ports.mailResourceLookup.loadWorkflowGraphForPolicy({
    workspaceId: job.workspaceId,
    workflowId,
  });
  if (!loaded) return;
  const draftIds = collectWorkflowSendDraftStaticDraftIds(loaded.graph);
  for (const draftId of draftIds) {
    const targets = await ports.mailResourceLookup.resolve({
      workspaceId: job.workspaceId,
      target: { kind: 'message', id: draftId },
    });
    // A configured static draft id that resolves to nothing (deleted/foreign) fails
    // closed rather than letting the node mutate an unverified draft.
    if (targets.length === 0) throw new MailAsyncAuthorizationError();
    for (const resource of targets) {
      await ports.mailAccess.assertPermission({
        workspaceId: job.workspaceId,
        actor,
        permission: 'mail.draft.edit',
        resource,
      });
    }
  }
}

// R7-2: a scheduled reply-send forwards replyParentMessageId and finalizeSentDraft
// marks that parent done by default (unless the sender stored compose_mark_parent_done:'0').
// The base job policy only rechecks mail.send on the draft, so a delegate without
// triage — or whose triage grant was revoked before the job fires — could still
// mutate the parent. Recheck mail.triage on the parent when it would be marked done.
async function assertScheduledSendReplyParentTriage(
  job: QueuedJob,
  actor: MailAccessActor,
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailAccess' | 'mailResourceLookup'>>,
): Promise<void> {
  if (job.type !== 'mail.send.scheduled') return;
  if (!ports.mailResourceLookup.resolveScheduledDraftReplyParent) return;
  const draftId = optionalPositiveInt(job.payload.draftId);
  if (draftId === null) return;
  const info = await ports.mailResourceLookup.resolveScheduledDraftReplyParent({
    workspaceId: job.workspaceId,
    draftId,
  });
  if (!info || info.replyParentMessageId === null || !info.markParentDone) return;
  const parent = await ports.mailResourceLookup.resolve({
    workspaceId: job.workspaceId,
    target: { kind: 'message', id: info.replyParentMessageId },
  });
  // The reply parent is an exact stored foreign key that must resolve to exactly
  // one message. The id-or-source resolver returns [] when the id is ambiguous
  // with another message's source_sqlite_id (imported-id collision); finalization
  // still marks the exact FK parent done, so fail closed rather than skip the
  // triage recheck and let a send-only delegate mutate an unverified parent.
  if (parent.length !== 1) throw new MailAsyncAuthorizationError();
  for (const resource of parent) {
    await ports.mailAccess.assertPermission({
      workspaceId: job.workspaceId,
      actor,
      permission: 'mail.triage',
      resource,
    });
  }
}

async function assertScheduledSendDraftAndAttachmentAccess(
  job: QueuedJob,
  actor: MailAccessActor,
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailAccess' | 'mailResourceLookup'>>,
): Promise<void> {
  if (job.type !== 'mail.send.scheduled') return;
  const draftId = optionalPositiveInt(job.payload.draftId);
  if (draftId === null) return;

  // A scheduled send transmits the STORED draft's body + recipients through the
  // system-backed sender, so arming/executing it is a draft MUTATION, not merely a
  // transmit. The base mail.send.scheduled policy only rechecks mail.send, so a
  // send-only delegate who scheduled (or whose scheduled job re-runs) another user's
  // draft would send content they cannot edit. Recheck mail.draft.edit on the draft
  // UNCONDITIONALLY here — mirroring the HTTP compose/send + scheduled-send supplemental
  // — which catches an attachmentless draft AND a draft.edit revoked after scheduling;
  // draft-local uploads are covered by this same assertion. The draft is an exact
  // stored id that must resolve to its message resource; fail closed otherwise.
  const draftResources = await ports.mailResourceLookup.resolve({
    workspaceId: job.workspaceId,
    target: { kind: 'message', id: draftId },
  });
  if (draftResources.length === 0) throw new MailAsyncAuthorizationError();
  for (const resource of draftResources) {
    await ports.mailAccess.assertPermission({
      workspaceId: job.workspaceId,
      actor,
      permission: 'mail.draft.edit',
      resource,
    });
  }

  // Each NON-draft-local attachment path must additionally resolve to an existing
  // message attachment the sender still holds mail.attachment.read on. A draft-local
  // upload (under this draft's own folder) has no email_message_attachments row, so it
  // resolves to no message resource and cannot be checked for attachment.read — it is
  // already authorized by the mail.draft.edit assertion above.
  if (!ports.mailResourceLookup.resolveScheduledDraftAttachmentPaths) return;
  const paths = await ports.mailResourceLookup.resolveScheduledDraftAttachmentPaths({
    workspaceId: job.workspaceId,
    draftId,
  });
  if (!paths || paths.length === 0) return;
  const draftLocalPrefix = `${job.workspaceId}/compose-drafts/${draftId}/`;
  for (const path of paths) {
    if (path.startsWith(draftLocalPrefix) && !path.split('/').includes('..')) continue;
    const owners = await ports.mailResourceLookup.resolve({
      workspaceId: job.workspaceId,
      target: { kind: 'attachment_path', path },
    });
    if (owners.length === 0) throw new MailAsyncAuthorizationError();
    for (const resource of owners) {
      await ports.mailAccess.assertPermission({
        workspaceId: job.workspaceId,
        actor,
        permission: 'mail.attachment.read',
        resource,
      });
    }
  }
}

// Reconstruct the binding's account/folder MailResource from a sanitized
// email_acl.changed payload so the filter can authorize a scoped delegation
// manager against it. Returns null when the tombstone carried no resource.
function mailDelegationResourceFromEventPayload(payload: Record<string, unknown>): MailResource | null {
  const { resourceType, accountId, folderId } = payload;
  if (typeof accountId !== 'number' && typeof accountId !== 'string') return null;
  const account = String(accountId);
  if (resourceType === 'account') return { type: 'account', accountId: account };
  if (resourceType === 'folder') {
    if (typeof folderId !== 'number' && typeof folderId !== 'string') return null;
    return { type: 'folder', accountId: account, folderId: String(folderId) };
  }
  return null;
}

export async function filterMailEventForPrincipal(
  event: ServerEvent,
  context: MailEventFilterContext,
): Promise<ServerEvent | null> {
  if (event.type === 'email_acl.changed') {
    const sanitized = sanitizeMailEventPayload(event);
    // Deliver to the affected subject, to owners/admins, AND to a non-admin
    // mail.delegation.manage holder scoped to the binding's resource (when the
    // payload carries it) — their delegation panel otherwise stays stale and can
    // revert a peer's newer edit. The sanitized payload carries only
    // bindingId/targetUserId/state (+ the binding's account/folder), all enumerable
    // by an owner/admin or by a manager already authorized on that resource, so this
    // leaks nothing. Resource-less events (delete/empty-replace, group-membership,
    // demotion) carry no resource and stay subject / owner-admin only.
    if (context.principal.role === 'owner' || context.principal.role === 'admin') return sanitized;
    if (sanitized.payload.targetUserId === context.principal.userId) return sanitized;
    const resource = mailDelegationResourceFromEventPayload(sanitized.payload);
    if (!resource || !context.ports.mailAccess) return null;
    try {
      await context.ports.mailAccess.assertPermission({
        workspaceId: sanitized.workspaceId,
        actor: {
          workspaceId: context.principal.workspaceId,
          userId: context.principal.userId,
          isOwner: false,
          isAdmin: false,
        },
        permission: 'mail.delegation.manage',
        resource,
      });
      return sanitized;
    } catch (error) {
      if (isAccessDenied(error)) return null;
      throw error;
    }
  }
  const policy = mailEventPolicyOrNull(event.type);
  if (!policy) return SERVER_EVENT_TYPE_SET.has(event.type) ? event : null;
  const sanitized = sanitizeMailEventPayload(event);
  if (!context.ports.mailAccess || !context.ports.mailResourceLookup) return null;
  const requiredPorts = {
    ...context.ports,
    mailAccess: context.ports.mailAccess,
    mailResourceLookup: context.ports.mailResourceLookup,
  };

  const actor: MailAccessActor = {
    workspaceId: context.principal.workspaceId,
    userId: context.principal.userId,
    isOwner: context.principal.role === 'owner',
    isAdmin: context.principal.role === 'admin',
  };
  try {
    const resources = await resolveEventResources(sanitized, policy, requiredPorts);
    await assertResolvedResources({
      workspaceId: sanitized.workspaceId,
      actor,
      permission: policy.permission,
      resources,
      ports: requiredPorts,
    });
    return sanitized;
  } catch (error) {
    if (isAccessDenied(error)) return null;
    throw error;
  }
}

export function createPrincipalFilteredEventPort(
  port: ServerEventPort,
  context: MailEventFilterContext,
): ServerEventPort {
  return {
    async publish(event) {
      return port.publish(event);
    },
    subscribe: port.subscribe
      ? (subscriber) => port.subscribe!(async (event) => {
        const filtered = await filterMailEventForPrincipal(event, context);
        if (filtered) await subscriber(filtered);
      })
      : undefined,
    replay: port.replay
      ? async (input) => {
        const events = await port.replay!(input);
        const filtered: ServerEvent[] = [];
        for (const event of events) {
          const visible = await filterMailEventForPrincipal(event, context);
          if (visible) filtered.push(visible);
        }
        return filtered;
      }
      : undefined,
  };
}

type ResolvedJobActor =
  | Readonly<{ kind: 'user'; actor: MailAccessActor }>
  | Readonly<{ kind: 'service' }>;

async function resolveJobActor(
  job: QueuedJob,
  policy: Extract<ServerJobPolicyEntry, { kind: 'mail' }>,
  ports: MailAsyncPolicyPorts,
): Promise<ResolvedJobActor> {
  const actorUserId = stringScalar(job.payload.actorUserId);
  if (policy.actorMode === 'initiating_user') {
    if (!actorUserId) throw new MailAsyncAuthorizationError();
    return { kind: 'user', actor: await resolveUserActor(job.workspaceId, actorUserId, ports) };
  }
  if (policy.actorMode === 'initiating_user_or_service' && actorUserId) {
    return { kind: 'user', actor: await resolveUserActor(job.workspaceId, actorUserId, ports) };
  }
  if (
    (policy.actorMode === 'service' || policy.actorMode === 'initiating_user_or_service')
    && isTrustedServiceJobPayload(job.payload)
  ) {
    return { kind: 'service' };
  }
  throw new MailAsyncAuthorizationError();
}

async function resolveUserActor(
  workspaceId: string,
  userId: string,
  ports: MailAsyncPolicyPorts,
): Promise<MailAccessActor> {
  // Prefer a workspace-scoped by-id lookup so authorizing one job does not scan the
  // entire workspace user list (O(user count) per job). Fall back to listUsers for
  // ports that don't expose getUser.
  const user = ports.auth?.getUser
    ? await ports.auth.getUser({ workspaceId, userId })
    : ports.auth?.listUsers
      ? (await ports.auth.listUsers({ workspaceId })).find((candidate) => candidate.id === userId) ?? null
      : undefined;
  if (user === undefined) throw new MailAsyncAuthorizationError();
  if (!user || user.disabledAt) throw new MailAsyncAuthorizationError();
  return {
    workspaceId,
    userId,
    isOwner: user.role === 'owner',
    isAdmin: user.role === 'admin',
  };
}

async function resolveJobResources(
  job: QueuedJob,
  policy: Extract<ServerJobPolicyEntry, { kind: 'mail' }>,
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailResourceLookup'>>,
): Promise<ResolvedJobResources> {
  const input = {
    resolution: policy.resource,
    workspaceId: job.workspaceId,
    ports,
    select: (selector) => selector.source === 'job' ? job.payload[selector.field] : undefined,
  } satisfies Parameters<typeof resolveResources>[0];
  if (policy.resource.kind === 'workflow_execute_message_lookup') {
    return resolveWorkflowExecuteResources(input, policy.resource);
  }
  return { resources: await resolveResources(input) };
}

async function resolveEventResources(
  event: ServerEvent,
  policy: MailEventPolicyEntry,
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailResourceLookup'>>,
): Promise<ResolvedResources> {
  return resolveResources({
    resolution: policy.resource,
    workspaceId: event.workspaceId,
    ports,
    select: (selector) => {
      if (selector.source === 'event') return eventField(event, selector.field);
      if (selector.source === 'event_payload') return event.payload[selector.field];
      return undefined;
    },
  });
}

async function resolveResources(input: {
  resolution: MailResourceResolution;
  workspaceId: string;
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailResourceLookup'>>;
  select(selector: PolicyValueSelector): unknown;
}): Promise<ResolvedResources> {
  const { resolution } = input;
  if (resolution.kind === 'mail_scope' || resolution.kind === 'workspace_global') {
    return { kind: 'scope' };
  }
  if (resolution.kind === 'owner_admin_only') return { kind: 'owner_admin' };
  if (resolution.kind === 'owner_admin_or_event_user') {
    const rawUserId = input.select(resolution.userId);
    // A missing owner id falls back to owner/admin-only rather than delivering to no
    // one — the event is still authorized for admins.
    return typeof rawUserId === 'string' && rawUserId.length > 0
      ? { kind: 'owner_admin_or_user', userId: rawUserId }
      : { kind: 'owner_admin' };
  }
  if (resolution.kind === 'event_message_pair') {
    const first = await lookup(input, { kind: 'message', id: requirePositiveInt(input.select(resolution.firstMessageId)) });
    const second = await lookup(input, { kind: 'message', id: requirePositiveInt(input.select(resolution.secondMessageId)) });
    return { kind: 'resources', resources: [...first.resources, ...second.resources], mode: 'all' };
  }
  if (resolution.kind === 'notice_lookup') return { kind: 'scope' };
  if (resolution.kind === 'optional_account') {
    const raw = input.select(resolution.accountId);
    if (raw === undefined || raw === null) {
      return resolution.whenAbsent === 'owner_admin' ? { kind: 'owner_admin' } : { kind: 'scope' };
    }
    return lookup(input, { kind: 'account', id: requirePositiveInt(raw) });
  }
  if (resolution.kind === 'optional_message_lookup') {
    const raw = input.select(resolution.messageId);
    if (raw === undefined) {
      if (resolution.whenAbsent === 'non_mail') return { kind: 'non_mail' };
      if (resolution.whenAbsent === 'mail_scope') return { kind: 'scope' };
      throw new MailAsyncAuthorizationError();
    }
    if (raw === null && resolution.whenNull === 'non_mail') {
      // An orphaned mail job/event nulls message_id (FK ON DELETE SET NULL) but keeps
      // message_source_sqlite_id: it is still MAIL, so classifying it non_mail would
      // broadcast its workflow/message metadata to every workspace subscriber. Mirror
      // the HTTP read path's classifyWorkflowDelayedJob (non_mail only when BOTH refs
      // are null) — a surviving message_source_sqlite_id fails closed to owner/admin.
      const legacyId = resolution.messageSourceSqliteId !== undefined
        ? input.select(resolution.messageSourceSqliteId)
        : null;
      return legacyId === null || legacyId === undefined
        ? { kind: 'non_mail' }
        : { kind: 'owner_admin' };
    }
    return lookup(input, { kind: 'message', id: requirePositiveInt(raw) });
  }
  if (resolution.kind === 'workflow_execute_message_lookup') {
    return (await resolveWorkflowExecuteResources(input, resolution)).resources;
  }
  if (resolution.kind === 'message_or_account_lookup') {
    // An account-only record carries messageId absent OR explicitly null; treat
    // both the same and fall back to the account.
    const message = input.select(resolution.messageId);
    if (message !== undefined && message !== null) return lookup(input, { kind: 'message', id: requirePositiveInt(message) });
    const account = input.select(resolution.accountId);
    if (account !== undefined && account !== null) return lookup(input, { kind: 'account', id: requirePositiveInt(account) });
    if (resolution.whenAbsent === 'deny') throw new MailAsyncAuthorizationError();
    return { kind: 'scope' };
  }
  if (resolution.kind === 'event_message_then_account_lookup') {
    // Account-only spam events publish messageId: null with a valid accountId;
    // null must fall back to the account, not throw requirePositiveInt(null).
    const message = input.select(resolution.messageId);
    if (message !== undefined && message !== null) return lookup(input, { kind: 'message', id: requirePositiveInt(message) });
    const account = input.select(resolution.accountId);
    if (account !== undefined && account !== null) return lookup(input, { kind: 'account', id: requirePositiveInt(account) });
    throw new MailAsyncAuthorizationError();
  }
  if (resolution.kind === 'bulk_message_lookup') {
    throw new MailAsyncAuthorizationError();
  }
  // canned_response_lookup is HTTP-only (autosave/reset of a canned override).
  // No event or job resolves it — canned-response events use optional_account
  // (account-scoped rows authorize against their account, global templates fall
  // to the workspace-global scope) — so fail closed here rather than fall through
  // to the metadata builder.
  if (resolution.kind === 'canned_response_lookup') {
    throw new MailAsyncAuthorizationError();
  }

  let target: MailResourceLookupTarget;
  if (resolution.kind === 'account') {
    target = { kind: 'account', id: requirePositiveInt(input.select(resolution.accountId)) };
  } else if (resolution.kind === 'folder_lookup') {
    target = { kind: 'folder', id: requirePositiveInt(input.select(resolution.folderId)) };
  } else if (resolution.kind === 'message_lookup') {
    target = { kind: 'message', id: requirePositiveInt(input.select(resolution.messageId)) };
  } else if (resolution.kind === 'attachment_lookup') {
    target = { kind: 'attachment', id: requirePositiveInt(input.select(resolution.attachmentId)) };
  } else if (resolution.kind === 'thread_lookup') {
    target = { kind: 'thread', id: requireThreadId(input.select(resolution.threadId)) };
  } else {
    target = {
      kind: 'metadata',
      entity: resolution.entity,
      id: resolution.entity === 'account_signature'
        ? requireNonZeroInt(input.select(resolution.id))
        : requirePositiveInt(input.select(resolution.id)),
    };
  }
  const result = await lookup(input, target);
  return resolution.kind === 'thread_lookup' ? { ...result, mode: 'any' } : result;
}

async function resolveWorkflowExecuteResources(
  input: {
    workspaceId: string;
    ports: Required<Pick<MailAsyncPolicyPorts, 'mailResourceLookup'>>;
    select(selector: PolicyValueSelector): unknown;
  },
  resolution: Extract<MailResourceResolution, { kind: 'workflow_execute_message_lookup' }>,
): Promise<ResolvedJobResources> {
  const rawMessageId = input.select(resolution.messageId);
  const messageId = rawMessageId === undefined ? undefined : requirePositiveInt(rawMessageId);
  const rawDelayedJobId = input.select(resolution.delayedJobId);
  if (rawDelayedJobId === undefined) {
    return {
      resources: messageId === undefined
        ? { kind: 'non_mail' }
        : await lookup(input, { kind: 'message', id: messageId }),
    };
  }

  const delayedJobId = requirePositiveInt(rawDelayedJobId);
  const classify = input.ports.mailResourceLookup.classifyWorkflowDelayedJob;
  if (!classify) throw new MailAsyncAuthorizationError();
  const classification = await classify({
    workspaceId: input.workspaceId,
    delayedJobId,
  });
  if (classification.kind === 'missing' || classification.kind === 'invalid') {
    throw new MailAsyncAuthorizationError();
  }
  if (classification.kind === 'non_mail') {
    if (messageId !== undefined) throw new MailAsyncAuthorizationError();
    return {
      resources: { kind: 'non_mail' },
      authorization: {
        kind: 'workflow_execute_delayed_message',
        delayedJobId,
        messageId: null,
      },
    };
  }
  if (
    messageId !== undefined
    && classification.resource.messageId !== String(messageId)
  ) {
    throw new MailAsyncAuthorizationError();
  }
  return {
    resources: { kind: 'resources', resources: [classification.resource], mode: 'all' },
    authorization: {
      kind: 'workflow_execute_delayed_message',
      delayedJobId,
      messageId: requirePositiveInt(classification.resource.messageId),
    },
  };
}

async function lookup(
  input: {
    workspaceId: string;
    ports: Required<Pick<MailAsyncPolicyPorts, 'mailResourceLookup'>>;
  },
  target: MailResourceLookupTarget,
): Promise<Readonly<{ kind: 'resources'; resources: readonly MailResource[]; mode: 'all' }>> {
  const resources = await input.ports.mailResourceLookup.resolve({ workspaceId: input.workspaceId, target });
  if (resources.length === 0) throw new MailAsyncAuthorizationError();
  return { kind: 'resources', resources, mode: 'all' };
}

async function assertResolvedResources(input: {
  workspaceId: string;
  actor: MailAccessActor;
  permission: MailEventPolicyEntry['permission'] | Extract<ServerJobPolicyEntry, { kind: 'mail' }>['permission'];
  resources: ResolvedResources;
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailAccess'>>;
}): Promise<void> {
  if (input.resources.kind === 'non_mail') return;
  if (input.resources.kind === 'owner_admin') {
    if (!input.actor.isOwner && !input.actor.isAdmin) throw new MailAsyncAuthorizationError();
    return;
  }
  if (input.resources.kind === 'owner_admin_or_user') {
    if (!input.actor.isOwner && !input.actor.isAdmin && input.actor.userId !== input.resources.userId) {
      throw new MailAsyncAuthorizationError();
    }
    return;
  }
  if (input.resources.kind === 'scope') {
    const scope = await input.ports.mailAccess.resolveScope({
      workspaceId: input.workspaceId,
      actor: input.actor,
      permission: input.permission,
    });
    if (scope.kind === 'none') throw new MailAsyncAuthorizationError();
    return;
  }
  if (input.resources.mode === 'any') {
    for (const resource of input.resources.resources) {
      try {
        await input.ports.mailAccess.assertPermission({
          workspaceId: input.workspaceId,
          actor: input.actor,
          permission: input.permission,
          resource,
        });
        return;
      } catch (error) {
        if (!isAccessDenied(error)) throw error;
      }
    }
    throw new MailAsyncAuthorizationError();
  }
  for (const resource of input.resources.resources) {
    await input.ports.mailAccess.assertPermission({
      workspaceId: input.workspaceId,
      actor: input.actor,
      permission: input.permission,
      resource,
    });
  }
}

function mailEventPolicyOrNull(type: string): MailEventPolicyEntry | null {
  if (!MAIL_EVENT_POLICY_TYPES.has(type as never)) return null;
  try {
    return assertMailEventPolicy(type);
  } catch (error) {
    throw new MailAsyncAuthorizationError(error);
  }
}

export function sanitizeMailEventPayload(event: ServerEvent): ServerEvent {
  if (event.type === 'email_acl.changed') {
    const payload: Record<string, unknown> = {};
    for (const key of EVENT_PAYLOAD_ALLOWLIST[event.type]) {
      const value = event.payload[key];
      if (isAllowedPayloadScalar(value)) payload[key] = value;
    }
    return { ...event, payload };
  }
  if (!mailEventPolicyOrNull(event.type)) return event;
  const allowed = EVENT_PAYLOAD_ALLOWLIST[event.type] ?? [];
  const payload: Record<string, unknown> = {};
  for (const key of allowed) {
    const value = event.payload[key];
    if (isAllowedPayloadScalar(value)) payload[key] = value;
  }
  return { ...event, payload };
}

function assertServiceResources(resources: ResolvedResources): void {
  if (resources.kind === 'resources' && resources.resources.length > 0) return;
  if (resources.kind === 'scope') return;
  throw new MailAsyncAuthorizationError();
}

function eventField(event: ServerEvent, field: string): unknown {
  if (field === 'entityId') return event.entityId;
  if (field === 'workspaceId') return event.workspaceId;
  return undefined;
}

function stringScalar(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function requirePositiveInt(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new MailAsyncAuthorizationError();
  return parsed;
}

// Non-throwing variant for supplemental job checks: a malformed/absent id skips
// the supplemental (the base policy still applies) rather than denying the job.
function optionalPositiveInt(value: unknown): number | null {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^[1-9]\d*$/.test(value)
      ? Number(value)
      : Number.NaN;
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function requireNonZeroInt(value: unknown): number {
  const parsed = typeof value === 'number'
    ? value
    : typeof value === 'string' && /^-?[1-9]\d*$/.test(value)
      ? Number(value)
      : Number.NaN;
  if (!Number.isSafeInteger(parsed) || parsed === 0) throw new MailAsyncAuthorizationError();
  return parsed;
}

function requireThreadId(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9._:-]{1,255}$/.test(value)) {
    throw new MailAsyncAuthorizationError();
  }
  return value;
}

function isAllowedPayloadScalar(value: unknown): boolean {
  return (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
    || value === null
  );
}

function isAccessDenied(error: unknown): boolean {
  return error instanceof MailAccessDeniedError
    || error instanceof MailAsyncAuthorizationError
    || (error instanceof Error && (
      error.message === 'mail_access_denied'
      || (error as { code?: string }).code === 'mail_access_denied'
    ));
}
