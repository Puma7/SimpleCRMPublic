import type { SqlMigration } from './types';

const workspacePolicyTables = ['return_reasons', 'returns', 'return_items'] as const;

/**
 * Phase 0 of the returns/RMA suite.
 *
 * Design notes:
 * - `return_reasons` is a workspace-scoped vocabulary table. We seed a small
 *   default set per workspace lazily from application code (not the migration),
 *   because the workspaces table is empty at install time. Reasons can be
 *   added/disabled per workspace without touching the schema.
 * - `returns` carries free-form `jtl_order_number` for now. The JTL read-side
 *   lookup (resolving order number → order context) is Phase 1; writing
 *   back to JTL is a later, explicitly decoupled phase. Until then, all
 *   returns data lives only in our own database.
 * - `outcome` is a free column with a CHECK list — the workflow nodes that
 *   choose between refund/exchange/credit/keep land in a later phase.
 * - Foreign keys to `customers` and `email_messages` are nullable + `ON DELETE
 *   SET NULL`, so a return survives deleting its originating record (audit).
 */
export const returnsSchemaMigration: SqlMigration = {
  id: '0021_returns_schema',
  description: 'Returns/RMA management: return_reasons, returns, return_items (workspace-scoped, RLS).',
  upSql: [
    `CREATE TABLE IF NOT EXISTS return_reasons (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  label text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, code)
);`,
    'CREATE INDEX IF NOT EXISTS return_reasons_workspace_active_idx ON return_reasons (workspace_id, is_active, sort_order);',
    `CREATE TABLE IF NOT EXISTS returns (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  return_number text NOT NULL,
  customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  email_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL,
  jtl_order_number text,
  jtl_kauftrag bigint,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','received','refunded','exchanged','credited','rejected','cancelled')),
  outcome text
    CHECK (outcome IS NULL OR outcome IN ('refund','exchange','credit','keep')),
  customer_email text,
  customer_name text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, return_number)
);`,
    'CREATE INDEX IF NOT EXISTS returns_workspace_status_idx ON returns (workspace_id, status, created_at DESC);',
    'CREATE INDEX IF NOT EXISTS returns_workspace_customer_idx ON returns (workspace_id, customer_id) WHERE customer_id IS NOT NULL;',
    'CREATE INDEX IF NOT EXISTS returns_workspace_order_idx ON returns (workspace_id, jtl_order_number) WHERE jtl_order_number IS NOT NULL;',
    `CREATE TABLE IF NOT EXISTS return_items (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  return_id bigint NOT NULL REFERENCES returns(id) ON DELETE CASCADE,
  product_id bigint REFERENCES products(id) ON DELETE SET NULL,
  reason_id bigint REFERENCES return_reasons(id) ON DELETE SET NULL,
  sku text,
  product_name text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  condition text
    CHECK (condition IS NULL OR condition IN ('new','opened','used','damaged')),
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
    'CREATE INDEX IF NOT EXISTS return_items_return_idx ON return_items (return_id);',
    'CREATE INDEX IF NOT EXISTS return_items_workspace_product_idx ON return_items (workspace_id, product_id) WHERE product_id IS NOT NULL;',
    `ALTER TABLE return_reasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE returns ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE return_reasons FORCE ROW LEVEL SECURITY;
ALTER TABLE returns FORCE ROW LEVEL SECURITY;
ALTER TABLE return_items FORCE ROW LEVEL SECURITY;`,
    ...workspacePolicyTables.map((tableName) => `CREATE POLICY ${tableName}_workspace_isolation ON ${tableName}
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`),
  ],
  downSql: [
    ...[...workspacePolicyTables].reverse().map((tableName) => (
      `DROP POLICY IF EXISTS ${tableName}_workspace_isolation ON ${tableName};`
    )),
    'DROP TABLE IF EXISTS return_items;',
    'DROP TABLE IF EXISTS returns;',
    'DROP TABLE IF EXISTS return_reasons;',
  ],
};
