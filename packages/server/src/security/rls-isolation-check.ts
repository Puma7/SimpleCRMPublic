export type RlsCheckClient = Readonly<{
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ rows: readonly T[] }>;
}>;

export type RlsCheckStatus = 'passed' | 'failed';

export type RlsCheckResult = Readonly<{
  status: RlsCheckStatus;
  checks: readonly RlsCheckItem[];
  error?: string;
}>;

export type RlsCheckItem = Readonly<{
  name: string;
  status: RlsCheckStatus;
  detail?: string;
}>;

export type RlsPolicyCoverageTable = Readonly<{
  tableName: string;
  policyName: string;
  usingFragments: readonly string[];
  withCheckFragments: readonly string[];
}>;

const WORKSPACE_A_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B_ID = '22222222-2222-4222-8222-222222222222';
const USER_A_ID = '33333333-3333-4333-8333-333333333333';
const USER_B_ID = '44444444-4444-4444-8444-444444444444';
const TRACKING_MESSAGE_A_ID = '55555555-5555-4555-8555-555555555555';
const TRACKING_MESSAGE_B_ID = '66666666-6666-4666-8666-666666666666';
const TRACKING_LINK_A_ID = '77777777-7777-4777-8777-777777777777';
const TRACKING_LINK_B_ID = '88888888-8888-4888-8888-888888888888';
const TRACKING_TOKEN_HASH_A = 'a'.repeat(64);
const TRACKING_TOKEN_HASH_B = 'b'.repeat(64);
const TRACKING_TOKEN_HASH_WRONG = 'c'.repeat(64);

const TRACKING_RLS_TABLES = [
  'email_tracking_policies',
  'email_tracking_messages',
  'email_tracking_links',
  'email_tracking_events',
  'email_tracking_token_resolver',
] as const;

const WORKSPACE_COLUMN_POLICY_FRAGMENTS = ['app.can_access_workspace', 'workspace_id'] as const;

export const RLS_POLICY_COVERAGE_TABLES: readonly RlsPolicyCoverageTable[] = [
  rlsPolicyTable('workspaces', ['app.can_access_workspace', 'id']),
  rlsPolicyTable('users'),
  rlsPolicyTable('auth_invitations'),
  rlsPolicyTable('user_account_access'),
  rlsPolicyTable('refresh_tokens'),
  rlsPolicyTable('job_queue'),
  rlsPolicyTable('conversation_locks'),
  rlsPolicyTable('secrets'),
  rlsPolicyTable('auth_login_failures', ['workspace_id is null', 'app.can_access_workspace', 'workspace_id']),
  rlsPolicyTable('audit_events'),
  rlsPolicyTable('server_events'),
  rlsPolicyTable('sqlite_import_runs'),
  rlsPolicyTable('sqlite_import_table_checkpoints', ['sqlite_import_runs', 'app.can_access_workspace', 'workspace_id']),
  rlsPolicyTable('sqlite_import_rows'),
  rlsPolicyTable('sync_info'),
  rlsPolicyTable('customers'),
  rlsPolicyTable('products'),
  rlsPolicyTable('deals'),
  rlsPolicyTable('tasks'),
  rlsPolicyTable('user_groups'),
  rlsPolicyTable('user_group_members'),
  rlsPolicyTable('deal_products'),
  rlsPolicyTable('calendar_events'),
  rlsPolicyTable('customer_custom_fields'),
  rlsPolicyTable('customer_custom_field_values'),
  rlsPolicyTable('activity_log'),
  rlsPolicyTable('saved_views'),
  rlsPolicyTable('jtl_firmen'),
  rlsPolicyTable('jtl_warenlager'),
  rlsPolicyTable('jtl_zahlungsarten'),
  rlsPolicyTable('jtl_versandarten'),
  rlsPolicyTable('email_accounts'),
  rlsPolicyTable('email_folders'),
  rlsPolicyTable('email_team_members'),
  rlsPolicyTable('email_threads'),
  rlsPolicyTable('email_messages'),
  rlsPolicyTable('email_message_attachments'),
  rlsPolicyTable('email_message_tags'),
  rlsPolicyTable('email_categories'),
  rlsPolicyTable('email_message_categories'),
  rlsPolicyTable('email_internal_notes'),
  rlsPolicyTable('email_canned_responses'),
  rlsPolicyTable('email_account_signatures'),
  rlsPolicyTable('email_account_mail_settings'),
  rlsPolicyTable('email_remote_content_allowlist'),
  rlsPolicyTable('email_read_receipt_log'),
  rlsPolicyTable('email_thread_edges'),
  rlsPolicyTable('email_thread_aliases'),
  rlsPolicyTable('email_ai_profiles'),
  rlsPolicyTable('email_ai_prompts'),
  rlsPolicyTable('email_workflows'),
  rlsPolicyTable('email_workflow_versions'),
  rlsPolicyTable('email_workflow_runs'),
  rlsPolicyTable('email_workflow_run_steps'),
  rlsPolicyTable('email_message_workflow_applied'),
  rlsPolicyTable('email_workflow_forward_dedup'),
  rlsPolicyTable('email_auto_reply_reservations'),
  rlsPolicyTable('email_auto_reply_daily_counters'),
  rlsPolicyTable('workflow_knowledge_bases'),
  rlsPolicyTable('workflow_knowledge_chunks'),
  rlsPolicyTable('workflow_delayed_jobs'),
  rlsPolicyTable('email_spam_list_entries'),
  rlsPolicyTable('email_spam_learning_events'),
  rlsPolicyTable('email_spam_feature_stats'),
  rlsPolicyTable('email_spam_decisions'),
  rlsPolicyTable('email_tracking_policies'),
  rlsPolicyTable('email_tracking_messages'),
  rlsPolicyTable('email_tracking_links'),
  rlsPolicyTable('email_tracking_events'),
  rlsPolicyTable('email_tracking_token_resolver'),
  rlsPolicyTable('smtp_relays'),
  rlsPolicyTable('smtp_relay_credentials'),
  rlsPolicyTable('smtp_relay_allowed_accounts'),
  rlsPolicyTable('smtp_relay_submissions'),
  rlsPolicyTable('pgp_identities'),
  rlsPolicyTable('pgp_peer_keys'),
  rlsPolicyTable('automation_api_keys'),
  rlsPolicyTable('ai_usage_events'),
  rlsPolicyTable('ai_reply_feedback'),
  rlsPolicyTable('return_reasons'),
  rlsPolicyTable('returns'),
  rlsPolicyTable('return_items'),
];

export async function runRlsIsolationCheck(client: RlsCheckClient): Promise<RlsCheckResult> {
  const checks: RlsCheckItem[] = [];
  await client.query('BEGIN');
  try {
    await expectRlsPolicyCoverage(client, checks);
    await expectPublicResolverPolicyCoverage(client, checks);

    await seedWorkspaceFixture(client, {
      workspaceId: WORKSPACE_A_ID,
      userId: USER_A_ID,
      label: 'a',
      customerSourceId: 101,
      trackingMessageId: TRACKING_MESSAGE_A_ID,
      trackingLinkId: TRACKING_LINK_A_ID,
      trackingTokenHash: TRACKING_TOKEN_HASH_A,
    });
    await seedWorkspaceFixture(client, {
      workspaceId: WORKSPACE_B_ID,
      userId: USER_B_ID,
      label: 'b',
      customerSourceId: 201,
      trackingMessageId: TRACKING_MESSAGE_B_ID,
      trackingLinkId: TRACKING_LINK_B_ID,
      trackingTokenHash: TRACKING_TOKEN_HASH_B,
    });

    await setRlsContext(client, WORKSPACE_A_ID, USER_A_ID, 'user');
    await expectCount(client, checks, {
      name: 'workspace_a_reads_own_customer',
      sql: 'SELECT count(*)::int AS count FROM customers WHERE workspace_id = $1 AND source_sqlite_id = $2;',
      params: [WORKSPACE_A_ID, 101],
      expected: 1,
    });
    await expectCount(client, checks, {
      name: 'workspace_a_cannot_read_workspace_b_customer',
      sql: 'SELECT count(*)::int AS count FROM customers WHERE workspace_id = $1 AND source_sqlite_id = $2;',
      params: [WORKSPACE_B_ID, 201],
      expected: 0,
    });
    await expectCount(client, checks, {
      name: 'workspace_a_cannot_read_workspace_b_secret',
      sql: "SELECT count(*)::int AS count FROM secrets WHERE workspace_id = $1 AND kind = 'rls_probe';",
      params: [WORKSPACE_B_ID],
      expected: 0,
    });
    for (const table of TRACKING_RLS_TABLES) {
      await expectCount(client, checks, {
        name: `workspace_a_reads_own_${table}`,
        sql: `SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = $1;`,
        params: [WORKSPACE_A_ID],
        expected: 1,
      });
      await expectCount(client, checks, {
        name: `workspace_a_cannot_read_workspace_b_${table}`,
        sql: `SELECT count(*)::int AS count FROM ${table} WHERE workspace_id = $1;`,
        params: [WORKSPACE_B_ID],
        expected: 0,
      });
    }
    await expectPolicyError(client, checks, 'workspace_a_cannot_insert_workspace_b_customer', () => client.query(
      `INSERT INTO customers (workspace_id, source_sqlite_id, name, email, source_row)
VALUES ($1, $2, $3, $4, '{}'::jsonb);`,
      [WORKSPACE_B_ID, 999, 'Cross Workspace', 'cross@example.test'],
    ));
    await expectPolicyError(client, checks, 'workspace_a_cannot_move_customer_to_workspace_b', () => client.query(
      'UPDATE customers SET workspace_id = $1 WHERE workspace_id = $2 AND source_sqlite_id = $3;',
      [WORKSPACE_B_ID, WORKSPACE_A_ID, 101],
    ));
    await expectReturnedRows(client, checks, {
      name: 'workspace_a_cannot_delete_workspace_b_customer',
      sql: 'DELETE FROM customers WHERE workspace_id = $1 AND source_sqlite_id = $2 RETURNING id;',
      params: [WORKSPACE_B_ID, 201],
      expectedRows: 0,
    });

    await setRlsContext(client, WORKSPACE_B_ID, USER_B_ID, 'user');
    await expectCount(client, checks, {
      name: 'workspace_b_reads_own_customer',
      sql: 'SELECT count(*)::int AS count FROM customers WHERE workspace_id = $1 AND source_sqlite_id = $2;',
      params: [WORKSPACE_B_ID, 201],
      expected: 1,
    });
    await expectCount(client, checks, {
      name: 'workspace_b_cannot_read_workspace_a_customer',
      sql: 'SELECT count(*)::int AS count FROM customers WHERE workspace_id = $1 AND source_sqlite_id = $2;',
      params: [WORKSPACE_A_ID, 101],
      expected: 0,
    });

    await setRlsContext(client, WORKSPACE_A_ID, USER_A_ID, 'user');
    await setPublicTrackingTokenHash(client, '');
    await expectCount(client, checks, {
      name: 'public_tracking_token_without_hash_cannot_read_resolver',
      sql: 'SELECT count(*)::int AS count FROM email_tracking_token_resolver WHERE token_hash = $1;',
      params: [TRACKING_TOKEN_HASH_B],
      expected: 0,
    });
    await setPublicTrackingTokenHash(client, TRACKING_TOKEN_HASH_WRONG);
    await expectCount(client, checks, {
      name: 'public_tracking_token_wrong_hash_cannot_read_resolver',
      sql: 'SELECT count(*)::int AS count FROM email_tracking_token_resolver WHERE token_hash = $1;',
      params: [TRACKING_TOKEN_HASH_B],
      expected: 0,
    });
    await setPublicTrackingTokenHash(client, TRACKING_TOKEN_HASH_B);
    await expectCount(client, checks, {
      name: 'public_tracking_token_matching_hash_reads_one_resolver',
      sql: 'SELECT count(*)::int AS count FROM email_tracking_token_resolver WHERE token_hash = $1;',
      params: [TRACKING_TOKEN_HASH_B],
      expected: 1,
    });

    await setRlsContext(client, WORKSPACE_A_ID, USER_A_ID, 'admin');
    await expectCount(client, checks, {
      name: 'admin_without_cross_workspace_flag_cannot_read_other_workspace',
      sql: 'SELECT count(*)::int AS count FROM customers WHERE workspace_id = $1 AND source_sqlite_id = $2;',
      params: [WORKSPACE_B_ID, 201],
      expected: 0,
    });
    await setRlsContext(client, WORKSPACE_A_ID, USER_A_ID, 'user', true);
    await expectCount(client, checks, {
      name: 'user_with_cross_workspace_flag_cannot_read_other_workspace',
      sql: 'SELECT count(*)::int AS count FROM customers WHERE workspace_id = $1 AND source_sqlite_id = $2;',
      params: [WORKSPACE_B_ID, 201],
      expected: 0,
    });
    await setRlsContext(client, WORKSPACE_A_ID, USER_A_ID, 'admin', true);
    await expectCount(client, checks, {
      name: 'admin_with_cross_workspace_flag_reads_other_workspace',
      sql: 'SELECT count(*)::int AS count FROM customers WHERE workspace_id = $1 AND source_sqlite_id = $2;',
      params: [WORKSPACE_B_ID, 201],
      expected: 1,
    });

    await client.query('ROLLBACK');
    return {
      status: checks.every((check) => check.status === 'passed') ? 'passed' : 'failed',
      checks,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    return {
      status: 'failed',
      checks,
      error: formatRlsCheckError(error),
    };
  }
}

function rlsPolicyTable(
  tableName: string,
  fragments: readonly string[] = WORKSPACE_COLUMN_POLICY_FRAGMENTS,
): RlsPolicyCoverageTable {
  return {
    tableName,
    policyName: `${tableName}_workspace_isolation`,
    usingFragments: fragments,
    withCheckFragments: fragments,
  };
}

async function expectRlsPolicyCoverage(
  client: RlsCheckClient,
  checks: RlsCheckItem[],
): Promise<void> {
  for (const table of RLS_POLICY_COVERAGE_TABLES) {
    const row = await readRlsPolicyCoverage(client, table);
    checks.push({
      name: `${table.tableName}_rls_enabled`,
      status: isTruthyPg(row?.row_security_enabled) ? 'passed' : 'failed',
      detail: row ? 'table exists' : 'table or policy metadata missing',
    });
    checks.push({
      name: `${table.tableName}_rls_forced`,
      status: isTruthyPg(row?.row_security_forced) ? 'passed' : 'failed',
      detail: row ? 'FORCE ROW LEVEL SECURITY is enabled' : 'table or policy metadata missing',
    });
    checks.push({
      name: `${table.tableName}_workspace_policy`,
      status: row && policyContainsExpectedFragments(row, table) ? 'passed' : 'failed',
      detail: row
        ? `policy ${String(row.policy_name ?? '<missing>')}`
        : 'table or policy metadata missing',
    });
  }
}

async function expectPublicResolverPolicyCoverage(
  client: RlsCheckClient,
  checks: RlsCheckItem[],
): Promise<void> {
  const result = await client.query<Pick<RlsPolicyCoverageRow, 'policy_name' | 'using_expression' | 'with_check_expression'>>(
    `SELECT
  policyname AS policy_name,
  qual AS using_expression,
  with_check AS with_check_expression
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename = 'email_tracking_token_resolver'
  AND policyname = 'email_tracking_token_resolver_public_lookup';`,
  );
  const row = result.rows[0];
  const usingExpression = normalizePolicyExpression(row?.using_expression);
  const valid = row?.policy_name === 'email_tracking_token_resolver_public_lookup'
    && row.with_check_expression == null
    && ['token_hash', 'current_setting', 'app.email_tracking_token_hash'].every((fragment) => (
      usingExpression.includes(normalizePolicyExpression(fragment))
    ));
  checks.push({
    name: 'email_tracking_token_resolver_public_lookup_policy',
    status: valid ? 'passed' : 'failed',
    detail: row ? `policy ${String(row.policy_name ?? '<missing>')}` : 'public resolver policy missing',
  });
}

async function readRlsPolicyCoverage(
  client: RlsCheckClient,
  table: RlsPolicyCoverageTable,
): Promise<RlsPolicyCoverageRow | undefined> {
  const result = await client.query<RlsPolicyCoverageRow>(
    `SELECT
  c.relrowsecurity AS row_security_enabled,
  c.relforcerowsecurity AS row_security_forced,
  p.policyname AS policy_name,
  p.qual AS using_expression,
  p.with_check AS with_check_expression
FROM pg_class c
INNER JOIN pg_namespace n ON n.oid = c.relnamespace
LEFT JOIN pg_policies p
  ON p.schemaname = n.nspname
 AND p.tablename = c.relname
 AND p.policyname = $2
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname = $1;`,
    [table.tableName, table.policyName],
  );
  return result.rows[0];
}

type RlsPolicyCoverageRow = {
  row_security_enabled?: boolean | string | null;
  row_security_forced?: boolean | string | null;
  policy_name?: string | null;
  using_expression?: string | null;
  with_check_expression?: string | null;
};

function policyContainsExpectedFragments(
  row: RlsPolicyCoverageRow,
  table: RlsPolicyCoverageTable,
): boolean {
  if (row.policy_name !== table.policyName) return false;
  const usingExpression = normalizePolicyExpression(row.using_expression);
  const withCheckExpression = normalizePolicyExpression(row.with_check_expression);
  return table.usingFragments.every((fragment) => usingExpression.includes(normalizePolicyExpression(fragment)))
    && table.withCheckFragments.every((fragment) => withCheckExpression.includes(normalizePolicyExpression(fragment)));
}

function normalizePolicyExpression(value: string | null | undefined): string {
  return String(value ?? '').replace(/\s+/g, ' ').trim().toLowerCase();
}

function isTruthyPg(value: boolean | string | null | undefined): boolean {
  return value === true || value === 't' || value === 'true';
}

async function seedWorkspaceFixture(
  client: RlsCheckClient,
  input: {
    workspaceId: string;
    userId: string;
    label: string;
    customerSourceId: number;
    trackingMessageId: string;
    trackingLinkId: string;
    trackingTokenHash: string;
  },
): Promise<void> {
  await setRlsContext(client, input.workspaceId, input.userId, 'owner');
  await client.query(
    `INSERT INTO workspaces (id, name)
VALUES ($1, $2)
ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;`,
    [input.workspaceId, `RLS Probe ${input.label}`],
  );
  await client.query(
    `INSERT INTO users (id, workspace_id, email, display_name, password_hash, role)
VALUES ($1, $2, $3, $4, $5, $6)
ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email, display_name = EXCLUDED.display_name;`,
    [
      input.userId,
      input.workspaceId,
      `rls-${input.label}@example.test`,
      `RLS ${input.label.toUpperCase()}`,
      'rls-probe-password-hash',
      'owner',
    ],
  );
  await client.query(
    `INSERT INTO customers (workspace_id, source_sqlite_id, name, email, source_row)
VALUES ($1, $2, $3, $4, '{}'::jsonb)
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET name = EXCLUDED.name, email = EXCLUDED.email;`,
    [
      input.workspaceId,
      input.customerSourceId,
      `RLS Customer ${input.label}`,
      `customer-${input.label}@example.test`,
    ],
  );
  await client.query(
    `INSERT INTO secrets (workspace_id, kind, name, ciphertext, nonce, key_id, algorithm)
VALUES ($1, 'rls_probe', $2, decode('00', 'hex'), decode('01', 'hex'), 'rls-probe', 'test')
ON CONFLICT (workspace_id, kind, name)
DO UPDATE SET key_id = EXCLUDED.key_id;`,
    [input.workspaceId, `secret-${input.label}`],
  );
  const messageResult = await client.query<{ id: number | string }>(
    `INSERT INTO email_messages (
  workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id, uid, subject, source_row
)
VALUES ($1, $2, $2, $2, $2, $3, '{}'::jsonb)
ON CONFLICT (workspace_id, source_sqlite_id)
DO UPDATE SET subject = EXCLUDED.subject
RETURNING id;`,
    [input.workspaceId, input.customerSourceId + 10_000, `RLS tracking ${input.label}`],
  );
  const messageId = messageResult.rows[0]?.id;
  if (messageId === undefined) throw new Error(`RLS tracking fixture message ${input.label} missing`);
  await client.query(
    `INSERT INTO email_tracking_policies (workspace_id)
VALUES ($1)
ON CONFLICT (workspace_id) DO NOTHING;`,
    [input.workspaceId],
  );
  await client.query(
    `INSERT INTO email_tracking_messages (
  id, workspace_id, message_id, recipient_count, track_opens, track_links,
  collect_derived_metadata, collect_raw_metadata, token_expires_at
)
VALUES ($1, $2, $3, 1, true, true, false, false, now() + INTERVAL '1 day')
ON CONFLICT (id) DO NOTHING;`,
    [input.trackingMessageId, input.workspaceId, messageId],
  );
  await client.query(
    `INSERT INTO email_tracking_links (
  id, workspace_id, tracking_message_id, ordinal, token_hash,
  target_ciphertext, target_nonce, target_auth_tag, target_url_hash
)
VALUES ($1, $2, $3, 0, $4, decode('00', 'hex'), decode('01', 'hex'), decode('02', 'hex'), $4)
ON CONFLICT (id) DO NOTHING;`,
    [input.trackingLinkId, input.workspaceId, input.trackingMessageId, `link-${input.trackingTokenHash}`],
  );
  await client.query(
    `INSERT INTO email_tracking_events (
  workspace_id, tracking_message_id, message_id, event_type, source, confidence,
  automated, occurred_at, dedupe_key
)
VALUES ($1, $2, $3, 'queued', 'rls_probe', 'none', true, now(), $4)
ON CONFLICT (workspace_id, dedupe_key) DO NOTHING;`,
    [input.workspaceId, input.trackingMessageId, messageId, `rls-probe-${input.label}`],
  );
  await client.query(
    `INSERT INTO email_tracking_token_resolver (
  token_hash, workspace_id, tracking_message_id, link_id, token_kind, expires_at
)
VALUES ($1, $2, $3, NULL, 'open', now() + INTERVAL '1 day')
ON CONFLICT (token_hash) DO NOTHING;`,
    [input.trackingTokenHash, input.workspaceId, input.trackingMessageId],
  );
}

async function setRlsContext(
  client: RlsCheckClient,
  workspaceId: string,
  userId: string,
  role: 'owner' | 'admin' | 'user' | 'system',
  crossWorkspaceAccess = false,
): Promise<void> {
  await client.query(
    `SELECT
  set_config('app.workspace_id', $1, true),
  set_config('app.user_id', $2, true),
  set_config('app.role', $3, true),
  set_config('app.cross_workspace_access', $4, true);`,
    [workspaceId, userId, role, crossWorkspaceAccess ? 'on' : 'off'],
  );
}

async function setPublicTrackingTokenHash(client: RlsCheckClient, tokenHash: string): Promise<void> {
  await client.query(
    "SELECT set_config('app.email_tracking_token_hash', $1, true);",
    [tokenHash],
  );
}

async function expectCount(
  client: RlsCheckClient,
  checks: RlsCheckItem[],
  input: {
    name: string;
    sql: string;
    params: readonly unknown[];
    expected: number;
  },
): Promise<void> {
  const result = await client.query<{ count: number | string }>(input.sql, input.params);
  const count = Number(result.rows[0]?.count ?? NaN);
  checks.push({
    name: input.name,
    status: count === input.expected ? 'passed' : 'failed',
    detail: `expected ${input.expected}, got ${Number.isNaN(count) ? 'NaN' : count}`,
  });
}

async function expectReturnedRows(
  client: RlsCheckClient,
  checks: RlsCheckItem[],
  input: {
    name: string;
    sql: string;
    params: readonly unknown[];
    expectedRows: number;
  },
): Promise<void> {
  const result = await client.query(input.sql, input.params);
  checks.push({
    name: input.name,
    status: result.rows.length === input.expectedRows ? 'passed' : 'failed',
    detail: `expected ${input.expectedRows}, got ${result.rows.length}`,
  });
}

async function expectPolicyError(
  client: RlsCheckClient,
  checks: RlsCheckItem[],
  name: string,
  operation: () => Promise<unknown>,
): Promise<void> {
  const savepoint = `rls_probe_${checks.length}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  try {
    await operation();
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    checks.push({
      name,
      status: 'failed',
      detail: 'operation succeeded but should have been rejected by RLS',
    });
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    checks.push({
      name,
      status: isRlsPolicyError(error) ? 'passed' : 'failed',
      detail: formatRlsCheckError(error),
    });
  }
}

function isRlsPolicyError(error: unknown): boolean {
  const text = formatRlsCheckError(error).toLowerCase();
  return text.includes('row-level security') || text.includes('violates row-level security policy');
}

function formatRlsCheckError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
