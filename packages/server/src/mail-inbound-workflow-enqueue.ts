import type { Kysely, Selectable } from 'kysely';

import type { ServerJobQueueApiPort } from './api/types';
import type { EmailMessagesTable, EmailWorkflowsTable, ServerDatabase } from './db';
import { withWorkspaceTransaction, type WorkspaceSessionApplier } from './db/workspace-context';

type InboundWorkflowRow = Pick<Selectable<EmailWorkflowsTable>, 'id'>;
type MessageSpamRow = Pick<
  Selectable<EmailMessagesTable>,
  'id' | 'is_spam' | 'spam_status' | 'spam_score_label'
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
      .select(['id', 'is_spam', 'spam_status', 'spam_score_label'])
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.messageId)
      .executeTakeFirst(),
    { applySession: options.applyWorkspaceSession },
  );
  if (!message || messageIsSpamOrReviewForWorkflow(message)) return;

  const workflows = await withWorkspaceTransaction(
    options.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => trx
      .selectFrom('email_workflows')
      .select(['id'])
      .where('workspace_id', '=', input.workspaceId)
      .where('trigger_name', '=', 'inbound')
      .where('enabled', '=', true)
      .orderBy('priority', 'asc')
      .orderBy('id', 'asc')
      .execute() as Promise<InboundWorkflowRow[]>,
    { applySession: options.applyWorkspaceSession },
  );

  for (const workflow of workflows) {
    await options.jobQueue.enqueue({
      workspaceId: input.workspaceId,
      type: 'workflow.execute',
      payload: {
        workspaceId: input.workspaceId,
        workflowId: Number(workflow.id),
        messageId: input.messageId,
        ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
        triggerName: 'inbound',
        context: { skipIfMessageSpamOrReview: true },
      },
      maxAttempts: 3,
    });
  }
}
