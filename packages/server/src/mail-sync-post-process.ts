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
const REPLY_SUGGESTION_DELAY_MS = 60_000;
const VACATION_AUTO_REPLY_DELAY_MS = 120_000;

type CandidateMessageRow = Pick<Selectable<EmailMessagesTable>, 'id'>;

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
      const suppressed = new Set(uniquePositiveIds(input.result?.automatedEvidenceMessageIds ?? []));
      const postSyncMessageIds = (await resolvePostSyncMessageIds(options, { ...input, limit }))
        .filter((messageId) => !suppressed.has(messageId));
      const spamScoringMessageIds = inboundSpamScoringMessageIds(input.result)
        .filter((messageId) => !suppressed.has(messageId));

      for (const messageId of spamScoringMessageIds) {
        await options.jobQueue.enqueue({
          workspaceId: input.workspaceId,
          type: 'mail.spam.score',
          payload: {
            workspaceId: input.workspaceId,
            messageId,
            ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
            applyStatus: true,
            runSecurityCheck: true,
            enqueueInboundWorkflows: true,
          },
          maxAttempts: 3,
        });
      }

      const replySuggestionRunAfter = new Date(input.syncFinishedAt.getTime() + REPLY_SUGGESTION_DELAY_MS);
      for (const messageId of postSyncMessageIds) {
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
      for (const messageId of postSyncMessageIds) {
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

function inboundSpamScoringMessageIds(result: MailSyncJobResult | null): number[] {
  if (!result) return [];
  return uniquePositiveIds(result.inboundMessageIds ?? []);
}

async function resolvePostSyncMessageIds(
  options: PostgresMailSyncPostProcessorOptions,
  input: {
    workspaceId: string;
    accountId: number;
    syncStartedAt: Date;
    result: MailSyncJobResult | null;
    limit: number;
  },
): Promise<number[]> {
  const explicitIds = explicitReplySuggestionMessageIds(input.result);
  if (explicitIds.length > 0) return explicitIds.slice(0, input.limit);
  return selectPostSyncInboundMessageIds(options, {
    workspaceId: input.workspaceId,
    accountId: input.accountId,
    syncStartedAt: input.syncStartedAt,
    limit: input.limit,
  });
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
