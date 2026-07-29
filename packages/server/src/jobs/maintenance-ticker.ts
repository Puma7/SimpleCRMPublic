import { randomUUID } from 'node:crypto';
import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../db/schema';
import { withWorkspaceTransaction, type WorkspaceSessionApplier } from '../db/workspace-context';
import { buildTrustedServiceJobPayload } from './policy';
import type { EnqueueJobInput } from './types';
import { DEFAULT_MAIL_SYNC_SCHEDULE_INTERVAL_MS } from './mail-sync-scheduler';

/**
 * Taktgeber fuer die Wartungsjobs.
 *
 * `lock.cleanup` und `audit.retention` waren vollstaendig implementiert, wurden
 * aber von keiner Stelle eingereiht — Handler, Policy-Eintrag und Job-Key gab es,
 * nur niemanden, der sie ausloest. Damit liefen drei Aufraeumarbeiten nie:
 * verwaiste Konversations-Sperren, die Audit-Retention und die Aufbewahrung der
 * Abschlussmarker terminaler Kindjobs (`inbound_terminal_child_done:*` in
 * sync_info, siehe maintenance-handlers).
 *
 * Bewusst ein prozessinterner Ticker statt Graphile-Crontab oder externem
 * Scheduler:
 *
 * - Ein Cron-Eintrag traegt eine STATISCHE Payload, die Handler brauchen aber je
 *   eine workspaceId. Das hiesse entweder ein Eintrag je Workspace in einer
 *   Konfigdatei (pflegebeduerftig bei jedem neuen Workspace) oder ein zusaetzlicher
 *   Jobtyp, der alle Workspaces durchgeht.
 * - Ein externer Scheduler braeuchte zuerst einen Einreih-Weg nach aussen (CLI oder
 *   Endpunkt samt Auth), den es nicht gibt.
 * - Mehrere Server-Instanzen sind unkritisch: beide Jobtypen haben einen
 *   workspace-skopierten Graphile-Job-Key und `jobKeyMode: 'replace'`, es kann also
 *   pro Workspace hoechstens ein wartender Job existieren. Gleichzeitige Enqueues
 *   kollabieren auf einen, die Queue fuehrt ihn genau einmal aus.
 *
 * Bauform wie die uebrigen Ticker (email-tracking Retention, Scheduled-Send):
 * selbst nachplanendes setTimeout statt setInterval, damit sich Laeufe nie
 * ueberlappen, `unref` fuer sauberes Prozessende, Fehler je Workspace isoliert.
 */

/** Verwaiste Sperren und abgelaufene Abschlussmarker: stuendlich. */
export const DEFAULT_LOCK_CLEANUP_INTERVAL_MS = 60 * 60_000;
/** Audit-Retention arbeitet auf Jahresfenstern — taeglich genuegt. */
export const DEFAULT_AUDIT_RETENTION_INTERVAL_MS = 24 * 60 * 60_000;
/** Nicht sofort beim Start: erst hochfahren lassen, dann aufraeumen. */
export const DEFAULT_MAINTENANCE_INITIAL_DELAY_MS = 60_000;

export type MaintenanceTickerJobType = 'lock.cleanup' | 'audit.retention' | 'mail.sync.schedule';

export type MaintenanceTickerQueue = Readonly<{
  enqueue(input: EnqueueJobInput): Promise<unknown>;
}>;

export type MaintenanceTickerHandle = Readonly<{ stop(): void }>;

export function startMaintenanceJobTicker(input: {
  db: Kysely<ServerDatabase>;
  queue: MaintenanceTickerQueue;
  jobType: MaintenanceTickerJobType;
  intervalMs?: number;
  initialDelayMs?: number;
  log?: (message: string) => void;
  /** Wie bei createMaintenanceJobHandlers: erlaubt Tests ohne echte RLS-Session. */
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): MaintenanceTickerHandle {
  const intervalMs = positiveDelay(input.intervalMs, defaultIntervalFor(input.jobType));
  const initialDelayMs = positiveDelay(input.initialDelayMs, DEFAULT_MAINTENANCE_INITIAL_DELAY_MS);
  const warn = input.log ?? ((message: string) => console.warn(message));
  let stopped = false;
  let running = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const schedule = (delayMs: number) => {
    timer = setTimeout(() => void tick(), delayMs);
    timer.unref?.();
  };

  const tick = async () => {
    if (stopped || running) return;
    running = true;
    try {
      const workspaceIds = await listWorkspaceIds(input.db, input.applyWorkspaceSession);
      for (const workspaceId of workspaceIds) {
        if (stopped) return;
        // Fehler je Workspace isolieren: ein kaputter Workspace darf die
        // Wartung aller anderen nicht ausfallen lassen.
        await input.queue.enqueue({
          type: input.jobType,
          workspaceId,
          payload: buildTrustedServiceJobPayload({ workspaceId }),
        }).catch((error) => {
          warn(`[maintenance] ${input.jobType} konnte fuer Workspace ${workspaceId} nicht eingereiht werden: ${errorMessage(error)}`);
        });
      }
    } catch (error) {
      warn(`[maintenance] ${input.jobType}: Workspace-Liste nicht lesbar: ${errorMessage(error)}`);
    } finally {
      running = false;
      if (!stopped) schedule(intervalMs);
    }
  };

  schedule(initialDelayMs);
  return {
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}

function defaultIntervalFor(jobType: MaintenanceTickerJobType): number {
  if (jobType === 'audit.retention') return DEFAULT_AUDIT_RETENTION_INTERVAL_MS;
  // Der Sync-Taktgeber sieht oft nach, tut aber selten etwas: faellig ist ein
  // Konto erst nach seinem eigenen, laengeren Intervall
  // (DEFAULT_MAIL_SYNC_INTERVAL_MS). Haeufiges Nachsehen macht die Verzoegerung
  // vorhersehbar, statt sie auf ein ganzes Sync-Intervall aufzurunden.
  if (jobType === 'mail.sync.schedule') return DEFAULT_MAIL_SYNC_SCHEDULE_INTERVAL_MS;
  return DEFAULT_LOCK_CLEANUP_INTERVAL_MS;
}

async function listWorkspaceIds(
  db: Kysely<ServerDatabase>,
  applySession?: WorkspaceSessionApplier,
): Promise<string[]> {
  const rows = await withWorkspaceTransaction(
    db,
    // Die Wartung gilt allen Workspaces, gehoert aber zu keinem — wie beim
    // Retention-Ticker in email-tracking eine Platzhalter-Id mit
    // workspace-uebergreifendem Lesezugriff unter der Systemrolle.
    { workspaceId: randomUUID(), role: 'system', crossWorkspaceAccess: true },
    (trx) => trx
      .selectFrom('workspaces')
      .select('id')
      .orderBy('id', 'asc')
      .execute(),
    { applySession },
  );
  return [...new Set(rows.map((row) => String(row.id)))];
}

function positiveDelay(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 10
    ? Math.trunc(value)
    : fallback;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
