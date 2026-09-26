/**
 * Storage maintenance (`simplecrm maintenance`): checks attachments and stored
 * originals against the database and runs the verified space savings now
 * instead of waiting for the background tickers.
 *
 * Checks (never change anything):
 *  - every attachment row has its file, with the recorded size (deep: sha256);
 *  - files under mail-sync/ and email-attachments/ that no row names (orphans,
 *    reported only: deleting them is the operator's decision);
 *  - stored originals decode to their recorded sha256 (a sample of the newest,
 *    all with deep).
 * Cleanup (unless checkOnly; every step proves its result before it writes):
 *  - compress legacy base64 originals;
 *  - take attachment parts out of originals;
 *  - link identical attachment files.
 * Nothing is deleted.
 */
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { sql, type Kysely } from 'kysely';

import {
  resolveAttachmentStoragePath,
  withWorkspaceTransaction,
  type ServerDatabase,
  type WorkspaceSessionApplier,
} from '../db';
import { runAttachmentDedup } from '../mail-attachment-dedup';
import { runRawCompressionBackfillBatch } from '../mail-raw-compression-backfill';
import { runRawPartDedupBatch } from '../mail-raw-part-dedup';
import { loadStoredRaw, rawPartReaderFor, storedRawColumns } from '../mail-raw-storage';

const ROW_BATCH = 500;
const ORIGINAL_SAMPLE = 200;
const MAX_EXAMPLES = 10;

export type StorageMaintenanceOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  attachmentsRoot: string;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  /** Hash every attachment file and check every stored original. */
  deep?: boolean;
  /** Only check, do not run the space savings. */
  checkOnly?: boolean;
}>;

export type StorageMaintenanceReport = {
  attachments: {
    rows: number;
    missing: number;
    sizeMismatch: number;
    hashMismatch: number;
    hashed: number;
    orphanFiles: number;
    examples: string[];
  };
  originals: {
    total: number;
    legacyBase64: number;
    compressed: number;
    withoutAttachmentCopies: number;
    checked: number;
    damaged: number;
    examples: string[];
  };
  cleanup: {
    compressed: number;
    partsTakenOut: number;
    filesLinked: number;
    bytesFreed: number;
  } | null;
  ok: boolean;
};

async function fileSha256(file: string): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk as Buffer);
  return hash.digest('hex');
}

function systemSession() {
  return { workspaceId: randomUUID(), role: 'system' as const, crossWorkspaceAccess: true };
}

async function checkAttachments(
  options: StorageMaintenanceOptions,
  report: StorageMaintenanceReport['attachments'],
): Promise<Set<string>> {
  const known = new Set<string>();
  let afterId = 0;
  for (;;) {
    const rows = await withWorkspaceTransaction(
      options.db,
      systemSession(),
      async (trx) => trx
        .selectFrom('email_message_attachments')
        .select(['id', 'storage_path', 'size_bytes', 'content_sha256'])
        .where('id', '>', afterId)
        .orderBy('id', 'asc')
        .limit(ROW_BATCH)
        .execute(),
      { applySession: options.applyWorkspaceSession },
    );
    if (rows.length === 0) break;
    for (const row of rows) {
      afterId = Number(row.id);
      report.rows += 1;
      const file = resolveAttachmentStoragePath(options.attachmentsRoot, row.storage_path);
      if (!file) {
        report.missing += 1;
        if (report.examples.length < MAX_EXAMPLES) report.examples.push(`attachment ${row.id}: invalid path`);
        continue;
      }
      known.add(path.resolve(file));
      const info = await stat(file).catch(() => null);
      if (!info?.isFile()) {
        report.missing += 1;
        if (report.examples.length < MAX_EXAMPLES) report.examples.push(`attachment ${row.id}: file missing (${row.storage_path})`);
        continue;
      }
      if (Number(row.size_bytes) !== info.size) {
        report.sizeMismatch += 1;
        if (report.examples.length < MAX_EXAMPLES) report.examples.push(`attachment ${row.id}: size ${info.size}, recorded ${row.size_bytes}`);
        continue;
      }
      if (options.deep && row.content_sha256) {
        report.hashed += 1;
        if (await fileSha256(file) !== row.content_sha256.toLowerCase()) {
          report.hashMismatch += 1;
          if (report.examples.length < MAX_EXAMPLES) report.examples.push(`attachment ${row.id}: content does not match its sha256`);
        }
      }
    }
  }
  return known;
}

async function countOrphanFiles(
  options: StorageMaintenanceOptions,
  known: ReadonlySet<string>,
  report: StorageMaintenanceReport['attachments'],
): Promise<void> {
  const root = path.resolve(options.attachmentsRoot);
  const workspaces = await readdir(root, { withFileTypes: true }).catch(() => []);
  const walk = async (dir: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile() && !entry.name.startsWith('.dedup-') && !known.has(full)) {
        report.orphanFiles += 1;
      }
    }
  };
  for (const workspace of workspaces) {
    if (!workspace.isDirectory()) continue;
    // Only folders whose files belong to attachment rows; compose drafts and
    // raw-parts have their own bookkeeping.
    for (const area of ['mail-sync', 'email-attachments']) {
      await walk(path.join(root, workspace.name, area));
    }
  }
}

async function checkOriginals(
  options: StorageMaintenanceOptions,
  report: StorageMaintenanceReport['originals'],
): Promise<void> {
  const counts = await withWorkspaceTransaction(
    options.db,
    systemSession(),
    async (trx) => trx
      .selectFrom('email_messages')
      .select([
        sql<string>`count(*) FILTER (WHERE raw_rfc822_z IS NOT NULL OR raw_rfc822_b64 IS NOT NULL)`.as('total'),
        sql<string>`count(*) FILTER (WHERE raw_rfc822_b64 IS NOT NULL)`.as('legacy'),
        sql<string>`count(*) FILTER (WHERE raw_rfc822_z IS NOT NULL)`.as('compressed'),
        sql<string>`count(*) FILTER (WHERE raw_rfc822_codec = 'br-parts')`.as('parts'),
      ])
      .executeTakeFirstOrThrow(),
    { applySession: options.applyWorkspaceSession },
  );
  report.total = Number(counts.total);
  report.legacyBase64 = Number(counts.legacy);
  report.compressed = Number(counts.compressed);
  report.withoutAttachmentCopies = Number(counts.parts);

  let beforeId: number | null = null;
  for (;;) {
    const limit = options.deep ? ROW_BATCH : Math.min(ROW_BATCH, ORIGINAL_SAMPLE - report.checked);
    if (limit <= 0) break;
    const ids = await withWorkspaceTransaction(
      options.db,
      systemSession(),
      async (trx) => {
        let query = trx
          .selectFrom('email_messages')
          .select(['id', 'workspace_id'])
          .where('raw_rfc822_z', 'is not', null)
          .orderBy('id', 'desc')
          .limit(limit);
        if (beforeId !== null) query = query.where('id', '<', beforeId);
        return query.execute();
      },
      { applySession: options.applyWorkspaceSession },
    );
    if (ids.length === 0) break;
    for (const { id, workspace_id: workspaceId } of ids) {
      beforeId = Number(id);
      const row = await withWorkspaceTransaction(
        options.db,
        { workspaceId, role: 'system' },
        async (trx) => trx
          .selectFrom('email_messages')
          .select([...storedRawColumns])
          .where('workspace_id', '=', workspaceId)
          .where('id', '=', Number(id))
          .executeTakeFirst(),
        { applySession: options.applyWorkspaceSession },
      );
      if (!row) continue;
      report.checked += 1;
      try {
        await loadStoredRaw(row, { readPart: rawPartReaderFor(options.attachmentsRoot, workspaceId) });
      } catch (error) {
        report.damaged += 1;
        if (report.examples.length < MAX_EXAMPLES) {
          report.examples.push(`message ${id}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    }
  }
}

async function runCleanup(options: StorageMaintenanceOptions): Promise<NonNullable<StorageMaintenanceReport['cleanup']>> {
  const cleanup = { compressed: 0, partsTakenOut: 0, filesLinked: 0, bytesFreed: 0 };
  for (let afterId = 0; ;) {
    const batch = await runRawCompressionBackfillBatch(options, afterId);
    if (batch.seen === 0) break;
    afterId = batch.lastId;
    cleanup.compressed += batch.converted;
    cleanup.bytesFreed += Math.max(0, batch.bytesBefore - batch.bytesAfter);
  }
  for (let afterId = 0; ;) {
    const batch = await runRawPartDedupBatch(options, afterId);
    if (batch.seen === 0) break;
    afterId = batch.lastId;
    cleanup.partsTakenOut += batch.stripped;
    cleanup.bytesFreed += Math.max(0, batch.bytesBefore - batch.bytesAfter);
  }
  const linked = await runAttachmentDedup(options, Number.POSITIVE_INFINITY);
  cleanup.filesLinked += linked.linked;
  cleanup.bytesFreed += linked.bytesFreed;
  return cleanup;
}

export async function runStorageMaintenance(options: StorageMaintenanceOptions): Promise<StorageMaintenanceReport> {
  const report: StorageMaintenanceReport = {
    attachments: { rows: 0, missing: 0, sizeMismatch: 0, hashMismatch: 0, hashed: 0, orphanFiles: 0, examples: [] },
    originals: { total: 0, legacyBase64: 0, compressed: 0, withoutAttachmentCopies: 0, checked: 0, damaged: 0, examples: [] },
    cleanup: null,
    ok: true,
  };
  // Cleanup first, so the checks see the final state.
  if (!options.checkOnly) report.cleanup = await runCleanup(options);
  const known = await checkAttachments(options, report.attachments);
  await countOrphanFiles(options, known, report.attachments);
  await checkOriginals(options, report.originals);
  report.ok = report.attachments.missing === 0
    && report.attachments.sizeMismatch === 0
    && report.attachments.hashMismatch === 0
    && report.originals.damaged === 0;
  return report;
}

/** Human-readable summary (German, like the rest of the operator output). */
export function formatStorageMaintenanceReport(report: StorageMaintenanceReport): string {
  const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
  const lines: string[] = [];
  if (report.cleanup) {
    lines.push(
      'Aufräumen:',
      `  Originale komprimiert:              ${report.cleanup.compressed}`,
      `  Anhänge aus Originalen genommen:    ${report.cleanup.partsTakenOut}`,
      `  Gleiche Anhänge verknüpft:          ${report.cleanup.filesLinked}`,
      `  Frei geworden (ca.):                ${mb(report.cleanup.bytesFreed)} MB`,
    );
  }
  const a = report.attachments;
  lines.push(
    'Anhänge:',
    `  Einträge:                           ${a.rows}`,
    `  Datei fehlt:                        ${a.missing}`,
    `  Größe falsch:                       ${a.sizeMismatch}`,
    ...(a.hashed > 0 ? [`  Inhalt falsch (von ${a.hashed} geprüft): ${a.hashMismatch}`] : []),
    `  Dateien ohne Eintrag (nur Hinweis): ${a.orphanFiles}`,
  );
  const o = report.originals;
  lines.push(
    'Mail-Originale:',
    `  Gespeichert:                        ${o.total}`,
    `  Komprimiert:                        ${o.compressed} (davon ohne Anhangkopie: ${o.withoutAttachmentCopies})`,
    `  Noch base64 (wird umgestellt):      ${o.legacyBase64}`,
    `  Geprüft / beschädigt:               ${o.checked} / ${o.damaged}`,
  );
  const examples = [...a.examples, ...o.examples];
  if (examples.length > 0) lines.push('Beispiele:', ...examples.map((example) => `  - ${example}`));
  lines.push(report.ok ? 'Ergebnis: in Ordnung.' : 'Ergebnis: PROBLEME gefunden (siehe oben). Es wurde nichts gelöscht.');
  return `${lines.join('\n')}\n`;
}
