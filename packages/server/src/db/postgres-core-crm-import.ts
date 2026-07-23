export type CoreCrmImportPgClient = Readonly<{
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
}>;

export type CoreCrmImportInput = Readonly<{
  workspaceId: string;
  runId: string;
}>;

export type CoreCrmImportCommand = Readonly<{
  tableName: string;
  prepareSql?: string;
  sql: string;
  params: readonly unknown[];
}>;

const tableOrder = [
  'sync_info',
  'customers',
  'products',
  'deals',
  'tasks',
  'deal_products',
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

export async function runPostgresCoreCrmImport(
  client: CoreCrmImportPgClient,
  input: CoreCrmImportInput,
): Promise<void> {
  for (const command of buildCoreCrmImportCommands(input)) {
    if (command.prepareSql) {
      await client.query(command.prepareSql, command.params);
    }
    await client.query(command.sql, command.params);
  }
}

export function buildCoreCrmImportCommands(input: CoreCrmImportInput): readonly CoreCrmImportCommand[] {
  if (!input.workspaceId.trim()) {
    throw new Error('workspaceId is required for core CRM import');
  }
  if (!input.runId.trim()) {
    throw new Error('runId is required for core CRM import');
  }

  return tableOrder.map((tableName) => ({
    tableName,
    ...(tableName === 'calendar_events' ? { prepareSql: calendarEventTaskLinkResetSql } : {}),
    sql: commandSqlByTable[tableName],
    params: [input.workspaceId, tableName, input.runId],
  }));
}

const sqliteImportRowsFrom = 'FROM sqlite_import_rows r';

const sqliteImportRowsWhere = `WHERE r.workspace_id = $1
  AND r.table_name = $2
  AND r.imported_in_run_id = $3
  AND r.source_row ? 'id'`;

const sqliteImportRowsFilter = `${sqliteImportRowsFrom}
WHERE r.workspace_id = $1
  AND r.table_name = $2
  AND r.imported_in_run_id = $3
  AND r.source_row ? 'id'`;

const calendarEventTaskLinkResetSql = `WITH ranked_import_rows AS (
  SELECT
    r.source_row,
    ROW_NUMBER() OVER (
      PARTITION BY NULLIF(r.source_row->>'task_id', '')::bigint
      ORDER BY NULLIF(r.source_row->>'updated_at', '')::timestamptz DESC NULLS LAST,
               (r.source_row->>'id')::bigint DESC
    ) AS task_link_rank
  FROM sqlite_import_rows r
  WHERE r.workspace_id = $1
    AND r.table_name = $2
    AND r.imported_in_run_id = $3
    AND r.source_row ? 'id'
), resolved_winners AS (
  SELECT
    (r.source_row->>'id')::bigint AS event_source_sqlite_id,
    t.id AS task_id
  FROM ranked_import_rows r
  JOIN tasks t
    ON t.workspace_id = $1
   AND t.source_sqlite_id = NULLIF(r.source_row->>'task_id', '')::bigint
  WHERE NULLIF(r.source_row->>'task_id', '') IS NOT NULL
    AND r.task_link_rank = 1
)
UPDATE calendar_events AS existing
SET
  task_source_sqlite_id = NULL,
  task_id = NULL,
  event_type = CASE WHEN existing.event_type = 'task' THEN NULL ELSE existing.event_type END,
  recurrence_rule = CASE WHEN existing.event_type = 'task' THEN NULL ELSE existing.recurrence_rule END,
  updated_at = now()
FROM resolved_winners winner
WHERE existing.workspace_id = $1
  AND existing.task_id = winner.task_id
  AND existing.source_sqlite_id IS DISTINCT FROM winner.event_source_sqlite_id`;

const commandSqlByTable: Record<typeof tableOrder[number], string> = {
  sync_info: `INSERT INTO sync_info (
  workspace_id,
  key,
  value,
  last_updated,
  source_row,
  imported_in_run_id,
  updated_at
)
SELECT
  $1,
  r.source_pk,
  r.source_row->>'value',
  COALESCE(NULLIF(r.source_row->>'lastUpdated', '')::timestamptz, now()),
  r.source_row,
  $3,
  now()
FROM sqlite_import_rows r
WHERE r.workspace_id = $1
  AND r.table_name = $2
  AND r.imported_in_run_id = $3
ON CONFLICT (workspace_id, key)
DO UPDATE SET
  value = EXCLUDED.value,
  last_updated = EXCLUDED.last_updated,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`,
  customers: `INSERT INTO customers (
  workspace_id,
  source_sqlite_id,
  jtl_kkunde,
  customer_number,
  name,
  first_name,
  company,
  email,
  phone,
  mobile,
  street,
  zip_code,
  city,
  country,
  jtl_date_created,
  jtl_blocked,
  status,
  notes,
  affiliate_link,
  date_added,
  last_modified_locally,
  last_synced,
  source_row,
  imported_in_run_id,
  updated_at
)
SELECT
  $1,
  (r.source_row->>'id')::bigint,
  NULLIF(r.source_row->>'jtl_kKunde', '')::bigint,
  NULLIF(r.source_row->>'customerNumber', ''),
  NULLIF(r.source_row->>'name', ''),
  NULLIF(r.source_row->>'firstName', ''),
  NULLIF(r.source_row->>'company', ''),
  NULLIF(r.source_row->>'email', ''),
  NULLIF(r.source_row->>'phone', ''),
  NULLIF(r.source_row->>'mobile', ''),
  NULLIF(r.source_row->>'street', ''),
  NULLIF(r.source_row->>'zipCode', ''),
  NULLIF(r.source_row->>'city', ''),
  NULLIF(r.source_row->>'country', ''),
  NULLIF(r.source_row->>'jtl_dateCreated', '')::timestamptz,
  ${sqliteBoolean('jtl_blocked')},
  COALESCE(NULLIF(r.source_row->>'status', ''), 'Active'),
  NULLIF(r.source_row->>'notes', ''),
  NULLIF(r.source_row->>'affiliateLink', ''),
  NULLIF(r.source_row->>'dateAdded', '')::timestamptz,
  NULLIF(r.source_row->>'lastModifiedLocally', '')::timestamptz,
  NULLIF(r.source_row->>'lastSynced', '')::timestamptz,
  r.source_row,
  $3,
  now()
${sqliteImportRowsFilter}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  jtl_kkunde = EXCLUDED.jtl_kkunde,
  customer_number = EXCLUDED.customer_number,
  name = EXCLUDED.name,
  first_name = EXCLUDED.first_name,
  company = EXCLUDED.company,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  mobile = EXCLUDED.mobile,
  street = EXCLUDED.street,
  zip_code = EXCLUDED.zip_code,
  city = EXCLUDED.city,
  country = EXCLUDED.country,
  jtl_date_created = EXCLUDED.jtl_date_created,
  jtl_blocked = EXCLUDED.jtl_blocked,
  status = EXCLUDED.status,
  notes = EXCLUDED.notes,
  affiliate_link = EXCLUDED.affiliate_link,
  date_added = EXCLUDED.date_added,
  last_modified_locally = EXCLUDED.last_modified_locally,
  last_synced = EXCLUDED.last_synced,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`,
  products: `INSERT INTO products (
  workspace_id,
  source_sqlite_id,
  jtl_kartikel,
  name,
  sku,
  description,
  price,
  is_active,
  date_created,
  last_modified,
  jtl_date_created,
  last_synced,
  last_modified_locally,
  source_row,
  imported_in_run_id,
  updated_at
)
SELECT
  $1,
  (r.source_row->>'id')::bigint,
  NULLIF(r.source_row->>'jtl_kArtikel', '')::bigint,
  COALESCE(NULLIF(r.source_row->>'name', ''), 'Unnamed product'),
  NULLIF(r.source_row->>'sku', ''),
  NULLIF(r.source_row->>'description', ''),
  COALESCE(NULLIF(r.source_row->>'price', '')::numeric, 0),
  COALESCE(${sqliteBoolean('isActive')}, true),
  NULLIF(r.source_row->>'dateCreated', '')::timestamptz,
  NULLIF(r.source_row->>'lastModified', '')::timestamptz,
  NULLIF(r.source_row->>'jtl_dateCreated', '')::timestamptz,
  NULLIF(r.source_row->>'lastSynced', '')::timestamptz,
  NULLIF(r.source_row->>'lastModifiedLocally', '')::timestamptz,
  r.source_row,
  $3,
  now()
${sqliteImportRowsFilter}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  jtl_kartikel = EXCLUDED.jtl_kartikel,
  name = EXCLUDED.name,
  sku = EXCLUDED.sku,
  description = EXCLUDED.description,
  price = EXCLUDED.price,
  is_active = EXCLUDED.is_active,
  date_created = EXCLUDED.date_created,
  last_modified = EXCLUDED.last_modified,
  jtl_date_created = EXCLUDED.jtl_date_created,
  last_synced = EXCLUDED.last_synced,
  last_modified_locally = EXCLUDED.last_modified_locally,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`,
  deals: `INSERT INTO deals (
  workspace_id,
  source_sqlite_id,
  customer_source_sqlite_id,
  customer_id,
  name,
  value,
  value_calculation_method,
  stage,
  notes,
  created_date,
  expected_close_date,
  last_modified,
  source_row,
  imported_in_run_id,
  updated_at
)
SELECT
  $1,
  (r.source_row->>'id')::bigint,
  (r.source_row->>'customer_id')::bigint,
  c.id,
  COALESCE(NULLIF(r.source_row->>'name', ''), 'Unnamed deal'),
  COALESCE(NULLIF(r.source_row->>'value', '')::numeric, 0),
  COALESCE(NULLIF(r.source_row->>'value_calculation_method', ''), 'static'),
  COALESCE(NULLIF(r.source_row->>'stage', ''), 'New'),
  NULLIF(r.source_row->>'notes', ''),
  NULLIF(r.source_row->>'created_date', '')::timestamptz,
  NULLIF(r.source_row->>'expected_close_date', '')::timestamptz,
  NULLIF(r.source_row->>'last_modified', '')::timestamptz,
  r.source_row,
  $3,
  now()
${sqliteImportRowsFrom}
LEFT JOIN customers c
  ON c.workspace_id = $1
 AND c.source_sqlite_id = (r.source_row->>'customer_id')::bigint
${sqliteImportRowsWhere}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  customer_source_sqlite_id = EXCLUDED.customer_source_sqlite_id,
  customer_id = EXCLUDED.customer_id,
  name = EXCLUDED.name,
  value = EXCLUDED.value,
  value_calculation_method = EXCLUDED.value_calculation_method,
  stage = EXCLUDED.stage,
  notes = EXCLUDED.notes,
  created_date = EXCLUDED.created_date,
  expected_close_date = EXCLUDED.expected_close_date,
  last_modified = EXCLUDED.last_modified,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`,
  tasks: `INSERT INTO tasks (
  workspace_id,
  source_sqlite_id,
  customer_source_sqlite_id,
  customer_id,
  title,
  description,
  due_date,
  priority,
  completed,
  calendar_event_source_sqlite_id,
  snoozed_until,
  created_date,
  last_modified,
  source_row,
  imported_in_run_id,
  updated_at
)
SELECT
  $1,
  (r.source_row->>'id')::bigint,
  (r.source_row->>'customer_id')::bigint,
  c.id,
  COALESCE(NULLIF(r.source_row->>'title', ''), 'Untitled task'),
  NULLIF(r.source_row->>'description', ''),
  NULLIF(r.source_row->>'due_date', '')::timestamptz,
  COALESCE(NULLIF(r.source_row->>'priority', ''), 'Medium'),
  COALESCE(${sqliteBoolean('completed')}, false),
  NULLIF(r.source_row->>'calendar_event_id', '')::bigint,
  NULLIF(r.source_row->>'snoozed_until', '')::timestamptz,
  NULLIF(r.source_row->>'created_date', '')::timestamptz,
  NULLIF(r.source_row->>'last_modified', '')::timestamptz,
  r.source_row,
  $3,
  now()
${sqliteImportRowsFrom}
LEFT JOIN customers c
  ON c.workspace_id = $1
 AND c.source_sqlite_id = (r.source_row->>'customer_id')::bigint
${sqliteImportRowsWhere}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  customer_source_sqlite_id = EXCLUDED.customer_source_sqlite_id,
  customer_id = EXCLUDED.customer_id,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  due_date = EXCLUDED.due_date,
  priority = EXCLUDED.priority,
  completed = EXCLUDED.completed,
  calendar_event_source_sqlite_id = EXCLUDED.calendar_event_source_sqlite_id,
  snoozed_until = EXCLUDED.snoozed_until,
  created_date = EXCLUDED.created_date,
  last_modified = EXCLUDED.last_modified,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`,
  deal_products: `INSERT INTO deal_products (
  workspace_id,
  source_sqlite_id,
  deal_source_sqlite_id,
  product_source_sqlite_id,
  deal_id,
  product_id,
  quantity,
  price_at_time_of_adding,
  date_added,
  source_row,
  imported_in_run_id,
  updated_at
)
SELECT
  $1,
  (r.source_row->>'id')::bigint,
  (r.source_row->>'deal_id')::bigint,
  (r.source_row->>'product_id')::bigint,
  d.id,
  p.id,
  COALESCE(NULLIF(r.source_row->>'quantity', '')::integer, 1),
  COALESCE(NULLIF(r.source_row->>'price_at_time_of_adding', '')::numeric, 0),
  NULLIF(r.source_row->>'dateAdded', '')::timestamptz,
  r.source_row,
  $3,
  now()
${sqliteImportRowsFrom}
LEFT JOIN deals d
  ON d.workspace_id = $1
 AND d.source_sqlite_id = (r.source_row->>'deal_id')::bigint
LEFT JOIN products p
  ON p.workspace_id = $1
 AND p.source_sqlite_id = (r.source_row->>'product_id')::bigint
${sqliteImportRowsWhere}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  deal_source_sqlite_id = EXCLUDED.deal_source_sqlite_id,
  product_source_sqlite_id = EXCLUDED.product_source_sqlite_id,
  deal_id = EXCLUDED.deal_id,
  product_id = EXCLUDED.product_id,
  quantity = EXCLUDED.quantity,
  price_at_time_of_adding = EXCLUDED.price_at_time_of_adding,
  date_added = EXCLUDED.date_added,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`,
  calendar_events: `WITH ranked_import_rows AS (
  SELECT r.*,
         row_number() OVER (
           PARTITION BY NULLIF(r.source_row->>'task_id', '')
           ORDER BY NULLIF(r.source_row->>'updated_at', '')::timestamptz DESC NULLS LAST,
                    (r.source_row->>'id')::bigint DESC
         ) AS task_link_rank
    FROM sqlite_import_rows r
   WHERE r.workspace_id = $1
     AND r.table_name = $2
     AND r.imported_in_run_id = $3
     AND r.source_row ? 'id'
)
INSERT INTO calendar_events (
  workspace_id,
  source_sqlite_id,
  title,
  description,
  start_date,
  end_date,
  all_day,
  color_code,
  event_type,
  recurrence_rule,
  task_source_sqlite_id,
  task_id,
  source_row,
  imported_in_run_id,
  created_at,
  updated_at
)
SELECT
  $1,
  (r.source_row->>'id')::bigint,
  COALESCE(NULLIF(r.source_row->>'title', ''), 'Untitled event'),
  NULLIF(r.source_row->>'description', ''),
  COALESCE(NULLIF(r.source_row->>'start_date', '')::timestamptz, now()),
  COALESCE(NULLIF(r.source_row->>'end_date', '')::timestamptz, now()),
  COALESCE(${sqliteBoolean('all_day')}, false),
  NULLIF(r.source_row->>'color_code', ''),
  CASE WHEN NULLIF(r.source_row->>'task_id', '') IS NOT NULL AND r.task_link_rank > 1
    THEN NULL ELSE NULLIF(r.source_row->>'event_type', '') END,
  CASE WHEN NULLIF(r.source_row->>'task_id', '') IS NOT NULL AND r.task_link_rank > 1
    THEN NULL ELSE NULLIF(r.source_row->>'recurrence_rule', '') END,
  CASE WHEN NULLIF(r.source_row->>'task_id', '') IS NOT NULL AND r.task_link_rank > 1
    THEN NULL ELSE NULLIF(r.source_row->>'task_id', '')::bigint END,
  CASE WHEN NULLIF(r.source_row->>'task_id', '') IS NOT NULL AND r.task_link_rank > 1
    THEN NULL ELSE t.id END,
  r.source_row,
  $3,
  NULLIF(r.source_row->>'created_at', '')::timestamptz,
  now()
FROM ranked_import_rows r
LEFT JOIN tasks t
  ON t.workspace_id = $1
 AND t.source_sqlite_id = NULLIF(r.source_row->>'task_id', '')::bigint
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  start_date = EXCLUDED.start_date,
  end_date = EXCLUDED.end_date,
  all_day = EXCLUDED.all_day,
  color_code = EXCLUDED.color_code,
  event_type = EXCLUDED.event_type,
  recurrence_rule = EXCLUDED.recurrence_rule,
  task_source_sqlite_id = EXCLUDED.task_source_sqlite_id,
  task_id = EXCLUDED.task_id,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  customer_custom_fields: `INSERT INTO customer_custom_fields (
  workspace_id,
  source_sqlite_id,
  name,
  label,
  type,
  required,
  options,
  default_value,
  placeholder,
  description,
  display_order,
  active,
  source_row,
  imported_in_run_id,
  created_at,
  updated_at
)
SELECT
  $1,
  (r.source_row->>'id')::bigint,
  COALESCE(NULLIF(r.source_row->>'name', ''), 'field_' || (r.source_row->>'id')),
  COALESCE(NULLIF(r.source_row->>'label', ''), NULLIF(r.source_row->>'name', ''), 'Field ' || (r.source_row->>'id')),
  COALESCE(NULLIF(r.source_row->>'type', ''), 'text'),
  COALESCE(${sqliteBoolean('required')}, false),
  CASE WHEN NULLIF(r.source_row->>'options', '') IS NULL THEN NULL ELSE (r.source_row->>'options')::jsonb END,
  NULLIF(r.source_row->>'default_value', ''),
  NULLIF(r.source_row->>'placeholder', ''),
  NULLIF(r.source_row->>'description', ''),
  COALESCE(NULLIF(r.source_row->>'display_order', '')::integer, 0),
  COALESCE(${sqliteBoolean('active')}, true),
  r.source_row,
  $3,
  NULLIF(r.source_row->>'created_at', '')::timestamptz,
  now()
${sqliteImportRowsFilter}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  name = EXCLUDED.name,
  label = EXCLUDED.label,
  type = EXCLUDED.type,
  required = EXCLUDED.required,
  options = EXCLUDED.options,
  default_value = EXCLUDED.default_value,
  placeholder = EXCLUDED.placeholder,
  description = EXCLUDED.description,
  display_order = EXCLUDED.display_order,
  active = EXCLUDED.active,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  customer_custom_field_values: `INSERT INTO customer_custom_field_values (
  workspace_id,
  source_sqlite_id,
  customer_source_sqlite_id,
  field_source_sqlite_id,
  customer_id,
  field_id,
  value,
  source_row,
  imported_in_run_id,
  created_at,
  updated_at
)
SELECT
  $1,
  (r.source_row->>'id')::bigint,
  (r.source_row->>'customer_id')::bigint,
  (r.source_row->>'field_id')::bigint,
  c.id,
  f.id,
  r.source_row->>'value',
  r.source_row,
  $3,
  NULLIF(r.source_row->>'created_at', '')::timestamptz,
  now()
${sqliteImportRowsFrom}
LEFT JOIN customers c
  ON c.workspace_id = $1
 AND c.source_sqlite_id = (r.source_row->>'customer_id')::bigint
LEFT JOIN customer_custom_fields f
  ON f.workspace_id = $1
 AND f.source_sqlite_id = (r.source_row->>'field_id')::bigint
${sqliteImportRowsWhere}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  customer_source_sqlite_id = EXCLUDED.customer_source_sqlite_id,
  field_source_sqlite_id = EXCLUDED.field_source_sqlite_id,
  customer_id = EXCLUDED.customer_id,
  field_id = EXCLUDED.field_id,
  value = EXCLUDED.value,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  activity_log: `INSERT INTO activity_log (
  workspace_id,
  source_sqlite_id,
  customer_source_sqlite_id,
  deal_source_sqlite_id,
  task_source_sqlite_id,
  customer_id,
  deal_id,
  task_id,
  activity_type,
  title,
  description,
  metadata,
  source_row,
  imported_in_run_id,
  created_at,
  updated_at
)
SELECT
  $1,
  (r.source_row->>'id')::bigint,
  NULLIF(r.source_row->>'customer_id', '')::bigint,
  NULLIF(r.source_row->>'deal_id', '')::bigint,
  NULLIF(r.source_row->>'task_id', '')::bigint,
  c.id,
  d.id,
  t.id,
  COALESCE(NULLIF(r.source_row->>'activity_type', ''), 'note'),
  NULLIF(r.source_row->>'title', ''),
  NULLIF(r.source_row->>'description', ''),
  CASE WHEN NULLIF(r.source_row->>'metadata', '') IS NULL THEN NULL ELSE (r.source_row->>'metadata')::jsonb END,
  r.source_row,
  $3,
  NULLIF(r.source_row->>'created_at', '')::timestamptz,
  now()
${sqliteImportRowsFrom}
LEFT JOIN customers c
  ON c.workspace_id = $1
 AND c.source_sqlite_id = NULLIF(r.source_row->>'customer_id', '')::bigint
LEFT JOIN deals d
  ON d.workspace_id = $1
 AND d.source_sqlite_id = NULLIF(r.source_row->>'deal_id', '')::bigint
LEFT JOIN tasks t
  ON t.workspace_id = $1
 AND t.source_sqlite_id = NULLIF(r.source_row->>'task_id', '')::bigint
${sqliteImportRowsWhere}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  customer_source_sqlite_id = EXCLUDED.customer_source_sqlite_id,
  deal_source_sqlite_id = EXCLUDED.deal_source_sqlite_id,
  task_source_sqlite_id = EXCLUDED.task_source_sqlite_id,
  customer_id = EXCLUDED.customer_id,
  deal_id = EXCLUDED.deal_id,
  task_id = EXCLUDED.task_id,
  activity_type = EXCLUDED.activity_type,
  title = EXCLUDED.title,
  description = EXCLUDED.description,
  metadata = EXCLUDED.metadata,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  saved_views: `INSERT INTO saved_views (
  workspace_id,
  source_sqlite_id,
  name,
  filters,
  display_order,
  source_row,
  imported_in_run_id,
  created_at,
  updated_at
)
SELECT
  $1,
  (r.source_row->>'id')::bigint,
  COALESCE(NULLIF(r.source_row->>'name', ''), 'Saved view ' || (r.source_row->>'id')),
  COALESCE(NULLIF(r.source_row->>'filters', '')::jsonb, '{}'::jsonb),
  COALESCE(NULLIF(r.source_row->>'display_order', '')::integer, 0),
  r.source_row,
  $3,
  NULLIF(r.source_row->>'created_at', '')::timestamptz,
  now()
${sqliteImportRowsFilter}
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  name = EXCLUDED.name,
  filters = EXCLUDED.filters,
  display_order = EXCLUDED.display_order,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  created_at = EXCLUDED.created_at,
  updated_at = now()`,
  jtl_firmen: jtlReferenceImportSql('jtl_firmen'),
  jtl_warenlager: jtlReferenceImportSql('jtl_warenlager'),
  jtl_zahlungsarten: jtlReferenceImportSql('jtl_zahlungsarten'),
  jtl_versandarten: jtlReferenceImportSql('jtl_versandarten'),
};

function sqliteBoolean(fieldName: string): string {
  return `CASE lower(NULLIF(r.source_row->>'${fieldName}', ''))
    WHEN '1' THEN true
    WHEN 'true' THEN true
    WHEN 'yes' THEN true
    WHEN '0' THEN false
    WHEN 'false' THEN false
    WHEN 'no' THEN false
    ELSE NULL
  END`;
}

function jtlReferenceImportSql(tableName: string): string {
  return `INSERT INTO ${tableName} (
  workspace_id,
  source_sqlite_id,
  name,
  source_row,
  imported_in_run_id,
  updated_at
)
SELECT
  $1,
  r.source_pk::bigint,
  NULLIF(r.source_row->>'cName', ''),
  r.source_row,
  $3,
  now()
FROM sqlite_import_rows r
WHERE r.workspace_id = $1
  AND r.table_name = $2
  AND r.imported_in_run_id = $3
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET
  name = EXCLUDED.name,
  source_row = EXCLUDED.source_row,
  imported_in_run_id = EXCLUDED.imported_in_run_id,
  updated_at = now()`;
}
