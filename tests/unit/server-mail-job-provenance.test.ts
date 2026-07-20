import { readdirSync, readFileSync } from 'node:fs';

import {
  buildAiAgentJobPlan,
  buildAiClassificationJobPlan,
  buildAiPickCannedJobPlan,
  buildAiReviewJobPlan,
  buildAiReplySuggestionJobPlan,
  buildScheduledSendJobPlan,
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
    expect(buildScheduledSendJobPlan({
      workspaceId: WORKSPACE_ID,
      draftId: 12,
      actorUserId: USER_ID,
    }, WORKSPACE_ID, new Date('2026-07-20T10:00:00.000Z')).actorUserId).toBe(USER_ID);
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
    expect(buildScheduledSendJobPlan(buildTrustedServiceJobPayload({
      workspaceId: WORKSPACE_ID,
      draftId: 12,
    }), WORKSPACE_ID, new Date('2026-07-20T10:00:00.000Z')).trustedService).toBe(true);
  });

  test('source inventory covers every user-or-service mail policy producer with actor or trusted-service provenance', () => {
    const userOrServiceTypes = new Set(SERVER_JOB_POLICIES
      .filter((entry) => entry.kind === 'mail' && entry.actorMode !== 'service')
      .map((entry) => entry.type));
    const producers = findServerSourceFiles('packages/server/src').flatMap((file) => extractQueueProducerBlocks(file)
      .filter((producer) => userOrServiceTypes.has(producer.type)));
    const seenTypes = new Set(producers.map((producer) => producer.type));
    const missingUserOrServiceTypes = [...userOrServiceTypes]
      .filter((type) => !seenTypes.has(type))
      .sort();
    const unprovenanced = producers
      .filter((producer) => !producerHasInitiatingProvenance(producer))
      .map((producer) => ({
        file: producer.file,
        line: producer.line,
        type: producer.type,
        block: producer.block,
      }));

    expect({ missingUserOrServiceTypes, unprovenanced }).toEqual({
      missingUserOrServiceTypes: [],
      unprovenanced: [],
    });
  });
});

function findServerSourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = `${root}/${entry.name}`;
    if (entry.isDirectory()) return findServerSourceFiles(path);
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : [];
  });
}

type QueueProducerBlock = {
  file: string;
  line: number;
  type: string;
  block: string;
};

function extractQueueProducerBlocks(file: string): QueueProducerBlock[] {
  const source = readFileSync(file, 'utf8');
  const producers: QueueProducerBlock[] = [];
  for (const needle of ["insertInto('job_queue')", 'jobQueue.enqueue({']) {
    let index = 0;
    while ((index = source.indexOf(needle, index)) !== -1) {
      const line = source.slice(0, index).split('\n').length;
      const block = source.slice(Math.max(0, index - 2000), Math.min(source.length, index + 1200));
      const afterQueueCall = source.slice(index, Math.min(source.length, index + 1200));
      const literalType = afterQueueCall.match(/type:\s*'([^']+)'/)?.[1];
      if (literalType) producers.push({ file, line, type: literalType, block });
      if (afterQueueCall.match(/type:\s*jobType\b/)) {
        for (const type of block.matchAll(/'((?:mail\.sync\.imap|mail\.sync\.pop3))'/g)) {
          producers.push({ file, line, type: type[1]!, block });
        }
      }
      index += needle.length;
    }
  }
  return producers;
}

function producerHasInitiatingProvenance(producer: QueueProducerBlock): boolean {
  const source = readFileSync(producer.file, 'utf8');
  if (hasProvenanceEvidence(producer.block, source)) return true;

  const payloadFunctionName = producer.block.match(/payload:\s*([A-Za-z0-9_]+)\(/)?.[1];
  if (!payloadFunctionName) return false;

  const functionBlock = extractFunctionBlock(source, payloadFunctionName);
  return functionBlock !== undefined && hasProvenanceEvidence(functionBlock, source);
}

function hasProvenanceEvidence(block: string, source: string): boolean {
  if (/actorUserId|buildTrustedServiceJobPayload|TRUSTED_SERVICE_JOB_MARKER_FIELD/.test(block)) return true;
  for (const match of block.matchAll(/\b(workflowJobProvenance|with[A-Za-z]+Provenance)\s*\(/g)) {
    const helperBlock = extractFunctionBlock(source, match[1]!);
    if (helperBlock && /actorUserId|buildTrustedServiceJobPayload|TRUSTED_SERVICE_JOB_MARKER_FIELD/.test(helperBlock)) {
      return true;
    }
  }
  return false;
}

function extractFunctionBlock(source: string, functionName: string): string | undefined {
  const start = source.search(new RegExp(`function\\s+${escapeRegExp(functionName)}\\s*\\(`));
  if (start === -1) return undefined;
  const openBrace = source.indexOf('{', start);
  if (openBrace === -1) return undefined;
  const closeBrace = findMatchingBrace(source, openBrace);
  return closeBrace === -1 ? undefined : source.slice(openBrace, closeBrace + 1);
}

function findMatchingBrace(source: string, openBrace: number): number {
  let depth = 0;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
