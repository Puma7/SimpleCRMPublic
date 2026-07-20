import {
  buildGraphileTaskList,
  buildTrustedServiceJobPayload,
  type JobHandlerRegistry,
  type QueuedJob,
  SERVER_JOB_POLICIES,
  TRUSTED_SERVICE_JOB_MARKER_FIELD,
} from '../../packages/server/src/jobs';
import type { ServerEvent, ServerEventPort } from '../../packages/server/src/api';
import {
  createPrincipalFilteredEventPort,
  enforceMailJobPolicy,
  filterMailEventForPrincipal,
} from '../../packages/server/src/mail-access/async-policy-enforcer';
import { createBoundedEventSequenceDedupe } from '../../packages/server/src/api/fastify-adapter';

describe('server mail job and event ACL', () => {
  test('graphile task-list surfaces revoked mail authorization as a job failure before handler invocation', async () => {
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

    // The task must REJECT (not resolve): a resolved graphile task is treated as
    // success and deletes the job with no last_error, silently dropping the
    // side-effect. Rethrowing lets graphile retry / mark it permanently failed.
    await expect(taskList['ai.reply_suggestion']?.(
      { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
      helpers as never,
    )).rejects.toThrow();
    await expect(taskList['ai.reply_suggestion']?.(
      { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
      helpers as never,
    )).rejects.toThrow();

    expect(calls).toEqual([]);
    expect(queries).toEqual([]);
  });

  test('graphile task-list carries the authorized delayed message linkage to workflow execution', async () => {
    let handledJob: QueuedJob | null = null;
    const ports = makePolicyPorts({
      delayedJobs: new Map([[87, { kind: 'message', resource: messageResource(12) }]]),
    });
    const taskList = buildGraphileTaskList(
      {
        'workflow.execute': async (job) => { handledJob = job; },
      } satisfies JobHandlerRegistry,
      ports,
    );

    await expect(taskList['workflow.execute']?.({
      workspaceId: 'workspace-a',
      actorUserId: 'user-a',
      workflowId: 7,
      delayedJobId: 87,
    })).resolves.toBeUndefined();

    expect(handledJob).toMatchObject({
      mailAuthorization: {
        kind: 'workflow_execute_delayed_message',
        delayedJobId: 87,
        messageId: 12,
      },
    });
  });

  test('graphile task-list refuses scheduled send before handler when initiating actor is degranted', async () => {
    const calls: string[] = [];
    const taskList = buildGraphileTaskList(
      {
        'mail.send.scheduled': async () => {
          calls.push('handler');
        },
      } satisfies JobHandlerRegistry,
      makePolicyPorts({ denyAllMailAccess: true }),
    );

    // Rejects rather than silently resolving — the denial must be visible so the
    // scheduled send is retried / marked failed, not dropped without a trace.
    await expect(taskList['mail.send.scheduled']?.({
      workspaceId: 'workspace-a',
      actorUserId: 'user-a',
      draftId: 12,
      accountId: 7,
    })).rejects.toThrow();
    await expect(taskList['mail.send.scheduled']?.({
      workspaceId: 'workspace-a',
      actorUserId: 'disabled-user',
      draftId: 12,
      accountId: 7,
    })).rejects.toThrow();

    expect(calls).toEqual([]);
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
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', draftId: 12, accountId: 7 },
    }), ports);
    await enforceMailJobPolicy(job({
      type: 'lock.cleanup',
      payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a' }),
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
      ['mail.send', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
    ]);
    expect(ports.scopePermissions).toEqual([]);
  });

  test('workflow execution resolves delayed-job mail, rejects mismatches, and validates non-mail provenance', async () => {
    const ports = makePolicyPorts({
      denyMessages: new Set(['101']),
      delayedJobs: new Map([
        [87, { kind: 'message', resource: messageResource(12) }],
        [88, { kind: 'message', resource: messageResource(101) }],
        [89, { kind: 'non_mail' }],
      ]),
    });

    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', workflowId: 7, delayedJobId: 87 },
    }), ports)).resolves.toEqual({
      kind: 'workflow_execute_delayed_message',
      delayedJobId: 87,
      messageId: 12,
    });
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', workflowId: 7, delayedJobId: 88 },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: {
        workspaceId: 'workspace-a',
        actorUserId: 'user-a',
        workflowId: 7,
        messageId: 12,
        delayedJobId: 88,
      },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', workflowId: 7, delayedJobId: 999 },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', workflowId: 7, delayedJobId: 89 },
    }), ports)).resolves.toEqual({
      kind: 'workflow_execute_delayed_message',
      delayedJobId: 89,
      messageId: null,
    });
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: { workspaceId: 'workspace-a', workflowId: 7, delayedJobId: 89 },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a', workflowId: 7, delayedJobId: 88 }),
    }), ports)).resolves.toEqual({
      kind: 'workflow_execute_delayed_message',
      delayedJobId: 88,
      messageId: 101,
    });

    for (const delayedJobId of [null, '', 0, {}, false]) {
      await expect(enforceMailJobPolicy(job({
        type: 'workflow.execute',
        payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', workflowId: 7, delayedJobId },
      }), ports)).rejects.toMatchObject({ nonRetryable: true });
    }
    for (const messageId of [null, '', 0, {}, false]) {
      await expect(enforceMailJobPolicy(job({
        type: 'workflow.execute',
        payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', workflowId: 7, messageId },
      }), ports)).rejects.toMatchObject({ nonRetryable: true });
    }

    expect(ports.delayedJobLookups).toEqual([87, 88, 88, 999, 89, 88]);
  });

  test('formerly service-only mail jobs reject absent or forged provenance and accept only canonical service provenance', async () => {
    const ports = makePolicyPorts({ denyAllMailAccess: true });
    const servicePayloads = {
      'mail.vacation.auto_reply': { workspaceId: 'workspace-a', messageId: 12 },
      'workflow.dmarc_ingest': { workspaceId: 'workspace-a', messageId: 12, workflowId: 7 },
      'mail.send.scheduled': { workspaceId: 'workspace-a', draftId: 12, accountId: 7 },
      'lock.cleanup': { workspaceId: 'workspace-a' },
    } as const;

    for (const [type, payload] of Object.entries(servicePayloads)) {
      await expect(enforceMailJobPolicy(job({ type, payload }), ports))
        .rejects.toMatchObject({ nonRetryable: true });
      await expect(enforceMailJobPolicy(job({
        type,
        payload: { ...payload, [TRUSTED_SERVICE_JOB_MARKER_FIELD]: 'forged' },
      }), ports)).rejects.toMatchObject({ nonRetryable: true });
      await expect(enforceMailJobPolicy(job({
        type,
        payload: buildTrustedServiceJobPayload(payload),
      }), ports)).resolves.toBeUndefined();
    }

    expect(ports.assertions).toEqual([]);
    expect(ports.scopePermissions).toEqual([]);
    await expect(enforceMailJobPolicy(job({
      type: 'mail.vacation.auto_reply',
      payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a', messageId: 9999 }),
    }), ports)).rejects.toMatchObject({ nonRetryable: true });
  });

  test('vacation and DMARC jobs accept initiating actor provenance and recheck mail grants', async () => {
    const ports = makePolicyPorts();

    await expect(enforceMailJobPolicy(job({
      type: 'mail.vacation.auto_reply',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), ports)).resolves.toBeUndefined();
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.dmarc_ingest',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, workflowId: 7 },
    }), ports)).resolves.toBeUndefined();

    expect(ports.assertions.map((entry) => [entry.permission, entry.resource])).toEqual([
      ['mail.send', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
      ['mail.attachment.read', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
    ]);
  });

  test('inventories user-or-service mail job policies so every producer has user or trusted-service provenance', () => {
    const initiating = SERVER_JOB_POLICIES
      .filter((entry) => entry.kind === 'mail' && entry.actorMode !== 'service')
      .map((entry) => entry.type)
      .sort();

    expect(initiating).toEqual([
      'ai.agent',
      'ai.classify',
      'ai.pick_canned',
      'ai.reply_suggestion',
      'ai.review',
      'ai.transform_text',
      'mail.send.scheduled',
      'mail.spam.score',
      'mail.sync.imap',
      'mail.sync.pop3',
      'mail.vacation.auto_reply',
      'workflow.dmarc_ingest',
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

  test('deletion events authorize against the payload tombstone, not the vanished row', async () => {
    const ports = makePolicyPorts({ denyMessages: new Set(['101']) });
    const userContext = {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' as const },
      ports,
    };

    // Metadata deletions resolve the still-present parent from the payload.
    await expect(filterMailEventForPrincipal(event({
      type: 'email_message_tag.deleted',
      entityType: 'email_message_tag',
      entityId: '999',
      payload: { messageId: 12, tagId: 3 },
    }), userContext)).resolves.toMatchObject({ type: 'email_message_tag.deleted' });
    // ...but stay denied when the payload parent is inaccessible.
    await expect(filterMailEventForPrincipal(event({
      type: 'email_internal_note.deleted',
      entityType: 'email_internal_note',
      entityId: '998',
      payload: { messageId: 101, noteId: 4 },
    }), userContext)).resolves.toBeNull();
    await expect(filterMailEventForPrincipal(event({
      type: 'email_account_signature.deleted',
      entityType: 'email_account_signature',
      entityId: '997',
      payload: { accountId: 7, signatureId: 2 },
    }), userContext)).resolves.toMatchObject({ type: 'email_account_signature.deleted' });
    await expect(filterMailEventForPrincipal(event({
      type: 'email_thread_edge.deleted',
      entityType: 'email_thread_edge',
      entityId: '996',
      payload: { parentMessageId: 12, childMessageId: 13 },
    }), userContext)).resolves.toMatchObject({ type: 'email_thread_edge.deleted' });

    // The account itself is gone → owners/admins only.
    await expect(filterMailEventForPrincipal(event({
      type: 'email_account.deleted',
      entityType: 'email_account',
      entityId: '7',
      payload: { accountId: 7 },
    }), userContext)).resolves.toBeNull();
    const adminContext = {
      principal: { workspaceId: 'workspace-a', userId: 'admin-a', role: 'admin' as const },
      ports,
    };
    await expect(filterMailEventForPrincipal(event({
      type: 'email_account.deleted',
      entityType: 'email_account',
      entityId: '7',
      payload: { accountId: 7 },
    }), adminContext)).resolves.toMatchObject({ type: 'email_account.deleted' });
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

    for (const payload of [
      { id: 90, status: 'pending' },
      { id: 91, messageId: '', status: 'pending' },
      { id: 92, messageId: 0, status: 'pending' },
      { id: 93, messageId: {}, status: 'pending' },
      { id: 94, messageId: false, status: 'pending' },
    ]) {
      await expect(filterMailEventForPrincipal(event({
        type: 'workflow_delayed_job.updated',
        entityType: 'workflow_delayed_job',
        entityId: String(payload.id),
        payload,
      }), context)).resolves.toBeNull();
    }

    expect(ports.assertions.map((entry) => [entry.permission, entry.resource])).toEqual(expect.arrayContaining([
      ['mail.content.read', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
    ]));
  });

  test('delayed-job live and replay filtering have identical strict optional-message semantics', async () => {
    const rawEvents = [
      delayedJobEvent(101, { messageId: 12, status: 'pending', context: { secret: 'visible-secret' } }),
      delayedJobEvent(102, { messageId: 101, status: 'pending', context: { secret: 'hidden-secret' } }),
      delayedJobEvent(103, { messageId: null, status: 'pending', context: { secret: 'non-mail-secret' } }),
      delayedJobEvent(104, { status: 'pending', context: { secret: 'missing-id-secret' } }),
      delayedJobEvent(105, { messageId: '', status: 'pending', context: { secret: 'empty-id-secret' } }),
    ];
    let sourceSubscriber: ((event: ServerEvent) => void | Promise<void>) | undefined;
    const source: ServerEventPort = {
      async publish() { return undefined; },
      subscribe(subscriber) {
        sourceSubscriber = subscriber;
        return { unsubscribe() { sourceSubscriber = undefined; } };
      },
      replay() { return rawEvents; },
    };
    const filtered = createPrincipalFilteredEventPort(source, {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' },
      ports: makePolicyPorts({ denyMessages: new Set(['101']) }),
    });
    const live: ServerEvent[] = [];
    filtered.subscribe?.((visible) => { live.push(visible); });
    for (const candidate of rawEvents) await sourceSubscriber?.(candidate);
    const replay = await filtered.replay?.({ workspaceId: 'workspace-a' });

    expect(live).toEqual(replay);
    expect(live.map((visible) => visible.entityId)).toEqual(['101', '103']);
    expect(live.map((visible) => visible.payload)).toEqual([
      { id: 101, messageId: 12, status: 'pending' },
      { id: 103, messageId: null, status: 'pending' },
    ]);
    expect(JSON.stringify(live)).not.toMatch(/hidden-secret|missing-id-secret|empty-id-secret|101.*hidden/);
  });
});

type DelayedJobClassification =
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'non_mail' }>
  | Readonly<{ kind: 'message'; resource: ReturnType<typeof messageResource> }>;

function makePolicyPorts(options: {
  denyAllMailAccess?: boolean;
  denyMessages?: ReadonlySet<string>;
  delayedJobs?: ReadonlyMap<number, DelayedJobClassification>;
} = {}) {
  const lookups: unknown[] = [];
  const delayedJobLookups: number[] = [];
  const assertions: Array<{ permission: string; resource: unknown; actor: unknown }> = [];
  const scopePermissions: string[] = [];
  return {
    lookups,
    delayedJobLookups,
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
      async classifyWorkflowDelayedJob(input: { delayedJobId: number }) {
        delayedJobLookups.push(input.delayedJobId);
        return options.delayedJobs?.get(input.delayedJobId) ?? { kind: 'missing' as const };
      },
    },
  };
}

function messageResource(messageId: number) {
  return { type: 'message' as const, accountId: '7', folderId: '8', messageId: String(messageId) };
}

function delayedJobEvent(id: number, payload: Record<string, unknown>): ServerEvent {
  return event({
    type: 'workflow_delayed_job.updated',
    entityType: 'workflow_delayed_job',
    entityId: String(id),
    payload: { id, ...payload },
  });
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
