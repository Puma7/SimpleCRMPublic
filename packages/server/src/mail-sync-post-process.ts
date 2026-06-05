import type { Kysely, Selectable } from 'kysely';

import type { ServerJobQueueApiPort } from './api/types';
import type { EmailMessagesTable, EmailWorkflowsTable, ServerDatabase } from './db';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
} from './db/workspace-context';
import type { MailSyncJobResult, MailSyncPostProcessPort } from './jobs';

const DEFAULT_POST_SYNC_LIMIT = 250;
const MAX_POST_SYNC_LIMIT = 1000;
const INBOUND_WORKFLOW_DELAY_MS = 10_000;
const REPLY_SUGGESTION_DELAY_MS = 60_000;
const VACATION_AUTO_REPLY_DELAY_MS = 120_000;

type CandidateMessageRow = Pick<Selectable<EmailMessagesTable>, 'id'>;
type InboundWorkflowRow = Pick<Selectable<EmailWorkflowsTable>, 'id'>;

export type PostgresMailSyncPostProcessorOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  jobQueue: ServerJobQueueApiPort;
  limit?: number;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export function createPostgresMailSyncPostProcessor(
  options: PostgresMailSyncPostProcessorOptions,
): MailSyncPostProcessPort {
  const limit = normalizeLimit(options.limit);
  return {
    async afterSync(input) {
      const explicitIds = explicitReplySuggestionMessageIds(input.result);
      const messageIds = explicitIds.length > 0
        ? explicitIds.slice(0, limit)
        : await selectPostSyncInboundMessageIds(options, {
          workspaceId: input.workspaceId,
          accountId: input.accountId,
          syncStartedAt: input.syncStartedAt,
          limit,
        });

      for (const messageId of messageIds) {
        await options.jobQueue.enqueue({
          workspaceId: input.workspaceId,
          type: 'mail.spam.score',
          payload: {
            workspaceId: input.workspaceId,
            messageId,
            ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
            applyStatus: true,
            runSecurityCheck: true,
          },
          maxAttempts: 3,
        });
      }

      const inboundWorkflows = messageIds.length === 0
        ? []
        : await selectEnabledInboundWorkflowIds(options, input.workspaceId);
      const inboundWorkflowRunAfter = new Date(input.syncFinishedAt.getTime() + INBOUND_WORKFLOW_DELAY_MS);
      for (const messageId of messageIds) {
        for (const workflow of inboundWorkflows) {
          await options.jobQueue.enqueue({
            workspaceId: input.workspaceId,
            type: 'workflow.execute',
            payload: {
              workspaceId: input.workspaceId,
              workflowId: Number(workflow.id),
              messageId,
              ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
              triggerName: 'inbound',
              context: { skipIfMessageSpamOrReview: true },
            },
            runAfter: inboundWorkflowRunAfter,
            maxAttempts: 3,
          });
        }
      }

      const replySuggestionRunAfter = new Date(input.syncFinishedAt.getTime() + REPLY_SUGGESTION_DELAY_MS);
      for (const messageId of messageIds) {
        await options.jobQueue.enqueue({
          workspaceId: input.workspaceId,
          type: 'ai.reply_suggestion',
          payload: {
            workspaceId: input.workspaceId,
            messageId,
            ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
            trigger: 'inbound',
            force: false,
          },
          runAfter: replySuggestionRunAfter,
          maxAttempts: 3,
        });
      }

      const vacationRunAfter = new Date(input.syncFinishedAt.getTime() + VACATION_AUTO_REPLY_DELAY_MS);
      for (const messageId of messageIds) {
        await options.jobQueue.enqueue({
          workspaceId: input.workspaceId,
          type: 'mail.vacation.auto_reply',
          payload: {
            workspaceId: input.workspaceId,
            messageId,
            ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
          },
          runAfter: vacationRunAfter,
          maxAttempts: 3,
        });
      }
    },
  };
}

function explicitReplySuggestionMessageIds(result: MailSyncJobResult | null): number[] {
  if (!result) return [];
  return uniquePositiveIds([
    ...(result.replySuggestionMessageIds ?? []),
    ...(result.inboundMessageIds ?? []),
  ]);
}

async function selectPostSyncInboundMessageIds(
  options: PostgresMailSyncPostProcessorOptions,
  input: {
    workspaceId: string;
    accountId: number;
    syncStartedAt: Date;
    limit: number;
  },
): Promise<number[]> {
  const rows = await withWorkspaceTransaction(
    options.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => trx
      .selectFrom('email_messages')
      .select(['id'])
      .where('workspace_id', '=', input.workspaceId)
      .where('account_id', '=', input.accountId)
      .where('folder_kind', '=', 'inbox')
      .where('soft_deleted', '=', false)
      .where('is_spam', '=', false)
      .where('updated_at', '>=', input.syncStartedAt)
      .orderBy('updated_at', 'desc')
      .limit(input.limit)
      .execute() as Promise<CandidateMessageRow[]>,
    { applySession: options.applyWorkspaceSession },
  );
  return uniquePositiveIds(rows.map((row) => Number(row.id)));
}

async function selectEnabledInboundWorkflowIds(
  options: PostgresMailSyncPostProcessorOptions,
  workspaceId: string,
): Promise<InboundWorkflowRow[]> {
  return withWorkspaceTransaction(
    options.db,
    { workspaceId, role: 'system' },
    async (trx) => trx
      .selectFrom('email_workflows')
      .select(['id'])
      .where('workspace_id', '=', workspaceId)
      .where('trigger_name', '=', 'inbound')
      .where('enabled', '=', true)
      .orderBy('priority', 'asc')
      .orderBy('id', 'asc')
      .execute() as Promise<InboundWorkflowRow[]>,
    { applySession: options.applyWorkspaceSession },
  );
}

function uniquePositiveIds(values: readonly unknown[]): number[] {
  const seen = new Set<number>();
  const result: number[] = [];
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return DEFAULT_POST_SYNC_LIMIT;
  return Math.max(1, Math.min(MAX_POST_SYNC_LIMIT, Math.trunc(value)));
}
