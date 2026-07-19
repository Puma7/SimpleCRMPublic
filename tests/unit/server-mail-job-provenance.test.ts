import { readFileSync } from 'node:fs';

import {
  buildAiAgentJobPlan,
  buildAiClassificationJobPlan,
  buildAiPickCannedJobPlan,
  buildAiReviewJobPlan,
  buildAiReplySuggestionJobPlan,
  buildAiTransformTextJobPlan,
  buildWorkflowExecutionJobPlan,
  buildWorkflowForwardCopyJobPlan,
  buildWorkflowHttpRequestJobPlan,
  buildTrustedServiceJobPayload,
  SERVER_JOB_POLICIES,
  TRUSTED_SERVICE_JOB_MARKER_FIELD,
} from '../../packages/server/src/jobs';
import { createPostgresMailSyncPostProcessor } from '../../packages/server/src/mail-sync-post-process';
import { enqueueInboundWorkflowsAfterSpam } from '../../packages/server/src/mail-inbound-workflow-enqueue';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = '22222222-2222-4222-8222-222222222222';

describe('server mail job provenance', () => {
  test('central trusted-service builder stamps a non-forgeable canonical marker without spreading untrusted bodies', () => {
    const payload = buildTrustedServiceJobPayload({
      workspaceId: WORKSPACE_ID,
      messageId: 12,
      actorKind: 'service',
      principal: 'simplecrm:service',
      [TRUSTED_SERVICE_JOB_MARKER_FIELD]: 'forged',
    });

    expect(payload).toEqual({
      workspaceId: WORKSPACE_ID,
      messageId: 12,
      [TRUSTED_SERVICE_JOB_MARKER_FIELD]: expect.stringMatching(/^simplecrm:trusted-service:/),
    });
    expect(payload).not.toHaveProperty('actorKind');
    expect(payload).not.toHaveProperty('principal');
  });

  test('post-sync system producer stamps spam reply and vacation jobs with trusted service provenance', async () => {
    const enqueued: unknown[] = [];
    const postProcess = createPostgresMailSyncPostProcessor({
      db: makePostSyncDb([31]),
      applyWorkspaceSession: async () => undefined,
      jobQueue: {
        async enqueue(input) {
          enqueued.push(input);
          return undefined;
        },
      },
    });

    await postProcess.afterSync({
      workspaceId: WORKSPACE_ID,
      accountId: 7,
      protocol: 'imap',
      syncStartedAt: new Date('2026-07-19T10:00:00.000Z'),
      syncFinishedAt: new Date('2026-07-19T10:01:00.000Z'),
      result: { inboundMessageIds: [31] },
    });

    expect(enqueued.map((item) => [
      (item as { type: string }).type,
      ((item as { payload: Record<string, unknown> }).payload)[TRUSTED_SERVICE_JOB_MARKER_FIELD],
    ])).toEqual([
      ['mail.spam.score', expect.stringMatching(/^simplecrm:trusted-service:/)],
      ['ai.reply_suggestion', expect.stringMatching(/^simplecrm:trusted-service:/)],
      ['mail.vacation.auto_reply', expect.stringMatching(/^simplecrm:trusted-service:/)],
    ]);
  });

  test('inbound workflow system producer stamps queued workflow executions with trusted service provenance', async () => {
    const enqueued: unknown[] = [];
    await enqueueInboundWorkflowsAfterSpam(
      {
        db: makeInboundDb({
          message: {
            id: 31,
            account_id: 7,
            is_spam: false,
            spam_status: 'clean',
            spam_score_label: 'clean',
          },
          workflows: [{ id: 23, account_id: null, override_key: null }],
        }),
        jobQueue: {
          async enqueue(input) {
            enqueued.push(input);
          },
        },
        applyWorkspaceSession: async () => undefined,
      },
      { workspaceId: WORKSPACE_ID, messageId: 31 },
    );

    expect(enqueued).toHaveLength(1);
    expect((enqueued[0] as { payload: Record<string, unknown> }).payload).toMatchObject({
      workspaceId: WORKSPACE_ID,
      workflowId: 23,
      messageId: 31,
      triggerName: 'inbound',
      [TRUSTED_SERVICE_JOB_MARKER_FIELD]: expect.stringMatching(/^simplecrm:trusted-service:/),
    });
  });

  test('production job plan builders preserve actor through workflow AI HTTP forward and continuation chains', () => {
    const continuation = {
      workflowId: 23,
      triggerName: 'manual',
      resumeNodeId: 'next',
      eventStrings: { subject: 'Hello' },
      eventVariables: { 'message.id': 12 },
    };

    expect(buildWorkflowExecutionJobPlan({
      workspaceId: WORKSPACE_ID,
      workflowId: 23,
      messageId: 12,
      actorUserId: USER_ID,
      context: { resumeNodeId: 'next' },
    }, WORKSPACE_ID).actorUserId).toBe(USER_ID);
    expect(buildAiReplySuggestionJobPlan({
      workspaceId: WORKSPACE_ID,
      messageId: 12,
      actorUserId: USER_ID,
    }, WORKSPACE_ID).actorUserId).toBe(USER_ID);
    expect(buildAiClassificationJobPlan({
      workspaceId: WORKSPACE_ID,
      messageId: 12,
      actorUserId: USER_ID,
      labels: ['billing'],
      continuation,
    }, WORKSPACE_ID).continuation?.actorUserId).toBe(USER_ID);
    expect(buildAiReviewJobPlan({
      workspaceId: WORKSPACE_ID,
      messageId: 12,
      actorUserId: USER_ID,
      continuation,
    }, WORKSPACE_ID).continuation?.actorUserId).toBe(USER_ID);
    expect(buildAiTransformTextJobPlan({
      workspaceId: WORKSPACE_ID,
      messageId: 12,
      actorUserId: USER_ID,
      continuation,
    }, WORKSPACE_ID).continuation?.actorUserId).toBe(USER_ID);
    expect(buildAiAgentJobPlan({
      workspaceId: WORKSPACE_ID,
      messageId: 12,
      actorUserId: USER_ID,
      continuation,
    }, WORKSPACE_ID).continuation?.actorUserId).toBe(USER_ID);
    expect(buildAiPickCannedJobPlan({
      workspaceId: WORKSPACE_ID,
      messageId: 12,
      actorUserId: USER_ID,
      continuation,
    }, WORKSPACE_ID).continuation?.actorUserId).toBe(USER_ID);
    expect(buildWorkflowHttpRequestJobPlan({
      workspaceId: WORKSPACE_ID,
      messageId: 12,
      actorUserId: USER_ID,
      method: 'GET',
      url: 'https://example.test/hook',
      continuation,
    }, WORKSPACE_ID).continuation?.actorUserId).toBe(USER_ID);
    expect(buildWorkflowForwardCopyJobPlan({
      workspaceId: WORKSPACE_ID,
      workflowId: 23,
      messageId: 12,
      actorUserId: USER_ID,
      to: 'ops@example.test',
      continuation,
    }, WORKSPACE_ID).continuation?.actorUserId).toBe(USER_ID);
  });

  test('production job plan builders preserve trusted service provenance through system continuations', () => {
    const payload = buildTrustedServiceJobPayload({
      workspaceId: WORKSPACE_ID,
      messageId: 12,
      labels: ['billing'],
      continuation: {
        workflowId: 23,
        triggerName: 'inbound',
        resumeNodeId: 'next',
      },
    });

    expect(buildWorkflowExecutionJobPlan(buildTrustedServiceJobPayload({
      workspaceId: WORKSPACE_ID,
      workflowId: 23,
      messageId: 12,
      context: {},
    }), WORKSPACE_ID).trustedService).toBe(true);
    expect(buildAiClassificationJobPlan(payload, WORKSPACE_ID).continuation).toMatchObject({
      workflowId: 23,
      trustedService: true,
    });
    expect(buildWorkflowHttpRequestJobPlan(buildTrustedServiceJobPayload({
      workspaceId: WORKSPACE_ID,
      messageId: 12,
      method: 'GET',
      url: 'https://example.test/hook',
      continuation: {
        workflowId: 23,
        triggerName: 'inbound',
        resumeNodeId: 'next',
      },
    }), WORKSPACE_ID).continuation).toMatchObject({
      workflowId: 23,
      trustedService: true,
    });
    expect(buildWorkflowForwardCopyJobPlan(buildTrustedServiceJobPayload({
      workspaceId: WORKSPACE_ID,
      workflowId: 23,
      messageId: 12,
      to: 'ops@example.test',
      continuation: {
        workflowId: 23,
        triggerName: 'inbound',
        resumeNodeId: 'next',
      },
    }), WORKSPACE_ID).continuation).toMatchObject({
      workflowId: 23,
      trustedService: true,
    });
  });

  test('source inventory covers every initiating mail policy producer with actor or trusted-service provenance', () => {
    const initiatingTypes = new Set(SERVER_JOB_POLICIES
      .filter((entry) => entry.actorMode === 'initiating_user' || entry.actorMode === 'initiating_user_or_service')
      .map((entry) => entry.type));
    const producerFiles = [
      'packages/server/src/workflow-execution.ts',
      'packages/server/src/ai-classification.ts',
      'packages/server/src/workflow-http-request.ts',
      'packages/server/src/workflow-forward-copy.ts',
      'packages/server/src/mail-sync-post-process.ts',
      'packages/server/src/mail-inbound-workflow-enqueue.ts',
      'packages/server/src/api/mail-routes.ts',
      'packages/server/src/api/workflow-routes.ts',
      'packages/server/src/workflow-backfill.ts',
      'packages/server/src/relay-submission.ts',
    ];
    const producers = producerFiles.flatMap((file) => extractQueueProducerBlocks(file)
      .filter((producer) => initiatingTypes.has(producer.type)));

    expect(new Set(producers.map((producer) => producer.type))).toEqual(initiatingTypes);
    for (const producer of producers) {
      expect(`${producer.file}:${producer.type}\n${producer.block}`)
        .toMatch(/actorUserId|workflowJobProvenance|with[A-Za-z]+Provenance|buildTrustedServiceJobPayload/);
    }
  });
});

function extractQueueProducerBlocks(file: string): Array<{ file: string; type: string; block: string }> {
  const source = readFileSync(file, 'utf8');
  const producers: Array<{ file: string; type: string; block: string }> = [];
  for (const needle of ["insertInto('job_queue')", 'jobQueue.enqueue({']) {
    let index = 0;
    while ((index = source.indexOf(needle, index)) !== -1) {
      const block = source.slice(Math.max(0, index - 2000), Math.min(source.length, index + 1200));
      const afterQueueCall = source.slice(index, Math.min(source.length, index + 1200));
      const literalType = afterQueueCall.match(/type:\s*'([^']+)'/)?.[1];
      if (literalType) producers.push({ file, type: literalType, block });
      if (afterQueueCall.match(/type:\s*jobType\b/)) {
        for (const type of block.matchAll(/'((?:mail\.sync\.imap|mail\.sync\.pop3))'/g)) {
          producers.push({ file, type: type[1]!, block });
        }
      }
      index += needle.length;
    }
  }
  return producers;
}

function makePostSyncDb(messageIds: readonly number[]) {
  const trx = {
    selectFrom(table: string) {
      const builder: any = {
        select: () => builder,
        where: () => builder,
        orderBy: () => builder,
        limit: () => builder,
        execute: async () => table === 'email_messages'
          ? messageIds.map((id) => ({ id }))
          : [],
      };
      return builder;
    },
  };
  return {
    transaction: () => ({
      execute: async (fn: (inner: typeof trx) => Promise<unknown>) => fn(trx),
    }),
  } as never;
}

function makeInboundDb(input: {
  message: {
    id: number;
    account_id: number | null;
    is_spam: boolean;
    spam_status: string | null;
    spam_score_label: string | null;
  } | undefined;
  workflows: Array<{ id: number; account_id: number | null; override_key: string | null }>;
}) {
  const trx = {
    selectFrom(table: string) {
      const builder: any = {
        select: () => builder,
        where: () => builder,
        orderBy: () => builder,
        executeTakeFirst: async () => input.message,
        execute: async () => table === 'email_workflows' ? input.workflows : [],
      };
      return builder;
    },
    updateTable() {
      const builder: any = {
        set: () => builder,
        where: () => builder,
        execute: async () => undefined,
      };
      return builder;
    },
  };
  return {
    transaction: () => ({
      execute: async (fn: (inner: typeof trx) => Promise<unknown>) => fn(trx),
    }),
  } as never;
}
