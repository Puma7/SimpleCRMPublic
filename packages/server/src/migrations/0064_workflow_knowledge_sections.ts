import type { SqlMigration } from './types';

/**
 * Wissensbasis-Suche je `##`-Abschnitt (Plan 048). Die Abschnitte sind aus
 * dem Dokument abgeleitet (Cache): das Dokument (Chunk „Dokument“) bleibt die
 * einzige Quelle, die Tabelle kann jederzeit neu gebaut werden. Volltext mit
 * der Konfiguration `german` (Stoppwörter, Stammformen); Titel wiegen mehr.
 */
export const workflowKnowledgeSectionsMigration: SqlMigration = {
  id: '0064_workflow_knowledge_sections',
  description: 'Derived per-section knowledge index with german full-text search (workspace RLS)',
  upSql: [
    `CREATE TABLE IF NOT EXISTS workflow_knowledge_sections (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id bigint NOT NULL REFERENCES workflow_knowledge_bases(id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('german', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('german', coalesce(content, '')), 'B')) STORED,
  built_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, knowledge_base_id, position)
);`,
    `CREATE INDEX IF NOT EXISTS workflow_knowledge_sections_search_idx
  ON workflow_knowledge_sections USING gin (search_vector);`,
    `ALTER TABLE workflow_knowledge_sections ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE workflow_knowledge_sections FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS workflow_knowledge_sections_workspace_isolation ON workflow_knowledge_sections;`,
    `CREATE POLICY workflow_knowledge_sections_workspace_isolation ON workflow_knowledge_sections
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
  ],
  downSql: [
    'DROP POLICY IF EXISTS workflow_knowledge_sections_workspace_isolation ON workflow_knowledge_sections;',
    'DROP TABLE IF EXISTS workflow_knowledge_sections;',
  ],
};
