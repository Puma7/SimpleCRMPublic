import type { Kysely, Selectable } from 'kysely';

import type {
  ServerApiPorts,
  ServerJobQueueApiPort,
  WorkflowInboundBackfillApiPort,
  WorkflowInboundBackfillResult,
} from './api/types';
import type {
  EmailMessagesTable,
  EmailWorkflowsTable,
  ServerDatabase,
} from './db';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';

const DEFAULT_BACKFILL_MESSAGE_LIMIT = 5_000;
const MAX_BACKFILL_MESSAGE_LIMIT = 50_000;
const BACKFILL_SELECT_BATCH_SIZE = 1_000;

type WorkflowCandidate = Pick<Selectable<EmailWorkflowsTable>, 'id'>;
type MessageCandidate = Pick<Selectable<EmailMessagesTable>, 'id' | 'uid' | 'pop3_uidl'>;

export type PostgresWorkflowInboundBackfillOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  jobQueue: ServerJobQueueApiPort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export function createPostgresWorkflowInboundBackfillPort(
  options: PostgresWorkflowInboundBackfillOptions,
): WorkflowInboundBackfillApiPort {
  return {
    async backfill(input): Promise<WorkflowInboundBackfillResult> {
      const limit = normalizeBackfillLimit(input.limit);
      const clearApplied = input.clearApplied !== false;
      const selected = await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const workflows = await selectInboundWorkflows(trx, input.workspaceId);
          const messages = workflows.length === 0
            ? []
            : await selectBackfillMessages(trx, input.workspaceId, limit);
          const clearedApplied = clearApplied && workflows.length > 0 && messages.length > 0
            ? await clearAppliedMarkers(trx, input.workspaceId, workflows, messages)
            : 0;
          return { workflows, messages, clearedApplied };
        },
        { applySession: options.applyWorkspaceSession },
      );

      let queued = 0;
      for (const message of selected.messages) {
        for (const workflow of selected.workflows) {
          await options.jobQueue.enqueue({
            workspaceId: input.workspaceId,
            type: 'workflow.execute',
            payload: {
              workspaceId: input.workspaceId,
              workflowId: Number(workflow.id),
              messageId: Number(message.id),
              triggerName: 'inbound',
              actorUserId: input.actorUserId,
              context: {
                workflowBackfill: true,
                forceWorkflowReapply: true,
              },
            },
            maxAttempts: 3,
          });
          queued += 1;
        }
      }

      return {
        success: true,
        messages: selected.messages.length,
        workflows: selected.workflows.length,
        queued,
        clearedApplied: selected.clearedApplied,
      };
    },
  };
}

export function createNoopWorkflowInboundBackfillPort(): NonNullable<ServerApiPorts['workflowInboundBackfill']> {
  return {
    async backfill() {
      return {
        success: true,
        messages: 0,
        workflows: 0,
        queued: 0,
        clearedApplied: 0,
      };
    },
  };
}

async function selectInboundWorkflows(
  trx: WorkspaceTransaction,
  workspaceId: string,
): Promise<WorkflowCandidate[]> {
  return trx
    .selectFrom('email_workflows')
    .select(['id'])
    .where('workspace_id', '=', workspaceId)
    .where('trigger_name', '=', 'inbound')
    .where('enabled', '=', true)
    .orderBy('id', 'asc')
    .execute() as Promise<WorkflowCandidate[]>;
}

async function selectBackfillMessages(
  trx: WorkspaceTransaction,
  workspaceId: string,
  limit: number,
): Promise<MessageCandidate[]> {
  const messages: MessageCandidate[] = [];
  let cursor = 0;

  while (messages.length < limit) {
    const rows = await trx
      .selectFrom('email_messages')
      .select(['id', 'uid', 'pop3_uidl'])
      .where('workspace_id', '=', workspaceId)
      .where('soft_deleted', '=', false)
      .where('id', '>', cursor)
      .orderBy('id', 'asc')
      .limit(Math.min(BACKFILL_SELECT_BATCH_SIZE, limit))
      .execute() as MessageCandidate[];

    if (rows.length === 0) break;
    cursor = Number(rows[rows.length - 1].id);

    for (const row of rows) {
      if (messages.length >= limit) break;
      if (Number(row.uid) >= 0 || row.pop3_uidl != null) {
        messages.push(row);
      }
    }
  }

  return messages;
}

async function clearAppliedMarkers(
  trx: WorkspaceTransaction,
  workspaceId: string,
  workflows: readonly WorkflowCandidate[],
  messages: readonly MessageCandidate[],
): Promise<number> {
  const workflowIds = workflows.map((workflow) => Number(workflow.id));
  const messageIds = messages.map((message) => Number(message.id));
  const result = await trx
    .deleteFrom('email_message_workflow_applied')
    .where('workspace_id', '=', workspaceId)
    .where('workflow_id', 'in', workflowIds)
    .where('message_id', 'in', messageIds)
    .executeTakeFirst();
  return Number(result.numDeletedRows ?? 0);
}

function normalizeBackfillLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BACKFILL_MESSAGE_LIMIT;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Workflow backfill limit must be a positive integer');
  }
  return Math.min(value, MAX_BACKFILL_MESSAGE_LIMIT);
}
