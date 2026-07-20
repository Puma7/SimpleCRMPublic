import type { MailResource } from '@simplecrm/core';

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
    return resolved.authorization;
  } catch (error) {
    if (isAccessDenied(error)) throw new MailAsyncAuthorizationError(error);
    throw error;
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
    policy.actorMode === 'service'
    || (policy.actorMode === 'initiating_user_or_service' && isTrustedServiceJobPayload(job.payload))
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
  if (resolution.kind === 'notice_lookup') return { kind: 'scope' };
  if (resolution.kind === 'optional_account') {
    const raw = input.select(resolution.accountId);
    return raw === undefined
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
    const message = input.select(resolution.messageId);
    if (message !== undefined) return lookup(input, { kind: 'message', id: requirePositiveInt(message) });
    const account = input.select(resolution.accountId);
    if (account !== undefined) return lookup(input, { kind: 'account', id: requirePositiveInt(account) });
    return { kind: 'scope' };
  }
  if (resolution.kind === 'event_message_then_account_lookup') {
    const message = input.select(resolution.messageId);
    if (message !== undefined) return lookup(input, { kind: 'message', id: requirePositiveInt(message) });
    const account = input.select(resolution.accountId);
    if (account !== undefined) return lookup(input, { kind: 'account', id: requirePositiveInt(account) });
    throw new MailAsyncAuthorizationError();
  }
  if (resolution.kind === 'bulk_message_lookup') {
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
