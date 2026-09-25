import type { SqlMigration } from './types';

/**
 * Holt den Aufraeum-Schritt aus 0019 mit RLS-Kontext nach (F-A2c-01).
 *
 * 0019 setzt Aufgaben, deren zugewiesener Nutzer bzw. Gruppe geloescht wurde
 * (ON DELETE SET NULL, scope blieb 'user'/'group'), auf 'global' zurueck. Das
 * UPDATE lief aber ohne app.*-Kontext. tasks hat FORCE ROW LEVEL SECURITY, der
 * Migrationsnutzer ist Tabelleneigentuemer ohne BYPASSRLS: die Policy sah keine
 * Zeile, das UPDATE war ein stiller No-op. Solche Aufgaben blieben fuer alle
 * Nicht-Admins unsichtbar. 0019 bleibt unveraendert (gespeicherte Checksumme).
 *
 * Idempotent: danach gibt es keine verwaisten Zeilen mehr, ein zweiter Lauf
 * aendert nichts; der Trigger aus 0019 verhindert neue.
 */
export const taskAssignmentScopeOrphanBackfillMigration: SqlMigration = {
  id: '0053_task_assignment_scope_orphan_backfill',
  description: 'Re-runs the 0019 orphaned task assignment scope cleanup with a system RLS context.',
  upSql: [
    `SELECT set_config('app.role', 'system', true),
       set_config('app.cross_workspace_access', 'on', true);`,
    `UPDATE tasks SET assignment_scope = 'global'
       WHERE (assignment_scope = 'user' AND assigned_user_id IS NULL)
          OR (assignment_scope = 'group' AND assigned_group_id IS NULL);`,
  ],
  // Absichtlich ein No-op: welche Aufgaben vorher verwaist waren, ist nicht
  // gespeichert, und sie wieder unsichtbar zu machen waere kein Rollback.
  downSql: [
    'SELECT 1;',
  ],
};
