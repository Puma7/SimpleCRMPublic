import type { Kysely } from 'kysely';
import {
  WORKFLOW_SCHEDULE_CATCH_UP_MINUTES,
  WORKFLOW_SCHEDULE_DEFAULT_TIME_ZONE,
  latestCronSlotAtOrBefore,
  normalizeWorkflowScheduleTimeZone,
  parseCronExpression,
  validateWorkflowScheduleCron,
} from '@simplecrm/core';

import type { ServerDatabase } from '../db/schema';
import { withWorkspaceTransaction, type WorkspaceSessionApplier } from '../db/workspace-context';
import { buildTrustedServiceJobPayload } from './policy';
import type { EnqueueJobInput } from './types';

/**
 * Der Zeitplan-Ausloeser der Server-Edition.
 *
 * Auf dem Desktop plant node-cron jeden Zeitplan-Workflow im Main-Prozess.
 * Der Server hat keinen solchen Dauerprozess je Workflow; stattdessen reiht
 * ein Taktgeber (maintenance-ticker) je Minute und Workspace einen
 * `workflow.schedule.tick`-Job ein, und dessen Handler (hier) fragt fuer jeden
 * aktiven Zeitplan-Workflow: welcher faellige Zeitpunkt lag zuletzt vor jetzt?
 *
 * - Genau einmal je Zeitpunkt: Ausgeloest wird nur, wer den Zeitpunkt per
 *   bedingtem UPDATE in `schedule_last_slot_at` schreibt (Muster
 *   runMailSyncSchedule). Laufen zwei Ticks gleichzeitig (mehrere
 *   Server-Prozesse, ein verspaeteter Job), bekommt nur einer die Zeile
 *   zurueck. Der Job-Key des Laufs (Workflow + Zeitpunkt) faengt zusaetzlich
 *   doppelte Einreihungen ab, solange der Lauf noch wartet.
 * - Keine Nachholung alter Zeitpunkte: nur ein Zeitpunkt, der hoechstens
 *   WORKFLOW_SCHEDULE_CATCH_UP_MINUTES zurueckliegt, wird ausgeloest — war der
 *   Server laenger aus, verfallen die verpassten.
 * - Scharf ist ein Zeitplan erst, wenn `schedule_last_slot_at` gesetzt ist.
 *   Das geschieht nur beim Anlegen, Aktivieren oder Speichern eines
 *   Zeitplan-Workflows ueber die Workflow-API (postgres-workflow-read-ports:
 *   Speicherzeitpunkt, vergangene Zeitpunkte gelten damit als erledigt).
 *   Zeilen mit NULL — Bestand aus der Zeit vor Migration 0056 und
 *   Desktop-Importe — feuern nie, bis jemand sie einmal im Server speichert.
 *   Kein Workflow beginnt also nach einem Update ueberraschend zu laufen.
 * - Zeitzone: Workspace-Einstellung `workflow_schedule_timezone`
 *   (Standard Europe/Berlin); der Server-Container selbst laeuft in UTC.
 *
 * Der Lauf selbst ist ein gewoehnlicher `workflow.execute` mit Ausloeser
 * `schedule` und Dienst-Provenienz — wie eingehende Workflows. Er laeuft in
 * der seriellen Workflow-Queue des Workspaces (`workflow-<workspaceId>`),
 * wartet also hinter bereits eingereihten Workflow-Laeufen.
 */

/** sync_info-Schluessel der Workspace-Zeitzone fuer Zeitplan-Workflows. */
export const WORKFLOW_SCHEDULE_TIMEZONE_SETTING_KEY = 'workflow_schedule_timezone';
/** Wie oft der Taktgeber je Workspace nachsieht. */
export const DEFAULT_WORKFLOW_SCHEDULE_TICK_INTERVAL_MS = 60_000;
/**
 * Inhalt von `schedule.sync_log`. Der Desktop holt vor dem Lauf das geplante
 * Konto ab und schreibt das Ergebnis hierher; der Server ruft alle Postfaecher
 * ohnehin periodisch ab (mail.sync.schedule).
 */
export const SERVER_SCHEDULE_SYNC_LOG = 'server: Postfächer werden automatisch abgerufen';
/** Obergrenze je Takt — Gegendruck gegen einen Workspace mit tausenden Zeitplaenen. */
export const MAX_SCHEDULE_WORKFLOWS_PER_TICK = 500;

export type WorkflowScheduleTickQueue = Readonly<{
  enqueue(input: EnqueueJobInput): Promise<unknown>;
}>;

export type WorkflowScheduleTickResult = Readonly<{
  /** Laeufe, die in diesem Takt eingereiht wurden. */
  enqueued: number;
  /** Aktive Zeitplan-Workflows mit ungueltigem Ausdruck (uebersprungen). */
  skippedInvalid: number;
  /** Einreihung fehlgeschlagen; der Anspruch wurde zurueckgenommen. */
  failed: readonly { workflowId: number; error: unknown }[];
}>;

type ScheduleWorkflowRow = Readonly<{
  id: number | string;
  cron_expr: string | null;
  schedule_last_slot_at: Date | string | null;
}>;

/**
 * Kontext eines Zeitplan-Laufs — dieselben Variablen wie auf dem Desktop
 * (`schedule.sync_log`), dazu Zeitpunkt und ggf. das geplante Konto, damit
 * z. B. `sync.run` weiss, welches Konto gemeint ist. Genutzt vom Taktgeber und
 * von „Jetzt ausfuehren".
 */
export function buildScheduleWorkflowContext(input: {
  firedAt: Date;
  slot: Date;
  scheduleAccountId: number | null;
  /** Ohne Nachricht synthetische, leere Mail-Felder wie der Desktop. */
  includeStrings?: boolean;
}): Record<string, unknown> {
  const eventVariables: Record<string, string | number> = {
    'schedule.fired_at': input.firedAt.toISOString(),
    'schedule.slot': input.slot.toISOString(),
    'schedule.sync_log': SERVER_SCHEDULE_SYNC_LOG,
  };
  if (input.scheduleAccountId !== null && Number.isSafeInteger(input.scheduleAccountId) && input.scheduleAccountId > 0) {
    eventVariables['email.account_id'] = input.scheduleAccountId;
  }
  return {
    ...(input.includeStrings === false ? {} : {
      eventStrings: {
        subject: '',
        body_text: '',
        snippet: SERVER_SCHEDULE_SYNC_LOG,
        from_address: '',
        to_address: '',
        cc_address: '',
        combined_text: SERVER_SCHEDULE_SYNC_LOG,
        has_attachments: 'false',
        attachment_names: '',
        attachment_types: '',
      },
    }),
    eventVariables,
  };
}

/**
 * Einmal-Protokoll fuer ungueltige Bestands-Ausdruecke: jeder Takt saehe sie
 * erneut, das Log liefe sonst minuetlich voll. Je Prozess begrenzt.
 */
const loggedInvalidSchedules = new Set<string>();
const MAX_LOGGED_INVALID_SCHEDULES = 10_000;

function logInvalidScheduleOnce(key: string, message: string, log: (message: string) => void): void {
  if (loggedInvalidSchedules.has(key)) return;
  if (loggedInvalidSchedules.size >= MAX_LOGGED_INVALID_SCHEDULES) loggedInvalidSchedules.clear();
  loggedInvalidSchedules.add(key);
  log(message);
}

/** Nur fuer Tests: Einmal-Protokoll zuruecksetzen. */
export function resetWorkflowScheduleTickLogForTests(): void {
  loggedInvalidSchedules.clear();
}

export async function runWorkflowScheduleTick(input: {
  db: Kysely<ServerDatabase>;
  queue: WorkflowScheduleTickQueue;
  workspaceId: string;
  now?: Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  log?: (message: string) => void;
}): Promise<WorkflowScheduleTickResult> {
  const now = input.now ?? new Date();
  const log = input.log ?? ((message: string) => console.warn(message));
  const session = input.applyWorkspaceSession ? { applySession: input.applyWorkspaceSession } : {};

  const { timeZoneRaw, workflows } = await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => {
      const setting = await trx
        .selectFrom('sync_info')
        .select('value')
        .where('workspace_id', '=', input.workspaceId)
        .where('key', '=', WORKFLOW_SCHEDULE_TIMEZONE_SETTING_KEY)
        .executeTakeFirst();
      const rows = await trx
        .selectFrom('email_workflows')
        .select(['id', 'cron_expr', 'schedule_last_slot_at'])
        .where('workspace_id', '=', input.workspaceId)
        .where('trigger_name', '=', 'schedule')
        .where('enabled', '=', true)
        .where('cron_expr', 'is not', null)
        // Nicht scharf (siehe oben): nie ausloesen.
        .where('schedule_last_slot_at', 'is not', null)
        .orderBy('id', 'asc')
        .limit(MAX_SCHEDULE_WORKFLOWS_PER_TICK)
        .execute() as ScheduleWorkflowRow[];
      return { timeZoneRaw: setting?.value ?? null, workflows: rows };
    },
    session,
  );

  let timeZone = normalizeWorkflowScheduleTimeZone(timeZoneRaw);
  if (!timeZone) {
    if (typeof timeZoneRaw === 'string' && timeZoneRaw.trim()) {
      logInvalidScheduleOnce(
        `${input.workspaceId}:timezone:${timeZoneRaw}`,
        `[workflow-schedule] Workspace ${input.workspaceId}: ungueltige Zeitzone „${timeZoneRaw}" — `
        + `Zeitplaene laufen in ${WORKFLOW_SCHEDULE_DEFAULT_TIME_ZONE}.`,
        log,
      );
    }
    timeZone = WORKFLOW_SCHEDULE_DEFAULT_TIME_ZONE;
  }

  let enqueued = 0;
  let skippedInvalid = 0;
  const failed: Array<{ workflowId: number; error: unknown }> = [];

  for (const workflow of workflows) {
    const workflowId = Number(workflow.id);
    const cronExpr = workflow.cron_expr ?? '';
    // Bestand kann Ausdruecke enthalten, die die Route heute ablehnt (Import
    // vom Desktop mit Sekundenfeld, zu dichter Takt). Nicht abstuerzen, nicht
    // raten — ueberspringen und einmal sagen, warum nichts passiert.
    const invalid = validateWorkflowScheduleCron(cronExpr);
    const parsed = invalid ? null : parseCronExpression(cronExpr);
    if (!parsed || !parsed.ok) {
      skippedInvalid += 1;
      logInvalidScheduleOnce(
        `${input.workspaceId}:${workflowId}:${cronExpr}`,
        `[workflow-schedule] Workflow ${workflowId} in Workspace ${input.workspaceId}: `
        + `Zeitplan „${cronExpr}" wird uebersprungen (${invalid ?? 'ungueltig'}).`,
        log,
      );
      continue;
    }

    const slot = latestCronSlotAtOrBefore(parsed.cron, now, timeZone, WORKFLOW_SCHEDULE_CATCH_UP_MINUTES);
    if (!slot) continue;
    if (workflow.schedule_last_slot_at === null) continue;
    const lastSlot = new Date(workflow.schedule_last_slot_at);
    if (slot.getTime() <= lastSlot.getTime()) continue;

    // ERST beanspruchen, DANN einreihen. Das bedingte UPDATE ist der Anspruch;
    // enabled/trigger/cron stehen mit drin, damit ein zwischenzeitlich
    // deaktivierter oder umgestellter Workflow nicht noch mit dem alten Stand
    // ausloest.
    const claimed = await withWorkspaceTransaction(
      input.db,
      { workspaceId: input.workspaceId, role: 'system' },
      async (trx) => trx
        .updateTable('email_workflows')
        .set({ schedule_last_slot_at: slot })
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', workflowId)
        .where('enabled', '=', true)
        .where('trigger_name', '=', 'schedule')
        .where('cron_expr', '=', cronExpr)
        // Nur scharfe Zeilen: NULL < slot ist in SQL nicht wahr.
        .where('schedule_last_slot_at', '<', slot)
        .returning(['id', 'schedule_account_id'])
        .executeTakeFirst(),
      session,
    );
    if (!claimed) continue;

    try {
      await input.queue.enqueue({
        workspaceId: input.workspaceId,
        type: 'workflow.execute',
        // Kein actorUserId: der Lauf gehoert keinem Menschen, sondern dem
        // Zeitplan — Dienst-Provenienz wie bei eingehenden Workflows.
        payload: buildTrustedServiceJobPayload({
          workspaceId: input.workspaceId,
          workflowId,
          triggerName: 'schedule',
          // Traegt den Job-Key (Workflow + Zeitpunkt), siehe graphileJobKeyForJob.
          scheduleSlot: slot.toISOString(),
          context: buildScheduleWorkflowContext({
            firedAt: now,
            slot,
            scheduleAccountId: claimed.schedule_account_id === null
              ? null
              : Number(claimed.schedule_account_id),
          }),
        }),
        maxAttempts: 3,
      });
    } catch (error) {
      // Anspruch zuruecknehmen, sonst galte der Zeitpunkt als ausgeloest,
      // obwohl nie ein Lauf entstand; der naechste Takt versucht es erneut,
      // solange der Zeitpunkt im Nachholfenster liegt. Bedingt auf den eigenen
      // Stempel: hat inzwischen jemand anders beansprucht (oder der Workflow
      // wurde neu gespeichert), gehoert die Zeile ihm.
      await withWorkspaceTransaction(
        input.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .updateTable('email_workflows')
          .set({ schedule_last_slot_at: lastSlot })
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', workflowId)
          .where('schedule_last_slot_at', '=', slot)
          .execute(),
        session,
      ).catch(() => undefined);
      failed.push({ workflowId, error });
      continue;
    }
    enqueued += 1;
  }

  return { enqueued, skippedInvalid, failed };
}
