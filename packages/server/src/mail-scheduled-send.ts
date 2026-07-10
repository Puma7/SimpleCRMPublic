import {
  SCHEDULED_SEND_CLAIMED_AT_PREFIX,
  scheduledSendClaimedAtKey,
  scheduledSendFailuresKey,
  scheduledSendLastErrorKey,
  scheduledSendStatusKey,
  truncateScheduledSendError,
} from '@simplecrm/core';
import { sql, type Kysely, type RawBuilder } from 'kysely';

import type { EmailComposeSenderApiPort } from './api';
import type { ScheduledSendJobPlan, ScheduledSendJobPort } from './jobs';
import type { ServerDatabase } from './db/schema';
import { isOutboundReviewPendingError } from './mail-compose-send';
import { withWorkspaceTransaction } from './db/workspace-context';

const MAX_SCHEDULED_SEND_FAILURES = 5;

function isComposeSendAlreadyInProgressError(error: string): boolean {
  const normalized = error.trim().toLowerCase();
  return normalized.includes('versand') && normalized.includes('bereits');
}

type ScheduledDraft = Readonly<{
  id: number;
  accountId: number | null;
  subject: string | null;
  bodyText: string | null;
  bodyHtml: string | null;
  toJson: unknown | null;
  ccJson: unknown | null;
  bccJson: unknown | null;
  draftAttachmentPathsJson: unknown | null;
  replyParentMessageId: number | null;
  claimedSendAt: Date | null;
}>;

export type ScheduledSendStore = Readonly<{
  claimDueDrafts(input: ScheduledSendJobPlan): Promise<readonly ScheduledDraft[]>;

  /** Atomic: schedule=null, clear claim, reset failure markers to "ok". After a successful send. */
  finalizeSentDraft(input: { workspaceId: string; draftId: number }): Promise<void>;

  /** Atomic: schedule=null, clear claim; failure markers left untouched. When a claimed draft is abandoned (no recipient). */
  releaseClaimedDraft(input: { workspaceId: string; draftId: number }): Promise<void>;

  /** Atomic: restore schedule to claimedSendAt and clear claim. No-op when claimedSendAt is null. For transient/back-off retries. */
  restoreClaimedDraft(input: {
    workspaceId: string;
    draftId: number;
    claimedSendAt: Date | null;
  }): Promise<void>;

  /** Atomic: schedule=null, clear claim, mark status=failed with error. Permanent give-up (e.g. missing account). */
  giveUpDraft(input: { workspaceId: string; draftId: number; error: string }): Promise<void>;

  /**
   * Atomic: increment the failure counter and, in the SAME transaction, either
   * back off (restore schedule + clear claim + status=pending) or give up when
   * the new count reaches maxFailures (schedule=null + clear claim + status=failed).
   * Returns the new count and whether it gave up.
   */
  recordFailedAttempt(input: {
    workspaceId: string;
    draftId: number;
    error: string;
    claimedSendAt: Date | null;
    maxFailures: number;
  }): Promise<{ failures: number; gaveUp: boolean }>;
}>;

export type ScheduledSendJobPortOptions = Readonly<{
  store: ScheduledSendStore;
  composeSender: EmailComposeSenderApiPort;
  actorUserId?: string;
}>;

export type PostgresScheduledSendJobPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  composeSender: EmailComposeSenderApiPort;
  actorUserId?: string;
}>;

export function createScheduledSendJobPort(options: ScheduledSendJobPortOptions): ScheduledSendJobPort {
  const actorUserId = options.actorUserId ?? 'system';
  return {
    async processDue(input) {
      const drafts = await options.store.claimDueDrafts(input);
      for (const draft of drafts) {
        await processScheduledDraft({
          store: options.store,
          composeSender: options.composeSender,
          actorUserId,
          workspaceId: input.workspaceId,
          draft,
        });
      }
    },
  };
}

export function createPostgresScheduledSendJobPort(
  options: PostgresScheduledSendJobPortOptions,
): ScheduledSendJobPort {
  return createScheduledSendJobPort({
    composeSender: options.composeSender,
    actorUserId: options.actorUserId,
    store: createPostgresScheduledSendStore(options.db),
  });
}

async function processScheduledDraft(input: {
  store: ScheduledSendStore;
  composeSender: EmailComposeSenderApiPort;
  actorUserId: string;
  workspaceId: string;
  draft: ScheduledDraft;
}): Promise<void> {
  const draft = input.draft;
  if (!draft.accountId) {
    await input.store.giveUpDraft({
      workspaceId: input.workspaceId,
      draftId: draft.id,
      error: 'Konto nicht gefunden',
    });
    return;
  }

  const to = recipientFieldFromJson(draft.toJson);
  if (!to.trim()) {
    await input.store.releaseClaimedDraft({
      workspaceId: input.workspaceId,
      draftId: draft.id,
    });
    return;
  }

  const result = await input.composeSender.send({
    workspaceId: input.workspaceId,
    actorUserId: input.actorUserId,
    values: {
      accountId: draft.accountId,
      draftMessageId: draft.id,
      subject: draft.subject ?? '(Ohne Betreff)',
      bodyText: draft.bodyText ?? '',
      ...(draft.bodyHtml === null ? {} : { bodyHtml: draft.bodyHtml }),
      to,
      ...(recipientFieldFromJson(draft.ccJson) ? { cc: recipientFieldFromJson(draft.ccJson) } : {}),
      ...(recipientFieldFromJson(draft.bccJson) ? { bcc: recipientFieldFromJson(draft.bccJson) } : {}),
      ...(draft.replyParentMessageId === null ? {} : { inReplyToMessageId: draft.replyParentMessageId }),
      ...scheduledAttachmentPathsPayload(draft.draftAttachmentPathsJson),
    },
  });

  if (result.ok) {
    await input.store.finalizeSentDraft({
      workspaceId: input.workspaceId,
      draftId: draft.id,
    });
    return;
  }

  if (isComposeSendAlreadyInProgressError(result.error) || isOutboundReviewPendingError(result.error)) {
    await input.store.restoreClaimedDraft({
      workspaceId: input.workspaceId,
      draftId: draft.id,
      claimedSendAt: draft.claimedSendAt,
    });
    return;
  }

  await input.store.recordFailedAttempt({
    workspaceId: input.workspaceId,
    draftId: draft.id,
    error: result.error,
    claimedSendAt: draft.claimedSendAt,
    maxFailures: MAX_SCHEDULED_SEND_FAILURES,
  });
}

function recipientFieldFromJson(value: unknown): string {
  if (value === null || value === undefined || value === '') return '';
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return '';
    }
  }
  if (!parsed || typeof parsed !== 'object') return '';
  const entries = Array.isArray((parsed as { value?: unknown }).value)
    ? (parsed as { value: unknown[] }).value
    : Array.isArray(parsed)
      ? parsed
      : [];
  return entries
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return '';
      const address = String((entry as { address?: unknown }).address ?? '').trim();
      if (!address) return '';
      const name = String((entry as { name?: unknown }).name ?? '').trim();
      return name ? `${name.replace(/[<>"]/g, ' ').trim()} <${address}>` : address;
    })
    .filter(Boolean)
    .join(', ');
}

function scheduledAttachmentPathsPayload(value: unknown): { attachmentPaths?: readonly string[] } {
  const paths = parseDraftAttachmentPaths(value);
  return paths.length > 0 ? { attachmentPaths: paths } : {};
}

function parseDraftAttachmentPaths(value: unknown): readonly string[] {
  if (value === null || value === undefined || value === '') return [];
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const paths: string[] = [];
  for (const item of parsed) {
    const path = typeof item === 'string'
      ? item.trim()
      : item && typeof item === 'object'
        ? String((item as { path?: unknown }).path ?? '').trim()
        : '';
    if (path && !paths.includes(path)) paths.push(path);
  }
  return paths;
}

function parseScheduledSendClaimedAt(value: string | null | undefined): Date | null {
  if (!value?.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

async function recoverOrphanedScheduledClaims(
  trx: Kysely<ServerDatabase>,
  workspaceId: string,
): Promise<void> {
  const claimRows = await trx
    .selectFrom('sync_info')
    .select(['key', 'value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', 'like', `${SCHEDULED_SEND_CLAIMED_AT_PREFIX}%`)
    .execute();

  if (claimRows.length === 0) return;

  const now = new Date();
  for (const row of claimRows) {
    const match = /^scheduled_send_claimed_at:(\d+)$/.exec(row.key);
    if (!match) continue;
    const draftId = Number(match[1]);
    if (!Number.isSafeInteger(draftId) || draftId <= 0) continue;

    const message = await trx
      .selectFrom('email_messages')
      .select(['scheduled_send_at'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '=', draftId)
      .where('uid', '<', 0)
      .where('folder_kind', '=', 'draft')
      .executeTakeFirst();

    if (!message) {
      await trx
        .deleteFrom('sync_info')
        .where('workspace_id', '=', workspaceId)
        .where('key', '=', row.key)
        .execute();
      continue;
    }

    if (message.scheduled_send_at !== null) {
      await trx
        .deleteFrom('sync_info')
        .where('workspace_id', '=', workspaceId)
        .where('key', '=', row.key)
        .execute();
      continue;
    }

    const claimedSendAt = parseScheduledSendClaimedAt(row.value);
    if (claimedSendAt) {
      await trx
        .updateTable('email_messages')
        .set({
          scheduled_send_at: claimedSendAt,
          updated_at: now,
        })
        .where('workspace_id', '=', workspaceId)
        .where('id', '=', draftId)
        .execute();
    }

    await trx
      .deleteFrom('sync_info')
      .where('workspace_id', '=', workspaceId)
      .where('key', '=', row.key)
      .execute();
  }
}

async function persistScheduledSendClaims(
  trx: Kysely<ServerDatabase>,
  workspaceId: string,
  drafts: readonly ScheduledDraft[],
): Promise<void> {
  const entries = drafts
    .filter((draft): draft is ScheduledDraft & { claimedSendAt: Date } => draft.claimedSendAt !== null)
    .map((draft) => ({
      key: scheduledSendClaimedAtKey(draft.id),
      value: draft.claimedSendAt.toISOString(),
    }));
  if (entries.length === 0) return;

  const now = new Date();
  await trx
    .insertInto('sync_info')
    .values(entries.map((entry) => ({
      workspace_id: workspaceId,
      key: entry.key,
      value: entry.value,
      last_updated: now,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })))
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
      value: (eb) => eb.ref('excluded.value'),
      last_updated: now,
      updated_at: now,
    }))
    .execute();
}

function createPostgresScheduledSendStore(db: Kysely<ServerDatabase>): ScheduledSendStore {
  return {
    async claimDueDrafts(input) {
      return withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await recoverOrphanedScheduledClaims(trx, input.workspaceId);

          const accountFilter = input.accountId !== undefined
            ? sql`AND account_id = ${input.accountId}`
            : sql``;
          const draftFilter = input.draftId !== undefined
            ? sql`AND id = ${input.draftId}`
            : sql``;
          const now = new Date();
          const result = await sql<{
            id: number | string | bigint;
            account_id: number | string | bigint | null;
            subject: string | null;
            body_text: string | null;
            body_html: string | null;
            to_json: unknown | null;
            cc_json: unknown | null;
            bcc_json: unknown | null;
            draft_attachment_paths_json: unknown | null;
            reply_parent_message_id: number | string | bigint | null;
            claimed_send_at: Date | null;
          }>`
            WITH candidates AS (
              SELECT id, scheduled_send_at AS claimed_send_at
              FROM email_messages
              WHERE workspace_id = ${input.workspaceId}
                AND uid < 0
                AND folder_kind = 'draft'
                AND outbound_hold = false
                AND scheduled_send_at IS NOT NULL
                AND scheduled_send_at <= ${input.dueBefore}
                ${accountFilter}
                ${draftFilter}
              ORDER BY scheduled_send_at ASC, id ASC
              LIMIT ${input.limit}
              FOR UPDATE SKIP LOCKED
            )
            UPDATE email_messages AS m
            SET scheduled_send_at = NULL, updated_at = ${now}
            FROM candidates AS c
            WHERE m.id = c.id
              AND m.workspace_id = ${input.workspaceId}
            RETURNING
              m.id,
              m.account_id,
              m.subject,
              m.body_text,
              m.body_html,
              m.to_json,
              m.cc_json,
              m.bcc_json,
              m.draft_attachment_paths_json,
              m.reply_parent_message_id,
              c.claimed_send_at
          `.execute(trx);
          const drafts = result.rows.map((row) => ({
            id: Number(row.id),
            accountId: row.account_id === null ? null : Number(row.account_id),
            subject: row.subject,
            bodyText: row.body_text,
            bodyHtml: row.body_html,
            toJson: row.to_json,
            ccJson: row.cc_json,
            bccJson: row.bcc_json,
            draftAttachmentPathsJson: row.draft_attachment_paths_json,
            replyParentMessageId: row.reply_parent_message_id === null ? null : Number(row.reply_parent_message_id),
            claimedSendAt: row.claimed_send_at,
          }));
          await persistScheduledSendClaims(trx, input.workspaceId, drafts);
          return drafts;
        },
      );
    },
    async finalizeSentDraft(input) {
      await withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await updateScheduleTx(trx, input.workspaceId, input.draftId, null);
          await deleteClaimTx(trx, input.workspaceId, input.draftId);
          await upsertSyncInfoTx(trx, input.workspaceId, {
            [scheduledSendFailuresKey(input.draftId)]: '0',
            [scheduledSendLastErrorKey(input.draftId)]: '',
            [scheduledSendStatusKey(input.draftId)]: '',
          });
        },
      );
    },
    async releaseClaimedDraft(input) {
      await withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await updateScheduleTx(trx, input.workspaceId, input.draftId, null);
          await deleteClaimTx(trx, input.workspaceId, input.draftId);
        },
      );
    },
    async restoreClaimedDraft(input) {
      if (input.claimedSendAt === null) return;
      await withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await updateScheduleTx(trx, input.workspaceId, input.draftId, input.claimedSendAt);
          await deleteClaimTx(trx, input.workspaceId, input.draftId);
        },
      );
    },
    async giveUpDraft(input) {
      await withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await updateScheduleTx(trx, input.workspaceId, input.draftId, null);
          await deleteClaimTx(trx, input.workspaceId, input.draftId);
          await upsertSyncInfoTx(trx, input.workspaceId, {
            [scheduledSendFailuresKey(input.draftId)]: '0',
            [scheduledSendLastErrorKey(input.draftId)]: truncateScheduledSendError(input.error),
            [scheduledSendStatusKey(input.draftId)]: 'failed',
          });
        },
      );
    },
    async recordFailedAttempt(input) {
      return withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const current = await readFailureCountTx(trx, input.workspaceId, input.draftId);
          const failures = current + 1;
          const gaveUp = failures >= input.maxFailures;
          if (gaveUp) {
            await updateScheduleTx(trx, input.workspaceId, input.draftId, null);
            await deleteClaimTx(trx, input.workspaceId, input.draftId);
            await upsertSyncInfoTx(trx, input.workspaceId, {
              [scheduledSendFailuresKey(input.draftId)]: '0',
              [scheduledSendLastErrorKey(input.draftId)]: truncateScheduledSendError(input.error),
              [scheduledSendStatusKey(input.draftId)]: 'failed',
            });
          } else {
            await upsertSyncInfoTx(trx, input.workspaceId, {
              [scheduledSendFailuresKey(input.draftId)]: String(failures),
              [scheduledSendLastErrorKey(input.draftId)]: truncateScheduledSendError(input.error),
              [scheduledSendStatusKey(input.draftId)]: 'pending',
            });
            if (input.claimedSendAt !== null) {
              await updateScheduleTx(trx, input.workspaceId, input.draftId, input.claimedSendAt);
              await deleteClaimTx(trx, input.workspaceId, input.draftId);
            }
          }
          return { failures, gaveUp };
        },
      );
    },
  };
}

async function updateScheduleTx(
  trx: Kysely<ServerDatabase>,
  workspaceId: string,
  draftId: number,
  sendAt: Date | null,
): Promise<void> {
  await trx
    .updateTable('email_messages')
    .set({ scheduled_send_at: sendAt, updated_at: new Date() })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', draftId)
    .execute();
}

async function deleteClaimTx(
  trx: Kysely<ServerDatabase>,
  workspaceId: string,
  draftId: number,
): Promise<void> {
  await trx
    .deleteFrom('sync_info')
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', scheduledSendClaimedAtKey(draftId))
    .execute();
}

async function upsertSyncInfoTx(
  trx: Kysely<ServerDatabase>,
  workspaceId: string,
  values: Readonly<Record<string, string | null>>,
): Promise<void> {
  const entries = Object.entries(values);
  if (entries.length === 0) return;
  const now = new Date();
  await trx
    .insertInto('sync_info')
    .values(entries.map(([key, value]) => ({
      workspace_id: workspaceId,
      key,
      value,
      last_updated: now,
      source_row: serverApiSourceRow(),
      imported_in_run_id: null,
      updated_at: now,
    })))
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doUpdateSet({
      value: (eb) => eb.ref('excluded.value'),
      last_updated: now,
      updated_at: now,
    }))
    .execute();
}

async function readFailureCountTx(
  trx: Kysely<ServerDatabase>,
  workspaceId: string,
  draftId: number,
): Promise<number> {
  const row = await trx
    .selectFrom('sync_info')
    .select(['value'])
    .where('workspace_id', '=', workspaceId)
    .where('key', '=', scheduledSendFailuresKey(draftId))
    .executeTakeFirst();
  const current = Number.parseInt(row?.value ?? '0', 10);
  return Number.isFinite(current) && current >= 0 ? current : 0;
}

function serverApiSourceRow(): RawBuilder<unknown> {
  return sql`'{"origin":"server_api"}'::jsonb`;
}

const DEFAULT_SCHEDULED_SEND_TICKER_MS = 30_000;

export type ScheduledSendTickerRuntime = Readonly<{
  stop(): void;
}>;

/** Polls Postgres for due scheduled drafts and sends them in-process (API server). */
export function startScheduledSendTicker(input: {
  db: Kysely<ServerDatabase>;
  composeSender: EmailComposeSenderApiPort;
  pollIntervalMs?: number;
}): ScheduledSendTickerRuntime {
  const pollIntervalMs = input.pollIntervalMs ?? DEFAULT_SCHEDULED_SEND_TICKER_MS;
  const port = createPostgresScheduledSendJobPort({
    db: input.db,
    composeSender: input.composeSender,
  });
  let stopped = false;
  let inFlight = false;

  const tick = async () => {
    if (stopped || inFlight) return;
    inFlight = true;
    try {
      const dueBefore = new Date();
      const rows = await input.db
        .selectFrom('email_messages')
        .select('workspace_id')
        .where('uid', '<', 0)
        .where('folder_kind', '=', 'draft')
        .where('outbound_hold', '=', false)
        .where('scheduled_send_at', 'is not', null)
        .where('scheduled_send_at', '<=', dueBefore)
        .groupBy('workspace_id')
        .execute();
      for (const row of rows) {
        try {
          await port.processDue({
            workspaceId: String(row.workspace_id),
            dueBefore,
            limit: 30,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[mail] scheduled send ticker workspace ${String(row.workspace_id)}: ${message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`[mail] scheduled send ticker: ${message}`);
    } finally {
      inFlight = false;
    }
  };

  void tick();
  const timer = setInterval(() => {
    void tick();
  }, pollIntervalMs);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}
