import type { Kysely } from 'kysely';

import { CONVERSATION_LOCK_TIMEOUT_SECONDS } from '../locks';
import {
  verifyAuditHashChain,
  withWorkspaceTransaction,
  type AuditHashChainRow,
  type ServerDatabase,
  type WorkspaceSessionApplier,
} from '../db';
import type { JobPayload } from './types';
import type { JobHandlerRegistry } from './worker';

export const DEFAULT_LOCK_CLEANUP_LIMIT = 500;
export const MAX_LOCK_CLEANUP_LIMIT = 5000;
export const DEFAULT_AUDIT_RETENTION_DAYS = 365;
/**
 * Aufbewahrung der Abschlussmarker terminaler Kindjobs.
 *
 * `inbound_terminal_child_done:*` ist pro Ausfuehrung eindeutig (Nachricht,
 * Workflow, Knoten#Zweig, Fan-out-Lauf) und wird von keinem Erfolgs- oder
 * Abbruchpfad geloescht — er muss den gesamten Graphile-Retry-Fenster
 * ueberleben, sonst dekrementierte eine spaete erneute Zustellung die
 * Join-Barriere ein zweites Mal. Danach ist er nur noch Ballast, waechst aber
 * mit jeder Nachricht, jedem Fan-out-Zweig und jedem Reapply-Lauf in der
 * haeufig gelesenen sync_info-Tabelle weiter. Sieben Tage liegen um
 * Groessenordnungen jenseits des Retry-Fensters (max_attempts 3-5 mit
 * exponentiellem Backoff) und damit sicher.
 */
export const DEFAULT_TERMINAL_MARKER_RETENTION_DAYS = 7;
export const DEFAULT_AUDIT_RETENTION_LIMIT = 1000;
export const MAX_AUDIT_RETENTION_LIMIT = 10000;

export type MaintenanceJobHandlersOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  now?: () => Date;
  auditArchive?: AuditRetentionArchivePort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  /**
   * Zum Nachschieben einer weiteren Charge, wenn eine voll geworden ist.
   *
   * Ohne das deckelt der Takt den Durchsatz: je Lauf werden hoechstens `limit`
   * Zeilen geloescht, also bei taeglichem Takt hoechstens `limit` pro Tag. Ein
   * Workspace, der jemals mehr Audit-Ereignisse pro Tag erzeugt hat (oder einen
   * Altbestand mitbringt), holt den Rueckstand nie auf — die 365-Tage-Retention
   * waere dann nur behauptet. Dasselbe gilt fuer die Abschlussmarker.
   *
   * Ein kuerzeres Intervall wuerde die Grenze nur verschieben; Nachschieben
   * macht den Abbau unabhaengig von der Anfallrate. Es terminiert, weil nur
   * nachgeschoben wird, wenn die Charge VOLL war, also nachweislich Fortschritt
   * stattgefunden hat.
   */
  requeue?: MaintenanceRequeuePort;
}>;

export type MaintenanceRequeuePort = Readonly<{
  enqueue(input: {
    type: string;
    workspaceId: string;
    payload: JobPayload;
    runAfter?: Date;
  }): Promise<unknown>;
}>;

/** Kurze Pause zwischen zwei Chargen — abbauen, ohne die Datenbank zu fluten. */
export const MAINTENANCE_REQUEUE_DELAY_MS = 5_000;

export type MaintenanceCleanupPlan = Readonly<{
  workspaceId: string;
  staleBefore: Date;
  /** Abschlussmarker aelter als das duerfen weg (eigenes Fenster, siehe Konstante). */
  terminalMarkersBefore: Date;
  limit: number;
}>;

/**
 * Prefixe der aufzuraeumenden Marker. Die Unterstriche sind fuer LIKE escaped
 * (`\_` = literaler Unterstrich), sonst matchte jedes Zeichen an ihrer Stelle.
 */
const TERMINAL_MARKER_LIKE_PATTERNS = [
  'inbound\\_terminal\\_child\\_done:%',
] as const;

export type AuditRetentionPlan = Readonly<{
  workspaceId: string;
  olderThan: Date;
  limit: number;
}>;

export type AuditRetentionArchivePort = Readonly<{
  archive(input: {
    workspaceId: string;
    olderThan: Date;
    rows: readonly AuditHashChainRow[];
  }): Promise<void>;
}>;

const AUDIT_RETENTION_SELECT_COLUMNS = [
  'id',
  'workspace_id',
  'actor_user_id',
  'action',
  'entity_type',
  'entity_id',
  'metadata',
  'previous_hash',
  'event_hash',
  'created_at',
] as const;

export function createMaintenanceJobHandlers(options: MaintenanceJobHandlersOptions): JobHandlerRegistry {
  const now = options.now ?? (() => new Date());

  return {
    'lock.cleanup': async (job) => {
      const plan = buildLockCleanupPlan(job.payload, now());
      const batchWasFull = await withWorkspaceTransaction(options.db, {
        workspaceId: plan.workspaceId,
        role: 'system',
      }, async (db) => {
        const rows = await db
          .selectFrom('conversation_locks')
          .select('message_id')
          .where('workspace_id', '=', plan.workspaceId)
          .where('last_heartbeat_at', '<', plan.staleBefore)
          .orderBy('last_heartbeat_at', 'asc')
          .limit(plan.limit)
          .execute();
        const messageIds = rows.map((row) => row.message_id);
        if (messageIds.length > 0) {
          await db
            .deleteFrom('conversation_locks')
            .where('workspace_id', '=', plan.workspaceId)
            .where('message_id', 'in', messageIds)
            .executeTakeFirst();
        }

        // Abgelaufene Abschlussmarker mitnehmen — gleiche Schranke (limit),
        // damit ein erster Lauf auf einer grossen Tabelle nicht ausufert.
        const staleMarkers = await db
          .selectFrom('sync_info')
          .select('key')
          .where('workspace_id', '=', plan.workspaceId)
          .where('last_updated', '<', plan.terminalMarkersBefore)
          .where((eb) => eb.or(
            TERMINAL_MARKER_LIKE_PATTERNS.map((pattern) => eb('key', 'like', pattern)),
          ))
          .orderBy('last_updated', 'asc')
          .limit(plan.limit)
          .execute();
        if (staleMarkers.length > 0) {
          await db
            .deleteFrom('sync_info')
            .where('workspace_id', '=', plan.workspaceId)
            .where('key', 'in', staleMarkers.map((row) => row.key))
            .executeTakeFirst();
        }

        // Voll heisst: es liegt vermutlich noch mehr an.
        return messageIds.length >= plan.limit || staleMarkers.length >= plan.limit;
      }, { applySession: options.applyWorkspaceSession });

      if (batchWasFull) await requeue(options, 'lock.cleanup', plan.workspaceId, job.payload, now());
    },
    'audit.retention': async (job) => {
      const plan = buildAuditRetentionPlan(job.payload, now());
      const batchWasFull = await withWorkspaceTransaction(options.db, {
        workspaceId: plan.workspaceId,
        role: 'system',
      }, async (db) => {
        const rows = await db
          .selectFrom('audit_events')
          .select(AUDIT_RETENTION_SELECT_COLUMNS)
          .where('workspace_id', '=', plan.workspaceId)
          .orderBy('id', 'asc')
          .limit(plan.limit + 1)
          .execute() as readonly AuditHashChainRow[];
        const verification = verifyAuditHashChain(rows);
        if (!verification.ok) {
          throw new Error(`Audit retention refused to delete unverifiable hash chain: ${verification.error}`);
        }

        const ids = auditRetentionDeletionIds(rows, plan.olderThan);
        if (ids.length === 0) return false;

        await options.auditArchive?.archive({
          workspaceId: plan.workspaceId,
          olderThan: plan.olderThan,
          rows: auditRetentionRowsByIds(rows, ids),
        });

        await db
          .deleteFrom('audit_events')
          .where('workspace_id', '=', plan.workspaceId)
          .where('id', 'in', ids)
          .executeTakeFirst();

        // Es wurden `limit + 1` Zeilen gelesen und die Randzeile der Hash-Kette
        // bleibt stehen — `limit` Loeschungen sind also die volle Charge.
        return ids.length >= plan.limit;
      }, { applySession: options.applyWorkspaceSession });

      if (batchWasFull) await requeue(options, 'audit.retention', plan.workspaceId, job.payload, now());
    },
  };
}

/**
 * Naechste Charge desselben Wartungsjobs nachschieben.
 *
 * Bewusst NACH der Transaktion: ein Rollback soll keine Folgecharge hinterlassen.
 * Ein Fehler beim Nachschieben darf den bereits erledigten Lauf nicht als
 * gescheitert dastehen lassen — sonst wiederholte Graphile ihn und die
 * naechste Charge kaeme ohnehin. Die Payload wird unveraendert weitergereicht,
 * damit Betriebs-Ueberschreibungen (limit, Aufbewahrungsfenster) erhalten
 * bleiben.
 */
async function requeue(
  options: MaintenanceJobHandlersOptions,
  type: 'lock.cleanup' | 'audit.retention',
  workspaceId: string,
  payload: JobPayload,
  now: Date,
): Promise<void> {
  if (!options.requeue) return;
  await options.requeue.enqueue({
    type,
    workspaceId,
    payload,
    runAfter: new Date(now.getTime() + MAINTENANCE_REQUEUE_DELAY_MS),
  }).catch(() => undefined);
}

export function auditRetentionRowsByIds(
  rows: readonly AuditHashChainRow[],
  ids: readonly number[],
): readonly AuditHashChainRow[] {
  const selected = new Set(ids);
  return rows.filter((row) => selected.has(row.id));
}

export function auditRetentionDeletionIds(
  rows: readonly Pick<AuditHashChainRow, 'id' | 'created_at'>[],
  olderThan: Date,
): number[] {
  const expiredPrefix: Array<Pick<AuditHashChainRow, 'id' | 'created_at'>> = [];
  for (const row of rows) {
    if (toDate(row.created_at).getTime() >= olderThan.getTime()) break;
    expiredPrefix.push(row);
  }

  if (expiredPrefix.length <= 1) return [];
  return expiredPrefix.slice(0, -1).map((row) => row.id);
}

export function buildLockCleanupPlan(payload: JobPayload, now: Date): MaintenanceCleanupPlan {
  const workspaceId = requiredString(payload, 'workspaceId');
  const staleSeconds = optionalInteger(
    payload,
    'staleSeconds',
    CONVERSATION_LOCK_TIMEOUT_SECONDS,
    1,
    24 * 60 * 60,
  );
  const markerRetentionDays = optionalInteger(
    payload,
    'terminalMarkerRetentionDays',
    DEFAULT_TERMINAL_MARKER_RETENTION_DAYS,
    1,
    365,
  );
  return {
    workspaceId,
    staleBefore: new Date(now.getTime() - staleSeconds * 1000),
    terminalMarkersBefore: new Date(now.getTime() - markerRetentionDays * 24 * 60 * 60 * 1000),
    limit: optionalInteger(payload, 'limit', DEFAULT_LOCK_CLEANUP_LIMIT, 1, MAX_LOCK_CLEANUP_LIMIT),
  };
}

export function buildAuditRetentionPlan(payload: JobPayload, now: Date): AuditRetentionPlan {
  const workspaceId = requiredString(payload, 'workspaceId');
  const retentionDays = optionalInteger(payload, 'retentionDays', DEFAULT_AUDIT_RETENTION_DAYS, 1, 3650);
  return {
    workspaceId,
    olderThan: new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000),
    limit: optionalInteger(payload, 'limit', DEFAULT_AUDIT_RETENTION_LIMIT, 1, MAX_AUDIT_RETENTION_LIMIT),
  };
}

export function mergeJobHandlerRegistries(
  fallback: JobHandlerRegistry,
  overrides: JobHandlerRegistry,
): JobHandlerRegistry {
  return {
    ...fallback,
    ...overrides,
  };
}

function requiredString(payload: JobPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${key} is required`);
  }
  return value.trim();
}

function optionalInteger(
  payload: JobPayload,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = payload[key];
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${key} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function toDate(value: Date | string): Date {
  return value instanceof Date ? value : new Date(value);
}
