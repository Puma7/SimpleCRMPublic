/**
 * Advance the inbound priority chain after an async child job fails terminally
 * without enqueueing a workflow continuation (HTTP without error edge, AI child
 * crash, auth denial, etc.).
 */
import type { WorkspaceTransaction } from './db/workspace-context';
import { buildTrustedServiceJobPayload } from './jobs/policy';
import {
  parseInboundWorkflowChain,
  type InboundWorkflowChainContext,
} from './workflow-inbound-chain-context';

function objectRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function positiveInt(value: unknown): number | null {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : null;
}

export function inboundChainFromJobPayload(payload: Record<string, unknown>): {
  chain: InboundWorkflowChainContext;
  workspaceId: string;
  messageId: number;
  actorUserId?: string;
} | null {
  const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId.trim() : '';
  if (!workspaceId) return null;

  const continuation = objectRecord(payload.continuation);
  const context = objectRecord(payload.context);
  const chain = parseInboundWorkflowChain(
    continuation?.inboundWorkflowChain ?? context?.inboundWorkflowChain,
  );
  if (!chain) return null;

  const messageId = positiveInt(payload.messageId)
    ?? positiveInt(continuation?.messageId)
    ?? positiveInt(context?.messageId);
  if (messageId == null) return null;

  const actorUserId = typeof payload.actorUserId === 'string' && payload.actorUserId.trim()
    ? payload.actorUserId.trim()
    : typeof continuation?.actorUserId === 'string' && continuation.actorUserId.trim()
      ? continuation.actorUserId.trim()
      : undefined;

  return { chain, workspaceId, messageId, ...(actorUserId ? { actorUserId } : {}) };
}

/** Insert the next priority inbound workflow.execute after a terminal child failure. */
export async function enqueueNextInboundWorkflowAfterTerminalChildFailure(
  trx: WorkspaceTransaction,
  payload: Record<string, unknown>,
  now: Date,
): Promise<boolean> {
  const parsed = inboundChainFromJobPayload(payload);
  if (!parsed) return false;
  const nextIndex = parsed.chain.index + 1;
  if (nextIndex >= parsed.chain.workflowIds.length) return false;

  const message = await trx
    .selectFrom('email_messages')
    .select(['id'])
    .where('workspace_id', '=', parsed.workspaceId)
    .where('id', '=', parsed.messageId)
    .executeTakeFirst();
  if (!message) return false;

  const jobPayload = parsed.actorUserId
    ? {
      workspaceId: parsed.workspaceId,
      actorUserId: parsed.actorUserId,
      workflowId: parsed.chain.workflowIds[nextIndex]!,
      messageId: parsed.messageId,
      triggerName: 'inbound',
      context: {
        inboundWorkflowChain: { workflowIds: parsed.chain.workflowIds, index: nextIndex },
      },
    }
    : buildTrustedServiceJobPayload({
      workspaceId: parsed.workspaceId,
      workflowId: parsed.chain.workflowIds[nextIndex]!,
      messageId: parsed.messageId,
      triggerName: 'inbound',
      context: {
        inboundWorkflowChain: { workflowIds: parsed.chain.workflowIds, index: nextIndex },
      },
    });

  await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.execute',
      payload: jobPayload,
      run_after: now,
      max_attempts: 3,
      workspace_id: parsed.workspaceId,
      updated_at: now,
    })
    .execute();
  return true;
}
