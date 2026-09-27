/**
 * Schritt eines asynchronen Knotens (z. B. ai.decide) nachträglich in den
 * Ursprungslauf schreiben: das Ergebnis steht dann dort, wo der Knoten
 * eingereiht wurde, auch wenn der Zweig danach endet. Fehlt der Lauf
 * (gelöscht), passiert nichts.
 *
 * Eigenes Modul, damit Job-Handler es ohne Zyklus zu workflow-execution nutzen;
 * hier liegt auch die Aufbewahrung der Details (pruneWorkflowRunStepDetails).
 */
import {
  serializeWorkflowStepDetail,
  WORKFLOW_STEP_DETAIL_RETENTION_DAYS,
  type WorkflowStepDetail,
} from '@simplecrm/core';
import type { Kysely } from 'kysely';

import type { ServerDatabase } from './db/schema';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';

export type DeferredWorkflowStepStatus = 'ok' | 'error' | 'skipped';

export async function appendDeferredWorkflowRunStep(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    runId: number;
    nodeId: string;
    nodeType: string;
    status: DeferredWorkflowStepStatus;
    port: string | null;
    durationMs: number;
    message: string | null;
    detail: WorkflowStepDetail | null;
    now: Date;
  },
): Promise<void> {
  const run = await trx
    .selectFrom('email_workflow_runs')
    .select(['id', 'source_sqlite_id'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.runId)
    .executeTakeFirst();
  if (!run) return;
  const runId = Number(run.id);
  await trx
    .insertInto('email_workflow_run_steps')
    .values({
      workspace_id: input.workspaceId,
      source_sqlite_id: null,
      // Wie workflow-execution: Worker-Läufe tragen die synthetische Quell-ID -id.
      run_source_sqlite_id: run.source_sqlite_id === null || run.source_sqlite_id === undefined
        ? -runId
        : Number(run.source_sqlite_id),
      run_id: runId,
      node_id: input.nodeId,
      node_type: input.nodeType,
      status: input.status,
      port: input.port,
      duration_ms: Math.max(0, Math.round(input.durationMs)),
      message: input.message,
      detail_json: input.detail ? serializeWorkflowStepDetail(input.detail) : null,
      source_row: { origin: 'server_worker' },
      imported_in_run_id: null,
      created_at: input.now,
      updated_at: input.now,
    })
    .execute();
}

const STEP_DETAIL_PRUNE_BATCH = 5_000;
const STEP_DETAIL_PRUNE_MAX_BATCHES = 20;

/**
 * Aufbewahrung der Lauf-Details (Standard 30 Tage): leert detail_json älterer
 * Schritte eines Workspaces; die Schrittzeile bleibt für die Lauf-Übersicht.
 * In Chargen mit eigener Transaktion, damit ein großer Rückstand keine lange
 * Sperre hält. Gibt die Zahl der geleerten Schritte zurück.
 */
export async function pruneWorkflowRunStepDetails(
  options: {
    db: Kysely<ServerDatabase>;
    now?: () => Date;
    applyWorkspaceSession?: WorkspaceSessionApplier;
  },
  workspaceId: string,
): Promise<number> {
  const now = options.now?.() ?? new Date();
  const cutoff = new Date(now.getTime() - WORKFLOW_STEP_DETAIL_RETENTION_DAYS * 24 * 60 * 60_000);
  let cleared = 0;
  for (let batch = 0; batch < STEP_DETAIL_PRUNE_MAX_BATCHES; batch += 1) {
    const changed = await withWorkspaceTransaction(options.db, { workspaceId, role: 'system' }, async (trx) => {
      const ids = await trx
        .selectFrom('email_workflow_run_steps')
        .select('id')
        .where('workspace_id', '=', workspaceId)
        .where('detail_json', 'is not', null)
        .where('created_at', '<', cutoff)
        .orderBy('id', 'asc')
        .limit(STEP_DETAIL_PRUNE_BATCH)
        .execute();
      if (ids.length === 0) return 0;
      await trx
        .updateTable('email_workflow_run_steps')
        .set({ detail_json: null })
        .where('workspace_id', '=', workspaceId)
        .where('id', 'in', ids.map((row) => Number(row.id)))
        .execute();
      return ids.length;
    }, { applySession: options.applyWorkspaceSession });
    cleared += changed;
    if (changed < STEP_DETAIL_PRUNE_BATCH) break;
  }
  return cleared;
}
