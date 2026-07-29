import type { SqlMigration } from './types';

/**
 * Wann wurde fuer dieses Konto zuletzt ein Sync ANGESTOSSEN?
 *
 * Zwei Dinge brauchen diese Angabe, und beide gab es bisher nicht:
 *
 * 1. Der periodische Sync. Im Serverbetrieb wurde Mail-Sync ausschliesslich
 *    ueber die Route und einen Workflow-Knoten eingereiht — kein Ticker, kein
 *    IMAP IDLE, und der Job plant sich nicht selbst nach. Post kam also nur
 *    herein, wenn jemand auf Aktualisieren drueckte. Der Scheduler waehlt die
 *    faelligen Konten ueber genau diese Spalte aus.
 *
 * 2. Die Abkuehlzeit des Aktualisieren-Knopfes. Die Coalescing-Logik von
 *    Graphile schuetzt den SYNC (ein Job je Konto, wartende Duplikate werden
 *    ersetzt), nicht die API: hundert Klicks sind hundert HTTP-Anfragen samt
 *    Einreihung. Die 15-Sekunden-Sperre im Client gilt je Browser-Tab und
 *    hilft ueber viele Nutzer hinweg gar nicht.
 *
 * Bewusst der ANSTOSS und nicht der Abschluss: `email_folders.last_synced_at`
 * gibt es schon, wird aber beim erfolgreichen Ordner-Sync gesetzt. Ein Lauf,
 * der frueh scheitert (Zugangsdaten falsch, Server nicht erreichbar), liesse
 * das Konto damit dauerhaft „faellig" aussehen — der Scheduler wuerde es in
 * jeder Runde erneut einreihen und der Mailserver bekaeme genau dann die
 * meisten Verbindungsversuche, wenn er ohnehin nicht mag.
 *
 * Der Index deckt die Frage des Schedulers ab: welche Konten sind faellig.
 * NULLS FIRST, weil ein Konto ohne jeden Lauf zuerst drankommen soll.
 *
 * `last_full_inbox_started_at` ist bewusst eine ZWEITE Spalte und keine
 * Wiederverwendung der ersten. Der Vollimport hat eine eigene, viel laengere
 * Abkuehlzeit (15 Minuten statt 30 Sekunden), und beide an derselben Spalte zu
 * messen hiesse, sie an einem Wert zu messen, den der periodische Sync alle
 * fuenf Minuten neu setzt: der Vollimport-Zeitstempel laege dann dauerhaft
 * innerhalb seines eigenen Fensters und ein Nachholen waere nie wieder
 * ausloesbar — genau die Nachricht, die der Erst-Sync uebersprungen hat, kaeme
 * damit nie. Zwei Fragen, zwei Spalten.
 *
 * Kein eigener Index: die Spalte wird immer zusammen mit einem konkreten Konto
 * gelesen (Primaerschluessel), nie als Suchkriterium ueber alle Konten — nur
 * der Scheduler sucht, und der fragt nach `last_sync_started_at`.
 */
export const emailAccountSyncScheduleMigration: SqlMigration = {
  id: '0051_email_account_sync_schedule',
  description: 'Record when an account sync was last started, for scheduling and refresh cooldown',
  upSql: [
    `ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS last_sync_started_at timestamptz;`,
    `ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS last_full_inbox_started_at timestamptz;`,
    `CREATE INDEX IF NOT EXISTS email_accounts_sync_due_idx
  ON email_accounts (workspace_id, last_sync_started_at ASC NULLS FIRST);`,
  ],
  downSql: [
    'DROP INDEX IF EXISTS email_accounts_sync_due_idx;',
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS last_full_inbox_started_at;',
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS last_sync_started_at;',
  ],
};
