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
  /**
   * Konten, deren Einreihung fehlschlug. Sie sind NICHT gestempelt und im
   * naechsten Takt wieder faellig. Bewusst zurueckgegeben statt verschluckt:
   * ein Takt, in dem nichts eingereiht wurde, soll sich von einem
   * unterscheiden, in dem nichts faellig war.
   */
  failed: readonly { accountId: number; error: unknown }[];
}>;

type DueAccountRow = Readonly<{
  id: number;
  protocol: string | null;
  /** Mitgelesen, um einen Anspruch nach einem Queue-Fehler genau zurueckzunehmen. */
  last_sync_started_at: Date | string | null;
}>;

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

  // Konten mit nicht unterstuetztem Protokoll werden schon in der ABFRAGE
  // ausgeschlossen, nicht erst in der Schleife. Sie dort zu ueberspringen
  // genuegte nicht: sie werden dabei (bewusst) nicht gestempelt, bleiben also
  // dauerhaft faellig — und weil die aeltesten zuerst drankommen, stuenden sie
  // fuer immer vorn und koennten den ganzen Stapel belegen. Ab 200 solcher
  // Konten kaeme kein einziges IMAP-Konto mehr dran.
  const due = await withWorkspaceTransaction(
    input.db,
    { workspaceId: input.workspaceId, role: 'system' },
    async (trx) => dueAccountsQuery(trx, {
      workspaceId: input.workspaceId,
      threshold,
      limit: batchSize + 1,
    }).execute() as Promise<DueAccountRow[]>,
    { applySession: input.applyWorkspaceSession },
  );

  const batch = due.slice(0, batchSize);
  const hasMore = due.length > batch.length;

  let enqueued = 0;
  const failed: Array<{ accountId: number; error: unknown }> = [];
  for (const account of batch) {
    // Die Abfrage laesst nur unterstuetzte Protokolle durch; bleibt hier
    // trotzdem eines uebrig, ist die Zeile nach der Auswahl geaendert worden.
    // Dann gilt dasselbe wie dort: nicht stempeln, sonst sieht der Scheduler
    // das Konto als behandelt an und verdeckt, dass nichts passiert.
    const jobType = mailSyncJobTypeForProtocol(account.protocol);
    if (!jobType) continue;

    // ERST beanspruchen, DANN einreihen — und bei einem Fehlschlag zurueck.
    //
    // Die umgekehrte Reihenfolge (einreihen, dann stempeln) vermied zwar den
    // Zeitstempel-ohne-Job, gab dafuer aber den Anspruch auf: zwischen Auswahl
    // und Stempel kann ein Nutzer einen Vollimport ausloesen, der beide
    // Zeitspalten setzt und seinen eigenen Job einreiht. Der Scheduler haette
    // seinen gewoehnlichen Sync da laengst eingereiht und merkte den verlorenen
    // Anspruch erst danach — beide Jobs blieben liegen (sie teilen sich seit
    // dem ':full'-Suffix keinen Job-Key mehr) und liefen ueber dieselbe
    // Konto-Queue direkt nacheinander. Genau den zweiten Abruf soll das
    // doppelte Stempeln des Vollimports verhindern.
    //
    // Das bedingte UPDATE ist der Anspruch: wer keine Zeile zurueckbekommt, war
    // nicht der Erste und reiht gar nicht erst ein.
    const claimed = await withWorkspaceTransaction(
      input.db,
      { workspaceId: input.workspaceId, role: 'system' },
      async (trx) => trx
        .updateTable('email_accounts')
        .set({ last_sync_started_at: now })
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', account.id)
        .where((eb) => eb.or([
          eb('last_sync_started_at', 'is', null),
          eb('last_sync_started_at', '<', threshold),
        ]))
        .returning('id')
        .executeTakeFirst(),
      { applySession: input.applyWorkspaceSession },
    );
    // Eine zweite Instanz oder ein Vollimport war schneller. Deren Job deckt
    // dieses Konto ab; ein zweiter waere genau der doppelte Abruf.
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
    } catch (error) {
      // Anspruch zuruecknehmen, sonst galte das Konto fuer das volle Intervall
      // als bedient, obwohl nie ein Job entstand — der Zeitstempel-ohne-Erfolg,
      // gegen den dieser Scheduler an anderer Stelle schon abgesichert ist.
      // Bedingt auf den eigenen Stempel: hat inzwischen jemand anders
      // beansprucht, gehoert die Zeile ihm.
      await withWorkspaceTransaction(
        input.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => trx
          .updateTable('email_accounts')
          .set({
            last_sync_started_at: account.last_sync_started_at === null
              ? null
              : new Date(String(account.last_sync_started_at)),
          })
          .where('workspace_id', '=', input.workspaceId)
          .where('id', '=', account.id)
          .where('last_sync_started_at', '=', now)
          .execute(),
        { applySession: input.applyWorkspaceSession },
      ).catch(() => undefined);
      // Ein einzelnes Konto darf den Takt nicht mitreissen: die uebrigen
      // faelligen sind bereits ausgewaehlt und wuerden sonst diesen Lauf gar
      // nicht erst versucht.
      failed.push({ accountId: account.id, error });
      continue;
    }
    enqueued += 1;
  }

  return { enqueued, hasMore, failed };
}

/**
 * Die Auswahlabfrage der faelligen Konten — herausgezogen, damit ein Test sie
 * kompilieren und das erzeugte SQL pruefen kann.
 *
 * Zwei Eigenschaften sind nicht am Verhalten eines Mocks ablesbar, sondern nur
 * am SQL: dass NULLS FIRST wirklich dasteht (Postgres sortiert bei ASC von
 * sich aus NULLS LAST), und dass die Protokoll-Auswahl in der Abfrage steckt
 * und nicht erst in der Schleife.
 */
export function dueAccountsQuery(
  trx: Kysely<ServerDatabase>,
  input: Readonly<{ workspaceId: string; threshold: Date; limit: number }>,
) {
  return trx
    .selectFrom('email_accounts')
    .select(['id', 'protocol', 'last_sync_started_at'])
    .where('workspace_id', '=', input.workspaceId)
    .where((eb) => eb.or([
      eb('last_sync_started_at', 'is', null),
      eb('last_sync_started_at', '<', input.threshold),
    ]))
    // EXAKT vergleichen, nicht lower(trim(...)).
    //
    // Der Sync-Handler prueft `(account.protocol || 'imap') !== input.protocol`
    // und wirft bei Abweichung (mail-sync.ts). Ein importiertes Konto mit
    // 'IMAP' oder ' imap ' — der Import uebernimmt den Rohwert, die Spalte hat
    // keinen Constraint — waere hier also synchronisierbar, dort aber nicht:
    // gestempelt wuerde es trotzdem und erzeugte alle fuenf Minuten einen neuen
    // fehlschlagenden Job. Lieber dieselbe Strenge wie der Handler.
    .where((eb) => eb.or([
      eb('protocol', 'is', null),
      eb('protocol', 'in', ['imap', 'pop3']),
    ]))
    // NIE GESYNCTE ZUERST. Postgres sortiert bei ASC von sich aus NULLS LAST —
    // ein frisch angelegtes Konto stuende damit hinter allen ueberfaelligen und
    // bekaeme seine erste Post zuletzt, entgegen dem Index aus Migration 0051.
    // Gegen echtes Kysely 0.28 kompiliert ergibt das
    // `order by "last_sync_started_at" asc nulls first`.
    .orderBy('last_sync_started_at', (ob) => ob.asc().nullsFirst())
    .orderBy('id', 'asc')
    .limit(input.limit);
}

/**
 * Deckungsgleich mit der Pruefung im Sync-Handler: dort gilt
 * `(account.protocol || 'imap')` und ein EXAKTER Vergleich. Wer hier grosszuegig
 * normalisiert, reiht Jobs ein, die der Handler zuverlaessig ablehnt.
 */
export function mailSyncJobTypeForProtocol(
  protocol: string | null | undefined,
): 'mail.sync.imap' | 'mail.sync.pop3' | null {
  const effective = protocol === null || protocol === undefined || protocol === '' ? 'imap' : protocol;
  if (effective === 'imap') return 'mail.sync.imap';
  if (effective === 'pop3') return 'mail.sync.pop3';
  return null;
}
