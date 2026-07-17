import type { SqlMigration } from './types';

const workspacePolicyTables = [
  'dmarc_reports',
  'dmarc_records',
] as const;

export const dmarcReportsMigration: SqlMigration = {
  id: '0032_dmarc_reports',
  description: 'Workspace-scoped storage for parsed DMARC aggregate (RUA) reports and their per-source records.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS dmarc_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  org_name text NOT NULL,
  report_id text NOT NULL,
  email text,
  date_begin timestamptz NOT NULL,
  date_end timestamptz NOT NULL,
  domain text NOT NULL,
  policy_p text,
  policy_sp text,
  policy_pct integer,
  policy_adkim text,
  policy_aspf text,
  source_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, org_name, report_id)
);`,
    'CREATE INDEX IF NOT EXISTS dmarc_reports_workspace_domain_idx ON dmarc_reports (workspace_id, domain);',
    'CREATE INDEX IF NOT EXISTS dmarc_reports_workspace_date_begin_idx ON dmarc_reports (workspace_id, date_begin);',
    `CREATE TABLE IF NOT EXISTS dmarc_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  dmarc_report_id uuid NOT NULL REFERENCES dmarc_reports(id) ON DELETE CASCADE,
  source_ip text NOT NULL,
  message_count integer NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  disposition text NOT NULL,
  dkim_eval text NOT NULL,
  spf_eval text NOT NULL,
  header_from text,
  envelope_from text,
  dkim_domains text,
  spf_domains text,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
    'CREATE INDEX IF NOT EXISTS dmarc_records_workspace_report_idx ON dmarc_records (workspace_id, dmarc_report_id);',
    'CREATE INDEX IF NOT EXISTS dmarc_records_workspace_disposition_idx ON dmarc_records (workspace_id, disposition);',
    'CREATE INDEX IF NOT EXISTS dmarc_records_workspace_source_ip_idx ON dmarc_records (workspace_id, source_ip);',
    `ALTER TABLE dmarc_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE dmarc_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE dmarc_reports FORCE ROW LEVEL SECURITY;
ALTER TABLE dmarc_records FORCE ROW LEVEL SECURITY;`,
    ...workspacePolicyTables.map((tableName) => `CREATE POLICY ${tableName}_workspace_isolation ON ${tableName}
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`),
  ],
  downSql: [
    ...[...workspacePolicyTables].reverse().map((tableName) => (
      `DROP POLICY IF EXISTS ${tableName}_workspace_isolation ON ${tableName};`
    )),
    'DROP TABLE IF EXISTS dmarc_records;',
    'DROP TABLE IF EXISTS dmarc_reports;',
  ],
};
