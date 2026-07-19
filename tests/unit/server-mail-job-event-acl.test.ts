import {
  buildGraphileTaskList,
  type JobHandlerRegistry,
  type QueuedJob,
} from '../../packages/server/src/jobs';
import { enforceMailJobPolicy } from '../../packages/server/src/mail-access/async-policy-enforcer';

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

  test('job actor modes fail closed for missing deleted actors and only accept explicit service principals', async () => {
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
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
    }), { ...ports, auth: undefined })).rejects.toMatchObject({ nonRetryable: true });

    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', actorKind: 'service', messageId: 12 },
    }), ports)).rejects.toMatchObject({ nonRetryable: true });

    await expect(enforceMailJobPolicy(job({
      type: 'ai.reply_suggestion',
      payload: { workspaceId: 'workspace-a', principal: 'simplecrm:service', messageId: 12 },
    }), ports)).resolves.toBeUndefined();

    expect(ports.assertions).toEqual([]);
  });

  test('job resource matrix resolves account message optional fallback message-or-account and mail-scope centrally', async () => {
    const ports = makePolicyPorts();

    await enforceMailJobPolicy(job({
      type: 'mail.sync.imap',
      payload: { workspaceId: 'workspace-a', principal: 'simplecrm:service', accountId: 7 },
    }), ports);
    await enforceMailJobPolicy(job({
      type: 'mail.spam.score',
      payload: { workspaceId: 'workspace-a', actorUserId: 'user-a', messageId: 12 },
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
    ]);
    expect(ports.assertions.map((entry) => [entry.permission, entry.resource])).toEqual([
      ['mail.triage', { type: 'message', accountId: '7', folderId: '8', messageId: '12' }],
    ]);
    expect(ports.scopePermissions).toEqual([]);
  });

  test('service jobs are allowed only through narrow policy resources without mail grants', async () => {
    const ports = makePolicyPorts({ denyAllMailAccess: true });

    await expect(enforceMailJobPolicy(job({
      type: 'mail.sync.imap',
      payload: { workspaceId: 'workspace-a', principal: 'simplecrm:service', accountId: 7 },
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
});

function makePolicyPorts(options: { denyAllMailAccess?: boolean } = {}) {
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
        assertions.push(input);
      },
      async resolveScope(input: { permission: string }) {
        if (options.denyAllMailAccess) throw new Error('mail_access_denied');
        scopePermissions.push(input.permission);
        return { kind: 'restricted' as const, accountIds: [7], folderIds: [], messageIds: [] };
      },
    },
    mailResourceLookup: {
      async resolve(input: { target: { kind: string; id: number } }) {
        lookups.push(input.target);
        if (input.target.kind === 'account' && input.target.id === 7) {
          return [{ type: 'account' as const, accountId: '7' }];
        }
        if (input.target.kind === 'message' && input.target.id === 12) {
          return [{ type: 'message' as const, accountId: '7', folderId: '8', messageId: '12' }];
        }
        return [];
      },
    },
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
