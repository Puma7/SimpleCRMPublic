import type { SqlMigration } from './types';

/**
 * Ablage fuer den nicht-geheimen Fingerabdruck des Master-Keys.
 *
 * Der Dump enthaelt alle Secrets verschluesselt, den Schluessel selbst nie. Wird
 * er mit der falschen .env eingespielt, ist die Datenbank vollstaendig und
 * trotzdem unbrauchbar — und bisher fiel das erst auf, wenn das erste Postfach
 * nicht mehr synchronisierte. Die mitgefuehrte key_id half nicht: sie lautet in
 * jeder Installation 'default'.
 *
 * Der Fingerabdruck steht deshalb IN der Datenbank und wandert mit dem Dump. Ein
 * Server, der danach mit einem anderen Schluessel startet, sieht die Abweichung
 * sofort.
 *
 * Bewusst OHNE workspace_id und ohne RLS: der Master-Key gilt fuer die ganze
 * Installation, nicht je Workspace, und der Wert ist nicht geheim (HMAC ueber
 * ein festes Etikett — aus ihm folgt nichts ueber den Schluessel). Eine
 * Workspace-Spalte waere eine Behauptung, die nicht stimmt.
 *
 * Ein Datensatz je key_id, damit ein spaeterer Schluesselwechsel beide Werte
 * nebeneinander halten kann, statt den alten stillschweigend zu ueberschreiben.
 */
export const masterKeyFingerprintMigration: SqlMigration = {
  id: '0049_master_key_fingerprint',
  description: 'Record a non-secret fingerprint of the master key so a mismatched .env is detectable',
  upSql: [
    `CREATE TABLE IF NOT EXISTS master_key_fingerprints (
  key_id text PRIMARY KEY,
  fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
  ],
  downSql: [
    'DROP TABLE IF EXISTS master_key_fingerprints;',
  ],
};
