import {
  buildGraphileTaskList,
  buildTrustedServiceJobPayload,
  type JobHandlerRegistry,
  type QueuedJob,
  SERVER_JOB_POLICIES,
  TRUSTED_SERVICE_JOB_MARKER_FIELD,
} from '../../packages/server/src/jobs';
import type { ServerEvent } from '../../packages/server/src/api';
import {
  enforceMailJobPolicy,
  filterMailEventForPrincipal,
} from '../../packages/server/src/mail-access/async-policy-enforcer';
import { createBoundedEventSequenceDedupe } from '../../packages/server/src/api/fastify-adapter';

describe('server mail job and event ACL', () => {
  test('graphile task-list treats revoked mail authorization as terminal success before handler invocation', async () => {
    const calls: string[] = [];
    const taskList = buildGraphileTaskList(
      {
        'ai.reply_suggestion': async () => {
          calls.push('handler');
        },
      } satisfies JobHandlerRegistry,
      {
        mailAccess: {
          async assertPermission() {
            throw new Error('mail_access_denied');
          },
          async resolveScope() {
            return { kind: 'none' };
          },
        },
        mailResourceLookup: {
          async resolve() {
            return [{ type: 'message', accountId: '7', folderId: '8', messageId: '12' }];
          },
        },
      },
    );
    const queries: Array<{ sql: string; values?: readonly unknown[] }> = [];
    const helpers = {
      job: { id: 'graphile-job-99' },
      withPgClient: async (callback: (client: {
        query(sql: string, values?: readonly unknown[]): Promise<unknown>;
      }) => Promise<unknown>) => callback({
        async query(sql, values) {
          queries.push({ sql, values });
          return { rows: [] };
        },
      }),
    };

    await expect(taskList['ai.reply_suggestion']?.(
      { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
      helpers as never,
    )).resolves.toBeUndefined();
    await expect(taskList['ai.reply_suggestion']?.(
      { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
      helpers as never,
    )).resolves.toBeUndefined();

    expect(calls).toEqual([]);
    expect(queries).toEqual([]);
  });

  test('job actor modes fail closed for missing deleted disabled actors and only accept canonical service payloads', async () => {
    const ports = makePolicyPorts();

    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', messageId: 12 },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });

    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', actorUserId: 'deleted-user', messageId: 12 },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });

    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', actorUserId: 'disabled-user', messageId: 12 },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });

    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), { ...ports, auth: undefined })).rejects.toMatchObject({ nonRetryable: true });

    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', actorKind: 'service', messageId: 12 },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });

    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', principal: 'simplecrm:service', messageId: 12 },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });

    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', [TRUSTED_SERVICE_JOB_MARKER_FIELD]: 'forged', messageId: 12 },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });

    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a', messageId: 12 }),
    }), ports)).resolves.toBeUndefined();

    expect(ports.assertions).toEqual([]);
  });

  test('job resource matrix resolves account message optional fallback message-or-account and mail-scope centrally', async () => {
    const ports = makePolicyPorts();

    await enforceMailJobPolicy(job({
      type: 'mail.sync.imap',
      payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a', accountId: 7 }),
    }), ports);
    await enforceMailJobPolicy(job({
      type: 'mail.spam.score',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), ports);
    await enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), ports);
    await enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a' },
    }), ports);
    await enforceMailJobPolicy(job({
      type: 'ai.agent',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a' },
    }), ports);
    await enforceMailJobPolicy(job({
      type: 'mail.send.scheduled',
      payload: { workspaceId: 'workspace-a', principal: 'simplecrm:service', draftId: 12, accountId: 7 },
    }), ports);
    await enforceMailJobPolicy(job({
      type: 'lock.cleanup',
      payload: { workspaceId: 'workspace-a' },
    }), ports);

    expect(ports.lookups).toEqual([
      { kind: 'account', id: 7 },
      { kind: 'message', id: 12 },
      { kind: 'message', id: 12 },
      { kind: 'message', id: 12 },
    ]);
    expect(ports.assertions.map((entry) => [entry.permission, entry.resource])).toEqual([
      ['mail.triage', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
      ['mail.content.read', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
    ]);
    expect(ports.scopePermissions).toEqual([]);
  });

  test('service jobs are allowed only through narrow policy resources without mail grants', async () => {
    const ports = makePolicyPorts({ denyAllMailAccess: true });

    await expect(enforceMailJobPolicy(job({
      type: 'mail.sync.imap',
      payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a', accountId: 7 }),
    }), ports)).resolves.toBeUndefined();
    await expect(enforceMailJobPolicy(job({
      type: 'mail.vacation.auto_reply',
      payload: { workspaceId: 'workspace-a', messageId: 12 },
    }), ports)).resolves.toBeUndefined();
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.dmarc_ingest',
      payload: { workspaceId: 'workspace-a', messageId: 12 },
    }), ports)).resolves.toBeUndefined();
    await expect(enforceMailJobPolicy(job({
      type: 'mail.send.scheduled',
      payload: { workspaceId: 'workspace-a', draftId: 12, accountId: 7 },
    }), ports)).resolves.toBeUndefined();
    await expect(enforceMailJobPolicy(job({
      type: 'lock.cleanup',
      payload: { workspaceId: 'workspace-a' },
    }), ports)).resolves.toBeUndefined();

    expect(ports.assertions).toEqual([]);
    expect(ports.scopePermissions).toEqual([]);
    await expect(enforceMailJobPolicy(job({
      type: 'mail.vacation.auto_reply',
      payload: { workspaceId: 'workspace-a', messageId: 9999 },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });
  });

  test('inventories initiating mail job policies so every producer has user or trusted-service provenance', () => {
    const initiating = SERVER_JOB_POLICIES
      .filter((entry) => entry.actorMode === 'initiating_user' || entry.actorMode === 'initiating_user_or_service')
      .map((entry) => entry.type)
      .sort();

    expect(initiating).toEqual([
      'ai.agent',
      'ai.classify',
      'ai.pick_canned',
      'ai.reply_suggestion',
      'ai.review',
      'ai.transform_text',
      'mail.spam.score',
      'mail.sync.imap',
      'mail.sync.pop3',
      'workflow.execute',
      'workflow.forward_copy',
      'workflow.http_request',
    ]);
  });

  test('event filter accepts canonical non-mail, denies unknown runtime types, and allows negative account-signature source ids', async () => {
    const ports = makePolicyPorts();
    const context = {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' as const },
      ports,
    };

    await expect(filterMailEventForPrincipal(event({
      type: 'customer.updated',
      entityType: 'customer',
      entityId: 'customer-1',
    }), context)).resolves.toMatchObject({ type: 'customer.updated' });

    await expect(filterMailEventForPrincipal(event({
      type: 'email_secret.leaked',
      entityType: 'email_message',
      entityId: '12',
    }) as ServerEvent, context)).resolves.toBeNull();

    await expect(filterMailEventForPrincipal(event({
      type: 'email_account_signature.updated',
      entityType: 'email_account_signature',
      entityId: '-71',
      payload: { accountId: 7, signatureId: -71 },
    }), context)).resolves.toMatchObject({
      type: 'email_account_signature.updated',
      entityId: '-71',
      payload: { accountId: 7, signatureId: -71 },
    });

    expect(ports.lookups).toContainEqual({ kind: 'metadata', entity: 'account_signature', id: -71 });
  });

  test('ACL invalidation events are target-user only and sanitized before live or replay delivery', async () => {
    const ports = makePolicyPorts();
    const aclEvent = event({
      type: 'email_acl.changed',
      entityType: 'email_acl',
      entityId: '901',
      payload: {
        bindingId: 901,
        targetUserId: 'user-a',
        state: 'deleted',
        email: 'hidden@example.test',
        body: 'hidden',
        filename: 'hidden.pdf',
      },
    });

    await expect(filterMailEventForPrincipal(aclEvent, {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' as const },
      ports,
    })).resolves.toMatchObject({
      type: 'email_acl.changed',
      entityType: 'email_acl',
      payload: { bindingId: 901, targetUserId: 'user-a', state: 'deleted' },
    });

    await expect(filterMailEventForPrincipal(aclEvent, {
      principal: { workspaceId: 'workspace-a', userId: 'user-b', role: 'admin' as const },
      ports,
    })).resolves.toBeNull();
  });

  test('event resource matrix covers account message metadata edge parents thread any spam fallback deny and workspace-global', async () => {
    const ports = makePolicyPorts({ denyMessages: new Set(['101']) });
    const context = {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' as const },
      ports,
    };

    await expect(filterMailEventForPrincipal(event({
      type: 'email_account.updated',
      entityType: 'email_account',
      entityId: '7',
      payload: { accountId: 7 },
    }), context)).resolves.toMatchObject({ type: 'email_account.updated' });
    await expect(filterMailEventForPrincipal(event({
      type: 'email_message.updated',
      entityType: 'email_message',
      entityId: '12',
      payload: { messageId: 12 },
    }), context)).resolves.toMatchObject({ type: 'email_message.updated' });
    await expect(filterMailEventForPrincipal(event({
      type: 'email_thread_edge.created',
      entityType: 'email_thread_edge',
      entityId: '55',
      payload: { parentMessageId: 12, childMessageId: 13 },
    }), context)).resolves.toMatchObject({ type: 'email_thread_edge.created' });
    await expect(filterMailEventForPrincipal(event({
      type: 'email_thread.updated',
      entityType: 'email_thread',
      entityId: 'thread-7',
      payload: { threadId: 'thread-7' },
    }), context)).resolves.toMatchObject({ type: 'email_thread.updated' });
    await expect(filterMailEventForPrincipal(event({
      type: 'spam_decision.created',
      entityType: 'spam_decision',
      entityId: '66',
      payload: { messageId: 101, accountId: 7 },
    }), context)).resolves.toBeNull();
    await expect(filterMailEventForPrincipal(event({
      type: 'spam_decision.created',
      entityType: 'spam_decision',
      entityId: '67',
      payload: { accountId: 7 },
    }), context)).resolves.toMatchObject({ type: 'spam_decision.created' });
    await expect(filterMailEventForPrincipal(event({
      type: 'spam_decision.created',
      entityType: 'spam_decision',
      entityId: '68',
      payload: {},
    }), context)).resolves.toBeNull();
    await expect(filterMailEventForPrincipal(event({
      type: 'email_category.updated',
      entityType: 'email_category',
      entityId: '5',
      payload: { state: 'renamed' },
    }), context)).resolves.toMatchObject({ type: 'email_category.updated' });

    expect(ports.assertions.map((entry) => entry.resource)).toEqual(expect.arrayContaining([
      { type: 'account', accountId: '7' },
      { type: 'message', accountId: '7', folderId: '8', messageId: '12' },
      { type: 'message', accountId: '7', folderId: '8', messageId: '13' },
    ]));
    expect(ports.scopePermissions).toContain('mail.metadata.read');
  });

  test('websocket replay/live dedupe keeps a bounded ordered window', () => {
    const dedupe = createBoundedEventSequenceDedupe(3);

    dedupe.add(10);
    dedupe.add(11);
    dedupe.add(12);
    dedupe.add(12);
    expect(dedupe.size()).toBe(3);
    expect(dedupe.has(12)).toBe(true);

    dedupe.add(13);
    dedupe.add(14);
    expect(dedupe.size()).toBe(3);
    expect(dedupe.has(10)).toBe(false);
    expect(dedupe.has(12)).toBe(true);
    expect(dedupe.has(13)).toBe(true);
    expect(dedupe.has(14)).toBe(true);
  });

  test('delayed-job events require source-message content access and sanitize live or replay payloads', async () => {
    const ports = makePolicyPorts({ denyMessages: new Set(['101']) });
    const context = {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' as const },
      ports,
    };

    await expect(filterMailEventForPrincipal(event({
      type: 'workflow_delayed_job.updated',
      entityType: 'workflow_delayed_job',
      entityId: '87',
      payload: {
        id: 87,
        messageId: 12,
        status: 'pending',
        context: { secret: 'hidden' },
        resumeNodeId: 'wait-1',
      },
    }), context)).resolves.toMatchObject({
      type: 'workflow_delayed_job.updated',
      payload: {
        id: 87,
        messageId: 12,
        status: 'pending',
        resumeNodeId: 'wait-1',
      },
    });

    await expect(filterMailEventForPrincipal(event({
      type: 'workflow_delayed_job.updated',
      entityType: 'workflow_delayed_job',
      entityId: '88',
      payload: { id: 88, messageId: 101, status: 'pending' },
    }), context)).resolves.toBeNull();

    await expect(filterMailEventForPrincipal(event({
      type: 'workflow_delayed_job.updated',
      entityType: 'workflow_delayed_job',
      entityId: '89',
      payload: { id: 89, messageId: null, status: 'pending', context: { secret: 'non-mail' } },
    }), context)).resolves.toMatchObject({
      type: 'workflow_delayed_job.updated',
      payload: { id: 89, messageId: null, status: 'pending' },
    });

    expect(ports.assertions.map((entry) => [entry.permission, entry.resource])).toEqual(expect.arrayContaining([
      ['mail.content.read', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
    ]));
  });
});

function makePolicyPorts(options: { denyAllMailAccess?: boolean; denyMessages?: ReadonlySet<string> } = {}) {
  const lookups: unknown[] = [];
  const assertions: Array<{ permission: string; resource: unknown; actor: unknown }> = [];
  const scopePermissions: string[] = [];
  return {
    lookups,
    assertions,
    scopePermissions,
    auth: {
      async listUsers() {
        return [
          { id: 'user-a', role: 'user' as const, disabledAt: null },
          { id: 'owner-a', role: 'owner' as const, disabledAt: null },
          { id: 'disabled-user', role: 'user' as const, disabledAt: '2026-07-19T10:00:00.000Z' },
        ];
      },
    },
    mailAccess: {
      async assertPermission(input: { permission: string; resource: unknown; actor: unknown }) {
        if (options.denyAllMailAccess) throw new Error('mail_access_denied');
        if (
          typeof input.resource === 'object'
          && input.resource !== null
          && (input.resource as { type?: unknown }).type === 'message'
          && options.denyMessages?.has(String((input.resource as { messageId?: unknown }).messageId))
        ) {
          throw new Error('mail_access_denied');
        }
        assertions.push(input);
      },
      async resolveScope(input: { permission: string }) {
        if (options.denyAllMailAccess) throw new Error('mail_access_denied');
        scopePermissions.push(input.permission);
        return { kind: 'restricted' as const, accountIds: [7], folderIds: [], messageIds: [] };
      },
    },
    mailResourceLookup: {
      async resolve(input: { target: { kind: string; id: number | string; entity?: string } }) {
        lookups.push(input.target);
        if (input.target.kind === 'account' && input.target.id === 7) {
          return [{ type: 'account' as const, accountId: '7' }];
        }
        if (input.target.kind === 'message' && [12, 13, 101].includes(Number(input.target.id))) {
          return [{ type: 'message' as const, accountId: '7', folderId: '8', messageId: String(input.target.id) }];
        }
        if (input.target.kind === 'metadata' && input.target.entity === 'account_signature' && input.target.id === -71) {
          return [{ type: 'account' as const, accountId: '7' }];
        }
        if (input.target.kind === 'metadata' && input.target.entity === 'thread_edge' && input.target.id === 55) {
          return [
            { type: 'message' as const, accountId: '7', folderId: '8', messageId: '12' },
            { type: 'message' as const, accountId: '7', folderId: '8', messageId: '13' },
          ];
        }
        if (input.target.kind === 'thread' && input.target.id === 'thread-7') {
          return [
            { type: 'message' as const, accountId: '7', folderId: '8', messageId: '101' },
            { type: 'message' as const, accountId: '7', folderId: '8', messageId: '12' },
          ];
        }
        return [];
      },
    },
  };
}

function event(input: {
  type: string;
  entityType: string;
  entityId: string;
  payload?: Record<string, unknown>;
}): ServerEvent {
  return {
    sequence: 1,
    type: input.type as ServerEvent['type'],
    workspaceId: 'workspace-a',
    entityType: input.entityType as ServerEvent['entityType'],
    entityId: input.entityId,
    actorUserId: 'actor-a',
    occurredAt: '2026-07-19T10:00:00.000Z',
    payload: input.payload ?? {},
  };
}

function job(input: {
  type: string;
  payload: Record<string, unknown>;
  workspaceId?: string;
}): QueuedJob {
  return {
    id: 1,
    type: input.type,
    payload: input.payload,
    runAfter: '2026-07-19T10:00:00.000Z',
    attempts: 0,
    maxAttempts: 5,
    lockedAt: null,
    lockedBy: 'worker-a',
    lastError: null,
    workspaceId: input.workspaceId ?? 'workspace-a',
    createdAt: '2026-07-19T10:00:00.000Z',
    updatedAt: '2026-07-19T10:00:00.000Z',
  };
}
