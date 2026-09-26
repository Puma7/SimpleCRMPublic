import { readFile } from 'node:fs/promises';

import type { Kysely } from 'kysely';

import {
  countDmarcRecordTags,
  createDmarcRecordAggregator,
  decompressReportAttachment,
  MAX_DECOMPRESSED_BYTES,
  MAX_DMARC_RECORDS_PER_REPORT,
  parseDmarcXml,
  type DmarcRecordAggregator,
  type DmarcReportSummary,
} from './dmarc/parse-aggregate-report';
import type { ServerDatabase } from './db';
import { resolveAttachmentStoragePath } from './db/postgres-mail-read-ports';
import {
  createPostgresDmarcStorePort,
  type DmarcStorePort,
} from './db/postgres-dmarc-port';
import {
  withWorkspaceTransaction,
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
} from './db/workspace-context';
import { buildTrustedServiceJobPayload, MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD } from './jobs/policy';
import type { JobPayload } from './jobs/types';
import {
  resumeContextInboundChainFields,
  type InboundChainContinuationFields,
} from './workflow-inbound-chain-context';

/** Per-attachment read cap (compressed bytes). The decompressed side has its own
 *  cap in the parser (MAX_DECOMPRESSED_BYTES); this stops us reading an absurdly
 *  large file off disk before we even try to decompress it. */
const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024;
/** Total read budget across all of a message's attachments. */
const MAX_TOTAL_ATTACHMENT_BYTES = 40 * 1024 * 1024;
/** Total decompressed budget across all of a message's report attachments. The
 *  compressed budget above does not bound it (gzip expands ~1000:1), so without
 *  it every extra attachment adds another full-size parse + DB insert. A real
 *  RUA mail carries one report, so the per-report cap is enough for the mail. */
const MAX_TOTAL_DECOMPRESSED_BYTES = MAX_DECOMPRESSED_BYTES;
/** DEFLATE expands at most ~1032:1. A failed decompression is charged to the
 *  budget above with the most it could have inflated before failing (up to the
 *  per-attachment cap): a bomb spends the budget, a small corrupt file hardly. */
const MAX_DEFLATE_EXPANSION = 1032;
/** Report attachments examined per message; a real RUA mail carries one. */
const MAX_REPORT_ATTACHMENTS_PER_MESSAGE = 20;
/** The per-report record limit (E13) applies to all reports of a message
 *  together, so splitting records across reports does not multiply it. */
const MAX_DMARC_RECORDS_PER_MESSAGE = MAX_DMARC_RECORDS_PER_REPORT;
/** Only attachments whose name ends in one of these are considered reports. */
const REPORT_ATTACHMENT_PATTERN = /\.(xml|xml\.gz|gz|zip)$/i;

export type WorkflowDmarcIngestContinuation = Readonly<{
  workflowId: number;
  triggerName?: string;
  actorUserId?: string;
  trustedService?: boolean;
  // See AiClassificationContinuation.manualAdminExecute — carried across the async
  // DMARC-ingest boundary so the resumed workflow.execute keeps its owner/admin recheck.
  manualAdminExecute?: boolean;
  resumeNodeId: string;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
} & InboundChainContinuationFields>;

export type WorkflowDmarcIngestJobPlan = Readonly<{
  workspaceId: string;
  workflowId: number;
  messageId: number;
  actorUserId?: string;
  /** Optional case-insensitive substring the attachment name must contain
   *  (in addition to the xml/gz/zip extension gate). */
  attachmentNameFilter?: string;
  continuation?: WorkflowDmarcIngestContinuation;
}>;

export type WorkflowDmarcIngestJobPort = Readonly<{
  ingest(input: WorkflowDmarcIngestJobPlan): Promise<void>;
}>;

export type PostgresWorkflowDmarcIngestPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  /** Root dir for attachment files; required to read report bytes. */
  attachmentsRoot?: string;
  /** Injectable file reader (defaults to node:fs/promises readFile); for tests. */
  readAttachmentFile?: (path: string) => Promise<Buffer>;
  /** Injectable store port; defaults to the postgres DMARC store. */
  store?: DmarcStorePort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  now?: () => Date;
}>;

type MessageAttachment = Readonly<{
  filename: string;
  storagePath: string;
}>;

type IngestSummary = {
  reportCount: number;
  newReportCount: number;
  domain: string;
  /** Running totals instead of the records, so no report's rows are kept. */
  aggregator: DmarcRecordAggregator;
};

export function createPostgresWorkflowDmarcIngestPort(
  options: PostgresWorkflowDmarcIngestPortOptions,
): WorkflowDmarcIngestJobPort {
  const now = () => options.now?.() ?? new Date();
  const readAttachmentFile = options.readAttachmentFile ?? ((p: string) => readFile(p));
  const store = options.store ?? createPostgresDmarcStorePort({
    db: options.db,
    ...(options.applyWorkspaceSession ? { applyWorkspaceSession: options.applyWorkspaceSession } : {}),
  });

  return {
    async ingest(input): Promise<void> {
      let summary: IngestSummary = {
        reportCount: 0,
        newReportCount: 0,
        domain: '',
        aggregator: createDmarcRecordAggregator(),
      };
      try {
        const attachments = await withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx) => loadMessageAttachments(trx, input.workspaceId, input.messageId),
          { applySession: options.applyWorkspaceSession },
        );

        summary = await ingestAttachments({
          input,
          attachments,
          attachmentsRoot: options.attachmentsRoot,
          readAttachmentFile,
          store,
          receivedAt: now(),
        });
      } catch (error) {
        // Mirror failOrEnqueueForwardCopyContinuation: a deterministic failure
        // (bad DB read, unexpected parse/persist error) must NEVER strand the
        // workflow — otherwise the resume node hangs forever and the anomaly
        // task never fires. With a continuation, enqueue it (dmarc.ok=false so
        // the graph can branch) instead of rethrowing; without one there is
        // nothing to resume, so surface the failure to the job queue.
        console.warn(
          `workflow.dmarc_ingest failed for message ${input.messageId}: ${error instanceof Error ? error.message : String(error)}`,
        );
        if (!input.continuation) throw error;
      }

      await enqueueDmarcIngestContinuation(options, input, summary, now());
    },
  };
}

async function ingestAttachments(args: {
  input: WorkflowDmarcIngestJobPlan;
  attachments: readonly MessageAttachment[];
  attachmentsRoot: string | undefined;
  readAttachmentFile: (path: string) => Promise<Buffer>;
  store: DmarcStorePort;
  receivedAt: Date;
}): Promise<IngestSummary> {
  const { input, attachments, attachmentsRoot, readAttachmentFile, store, receivedAt } = args;
  const summary: IngestSummary = {
    reportCount: 0,
    newReportCount: 0,
    domain: '',
    aggregator: createDmarcRecordAggregator(),
  };
  if (!attachmentsRoot) return summary;

  const nameFilter = input.attachmentNameFilter?.trim().toLowerCase() || null;
  let total = 0;
  let decompressedTotal = 0;
  let reportAttachments = 0;
  let recordTotal = 0;

  for (const attachment of attachments) {
    const lowerName = attachment.filename.toLowerCase();
    if (!REPORT_ATTACHMENT_PATTERN.test(lowerName)) continue;
    if (nameFilter && !lowerName.includes(nameFilter)) continue;

    const resolved = resolveAttachmentStoragePath(attachmentsRoot, attachment.storagePath);
    if (!resolved) continue;
    if (reportAttachments >= MAX_REPORT_ATTACHMENTS_PER_MESSAGE) {
      console.warn(
        `workflow.dmarc_ingest: message ${input.messageId} has more than ${MAX_REPORT_ATTACHMENTS_PER_MESSAGE} report attachments, ignoring the rest`,
      );
      break;
    }
    reportAttachments += 1;

    let bytes: Buffer;
    try {
      bytes = await readAttachmentFile(resolved);
    } catch {
      continue; // unreadable file — skip, keep processing the rest
    }
    if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES) continue;
    const next = total + bytes.length;
    if (next > MAX_TOTAL_ATTACHMENT_BYTES) break;
    total = next;

    let xml: Buffer;
    try {
      xml = await decompressReportAttachment(attachment.filename, bytes);
    } catch {
      // Corrupt or over-limit archive — not a report, but the inflating is spent.
      decompressedTotal += Math.min(MAX_DECOMPRESSED_BYTES, bytes.length * MAX_DEFLATE_EXPANSION);
      if (decompressedTotal >= MAX_TOTAL_DECOMPRESSED_BYTES) break;
      continue;
    }
    const nextDecompressed = decompressedTotal + xml.length;
    if (nextDecompressed > MAX_TOTAL_DECOMPRESSED_BYTES) break;
    decompressedTotal = nextDecompressed;

    // Guard each report independently: a single malformed/oversized report must
    // not abort the whole batch (which would leave the workflow unresumed). The
    // parser already returns null for non-DMARC XML; this also catches a persist
    // that throws (e.g. a value the DB rejects) so the remaining reports still
    // ingest and the summary/continuation stay accurate.
    try {
      const xmlText = xml.toString('utf8');
      // Vor dem Parse zaehlen: ein Report mit zu vielen Records wird nicht erst
      // sekundenlang synchron geparst und eingefuegt (F-A3b-01).
      const recordTags = countDmarcRecordTags(xmlText);
      if (recordTags > MAX_DMARC_RECORDS_PER_REPORT) {
        console.warn(
          `workflow.dmarc_ingest: skipping report attachment "${attachment.filename}": ${recordTags} records exceed the limit of ${MAX_DMARC_RECORDS_PER_REPORT}`,
        );
        continue;
      }
      if (recordTotal + recordTags > MAX_DMARC_RECORDS_PER_MESSAGE) {
        console.warn(
          `workflow.dmarc_ingest: skipping report attachment "${attachment.filename}": ${recordTags} records exceed the per-message limit of ${MAX_DMARC_RECORDS_PER_MESSAGE} (${recordTotal} already taken)`,
        );
        continue;
      }
      recordTotal += recordTags;
      const report = parseDmarcXml(xmlText);
      if (!report) continue;

      const persisted = await store.persistReport({
        workspaceId: input.workspaceId,
        report,
        sourceMessageId: input.messageId,
        receivedAt,
      });

      summary.reportCount += 1;
      if (persisted.isNew) summary.newReportCount += 1;
      if (!summary.domain) summary.domain = report.domain;
      summary.aggregator.add(report.records);
    } catch (error) {
      console.warn(
        `workflow.dmarc_ingest: skipping report attachment "${attachment.filename}": ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  return summary;
}

async function loadMessageAttachments(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<MessageAttachment[]> {
  const rows = await trx
    .selectFrom('email_message_attachments')
    .select(['filename_display', 'storage_path'])
    .where('workspace_id', '=', workspaceId)
    .where('message_id', '=', messageId)
    .execute();
  return rows
    .filter((row) => typeof row.storage_path === 'string' && row.storage_path.trim() !== '')
    .map((row) => ({
      filename: String(row.filename_display ?? 'report'),
      storagePath: String(row.storage_path),
    }));
}

async function enqueueDmarcIngestContinuation(
  options: PostgresWorkflowDmarcIngestPortOptions,
  input: WorkflowDmarcIngestJobPlan,
  summary: IngestSummary,
  now: Date,
): Promise<void> {
  const continuation = input.continuation;
  if (!continuation) return;

  const aggregate = summary.aggregator.summary();
  await withWorkspaceTransaction(
    options.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      const payload = workflowContinuationPayload({
        workspaceId: input.workspaceId,
        workflowId: continuation.workflowId,
        messageId: input.messageId,
        ...(continuation.actorUserId ? { actorUserId: continuation.actorUserId } : {}),
        ...(continuation.triggerName ? { triggerName: continuation.triggerName } : {}),
        // Keep the resumed workflow.execute marked so the owner/admin recheck still fires.
        ...(continuation.manualAdminExecute === true ? { [MANUAL_ADMIN_WORKFLOW_EXECUTE_MARKER_FIELD]: true } : {}),
        context: {
          resumeNodeId: continuation.resumeNodeId,
          eventStrings: continuation.eventStrings ?? {},
          eventVariables: {
            ...(continuation.eventVariables ?? {}),
            ...dmarcIngestVariables(summary, aggregate),
          },
          ...resumeContextInboundChainFields(continuation),
        },
      }, continuation.trustedService === true);

      await trx
        .insertInto('job_queue')
        .values({
          type: 'workflow.execute',
          payload,
          run_after: now,
          max_attempts: 3,
          workspace_id: input.workspaceId,
          updated_at: now,
        })
        .execute();
    },
    { applySession: options.applyWorkspaceSession },
  );
}

function workflowContinuationPayload(payload: Record<string, unknown>, trustedService: boolean): Record<string, unknown> {
  return trustedService && !payload.actorUserId ? buildTrustedServiceJobPayload(payload) : payload;
}

function dmarcIngestVariables(
  summary: IngestSummary,
  aggregate: DmarcReportSummary,
): Record<string, unknown> {
  return {
    'dmarc.ok': summary.reportCount > 0,
    'dmarc.report_count': summary.reportCount,
    'dmarc.new_report_count': summary.newReportCount,
    'dmarc.record_count': aggregate.recordCount,
    'dmarc.message_count': aggregate.messageCount,
    'dmarc.pass_count': aggregate.passCount,
    'dmarc.fail_count': aggregate.failCount,
    'dmarc.reject_count': aggregate.rejectCount,
    'dmarc.quarantine_count': aggregate.quarantineCount,
    'dmarc.unauthorized_source_count': aggregate.unauthorizedSourceCount,
    'dmarc.domain': summary.domain,
    'dmarc.top_source_ip': aggregate.topSourceIp ?? '',
  };
}
