import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { createServer } from 'net';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';

import type { MailPermission } from '../../packages/core/src/email/mail-permissions';
import type {
  MailAclBindingPermissionsTable,
  MailAclBindingsTable,
} from '../../packages/server/src/db/schema';
import { serverMigrations } from '../../packages/server/src/migrations';

jest.setTimeout(120_000);

type DatabaseQueryResult<Row extends Record<string, unknown>> = Readonly<{
  rows: readonly Row[];
}>;

type DatabaseClient = Readonly<{
  connect(): Promise<void>;
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<DatabaseQueryResult<Row>>;
  end(): Promise<void>;
}>;

type Equal<Left, Right> = (
  (<Value>() => Value extends Left ? 1 : 2) extends
  (<Value>() => Value extends Right ? 1 : 2) ? true : false
);

type Assert<Value extends true> = Value;

const schemaTypeAssertions: readonly [
  Assert<Equal<MailAclBindingsTable['subject_type'], 'user' | 'group'>>,
  Assert<Equal<MailAclBindingsTable['resource_type'], 'account' | 'folder' | 'message'>>,
  Assert<Equal<MailAclBindingPermissionsTable['permission_key'], MailPermission>>,
] = [true, true, true];

const WORKSPACE_A = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_B = '22222222-2222-4222-8222-222222222222';
const USER_READ = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER_SEND = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const USER_BOTH = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const USER_WORKSPACE_B = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const USER_CREATOR = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const ACCOUNT_A = 101;
const ACCOUNT_A_OTHER = 102;
const ACCOUNT_B = 201;
const FOLDER_A = 111;
const FOLDER_A_OTHER = 112;
const FOLDER_B = 211;
const MESSAGE_A = 121;
const MESSAGE_B = 221;
const GROUP_A = 301;
const GROUP_B = 401;
const MIGRATION_0038_PERMISSION_KEYS = [
  'mail.metadata.read',
  'mail.content.read',
  'mail.attachment.read',
  'mail.attachment.suspicious_download',
  'mail.triage',
  'mail.comment',
  'mail.draft.create',
  'mail.draft.edit',
  'mail.send',
  'mail.send_as',
  'mail.delete',
  'mail.export',
  'mail.account.manage',
  'mail.delegation.manage',
] as const;

async function findAvailablePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => {
        if (!address || typeof address === 'string') {
          reject(new Error('could not allocate PostgreSQL test port'));
          return;
        }
        resolve(address.port);
      });
    });
  });
}

async function startEmbeddedPostgres(databaseDir: string, port: number): Promise<ChildProcessWithoutNullStreams> {
  const moduleUrl = pathToFileURL(join(
    __dirname,
    '..',
    '..',
    'packages',
    'desktop',
    'node_modules',
    'embedded-postgres',
    'dist',
    'index.js',
  )).href;
  const script = `
import EmbeddedPostgres from ${JSON.stringify(moduleUrl)};
const database = new EmbeddedPostgres({
  databaseDir: ${JSON.stringify(databaseDir)},
  port: ${port},
  user: 'postgres',
  password: 'mail-acl-test-password',
  authMethod: 'scram-sha-256',
  persistent: false,
  onLog() {},
  onError(error) { console.error(error); },
});
await database.initialise();
await database.start();
console.log('MAIL_ACL_POSTGRES_READY');
process.stdin.once('data', async () => {
  await database.stop();
  process.exit(0);
});
process.stdin.resume();
`;
  const child = spawn(process.execPath, ['--input-type=module', '--eval', script]);
  await new Promise<void>((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    const timeout = setTimeout(() => reject(new Error(`PostgreSQL startup timed out: ${stderr}`)), 60_000);
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
      if (stdout.includes('MAIL_ACL_POSTGRES_READY')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (!stdout.includes('MAIL_ACL_POSTGRES_READY')) {
        clearTimeout(timeout);
        reject(new Error(`PostgreSQL exited with ${code}: ${stderr}`));
      }
    });
  });
  return child;
}

describe('server mailbox ACL migration', () => {
  let client: DatabaseClient;
  let postgresProcess: ChildProcessWithoutNullStreams;
  let postgresDir: string;
  let migrationDownApplied = false;

  async function applyStatements(statements: readonly string[]): Promise<void> {
    for (const statement of statements) await client.query(statement);
  }

  async function seedLegacyMailAccess(): Promise<void> {
    await client.query(`
      INSERT INTO workspaces (id, name) VALUES
        ('${WORKSPACE_A}', 'Workspace A'),
        ('${WORKSPACE_B}', 'Workspace B')
    `);
    await client.query(`
      INSERT INTO users (id, workspace_id, email, display_name, password_hash) VALUES
        ('${USER_READ}', '${WORKSPACE_A}', 'read@example.test', 'Read User', 'hash'),
        ('${USER_SEND}', '${WORKSPACE_A}', 'send@example.test', 'Send User', 'hash'),
        ('${USER_BOTH}', '${WORKSPACE_A}', 'both@example.test', 'Both User', 'hash'),
        ('${USER_CREATOR}', '${WORKSPACE_A}', 'creator@example.test', 'Creator User', 'hash'),
        ('${USER_WORKSPACE_B}', '${WORKSPACE_B}', 'other@example.test', 'Other User', 'hash')
    `);
    await client.query(`
      INSERT INTO user_groups (id, workspace_id, name) VALUES
        (${GROUP_A}, '${WORKSPACE_A}', 'Group A'),
        (${GROUP_B}, '${WORKSPACE_B}', 'Group B')
    `);
    await client.query(`
      INSERT INTO email_accounts (
        id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username
      ) VALUES
        (${ACCOUNT_A}, '${WORKSPACE_A}', 1, 'Account A', 'a@example.test', 'imap.example.test', 'a'),
        (${ACCOUNT_A_OTHER}, '${WORKSPACE_A}', 2, 'Account A2', 'a2@example.test', 'imap.example.test', 'a2'),
        (${ACCOUNT_B}, '${WORKSPACE_B}', 1, 'Account B', 'b@example.test', 'imap.example.test', 'b')
    `);
    await client.query(`
      INSERT INTO email_folders (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path
      ) VALUES
        (${FOLDER_A}, '${WORKSPACE_A}', 11, 1, ${ACCOUNT_A}, 'INBOX'),
        (${FOLDER_A_OTHER}, '${WORKSPACE_A}', 12, 2, ${ACCOUNT_A_OTHER}, 'INBOX'),
        (${FOLDER_B}, '${WORKSPACE_B}', 21, 1, ${ACCOUNT_B}, 'INBOX')
    `);
    await client.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id,
        folder_source_sqlite_id, account_id, folder_id, uid
      ) VALUES
        (${MESSAGE_A}, '${WORKSPACE_A}', 31, 1, 11, ${ACCOUNT_A}, ${FOLDER_A}, 1),
        (${MESSAGE_B}, '${WORKSPACE_B}', 41, 1, 21, ${ACCOUNT_B}, ${FOLDER_B}, 1)
    `);
    await client.query(`
      INSERT INTO user_account_access (user_id, account_id, workspace_id, can_read, can_send) VALUES
        ('${USER_READ}', ${ACCOUNT_A}, '${WORKSPACE_A}', true, false),
        ('${USER_SEND}', ${ACCOUNT_A}, '${WORKSPACE_A}', false, true),
        ('${USER_BOTH}', ${ACCOUNT_A}, '${WORKSPACE_A}', true, true)
    `);
  }

  beforeAll(async () => {
    postgresDir = mkdtempSync(join(tmpdir(), 'simplecrm-mail-acl-'));
    const port = await findAvailablePort();
    postgresProcess = await startEmbeddedPostgres(postgresDir, port);
    const requireFromServer = createRequire(join(__dirname, '..', '..', 'packages', 'server', 'package.json'));
    const { Client } = requireFromServer('pg') as {
      Client: new (options: Record<string, unknown>) => DatabaseClient;
    };
    client = new Client({
      host: '127.0.0.1',
      port,
      user: 'postgres',
      password: 'mail-acl-test-password',
      database: 'postgres',
    });
    await client.connect();
    for (const migration of serverMigrations.filter((candidate) => candidate.id < '0038_mail_acl')) {
      await applyStatements(migration.upSql);
    }
    await seedLegacyMailAccess();
    const mailAclMigration = serverMigrations.find((candidate) => candidate.id === '0038_mail_acl');
    if (mailAclMigration) await applyStatements(mailAclMigration.upSql);
  });

  afterAll(async () => {
    if (client) {
      const mailAclMigration = serverMigrations.find((candidate) => candidate.id === '0038_mail_acl');
      if (mailAclMigration && !migrationDownApplied) await applyStatements(mailAclMigration.downSql);
      await client.end();
    }
    if (postgresProcess) {
      postgresProcess.stdin.write('stop\n');
      await new Promise<void>((resolve) => postgresProcess.once('exit', () => resolve()));
    }
    if (postgresDir) rmSync(postgresDir, { recursive: true, force: true });
  });

  test('registers the migration and creates ACL tables with required indexes and RLS', async () => {
    const migrationIds = serverMigrations.map((migration) => migration.id);
    const mailAclMigrationIndex = migrationIds.indexOf('0038_mail_acl');
    const bindings = await client.query<{ count: string }>('SELECT count(*) FROM mail_acl_bindings');
    const permissions = await client.query<{ count: string }>('SELECT count(*) FROM mail_acl_binding_permissions');
    const indexes = await client.query<{ indexname: string }>(`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'mail_acl_bindings'
    `);
    const rls = await client.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
      SELECT relname, relrowsecurity, relforcerowsecurity
      FROM pg_class
      WHERE relname IN ('mail_acl_bindings', 'mail_acl_binding_permissions')
      ORDER BY relname
    `);
    const policies = await client.query<{ tablename: string; policyname: string }>(`
      SELECT tablename, policyname
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN ('mail_acl_bindings', 'mail_acl_binding_permissions')
      ORDER BY tablename, policyname
    `);
    const permissionConstraint = await client.query<{ definition: string }>(`
      SELECT pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname = 'mail_acl_binding_permissions_permission_key_check'
    `);
    const checkedPermissionKeys = Array.from(
      permissionConstraint.rows[0]?.definition.matchAll(/'([^']+)'::text/g) ?? [],
      (match) => match[1],
    );
    const mailAclMigration = serverMigrations[mailAclMigrationIndex];
    const systemContextIndex = mailAclMigration?.upSql.findIndex((statement) => (
      statement.includes("set_config('app.role', 'system', true)")
      && statement.includes("set_config('app.cross_workspace_access', 'on', true)")
    ));
    const legacyBackfillIndex = mailAclMigration?.upSql.findIndex((statement) => (
      statement.includes('INSERT INTO mail_acl_bindings')
    ));

    expect(migrationIds.filter((id) => id === '0038_mail_acl')).toHaveLength(1);
    expect(mailAclMigrationIndex).toBeGreaterThan(0);
    expect(migrationIds[mailAclMigrationIndex - 1]).toBe('0037_user_group_permissions');
    expect(systemContextIndex).toBeGreaterThan(-1);
    expect(systemContextIndex).toBeLessThan(legacyBackfillIndex ?? -1);
    expect(Number(bindings.rows[0]?.count)).toBe(3);
    expect(Number(permissions.rows[0]?.count)).toBe(12);
    expect(indexes.rows.map((row) => row.indexname)).toEqual(expect.arrayContaining([
      'mail_acl_bindings_subject_resource_unique_idx',
      'mail_acl_bindings_workspace_subject_idx',
      'mail_acl_bindings_workspace_account_idx',
      'mail_acl_bindings_workspace_folder_idx',
      'mail_acl_bindings_workspace_message_idx',
    ]));
    expect(rls.rows).toEqual([
      { relname: 'mail_acl_binding_permissions', relrowsecurity: true, relforcerowsecurity: true },
      { relname: 'mail_acl_bindings', relrowsecurity: true, relforcerowsecurity: true },
    ]);
    expect(policies.rows).toEqual([
      {
        tablename: 'mail_acl_binding_permissions',
        policyname: 'mail_acl_binding_permissions_workspace_isolation',
      },
      { tablename: 'mail_acl_bindings', policyname: 'mail_acl_bindings_workspace_isolation' },
    ]);
    expect(checkedPermissionKeys).toEqual(MIGRATION_0038_PERMISSION_KEYS);
    expect(schemaTypeAssertions).toEqual([true, true, true]);
  });

  test('backfills legacy read and send grants exactly and idempotently', async () => {
    const permissionsBefore = await client.query<{
      subject_id: string;
      created_by: string | null;
      permission_key: string;
    }>(`
      SELECT binding.subject_id, binding.created_by, permission.permission_key
      FROM mail_acl_bindings AS binding
      JOIN mail_acl_binding_permissions AS permission ON permission.binding_id = binding.id
      ORDER BY binding.subject_id, permission.permission_key
    `);
    const mailAclMigration = serverMigrations.find((candidate) => candidate.id === '0038_mail_acl');
    expect(mailAclMigration).toBeDefined();
    await applyStatements(mailAclMigration!.upSql);
    const permissionsAfter = await client.query<{
      subject_id: string;
      created_by: string | null;
      permission_key: string;
    }>(`
      SELECT binding.subject_id, binding.created_by, permission.permission_key
      FROM mail_acl_bindings AS binding
      JOIN mail_acl_binding_permissions AS permission ON permission.binding_id = binding.id
      ORDER BY binding.subject_id, permission.permission_key
    `);

    expect(permissionsAfter.rows).toEqual(permissionsBefore.rows);
    expect(permissionsAfter.rows.every((row) => row.created_by === null)).toBe(true);
    expect(permissionsAfter.rows.filter((row) => row.subject_id === USER_READ).map((row) => row.permission_key)).toEqual([
      'mail.attachment.read',
      'mail.content.read',
      'mail.metadata.read',
    ]);
    expect(permissionsAfter.rows.filter((row) => row.subject_id === USER_SEND).map((row) => row.permission_key)).toEqual([
      'mail.draft.create',
      'mail.draft.edit',
      'mail.send',
    ]);
    expect(permissionsAfter.rows.filter((row) => row.subject_id === USER_BOTH).map((row) => row.permission_key)).toEqual([
      'mail.attachment.read',
      'mail.content.read',
      'mail.draft.create',
      'mail.draft.edit',
      'mail.metadata.read',
      'mail.send',
    ]);
  });

  test('accepts only exact subject and resource shapes', async () => {
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (
        workspace_id, subject_type, subject_id, resource_type, account_id, folder_id, created_by
      ) VALUES ('${WORKSPACE_A}', 'group', '${GROUP_A}', 'folder', ${ACCOUNT_A}, ${FOLDER_A}, '${USER_READ}')
    `)).resolves.toBeDefined();
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (
        workspace_id, subject_type, subject_id, resource_type, account_id, folder_id, message_id, created_by
      ) VALUES (
        '${WORKSPACE_A}', 'user', '${USER_READ}', 'message', ${ACCOUNT_A}, ${FOLDER_A}, ${MESSAGE_A}, '${USER_READ}'
      )
    `)).resolves.toBeDefined();

    await expect(client.query(`
      INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id)
      VALUES ('${WORKSPACE_A}', 'team', '${GROUP_A}', 'account', ${ACCOUNT_A})
    `)).rejects.toMatchObject({ code: '23514' });
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id)
      VALUES ('${WORKSPACE_A}', 'user', '${USER_READ}', 'thread', ${ACCOUNT_A})
    `)).rejects.toMatchObject({ code: '23514' });
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (
        workspace_id, subject_type, subject_id, resource_type, account_id, folder_id
      ) VALUES ('${WORKSPACE_A}', 'group', '${GROUP_A}', 'account', ${ACCOUNT_A}, ${FOLDER_A})
    `)).rejects.toMatchObject({ code: '23514' });
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id)
      VALUES ('${WORKSPACE_A}', 'group', '${GROUP_A}', 'folder', ${ACCOUNT_A})
    `)).rejects.toMatchObject({ code: '23514' });
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (
        workspace_id, subject_type, subject_id, resource_type, account_id, folder_id
      ) VALUES ('${WORKSPACE_A}', 'group', '${GROUP_A}', 'message', ${ACCOUNT_A}, ${FOLDER_A})
    `)).rejects.toMatchObject({ code: '23514' });
  });

  test('rejects cross-workspace subjects, creators, and resources at the database boundary', async () => {
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id)
      VALUES ('${WORKSPACE_A}', 'user', '${USER_WORKSPACE_B}', 'account', ${ACCOUNT_A})
    `)).rejects.toMatchObject({ code: '23503' });
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id)
      VALUES ('${WORKSPACE_A}', 'group', '${GROUP_B}', 'account', ${ACCOUNT_A})
    `)).rejects.toMatchObject({ code: '23503' });
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id, created_by)
      VALUES ('${WORKSPACE_A}', 'group', '${GROUP_A}', 'account', ${ACCOUNT_A}, '${USER_WORKSPACE_B}')
    `)).rejects.toMatchObject({ code: '23503' });
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id)
      VALUES ('${WORKSPACE_A}', 'group', '${GROUP_A}', 'account', ${ACCOUNT_B})
    `)).rejects.toMatchObject({ code: '23503' });
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (
        workspace_id, subject_type, subject_id, resource_type, account_id, folder_id
      ) VALUES ('${WORKSPACE_A}', 'group', '${GROUP_A}', 'folder', ${ACCOUNT_A}, ${FOLDER_B})
    `)).rejects.toMatchObject({ code: '23503' });
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (
        workspace_id, subject_type, subject_id, resource_type, account_id, folder_id, message_id
      ) VALUES (
        '${WORKSPACE_A}', 'group', '${GROUP_A}', 'message', ${ACCOUNT_A}, ${FOLDER_A}, ${MESSAGE_B}
      )
    `)).rejects.toMatchObject({ code: '23503' });
  });

  test('requires folders and messages to belong to the declared account chain', async () => {
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (
        workspace_id, subject_type, subject_id, resource_type, account_id, folder_id
      ) VALUES ('${WORKSPACE_A}', 'user', '${USER_READ}', 'folder', ${ACCOUNT_A}, ${FOLDER_A_OTHER})
    `)).rejects.toMatchObject({ code: '23503' });
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (
        workspace_id, subject_type, subject_id, resource_type, account_id, folder_id, message_id
      ) VALUES (
        '${WORKSPACE_A}', 'user', '${USER_READ}', 'message', ${ACCOUNT_A}, ${FOLDER_A_OTHER}, ${MESSAGE_A}
      )
    `)).rejects.toMatchObject({ code: '23503' });
  });

  test('keeps bindings and permission rows unique and validates permission keys', async () => {
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id)
      VALUES ('${WORKSPACE_A}', 'user', '${USER_READ}', 'account', ${ACCOUNT_A})
    `)).rejects.toMatchObject({ code: '23505' });
    await expect(client.query(`
      INSERT INTO mail_acl_binding_permissions (binding_id, permission_key)
      SELECT id, 'mail.metadata.read'
      FROM mail_acl_bindings
      WHERE workspace_id = '${WORKSPACE_A}'
        AND subject_type = 'user'
        AND subject_id = '${USER_READ}'
        AND resource_type = 'account'
        AND account_id = ${ACCOUNT_A}
    `)).rejects.toMatchObject({ code: '23505' });
    await expect(client.query(`
      INSERT INTO mail_acl_binding_permissions (binding_id, permission_key)
      SELECT id, 'mail.unknown'
      FROM mail_acl_bindings
      WHERE workspace_id = '${WORKSPACE_A}'
        AND subject_type = 'user'
        AND subject_id = '${USER_READ}'
        AND resource_type = 'account'
        AND account_id = ${ACCOUNT_A}
    `)).rejects.toMatchObject({ code: '23514' });
  });

  test('preserves bindings and clears only created_by when the creator is deleted', async () => {
    await client.query(`
      INSERT INTO mail_acl_bindings (
        workspace_id, subject_type, subject_id, resource_type, account_id, created_by
      ) VALUES ('${WORKSPACE_A}', 'group', '${GROUP_A}', 'account', ${ACCOUNT_A}, '${USER_CREATOR}')
    `);
    await expect(client.query(`DELETE FROM users WHERE id = '${USER_CREATOR}'`)).resolves.toBeDefined();
    const binding = await client.query<{ workspace_id: string; created_by: string | null }>(`
      SELECT workspace_id, created_by
      FROM mail_acl_bindings
      WHERE subject_type = 'group'
        AND subject_id = '${GROUP_A}'
        AND resource_type = 'account'
        AND account_id = ${ACCOUNT_A}
    `);
    expect(binding.rows).toEqual([{ workspace_id: WORKSPACE_A, created_by: null }]);
  });

  test('down removes only ACL objects and preserves the legacy table', async () => {
    const mailAclMigration = serverMigrations.find((candidate) => candidate.id === '0038_mail_acl');
    expect(mailAclMigration).toBeDefined();
    await applyStatements(mailAclMigration!.downSql);
    migrationDownApplied = true;
    const relations = await client.query<{
      bindings: string | null;
      permissions: string | null;
      legacy: string | null;
      legacy_count: string;
    }>(`
      SELECT
        to_regclass('public.mail_acl_bindings')::text AS bindings,
        to_regclass('public.mail_acl_binding_permissions')::text AS permissions,
        to_regclass('public.user_account_access')::text AS legacy,
        (SELECT count(*)::text FROM user_account_access) AS legacy_count
    `);
    expect(relations.rows[0]).toEqual({
      bindings: null,
      permissions: null,
      legacy: 'user_account_access',
      legacy_count: '3',
    });
  });
});
