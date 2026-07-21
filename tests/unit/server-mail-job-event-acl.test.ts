import {
  buildGraphileTaskList,
  buildTrustedServiceJobPayload,
  type JobHandlerRegistry,
  MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD,
  POST_PROCESS_RETRY_JOB_MARKER_FIELD,
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
import {
  createBoundedEventSequenceDedupe,
  publishDemotionAclInvalidationIfNeeded,
} from '../../packages/server/src/api/fastify-adapter';

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
      // owner: a message-less side-effect child (ai.agent) requires owner/admin
      // (R12-2); it then resolves to non_mail with no lookup/assertion.
      type: 'ai.agent',
      payload: { workspaceId: 'workspace-a', actorUserId: 'owner-a' },
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
      // mail.spam.score: base mail.triage, then the content-read supplemental because
      // scoring reads the body and ships raw content to Rspamd (user-attributed only).
      ['mail.triage', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
      ['mail.content.read', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
      // workflow.execute (message 12): base mail.content.read.
      ['mail.content.read', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
      // mail.send.scheduled (draft 12): base mail.send.
      ['mail.send', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
    ]);
    expect(ports.scopePermissions).toEqual([]);
  });

  test('ai.review rechecks the message mutation permission at execution time', async () => {
    // Outbound review sets outbound_hold/outbound_block_reason on the draft under the
    // system role → recheck mail.draft.edit after the base mail.content.read.
    const outbound = makePolicyPorts();
    await enforceMailJobPolicy(job({
      type: 'ai.review',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, direction: 'outbound' },
    }), outbound);
    expect(outbound.assertions.map((entry) => entry.permission)).toEqual([
      'mail.content.read',
      'mail.draft.edit',
    ]);

    // Inbound review adds the ki-review-block tag → recheck mail.triage instead.
    const inbound = makePolicyPorts();
    await enforceMailJobPolicy(job({
      type: 'ai.review',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, direction: 'inbound' },
    }), inbound);
    expect(inbound.assertions.map((entry) => entry.permission)).toEqual([
      'mail.content.read',
      'mail.triage',
    ]);

    // A delegate whose draft.edit was revoked after the parent enqueued this child is
    // refused before the handler runs, so it cannot hold the draft it can no longer edit.
    await expect(enforceMailJobPolicy(job({
      type: 'ai.review',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, direction: 'outbound' },
    }), makePolicyPorts({ denyPermissions: new Set(['mail.draft.edit']) }))).rejects.toMatchObject({ nonRetryable: true });

    // Likewise an inbound review that lost mail.triage cannot add the block tag.
    await expect(enforceMailJobPolicy(job({
      type: 'ai.review',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, direction: 'inbound' },
    }), makePolicyPorts({ denyPermissions: new Set(['mail.triage']) }))).rejects.toMatchObject({ nonRetryable: true });
  });

  test('mail.spam.score requires content-read for user-attributed jobs, not trusted-service', async () => {
    // User-attributed scoring reads the body and ships raw RFC822/headers/bodies to
    // Rspamd, so a triage delegate that lost content.read is refused at execution.
    await expect(enforceMailJobPolicy(job({
      type: 'mail.spam.score',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), makePolicyPorts({ denyPermissions: new Set(['mail.content.read']) }))).rejects.toMatchObject({ nonRetryable: true });

    // With content.read retained, both the base triage and the content-read supplemental are asserted.
    const allowed = makePolicyPorts();
    await enforceMailJobPolicy(job({
      type: 'mail.spam.score',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), allowed);
    expect(allowed.assertions.map((entry) => entry.permission)).toEqual([
      'mail.triage',
      'mail.content.read',
    ]);

    // Trusted-service inbound scoring carries no per-user actor, so it stays authorized
    // without a content-read grant — the normal IMAP-sync path is unaffected.
    const service = makePolicyPorts({ denyPermissions: new Set(['mail.content.read']) });
    await enforceMailJobPolicy(job({
      type: 'mail.spam.score',
      payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a', messageId: 12 }),
    }), service);
    expect(service.assertions).toEqual([]);
  });

  test('workflow.forward_copy requires mail.send for user-attributed jobs, not trusted-service', async () => {
    // Forwarding a copy is an SMTP SEND of the message (content + attachments) under
    // the account's system identity, so a delegate whose mail.send was revoked (but who
    // kept mail.export) is refused at execution — a forward cannot be used to exfiltrate
    // content after send was revoked.
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.forward_copy',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), makePolicyPorts({ denyPermissions: new Set(['mail.send']) }))).rejects.toMatchObject({ nonRetryable: true });

    // With mail.send retained, both the base mail.export and the mail.send supplemental
    // are asserted on the forwarded message.
    const allowed = makePolicyPorts();
    await enforceMailJobPolicy(job({
      type: 'workflow.forward_copy',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), allowed);
    expect(allowed.assertions.map((entry) => entry.permission)).toEqual([
      'mail.export',
      'mail.send',
    ]);

    // Trusted-service forwards carry no per-user actor, so they stay authorized without
    // a mail.send grant — the enforcer returns before the user supplemental.
    const service = makePolicyPorts({ denyPermissions: new Set(['mail.send']) });
    await enforceMailJobPolicy(job({
      type: 'workflow.forward_copy',
      payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a', messageId: 12 }),
    }), service);
    expect(service.assertions).toEqual([]);
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

  test('rechecks workflow.execute side-effect privilege only for MANUAL admin-gated runs', async () => {
    const sideEffecting = { nodes: [{ type: 'action', data: { nodeType: 'email.delete_server' } }] };
    const readOnly = { nodes: [{ type: 'trigger' }, { type: 'action', data: { nodeType: 'email.sender_filter' } }] };
    const ports = makePolicyPorts({
      workflowGraphs: new Map<number, unknown>([[700, sideEffecting], [701, readOnly]]),
    });
    const MARK = MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD;

    // MARKED (manual live-execute) + non-admin + side-effecting graph → denied: a
    // demoted admin cannot complete a run they queued while admin.
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', workflowId: 700, [MARK]: true },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });

    // UNMARKED (compose-originated outbound review) + non-admin + side-effecting graph
    // → ALLOWED: the sender holds mail.send, and this message-less job resolves to
    // non_mail. This is the R22-2 regression the marker fixes (previously denied).
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', workflowId: 700 },
    }), ports)).resolves.toBeUndefined();

    // Owner may run a marked side-effecting workflow.
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: { workspaceId: 'workspace-a', actorUserId: 'owner-a', workflowId: 700, [MARK]: true },
    }), ports)).resolves.toBeUndefined();

    // Marked + non-admin + read-only graph → allowed (no side-effect node).
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', workflowId: 701, [MARK]: true },
    }), ports)).resolves.toBeUndefined();

    // Trusted service payload bypasses the recheck.
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.execute',
      payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a', workflowId: 700 }),
    }), ports)).resolves.toBeUndefined();
  });

  test('rechecks side-effect privilege for MANUAL-marked workflow child jobs, not compose-originated ones', async () => {
    const MARK = MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD;
    // ai.pick_canned is covered separately: a user actor now always returns a
    // canned-scope authorization (not undefined), so it doesn't fit this loop's
    // toBeUndefined assertions.
    const childTypes = ['workflow.http_request', 'ai.agent', 'ai.review', 'ai.transform_text'] as const;
    for (const type of childTypes) {
      // A demoted (non-admin) initiator's MARKED message-less child would otherwise
      // hit the non_mail early return and run its side-effecting node unchecked.
      await expect(enforceMailJobPolicy(job({
        type,
        payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', [MARK]: true },
      }), makePolicyPorts())).rejects.toMatchObject({ nonRetryable: true });

      // UNMARKED (compose-originated) child for a non-admin sender → allowed: the
      // message-less job resolves to non_mail and the sender was authorized at send.
      await expect(enforceMailJobPolicy(job({
        type,
        payload: { workspaceId: 'workspace-a', actorUserId: 'user-a' },
      }), makePolicyPorts())).resolves.toBeUndefined();

      // Owner/admin may run it; trusted-service (automatic/inbound) children bypass.
      await expect(enforceMailJobPolicy(job({
        type,
        payload: { workspaceId: 'workspace-a', actorUserId: 'owner-a', [MARK]: true },
      }), makePolicyPorts())).resolves.toBeUndefined();
      await expect(enforceMailJobPolicy(job({
        type,
        payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a' }),
      }), makePolicyPorts())).resolves.toBeUndefined();
    }

    // Message-scoped MARKED side-effect children (forward_copy = SMTP send,
    // ai.classify = message tag, dmarc_ingest = parsed DMARC) stay admin-gated: the
    // marker denies the demoted admin before the per-message check.
    for (const type of ['workflow.forward_copy', 'ai.classify', 'workflow.dmarc_ingest'] as const) {
      await expect(enforceMailJobPolicy(job({
        type,
        payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, [MARK]: true },
      }), makePolicyPorts())).rejects.toMatchObject({ nonRetryable: true });
      // UNMARKED (compose-originated) → not admin-gated, but STILL bound by the
      // per-message ACL (allowed here because the delegate holds the grant).
      await expect(enforceMailJobPolicy(job({
        type,
        payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
      }), makePolicyPorts())).resolves.toBeUndefined();
      await expect(enforceMailJobPolicy(job({
        type,
        payload: { workspaceId: 'workspace-a', actorUserId: 'owner-a', messageId: 12, [MARK]: true },
      }), makePolicyPorts())).resolves.toBeUndefined();
      await expect(enforceMailJobPolicy(job({
        type,
        payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a', messageId: 12 }),
      }), makePolicyPorts())).resolves.toBeUndefined();
    }

    // An UNMARKED message-scoped child is still bound by per-message ACL: an
    // out-of-scope message is denied even without the admin marker.
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.forward_copy',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 101 },
    }), makePolicyPorts({ denyMessages: new Set(['101']) }))).rejects.toMatchObject({ nonRetryable: true });

    // ai.reply_suggestion is NOT gated: it has a direct user route, is
    // message-required, and only adds its content-read supplemental.
    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), makePolicyPorts())).resolves.toBeUndefined();
  });

  test('re-verifies current admin status for marked post-process retry spam-score jobs', async () => {
    // A retry job carries the server-only marker (stamped only by the admin-only
    // post-process/retry route). An initiator demoted to a plain user before the
    // worker claims it must be re-denied before the system-role security check /
    // status writes / inbound-workflow enqueue run — retaining mail.triage is not
    // enough.
    await expect(enforceMailJobPolicy(job({
      type: 'mail.spam.score',
      payload: {
        workspaceId: 'workspace-a',
        actorUserId: 'user-a',
        messageId: 12,
        [POST_PROCESS_RETRY_JOB_MARKER_FIELD]: true,
      },
    }), makePolicyPorts())).rejects.toMatchObject({ nonRetryable: true });

    // An owner/admin initiator passes the recheck and still rechecks the base grant.
    await expect(enforceMailJobPolicy(job({
      type: 'mail.spam.score',
      payload: {
        workspaceId: 'workspace-a',
        actorUserId: 'owner-a',
        messageId: 12,
        [POST_PROCESS_RETRY_JOB_MARKER_FIELD]: true,
      },
    }), makePolicyPorts())).resolves.toBeUndefined();

    // An ordinary (unmarked) inbound spam-score job stays allowed for a plain user
    // with triage — the recheck applies only to the admin-only retry marker.
    await expect(enforceMailJobPolicy(job({
      type: 'mail.spam.score',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), makePolicyPorts())).resolves.toBeUndefined();

    // A forged marker on a request-shaped payload cannot be used to demand admin —
    // but more importantly, a plain user forging it only makes the check STRICTER,
    // never weaker; the value must be exactly boolean true to trip the recheck.
    await expect(enforceMailJobPolicy(job({
      type: 'mail.spam.score',
      payload: {
        workspaceId: 'workspace-a',
        actorUserId: 'user-a',
        messageId: 12,
        [POST_PROCESS_RETRY_JOB_MARKER_FIELD]: 'true',
      },
    }), makePolicyPorts())).resolves.toBeUndefined();
  });

  test('rechecks reply-parent triage before a scheduled reply-send marks the parent done', async () => {
    const markDone = new Map([[12, { replyParentMessageId: 101, markParentDone: true }]]);
    const ports = makePolicyPorts({ replyParents: markDone });
    await expect(enforceMailJobPolicy(job({
      type: 'mail.send.scheduled',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', draftId: 12, accountId: 7 },
    }), ports)).resolves.toBeUndefined();
    expect(ports.assertions.map((entry) => [entry.permission, (entry.resource as { messageId?: string }).messageId]))
      .toContainEqual(['mail.triage', '101']);

    // markParentDone false → the parent is not marked done, so no triage recheck.
    const noMark = makePolicyPorts({ replyParents: new Map([[13, { replyParentMessageId: 101, markParentDone: false }]]) });
    await expect(enforceMailJobPolicy(job({
      type: 'mail.send.scheduled',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', draftId: 13, accountId: 7 },
    }), noMark)).resolves.toBeUndefined();
    expect(noMark.assertions.some((entry) => entry.permission === 'mail.triage')).toBe(false);

    // A sender lacking triage on the parent is rejected when it would be marked done.
    const denied = makePolicyPorts({ replyParents: markDone, denyMessages: new Set(['101']) });
    await expect(enforceMailJobPolicy(job({
      type: 'mail.send.scheduled',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', draftId: 12, accountId: 7 },
    }), denied)).rejects.toMatchObject({ nonRetryable: true });

    // A reply parent whose stored id does not resolve to exactly one message
    // (an imported-id collision returns []) fails closed rather than skipping the
    // triage recheck and letting the send mark an unverified parent done.
    const ambiguousParent = makePolicyPorts({
      replyParents: new Map([[12, { replyParentMessageId: 999, markParentDone: true }]]),
    });
    await expect(enforceMailJobPolicy(job({
      type: 'mail.send.scheduled',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', draftId: 12, accountId: 7 },
    }), ambiguousParent)).rejects.toMatchObject({ nonRetryable: true });
  });

  test('scheduled send rechecks mail.attachment.read on each stored attachment path', async () => {
    // A draft-local upload (carve-out) + a synced path owned by a readable message → allowed.
    const allowed = makePolicyPorts({
      scheduledDraftAttachmentPaths: new Map([[12, [
        'workspace-a/compose-drafts/12/ab-upload.pdf',
        'workspace-a/synced/owned.pdf',
      ]]]),
    });
    await enforceMailJobPolicy(job({
      type: 'mail.send.scheduled',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', draftId: 12, accountId: 7 },
    }), allowed);
    // Base mail.send on the draft + a single mail.attachment.read on the synced path's
    // owning message (the draft-local upload is carved out).
    expect(allowed.assertions.filter((entry) => entry.permission === 'mail.attachment.read')).toHaveLength(1);

    // The sender lost mail.attachment.read on the message that owns a synced path.
    const revoked = makePolicyPorts({
      scheduledDraftAttachmentPaths: new Map([[12, ['workspace-a/synced/foreign.pdf']]]),
      denyMessages: new Set(['101']),
    });
    await expect(enforceMailJobPolicy(job({
      type: 'mail.send.scheduled',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', draftId: 12, accountId: 7 },
    }), revoked)).rejects.toMatchObject({ nonRetryable: true });

    // A path with no owning attachment row that is not draft-local is denied.
    const unowned = makePolicyPorts({
      scheduledDraftAttachmentPaths: new Map([[12, ['workspace-a/other/secret.pdf']]]),
    });
    await expect(enforceMailJobPolicy(job({
      type: 'mail.send.scheduled',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', draftId: 12, accountId: 7 },
    }), unowned)).rejects.toMatchObject({ nonRetryable: true });

    // Trusted-service scheduled sends carry no per-user actor, so attachment paths are
    // not rechecked (the enforcer returns before the user supplemental).
    const service = makePolicyPorts({
      scheduledDraftAttachmentPaths: new Map([[12, ['workspace-a/synced/foreign.pdf']]]),
      denyMessages: new Set(['101']),
    });
    await enforceMailJobPolicy(job({
      type: 'mail.send.scheduled',
      payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a', draftId: 12, accountId: 7 }),
    }), service);
    expect(service.assertions.some((entry) => entry.permission === 'mail.attachment.read')).toBe(false);
  });

  test('reply generation requires content-read in addition to draft-create', async () => {
    const allowed = makePolicyPorts();
    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), allowed)).resolves.toBeUndefined();
    expect(allowed.assertions.map((entry) => entry.permission)).toEqual([
      'mail.draft.create',
      'mail.content.read',
    ]);

    // draft.create alone is not enough — a delegate lacking content.read cannot
    // queue generation that reads the message body.
    const denied = makePolicyPorts({ denyPermissions: new Set(['mail.content.read']) });
    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), denied)).rejects.toMatchObject({ nonRetryable: true });
  });

  test('classification requires content-read in addition to triage', async () => {
    const allowed = makePolicyPorts();
    await expect(enforceMailJobPolicy(job({
      type: 'ai.classify',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), allowed)).resolves.toBeUndefined();
    expect(allowed.assertions.map((entry) => entry.permission)).toEqual([
      'mail.triage',
      'mail.content.read',
    ]);

    // triage alone is not enough — a content grant revoked after workflow.execute
    // queued this ai.classify child (while the user retained triage) is caught at
    // execution: classification reads snippet/body_text and may send it to the AI
    // provider before persisting the tag.
    const denied = makePolicyPorts({ denyPermissions: new Set(['mail.content.read']) });
    await expect(enforceMailJobPolicy(job({
      type: 'ai.classify',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), denied)).rejects.toMatchObject({ nonRetryable: true });
  });

  test('ai.agent with createDraft rechecks draft-create in addition to content-read', async () => {
    const allowed = makePolicyPorts();
    await expect(enforceMailJobPolicy(job({
      type: 'ai.agent',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, createDraft: true },
    }), allowed)).resolves.toBeUndefined();
    expect(allowed.assertions.map((entry) => entry.permission)).toEqual([
      'mail.content.read',
      'mail.draft.create',
    ]);

    // A createDraft agent mints a reply draft under the system role, so it must fail
    // closed when the initiating user's draft.create was revoked after enqueue.
    const denied = makePolicyPorts({ denyPermissions: new Set(['mail.draft.create']) });
    await expect(enforceMailJobPolicy(job({
      type: 'ai.agent',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, createDraft: true },
    }), denied)).rejects.toMatchObject({ nonRetryable: true });

    // createDraft:false → no draft, so no draft.create recheck (content-read only).
    const readOnly = makePolicyPorts();
    await expect(enforceMailJobPolicy(job({
      type: 'ai.agent',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, createDraft: false },
    }), readOnly)).resolves.toBeUndefined();
    expect(readOnly.assertions.map((entry) => entry.permission)).toEqual(['mail.content.read']);
  });

  test('ai.pick_canned rechecks draft-create for drafts and scopes the canned query to the user', async () => {
    // A compose-originated (user) pick_canned returns the initiating user's
    // mail.draft.create scope so the worker restricts selectCannedResponses to global
    // + in-scope templates; with createDraft it also rechecks draft.create.
    const allowed = makePolicyPorts();
    const authorization = await enforceMailJobPolicy(job({
      type: 'ai.pick_canned',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, createDraft: true },
    }), allowed);
    expect(allowed.assertions.map((entry) => entry.permission)).toEqual([
      'mail.content.read',
      'mail.draft.create',
    ]);
    expect(allowed.scopePermissions).toContain('mail.draft.create');
    expect(authorization).toEqual({
      kind: 'ai_pick_canned_scope',
      cannedScope: { kind: 'restricted', accountIds: [7], folderIds: [], messageIds: [] },
    });

    // Revoked draft.create after enqueue → the draft-creating pick_canned is rejected.
    const denied = makePolicyPorts({ denyPermissions: new Set(['mail.draft.create']) });
    await expect(enforceMailJobPolicy(job({
      type: 'ai.pick_canned',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, createDraft: true },
    }), denied)).rejects.toMatchObject({ nonRetryable: true });

    // A MANUAL-marked pick_canned for a demoted (non-admin) initiator stays admin-gated.
    await expect(enforceMailJobPolicy(job({
      type: 'ai.pick_canned',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12, [MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD]: true },
    }), makePolicyPorts())).rejects.toMatchObject({ nonRetryable: true });

    // A trusted-service (automatic/inbound) run carries no per-user scope, so the
    // canned query stays unrestricted (authorization undefined).
    const service = makePolicyPorts();
    await expect(enforceMailJobPolicy(job({
      type: 'ai.pick_canned',
      payload: buildTrustedServiceJobPayload({ workspaceId: 'workspace-a', messageId: 12 }),
    }), service)).resolves.toBeUndefined();
    expect(service.scopePermissions).not.toContain('mail.draft.create');
  });

  test('resolves the job actor via a scoped getUser lookup, not a full user-list scan', async () => {
    const base = makePolicyPorts();
    const getUser = jest.fn(async (input: { workspaceId: string; userId: string }) => (
      input.userId === 'user-a' ? { id: 'user-a', role: 'user' as const, disabledAt: null } : null
    ));
    const listUsers = jest.fn(async () => {
      throw new Error('listUsers must not be scanned when getUser is available');
    });
    await expect(enforceMailJobPolicy(job({
      type: 'ai.classify',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), { ...base, auth: { getUser, listUsers } })).resolves.toBeUndefined();
    expect(getUser).toHaveBeenCalledWith({ workspaceId: 'workspace-a', userId: 'user-a' });
    expect(listUsers).not.toHaveBeenCalled();

    // A disabled user resolved via getUser is still rejected.
    await expect(enforceMailJobPolicy(job({
      type: 'ai.classify',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), {
      ...base,
      auth: { async getUser() { return { id: 'user-a', role: 'user' as const, disabledAt: '2026-07-19T10:00:00.000Z' }; } },
    })).rejects.toMatchObject({ nonRetryable: true });
  });

  test('message-attributed workflow.http_request requires content-read', async () => {
    // The request interpolates body_text/snippet/combined_text into the outbound URL
    // and body, so a metadata-only delegate whose content.read was revoked after the
    // workflow queued this child must be blocked at execution.
    const allowed = makePolicyPorts();
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.http_request',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), allowed)).resolves.toBeUndefined();
    expect(allowed.assertions.map((entry) => entry.permission)).toEqual([
      'mail.metadata.read',
      'mail.content.read',
    ]);

    const denied = makePolicyPorts({ denyPermissions: new Set(['mail.content.read']) });
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.http_request',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), denied)).rejects.toMatchObject({ nonRetryable: true });

    // A message-less http_request resolves to non_mail — no content gate applies.
    const messageless = makePolicyPorts();
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.http_request',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a' },
    }), messageless)).resolves.toBeUndefined();
    expect(messageless.assertions).toEqual([]);
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
    // dmarc_ingest is a workflow side-effect child (R16-1), so a plain user actor
    // is denied; an owner initiator passes the gate and still rechecks the grant.
    await expect(enforceMailJobPolicy(job({
      type: 'workflow.dmarc_ingest',
      payload: { workspaceId: 'workspace-a', actorUserId: 'owner-a', messageId: 12, workflowId: 7 },
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

  test('ACL invalidation events reach the subject and delegation managers, sanitized, and are withheld from unrelated users', async () => {
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

    // The affected subject receives the sanitized invalidation so their client
    // clears loaded mail state.
    const subjectDelivered = await filterMailEventForPrincipal(aclEvent, {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' as const },
      ports,
    });
    expect(subjectDelivered).not.toBeNull();
    expect(subjectDelivered!.payload).toEqual({ bindingId: 901, targetUserId: 'user-a', state: 'deleted' });

    // R18-3: a delegation manager (owner/admin) who is NOT the subject also receives
    // it so their delegation panel reloads instead of holding a stale binding list.
    // The payload stays sanitized to the enumerable bindingId/targetUserId/state —
    // the hidden email/body/filename fields never survive.
    const managerDelivered = await filterMailEventForPrincipal(aclEvent, {
      principal: { workspaceId: 'workspace-a', userId: 'user-b', role: 'admin' as const },
      ports,
    });
    expect(managerDelivered).not.toBeNull();
    expect(managerDelivered!.payload).toEqual({ bindingId: 901, targetUserId: 'user-a', state: 'deleted' });

    // An unrelated non-manager user never receives another subject's invalidation.
    await expect(filterMailEventForPrincipal(aclEvent, {
      principal: { workspaceId: 'workspace-a', userId: 'user-b', role: 'user' as const },
      ports,
    })).resolves.toBeNull();
  });

  test('delivers PGP identity events to the owning user and owners/admins, peer-key events owner/admin only', async () => {
    const ports = makePolicyPorts();
    const identityEvent = event({
      type: 'pgp_identity.created',
      entityType: 'pgp_identity',
      entityId: '5',
      payload: { id: 5, userId: 'user-a', fingerprint: 'ABC' },
    });

    // The identity's owning user receives it (a non-admin delegate who generated their
    // own key), so their PgpPanel reloads.
    await expect(filterMailEventForPrincipal(identityEvent, {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' as const },
      ports,
    })).resolves.not.toBeNull();
    // An owner/admin who is not the owner still receives it.
    await expect(filterMailEventForPrincipal(identityEvent, {
      principal: { workspaceId: 'workspace-a', userId: 'admin-b', role: 'admin' as const },
      ports,
    })).resolves.not.toBeNull();
    // An unrelated non-admin user does not receive another user's identity event.
    await expect(filterMailEventForPrincipal(identityEvent, {
      principal: { workspaceId: 'workspace-a', userId: 'user-b', role: 'user' as const },
      ports,
    })).resolves.toBeNull();

    // Peer-key events are workspace-wide and stay owner/admin only — even the acting
    // user (a non-admin) does not receive one.
    const peerKeyEvent = event({
      type: 'pgp_peer_key.created',
      entityType: 'pgp_peer_key',
      entityId: '9',
      payload: { id: 9, userId: 'user-a' },
    });
    await expect(filterMailEventForPrincipal(peerKeyEvent, {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' as const },
      ports,
    })).resolves.toBeNull();
  });

  test('publishes a self-targeted ACL invalidation only when a socket principal loses owner/admin', async () => {
    const published: ServerEvent[] = [];
    const events: ServerEventPort = {
      async publish(event) { published.push(event); },
    };
    const at = '2026-07-20T22:40:00.000Z';
    const principal = (userId: string, role: 'owner' | 'admin' | 'user') => ({
      workspaceId: 'workspace-a',
      userId,
      role,
    });

    // owner -> user and admin -> user each emit exactly one self-targeted, sanitized
    // invalidation so the demoted user's client clears mail loaded under the old role.
    for (const from of ['owner', 'admin'] as const) {
      published.length = 0;
      await expect(
        publishDemotionAclInvalidationIfNeeded(principal('user-a', from), principal('user-a', 'user'), events, at),
      ).resolves.toBe(true);
      expect(published).toHaveLength(1);
      expect(published[0]).toEqual({
        type: 'email_acl.changed',
        workspaceId: 'workspace-a',
        entityType: 'email_acl',
        entityId: 'user-a',
        actorUserId: 'user-a',
        occurredAt: at,
        payload: { targetUserId: 'user-a', state: 'changed' },
      });
    }

    // Non-demotion transitions publish nothing: an unchanged plain user, a still-
    // elevated admin, and an elevation (user -> admin) must not emit an invalidation.
    for (const [from, to] of [
      ['user', 'user'],
      ['admin', 'admin'],
      ['owner', 'owner'],
      ['user', 'admin'],
    ] as const) {
      published.length = 0;
      await expect(
        publishDemotionAclInvalidationIfNeeded(principal('user-a', from), principal('user-a', to), events, at),
      ).resolves.toBe(false);
      expect(published).toHaveLength(0);
    }
  });

  test('ACL invalidation events reach scoped non-admin delegation managers when the payload carries the binding resource', async () => {
    const aclEvent = (extra: Record<string, unknown>) => event({
      type: 'email_acl.changed',
      entityType: 'email_acl',
      entityId: '902',
      payload: { bindingId: 902, targetUserId: 'user-a', state: 'changed', ...extra },
    });
    const manager = { workspaceId: 'workspace-a', userId: 'mgr', role: 'user' as const };

    // A manager holding mail.delegation.manage on the binding's folder receives the
    // invalidation; the filter authorized exactly that permission + resource.
    const authorized = makePolicyPorts();
    const delivered = await filterMailEventForPrincipal(
      aclEvent({ resourceType: 'folder', accountId: 7, folderId: 8 }),
      { principal: manager, ports: authorized },
    );
    expect(delivered).not.toBeNull();
    expect(delivered!.payload).toEqual({
      bindingId: 902, targetUserId: 'user-a', state: 'changed', resourceType: 'folder', accountId: 7, folderId: 8,
    });
    expect(authorized.assertions).toContainEqual(expect.objectContaining({
      permission: 'mail.delegation.manage',
      resource: { type: 'folder', accountId: '7', folderId: '8' },
    }));

    // A manager lacking mail.delegation.manage on that resource is withheld.
    const denied = makePolicyPorts({ denyPermissions: new Set(['mail.delegation.manage']) });
    await expect(filterMailEventForPrincipal(
      aclEvent({ resourceType: 'account', accountId: 7 }),
      { principal: manager, ports: denied },
    )).resolves.toBeNull();

    // A resource-less invalidation (delete/empty-replace, group-membership, demotion)
    // stays subject-only: a non-subject manager gets nothing, no permission checked.
    const resourceless = makePolicyPorts();
    await expect(filterMailEventForPrincipal(
      aclEvent({}),
      { principal: manager, ports: resourceless },
    )).resolves.toBeNull();
    expect(resourceless.assertions).toEqual([]);
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
    // Both edge messages must be authorized — an inaccessible child drops it,
    // so the child id never leaks to a parent-only viewer.
    await expect(filterMailEventForPrincipal(event({
      type: 'email_thread_edge.deleted',
      entityType: 'email_thread_edge',
      entityId: '995',
      payload: { parentMessageId: 12, childMessageId: 101 },
    }), userContext)).resolves.toBeNull();

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

  test('delivers accountless thread-alias deletions to owners/admins, account-scoped ones to the account', async () => {
    const ports = makePolicyPorts();
    const userContext = {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' as const },
      ports,
    };
    const adminContext = {
      principal: { workspaceId: 'workspace-a', userId: 'admin-a', role: 'admin' as const },
      ports,
    };

    // Accountless (workspace-global) alias tombstone: accountId null cannot resolve
    // an account, so it delivers to owners/admins only rather than dropping for all.
    const accountless = event({
      type: 'email_thread_alias.deleted',
      entityType: 'email_thread_alias',
      entityId: '30',
      payload: { accountId: null, threadId: 'thread-x', state: 'deleted' },
    });
    await expect(filterMailEventForPrincipal(accountless, userContext)).resolves.toBeNull();
    await expect(filterMailEventForPrincipal(accountless, adminContext))
      .resolves.toMatchObject({ type: 'email_thread_alias.deleted' });

    // An account-scoped tombstone still resolves to its account and reaches that
    // account's delegate.
    await expect(filterMailEventForPrincipal(event({
      type: 'email_thread_alias.deleted',
      entityType: 'email_thread_alias',
      entityId: '31',
      payload: { accountId: 7, threadId: 'thread-y', state: 'deleted' },
    }), userContext)).resolves.toMatchObject({ type: 'email_thread_alias.deleted' });
  });

  test('canned-response events authorize against their account, not any draft scope', async () => {
    const ports = makePolicyPorts();
    const userContext = {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' as const },
      ports,
    };

    // Account-scoped canned response on an account the delegate can reach: the
    // event resolves to that account and is delivered, sanitized to accountId
    // only (clients treat it as a refetch signal, so title/body are stripped).
    const delivered = await filterMailEventForPrincipal(event({
      type: 'email_canned_response.updated',
      entityType: 'email_canned_response',
      entityId: '30',
      payload: { id: 30, accountId: 7, title: 't', body: 'b', sortOrder: 0 },
    }), userContext);
    expect(delivered).not.toBeNull();
    expect(delivered!.payload).toEqual({ accountId: 7 });

    // A canned response on a different account is no longer authorized by an
    // unrelated draft scope (previously workspace-global leaked its existence).
    await expect(filterMailEventForPrincipal(event({
      type: 'email_canned_response.updated',
      entityType: 'email_canned_response',
      entityId: '31',
      payload: { id: 31, accountId: 9, title: 't', body: 'b', sortOrder: 0 },
    }), userContext)).resolves.toBeNull();

    // A global template (accountId null) stays workspace-global: delivered to any
    // delegate holding a draft scope.
    await expect(filterMailEventForPrincipal(event({
      type: 'email_canned_response.created',
      entityType: 'email_canned_response',
      entityId: '32',
      payload: { id: 32, accountId: null, title: 't', body: 'b', sortOrder: 0 },
    }), userContext)).resolves.toMatchObject({ type: 'email_canned_response.created' });
  });

  test('restricts PGP identity, spam-list, and remote-content-allowlist events to owners and admins', async () => {
    const ports = makePolicyPorts();
    const userContext = {
      principal: { workspaceId: 'workspace-a', userId: 'user-a', role: 'user' as const },
      ports,
    };
    const adminContext = {
      principal: { workspaceId: 'workspace-a', userId: 'admin-a', role: 'admin' as const },
      ports,
    };

    for (const evt of [
      { type: 'pgp_identity.created', entityType: 'pgp_identity', entityId: '5', payload: { id: 5, accountId: 7 } },
      { type: 'pgp_peer_key.updated', entityType: 'pgp_peer_key', entityId: '6', payload: { id: 6 } },
      { type: 'spam_list_entry.updated', entityType: 'spam_list_entry', entityId: '9', payload: { id: 9 } },
      // The remote-content allowlist is a workspace security setting whose HTTP list
      // route excludes restricted scopes, so its events are owner/admin-only too.
      { type: 'email_remote_content_allowlist.updated', entityType: 'email_remote_content_allowlist', entityId: '12', payload: { id: 12 } },
    ]) {
      // A single-account metadata delegate cannot list these via HTTP, so they must
      // not receive the workspace-wide key/spam-policy mutation over the stream.
      await expect(filterMailEventForPrincipal(event(evt), userContext)).resolves.toBeNull();
      // Owners/admins still get them (their read routes admit full-scope callers).
      await expect(filterMailEventForPrincipal(event(evt), adminContext))
        .resolves.toMatchObject({ type: evt.type });
    }
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

    // R33-2: a message delete FK-nulls message_id but LEAVES message_source_sqlite_id —
    // the job is still MAIL (orphaned), so it must NOT be broadcast as non_mail to every
    // workspace user; it fails closed to owner/admin only. A plain 'user' is denied...
    await expect(filterMailEventForPrincipal(event({
      type: 'workflow_delayed_job.updated',
      entityType: 'workflow_delayed_job',
      entityId: '95',
      payload: { id: 95, messageId: null, messageSourceSqliteId: 41, status: 'pending', context: { secret: 'orphaned-mail' } },
    }), context)).resolves.toBeNull();
    // ...while an owner still receives it (fail closed ⇒ owner/admin only).
    await expect(filterMailEventForPrincipal(event({
      type: 'workflow_delayed_job.updated',
      entityType: 'workflow_delayed_job',
      entityId: '95',
      payload: { id: 95, messageId: null, messageSourceSqliteId: 41, status: 'pending' },
    }), {
      principal: { workspaceId: 'workspace-a', userId: 'owner-a', role: 'owner' as const },
      ports,
    })).resolves.toMatchObject({
      type: 'workflow_delayed_job.updated',
      payload: { id: 95, messageSourceSqliteId: 41 },
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
  denyPermissions?: ReadonlySet<string>;
  delayedJobs?: ReadonlyMap<number, DelayedJobClassification>;
  replyParents?: ReadonlyMap<number, { replyParentMessageId: number | null; markParentDone: boolean } | null>;
  scheduledDraftAttachmentPaths?: ReadonlyMap<number, readonly string[] | null>;
  workflowGraphs?: ReadonlyMap<number, unknown>;
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
        if (options.denyPermissions?.has(input.permission)) throw new Error('mail_access_denied');
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
      async resolve(input: { target: { kind: string; id?: number | string; entity?: string; path?: string } }) {
        lookups.push(input.target);
        if (input.target.kind === 'attachment_path') {
          // 'workspace-a/synced/owned.pdf' → message 12; foreign → message 101; else none.
          if (input.target.path === 'workspace-a/synced/owned.pdf') {
            return [{ type: 'message' as const, accountId: '7', folderId: '8', messageId: '12' }];
          }
          if (input.target.path === 'workspace-a/synced/foreign.pdf') {
            return [{ type: 'message' as const, accountId: '7', folderId: '8', messageId: '101' }];
          }
          return [];
        }
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
      async resolveScheduledDraftReplyParent(input: { draftId: number }) {
        return options.replyParents?.get(input.draftId) ?? null;
      },
      async resolveScheduledDraftAttachmentPaths(input: { draftId: number }) {
        return options.scheduledDraftAttachmentPaths?.get(input.draftId) ?? null;
      },
      async loadWorkflowGraphForPolicy(input: { workflowId: number }) {
        return options.workflowGraphs?.has(input.workflowId)
          ? { graph: options.workflowGraphs.get(input.workflowId) }
          : null;
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
