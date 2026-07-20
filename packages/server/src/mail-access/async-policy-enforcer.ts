import type { MailResource } from '@simplecrm/core';
import { workflowGraphHasSideEffectNode } from '@simplecrm/core';

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
  | Readonly<{ kind: 'resources'; resources: readonly MailResource[]; mode: 'all' | 'any' }>;

type ResolvedJobResources = Readonly<{
  resources: ResolvedResources;
  authorization?: MailJobAuthorization;
}>;

const MAIL_EVENT_POLICY_TYPES = new Set(MAIL_EVENT_POLICY_MANIFEST.map((entry) => entry.type));
const SERVER_EVENT_TYPE_SET = new Set<string>(SERVER_EVENT_TYPES);

const EVENT_PAYLOAD_ALLOWLIST: Readonly<Record<string, readonly string[]>> = Object.freeze({
  'email_acl.changed': ['bindingId', 'targetUserId', 'state'],
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
  }
  const resolved = await resolveJobResources(job, policy, requiredPorts);
  if (resolved.resources.kind === 'non_mail') return resolved.authorization;
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
    // Reply generation reads the message body and sends it to the AI provider, so
    // the base mail.draft.create is not enough — also require mail.content.read.
    if (job.type === 'ai.reply_suggestion' && resolved.resources.kind === 'resources') {
      for (const resource of resolved.resources.resources) {
        await requiredPorts.mailAccess.assertPermission({
          workspaceId: job.workspaceId,
          actor: actor.actor,
          permission: 'mail.content.read',
          resource,
        });
      }
    }
    return resolved.authorization;
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
// (forward_copy = SMTP send, ai.classify = message tag) DO get a per-message ACL
// check, but that verifies only mail.export / mail.triage — NOT the admin the graph
// required — so a demoted admin who retains those grants would still run the effect.
// (ai.reply_suggestion is excluded: it has a direct user route and is read-only.)
const WORKFLOW_CHILD_SIDE_EFFECT_JOB_TYPES: ReadonlySet<string> = new Set([
  'workflow.http_request',
  'ai.agent',
  'ai.pick_canned',
  'ai.review',
  'ai.transform_text',
  'workflow.forward_copy',
  'ai.classify',
]);

// R12-2/R13-1: re-deny a non-owner/admin actor for any workflow side-effect child —
// this catches an initiator demoted between workflow.execute time and the child's
// execution, for both the message-less children (which otherwise hit the non_mail
// early return) and the message-scoped ones (whose per-message check does not
// re-establish admin). Trusted-service children (automatic/inbound runs) are
// actor.kind==='service' and never reach here.
function assertWorkflowChildSideEffectPrivilege(job: QueuedJob, actor: MailAccessActor): void {
  if (!WORKFLOW_CHILD_SIDE_EFFECT_JOB_TYPES.has(job.type)) return;
  if (actor.isOwner || actor.isAdmin) return;
  throw new MailAsyncAuthorizationError();
}

async function assertWorkflowExecuteSideEffectPrivilege(
  job: QueuedJob,
  actor: MailAccessActor,
  ports: Required<Pick<MailAsyncPolicyPorts, 'mailResourceLookup'>>,
): Promise<void> {
  if (job.type !== 'workflow.execute') return;
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
  for (const resource of parent) {
    await ports.mailAccess.assertPermission({
      workspaceId: job.workspaceId,
      actor,
      permission: 'mail.triage',
      resource,
    });
  }
}

export async function filterMailEventForPrincipal(
  event: ServerEvent,
  context: MailEventFilterContext,
): Promise<ServerEvent | null> {
  if (event.type === 'email_acl.changed') {
    const sanitized = sanitizeMailEventPayload(event);
    return sanitized.payload.targetUserId === context.principal.userId ? sanitized : null;
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
  if (!ports.auth?.listUsers) throw new MailAsyncAuthorizationError();
  const user = (await ports.auth.listUsers({ workspaceId })).find((candidate) => candidate.id === userId);
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
  if (resolution.kind === 'event_message_pair') {
    const first = await lookup(input, { kind: 'message', id: requirePositiveInt(input.select(resolution.firstMessageId)) });
    const second = await lookup(input, { kind: 'message', id: requirePositiveInt(input.select(resolution.secondMessageId)) });
    return { kind: 'resources', resources: [...first.resources, ...second.resources], mode: 'all' };
  }
  if (resolution.kind === 'notice_lookup') return { kind: 'scope' };
  if (resolution.kind === 'optional_account') {
    const raw = input.select(resolution.accountId);
    return raw === undefined || raw === null
      ? { kind: 'scope' }
      : lookup(input, { kind: 'account', id: requirePositiveInt(raw) });
  }
  if (resolution.kind === 'optional_message_lookup') {
    const raw = input.select(resolution.messageId);
    if (raw === undefined) {
      if (resolution.whenAbsent === 'non_mail') return { kind: 'non_mail' };
      if (resolution.whenAbsent === 'mail_scope') return { kind: 'scope' };
      throw new MailAsyncAuthorizationError();
    }
    if (raw === null && resolution.whenNull === 'non_mail') return { kind: 'non_mail' };
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
