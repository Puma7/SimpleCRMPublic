import {
  scheduledSendFailuresKey,
  scheduledSendLastErrorKey,
  scheduledSendStatusKey,
  truncateScheduledSendError,
} from '@simplecrm/core';
import type { Kysely, RawBuilder } from 'kysely';

import type { EmailComposeSenderApiPort } from './api';
import type { ScheduledSendJobPlan, ScheduledSendJobPort } from './jobs';
import type { ServerDatabase } from './db/schema';
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
}>;

export type ScheduledSendStore = Readonly<{
  listDueDrafts(input: ScheduledSendJobPlan): Promise<readonly ScheduledDraft[]>;
  setDraftScheduledAt(input: {
    workspaceId: string;
    draftId: number;
    sendAt: Date | null;
  }): Promise<void>;
  getSyncInfo(input: {
    workspaceId: string;
    keys: readonly string[];
  }): Promise<ReadonlyMap<string, string | null>>;
  setSyncInfo(input: {
    workspaceId: string;
    values: Readonly<Record<string, string | null>>;
  }): Promise<void>;
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
      const drafts = await options.store.listDueDrafts(input);
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
    await giveUpScheduledDraft(input.store, input.workspaceId, draft.id, 'Konto nicht gefunden');
    return;
  }

  const to = recipientFieldFromJson(draft.toJson);
  if (!to.trim()) {
    await input.store.setDraftScheduledAt({
      workspaceId: input.workspaceId,
      draftId: draft.id,
      sendAt: null,
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
    await input.store.setDraftScheduledAt({
      workspaceId: input.workspaceId,
      draftId: draft.id,
      sendAt: null,
    });
    await clearScheduledDraftMeta(input.store, input.workspaceId, draft.id);
    return;
  }

  if (isComposeSendAlreadyInProgressError(result.error)) {
    return;
  }

  const failures = await recordScheduledAttemptFailure(
    input.store,
    input.workspaceId,
    draft.id,
    result.error,
  );
  if (failures >= MAX_SCHEDULED_SEND_FAILURES) {
    await giveUpScheduledDraft(input.store, input.workspaceId, draft.id, result.error);
  }
}

async function recordScheduledAttemptFailure(
  store: ScheduledSendStore,
  workspaceId: string,
  draftId: number,
  error: string,
): Promise<number> {
  const values = await store.getSyncInfo({
    workspaceId,
    keys: [scheduledSendFailuresKey(draftId)],
  });
  const current = Number.parseInt(values.get(scheduledSendFailuresKey(draftId)) ?? '0', 10);
  const failures = (Number.isFinite(current) && current >= 0 ? current : 0) + 1;
  await store.setSyncInfo({
    workspaceId,
    values: {
      [scheduledSendFailuresKey(draftId)]: String(failures),
      [scheduledSendLastErrorKey(draftId)]: truncateScheduledSendError(error),
      [scheduledSendStatusKey(draftId)]: 'pending',
    },
  });
  return failures;
}

async function giveUpScheduledDraft(
  store: ScheduledSendStore,
  workspaceId: string,
  draftId: number,
  error: string,
): Promise<void> {
  await store.setDraftScheduledAt({ workspaceId, draftId, sendAt: null });
  await store.setSyncInfo({
    workspaceId,
    values: {
      [scheduledSendFailuresKey(draftId)]: '0',
      [scheduledSendLastErrorKey(draftId)]: truncateScheduledSendError(error),
      [scheduledSendStatusKey(draftId)]: 'failed',
    },
  });
}

async function clearScheduledDraftMeta(
  store: ScheduledSendStore,
  workspaceId: string,
  draftId: number,
): Promise<void> {
  await store.setSyncInfo({
    workspaceId,
    values: {
      [scheduledSendFailuresKey(draftId)]: '0',
      [scheduledSendLastErrorKey(draftId)]: '',
      [scheduledSendStatusKey(draftId)]: '',
    },
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

function createPostgresScheduledSendStore(db: Kysely<ServerDatabase>): ScheduledSendStore {
  return {
    async listDueDrafts(input) {
      return withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          let query = trx
            .selectFrom('email_messages')
            .select([
              'id',
              'account_id',
              'subject',
              'body_text',
              'body_html',
              'to_json',
              'cc_json',
              'bcc_json',
              'draft_attachment_paths_json',
              'reply_parent_message_id',
            ])
            .where('workspace_id', '=', input.workspaceId)
            .where('uid', '<', 0)
            .where('folder_kind', '=', 'draft')
            .where('outbound_hold', '=', false)
            .where('scheduled_send_at', '<=', input.dueBefore)
            .orderBy('scheduled_send_at', 'asc')
            .orderBy('id', 'asc')
            .limit(input.limit);
          if (input.accountId !== undefined) query = query.where('account_id', '=', input.accountId);
          if (input.draftId !== undefined) query = query.where('id', '=', input.draftId);
          const rows = await query.execute();
          return rows.map((row) => ({
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
          }));
        },
      );
    },
    async setDraftScheduledAt(input) {
      await withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          await trx
            .updateTable('email_messages')
            .set({
              scheduled_send_at: input.sendAt,
              updated_at: new Date(),
            })
            .where('workspace_id', '=', input.workspaceId)
            .where('id', '=', input.draftId)
            .execute();
        },
      );
    },
    async getSyncInfo(input) {
      return withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const rows = await trx
            .selectFrom('sync_info')
            .select(['key', 'value'])
            .where('workspace_id', '=', input.workspaceId)
            .where('key', 'in', input.keys)
            .execute();
          const values = new Map<string, string | null>();
          for (const key of input.keys) values.set(key, null);
          for (const row of rows) values.set(row.key, row.value);
          return values;
        },
      );
    },
    async setSyncInfo(input) {
      await withWorkspaceTransaction(
        db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const entries = Object.entries(input.values);
          if (entries.length === 0) return;
          const now = new Date();
          await trx
            .insertInto('sync_info')
            .values(entries.map(([key, value]) => ({
              workspace_id: input.workspaceId,
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
        },
      );
    },
  };
}

function serverApiSourceRow(): RawBuilder<unknown> {
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');
  return kyselySql`'{"origin":"server_api"}'::jsonb`;
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
        await port.processDue({
          workspaceId: String(row.workspace_id),
          dueBefore,
          limit: 30,
        });
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
