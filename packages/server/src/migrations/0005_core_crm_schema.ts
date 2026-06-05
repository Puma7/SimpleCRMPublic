import type { SqlMigration } from './types';

const workspacePolicyTables = [
  'sync_info',
  'customers',
  'products',
  'deals',
  'tasks',
  'deal_products',
] as const;

export const coreCrmSchemaMigration: SqlMigration = {
  id: '0005_core_crm_schema',
  description: 'Server edition core CRM schema: customers, products, deals, tasks, and deal products.',
  upSql: [
    `CREATE TABLE IF NOT EXISTS sync_info (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key text NOT NULL,
  value text,
  last_updated timestamptz NOT NULL DEFAULT now(),
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);`,
    `CREATE TABLE IF NOT EXISTS customers (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  jtl_kkunde bigint,
  customer_number text,
  name text,
  first_name text,
  company text,
  email text,
  phone text,
  mobile text,
  street text,
  zip_code text,
  city text,
  country text,
  jtl_date_created timestamptz,
  jtl_blocked boolean,
  status text NOT NULL DEFAULT 'Active',
  notes text,
  affiliate_link text,
  date_added timestamptz,
  last_modified_locally timestamptz,
  last_synced timestamptz,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS customers_workspace_email_idx ON customers (workspace_id, lower(email));',
    'CREATE INDEX IF NOT EXISTS customers_workspace_name_idx ON customers (workspace_id, lower(name));',
    `CREATE TABLE IF NOT EXISTS products (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  jtl_kartikel bigint,
  name text NOT NULL,
  sku text,
  description text,
  price numeric(14, 2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  date_created timestamptz,
  last_modified timestamptz,
  jtl_date_created timestamptz,
  last_synced timestamptz,
  last_modified_locally timestamptz,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE UNIQUE INDEX IF NOT EXISTS products_workspace_sku_unique_idx ON products (workspace_id, sku) WHERE sku IS NOT NULL;',
    'CREATE INDEX IF NOT EXISTS products_workspace_name_idx ON products (workspace_id, lower(name));',
    `CREATE TABLE IF NOT EXISTS deals (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  customer_source_sqlite_id bigint NOT NULL,
  customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  name text NOT NULL,
  value numeric(14, 2) NOT NULL DEFAULT 0,
  value_calculation_method text NOT NULL DEFAULT 'static' CHECK (value_calculation_method IN ('static', 'dynamic')),
  stage text NOT NULL,
  notes text,
  created_date timestamptz,
  expected_close_date timestamptz,
  last_modified timestamptz,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS deals_workspace_customer_idx ON deals (workspace_id, customer_id);',
    'CREATE INDEX IF NOT EXISTS deals_workspace_stage_idx ON deals (workspace_id, stage);',
    `CREATE TABLE IF NOT EXISTS tasks (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  customer_source_sqlite_id bigint NOT NULL,
  customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  title text NOT NULL,
  description text,
  due_date timestamptz,
  priority text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  calendar_event_source_sqlite_id bigint,
  snoozed_until timestamptz,
  created_date timestamptz,
  last_modified timestamptz,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS tasks_workspace_customer_idx ON tasks (workspace_id, customer_id);',
    'CREATE INDEX IF NOT EXISTS tasks_workspace_due_idx ON tasks (workspace_id, due_date) WHERE completed = false;',
    `CREATE TABLE IF NOT EXISTS deal_products (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source_sqlite_id bigint NOT NULL,
  deal_source_sqlite_id bigint NOT NULL,
  product_source_sqlite_id bigint NOT NULL,
  deal_id bigint REFERENCES deals(id) ON DELETE CASCADE,
  product_id bigint REFERENCES products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL DEFAULT 1,
  price_at_time_of_adding numeric(14, 2) NOT NULL DEFAULT 0,
  date_added timestamptz,
  source_row jsonb NOT NULL DEFAULT '{}'::jsonb,
  imported_in_run_id uuid REFERENCES sqlite_import_runs(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, source_sqlite_id),
  UNIQUE (workspace_id, deal_source_sqlite_id, product_source_sqlite_id)
);`,
    'CREATE INDEX IF NOT EXISTS deal_products_workspace_deal_idx ON deal_products (workspace_id, deal_id);',
    `ALTER TABLE sync_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_info FORCE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;
ALTER TABLE products FORCE ROW LEVEL SECURITY;
ALTER TABLE deals FORCE ROW LEVEL SECURITY;
ALTER TABLE tasks FORCE ROW LEVEL SECURITY;
ALTER TABLE deal_products FORCE ROW LEVEL SECURITY;`,
    ...workspacePolicyTables.map((tableName) => `CREATE POLICY ${tableName}_workspace_isolation ON ${tableName}
  USING (app.can_access_workspace(workspace_id))
  WITH CHECK (app.can_access_workspace(workspace_id));`),
  ],
  downSql: [
    ...[...workspacePolicyTables].reverse().map((tableName) => (
      `DROP POLICY IF EXISTS ${tableName}_workspace_isolation ON ${tableName};`
    )),
    'DROP TABLE IF EXISTS deal_products;',
    'DROP TABLE IF EXISTS tasks;',
    'DROP TABLE IF EXISTS deals;',
    'DROP TABLE IF EXISTS products;',
    'DROP TABLE IF EXISTS customers;',
    'DROP TABLE IF EXISTS sync_info;',
  ],
};
