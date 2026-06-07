import type { SqlMigration } from './types';

/**
 * 0016 declared assigned_user_id / assigned_group_id with ON DELETE SET NULL.
 * When the referenced user/group is deleted the FK becomes NULL but
 * assignment_scope stays at 'user' / 'group'. The visibility filter for
 * non-admins matches on (scope='global') OR (scope='user' AND user_id=:me) OR
 * (scope='group' AND group in :my_groups), so a task pinned to a deleted user
 * becomes invisible to everyone instead of falling back to global.
 *
 * Fix: a small AFTER UPDATE trigger that resets the scope to 'global' whenever
 * the FK column flips to NULL. Keeps the data model consistent without a UI
 * change and works for both user and group deletions.
 */
export const taskAssignmentScopeResetMigration: SqlMigration = {
  id: '0019_task_assignment_scope_reset',
  description: 'Resets task assignment_scope to global when its assignee FK becomes NULL on deletion cascade.',
  upSql: [
    `CREATE OR REPLACE FUNCTION app.reset_task_assignment_scope_to_global()
RETURNS trigger AS $$
BEGIN
  -- Triggered by ON DELETE SET NULL on assigned_user_id / assigned_group_id.
  -- Without this reset, a task pinned to a deleted user/group keeps its
  -- assignment_scope='user'|'group' and disappears for non-admin viewers
  -- (whose visibility filter has no match for the now-NULL assignee).
  IF NEW.assignment_scope = 'user' AND NEW.assigned_user_id IS NULL
     AND (OLD.assigned_user_id IS DISTINCT FROM NEW.assigned_user_id) THEN
    NEW.assignment_scope := 'global';
  END IF;
  IF NEW.assignment_scope = 'group' AND NEW.assigned_group_id IS NULL
     AND (OLD.assigned_group_id IS DISTINCT FROM NEW.assigned_group_id) THEN
    NEW.assignment_scope := 'global';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;`,
    `DROP TRIGGER IF EXISTS tasks_reset_assignment_scope_to_global ON tasks;`,
    `CREATE TRIGGER tasks_reset_assignment_scope_to_global
BEFORE UPDATE OF assigned_user_id, assigned_group_id ON tasks
FOR EACH ROW
EXECUTE FUNCTION app.reset_task_assignment_scope_to_global();`,
    // One-time cleanup of existing orphaned rows (deleted user/group before the
    // trigger existed).
    `UPDATE tasks SET assignment_scope = 'global'
       WHERE (assignment_scope = 'user' AND assigned_user_id IS NULL)
          OR (assignment_scope = 'group' AND assigned_group_id IS NULL);`,
  ],
  downSql: [
    `DROP TRIGGER IF EXISTS tasks_reset_assignment_scope_to_global ON tasks;`,
    `DROP FUNCTION IF EXISTS app.reset_task_assignment_scope_to_global();`,
  ],
};
