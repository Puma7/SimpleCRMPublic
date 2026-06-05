import type { SqlMigration } from './types';

const workspacePolicyTables = [
  'calendar_events',
  'customer_custom_fields',
  'customer_custom_field_values',
  'activity_log',
  'saved_views',
  'jtl_firmen',
  'jtl_warenlager',
  'jtl_zahlungsarten',
  'jtl_versandarten',
] as const;

export const extendedCrmSchemaMigration: SqlMigration = {
  id: '0006_extended_crm_schema',
  description: 'Server edition extended CRM schema: calendar, custom fields, activity log, saved views, JTL references.',
  upSql: [
    'CREATE SEQUENCE IF NOT EXISTS jtl_references_server_source_sqlite_id_seq;',
    `CREATE TABLE IF NOT EXISTS calendar_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  title text NOT NULL,
  description text,
  start_date timestamptz NOT NULL,
  end_date timestamptz NOT NULL,
  all_day boolean NOT NULL DEFAULT false,
  color_code text,
  event_type text,
  recurrence_rule text,
  task_source_sqlite_id bigint,
  task_id bigint REFERENCES tasks(id) ON DELETE SET NULL,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS calendar_events_workspace_start_idx ON calendar_events (workspace_id, start_date);',
    `CREATE TABLE IF NOT EXISTS customer_custom_fields (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  name text NOT NULL,
  label text NOT NULL,
  type text NOT NULL,
  required boolean NOT NULL DEFAULT false,
  options jsonb,
  default_value text,
  placeholder text,
  description text,
  display_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, name)
);`,
    `CREATE TABLE IF NOT EXISTS customer_custom_field_values (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  customer_source_sqlite_id bigint NOT NULL,
  field_source_sqlite_id bigint NOT NULL,
  customer_id bigint REFERENCES customers(id) ON DELETE CASCADE,
  field_id bigint REFERENCES customer_custom_fields(id) ON DELETE CASCADE,
  value text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, customer_source_sqlite_id, field_source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS customer_custom_field_values_customer_idx ON customer_custom_field_values (workspace_id, customer_id);',
    `CREATE TABLE IF NOT EXISTS activity_log (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  customer_source_sqlite_id bigint,
  deal_source_sqlite_id bigint,
  task_source_sqlite_id bigint,
  customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  deal_id bigint REFERENCES deals(id) ON DELETE SET NULL,
  task_id bigint REFERENCES tasks(id) ON DELETE SET NULL,
  activity_type text NOT NULL,
  title text,
  description text,
  metadata jsonb,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS activity_log_workspace_created_idx ON activity_log (workspace_id, created_at DESC);',
    `CREATE TABLE IF NOT EXISTS saved_views (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  name text NOT NULL,
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_order integer NOT NULL DEFAULT 0,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS jtl_firmen (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  name text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS jtl_warenlager (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  name text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS jtl_zahlungsarten (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  name text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source_sqlite_id)
);`,
    `CREATE TABLE IF NOT EXISTS jtl_versandarten (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  name text,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, source_sqlite_id)
);`,
    `ALTER TABLE calendar_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_custom_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_custom_field_values ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE jtl_firmen ENABLE ROW LEVEL SECURITY;
ALTER TABLE jtl_warenlager ENABLE ROW LEVEL SECURITY;
ALTER TABLE jtl_zahlungsarten ENABLE ROW LEVEL SECURITY;
ALTER TABLE jtl_versandarten ENABLE ROW LEVEL SECURITY;
ALTER TABLE calendar_events FORCE ROW LEVEL SECURITY;
ALTER TABLE customer_custom_fields FORCE ROW LEVEL SECURITY;
ALTER TABLE customer_custom_field_values FORCE ROW LEVEL SECURITY;
ALTER TABLE activity_log FORCE ROW LEVEL SECURITY;
ALTER TABLE saved_views FORCE ROW LEVEL SECURITY;
ALTER TABLE jtl_firmen FORCE ROW LEVEL SECURITY;
ALTER TABLE jtl_warenlager FORCE ROW LEVEL SECURITY;
ALTER TABLE jtl_zahlungsarten FORCE ROW LEVEL SECURITY;
ALTER TABLE jtl_versandarten FORCE ROW LEVEL SECURITY;`,
    ...workspacePolicyTables.map((tableName) => `CREATE POLICY ${tableName}_workspace_isolation ON ${tableName}
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`),
  ],
  downSql: [
    ...[...workspacePolicyTables].reverse().map((tableName) => (
      `DROP POLICY IF EXISTS ${tableName}_workspace_isolation ON ${tableName};`
    )),
    'DROP TABLE IF EXISTS jtl_versandarten;',
    'DROP TABLE IF EXISTS jtl_zahlungsarten;',
    'DROP TABLE IF EXISTS jtl_warenlager;',
    'DROP TABLE IF EXISTS jtl_firmen;',
    'DROP SEQUENCE IF EXISTS jtl_references_server_source_sqlite_id_seq;',
    'DROP TABLE IF EXISTS saved_views;',
    'DROP TABLE IF EXISTS activity_log;',
    'DROP TABLE IF EXISTS customer_custom_field_values;',
    'DROP TABLE IF EXISTS customer_custom_fields;',
    'DROP TABLE IF EXISTS calendar_events;',
  ],
};
