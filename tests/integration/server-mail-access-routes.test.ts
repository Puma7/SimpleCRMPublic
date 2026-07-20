import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { createServer } from 'net';
import { PassThrough, Readable } from 'stream';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { Kysely, PostgresDialect } from 'kysely';
import { Pool } from 'pg';
import type { MailPermission } from '../../packages/core/src/email/mail-permissions';
import { createServerApi } from '../../packages/server/src/api/server-api';
import type {
  AuthenticatedPrincipal,
  EmailMessageRecord,
  ServerApiPorts,
} from '../../packages/server/src/api/types';
import {
  createPostgresEmailMessageReadPort,
} from '../../packages/server/src/db/postgres-mail-read-ports';
import {
  createPostgresEmailFolderReadPort,
  createPostgresEmailMessageCategoryReadPort,
  createPostgresEmailThreadReadPort,
} from '../../packages/server/src/db/postgres-mail-metadata-read-ports';
import { createPostgresEmailReportingPort } from '../../packages/server/src/db/postgres-email-reporting-port';
import { createPostgresEmailGdprExportPort } from '../../packages/server/src/mail-gdpr-export';
import type {
  MailAclBindingPermissionsTable,
  MailAclBindingsTable,
  ServerDatabase,
} from '../../packages/server/src/db/schema';
import { createPostgresMailAccessPort } from '../../packages/server/src/mail-access/postgres-mail-access-port';
import { createPostgresMailDelegationPort } from '../../packages/server/src/mail-access/postgres-mail-delegation-port';
import { MailAccessService } from '../../packages/server/src/mail-access/service';
import type { MailSqlScope } from '../../packages/server/src/mail-access/types';
import { serverMigrations } from '../../packages/server/src/migrations';
import { withWorkspaceTransaction } from '../../packages/server/src/db/workspace-context';

jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));

jest.setTimeout(120_000);

type DatabaseQueryResult<Row extends Record<string, unknown>> = Readonly<{
  rows: readonly Row[];
  rowCount?: number | null;
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
const USER_FOLDER = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const USER_MESSAGE = '99999999-9999-4999-8999-999999999999';
const USER_NONE = '88888888-8888-4888-8888-888888888888';
const ACCOUNT_A = 101;
const ACCOUNT_A_OTHER = 102;
const ACCOUNT_B = 201;
const FOLDER_A = 111;
const FOLDER_A_OTHER = 112;
const FOLDER_A_SECOND = 113;
const FOLDER_B = 211;
const MESSAGE_A = 121;
const MESSAGE_A_SECOND = 122;
const MESSAGE_B = 221;
const THREAD_A = 'thread-a';
const CATEGORY_A = 501;
const GROUP_A = 301;
const GROUP_A_REMOVED = 302;
const GROUP_B = 401;
const DELEGATION_WORKSPACE = '33333333-3333-4333-8333-333333333333';
const DELEGATION_OTHER_WORKSPACE = '44444444-4444-4444-8444-444444444444';
const DELEGATION_OWNER = '30000000-0000-4000-8000-000000000001';
const DELEGATION_ADMIN = '30000000-0000-4000-8000-000000000002';
const DELEGATION_MANAGER = '30000000-0000-4000-8000-000000000003';
const DELEGATION_TARGET = '30000000-0000-4000-8000-000000000004';
const DELEGATION_DISABLED = '30000000-0000-4000-8000-000000000005';
const DELEGATION_CONCURRENT_TARGET = '30000000-0000-4000-8000-000000000006';
const DELEGATION_OTHER_USER = '40000000-0000-4000-8000-000000000001';
const DELEGATION_ACCOUNT = 9101;
const DELEGATION_UNMANAGED_ACCOUNT = 9102;
const DELEGATION_OTHER_ACCOUNT = 9103;
const DELEGATION_FOLDER = 9201;
const DELEGATION_UNMANAGED_FOLDER = 9202;
const DELEGATION_OTHER_FOLDER = 9203;
const DELEGATION_GROUP = 9301;
const MIGRATION_ROLE = 'simplecrm_mail_acl_migrator';
const MIGRATION_ROLE_PASSWORD = 'mail-acl-migrator-password';
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

type TestMailResourceLookupTarget =
  | Readonly<{ kind: 'account'; id: number }>
  | Readonly<{ kind: 'folder'; id: number }>
  | Readonly<{ kind: 'message'; id: number }>
  | Readonly<{ kind: 'attachment'; id: number }>
  | Readonly<{ kind: 'thread'; id: string }>
  | Readonly<{ kind: 'metadata'; entity: string; id: number }>;

type TestMailResourceLookupPort = Readonly<{
  resolve(input: Readonly<{
    workspaceId: string;
    target: TestMailResourceLookupTarget;
  }>): Promise<readonly import('../../packages/core/src/email/mail-permissions').MailResource[]>;
}>;

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

function withMailScope<T extends object>(input: T, mailScope: MailSqlScope): T & { mailScope: MailSqlScope } {
  return { ...input, mailScope };
}

async function readableToBuffer(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

function delegationSelectCount(queries: readonly string[]): number {
  return queries.filter((query) => (
    /^\s*select\b/i.test(query)
    && !query.includes('set_config')
  )).length;
}

describe('server mailbox ACL migration', () => {
  let adminClient: DatabaseClient;
  let client: DatabaseClient;
  let postgresProcess: ChildProcessWithoutNullStreams;
  let postgresDir: string;
  let postgresPort: number;
  let migrationDownApplied = false;

  async function applyStatements(statements: readonly string[]): Promise<void> {
    for (const statement of statements) await client.query(statement);
  }

  async function applyStatementsInTransaction(statements: readonly string[]): Promise<void> {
    await client.query('BEGIN');
    try {
      await applyStatements(statements);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
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
        ('${USER_FOLDER}', '${WORKSPACE_A}', 'folder@example.test', 'Folder User', 'hash'),
        ('${USER_MESSAGE}', '${WORKSPACE_A}', 'message@example.test', 'Message User', 'hash'),
        ('${USER_NONE}', '${WORKSPACE_A}', 'none@example.test', 'No Grant User', 'hash'),
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
        (${FOLDER_A_SECOND}, '${WORKSPACE_A}', 13, 1, ${ACCOUNT_A}, 'Archive'),
        (${FOLDER_B}, '${WORKSPACE_B}', 21, 1, ${ACCOUNT_B}, 'INBOX')
    `);
    await client.query(`
      INSERT INTO email_messages (
        id, workspace_id, source_sqlite_id, account_source_sqlite_id,
        folder_source_sqlite_id, account_id, folder_id, uid, subject, folder_kind, thread_id
      ) VALUES
        (${MESSAGE_A}, '${WORKSPACE_A}', 31, 1, 11, ${ACCOUNT_A}, ${FOLDER_A}, 1, 'Allowed alpha', 'inbox', '${THREAD_A}'),
        (${MESSAGE_A_SECOND}, '${WORKSPACE_A}', 32, 1, 13, ${ACCOUNT_A}, ${FOLDER_A_SECOND}, 1, 'Hidden alpha', 'inbox', '${THREAD_A}'),
        (${MESSAGE_B}, '${WORKSPACE_B}', 41, 1, 21, ${ACCOUNT_B}, ${FOLDER_B}, 1, 'Workspace B', 'inbox', 'thread-b')
    `);
    await client.query(`
      INSERT INTO email_threads (
        id, workspace_id, ticket_code, account_source_sqlite_id, account_id,
        root_message_source_sqlite_id, root_message_id, message_count, has_unread,
        has_attachments, subject_normalized
      ) VALUES
        ('${THREAD_A}', '${WORKSPACE_A}', 'T-A', 1, ${ACCOUNT_A}, 31, ${MESSAGE_A}, 2, true, false, 'alpha'),
        ('thread-b', '${WORKSPACE_B}', 'T-B', 1, ${ACCOUNT_B}, 41, ${MESSAGE_B}, 1, true, false, 'workspace b')
    `);
    await client.query(`
      INSERT INTO email_categories (id, workspace_id, source_sqlite_id, name, sort_order)
      VALUES (${CATEGORY_A}, '${WORKSPACE_A}', 51, 'Scoped', 0)
    `);
    await client.query(`
      INSERT INTO email_message_categories (
        id, workspace_id, source_sqlite_id, message_source_sqlite_id,
        category_source_sqlite_id, message_id, category_id
      ) VALUES
        (511, '${WORKSPACE_A}', 61, 31, 51, ${MESSAGE_A}, ${CATEGORY_A}),
        (512, '${WORKSPACE_A}', 62, 32, 51, ${MESSAGE_A_SECOND}, ${CATEGORY_A})
    `);
    await client.query(`
      INSERT INTO user_account_access (user_id, account_id, workspace_id, can_read, can_send) VALUES
        ('${USER_READ}', ${ACCOUNT_A}, '${WORKSPACE_A}', true, false),
        ('${USER_SEND}', ${ACCOUNT_A}, '${WORKSPACE_A}', false, true),
        ('${USER_BOTH}', ${ACCOUNT_A}, '${WORKSPACE_A}', true, true)
    `);
  }

  function createApplicationDb(options: Readonly<{
    maxConnections?: number;
    onQuery?: (sqlText: string) => void;
  }> = {}): Kysely<ServerDatabase> {
    return new Kysely<ServerDatabase>({
      dialect: new PostgresDialect({
        pool: new Pool({
          host: '127.0.0.1',
          port: postgresPort,
          user: MIGRATION_ROLE,
          password: MIGRATION_ROLE_PASSWORD,
          database: 'postgres',
          max: options.maxConnections ?? 1,
        }),
      }),
      log(event) {
        if (event.level === 'query') options.onQuery?.(event.query.sql);
      },
    });
  }

  async function ensureScopedGrantFixtures(): Promise<void> {
    await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
    await client.query(`
      INSERT INTO mail_acl_bindings (
        workspace_id, subject_type, subject_id, resource_type, account_id, folder_id, message_id
      ) VALUES
        ('${WORKSPACE_A}', 'user', '${USER_FOLDER}', 'folder', ${ACCOUNT_A}, ${FOLDER_A}, NULL),
        ('${WORKSPACE_A}', 'user', '${USER_MESSAGE}', 'message', ${ACCOUNT_A}, ${FOLDER_A}, ${MESSAGE_A})
      ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO mail_acl_binding_permissions (binding_id, permission_key)
      SELECT id, 'mail.metadata.read'
      FROM mail_acl_bindings
      WHERE workspace_id = '${WORKSPACE_A}'
        AND subject_id IN ('${USER_FOLDER}', '${USER_MESSAGE}')
      ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO mail_acl_binding_permissions (binding_id, permission_key)
      SELECT id, 'mail.export'
      FROM mail_acl_bindings
      WHERE workspace_id = '${WORKSPACE_A}'
        AND subject_id = '${USER_FOLDER}'
      ON CONFLICT DO NOTHING
    `);
    await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
  }

  async function resolveMetadataScope(
    db: Kysely<ServerDatabase>,
    userId: string,
  ): Promise<MailSqlScope> {
    const service = new MailAccessService(createPostgresMailAccessPort({ db }));
    return service.resolveScope({
      workspaceId: WORKSPACE_A,
      actor: {
        workspaceId: WORKSPACE_A,
        userId,
        isOwner: false,
        isAdmin: false,
      },
      permission: 'mail.metadata.read',
    });
  }

  function makePrincipal(
    role: AuthenticatedPrincipal['role'] = 'user',
    workspaceId = WORKSPACE_A,
  ): AuthenticatedPrincipal {
    return {
      userId: role === 'user' ? USER_NONE : USER_CREATOR,
      workspaceId,
      role,
    };
  }

  function makeHttpResourceLookup(): TestMailResourceLookupPort {
    return {
      async resolve(input) {
        if (input.workspaceId !== WORKSPACE_A) return [];
        const target = input.target;
        if (target.kind === 'account') {
          if (target.id === ACCOUNT_A || target.id === ACCOUNT_A_OTHER) {
            return [{ type: 'account', accountId: String(target.id) }];
          }
          return [];
        }
        if (target.kind === 'folder') {
          if (target.id === FOLDER_A) {
            return [{ type: 'folder', accountId: String(ACCOUNT_A), folderId: String(FOLDER_A) }];
          }
          return [];
        }
        if (target.kind === 'message') {
          if (target.id === MESSAGE_A) {
            return [{
              type: 'message',
              accountId: String(ACCOUNT_A),
              folderId: String(FOLDER_A),
              messageId: String(MESSAGE_A),
            }];
          }
          if (target.id === MESSAGE_A_SECOND) {
            return [{
              type: 'message',
              accountId: String(ACCOUNT_A),
              folderId: String(FOLDER_A_SECOND),
              messageId: String(MESSAGE_A_SECOND),
            }];
          }
          return [];
        }
        if (target.kind === 'attachment' && target.id === 701) {
          return [{
            type: 'message',
            accountId: String(ACCOUNT_A),
            folderId: String(FOLDER_A),
            messageId: String(MESSAGE_A),
          }];
        }
        if (target.kind === 'thread' && target.id === THREAD_A) {
          return [
            {
              type: 'message',
              accountId: String(ACCOUNT_A),
              folderId: String(FOLDER_A),
              messageId: String(MESSAGE_A),
            },
            {
              type: 'message',
              accountId: String(ACCOUNT_A),
              folderId: String(FOLDER_A_SECOND),
              messageId: String(MESSAGE_A_SECOND),
            },
          ];
        }
        return [];
      },
    };
  }

  function makeHttpPorts(input: Readonly<{
    grants?: ReadonlyMap<MailPermission, readonly import('../../packages/server/src/mail-access/types').MailAccessGrant[]>;
    overrides?: Partial<ServerApiPorts>;
  }> = {}): ServerApiPorts {
    const mailAccess = new MailAccessService({
      async resolveGrants(request) {
        return input.grants?.get(request.permission) ?? [];
      },
    });
    return {
      auth: {} as ServerApiPorts['auth'],
      locks: {} as ServerApiPorts['locks'],
      mailAccess,
      mailResourceLookup: makeHttpResourceLookup(),
      ...input.overrides,
    } as unknown as ServerApiPorts;
  }

  function makeMessageRecord(id: number): EmailMessageRecord {
    return {
      id,
      sourceSqliteId: id,
      accountId: ACCOUNT_A,
      folderId: FOLDER_A,
      uid: 1,
      messageId: `message-${id}`,
      subject: `Message ${id}`,
      from: null,
      to: null,
      cc: null,
      bcc: null,
      dateReceived: null,
      snippet: null,
      seenLocal: false,
      doneLocal: false,
      archived: false,
      softDeleted: false,
      folderKind: 'inbox',
      threadId: THREAD_A,
      imapThreadId: null,
      ticketCode: null,
      customerId: null,
      hasAttachments: false,
      assignedTo: null,
      assignedToUserId: null,
      isSpam: false,
      spamStatus: 'inbox',
      pgpStatus: null,
      remoteContentPolicy: 'blocked',
      readReceiptRequested: false,
      snoozedUntil: null,
      updatedAt: '2026-07-19T12:00:00.000Z',
    };
  }

  function makeThreadAliasRecord(id = 9001): NonNullable<Awaited<ReturnType<NonNullable<ServerApiPorts['emailThreadAliases']>['get']>>> {
    return {
      id,
      sourceSqliteId: id,
      accountId: ACCOUNT_A,
      aliasThreadId: 'alias-thread',
      canonicalThreadId: THREAD_A,
      confidence: 'high',
      source: 'manual_merge',
      createdAt: '2026-07-19T12:00:00.000Z',
      updatedAt: '2026-07-19T12:00:00.000Z',
    };
  }

  beforeAll(async () => {
    postgresDir = mkdtempSync(join(tmpdir(), 'simplecrm-mail-acl-'));
    postgresPort = await findAvailablePort();
    postgresProcess = await startEmbeddedPostgres(postgresDir, postgresPort);
    const requireFromServer = createRequire(join(__dirname, '..', '..', 'packages', 'server', 'package.json'));
    const { Client } = requireFromServer('pg') as {
      Client: new (options: Record<string, unknown>) => DatabaseClient;
    };
    adminClient = new Client({
      host: '127.0.0.1',
      port: postgresPort,
      user: 'postgres',
      password: 'mail-acl-test-password',
      database: 'postgres',
    });
    await adminClient.connect();
    await adminClient.query(`
      CREATE ROLE ${MIGRATION_ROLE}
      LOGIN PASSWORD '${MIGRATION_ROLE_PASSWORD}'
      NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS
    `);
    await adminClient.query(`GRANT CREATE ON DATABASE postgres TO ${MIGRATION_ROLE}`);
    await adminClient.query(`GRANT CREATE ON SCHEMA public TO ${MIGRATION_ROLE}`);
    client = new Client({
      host: '127.0.0.1',
      port: postgresPort,
      user: MIGRATION_ROLE,
      password: MIGRATION_ROLE_PASSWORD,
      database: 'postgres',
    });
    await client.connect();
    for (const migration of serverMigrations.filter((candidate) => candidate.id < '0038_mail_acl')) {
      await applyStatements(migration.upSql);
    }
    await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
    await seedLegacyMailAccess();
    await client.query('RESET app.role; RESET app.cross_workspace_access');
  });

  afterAll(async () => {
    if (client) {
      const mailAclMigration = serverMigrations.find((candidate) => candidate.id === '0038_mail_acl');
      if (mailAclMigration && !migrationDownApplied) await applyStatements(mailAclMigration.downSql);
      await client.end();
    }
    if (adminClient) await adminClient.end();
    if (postgresProcess) {
      postgresProcess.stdin.write('stop\n');
      await new Promise<void>((resolve) => postgresProcess.once('exit', () => resolve()));
    }
    if (postgresDir) rmSync(postgresDir, { recursive: true, force: true });
  });

  test('runs the backfill in one non-superuser transaction with transaction-local RLS context', async () => {
    const migrationIds = serverMigrations.map((migration) => migration.id);
    const mailAclMigrationIndex = migrationIds.indexOf('0038_mail_acl');
    const mailAclMigration = serverMigrations[mailAclMigrationIndex];
    const systemContextIndex = mailAclMigration?.upSql.findIndex((statement) => (
      statement.includes("set_config('app.role', 'system', true)")
      && statement.includes("set_config('app.cross_workspace_access', 'on', true)")
    )) ?? -1;
    const legacyBackfillIndex = mailAclMigration?.upSql.findIndex((statement) => (
      statement.includes('INSERT INTO mail_acl_bindings')
    )) ?? -1;
    const migrationRole = await client.query<{
      role_name: string;
      is_superuser: boolean;
      bypasses_rls: boolean;
    }>(`
      SELECT current_user AS role_name, rolsuper AS is_superuser, rolbypassrls AS bypasses_rls
      FROM pg_roles
      WHERE rolname = current_user
    `);

    expect(mailAclMigration).toBeDefined();
    expect(systemContextIndex).toBeGreaterThan(-1);
    expect(legacyBackfillIndex).toBeGreaterThan(systemContextIndex);
    expect(migrationRole.rows).toEqual([{
      role_name: MIGRATION_ROLE,
      is_superuser: false,
      bypasses_rls: false,
    }]);

    await client.query('BEGIN');
    try {
      await applyStatements(mailAclMigration!.upSql.slice(0, systemContextIndex));
      await client.query('SAVEPOINT without_system_context');
      await expect(client.query(`
        INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id)
        VALUES ('${WORKSPACE_A}', 'group', '${GROUP_A}', 'account', ${ACCOUNT_A})
      `)).rejects.toMatchObject({ code: '42501' });
      await client.query('ROLLBACK TO SAVEPOINT without_system_context');
      await client.query('RELEASE SAVEPOINT without_system_context');
      const blockedBackfill = await client.query(mailAclMigration!.upSql[legacyBackfillIndex]!);
      expect(blockedBackfill.rowCount).toBe(0);
      await applyStatements(mailAclMigration!.upSql.slice(systemContextIndex));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const localContextAfterCommit = await client.query<{ role: string | null; cross_workspace_access: string | null }>(`
      SELECT
        current_setting('app.role', true) AS role,
        current_setting('app.cross_workspace_access', true) AS cross_workspace_access
    `);
    expect(localContextAfterCommit.rows[0]?.role).not.toBe('system');
    expect(localContextAfterCommit.rows[0]?.cross_workspace_access).not.toBe('on');
    await expect(client.query(`
      INSERT INTO mail_acl_bindings (workspace_id, subject_type, subject_id, resource_type, account_id)
      VALUES ('${WORKSPACE_A}', 'group', '${GROUP_A}', 'account', ${ACCOUNT_A})
    `)).rejects.toMatchObject({ code: '42501' });

    await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
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
    const policies = await client.query<{
      tablename: string;
      policyname: string;
      using_expression: string;
      with_check_expression: string;
    }>(`
      SELECT
        tablename,
        policyname,
        qual AS using_expression,
        with_check AS with_check_expression
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
    expect(migrationIds.filter((id) => id === '0038_mail_acl')).toHaveLength(1);
    expect(mailAclMigrationIndex).toBeGreaterThan(0);
    expect(migrationIds[mailAclMigrationIndex - 1]).toBe('0037_user_group_permissions');
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
    expect(policies.rows.map(({ tablename, policyname }) => ({ tablename, policyname }))).toEqual([
      {
        tablename: 'mail_acl_binding_permissions',
        policyname: 'mail_acl_binding_permissions_workspace_isolation',
      },
      { tablename: 'mail_acl_bindings', policyname: 'mail_acl_bindings_workspace_isolation' },
    ]);
    const bindingsPolicy = policies.rows.find((policy) => policy.tablename === 'mail_acl_bindings');
    const permissionsPolicy = policies.rows.find((policy) => policy.tablename === 'mail_acl_binding_permissions');
    for (const expression of [bindingsPolicy?.using_expression, bindingsPolicy?.with_check_expression]) {
      expect(expression).toContain('app.can_access_workspace(workspace_id)');
    }
    for (const expression of [permissionsPolicy?.using_expression, permissionsPolicy?.with_check_expression]) {
      expect(expression).toContain('mail_acl_bindings');
      expect(expression).toContain('binding.id = mail_acl_binding_permissions.binding_id');
      expect(expression).toContain('app.can_access_workspace(binding.workspace_id)');
    }
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
    await applyStatementsInTransaction(mailAclMigration!.upSql);
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
        '${WORKSPACE_A}', 'user', '${USER_READ}', 'message', ${ACCOUNT_A}, ${FOLDER_A_SECOND}, ${MESSAGE_A}
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

  test('resolves only direct and current-group grants through the real RLS session', async () => {
    await client.query('BEGIN');
    try {
      await client.query(`
        SELECT set_config('app.role', 'system', true),
               set_config('app.cross_workspace_access', 'on', true)
      `);
      await client.query(`
        INSERT INTO user_groups (id, workspace_id, name)
        VALUES (${GROUP_A_REMOVED}, '${WORKSPACE_A}', 'Removed Group')
      `);
      await client.query(`
        INSERT INTO user_group_members (workspace_id, group_id, user_id) VALUES
          ('${WORKSPACE_A}', ${GROUP_A}, '${USER_READ}'),
          ('${WORKSPACE_A}', ${GROUP_A_REMOVED}, '${USER_READ}'),
          ('${WORKSPACE_B}', ${GROUP_B}, '${USER_READ}')
      `);
      await client.query(`
        DELETE FROM user_group_members
        WHERE workspace_id = '${WORKSPACE_A}'
          AND group_id = ${GROUP_A_REMOVED}
          AND user_id = '${USER_READ}'
      `);
      await client.query(`
        INSERT INTO mail_acl_bindings (
          workspace_id, subject_type, subject_id, resource_type, account_id, folder_id, message_id
        ) VALUES
          ('${WORKSPACE_A}', 'group', '${GROUP_A}', 'folder', ${ACCOUNT_A_OTHER}, ${FOLDER_A_OTHER}, NULL),
          ('${WORKSPACE_A}', 'group', '${GROUP_A_REMOVED}', 'message', ${ACCOUNT_A}, ${FOLDER_A_SECOND}, ${MESSAGE_A_SECOND}),
          ('${WORKSPACE_B}', 'group', '${GROUP_B}', 'account', ${ACCOUNT_B}, NULL, NULL),
          ('${WORKSPACE_B}', 'user', '${USER_WORKSPACE_B}', 'folder', ${ACCOUNT_B}, ${FOLDER_B}, NULL),
          ('${WORKSPACE_A}', 'user', '${USER_READ}', 'folder', ${ACCOUNT_A}, ${FOLDER_A_SECOND}, NULL)
      `);
      await client.query(`
        INSERT INTO mail_acl_binding_permissions (binding_id, permission_key)
        SELECT id,
          CASE
            WHEN workspace_id = '${WORKSPACE_A}'
              AND subject_type = 'user'
              AND resource_type = 'folder'
            THEN 'mail.send'
            ELSE 'mail.content.read'
          END
        FROM mail_acl_bindings
        WHERE (workspace_id = '${WORKSPACE_A}' AND subject_type = 'group' AND subject_id = '${GROUP_A}'
          AND resource_type = 'folder' AND account_id = ${ACCOUNT_A_OTHER} AND folder_id = ${FOLDER_A_OTHER})
          OR (workspace_id = '${WORKSPACE_A}' AND subject_type = 'group' AND subject_id = '${GROUP_A_REMOVED}'
            AND resource_type = 'message' AND message_id = ${MESSAGE_A_SECOND})
          OR (workspace_id = '${WORKSPACE_B}' AND subject_type = 'group' AND subject_id = '${GROUP_B}'
            AND resource_type = 'account' AND account_id = ${ACCOUNT_B})
          OR (workspace_id = '${WORKSPACE_B}' AND subject_type = 'user' AND subject_id = '${USER_WORKSPACE_B}'
            AND resource_type = 'folder' AND folder_id = ${FOLDER_B})
          OR (workspace_id = '${WORKSPACE_A}' AND subject_type = 'user' AND subject_id = '${USER_READ}'
            AND resource_type = 'folder' AND folder_id = ${FOLDER_A_SECOND})
      `);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }

    const db = new Kysely<ServerDatabase>({
      dialect: new PostgresDialect({
        pool: new Pool({
          host: '127.0.0.1',
          port: postgresPort,
          user: MIGRATION_ROLE,
          password: MIGRATION_ROLE_PASSWORD,
          database: 'postgres',
          max: 1,
        }),
      }),
    });
    try {
      const role = await client.query<{
        is_superuser: boolean;
        bypasses_rls: boolean;
      }>(`
        SELECT rolsuper AS is_superuser, rolbypassrls AS bypasses_rls
        FROM pg_roles
        WHERE rolname = current_user
      `);
      expect(role.rows).toEqual([{ is_superuser: false, bypasses_rls: false }]);

      const port = createPostgresMailAccessPort({ db });
      const grants = await port.resolveGrants({
        workspaceId: WORKSPACE_A,
        userId: USER_READ,
        permission: 'mail.content.read',
      });

      expect(grants).toEqual([
        { resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null },
        {
          resourceType: 'folder',
          accountId: ACCOUNT_A_OTHER,
          folderId: FOLDER_A_OTHER,
          messageId: null,
        },
      ]);
    } finally {
      await db.destroy();
    }
  });

  test('denies direct message, attachment, bulk, and account-settings HTTP side effects uniformly', async () => {
    const getMessage = jest.fn(async () => makeMessageRecord(MESSAGE_A));
    const getAttachmentContent = jest.fn(async () => ({
      ok: true as const,
      record: {
        id: 701,
        filename: 'secret.txt',
        contentType: 'text/plain',
        sizeBytes: 6,
        contentSha256: null,
        content: new Uint8Array(Buffer.from('secret')),
      },
    }));
    const bulkSetArchived = jest.fn(async () => ({ success: true, updated: 2 }));
    const setAccountSettings = jest.fn(async () => ({
      accountId: ACCOUNT_A,
      ticketPrefix: 'ACL',
      ticketNextNumber: 1,
      ticketNumberPadding: 4,
      threadNamespace: 'acl',
      updatedAt: null,
    }));
    const ports = makeHttpPorts({
      grants: new Map([
        ['mail.triage', [{
          resourceType: 'message' as const,
          accountId: ACCOUNT_A,
          folderId: FOLDER_A,
          messageId: MESSAGE_A,
        }]],
      ]),
      overrides: {
        emailMessages: {
          list: async () => ({ items: [], nextCursor: null }),
          get: getMessage,
          bulkSetArchived,
        },
        emailAttachmentContent: { get: getAttachmentContent },
        emailAccounts: {
          list: async () => ({ items: [] }),
          get: async () => ({ id: ACCOUNT_A, sourceSqliteId: 1 }),
        } as ServerApiPorts['emailAccounts'],
        emailAccountMailSettings: {
          get: async () => null,
          set: setAccountSettings,
        },
      },
    });
    const api = createServerApi(ports);
    const principal = makePrincipal();

    const messageResponse = await api.handle({
      method: 'GET',
      path: `/api/v1/email/messages/${MESSAGE_A}`,
      principal,
    });
    const attachmentResponse = await api.handle({
      method: 'GET',
      path: '/api/v1/email/attachments/701/content',
      principal,
    });
    const bulkResponse = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/bulk/archive',
      principal,
      body: { messageIds: [MESSAGE_A, MESSAGE_A, MESSAGE_A_SECOND], archived: true },
    });
    const settingsResponse = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/settings/account-mail',
      principal,
      body: { accountId: ACCOUNT_A, ticketPrefix: 'ACL' },
    });

    const publicDenial = {
      status: 404,
      body: {
        error: {
          code: 'mail_resource_not_found',
          message: 'Mail-Ressource nicht gefunden',
        },
      },
    };
    expect(messageResponse).toEqual(publicDenial);
    expect(attachmentResponse).toEqual(publicDenial);
    expect(bulkResponse).toEqual(publicDenial);
    expect(settingsResponse).toEqual(publicDenial);
    expect(getMessage).not.toHaveBeenCalled();
    expect(getAttachmentContent).not.toHaveBeenCalled();
    expect(bulkSetArchived).not.toHaveBeenCalled();
    expect(setAccountSettings).not.toHaveBeenCalled();
  });

  test('passes one fail-closed scope to list, counts, thread, reporting, and export handlers', async () => {
    const observedScopes: Array<MailSqlScope | undefined> = [];
    const ports = makeHttpPorts({
      overrides: {
        emailMessages: {
          async list(input) {
            observedScopes.push((input as typeof input & { mailScope?: MailSqlScope }).mailScope);
            return { items: [], nextCursor: null };
          },
          async get() { return null; },
          async getFolderCounts(input) {
            observedScopes.push((input as typeof input & { mailScope?: MailSqlScope }).mailScope);
            return {
              inbox: 0,
              inboxUnread: 0,
              sentFailed: 0,
              drafts: 0,
              scheduledSend: 0,
              archived: 0,
              spamReview: 0,
              spam: 0,
              trash: 0,
              snoozed: 0,
            };
          },
        },
        emailThreads: {
          async list(input) {
            observedScopes.push((input as typeof input & { mailScope?: MailSqlScope }).mailScope);
            return { items: [], nextCursor: null };
          },
          async get() { return null; },
        },
        emailMessageCategories: {
          async list() { return { items: [], nextCursor: null }; },
          async get() { return null; },
          async listCounts(input) {
            observedScopes.push((input as typeof input & { mailScope?: MailSqlScope }).mailScope);
            return [];
          },
        },
        emailReporting: {
          async collect(input) {
            observedScopes.push((input as typeof input & { mailScope?: MailSqlScope }).mailScope);
            return { accounts: [], totals: { messages: 0, unread: 0, archived: 0, withCustomer: 0, withAssignment: 0, withAttachments: 0 }, perAccount: [], workflowRuns24h: [] };
          },
        },
        emailGdprExport: {
          async export(input) {
            observedScopes.push((input as typeof input & { mailScope?: MailSqlScope }).mailScope);
            return { ok: true, filename: 'empty.zip', stream: Readable.from([]) };
          },
        },
      },
    });
    const api = createServerApi(ports);
    const principal = makePrincipal();

    await api.handle({ method: 'GET', path: '/api/v1/email/messages', query: { search: 'alpha' }, principal });
    await api.handle({ method: 'GET', path: '/api/v1/email/folder-counts', principal });
    await api.handle({ method: 'GET', path: '/api/v1/email/threads', principal });
    await api.handle({ method: 'GET', path: '/api/v1/email/category-counts', principal });
    await api.handle({ method: 'GET', path: '/api/v1/email/reporting', principal });
    await api.handle({ method: 'GET', path: '/api/v1/email/gdpr-export', query: { skipAttachments: 'true' }, principal });

    expect(observedScopes).toHaveLength(6);
    expect(observedScopes).toEqual(Array.from({ length: 6 }, () => ({ kind: 'none' })));
  });

  test('denies non-GET mail-scope writes for restricted account, folder, and message grants', async () => {
    const restrictedGrantCases: Array<readonly [
      string,
      import('../../packages/server/src/mail-access/types').MailAccessGrant,
    ]> = [
      ['account', { resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }],
      ['folder', { resourceType: 'folder', accountId: ACCOUNT_A, folderId: FOLDER_A, messageId: null }],
      ['message', {
        resourceType: 'message',
        accountId: ACCOUNT_A,
        folderId: FOLDER_A,
        messageId: MESSAGE_A,
      }],
    ];

    for (const [, grant] of restrictedGrantCases) {
      const createCategory = jest.fn(async () => ({
        ok: true as const,
        category: {
          id: 801,
          sourceSqliteId: 801,
          parentSourceSqliteId: null,
          parentId: null,
          name: 'ACL Test',
          sortOrder: 0,
          createdAt: null,
          updatedAt: '2026-07-19T12:00:00.000Z',
        },
      }));
      const api = createServerApi(makeHttpPorts({
        grants: new Map([
          ['mail.triage', [grant]],
        ]),
        overrides: {
          emailCategories: {
            list: async () => ({ items: [], nextCursor: null }),
            get: async () => null,
            create: createCategory,
          },
        },
      }));

      const response = await api.handle({
        method: 'POST',
        path: '/api/v1/email/categories',
        principal: makePrincipal(),
        body: { name: 'ACL Test' },
      });

      expect(response.status).toBe(404);
      expect(createCategory).not.toHaveBeenCalled();
    }

    const ownerCreateCategory = jest.fn(async () => ({
      ok: true as const,
      category: {
        id: 802,
        sourceSqliteId: 802,
        parentSourceSqliteId: null,
        parentId: null,
        name: 'Owner ACL Test',
        sortOrder: 0,
        createdAt: null,
        updatedAt: '2026-07-19T12:00:00.000Z',
      },
    }));
    const ownerApi = createServerApi(makeHttpPorts({
      overrides: {
        emailCategories: {
          list: async () => ({ items: [], nextCursor: null }),
          get: async () => null,
          create: ownerCreateCategory,
        },
      },
    }));
    const ownerResponse = await ownerApi.handle({
      method: 'POST',
      path: '/api/v1/email/categories',
      principal: makePrincipal('owner'),
      body: { name: 'Owner ACL Test' },
    });

    expect(ownerResponse.status).toBe(201);
    expect(ownerCreateCategory).toHaveBeenCalledTimes(1);
  });

  test('authorizes thread merge by the target account and keeps restricted non-account grants denied', async () => {
    const publicDenial = {
      status: 404,
      body: {
        error: {
          code: 'mail_resource_not_found',
          message: 'Mail-Ressource nicht gefunden',
        },
      },
    };
    const mergeBody = {
      accountId: ACCOUNT_A,
      aliasThreadId: 'alias-thread',
      canonicalThreadId: THREAD_A,
    };
    const folderMerge = jest.fn(async () => ({
      ok: true as const,
      alias: makeThreadAliasRecord(),
      movedMessageCount: 2,
      orphanThreadDeleted: false,
    }));
    const folderApi = createServerApi(makeHttpPorts({
      grants: new Map([
        ['mail.triage', [{
          resourceType: 'folder' as const,
          accountId: ACCOUNT_A,
          folderId: FOLDER_A,
          messageId: null,
        }]],
      ]),
      overrides: {
        emailThreadAliases: {
          list: async () => ({ items: [], nextCursor: null }),
          get: async () => null,
          merge: folderMerge,
        },
      },
    }));
    const folderResponse = await folderApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/merge',
      principal: makePrincipal(),
      body: mergeBody,
    });

    const accountMerge = jest.fn(async () => ({
      ok: true as const,
      alias: makeThreadAliasRecord(9002),
      movedMessageCount: 2,
      orphanThreadDeleted: false,
    }));
    const accountApi = createServerApi(makeHttpPorts({
      grants: new Map([
        ['mail.triage', [{
          resourceType: 'account' as const,
          accountId: ACCOUNT_A,
          folderId: null,
          messageId: null,
        }]],
      ]),
      overrides: {
        emailThreadAliases: {
          list: async () => ({ items: [], nextCursor: null }),
          get: async () => null,
          merge: accountMerge,
        },
      },
    }));
    const accountResponse = await accountApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/merge',
      principal: makePrincipal(),
      body: mergeBody,
    });

    const ownerMerge = jest.fn(async () => ({
      ok: true as const,
      alias: makeThreadAliasRecord(9003),
      movedMessageCount: 2,
      orphanThreadDeleted: false,
    }));
    const ownerApi = createServerApi(makeHttpPorts({
      overrides: {
        emailThreadAliases: {
          list: async () => ({ items: [], nextCursor: null }),
          get: async () => null,
          merge: ownerMerge,
        },
      },
    }));
    const ownerResponse = await ownerApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/merge',
      principal: makePrincipal('owner'),
      body: mergeBody,
    });

    expect(folderResponse).toEqual(publicDenial);
    expect(folderMerge).not.toHaveBeenCalled();
    expect(accountResponse.status).toBe(200);
    expect(accountMerge).toHaveBeenCalledTimes(1);
    expect(ownerResponse.status).toBe(200);
    expect(ownerMerge).toHaveBeenCalledTimes(1);
  });

  test('keeps owner/admin workspace binding and attachment/send-as permissions independent', async () => {
    const getMessage = jest.fn(async () => makeMessageRecord(MESSAGE_A));
    const getAttachmentContent = jest.fn(async () => ({
      ok: true as const,
      record: {
        id: 701,
        filename: 'allowed.txt',
        contentType: 'text/plain',
        sizeBytes: 2,
        contentSha256: null,
        content: new Uint8Array(Buffer.from('ok')),
      },
    }));
    const send = jest.fn(async () => ({ ok: true as const, messageId: MESSAGE_A, accountId: ACCOUNT_A_OTHER }));
    const contentOnly = new Map<MailPermission, readonly import('../../packages/server/src/mail-access/types').MailAccessGrant[]>([
      ['mail.content.read', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
      ['mail.send', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
    ]);
    const contentApi = createServerApi(makeHttpPorts({
      grants: contentOnly,
      overrides: {
        emailMessages: { list: async () => ({ items: [], nextCursor: null }), get: getMessage },
        emailAttachmentContent: { get: getAttachmentContent },
        emailComposeSender: { send },
      },
    }));

    const ownerAllowed = await contentApi.handle({
      method: 'GET',
      path: `/api/v1/email/messages/${MESSAGE_A}`,
      principal: makePrincipal('owner'),
    });
    const adminAllowed = await contentApi.handle({
      method: 'GET',
      path: `/api/v1/email/messages/${MESSAGE_A}`,
      principal: makePrincipal('admin'),
    });
    const foreignOwnerDenied = await contentApi.handle({
      method: 'GET',
      path: `/api/v1/email/messages/${MESSAGE_A}`,
      principal: makePrincipal('owner', WORKSPACE_B),
    });
    const attachmentDenied = await contentApi.handle({
      method: 'GET',
      path: '/api/v1/email/attachments/701/content',
      principal: makePrincipal(),
    });
    const sendAsDenied = await contentApi.handle({
      method: 'POST',
      path: '/api/v1/email/compose/send',
      principal: makePrincipal(),
      body: {
        accountId: ACCOUNT_A_OTHER,
        draftMessageId: MESSAGE_A,
        subject: 'Cross-account',
        bodyText: 'Body',
        to: 'recipient@example.test',
      },
    });

    expect(ownerAllowed.status).toBe(200);
    expect(adminAllowed.status).toBe(200);
    expect(foreignOwnerDenied.status).toBe(404);
    expect(attachmentDenied.status).toBe(404);
    expect(sendAsDenied.status).toBe(404);
    expect(getAttachmentContent).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();

    const attachmentAndSendAs = new Map(contentOnly);
    attachmentAndSendAs.set('mail.attachment.read', [
      { resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null },
    ]);
    attachmentAndSendAs.set('mail.send_as', [
      { resourceType: 'account', accountId: ACCOUNT_A_OTHER, folderId: null, messageId: null },
    ]);
    const elevatedApi = createServerApi(makeHttpPorts({
      grants: attachmentAndSendAs,
      overrides: {
        emailMessages: { list: async () => ({ items: [], nextCursor: null }), get: getMessage },
        emailAttachmentContent: { get: getAttachmentContent },
        emailComposeSender: { send },
      },
    }));
    const attachmentAllowed = await elevatedApi.handle({
      method: 'GET',
      path: '/api/v1/email/attachments/701/content',
      principal: makePrincipal(),
    });
    const sendAsAllowed = await elevatedApi.handle({
      method: 'POST',
      path: '/api/v1/email/compose/send',
      principal: makePrincipal(),
      body: {
        accountId: ACCOUNT_A_OTHER,
        draftMessageId: MESSAGE_A,
        subject: 'Cross-account',
        bodyText: 'Body',
        to: 'recipient@example.test',
      },
    });
    expect(attachmentAllowed.status).toBe(200);
    expect(sendAsAllowed.status).toBe(200);
  });

  test('preserves exempt checks and non-mail dispatch', async () => {
    const testImap = jest.fn(async () => ({ success: true as const }));
    const api = createServerApi(makeHttpPorts({
      overrides: {
        mailConnectionTests: {
          testImap,
          async testPop3() { return { success: true }; },
          async testSmtp() { return { success: true }; },
        },
      },
    }));
    const principal = makePrincipal();
    const authSetup = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/test-imap',
      principal,
      body: {
        imapHost: 'imap.example.test',
        imapPort: 993,
        imapTls: true,
        imapUsername: 'user',
        imapPassword: 'password',
      },
    });
    const adminSecurity = await api.handle({
      method: 'GET',
      path: '/api/v1/email/settings/security',
      principal,
    });
    const health = await api.handle({ method: 'GET', path: '/health' });

    expect(authSetup.status).toBe(200);
    expect(testImap).toHaveBeenCalledTimes(1);
    expect(adminSecurity).toMatchObject({ status: 403, body: { error: { code: 'forbidden' } } });
    expect(health).toMatchObject({ status: 200, body: { data: { status: 'ok' } } });
  });

  test('applies none, folder, message, and account scopes before message search pagination', async () => {
    await ensureScopedGrantFixtures();
    const db = createApplicationDb();
    try {
      const port = createPostgresEmailMessageReadPort({ db });
      const noneScope = await resolveMetadataScope(db, USER_NONE);
      const folderScope = await resolveMetadataScope(db, USER_FOLDER);
      const messageScope = await resolveMetadataScope(db, USER_MESSAGE);
      const accountScope = await resolveMetadataScope(db, USER_READ);

      const none = await port.list(withMailScope({ workspaceId: WORKSPACE_A, search: '/alpha/', limit: 10 }, noneScope));
      const folderPage = await port.list(withMailScope({ workspaceId: WORKSPACE_A, search: '/alpha/', limit: 1 }, folderScope));
      const messageOnly = await port.list(withMailScope({ workspaceId: WORKSPACE_A, limit: 10 }, messageScope));
      const accountWide = await port.list(withMailScope({ workspaceId: WORKSPACE_A, limit: 10 }, accountScope));

      expect(none.items).toEqual([]);
      expect(folderPage.items.map((item) => item.id)).toEqual([MESSAGE_A]);
      expect(folderPage.nextCursor).toBeNull();
      expect(messageOnly.items.map((item) => item.id)).toEqual([MESSAGE_A]);
      expect(accountWide.items.map((item) => item.id).sort((left, right) => left - right)).toEqual([
        MESSAGE_A,
        MESSAGE_A_SECOND,
      ]);
    } finally {
      await db.destroy();
    }
  });

  test('ignores hidden message cursors before normal, priority, and snoozed pagination', async () => {
    await ensureScopedGrantFixtures();
    const db = createApplicationDb();
    try {
      await client.query(`
        UPDATE email_messages
        SET date_received = CASE
          WHEN id = ${MESSAGE_A} THEN '2026-07-19T10:00:00Z'::timestamptz
          WHEN id = ${MESSAGE_A_SECOND} THEN '2026-07-19T12:00:00Z'::timestamptz
          ELSE date_received
        END,
        snoozed_until = CASE
          WHEN id = ${MESSAGE_A} THEN '2026-07-20T12:00:00Z'::timestamptz
          WHEN id = ${MESSAGE_A_SECOND} THEN '2026-07-20T10:00:00Z'::timestamptz
          ELSE snoozed_until
        END
        WHERE workspace_id = '${WORKSPACE_A}'
          AND id IN (${MESSAGE_A}, ${MESSAGE_A_SECOND})
      `);
      await client.query(`
        INSERT INTO email_message_tags (
          id, workspace_id, source_sqlite_id, message_source_sqlite_id, message_id, tag
        ) VALUES
          (621, '${WORKSPACE_A}', 621, 31, ${MESSAGE_A}, 'priority:niedrig'),
          (622, '${WORKSPACE_A}', 622, 32, ${MESSAGE_A_SECOND}, 'priority:hoch')
        ON CONFLICT DO NOTHING
      `);
      const port = createPostgresEmailMessageReadPort({ db });
      const folderScope = await resolveMetadataScope(db, USER_FOLDER);

      const defaultPage = await port.list(withMailScope({
        workspaceId: WORKSPACE_A,
        cursor: MESSAGE_A_SECOND,
        limit: 10,
      }, folderScope));
      const dateAscPage = await port.list(withMailScope({
        workspaceId: WORKSPACE_A,
        cursor: MESSAGE_A_SECOND,
        sort: 'date_asc',
        limit: 10,
      }, folderScope));
      const priorityPage = await port.list(withMailScope({
        workspaceId: WORKSPACE_A,
        cursor: MESSAGE_A_SECOND,
        sort: 'priority',
        limit: 10,
      }, folderScope));
      const snoozedPage = await port.list(withMailScope({
        workspaceId: WORKSPACE_A,
        cursor: MESSAGE_A_SECOND,
        view: 'snoozed',
        limit: 10,
      }, folderScope));

      expect(defaultPage.items.map((item) => item.id)).toEqual([MESSAGE_A]);
      expect(dateAscPage.items.map((item) => item.id)).toEqual([MESSAGE_A]);
      expect(priorityPage.items.map((item) => item.id)).toEqual([MESSAGE_A]);
      expect(snoozedPage.items.map((item) => item.id)).toEqual([MESSAGE_A]);
    } finally {
      await client.query(`
        UPDATE email_messages
        SET date_received = NULL,
            snoozed_until = NULL
        WHERE workspace_id = '${WORKSPACE_A}'
          AND id IN (${MESSAGE_A}, ${MESSAGE_A_SECOND})
      `);
      await client.query(`
        DELETE FROM email_message_tags
        WHERE workspace_id = '${WORKSPACE_A}'
          AND id IN (621, 622)
      `);
      await db.destroy();
    }
  });

  test('scopes folder/category counts and folder metadata before aggregation and cursoring', async () => {
    await ensureScopedGrantFixtures();
    const db = createApplicationDb();
    try {
      const folderScope = await resolveMetadataScope(db, USER_FOLDER);
      const messageScope = await resolveMetadataScope(db, USER_MESSAGE);
      const messagePort = createPostgresEmailMessageReadPort({ db });
      const categoryPort = createPostgresEmailMessageCategoryReadPort({ db });
      const folderPort = createPostgresEmailFolderReadPort({ db });

      const counts = await messagePort.getFolderCounts?.(withMailScope({ workspaceId: WORKSPACE_A }, folderScope));
      const categoryCounts = await categoryPort.listCounts?.(withMailScope({ workspaceId: WORKSPACE_A }, folderScope));
      const folders = await folderPort.list(withMailScope({ workspaceId: WORKSPACE_A, limit: 10 }, folderScope));
      const messageOnlyFolders = await folderPort.list(withMailScope({ workspaceId: WORKSPACE_A, limit: 10 }, messageScope));

      expect(counts).toMatchObject({ inbox: 1, inboxUnread: 1 });
      expect(categoryCounts).toEqual([{ categoryId: CATEGORY_A, count: 1 }]);
      expect(folders.items.map((item) => item.id)).toEqual([FOLDER_A]);
      expect(messageOnlyFolders.items).toEqual([]);
    } finally {
      await db.destroy();
    }
  });

  test('filters partial threads before message delivery and thread aggregation', async () => {
    await ensureScopedGrantFixtures();
    const db = createApplicationDb();
    try {
      const folderScope = await resolveMetadataScope(db, USER_FOLDER);
      const messagePort = createPostgresEmailMessageReadPort({ db });
      const threadPort = createPostgresEmailThreadReadPort({ db });
      const messages = await messagePort.listThread?.(withMailScope({
        workspaceId: WORKSPACE_A,
        threadId: THREAD_A,
        limit: 10,
      }, folderScope));
      const threads = await threadPort.list(withMailScope({ workspaceId: WORKSPACE_A, limit: 10 }, folderScope));

      expect(messages?.items.map((item) => item.id)).toEqual([MESSAGE_A]);
      expect(threads.items).toHaveLength(1);
      expect(threads.items[0]).toMatchObject({ id: THREAD_A, messageCount: 1, hasUnread: true });
    } finally {
      await db.destroy();
    }
  });

  test('applies thread view and account filters only to visible sibling messages', async () => {
    await ensureScopedGrantFixtures();
    const db = createApplicationDb();
    try {
      await client.query(`
        INSERT INTO email_messages (
          id, workspace_id, source_sqlite_id, account_source_sqlite_id,
          folder_source_sqlite_id, account_id, folder_id, uid, subject, folder_kind, thread_id
        ) VALUES
          (123, '${WORKSPACE_A}', 33, 2, 12, ${ACCOUNT_A_OTHER}, ${FOLDER_A_OTHER}, 1, 'Hidden other account', 'inbox', 'thread-filter')
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        INSERT INTO email_threads (
          id, workspace_id, ticket_code, account_source_sqlite_id, account_id,
          root_message_source_sqlite_id, root_message_id, message_count, has_unread,
          has_attachments, subject_normalized
        ) VALUES
          ('thread-filter', '${WORKSPACE_A}', 'T-F', 1, ${ACCOUNT_A}, 31, ${MESSAGE_A}, 2, true, false, 'filter')
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        UPDATE email_messages
        SET folder_kind = 'archive',
            thread_id = 'thread-filter'
        WHERE workspace_id = '${WORKSPACE_A}'
          AND id = ${MESSAGE_A}
      `);
      const threadPort = createPostgresEmailThreadReadPort({ db });
      const folderScope = await resolveMetadataScope(db, USER_FOLDER);
      const inboxThreads = await threadPort.list(withMailScope({
        workspaceId: WORKSPACE_A,
        view: 'inbox',
        limit: 10,
      }, folderScope));
      const otherAccountThreads = await threadPort.list(withMailScope({
        workspaceId: WORKSPACE_A,
        accountId: ACCOUNT_A_OTHER,
        limit: 10,
      }, folderScope));
      const visibleAccountThreads = await threadPort.list(withMailScope({
        workspaceId: WORKSPACE_A,
        accountId: ACCOUNT_A,
        limit: 10,
      }, folderScope));

      expect(inboxThreads.items).toEqual([]);
      expect(otherAccountThreads.items).toEqual([]);
      expect(visibleAccountThreads.items.map((item) => item.id)).toEqual(['thread-filter']);
    } finally {
      await client.query(`
        UPDATE email_messages
        SET folder_kind = 'inbox',
            thread_id = '${THREAD_A}'
        WHERE workspace_id = '${WORKSPACE_A}'
          AND id = ${MESSAGE_A}
      `);
      await client.query(`
        DELETE FROM email_messages
        WHERE workspace_id = '${WORKSPACE_A}'
          AND id = 123
      `);
      await client.query(`
        DELETE FROM email_threads
        WHERE workspace_id = '${WORKSPACE_A}'
          AND id = 'thread-filter'
      `);
      await db.destroy();
    }
  });

  test('scopes reporting totals, per-account output, and accounts', async () => {
    await ensureScopedGrantFixtures();
    const db = createApplicationDb();
    try {
      const folderScope = await resolveMetadataScope(db, USER_FOLDER);
      const noneScope = await resolveMetadataScope(db, USER_NONE);
      const reporting = createPostgresEmailReportingPort({ db });
      const folderReport = await reporting.collect(withMailScope({ workspaceId: WORKSPACE_A }, folderScope));
      const noneReport = await reporting.collect(withMailScope({ workspaceId: WORKSPACE_A }, noneScope));

      expect(folderReport.totals).toMatchObject({ messages: 1, unread: 1 });
      expect(folderReport.perAccount).toEqual([{ accountId: ACCOUNT_A, messages: 1, unread: 1, archived: 0 }]);
      expect(folderReport.accounts.map((account) => account.id)).toEqual([ACCOUNT_A]);
      expect(noneReport).toMatchObject({
        accounts: [],
        totals: { messages: 0, unread: 0 },
        perAccount: [],
        workflowRuns24h: [],
      });
    } finally {
      await db.destroy();
    }
  });

  test('scopes PostgreSQL GDPR export before batching', async () => {
    await ensureScopedGrantFixtures();
    const db = createApplicationDb();
    try {
      const access = new MailAccessService(createPostgresMailAccessPort({ db }));
      const folderScope = await access.resolveScope({
        workspaceId: WORKSPACE_A,
        actor: { workspaceId: WORKSPACE_A, userId: USER_FOLDER, isOwner: false, isAdmin: false },
        permission: 'mail.export',
      });
      const entries = new Map<string, string>();
      const pendingStreams: Array<{ name: string; stream: Readable }> = [];
      let finalizeExport: (() => void) | undefined;
      const finalized = new Promise<void>((resolve) => { finalizeExport = resolve; });
      const archive = {
        on() { return archive; },
        pipe() { return archive; },
        append(content: string | Buffer | Readable, options: { name: string }) {
          if (content instanceof Readable) pendingStreams.push({ name: options.name, stream: content });
          else entries.set(options.name, Buffer.isBuffer(content) ? content.toString('utf8') : content);
          return archive;
        },
        async finalize() {
          for (const pending of pendingStreams) {
            entries.set(pending.name, (await readableToBuffer(pending.stream)).toString('utf8'));
          }
          finalizeExport?.();
        },
        abort() { finalizeExport?.(); },
      };
      const exportOptions = {
        db,
        attachmentsRoot: postgresDir,
        archiveFactory: () => archive,
        outputStreamFactory: () => new PassThrough(),
      };
      const exporter = createPostgresEmailGdprExportPort(exportOptions);
      const result = await exporter.export(withMailScope({
        workspaceId: WORKSPACE_A,
        skipAttachments: true,
      }, folderScope));
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      await finalized;
      const messageLines = (entries.get('messages_index.jsonl') ?? '').trim().split('\n').filter(Boolean);
      const accounts = JSON.parse(entries.get('accounts_redacted.json') ?? '[]') as Array<{ id: number }>;
      expect(messageLines.map((line) => (JSON.parse(line) as { id: number }).id)).toEqual([MESSAGE_A]);
      expect(accounts.map((account) => Number(account.id))).toEqual([ACCOUNT_A]);
    } finally {
      await db.destroy();
    }
  });

  describe('PostgreSQL mail delegation port', () => {
    const pageUserIds = Array.from({ length: 10 }, (_, index) => (
      `30000000-0000-4000-8000-${String(100 + index).padStart(12, '0')}`
    ));
    const pageGroupIds = Array.from({ length: 10 }, (_, index) => 9310 + index);

    beforeAll(async () => {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`
        INSERT INTO workspaces (id, name) VALUES
          ('${DELEGATION_WORKSPACE}', 'Delegation Workspace'),
          ('${DELEGATION_OTHER_WORKSPACE}', 'Delegation Other Workspace')
        ON CONFLICT DO NOTHING
      `);
      const fixedUsers = [
        [DELEGATION_OWNER, DELEGATION_WORKSPACE, 'delegation-owner@example.test', 'Delegation Owner', 'owner', 'NULL'],
        [DELEGATION_ADMIN, DELEGATION_WORKSPACE, 'delegation-admin@example.test', 'Delegation Admin', 'admin', 'NULL'],
        [DELEGATION_MANAGER, DELEGATION_WORKSPACE, 'delegation-manager@example.test', 'Delegation Manager', 'user', 'NULL'],
        [DELEGATION_TARGET, DELEGATION_WORKSPACE, 'delegation-target@example.test', 'Delegation Target', 'user', 'NULL'],
        [DELEGATION_CONCURRENT_TARGET, DELEGATION_WORKSPACE, 'delegation-concurrent@example.test', 'Concurrent Target', 'user', 'NULL'],
        [DELEGATION_DISABLED, DELEGATION_WORKSPACE, 'delegation-disabled@example.test', 'Disabled Target', 'user', "'2026-07-20T10:00:00.000Z'"],
        [DELEGATION_OTHER_USER, DELEGATION_OTHER_WORKSPACE, 'delegation-other@example.test', 'Other Workspace Target', 'user', 'NULL'],
      ].map(([id, workspaceId, email, name, role, disabledAt]) => (
        `('${id}', '${workspaceId}', '${email}', '${name}', 'hash', '${role}', ${disabledAt})`
      ));
      const pageUsers = pageUserIds.map((id, index) => (
        `('${id}', '${DELEGATION_WORKSPACE}', 'delegation-page-${index}@example.test', 'Page User ${index}', 'hash', 'user', NULL)`
      ));
      await client.query(`
        INSERT INTO users (id, workspace_id, email, display_name, password_hash, role, disabled_at)
        VALUES ${[...fixedUsers, ...pageUsers].join(',\n')}
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        INSERT INTO user_groups (id, workspace_id, name) VALUES
          (${DELEGATION_GROUP}, '${DELEGATION_WORKSPACE}', 'Delegation Group'),
          ${pageGroupIds.map((id, index) => `(${id}, '${DELEGATION_WORKSPACE}', 'Page Group ${index}')`).join(',\n')},
          (9399, '${DELEGATION_OTHER_WORKSPACE}', 'Other Workspace Group')
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        INSERT INTO email_accounts (
          id, workspace_id, source_sqlite_id, display_name, email_address, imap_host, imap_username
        ) VALUES
          (${DELEGATION_ACCOUNT}, '${DELEGATION_WORKSPACE}', 9101, 'Managed Account', 'managed@example.test', 'imap.example.test', 'managed'),
          (${DELEGATION_UNMANAGED_ACCOUNT}, '${DELEGATION_WORKSPACE}', 9102, 'Unmanaged Account', 'unmanaged@example.test', 'imap.example.test', 'unmanaged'),
          (${DELEGATION_OTHER_ACCOUNT}, '${DELEGATION_OTHER_WORKSPACE}', 9103, 'Other Account', 'other-delegation@example.test', 'imap.example.test', 'other')
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        INSERT INTO email_folders (
          id, workspace_id, source_sqlite_id, account_source_sqlite_id, account_id, path
        ) VALUES
          (${DELEGATION_FOLDER}, '${DELEGATION_WORKSPACE}', 9201, 9101, ${DELEGATION_ACCOUNT}, 'Managed Folder'),
          (${DELEGATION_UNMANAGED_FOLDER}, '${DELEGATION_WORKSPACE}', 9202, 9102, ${DELEGATION_UNMANAGED_ACCOUNT}, 'Unmanaged Folder'),
          (${DELEGATION_OTHER_FOLDER}, '${DELEGATION_OTHER_WORKSPACE}', 9203, 9103, ${DELEGATION_OTHER_ACCOUNT}, 'Other Folder')
        ON CONFLICT DO NOTHING
      `);
      const unauthorizedBindings = [
        `(9401, '${DELEGATION_WORKSPACE}', 'user', '${DELEGATION_TARGET}', 'account', ${DELEGATION_UNMANAGED_ACCOUNT}, NULL, NULL, '${DELEGATION_OWNER}')`,
        `(9402, '${DELEGATION_WORKSPACE}', 'group', '${DELEGATION_GROUP}', 'folder', ${DELEGATION_UNMANAGED_ACCOUNT}, ${DELEGATION_UNMANAGED_FOLDER}, NULL, '${DELEGATION_OWNER}')`,
      ];
      const pageBindings = Array.from({ length: 20 }, (_, index) => {
        const id = 9501 + index;
        if (index % 2 === 0) {
          return `(${id}, '${DELEGATION_WORKSPACE}', 'user', '${pageUserIds[index / 2]}', 'account', ${DELEGATION_ACCOUNT}, NULL, NULL, '${DELEGATION_OWNER}')`;
        }
        return `(${id}, '${DELEGATION_WORKSPACE}', 'group', '${pageGroupIds[(index - 1) / 2]}', 'folder', ${DELEGATION_ACCOUNT}, ${DELEGATION_FOLDER}, NULL, '${DELEGATION_OWNER}')`;
      });
      await client.query(`
        INSERT INTO mail_acl_bindings (
          id, workspace_id, subject_type, subject_id, resource_type,
          account_id, folder_id, message_id, created_by
        ) VALUES
          ${[...unauthorizedBindings, ...pageBindings,
            `(9590, '${DELEGATION_WORKSPACE}', 'user', '${DELEGATION_MANAGER}', 'account', ${DELEGATION_ACCOUNT}, NULL, NULL, '${DELEGATION_OWNER}')`,
            `(9600, '${DELEGATION_OTHER_WORKSPACE}', 'user', '${DELEGATION_OTHER_USER}', 'account', ${DELEGATION_OTHER_ACCOUNT}, NULL, NULL, '${DELEGATION_OTHER_USER}')`,
          ].join(',\n')}
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        INSERT INTO mail_acl_binding_permissions (binding_id, permission_key)
        SELECT id,
          CASE WHEN id = 9590 THEN 'mail.delegation.manage' ELSE 'mail.metadata.read' END
        FROM mail_acl_bindings
        WHERE id BETWEEN 9401 AND 9600
        ON CONFLICT DO NOTHING
      `);
      await client.query('RESET app.role; RESET app.cross_workspace_access');
    });

    afterAll(async () => {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
    });

    test('uses a constant real query count for small and large pages and filters authorization before limit', async () => {
      const queries: string[] = [];
      const db = createApplicationDb({ maxConnections: 4, onQuery: (query) => queries.push(query) });
      const port = createPostgresMailDelegationPort({ db });
      const ownerActor = { userId: DELEGATION_OWNER, isOwner: true, isAdmin: false };
      try {
        queries.length = 0;
        const small = await port.listBindings({
          workspaceId: DELEGATION_WORKSPACE,
          actor: ownerActor,
          cursor: 9500,
          limit: 2,
        });
        const smallSelects = delegationSelectCount(queries);

        queries.length = 0;
        const large = await port.listBindings({
          workspaceId: DELEGATION_WORKSPACE,
          actor: ownerActor,
          cursor: 9500,
          limit: 20,
        });
        const largeSelects = delegationSelectCount(queries);
        const managerPage = await port.listBindings({
          workspaceId: DELEGATION_WORKSPACE,
          actor: { userId: DELEGATION_MANAGER, isOwner: false, isAdmin: false },
          limit: 1,
        });

        expect(small).toMatchObject({ ok: true, bindings: [{ id: 9501 }, { id: 9502 }], nextCursor: 9502 });
        expect(large).toMatchObject({ ok: true, nextCursor: 9520 });
        expect(smallSelects).toBe(6);
        expect(largeSelects).toBe(6);
        expect(managerPage).toMatchObject({ ok: true, bindings: [{ id: 9501 }] });
      } finally {
        await db.destroy();
      }
    });

    test('lists only manageable resources and minimized same-workspace active subjects without metadata grants', async () => {
      const db = createApplicationDb({ maxConnections: 4 });
      const basePort = createPostgresMailDelegationPort({ db });
      const port = basePort as typeof basePort & {
        listResourceOptions(input: Record<string, unknown>): Promise<any>;
        listSubjectOptions(input: Record<string, unknown>): Promise<any>;
      };
      const actor = { userId: DELEGATION_MANAGER, isOwner: false, isAdmin: false };
      try {
        const accounts = await port.listResourceOptions({
          workspaceId: DELEGATION_WORKSPACE,
          actor,
          resourceType: 'account',
          limit: 100,
        });
        const folders = await port.listResourceOptions({
          workspaceId: DELEGATION_WORKSPACE,
          actor,
          resourceType: 'folder',
          limit: 100,
        });
        const users = await port.listSubjectOptions({
          workspaceId: DELEGATION_WORKSPACE,
          actor,
          resource: { type: 'account', accountId: DELEGATION_ACCOUNT },
          subjectType: 'user',
          limit: 100,
        });
        const groups = await port.listSubjectOptions({
          workspaceId: DELEGATION_WORKSPACE,
          actor,
          resource: { type: 'account', accountId: DELEGATION_ACCOUNT },
          subjectType: 'group',
          limit: 100,
        });

        expect(accounts).toEqual({
          ok: true,
          resources: [{ type: 'account', accountId: DELEGATION_ACCOUNT, label: 'Managed Account' }],
          nextCursor: null,
        });
        expect(folders).toEqual({
          ok: true,
          resources: [{
            type: 'folder',
            accountId: DELEGATION_ACCOUNT,
            folderId: DELEGATION_FOLDER,
            accountLabel: 'Managed Account',
            label: 'Managed Folder',
          }],
          nextCursor: null,
        });
        expect(users.subjects).toContainEqual({ type: 'user', id: DELEGATION_TARGET, label: 'Delegation Target' });
        expect(users.subjects).not.toEqual(expect.arrayContaining([
          expect.objectContaining({ id: DELEGATION_OWNER }),
          expect.objectContaining({ id: DELEGATION_ADMIN }),
          expect.objectContaining({ id: DELEGATION_DISABLED }),
          expect.objectContaining({ id: DELEGATION_OTHER_USER }),
        ]));
        expect(groups.subjects).toContainEqual({ type: 'group', id: DELEGATION_GROUP, label: 'Delegation Group' });
        expect(groups.subjects).not.toContainEqual(expect.objectContaining({ id: 9399 }));
      } finally {
        await db.destroy();
      }
    });

    test('enforces workspace RLS for raw and hydrated delegation reads', async () => {
      const db = createApplicationDb({ maxConnections: 2 });
      const port = createPostgresMailDelegationPort({ db });
      try {
        const rawRows = await withWorkspaceTransaction(
          db,
          { workspaceId: DELEGATION_WORKSPACE, userId: DELEGATION_OWNER, role: 'owner' },
          (trx) => trx.selectFrom('mail_acl_bindings').select(['workspace_id']).execute(),
        );
        const hydrated = await port.listBindings({
          workspaceId: DELEGATION_WORKSPACE,
          actor: { userId: DELEGATION_OWNER, isOwner: true, isAdmin: false },
          limit: 100,
        });

        expect(new Set(rawRows.map((row) => row.workspace_id))).toEqual(new Set([DELEGATION_WORKSPACE]));
        expect(hydrated.ok).toBe(true);
        if (hydrated.ok) {
          expect(hydrated.bindings.some((binding) => binding.resource.accountId === DELEGATION_OTHER_ACCOUNT)).toBe(false);
        }
      } finally {
        await db.destroy();
      }
    });

    test('serializes parallel creates into one full binding without duplicate or 500', async () => {
      const db = createApplicationDb({ maxConnections: 4 });
      const port = createPostgresMailDelegationPort({ db });
      const actor = { userId: DELEGATION_OWNER, isOwner: true, isAdmin: false };
      const input = {
        workspaceId: DELEGATION_WORKSPACE,
        actor,
        subject: { type: 'user' as const, id: DELEGATION_CONCURRENT_TARGET },
        resource: { type: 'account' as const, accountId: DELEGATION_UNMANAGED_ACCOUNT },
      };
      try {
        await port.replaceBinding({ ...input, permissions: [] });
        await client.query(`
          CREATE OR REPLACE FUNCTION task7_delay_parallel_binding_insert()
          RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.subject_id = '${DELEGATION_CONCURRENT_TARGET}'
              AND NEW.resource_type = 'account'
              AND NEW.account_id = ${DELEGATION_UNMANAGED_ACCOUNT}
            THEN
              PERFORM pg_sleep(0.25);
            END IF;
            RETURN NEW;
          END $$
        `);
        await client.query(`
          CREATE TRIGGER task7_delay_parallel_binding_insert
          BEFORE INSERT ON mail_acl_bindings
          FOR EACH ROW EXECUTE FUNCTION task7_delay_parallel_binding_insert()
        `);
        const results = await Promise.allSettled([
          port.replaceBinding({ ...input, permissions: ['mail.metadata.read'] }),
          port.replaceBinding({ ...input, permissions: ['mail.send'] }),
        ]);
        const stored = await withWorkspaceTransaction(
          db,
          { workspaceId: DELEGATION_WORKSPACE, userId: DELEGATION_OWNER, role: 'owner' },
          async (trx) => {
            const rows = await trx
              .selectFrom('mail_acl_bindings')
              .innerJoin('mail_acl_binding_permissions', 'mail_acl_binding_permissions.binding_id', 'mail_acl_bindings.id')
              .select(['mail_acl_bindings.id', 'mail_acl_binding_permissions.permission_key'])
              .where('mail_acl_bindings.subject_id', '=', DELEGATION_CONCURRENT_TARGET)
              .where('mail_acl_bindings.resource_type', '=', 'account')
              .where('mail_acl_bindings.account_id', '=', DELEGATION_UNMANAGED_ACCOUNT)
              .execute();
            return rows;
          },
        );

        expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
        expect(new Set(stored.map((row) => row.id)).size).toBe(1);
        expect([['mail.metadata.read'], ['mail.send']]).toContainEqual(stored.map((row) => row.permission_key));
      } finally {
        await client.query('DROP TRIGGER IF EXISTS task7_delay_parallel_binding_insert ON mail_acl_bindings');
        await client.query('DROP FUNCTION IF EXISTS task7_delay_parallel_binding_insert()');
        await db.destroy();
      }
    });

    test('resolves parallel patch and delete as serialized success or binding_not_found without throwing', async () => {
      const db = createApplicationDb({ maxConnections: 4 });
      const port = createPostgresMailDelegationPort({ db });
      const actor = { userId: DELEGATION_OWNER, isOwner: true, isAdmin: false };
      try {
        const created = await port.replaceBinding({
          workspaceId: DELEGATION_WORKSPACE,
          actor,
          subject: { type: 'user', id: DELEGATION_CONCURRENT_TARGET },
          resource: { type: 'folder', accountId: DELEGATION_UNMANAGED_ACCOUNT, folderId: DELEGATION_UNMANAGED_FOLDER },
          permissions: ['mail.metadata.read'],
        });
        expect(created.ok).toBe(true);
        if (!created.ok || !created.binding) return;

        const results = await Promise.allSettled([
          port.deleteBinding({
            workspaceId: DELEGATION_WORKSPACE,
            actor,
            bindingId: created.binding.id,
          }),
          port.replaceBindingById({
            workspaceId: DELEGATION_WORKSPACE,
            actor,
            bindingId: created.binding.id,
            permissions: ['mail.send'],
          }),
        ]);

        expect(results.every((result) => result.status === 'fulfilled')).toBe(true);
        const values = results.map((result) => result.status === 'fulfilled' ? result.value : null);
        expect(values[0]).toMatchObject({ ok: true });
        const patchValue = values[1];
        expect(
          typeof patchValue === 'object'
          && patchValue !== null
          && 'ok' in patchValue
          && ((patchValue as { ok: boolean }).ok || (patchValue as { code?: string }).code === 'binding_not_found'),
        ).toBe(true);
      } finally {
        await db.destroy();
      }
    });
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
    const helperIndexes = await client.query<{ index_name: string; relation: string | null }>(`
      SELECT index_name, to_regclass('public.' || index_name)::text AS relation
      FROM (VALUES
        ('users_workspace_id_unique_idx'),
        ('user_groups_workspace_id_unique_idx'),
        ('email_accounts_workspace_id_unique_idx'),
        ('email_folders_workspace_account_id_unique_idx'),
        ('email_messages_workspace_account_folder_id_unique_idx')
      ) AS helper_indexes(index_name)
      ORDER BY index_name
    `);
    expect(relations.rows[0]).toEqual({
      bindings: null,
      permissions: null,
      legacy: 'user_account_access',
      legacy_count: '3',
    });
    expect(helperIndexes.rows.every((index) => index.relation === null)).toBe(true);
  });
});
