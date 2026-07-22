import type { SqlMigration } from './types';

export const atomicTaskCalendarMigration: SqlMigration = {
  id: '0043_atomic_task_calendar',
  description: 'Make task calendar links workspace-safe, unique, and cascading.',
  upSql: [
    `SELECT set_config('app.role', 'system', true),
       set_config('app.cross_workspace_access', 'on', true);`,
    `UPDATE calendar_events AS event
        SET task_id = NULL,
            task_source_sqlite_id = NULL,
            event_type = NULL,
            recurrence_rule = NULL,
            updated_at = now()
      WHERE event.task_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
            FROM tasks AS task
           WHERE task.id = event.task_id
             AND task.workspace_id = event.workspace_id
        );`,
    `WITH ranked AS (
       SELECT id,
              row_number() OVER (
                PARTITION BY workspace_id, task_id
                ORDER BY updated_at DESC NULLS LAST, id DESC
              ) AS link_rank
         FROM calendar_events
        WHERE task_id IS NOT NULL
     )
     UPDATE calendar_events AS event
        SET task_id = NULL,
            task_source_sqlite_id = NULL,
            event_type = NULL,
            recurrence_rule = NULL,
            updated_at = now()
       FROM ranked
      WHERE ranked.id = event.id
        AND ranked.link_rank > 1;`,
    'CREATE UNIQUE INDEX IF NOT EXISTS tasks_workspace_id_unique_idx ON tasks (workspace_id, id);',
    'ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_task_id_fkey;',
    `ALTER TABLE calendar_events
       ADD CONSTRAINT calendar_events_workspace_task_fkey
       FOREIGN KEY (workspace_id, task_id)
       REFERENCES tasks (workspace_id, id)
       ON DELETE CASCADE;`,
    `CREATE UNIQUE INDEX IF NOT EXISTS calendar_events_workspace_task_unique_idx
       ON calendar_events (workspace_id, task_id)
       WHERE task_id IS NOT NULL;`,
  ],
  downSql: [
    'DROP INDEX IF EXISTS calendar_events_workspace_task_unique_idx;',
    'ALTER TABLE calendar_events DROP CONSTRAINT IF EXISTS calendar_events_workspace_task_fkey;',
    `ALTER TABLE calendar_events
       ADD CONSTRAINT calendar_events_task_id_fkey
       FOREIGN KEY (task_id)
       REFERENCES tasks (id)
       ON DELETE SET NULL;`,
    'DROP INDEX IF EXISTS tasks_workspace_id_unique_idx;',
  ],
};
