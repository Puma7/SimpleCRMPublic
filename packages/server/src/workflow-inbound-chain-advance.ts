/**
 * Advance the inbound priority chain after an async child job fails terminally
 * without enqueueing a workflow continuation (HTTP without error edge, AI child
 * crash, auth denial, etc.).
 *
 * Chain hops are claimed via sync_info so concurrent sibling deferred
 * continuations (or already_applied hops) cannot enqueue the same next
 * workflow more than once.
 *
 * When a trigger fans out into multiple deferred branches, a join barrier
 * (also sync_info) delays mark-applied / chain advance until every sibling
 * has finished — otherwise a lower-priority workflow can start mid-run.
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

/** Stable claim key for one hop from chain.index → nextIndex. */
export function inboundChainHopClaimKey(
  messageId: number,
  chain: InboundWorkflowChainContext,
  nextIndex: number,
): string {
  return `inbound_chain_hop:${messageId}:${chain.workflowIds.join(',')}:${nextIndex}`;
}

/**
 * Join barrier for multi-deferred trigger fan-out. Continuations may not share
 * the original run id, so the key is message + workflow (or chain slot).
 */
export function inboundDeferredJoinKey(
  messageId: number,
  workflowId: number,
  chain: InboundWorkflowChainContext | null,
): string {
  if (chain) {
    return `inbound_deferred_join:${messageId}:${chain.workflowIds.join(',')}:${chain.index}`;
  }
  return `inbound_deferred_join:${messageId}:${workflowId}`;
}

function encodeDeferredJoinValue(pending: number, chainStop: boolean): string {
  return `${pending}|${chainStop ? 1 : 0}`;
}

function parseDeferredJoinValue(raw: string | null | undefined): { pending: number; chainStop: boolean } | null {
  if (!raw) return null;
  const [pendingRaw, stopRaw] = raw.split('|');
  const pending = Number(pendingRaw);
  if (!Number.isInteger(pending) || pending < 0) return null;
  return { pending, chainStop: stopRaw === '1' };
}

/**
 * Atomically claim the right to enqueue the next inbound priority workflow.
 * Returns true only for the first winner; later sibling / already_applied hops
 * return false so the same next workflow is not inserted twice.
 */
export async function tryClaimInboundChainHop(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId: number;
    chain: InboundWorkflowChainContext;
    nextIndex: number;
    now: Date;
  },
): Promise<boolean> {
  const key = inboundChainHopClaimKey(input.messageId, input.chain, input.nextIndex);
  const inserted = await trx
    .insertInto('sync_info')
    .values({
      workspace_id: input.workspaceId,
      key,
      value: '1',
      last_updated: input.now,
      source_row: { origin: 'inbound_chain_hop' },
      imported_in_run_id: null,
      updated_at: input.now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doNothing())
    .returning('key')
    .executeTakeFirst();
  return Boolean(inserted);
}

/** Record how many deferred trigger branches must finish before chain advance. */
export async function initInboundDeferredJoin(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId: number;
    workflowId: number;
    chain: InboundWorkflowChainContext | null;
    pendingCount: number;
    now: Date;
  },
): Promise<void> {
  if (input.pendingCount <= 1) return;
  const key = inboundDeferredJoinKey(input.messageId, input.workflowId, input.chain);
  await trx
    .insertInto('sync_info')
    .values({
      workspace_id: input.workspaceId,
      key,
      value: encodeDeferredJoinValue(input.pendingCount, false),
      last_updated: input.now,
      source_row: { origin: 'inbound_deferred_join' },
      imported_in_run_id: null,
      updated_at: input.now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doNothing())
    .execute();
}

/**
 * One deferred sibling finished. Returns:
 * - `wait` — other siblings still running (do not mark/advance)
 * - `stop` — all siblings done but a chain-stop was seen (do not advance)
 * - `ready` — no join barrier, or all siblings done without chain-stop (may advance)
 */
export async function completeInboundDeferredJoinSibling(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId: number;
    workflowId: number;
    chain: InboundWorkflowChainContext | null;
    chainStop: boolean;
    now: Date;
  },
): Promise<'wait' | 'stop' | 'ready'> {
  const key = inboundDeferredJoinKey(input.messageId, input.workflowId, input.chain);
  const row = await trx
    .selectFrom('sync_info')
    .select(['value'])
    .where('workspace_id', '=', input.workspaceId)
    .where('key', '=', key)
    .forUpdate()
    .executeTakeFirst();
  if (!row) return 'ready';

  const parsed = parseDeferredJoinValue(row.value);
  if (!parsed) {
    await trx
      .deleteFrom('sync_info')
      .where('workspace_id', '=', input.workspaceId)
      .where('key', '=', key)
      .execute();
    return 'ready';
  }

  const pending = Math.max(0, parsed.pending - 1);
  const chainStop = parsed.chainStop || input.chainStop;
  if (pending > 0) {
    await trx
      .updateTable('sync_info')
      .set({
        value: encodeDeferredJoinValue(pending, chainStop),
        last_updated: input.now,
        updated_at: input.now,
      })
      .where('workspace_id', '=', input.workspaceId)
      .where('key', '=', key)
      .execute();
    return 'wait';
  }

  await trx
    .deleteFrom('sync_info')
    .where('workspace_id', '=', input.workspaceId)
    .where('key', '=', key)
    .execute();
  return chainStop ? 'stop' : 'ready';
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

  const currentWorkflowId = parsed.chain.workflowIds[parsed.chain.index];
  if (currentWorkflowId == null) return false;
  const join = await completeInboundDeferredJoinSibling(trx, {
    workspaceId: parsed.workspaceId,
    messageId: parsed.messageId,
    workflowId: currentWorkflowId,
    chain: parsed.chain,
    chainStop: false,
    now,
  });
  if (join !== 'ready') return false;

  const claimed = await tryClaimInboundChainHop(trx, {
    workspaceId: parsed.workspaceId,
    messageId: parsed.messageId,
    chain: parsed.chain,
    nextIndex,
    now,
  });
  if (!claimed) return false;

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
