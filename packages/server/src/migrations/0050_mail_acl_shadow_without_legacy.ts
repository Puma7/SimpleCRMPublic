import type { SqlMigration } from './types';

/**
 * Workspaces aus dem Shadow-Modus holen, in denen es nichts zu vergleichen gibt.
 *
 * Die Shadow-Phase existiert, um BESTEHENDE Installationen von der
 * Legacy-Autorisierung (`user_account_access`) auf die Mail-ACL zu heben und
 * dabei die Abweichungen zu zaehlen. Genau so steht es beim Anlegen eines neuen
 * Workspace begruendet (postgres-auth-port.ts), der deshalb 'enforce' bekommt:
 * ohne Legacy-Zustand gibt es keinen Vergleich.
 *
 * Der Backfill in 0039 hat dieses Kriterium nicht angewandt und JEDEN damals
 * vorhandenen Workspace auf 'shadow' gesetzt — auch die, deren
 * `user_account_access` leer war. Und leer ist sie in der Server-Edition der
 * Normalfall: geschrieben wird die Tabelle dort von keiner einzigen Stelle, sie
 * fuellt sich nur beim Import aus einer SQLite-Desktop-Datenbank.
 *
 * Die Folge ist keine Ungenauigkeit, sondern eine Sperre. Im Shadow-Modus
 * lautet die Entscheidung `legacyAllowed && …`, und `resolveScope` nimmt
 * ausschliesslich die Legacy-Kontenliste. Ohne eine einzige Zeile dort ist
 * `legacyAllowed` konstant false: jeder Nicht-Admin sieht kein Konto und keine
 * Nachricht, egal welche Delegation eingerichtet ist. Owner und Admin merken
 * nichts davon, weil sie vor dieser Logik abzweigen.
 *
 * Der Ausweg war zusaetzlich versperrt: `transitionToEnforce` verweigert bei
 * Mismatches, und eine eingerichtete Delegation erzeugt bei jedem Zugriff genau
 * einen (`legacyDenyNewAllow`). Der Workspace konnte den Modus also weder
 * nutzen noch verlassen.
 *
 * Deshalb hier eng und pruefbar: NUR Workspaces im Shadow-Modus, die keine
 * einzige Legacy-Zeile haben. Fuer sie ist der Vergleich beweisbar leer und
 * 'enforce' der Zustand, den ein heute angelegter Workspace ohnehin bekaeme.
 * Wer aus einer Desktop-Installation migriert hat, hat Legacy-Zeilen, behaelt
 * Shadow und seinen Vergleich.
 *
 * Die Zaehler werden mit zurueckgesetzt: sie beschreiben eine Beobachtung, die
 * nie eine war (gezaehlte "Abweichungen" gegen eine leere Legacy-Seite), und
 * blieben sonst als Diagnoserauschen in der Readiness-Ansicht stehen.
 */
export const mailAclShadowWithoutLegacyMigration: SqlMigration = {
  id: '0050_mail_acl_shadow_without_legacy',
  description: 'Move workspaces without any legacy mail ACL rows out of shadow mode',
  upSql: [
    `SELECT set_config('app.role', 'system', true),
       set_config('app.cross_workspace_access', 'on', true);`,
    `UPDATE mail_acl_rollout_state AS rollout
SET
  mode = 'enforce',
  evaluated = 0,
  legacy_allow_new_deny = 0,
  legacy_deny_new_allow = 0,
  not_comparable = 0,
  observation_started_at = NULL,
  observation_updated_at = NULL,
  updated_at = now()
WHERE rollout.mode = 'shadow'
  AND NOT EXISTS (
    SELECT 1
    FROM user_account_access AS legacy
    WHERE legacy.workspace_id = rollout.workspace_id
  );`,
  ],
  // Absichtlich ein No-op (wie 0040/0042). Zurueck nach 'shadow' hiesse, die
  // Sperre wiederherzustellen, die diese Migration aufhebt — fuer genau die
  // Workspaces, in denen sie nachweislich nichts absichert. Ein downSql, das
  // Zugriff entzieht, waere kein Rollback, sondern ein zweiter Ausfall.
  //
  // Es passt ausserdem zum Rest: der Uebergang ist ueberhaupt nur in eine
  // Richtung vorgesehen — es gibt keine Route und keine Portfunktion zurueck
  // nach 'shadow'. Diese Migration bringt die betroffenen Workspaces also in
  // denselben Endzustand, den auch ein regulaeres Umschalten erreicht.
  downSql: [
    'SELECT 1;',
  ],
};
