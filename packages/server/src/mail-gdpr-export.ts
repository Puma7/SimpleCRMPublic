import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { PassThrough } from 'node:stream';
import { sql as kyselySql, type Kysely } from 'kysely';

import type { EmailGdprExportApiPort, EmailGdprExportResult } from './api/types';
import type { ServerDatabase } from './db';
import { resolveAttachmentStoragePath } from './db/postgres-mail-read-ports';
import {
  createEmailTrackingCrypto,
  emailTrackingEventAssociatedData,
  emailTrackingLinkAssociatedData,
} from './email-tracking';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { isPotentiallyDangerousAttachment } from '@simplecrm/core';

import { effectiveMailScope, mailScopePredicate } from './mail-access/sql-scope';
import type { MailSqlScope } from './mail-access/types';

const MESSAGE_BATCH = 2000;
const NOTES_BATCH = 5000;
const TRACKING_BATCH = 2000;
const RUNS_LIMIT = 5000;
const MAX_EXPORT_ATTACH_BYTES = 4 * 1024 * 1024 * 1024;

type ArchiverModule = typeof import('archiver', { with: { 'resolution-mode': 'import' } });
type Archive = InstanceType<ArchiverModule['ZipArchive']>;
type ExportArchive = Pick<Archive, 'abort' | 'append' | 'finalize' | 'on' | 'pipe'>;

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
  status: 'ok' | 'missing' | 'unsafe_path' | 'blocked_suspicious';
};

type PostgresEmailGdprExportPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  attachmentsRoot: string;
  now?: () => Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  trackingMasterKey?: Buffer;
  archiveFactory?: () => ExportArchive;
  outputStreamFactory?: () => PassThrough;
}>;

export function createPostgresEmailGdprExportPort(
  options: PostgresEmailGdprExportPortOptions,
): EmailGdprExportApiPort {
  return {
    async export(input): Promise<EmailGdprExportResult> {
      const now = options.now?.() ?? new Date();
      const attachments = input.skipAttachments
        ? []
        : await prepareAttachments(options, input.workspaceId, input.mailScope);
      const attachmentBytes = attachments.reduce((sum, entry) => sum + entry.sizeBytes, 0);
      if (!input.skipAttachments && attachmentBytes > MAX_EXPORT_ATTACH_BYTES) {
        return {
          ok: false,
          code: 'attachments_too_large',
          attachmentBytes,
          maxBytes: MAX_EXPORT_ATTACH_BYTES,
        };
      }

      const stream = options.outputStreamFactory?.() ?? new PassThrough();
      const archive = options.archiveFactory
        ? options.archiveFactory()
        : new (await loadArchiver()).ZipArchive({ zlib: { level: 9 } });
      archive.on('error', (error) => stream.destroy(error));
      archive.pipe(stream);

      void writeExportArchive({
        ...options,
        workspaceId: input.workspaceId,
        skipAttachments: input.skipAttachments === true,
        attachments,
        archive,
        exportedAt: now,
        includeSensitiveTracking: input.includeSensitiveTracking === true,
        mailScope: input.mailScope,
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
  mailScope: MailSqlScope | undefined,
): Promise<AttachmentExportEntry[]> {
  return withWorkspaceTransaction(
    options.db,
    { workspaceId, role: 'system' },
    async (trx) => {
      let query = trx
        .selectFrom('email_message_attachments')
        .select(['id', 'filename_display', 'content_type', 'size_bytes', 'storage_path', 'content_sha256'])
        .where('workspace_id', '=', workspaceId);
      const scopePredicate = mailScopePredicate(mailScope, {
        accountId: 'attachment_message.account_id',
        folderId: 'attachment_message.folder_id',
        messageId: 'attachment_message.id',
      });
      if (scopePredicate) {
        query = query.where((eb) => eb.exists(
          eb.selectFrom('email_messages as attachment_message')
            .select('attachment_message.id')
            .whereRef('attachment_message.id', '=', 'email_message_attachments.message_id')
            .where('attachment_message.workspace_id', '=', workspaceId)
            .where(scopePredicate),
        ));
      }
      const rows = await query
        .orderBy('id', 'asc')
        .execute();

      // A scoped export (mailScope defined ⇒ a restricted delegate; owner/admin
      // bypass the scoped port and get mailScope undefined) must not deliver
      // executable/script attachment bytes, which the dedicated download and
      // raw-EML paths gate behind mail.attachment.suspicious_download. Record such
      // files in the manifest as blocked without writing their bytes; the delegate
      // can still fetch a specific one through the gated attachment route.
      const gateSuspicious = mailScope !== undefined;
      const entries: AttachmentExportEntry[] = [];
      for (const row of rows) {
        const base = {
          id: Number(row.id),
          filename: row.filename_display,
          contentType: row.content_type,
          sizeBytes: Number(row.size_bytes) || 0,
          contentSha256: row.content_sha256,
        };
        if (gateSuspicious && isPotentiallyDangerousAttachment(row.filename_display)) {
          entries.push({ ...base, resolvedPath: null, status: 'blocked_suspicious' });
          continue;
        }
        const resolvedPath = resolveAttachmentStoragePath(options.attachmentsRoot, row.storage_path);
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
    archive: ExportArchive;
    exportedAt: Date;
    includeSensitiveTracking: boolean;
    mailScope?: MailSqlScope;
  },
): Promise<void> {
  await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      await appendAccounts(trx, input.workspaceId, input.archive, input.mailScope);
      await appendMessageIndex(trx, input.workspaceId, input.archive, input.mailScope);
      await appendInternalNotes(trx, input.workspaceId, input.archive, input.mailScope);
      await appendWorkflows(trx, input.workspaceId, input.archive, input.mailScope);
      await appendWorkflowRuns(trx, input.workspaceId, input.archive, input.mailScope);
      await appendEmailTracking(
        trx,
        input.workspaceId,
        input.archive,
        input.includeSensitiveTracking,
        input.trackingMasterKey,
        input.mailScope,
      );
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
        trackingSensitiveDataIncluded: input.includeSensitiveTracking && Boolean(input.trackingMasterKey),
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
  archive: ExportArchive,
  mailScope: MailSqlScope | undefined,
): Promise<void> {
  let query = trx
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
    .where('workspace_id', '=', workspaceId);
  const accountScope = mailScopePredicate(mailScope, { accountId: 'email_accounts.id' });
  const messageScope = mailScopePredicate(mailScope, {
    accountId: 'export_account_message.account_id',
    folderId: 'export_account_message.folder_id',
    messageId: 'export_account_message.id',
  });
  if (accountScope || messageScope) {
    query = query.where((eb) => eb.or([
      accountScope ?? kyselySql<boolean>`false`,
      eb.exists(
        eb.selectFrom('email_messages as export_account_message')
          .select('export_account_message.id')
          .whereRef('export_account_message.account_id', '=', 'email_accounts.id')
          .where('export_account_message.workspace_id', '=', workspaceId)
          .where(messageScope ?? kyselySql<boolean>`false`),
      ),
    ]));
  }
  const rows = await query
    .orderBy('id', 'asc')
    .execute();
  // An account reached ONLY through a folder/message export grant (the exists
  // branch above) must expose just its identity — matching redactParentOnlyAccountRow
  // on the account-list path — not its connection config. Keep full config only for
  // accounts named by a direct account-level grant; owner/admin (scope undefined/all)
  // keep everything.
  const effective = effectiveMailScope(mailScope);
  const directAccountIds = effective.kind === 'restricted' ? new Set(effective.accountIds) : null;
  const exported = directAccountIds
    ? rows.map((row) => (
      directAccountIds.has(Number(row.id))
        ? row
        : {
          id: row.id,
          source_sqlite_id: row.source_sqlite_id,
          display_name: row.display_name,
          email_address: row.email_address,
          imap_host: '',
          imap_port: 0,
          protocol: 'imap',
          smtp_host: null,
          smtp_port: null,
          oauth_provider: null,
          created_at: row.created_at,
        }
    ))
    : rows;
  archive.append(JSON.stringify(exported, null, 2), { name: 'accounts_redacted.json' });
}

async function appendMessageIndex(
  trx: WorkspaceTransaction,
  workspaceId: string,
  archive: ExportArchive,
  mailScope: MailSqlScope | undefined,
): Promise<void> {
  const stream = new PassThrough();
  archive.append(stream, { name: 'messages_index.jsonl' });
  let cursor = 0;
  for (;;) {
    let query = trx
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
      .where('workspace_id', '=', workspaceId);
    const scopePredicate = mailScopePredicate(mailScope, {
      accountId: 'email_messages.account_id',
      folderId: 'email_messages.folder_id',
      messageId: 'email_messages.id',
    });
    if (scopePredicate) query = query.where(scopePredicate);
    const batch = await query
      .where('id', '>', cursor)
      .orderBy('id', 'asc')
      .limit(MESSAGE_BATCH)
      .execute();
    if (batch.length === 0) break;
    for (const row of batch) {
      stream.write(`${JSON.stringify({ ...row, id: Number(row.id) })}\n`);
      cursor = Number(row.id);
    }
    if (batch.length < MESSAGE_BATCH) break;
  }
  stream.end();
}

async function appendInternalNotes(
  trx: WorkspaceTransaction,
  workspaceId: string,
  archive: ExportArchive,
  mailScope: MailSqlScope | undefined,
): Promise<void> {
  const stream = new PassThrough();
  archive.append(stream, { name: 'internal_notes.jsonl' });
  let cursor = 0;
  for (;;) {
    let query = trx
      .selectFrom('email_internal_notes')
      .select(['id', 'source_sqlite_id', 'message_id', 'message_source_sqlite_id', 'body', 'created_at', 'updated_at'])
      .where('workspace_id', '=', workspaceId);
    const scopePredicate = mailScopePredicate(mailScope, {
      accountId: 'export_note_message.account_id',
      folderId: 'export_note_message.folder_id',
      messageId: 'export_note_message.id',
    });
    if (scopePredicate) {
      query = query.where((eb) => eb.exists(
        eb.selectFrom('email_messages as export_note_message')
          .select('export_note_message.id')
          .whereRef('export_note_message.id', '=', 'email_internal_notes.message_id')
          .where('export_note_message.workspace_id', '=', workspaceId)
          .where(scopePredicate),
      ));
    }
    const batch = await query
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
  archive: ExportArchive,
  mailScope: MailSqlScope | undefined,
): Promise<void> {
  let query = trx
    .selectFrom('email_workflows')
    .select(['id', 'source_sqlite_id', 'name', 'trigger_name', 'enabled', 'priority', 'cron_expr', 'schedule_account_id', 'created_at'])
    .where('workspace_id', '=', workspaceId);
  const accountScope = mailScopePredicate(mailScope, { accountId: 'email_workflows.schedule_account_id' });
  const messageScope = mailScopePredicate(mailScope, {
    accountId: 'export_workflow_message.account_id',
    folderId: 'export_workflow_message.folder_id',
    messageId: 'export_workflow_message.id',
  });
  if (accountScope || messageScope) {
    query = query.where((eb) => eb.or([
      accountScope ?? kyselySql<boolean>`false`,
      eb.exists(
        eb.selectFrom('email_workflow_runs as export_workflow_run')
          .innerJoin('email_messages as export_workflow_message', (join) => join
            .onRef('export_workflow_message.id', '=', 'export_workflow_run.message_id')
            .onRef('export_workflow_message.workspace_id', '=', 'export_workflow_run.workspace_id'))
          .select('export_workflow_run.id')
          .whereRef('export_workflow_run.workflow_id', '=', 'email_workflows.id')
          .where('export_workflow_run.workspace_id', '=', workspaceId)
          .where(messageScope ?? kyselySql<boolean>`false`),
      ),
    ]));
  }
  const rows = await query
    .orderBy('id', 'asc')
    .execute();
  archive.append(JSON.stringify(rows, null, 2), { name: 'workflows_meta.json' });
}

async function appendWorkflowRuns(
  trx: WorkspaceTransaction,
  workspaceId: string,
  archive: ExportArchive,
  mailScope: MailSqlScope | undefined,
): Promise<void> {
  let query = trx
    .selectFrom('email_workflow_runs')
    .select(['id', 'source_sqlite_id', 'workflow_id', 'message_id', 'direction', 'status', 'started_at', 'finished_at'])
    .where('workspace_id', '=', workspaceId);
  const scopePredicate = mailScopePredicate(mailScope, {
    accountId: 'export_run_message.account_id',
    folderId: 'export_run_message.folder_id',
    messageId: 'export_run_message.id',
  });
  if (scopePredicate) {
    query = query.where((eb) => eb.exists(
      eb.selectFrom('email_messages as export_run_message')
        .select('export_run_message.id')
        .whereRef('export_run_message.id', '=', 'email_workflow_runs.message_id')
        .where('export_run_message.workspace_id', '=', workspaceId)
        .where(scopePredicate),
    ));
  }
  const rows = await query
    .orderBy('id', 'desc')
    .limit(RUNS_LIMIT)
    .execute();
  archive.append(JSON.stringify(rows, null, 2), { name: 'workflow_runs_sample.json' });
}

async function appendEmailTracking(
  trx: WorkspaceTransaction,
  workspaceId: string,
  archive: ExportArchive,
  includeSensitive: boolean,
  masterKey?: Buffer,
  mailScope?: MailSqlScope,
): Promise<void> {
  const crypto = masterKey ? createEmailTrackingCrypto(masterKey) : null;
  const policy = mailScope?.kind === 'restricted' || mailScope?.kind === 'none'
    ? undefined
    : await trx
    .selectFrom('email_tracking_policies')
    .select([
      'enabled', 'track_opens', 'track_links', 'collect_derived_metadata', 'collect_raw_metadata',
      'raw_metadata_retention_days', 'event_retention_days', 'token_ttl_days', 'legal_basis',
      'privacy_notice_url', 'compliance_acknowledged_at', 'created_at', 'updated_at',
    ])
    .where('workspace_id', '=', workspaceId)
    .executeTakeFirst();
  archive.append(JSON.stringify(policy ?? null, null, 2), { name: 'tracking_policy.json' });

  const messageStream = new PassThrough();
  archive.append(messageStream, { name: 'tracking_messages.jsonl' });
  let messageCursor: string | null = null;
  for (;;) {
    let query = trx
      .selectFrom('email_tracking_messages')
      .select([
        'id', 'message_id', 'account_id', 'message_id_header', 'recipient_count', 'track_opens',
        'track_links', 'collect_derived_metadata', 'collect_raw_metadata', 'token_expires_at',
        'revoked_at', 'policy_snapshot', 'created_at', 'updated_at',
      ])
      .where('workspace_id', '=', workspaceId);
    const scopePredicate = mailScopePredicate(mailScope, {
      accountId: 'export_tracking_message.account_id',
      folderId: 'export_tracking_message.folder_id',
      messageId: 'export_tracking_message.id',
    });
    if (scopePredicate) {
      query = query.where((eb) => eb.exists(
        eb.selectFrom('email_messages as export_tracking_message')
          .select('export_tracking_message.id')
          .whereRef('export_tracking_message.id', '=', 'email_tracking_messages.message_id')
          .where('export_tracking_message.workspace_id', '=', workspaceId)
          .where(scopePredicate),
      ));
    }
    if (messageCursor) query = query.where('id', '>', messageCursor);
    const batch = await query.orderBy('id', 'asc').limit(TRACKING_BATCH).execute();
    if (batch.length === 0) break;
    for (const row of batch) messageStream.write(`${JSON.stringify(row)}\n`);
    messageCursor = String(batch[batch.length - 1]!.id);
    if (batch.length < TRACKING_BATCH) break;
  }
  messageStream.end();

  const linkStream = new PassThrough();
  archive.append(linkStream, { name: 'tracking_links.jsonl' });
  let linkCursor: string | null = null;
  for (;;) {
    let query = trx
      .selectFrom('email_tracking_links')
      .select([
        'id', 'tracking_message_id', 'ordinal', 'target_ciphertext', 'target_nonce',
        'target_auth_tag', 'created_at',
      ])
      .where('workspace_id', '=', workspaceId);
    const scopePredicate = mailScopePredicate(mailScope, {
      accountId: 'export_link_message.account_id',
      folderId: 'export_link_message.folder_id',
      messageId: 'export_link_message.id',
    });
    if (scopePredicate) {
      query = query.where((eb) => eb.exists(
        eb.selectFrom('email_tracking_messages as export_link_tracking')
          .innerJoin('email_messages as export_link_message', (join) => join
            .onRef('export_link_message.id', '=', 'export_link_tracking.message_id')
            .onRef('export_link_message.workspace_id', '=', 'export_link_tracking.workspace_id'))
          .select('export_link_tracking.id')
          .whereRef('export_link_tracking.id', '=', 'email_tracking_links.tracking_message_id')
          .where('export_link_tracking.workspace_id', '=', workspaceId)
          .where(scopePredicate),
      ));
    }
    if (linkCursor) query = query.where('id', '>', linkCursor);
    const batch = await query.orderBy('id', 'asc').limit(TRACKING_BATCH).execute();
    if (batch.length === 0) break;
    for (const row of batch) {
      const exported: Record<string, unknown> = {
        id: row.id,
        trackingMessageId: row.tracking_message_id,
        ordinal: row.ordinal,
        createdAt: row.created_at,
      };
      if (includeSensitive) {
        if (crypto) {
          try {
            const opened = crypto.openJson({
              ciphertext: row.target_ciphertext,
              nonce: row.target_nonce,
              authTag: row.target_auth_tag,
            }, emailTrackingLinkAssociatedData(workspaceId, row.tracking_message_id, row.id));
            exported.targetUrl = opened && typeof opened === 'object' && typeof (opened as { url?: unknown }).url === 'string'
              ? (opened as { url: string }).url
              : null;
          } catch {
            exported.targetUnavailable = true;
          }
        } else {
          exported.targetUnavailable = true;
        }
      }
      linkStream.write(`${JSON.stringify(exported)}\n`);
    }
    linkCursor = String(batch[batch.length - 1]!.id);
    if (batch.length < TRACKING_BATCH) break;
  }
  linkStream.end();

  const eventStream = new PassThrough();
  archive.append(eventStream, { name: 'tracking_events.jsonl' });
  let eventCursor = 0;
  for (;;) {
    let query = trx
      .selectFrom('email_tracking_events')
      .select([
        'id', 'tracking_message_id', 'message_id', 'link_id', 'event_type', 'source', 'confidence',
        'automated', 'occurred_at', 'metadata_json', 'raw_metadata_ciphertext', 'raw_metadata_nonce',
        'raw_metadata_auth_tag', 'dedupe_key', 'created_at',
      ])
      .where('workspace_id', '=', workspaceId);
    const scopePredicate = mailScopePredicate(mailScope, {
      accountId: 'export_event_message.account_id',
      folderId: 'export_event_message.folder_id',
      messageId: 'export_event_message.id',
    });
    if (scopePredicate) {
      query = query.where((eb) => eb.exists(
        eb.selectFrom('email_messages as export_event_message')
          .select('export_event_message.id')
          .whereRef('export_event_message.id', '=', 'email_tracking_events.message_id')
          .where('export_event_message.workspace_id', '=', workspaceId)
          .where(scopePredicate),
      ));
    }
    const batch = await query
      .where('id', '>', eventCursor)
      .orderBy('id', 'asc')
      .limit(TRACKING_BATCH)
      .execute();
    if (batch.length === 0) break;
    for (const row of batch) {
      const exported: Record<string, unknown> = {
        id: Number(row.id),
        trackingMessageId: row.tracking_message_id,
        messageId: row.message_id,
        linkId: row.link_id,
        type: row.event_type,
        source: row.source,
        confidence: row.confidence,
        automated: row.automated,
        occurredAt: row.occurred_at,
        metadata: row.metadata_json,
        createdAt: row.created_at,
      };
      if (
        includeSensitive
        && row.raw_metadata_ciphertext
        && row.raw_metadata_nonce
        && row.raw_metadata_auth_tag
      ) {
        if (crypto) {
          try {
            exported.rawMetadata = crypto.openJson({
              ciphertext: row.raw_metadata_ciphertext,
              nonce: row.raw_metadata_nonce,
              authTag: row.raw_metadata_auth_tag,
            }, emailTrackingEventAssociatedData(workspaceId, row.tracking_message_id, row.dedupe_key));
          } catch {
            exported.rawMetadataUnavailable = true;
          }
        } else {
          exported.rawMetadataUnavailable = true;
        }
      }
      eventStream.write(`${JSON.stringify(exported)}\n`);
      eventCursor = Number(row.id);
    }
    if (batch.length < TRACKING_BATCH) break;
  }
  eventStream.end();
}

function safeZipName(value: string): string {
  const cleaned = value
    .replace(/[\\/\0-\x1f\x7f]+/g, '_')
    .replace(/\.\.+/g, '.')
    .trim();
  return cleaned || 'attachment';
}
