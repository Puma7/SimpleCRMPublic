import type { Kysely } from 'kysely';

import type { ServerDatabase } from '../db/schema';
import { withWorkspaceTransaction, type WorkspaceSessionApplier } from '../db/workspace-context';
import { buildTrustedServiceJobPayload } from './policy';
import type { EnqueueJobInput } from './types';

/**
 * Der periodische Mail-Sync.
 *
 * Vorher wurde Mail-Sync ausschliesslich ueber die Route (jemand drueckt
 * Aktualisieren) und einen Workflow-Knoten eingereiht. Kein Ticker, kein IMAP
 * IDLE, und der Job plant sich nicht selbst nach — Post kam also nur herein,
 * wenn ein Mensch danach fragte. Fuer ein Haus mit vielen Mitarbeitern ist das
 * kein Berechtigungs-, sondern ein Architekturproblem.
 *
 * Bauform bewusst zweistufig: ein Taktgeber reiht je Workspace EINEN
 * `mail.sync.schedule`-Job ein, und erst dessen Handler sucht die faelligen
 * Konten und reiht ihre Syncs ein. Der Taktgeber im Serverprozess bliebe sonst
 * bei zehntausend Konten minutenlang mit Datenbankarbeit beschaeftigt, waehrend
 * er eigentlich nur takten soll; und die Auswahl gehoert dorthin, wo sie
 * wiederholbar ist und bei einem Fehler erneut laeuft.
 */

/** Wie oft ein Konto von selbst abgeholt wird, wenn nichts anderes passiert. */
export const DEFAULT_MAIL_SYNC_INTERVAL_MS = 5 * 60_000;
/** Wie oft der Taktgeber nachsieht, ob Konten faellig sind. */
export const DEFAULT_MAIL_SYNC_SCHEDULE_INTERVAL_MS = 60_000;
/**
 * Hoechstens so viele Konten je Lauf.
 *
 * Die Grenze ist kein Sparzwang, sondern Gegendruck: sie verhindert, dass ein
 * Neustart nach laengerer Pause zehntausend Sync-Jobs auf einmal einreiht und
 * der Mailserver die gesamte Belegschaft gleichzeitig sieht. Was liegen
 * bleibt, kommt im naechsten Takt dran — die Reihenfolge (aelteste zuerst)
 * sorgt dafuer, dass niemand verhungert.
 */
export const DEFAULT_MAIL_SYNC_SCHEDULE_BATCH = 200;

export type MailSyncScheduleQueue = Readonly<{
  enqueue(input: EnqueueJobInput): Promise<unknown>;
}>;

export type MailSyncScheduleResult = Readonly<{
  /** Konten, fuer die in diesem Lauf ein Sync eingereiht wurde. */
  enqueued: number;
  /**
   * Es waren mehr Konten faellig, als die Stapelgrenze zulaesst.
   *
   * Bewusst ein Ja/Nein und keine Zahl: die Abfrage holt nur eine Zeile mehr
   * als der Stapel, um den Ueberlauf ueberhaupt zu bemerken. Eine „Anzahl
   * wartender Konten" waere damit immer 1 — eine Zahl, die etwas anderes
   * behauptet, als sie weiss. Wer sie wirklich braucht, zahlt eine eigene
   * Zaehlabfrage; fuer den Takt genuegt „es liegt noch etwas an".
   */
  hasMore: boolean;
}>;

type DueAccountRow = Readonly<{ id: number; protocol: string | null }>;

/**
 * Faellige Konten holen und ihre Syncs einreihen.
 *
 * Der Zeitstempel wird beim Einreihen gesetzt, nicht beim Abschluss des Syncs.
 * Sonst waere ein Konto, dessen Sync scheitert oder lange laeuft, im naechsten
 * Takt sofort wieder faellig — und ausgerechnet der kranke Mailserver bekaeme
 * die meisten Verbindungsversuche. Dasselbe bedingte UPDATE, das die
 * Abkuehlzeit des Knopfes benutzt, entscheidet auch hier: laufen zwei
 * Serverinstanzen, gewinnt je Konto genau eine.
 */
export async function runMailSyncSchedule(input: {
  db: Kysely<ServerDatabase>;
  queue: MailSyncScheduleQueue;
  workspaceId: string;
  intervalMs?: number;
  batchSize?: number;
  now?: Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<MailSyncScheduleResult> {
  const now = input.now ?? new Date();
  const intervalMs = Math.max(0, input.intervalMs ?? DEFAULT_MAIL_SYNC_INTERVAL_MS);
  const batchSize = Math.max(1, input.batchSize ?? DEFAULT_MAIL_SYNC_SCHEDULE_BATCH);
  const threshold = new Date(now.getTime() - intervalMs);

  const due = await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => trx
      .selectFrom('email_accounts')
      .select(['id', 'protocol'])
      .where('workspace_id', '=', input.workspaceId)
      .where((eb) => eb.or([
        eb('last_sync_started_at', 'is', null),
        eb('last_sync_started_at', '<', threshold),
      ]))
      // Aelteste zuerst — deckt sich mit dem Index aus Migration 0051 und
      // sorgt dafuer, dass unter der Stapelgrenze niemand dauerhaft hinten
      // ansteht.
      .orderBy('last_sync_started_at', 'asc')
      .orderBy('id', 'asc')
      .limit(batchSize + 1)
      .execute() as Promise<DueAccountRow[]>,
    { applySession: input.applyWorkspaceSession },
  );

  const batch = due.slice(0, batchSize);
  const hasMore = due.length > batch.length;

  let enqueued = 0;
  for (const account of batch) {
    const jobType = mailSyncJobTypeForProtocol(account.protocol);
    // Konten ohne unterstuetztes Protokoll gar nicht erst stempeln: sonst
    // sieht der Scheduler sie als „gerade behandelt" an und verdeckt, dass hier
    // dauerhaft nichts passiert.
    if (!jobType) continue;

    const claimed = await withWorkspaceTransaction(
      input.db,
      { workspaceId: input.workspaceId, role: 'system' },
      async (trx) => {
        const current = await trx
          .selectFrom('email_accounts')
          .select('last_sync_started_at')
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', account.id)
          .executeTakeFirst();
        const previousStartedAt = current?.last_sync_started_at
          ? new Date(String(current.last_sync_started_at))
          : null;

        const updated = await trx
          .updateTable('email_accounts')
          .set({ last_sync_started_at: now })
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', account.id)
          .where((eb) => eb.or([
            eb('last_sync_started_at', 'is', null),
            eb('last_sync_started_at', '<', threshold),
          ]))
          .returning('id')
          .executeTakeFirst();
        if (!updated) return null;
        return { previousStartedAt };
      },
      { applySession: input.applyWorkspaceSession },
    );
    if (!claimed) continue;

    try {
      await input.queue.enqueue({
        workspaceId: input.workspaceId,
        type: jobType,
        // Kein actorUserId: dieser Lauf gehoert keinem Menschen. Der
        // Dienst-Nachweis ist genau die Aussage, die die Job-Policy fuer den
        // Sync erwartet, wenn kein Nutzer dahintersteht.
        payload: buildTrustedServiceJobPayload({
          workspaceId: input.workspaceId,
          accountId: account.id,
        }),
      });
      enqueued += 1;
    } catch (error) {
      // Claim ist bereits gesetzt; ein transienter Enqueue-Fehler darf weder
      // die restlichen faelligen Konten im Batch mitreißen noch das Konto fuer
      // ein ganzes Intervall als „gerade behandelt" stehen lassen.
      await withWorkspaceTransaction(
        input.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .updateTable('email_accounts')
          .set({ last_sync_started_at: claimed.previousStartedAt })
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', account.id)
          .execute(),
        { applySession: input.applyWorkspaceSession },
      );
      console.error(
        `[mail-sync-schedule] enqueue failed for account ${account.id}: ${errorMessage(error)}`,
      );
    }
  }

  return { enqueued, hasMore };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function mailSyncJobTypeForProtocol(
  protocol: string | null | undefined,
): 'mail.sync.imap' | 'mail.sync.pop3' | null {
  const normalized = String(protocol ?? 'imap').trim().toLowerCase() || 'imap';
  if (normalized === 'imap') return 'mail.sync.imap';
  if (normalized === 'pop3') return 'mail.sync.pop3';
  return null;
}
