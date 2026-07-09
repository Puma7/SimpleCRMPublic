import type { SqlMigration } from './types';

/**
 * Phase 5/6 of the returns/RMA suite: public customer portal.
 *
 * Adds a per-workspace `workspace_portal_settings` row that holds an opaque
 * random portal token. The token is the *only* thing that resolves an
 * unauthenticated public request to a workspace (`/api/v1/portal/*`). It is
 * intentionally NOT under workspace RLS — the public lookup runs without an
 * authenticated principal, so the resolver must read it as `simplecrm_admin`
 * and then explicitly set the workspace context before any further read.
 *
 * The table is keyed on workspace_id (one row per workspace, upserted) and
 * carries a unique-but-nullable token, so the workspace can disable the
 * portal by clearing the token. A separate `returns_portal_enabled` flag
 * lets an admin keep the token but pause public creates without losing the
 * URL — useful for rotation-without-break.
 */
export const returnsPortalSettingsMigration: SqlMigration = {
  id: '0022_returns_portal_settings',
  description: 'Returns portal settings: per-workspace public token + enable flag.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS workspace_portal_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  returns_portal_token text UNIQUE,
  returns_portal_enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
    // Partial index keeps lookups fast when only a small fraction of workspaces
    // have the portal enabled (the common case during early adoption).
    'CREATE INDEX IF NOT EXISTS workspace_portal_settings_enabled_token_idx ON workspace_portal_settings (returns_portal_token) WHERE returns_portal_enabled = true AND returns_portal_token IS NOT NULL;',
    // No RLS on this table — the public portal endpoint resolves token → workspace_id
    // before workspace context exists. After resolution, all subsequent reads/writes
    // run inside withWorkspaceTransaction with the resolved workspaceId, so the
    // workspace-scoped tables (returns, return_items, ...) still enforce isolation.
  ],
  downSql: [
    'DROP TABLE IF EXISTS workspace_portal_settings;',
  ],
};
