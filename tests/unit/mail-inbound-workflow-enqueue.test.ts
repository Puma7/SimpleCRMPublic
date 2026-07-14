import {
  enqueueInboundWorkflowsAfterSpam,
  messageIsSpamOrReviewForWorkflow,
} from '../../packages/server/src/mail-inbound-workflow-enqueue';

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function makeDb(input: {
  message: {
    id: number;
    is_spam: boolean;
    spam_status: string | null;
    spam_score_label: string | null;
  } | undefined;
  workflows?: Array<{ id: number }>;
}) {
  const trx = {
    selectFrom(table: string) {
      const builder: any = {
        select: () => builder,
        where: () => builder,
        orderBy: () => builder,
        executeTakeFirst: async () => input.message,
        execute: async () => input.workflows ?? [],
      };
      if (table === 'email_messages') return builder;
      return builder;
    },
    updateTable() {
      let patch: Record<string, unknown> = {};
      const builder: any = {
        set: (value: Record<string, unknown>) => {
          patch = value;
          return builder;
        },
        where: () => builder,
        execute: async () => {
          if (input.message) Object.assign(input.message, patch);
        },
      };
      return builder;
    },
  };
  return {
    transaction: () => ({
      execute: async (fn: (inner: typeof trx) => Promise<unknown>) => fn(trx),
    }),
  } as any;
}

describe('messageIsSpamOrReviewForWorkflow', () => {
  test('detects spam via flag, status, and label', () => {
    expect(messageIsSpamOrReviewForWorkflow({
      id: 1,
      is_spam: true,
      spam_status: null,
      spam_score_label: null,
    })).toBe(true);
    expect(messageIsSpamOrReviewForWorkflow({
      id: 1,
      is_spam: false,
      spam_status: 'review',
      spam_score_label: null,
    })).toBe(true);
    expect(messageIsSpamOrReviewForWorkflow({
      id: 1,
      is_spam: false,
      spam_status: 'clean',
      spam_score_label: 'spam',
    })).toBe(true);
    expect(messageIsSpamOrReviewForWorkflow({
      id: 1,
      is_spam: false,
      spam_status: 'clean',
      spam_score_label: 'clean',
    })).toBe(false);
  });
});

describe('enqueueInboundWorkflowsAfterSpam', () => {
  test('enqueues inbound workflows only for clean messages', async () => {
    const enqueued: unknown[] = [];
    await enqueueInboundWorkflowsAfterSpam(
      {
        db: makeDb({
          message: {
            id: 11,
            is_spam: false,
            spam_status: 'clean',
            spam_score_label: 'clean',
          },
          workflows: [{ id: 23 }, { id: 24 }],
        }),
        jobQueue: {
          async enqueue(input) {
            enqueued.push(input);
          },
        },
        applyWorkspaceSession: async () => undefined,
      },
      { workspaceId: WORKSPACE_ID, messageId: 11, actorUserId: '22222222-2222-4222-8222-222222222222' },
    );

    expect(enqueued).toEqual([
      {
        workspaceId: WORKSPACE_ID,
        type: 'workflow.execute',
        payload: {
          workspaceId: WORKSPACE_ID,
          workflowId: 23,
          messageId: 11,
          actorUserId: '22222222-2222-4222-8222-222222222222',
          triggerName: 'inbound',
          context: { skipIfMessageSpamOrReview: true },
        },
        maxAttempts: 3,
      },
      {
        workspaceId: WORKSPACE_ID,
        type: 'workflow.execute',
        payload: {
          workspaceId: WORKSPACE_ID,
          workflowId: 24,
          messageId: 11,
          actorUserId: '22222222-2222-4222-8222-222222222222',
          triggerName: 'inbound',
          context: { skipIfMessageSpamOrReview: true },
        },
        maxAttempts: 3,
      },
    ]);
  });

  test('skips enqueue when message is spam or review', async () => {
    const enqueued: unknown[] = [];
    await enqueueInboundWorkflowsAfterSpam(
      {
        db: makeDb({
          message: {
            id: 11,
            is_spam: false,
            spam_status: 'review',
            spam_score_label: 'review',
          },
          workflows: [{ id: 23 }],
        }),
        jobQueue: {
          async enqueue(input) {
            enqueued.push(input);
          },
        },
        applyWorkspaceSession: async () => undefined,
      },
      { workspaceId: WORKSPACE_ID, messageId: 11 },
    );

    expect(enqueued).toEqual([]);
  });
});
