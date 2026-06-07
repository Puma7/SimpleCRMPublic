import type { SqlMigration } from './types';

export const aiUsageEventsMigration: SqlMigration = {
  id: '0017_ai_usage_events',
  description: 'Adds ai_usage_events for per-call AI token/cost/latency tracking (workspace RLS).',
  upSql: [
    `CREATE TABLE IF NOT EXISTS ai_usage_events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ai_profile_id bigint REFERENCES email_ai_profiles(id) ON DELETE SET NULL,
  model text,
  node_type text NOT NULL,
  message_id bigint,
  run_id bigint,
  actor_user_id uuid,
  prompt_tokens integer,
  completion_tokens integer,
  total_tokens integer,
  est_cost_micro_usd bigint,
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);`,
    `CREATE INDEX IF NOT EXISTS ai_usage_events_workspace_created_idx ON ai_usage_events (workspace_id, created_at DESC);`,
    `CREATE INDEX IF NOT EXISTS ai_usage_events_workspace_node_idx ON ai_usage_events (workspace_id, node_type);`,
    `ALTER TABLE ai_usage_events ENABLE ROW LEVEL SECURITY;`,
    `ALTER TABLE ai_usage_events FORCE ROW LEVEL SECURITY;`,
    `CREATE POLICY ai_usage_events_workspace_isolation ON ai_usage_events
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`,
  ],
  downSql: [
    `DROP POLICY IF EXISTS ai_usage_events_workspace_isolation ON ai_usage_events`,
    `DROP INDEX IF EXISTS ai_usage_events_workspace_node_idx`,
    `DROP INDEX IF EXISTS ai_usage_events_workspace_created_idx`,
    `DROP TABLE IF EXISTS ai_usage_events`,
  ],
};
