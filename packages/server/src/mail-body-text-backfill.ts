/**
 * body_text backfill for HTML-only mail (Suche Phase 3). Runs as an
 * application-level batch job instead of migration SQL: email_messages is
 * FORCE ROW LEVEL SECURITY (a migration UPDATE would be a silent no-op) and
 * Postgres' greedy ARE regex semantics made a SQL-side HTML strip
 * destructive — plainTextFromHtml in JS is the correct implementation.
 *
 * Candidates are enumerated cross-workspace with the system+cross-workspace
 * session pattern; updates run in each row's own workspace session. The run
 * advances by id keyset, so it terminates deterministically even when a
 * candidate yields no text, and stops when a full scan finds no candidates.
 */
import { randomUUID } from 'node:crypto';

import { plainTextFromHtml } from '@simplecrm/core';
import type { Kysely } from 'kysely';

import {
  withWorkspaceTransaction,
  type ServerDatabase,
  type WorkspaceSessionApplier,
} from './db';

const BACKFILL_BATCH_SIZE = 100;
const BACKFILL_BATCH_PAUSE_MS = 500;

export type BodyTextBackfillOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

type BackfillCandidateRow = Readonly<{
  id: number;
  workspace_id: string;
  body_html: string | null;
}>;

/**
 * One keyset batch: returns the number of candidates seen (0 = scan done)
 * and the last id for the next batch.
 */
export async function runBodyTextBackfillBatch(
  options: BodyTextBackfillOptions,
  afterId: number,
  limit = BACKFILL_BATCH_SIZE,
): Promise<{ seen: number; lastId: number; updated: number }> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  const rows = (await withWorkspaceTransaction(
    options.db,
    { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
    async (trx) =>
      trx
        .selectFrom('email_messages')
        .select(['id', 'workspace_id', 'body_html'])
        .where('id', '>', afterId)
        .where(kyselySql<boolean>`(body_text IS NULL OR body_text = '')`)
        .where('body_html', 'is not', null)
        .where('body_html', '<>', '')
        .orderBy('id', 'asc')
        .limit(limit)
        .execute(),
    { applySession: options.applyWorkspaceSession },
  )) as unknown as BackfillCandidateRow[];
  if (rows.length === 0) return { seen: 0, lastId: afterId, updated: 0 };

  const byWorkspace = new Map<string, { id: number; text: string }[]>();
  for (const row of rows) {
    const text = plainTextFromHtml(row.body_html ?? '');
    if (!text) continue;
    const list = byWorkspace.get(row.workspace_id) ?? [];
    list.push({ id: Number(row.id), text });
    byWorkspace.set(row.workspace_id, list);
  }
  let updated = 0;
  for (const [workspaceId, updates] of byWorkspace) {
    await withWorkspaceTransaction(
      options.db,
      { workspaceId, role: 'system' },
      async (trx) => {
        for (const u of updates) {
          await trx
            .updateTable('email_messages')
            .set({ body_text: u.text, updated_at: new Date() })
            .where('workspace_id', '=', workspaceId)
            .where('id', '=', u.id)
            .execute();
          updated += 1;
        }
      },
      { applySession: options.applyWorkspaceSession },
    );
  }
  return { seen: rows.length, lastId: Number(rows[rows.length - 1]!.id), updated };
}

/**
 * Self-terminating backfill run after server start: batches with pauses,
 * ends when a full keyset scan finds no more candidates. Never blocks
 * startup; failures abort the run (retried on next start).
 */
export function startBodyTextBackfillRun(
  options: BodyTextBackfillOptions & { batchPauseMs?: number },
): { stop(): void } {
  const pauseMs = options.batchPauseMs ?? BACKFILL_BATCH_PAUSE_MS;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastId = 0;
  let total = 0;

  const tick = async () => {
    if (stopped) return;
    try {
      const result = await runBodyTextBackfillBatch(options, lastId);
      if (stopped) return;
      if (result.seen === 0) {
        if (total > 0) console.warn(`[mail] body_text backfill done (${total} rows)`);
        return;
      }
      lastId = result.lastId;
      total += result.updated;
      timer = setTimeout(() => {
        void tick();
      }, pauseMs);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[mail] body_text backfill aborted (retry next start): ${message}`);
    }
  };

  timer = setTimeout(() => {
    void tick();
  }, pauseMs);

  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
