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

/**
 * Direkt gestempelte ids eines TERMINALEN Kindjobs — der Ersatz fuer den
 * Kettenkontext, wenn der Lauf gar keine Kette hat.
 *
 * Bewusst nur fuer explizit als terminal markierte Payloads: `failJob` ruft den
 * Kettenabschluss fuer JEDEN endgueltig gescheiterten Job auf, und ein
 * beliebiger Job mit `workflowId` duerfte keine fremde Join-Barriere anfassen.
 */
function terminalChildIdsFromPayload(payload: Record<string, unknown>): {
  workspaceId: string;
  messageId: number;
  workflowId: number;
} | null {
  if (payload.terminalWorkflowCompletion !== true) return null;
  const workspaceId = typeof payload.workspaceId === 'string' ? payload.workspaceId.trim() : '';
  const messageId = positiveInt(payload.messageId);
  const workflowId = positiveInt(payload.workflowId);
  if (!workspaceId || messageId == null || workflowId == null) return null;
  return { workspaceId, messageId, workflowId };
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

/**
 * Join-Wert: `pending|chainStop|error`.
 *
 * Das dritte Feld transportiert einen akkumulierten Fehler über die Barriere:
 * endet ein Trigger-Zweig synchron mit `error`, während ein anderer deferiert,
 * darf der später abschließende Kindjob den Workflow NICHT als angewendet
 * markieren — ohne deferiertes Geschwister täte er das ebenfalls nicht.
 * Alte Zeilen ohne drittes Feld werden als `error=false` gelesen.
 */
function encodeDeferredJoinValue(pending: number, chainStop: boolean, error: boolean): string {
  return `${pending}|${chainStop ? 1 : 0}|${error ? 1 : 0}`;
}

function parseDeferredJoinValue(
  raw: string | null | undefined,
): { pending: number; chainStop: boolean; error: boolean } | null {
  if (!raw) return null;
  const [pendingRaw, stopRaw, errorRaw] = raw.split('|');
  const pending = Number(pendingRaw);
  if (!Number.isInteger(pending) || pending < 0) return null;
  return { pending, chainStop: stopRaw === '1', error: errorRaw === '1' };
}

/**
 * `ready_error` = alle Geschwister fertig, aber mindestens eines endete mit
 * Fehler: die Kette darf weiterschalten, der Workflow gilt aber nicht als
 * angewendet.
 */
export type InboundDeferredJoinState = 'wait' | 'stop' | 'ready' | 'ready_error';

/** Darf nach diesem Join-Zustand weitergeschaltet werden? */
export function inboundJoinAllowsAdvance(state: InboundDeferredJoinState): boolean {
  return state === 'ready' || state === 'ready_error';
}

export type InboundChainPgClient = Readonly<{
  query: (
    sql: string,
    values?: readonly unknown[],
  ) => Promise<unknown>;
}>;

function asPgQueryResult(value: unknown): {
  rowCount?: number | null;
  rows?: ReadonlyArray<{ value?: string | null }>;
} {
  if (!value || typeof value !== 'object') return {};
  return value as {
    rowCount?: number | null;
    rows?: ReadonlyArray<{ value?: string | null }>;
  };
}

/** Graphile/pg-client variant of {@link completeInboundDeferredJoinSibling}. */
export async function completeInboundDeferredJoinSiblingOnPgClient(
  client: InboundChainPgClient,
  input: {
    workspaceId: string;
    messageId: number;
    workflowId: number;
    chain: InboundWorkflowChainContext | null;
    chainStop: boolean;
    error?: boolean;
    now: Date;
  },
): Promise<InboundDeferredJoinState> {
  const key = inboundDeferredJoinKey(input.messageId, input.workflowId, input.chain);
  const locked = asPgQueryResult(await client.query(
    `SELECT value
       FROM sync_info
      WHERE workspace_id = $1
        AND key = $2
      FOR UPDATE`,
    [input.workspaceId, key],
  ));
  const row = locked.rows?.[0];
  if (!row) return 'ready';

  const parsed = parseDeferredJoinValue(row.value);
  if (!parsed) {
    await client.query(
      `DELETE FROM sync_info
        WHERE workspace_id = $1
          AND key = $2`,
      [input.workspaceId, key],
    );
    return 'ready';
  }

  const pending = Math.max(0, parsed.pending - 1);
  const chainStop = parsed.chainStop || input.chainStop;
  const error = parsed.error || input.error === true;
  if (pending > 0) {
    await client.query(
      `UPDATE sync_info
          SET value = $3,
              last_updated = $4,
              updated_at = $4
        WHERE workspace_id = $1
          AND key = $2`,
      [input.workspaceId, key, encodeDeferredJoinValue(pending, chainStop, error), input.now],
    );
    return 'wait';
  }

  await client.query(
    `DELETE FROM sync_info
      WHERE workspace_id = $1
        AND key = $2`,
    [input.workspaceId, key],
  );
  // Letztes Geschwister ist durch: den Abort-Marker dieser Fan-out-Runde
  // mitlöschen, sonst überlebt er die Ausführung und ein späterer Backfill /
  // forceWorkflowReapply derselben Nachricht wird an ihm faelschlich
  // abgebrochen (der Schluessel enthaelt keine Ausfuehrungs-ID).
  await client.query(
    `DELETE FROM sync_info
      WHERE workspace_id = $1
        AND key = $2`,
    [input.workspaceId, inboundSiblingAbortKey(input.messageId, input.workflowId, input.chain)],
  );
  if (chainStop) return 'stop';
  return error ? 'ready_error' : 'ready';
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
    /** When true, join completions must not advance the priority chain. */
    chainStop?: boolean;
    /** Ein synchroner Geschwisterzweig endete bereits mit Fehler. */
    error?: boolean;
    now: Date;
  },
): Promise<void> {
  if (input.pendingCount <= 1 && input.chainStop !== true && input.error !== true) return;
  // pendingCount 1 with chainStop still needs a barrier so the single deferred
  // sibling completes into 'stop' instead of advancing.
  const pending = Math.max(1, input.pendingCount);
  const key = inboundDeferredJoinKey(input.messageId, input.workflowId, input.chain);
  await trx
    .insertInto('sync_info')
    .values({
      workspace_id: input.workspaceId,
      key,
      value: encodeDeferredJoinValue(pending, input.chainStop === true, input.error === true),
      last_updated: input.now,
      source_row: { origin: 'inbound_deferred_join' },
      imported_in_run_id: null,
      updated_at: input.now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doNothing())
    .execute();
}

/** Abort key: a sibling blocked/stopped after other branches already deferred. */
export function inboundSiblingAbortKey(
  messageId: number,
  workflowId: number,
  chain: InboundWorkflowChainContext | null,
): string {
  if (chain) {
    return `inbound_sibling_abort:${messageId}:${chain.workflowIds.join(',')}:${chain.index}`;
  }
  return `inbound_sibling_abort:${messageId}:${workflowId}`;
}

export async function markInboundSiblingAbort(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId: number;
    workflowId: number;
    chain: InboundWorkflowChainContext | null;
    reason: string;
    now: Date;
  },
): Promise<void> {
  const key = inboundSiblingAbortKey(input.messageId, input.workflowId, input.chain);
  await trx
    .insertInto('sync_info')
    .values({
      workspace_id: input.workspaceId,
      key,
      value: input.reason.slice(0, 200),
      last_updated: input.now,
      source_row: { origin: 'inbound_sibling_abort' },
      imported_in_run_id: null,
      updated_at: input.now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
      value: input.reason.slice(0, 200),
      last_updated: input.now,
      updated_at: input.now,
    }))
    .execute();
}

export async function isInboundSiblingAborted(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId: number;
    workflowId: number;
    chain: InboundWorkflowChainContext | null;
  },
): Promise<boolean> {
  const key = inboundSiblingAbortKey(input.messageId, input.workflowId, input.chain);
  const row = await trx
    .selectFrom('sync_info')
    .select(['value'])
    .where('workspace_id', '=', input.workspaceId)
    .where('key', '=', key)
    .executeTakeFirst();
  return Boolean(row?.value);
}

/** Cancel pending/running delay jobs so aborted siblings cannot resume later. */
export async function cancelPendingWorkflowDelayedJobsForMessage(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId: number;
    workflowId: number;
    now: Date;
  },
): Promise<void> {
  await trx
    .updateTable('workflow_delayed_jobs')
    .set({
      status: 'cancelled',
      updated_at: input.now,
    })
    .where('workspace_id', '=', input.workspaceId)
    .where('message_id', '=', input.messageId)
    .where('workflow_id', '=', input.workflowId)
    .where('status', 'in', ['pending', 'running'])
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
    error?: boolean;
    now: Date;
  },
): Promise<InboundDeferredJoinState> {
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
  const error = parsed.error || input.error === true;
  if (pending > 0) {
    await trx
      .updateTable('sync_info')
      .set({
        value: encodeDeferredJoinValue(pending, chainStop, error),
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
  // Siehe pgClient-Variante: Abort-Marker dieser Fan-out-Runde mitloeschen.
  await trx
    .deleteFrom('sync_info')
    .where('workspace_id', '=', input.workspaceId)
    .where('key', '=', inboundSiblingAbortKey(input.messageId, input.workflowId, input.chain))
    .execute();
  if (chainStop) return 'stop';
  return error ? 'ready_error' : 'ready';
}

/**
 * Kettenabschluss eines terminalen Kindjobs: Join-Barriere abbauen und — wenn
 * sie das erlaubt — den naechsten Prioritaets-Workflow einreihen.
 *
 * Gibt den Join-Zustand mit zurueck, weil er entscheidet, ob der Aufrufer den
 * Applied-Marker setzen darf: `ready_error` heisst „alle Geschwister durch, aber
 * mindestens eines ist ausgefallen" — dann gilt der Lauf nicht als angewendet.
 * `state: null` ⇒ kein Kettenkontext (oder Nachricht geloescht), nichts zu tun.
 */
export async function advanceInboundChainAfterTerminalChild(
  trx: WorkspaceTransaction,
  payload: Record<string, unknown>,
  input: { error?: boolean; now: Date },
): Promise<{ state: InboundDeferredJoinState | null; advanced: boolean }> {
  const now = input.now;
  const parsed = inboundChainFromJobPayload(payload);
  // Ein kettenloser Inbound-Lauf (Backfill, forceWorkflowReapply) hat keine
  // `inboundWorkflowChain`, faechert aber genauso auf: der Elternlauf legt bei
  // mehreren deferierten Zweigen eine Join-Barriere mit `chain: null` an. Ohne
  // diesen Fallback landete jeder Kindjob sofort bei `state: null`, die
  // Barriere wuerde nie dekrementiert — und der Aufrufer laese `null` als
  // „keine Barriere", sodass schon der erste erfolgreiche Zweig den
  // Applied-Marker setzt, obwohl ein spaeterer noch scheitern kann.
  const fallback = terminalChildIdsFromPayload(payload);
  const workspaceId = parsed?.workspaceId ?? fallback?.workspaceId;
  const messageId = parsed?.messageId ?? fallback?.messageId;
  const currentWorkflowId = (parsed ? parsed.chain.workflowIds[parsed.chain.index] : null)
    ?? fallback?.workflowId;
  if (!workspaceId || messageId == null || currentWorkflowId == null) {
    return { state: null, advanced: false };
  }

  const message = await trx
    .selectFrom('email_messages')
    .select(['id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  if (!message) return { state: null, advanced: false };

  // Die Join-Barriere muss auch dann abgebaut werden, wenn es keinen nächsten
  // Workflow mehr gibt (letzter Kettenplatz). Sonst bliebe die sync_info-Zeile
  // dauerhaft pending, ein erfolgreicher Geschwisterzweig wartet an der
  // veralteten Barriere und initInboundDeferredJoin (ON CONFLICT DO NOTHING)
  // reanimiert denselben Key bei jedem Retry.
  const join = await completeInboundDeferredJoinSibling(trx, {
    workspaceId,
    messageId,
    workflowId: currentWorkflowId,
    chain: parsed?.chain ?? null,
    chainStop: false,
    ...(input.error === true ? { error: true } : {}),
    now,
  });
  if (!inboundJoinAllowsAdvance(join)) return { state: join, advanced: false };
  // Ohne Kette gibt es keine Prioritaetsstufe, die weitergeschaltet werden
  // koennte — die Barriere ist aber abgebaut und der Zustand aussagekraeftig.
  if (!parsed) return { state: join, advanced: false };

  const nextIndex = parsed.chain.index + 1;
  if (nextIndex >= parsed.chain.workflowIds.length) return { state: join, advanced: false };

  const claimed = await tryClaimInboundChainHop(trx, {
    workspaceId: parsed.workspaceId,
    messageId: parsed.messageId,
    chain: parsed.chain,
    nextIndex,
    now,
  });
  if (!claimed) return { state: join, advanced: false };

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
  return { state: join, advanced: true };
}

/**
 * Insert the next priority inbound workflow.execute after a terminal child failure.
 *
 * `error: true` NUR fuer echte endgueltige Fehlschlaege setzen (Job endgueltig
 * gescheitert). Ohne das Flag merkt die Join-Barriere den Ausfall nicht: ein
 * spaeter abschliessender Geschwisterzweig bekaeme `ready` statt `ready_error`
 * und markierte den unvollstaendig gelaufenen Workflow als angewendet. Ein
 * erfolgreicher Abschluss ohne Ausgangskante darf das Flag deshalb nicht setzen.
 */
export async function enqueueNextInboundWorkflowAfterTerminalChildFailure(
  trx: WorkspaceTransaction,
  payload: Record<string, unknown>,
  now: Date,
  options: { error?: boolean } = {},
): Promise<boolean> {
  const { advanced } = await advanceInboundChainAfterTerminalChild(trx, payload, {
    ...(options.error === true ? { error: true } : {}),
    now,
  });
  return advanced;
}
