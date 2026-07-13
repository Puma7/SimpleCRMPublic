import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import type { Kysely } from 'kysely';

import type { EmailGdprExportApiPort, EmailGdprExportResult } from './api/types';
import type { ServerDatabase } from './db';
import { resolveAttachmentStoragePath } from './db/postgres-mail-read-ports';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';

const MESSAGE_BATCH = 2000;
const NOTES_BATCH = 5000;
const RUNS_LIMIT = 5000;
const MAX_EXPORT_ATTACH_BYTES = 4 * 1024 * 1024 * 1024;

type ArchiverModule = typeof import('archiver', { with: { 'resolution-mode': 'import' } });
type Archive = InstanceType<ArchiverModule['ZipArchive']>;

let archiverPromise: Promise<ArchiverModule> | undefined;

function loadArchiver(): Promise<ArchiverModule> {
  archiverPromise ??= import('archiver');
  return archiverPromise;
}

type AttachmentExportEntry = {
  id: number;
  filename: string;
  contentType: string | null;
  sizeBytes: number;
  contentSha256: string | null;
  resolvedPath: string | null;
  status: 'ok' | 'missing' | 'unsafe_path';
};

type PostgresEmailGdprExportPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  attachmentsRoot: string;
  now?: () => Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}>;

export function createPostgresEmailGdprExportPort(
  options: PostgresEmailGdprExportPortOptions,
): EmailGdprExportApiPort {
  return {
    async export(input): Promise<EmailGdprExportResult> {
      const now = options.now?.() ?? new Date();
      const attachments = input.skipAttachments
        ? []
        : await prepareAttachments(options, input.workspaceId);
      const attachmentBytes = attachments.reduce((sum, entry) => sum + entry.sizeBytes, 0);
      if (!input.skipAttachments && attachmentBytes > MAX_EXPORT_ATTACH_BYTES) {
        return {
          ok: false,
          code: 'attachments_too_large',
          attachmentBytes,
          maxBytes: MAX_EXPORT_ATTACH_BYTES,
        };
      }

      const { ZipArchive } = await loadArchiver();
      const stream = new PassThrough();
      const archive = new ZipArchive({ zlib: { level: 9 } });
      archive.on('error', (error) => stream.destroy(error));
      archive.pipe(stream);

      void writeExportArchive({
        ...options,
        workspaceId: input.workspaceId,
        skipAttachments: input.skipAttachments === true,
        attachments,
        archive,
        exportedAt: now,
      }).catch((error) => {
        try {
          archive.abort();
        } catch {
          /* ignore */
        }
        stream.destroy(error instanceof Error ? error : new Error(String(error)));
      });

      return {
        ok: true,
        filename: `simplecrm-email-export-${now.toISOString().slice(0, 10)}.zip`,
        stream,
      };
    },
  };
}

async function prepareAttachments(
  options: PostgresEmailGdprExportPortOptions,
  workspaceId: string,
): Promise<AttachmentExportEntry[]> {
  return withWorkspaceTransaction(
    options.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      const rows = await trx
        .selectFrom('email_message_attachments')
        .select(['id', 'filename_display', 'content_type', 'size_bytes', 'storage_path', 'content_sha256'])
        .where('workspace_id', '=', workspaceId)
        .orderBy('id', 'asc')
        .execute();

      const entries: AttachmentExportEntry[] = [];
      for (const row of rows) {
        const resolvedPath = resolveAttachmentStoragePath(options.attachmentsRoot, row.storage_path);
        const base = {
          id: Number(row.id),
          filename: row.filename_display,
          contentType: row.content_type,
          sizeBytes: Number(row.size_bytes) || 0,
          contentSha256: row.content_sha256,
        };
        if (!resolvedPath) {
          entries.push({ ...base, resolvedPath: null, status: 'unsafe_path' });
          continue;
        }
        try {
          await stat(resolvedPath);
          entries.push({ ...base, resolvedPath, status: 'ok' });
        } catch {
          entries.push({ ...base, resolvedPath, status: 'missing' });
        }
      }
      return entries;
    },
    { applySession: options.applyWorkspaceSession },
  );
}

async function writeExportArchive(
  input: PostgresEmailGdprExportPortOptions & {
    workspaceId: string;
    skipAttachments: boolean;
    attachments: AttachmentExportEntry[];
    archive: Archive;
    exportedAt: Date;
  },
): Promise<void> {
  await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      await appendAccounts(trx, input.workspaceId, input.archive);
      await appendMessageIndex(trx, input.workspaceId, input.archive);
      await appendInternalNotes(trx, input.workspaceId, input.archive);
      await appendWorkflows(trx, input.workspaceId, input.archive);
      await appendWorkflowRuns(trx, input.workspaceId, input.archive);
    },
    { applySession: input.applyWorkspaceSession },
  );

  if (!input.skipAttachments) {
    for (const entry of input.attachments) {
      if (entry.status !== 'ok' || !entry.resolvedPath) continue;
      input.archive.append(createReadStream(entry.resolvedPath), {
        name: `attachments/${entry.id}-${safeZipName(entry.filename)}`,
      });
    }
    input.archive.append(
      JSON.stringify(input.attachments.map((entry) => ({
        id: entry.id,
        filename: entry.filename,
        contentType: entry.contentType,
        sizeBytes: entry.sizeBytes,
        contentSha256: entry.contentSha256,
        status: entry.status,
      })), null, 2),
      { name: 'attachments_manifest.json' },
    );
  }

  input.archive.append(
    JSON.stringify(
      {
        exportedAt: input.exportedAt.toISOString(),
        note: input.skipAttachments
          ? 'Keine Passwoerter/Keytar. Anhaenge in diesem Export ausgelassen (skipAttachments).'
          : 'Keine Passwoerter/Keytar-Inhalte. Nachrichten als JSONL (messages_index.jsonl). Rohmail nicht enthalten.',
      },
      null,
      2,
    ),
    { name: 'README_EXPORT.txt' },
  );

  await input.archive.finalize();
}

async function appendAccounts(
  trx: WorkspaceTransaction,
  workspaceId: string,
  archive: Archive,
): Promise<void> {
  const rows = await trx
    .selectFrom('email_accounts')
    .select([
      'id',
      'source_sqlite_id',
      'display_name',
      'email_address',
      'imap_host',
      'imap_port',
      'protocol',
      'smtp_host',
      'smtp_port',
      'oauth_provider',
      'created_at',
    ])
    .where('workspace_id', '=', workspaceId)
    .orderBy('id', 'asc')
    .execute();
  archive.append(JSON.stringify(rows, null, 2), { name: 'accounts_redacted.json' });
}

async function appendMessageIndex(
  trx: WorkspaceTransaction,
  workspaceId: string,
  archive: Archive,
): Promise<void> {
  const stream = new PassThrough();
  archive.append(stream, { name: 'messages_index.jsonl' });
  let cursor = 0;
  for (;;) {
    const batch = await trx
      .selectFrom('email_messages')
      .select([
        'id',
        'source_sqlite_id',
        'account_id',
        'subject',
        'snippet',
        'date_received',
        'ticket_code',
        'customer_id',
        'assigned_to',
        'folder_kind',
        'archived',
        'seen_local',
        'has_attachments',
        'thread_id',
        'imap_thread_id',
        'created_at',
      ])
      .where('workspace_id', '=', workspaceId)
      .where('id', '>', cursor)
      .orderBy('id', 'asc')
      .limit(MESSAGE_BATCH)
      .execute();
    if (batch.length === 0) break;
    for (const row of batch) {
      stream.write(`${JSON.stringify(row)}\n`);
      cursor = Number(row.id);
    }
    if (batch.length < MESSAGE_BATCH) break;
  }
  stream.end();
}

async function appendInternalNotes(
  trx: WorkspaceTransaction,
  workspaceId: string,
  archive: Archive,
): Promise<void> {
  const stream = new PassThrough();
  archive.append(stream, { name: 'internal_notes.jsonl' });
  let cursor = 0;
  for (;;) {
    const batch = await trx
      .selectFrom('email_internal_notes')
      .select(['id', 'source_sqlite_id', 'message_id', 'message_source_sqlite_id', 'body', 'created_at', 'updated_at'])
      .where('workspace_id', '=', workspaceId)
      .where('id', '>', cursor)
      .orderBy('id', 'asc')
      .limit(NOTES_BATCH)
      .execute();
    if (batch.length === 0) break;
    for (const row of batch) {
      stream.write(`${JSON.stringify(row)}\n`);
      cursor = Number(row.id);
    }
    if (batch.length < NOTES_BATCH) break;
  }
  stream.end();
}

async function appendWorkflows(
  trx: WorkspaceTransaction,
  workspaceId: string,
  archive: Archive,
): Promise<void> {
  const rows = await trx
    .selectFrom('email_workflows')
    .select(['id', 'source_sqlite_id', 'name', 'trigger_name', 'enabled', 'priority', 'cron_expr', 'schedule_account_id', 'created_at'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('id', 'asc')
    .execute();
  archive.append(JSON.stringify(rows, null, 2), { name: 'workflows_meta.json' });
}

async function appendWorkflowRuns(
  trx: WorkspaceTransaction,
  workspaceId: string,
  archive: Archive,
): Promise<void> {
  const rows = await trx
    .selectFrom('email_workflow_runs')
    .select(['id', 'source_sqlite_id', 'workflow_id', 'message_id', 'direction', 'status', 'started_at', 'finished_at'])
    .where('workspace_id', '=', workspaceId)
    .orderBy('id', 'desc')
    .limit(RUNS_LIMIT)
    .execute();
  archive.append(JSON.stringify(rows, null, 2), { name: 'workflow_runs_sample.json' });
}

function safeZipName(value: string): string {
  const cleaned = value
    .replace(/[\\/\0-\x1f\x7f]+/g, '_')
    .replace(/\.\.+/g, '.')
    .trim();
  return cleaned || 'attachment';
}
