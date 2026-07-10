import { sql, type Kysely, type Selectable } from 'kysely';

import type { MailThreadBackfillApiPort, MailThreadBackfillResult } from './api/types';
import type { EmailMessagesTable, ServerDatabase } from './db';
import { accountSyncAdvisoryLockKey } from './jobs/policy';
import {
  resolveReferenceThreadForSync,
  refreshThreadAggregateAfterSync,
} from './db/postgres-mail-metadata-read-ports';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';

const DEFAULT_BACKFILL_LIMIT = 5_000;
const MAX_BACKFILL_LIMIT = 100_000;
const SELECT_BATCH_SIZE = 500;
// Subjects carrying a bracketed ticket token — the resolver's subject-ticket
// branch can thread these even without RFC threading headers.
const TICKET_SUBJECT_PATTERN = '\\[[A-Za-z0-9]{1,12}-[A-Za-z0-9]{1,20}\\]';

type UnthreadedRow = Pick<
  Selectable<EmailMessagesTable>,
  'id' | 'account_id' | 'message_id' | 'in_reply_to' | 'references_header' | 'subject'
>;

export type PostgresMailThreadBackfillOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

/**
 * One-time historical backfill: reference-thread rows that were synced before
 * the sync thread resolver existed (thread_id still null). Runs the SAME
 * resolver the sync path uses so the result matches new-mail threading, but
 * passes excludeMessageId so a row already in the table isn't seen as its own
 * sibling. Idempotent and re-runnable — a row threaded by a sibling's pass is
 * re-checked and skipped. Each row is threaded in its own transaction so a large
 * mailbox doesn't hold one long-running transaction.
 */
export function createPostgresMailThreadBackfillPort(
  options: PostgresMailThreadBackfillOptions,
): MailThreadBackfillApiPort {
  return {
    async backfill(input): Promise<MailThreadBackfillResult> {
      const limit = normalizeLimit(input.limit);
      const now = new Date();
      let scanned = 0;
      let threaded = 0;
      let cursor = 0;

      while (scanned < limit) {
        const rows = await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          (trx) => selectUnthreadedBatch(trx, input.workspaceId, cursor),
          { applySession: options.applyWorkspaceSession },
        );
        if (rows.length === 0) break;
        cursor = Number(rows[rows.length - 1]!.id);

        for (const row of rows) {
          if (scanned >= limit) break;
          scanned += 1;
          const accountId = row.account_id == null ? null : Number(row.account_id);
          // account-scoped resolver can't thread an account-less row.
          if (accountId == null) continue;
          const didThread = await withWorkspaceTransaction(
            options.db,
            { workspaceId: input.workspaceId, role: 'system' },
            (trx) => threadOneRow(trx, input.workspaceId, Number(row.id), accountId, row, now),
            { applySession: options.applyWorkspaceSession },
          );
          if (didThread) threaded += 1;
        }
      }

      return { success: true, scanned, threaded };
    },
  };
}

export function createNoopMailThreadBackfillPort(): MailThreadBackfillApiPort {
  return {
    async backfill() {
      return { success: true, scanned: 0, threaded: 0 };
    },
  };
}

async function selectUnthreadedBatch(
  trx: WorkspaceTransaction,
  workspaceId: string,
  cursor: number,
): Promise<UnthreadedRow[]> {
  return trx
    .selectFrom('email_messages')
    .select(['id', 'account_id', 'message_id', 'in_reply_to', 'references_header', 'subject'])
    .where('workspace_id', '=', workspaceId)
    .where('thread_id', 'is', null)
    // thread_resolver_version marks rows the resolver has already attempted; skip
    // them so a rerun advances past standalone/unthreadable rows instead of
    // rescanning from the top every time.
    .where('thread_resolver_version', '=', 0)
    .where('soft_deleted', '=', false)
    // The account-scoped resolver can't thread an account-less row.
    .where('account_id', 'is not', null)
    .where('id', '>', cursor)
    // Only rows with a threading signal are worth resolving: RFC headers, or a
    // bracketed subject ticket the resolver's subject-ticket branch can attach.
    .where((eb) => eb.or([
      eb('message_id', 'is not', null),
      eb('in_reply_to', 'is not', null),
      eb('references_header', 'is not', null),
      sql<boolean>`subject ~ ${TICKET_SUBJECT_PATTERN}`,
    ]))
    .orderBy('id', 'asc')
    .limit(SELECT_BATCH_SIZE)
    .execute() as Promise<UnthreadedRow[]>;
}

async function threadOneRow(
  trx: WorkspaceTransaction,
  workspaceId: string,
  id: number,
  accountId: number,
  row: UnthreadedRow,
  now: Date,
): Promise<boolean> {
  // Take the SAME per-account advisory lock the live sync path holds, so a
  // backfill can't race a concurrent sync (or a second backfill) and mint a
  // different thread for the same conversation. Auto-released on commit/rollback.
  await sql`SELECT pg_advisory_xact_lock(hashtext(${accountSyncAdvisoryLockKey(accountId)}))`
    .execute(trx);

  // Re-check under the row's own transaction: a previous row's backfill (or a
  // concurrent live sync) may have threaded it already.
  const current = await trx
    .selectFrom('email_messages')
    .select(['thread_id'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', id)
    .executeTakeFirst();
  if (!current || current.thread_id) return false;

  const resolved = await resolveReferenceThreadForSync(trx, {
    workspaceId,
    accountId,
    messageId: row.message_id,
    inReplyTo: row.in_reply_to,
    referencesHeader: row.references_header,
    subject: row.subject,
    now,
    excludeMessageId: id,
  });
  if (!resolved.threadId) {
    // Standalone / unthreadable for now — mark it attempted so reruns advance
    // instead of rescanning it. A later live sync of a sibling still threads it
    // via backfillNullSiblings, which sets thread_id regardless of this marker.
    await trx
      .updateTable('email_messages')
      .set({ thread_resolver_version: 1, updated_at: now })
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', id)
      .execute();
    return false;
  }

  await trx
    .updateTable('email_messages')
    .set({
      thread_id: resolved.threadId,
      ...(resolved.ticketCode
        ? { ticket_code: sql`coalesce(ticket_code, ${resolved.ticketCode})` }
        : {}),
      thread_resolver_version: 1,
      updated_at: now,
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', id)
    .execute();
  await refreshThreadAggregateAfterSync(trx, workspaceId, resolved.threadId, now);
  return true;
}

function normalizeLimit(value: number | undefined): number {
  if (value === undefined) return DEFAULT_BACKFILL_LIMIT;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('Mail thread backfill limit must be a positive integer');
  }
  return Math.min(value, MAX_BACKFILL_LIMIT);
}
