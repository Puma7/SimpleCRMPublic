import type { SqlMigration } from './types';

export const taskCustomerOptionalMigration: SqlMigration = {
  id: '0015_task_customer_optional',
  description: 'Makes the task customer optional by allowing a null customer_source_sqlite_id.',
  upSql: [
    `ALTER TABLE tasks ALTER COLUMN customer_source_sqlite_id DROP NOT NULL`,
  ],
  downSql: [
    // Reinstating NOT NULL requires that no customerless tasks exist.
    `ALTER TABLE tasks ALTER COLUMN customer_source_sqlite_id SET NOT NULL`,
  ],
};
