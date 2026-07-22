import type { Kysely, Selectable } from 'kysely';

import type { ServerJobQueueApiPort } from './api/types';
import type { EmailMessagesTable, EmailWorkflowsTable, ServerDatabase } from './db';
import { withWorkspaceTransaction, type WorkspaceSessionApplier } from './db/workspace-context';
import { buildTrustedServiceJobPayload } from './jobs/policy';

type InboundWorkflowRow = Pick<Selectable<EmailWorkflowsTable>, 'id' | 'account_id' | 'override_key'>;
type MessageSpamRow = Pick<
  Selectable<EmailMessagesTable>,
  'id' | 'account_id' | 'is_spam' | 'spam_status' | 'spam_score_label'
>;

export type InboundWorkflowEnqueueOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  jobQueue: ServerJobQueueApiPort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export function messageIsSpamOrReviewForWorkflow(message: MessageSpamRow): boolean {
  const status = String(message.spam_status ?? '').toLowerCase();
  const label = String(message.spam_score_label ?? '').toLowerCase();
  return (
    message.is_spam === true
    || status === 'spam'
    || status === 'review'
    || label === 'spam'
    || label === 'review'
  );
}

/** Enqueue inbound workflow jobs only after spam/security scoring has committed. */
export async function enqueueInboundWorkflowsAfterSpam(
  options: InboundWorkflowEnqueueOptions,
  input: {
    workspaceId: string;
    messageId: number;
    actorUserId?: string;
  },
): Promise<void> {
  const message = await withWorkspaceTransaction(
    options.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => trx
      .selectFrom('email_messages')
      .select(['id', 'account_id', 'is_spam', 'spam_status', 'spam_score_label'])
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.messageId)
      .executeTakeFirst(),
    { applySession: options.applyWorkspaceSession },
  );
  if (!message) return;

  if (!messageIsSpamOrReviewForWorkflow(message)) {
    const workflows = await withWorkspaceTransaction(
      options.db,
      { workspaceId: input.workspaceId, role: 'system' },
      async (trx) => {
        let query = trx
          .selectFrom('email_workflows')
          .select(['id', 'account_id', 'override_key'])
          .where('workspace_id', '=', input.workspaceId)
          .where('trigger_name', '=', 'inbound')
          .where('enabled', '=', true);
        query = message.account_id == null
          ? query.where('account_id', 'is', null)
          : query.where((eb) => eb.or([
            eb('account_id', 'is', null),
            eb('account_id', '=', message.account_id),
          ]));
        return query
          .orderBy('priority', 'asc')
          .orderBy('id', 'asc')
          .execute() as Promise<InboundWorkflowRow[]>;
      },
      { applySession: options.applyWorkspaceSession },
    );

    for (const workflow of resolveScopedInboundWorkflowOverrides(workflows)) {
      await options.jobQueue.enqueue({
        workspaceId: input.workspaceId,
        type: 'workflow.execute',
        payload: withInboundWorkflowProvenance(input.actorUserId, {
          workspaceId: input.workspaceId,
          workflowId: Number(workflow.id),
          messageId: input.messageId,
          triggerName: 'inbound',
          context: { skipIfMessageSpamOrReview: true },
        }),
        maxAttempts: 3,
      });
    }
  }

  await withWorkspaceTransaction(
    options.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => trx
      .updateTable('email_messages')
      .set({ post_process_done: true })
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.messageId)
      .execute(),
    { applySession: options.applyWorkspaceSession },
  );
}

function withInboundWorkflowProvenance(actorUserId: string | undefined, payload: Record<string, unknown>): Record<string, unknown> {
  return actorUserId ? { ...payload, actorUserId } : buildTrustedServiceJobPayload(payload);
}

function resolveScopedInboundWorkflowOverrides(rows: readonly InboundWorkflowRow[]): InboundWorkflowRow[] {
  const byOverride = new Map<string, InboundWorkflowRow>();
  const unkeyed: InboundWorkflowRow[] = [];
  for (const row of rows) {
    const key = typeof row.override_key === 'string' && row.override_key.trim() ? row.override_key.trim() : null;
    if (!key) {
      unkeyed.push(row);
      continue;
    }
    const existing = byOverride.get(key);
    if (!existing || (existing.account_id === null && row.account_id !== null)) byOverride.set(key, row);
  }
  const selectedIds = new Set(Array.from(byOverride.values(), (row) => Number(row.id)));
  return rows.filter((row) => {
    const key = typeof row.override_key === 'string' && row.override_key.trim() ? row.override_key.trim() : null;
    return key ? selectedIds.has(Number(row.id)) : unkeyed.includes(row);
  });
}
