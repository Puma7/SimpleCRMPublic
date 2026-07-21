import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { createRequire } from 'module';
import { createServer } from 'net';
import { PassThrough, Readable } from 'stream';
import { tmpdir } from 'os';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { Kysely, PostgresDialect, sql } from 'kysely';
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
  createPostgresEmailOutboundValidationPort,
  outboundReviewApprovedKey,
} from '../../packages/server/src/mail-compose-send';
import {
  createPostgresEmailFolderReadPort,
  createPostgresEmailMessageCategoryReadPort,
  createPostgresEmailThreadReadPort,
} from '../../packages/server/src/db/postgres-mail-metadata-read-ports';
import {
  createPostgresWorkflowDelayedJobReadPort,
  createPostgresWorkflowForwardDedupReadPort,
  createPostgresWorkflowMessageAppliedReadPort,
  createPostgresWorkflowRunReadPort,
  createPostgresWorkflowRunStepReadPort,
} from '../../packages/server/src/db/postgres-workflow-runtime-read-ports';
import { createPostgresEmailReportingPort } from '../../packages/server/src/db/postgres-email-reporting-port';
import { createPostgresEmailGdprExportPort } from '../../packages/server/src/mail-gdpr-export';
import type {
  MailAclBindingPermissionsTable,
  MailAclBindingsTable,
  ServerDatabase,
} from '../../packages/server/src/db/schema';
import { createPostgresMailAccessPort } from '../../packages/server/src/mail-access/postgres-mail-access-port';
import { createPostgresMailResourceLookupPort } from '../../packages/server/src/mail-access/postgres-mail-resource-lookup';
import { createPostgresMailDelegationPort } from '../../packages/server/src/mail-access/postgres-mail-delegation-port';
import {
  createPostgresMailAclRolloutLegacyPort,
  createPostgresMailAclRolloutStatePort,
} from '../../packages/server/src/mail-access/postgres-mail-acl-rollout-state-port';
import { MailAccessRolloutService } from '../../packages/server/src/mail-access/rollout-service';
import {
  MailAccessDeniedError,
  MailAccessService,
} from '../../packages/server/src/mail-access/service';
import type { MailSqlScope } from '../../packages/server/src/mail-access/types';
import { serverMigrations } from '../../packages/server/src/migrations';
import { withWorkspaceTransaction } from '../../packages/server/src/db/workspace-context';
import { verifyAuditHashChain, type AuditHashChainRow } from '../../packages/server/src/db/postgres-audit-port';
import { createPostgresWorkflowExecutionJobPort } from '../../packages/server/src/workflow-execution';
import { startScheduledSendTicker } from '../../packages/server/src/mail-scheduled-send';

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
const WORKSPACE_NEW_AFTER_ROLLOUT = '55555555-5555-4555-8555-555555555555';
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
const MIGRATION_0038_SOURCE_SHA256 = '3048f74add211b1f36b49b54baaf84d5f3a1d66fc6561e5614766f76c87600cd';

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

  async function ensureScheduledSendProvenanceSchema(): Promise<void> {
    const migration = serverMigrations.find((candidate) => candidate.id === '0040_scheduled_send_provenance');
    expect(migration).toBeDefined();
    await applyStatements(migration!.upSql);
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
    applicationName?: string;
    onPoolError?: (error: Error) => void;
  }> = {}): Kysely<ServerDatabase> {
    const pool = new Pool({
      host: '127.0.0.1',
      port: postgresPort,
      user: MIGRATION_ROLE,
      password: MIGRATION_ROLE_PASSWORD,
      database: 'postgres',
      max: options.maxConnections ?? 1,
      application_name: options.applicationName,
    });
    if (options.onPoolError) {
      pool.on('error', options.onPoolError);
      pool.on('connect', (connection) => connection.on('error', options.onPoolError));
    }
    return new Kysely<ServerDatabase>({
      dialect: new PostgresDialect({
        pool,
      }),
      log(event) {
        if (event.level === 'query') options.onQuery?.(event.query.sql);
      },
    });
  }

  function deferred<T>() {
    let resolve!: (value: T) => void;
    const promise = new Promise<T>((settle) => {
      resolve = settle;
    });
    return { promise, resolve };
  }

  async function waitForAdvisoryLockWaiters(minimum: number, description: string): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= 5_000) {
      const result = await client.query<{ waiting: string }>(`
        SELECT count(*)::text AS waiting
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND granted = false
      `);
      if (Number(result.rows[0]?.waiting ?? 0) >= minimum) return;
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
    }
    throw new Error(`Timed out waiting for ${description}`);
  }

  async function waitForBlockedApplication(applicationName: string, description: string): Promise<void> {
    const startedAt = Date.now();
    while (Date.now() - startedAt <= 5_000) {
      const result = await client.query<{ blocked: string }>(`
        SELECT count(*)::text AS blocked
        FROM pg_stat_activity
        WHERE application_name = $1
          AND cardinality(pg_blocking_pids(pid)) > 0
      `, [applicationName]);
      if (Number(result.rows[0]?.blocked ?? 0) > 0) return;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error(`Timed out waiting for ${description}`);
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
      SELECT id, 'mail.content.read'
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

  async function resolveContentScope(
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
      permission: 'mail.content.read',
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
        if (target.kind === 'canned_response') {
          // 8801 = account-scoped (ACCOUNT_A); 8802 = global/missing → [] (scope gate).
          if (target.id === 8801) return [{ type: 'account', accountId: String(ACCOUNT_A) }];
          return [];
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
        // A populated alias thread in ACCOUNT_A: a real merge absorbs a non-empty
        // thread, so an account-A delegate can authorize it. An empty resolution is
        // now denied for restricted callers (alias-planting guard), so the merge
        // fixture must resolve to a real message.
        if (target.kind === 'thread' && target.id === 'alias-thread') {
          return [{
            type: 'message',
            accountId: String(ACCOUNT_A),
            folderId: String(FOLDER_A),
            messageId: String(MESSAGE_A),
          }];
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
      const teardownMigrations = serverMigrations
        .filter((candidate) => candidate.id === '0038_mail_acl' || candidate.id === '0039_mail_acl_rollout')
        .reverse();
      if (!migrationDownApplied) {
        for (const migration of teardownMigrations) await applyStatements(migration.downSql);
      }
      await client.end();
    }
    if (adminClient) await adminClient.end();
    if (postgresProcess) {
      postgresProcess.stdin.write('stop\n');
      await new Promise<void>((resolve) => postgresProcess.once('exit', () => resolve()));
    }
    if (postgresDir) rmSync(postgresDir, { recursive: true, force: true });
  });

  test('keeps migration 0038 source unchanged and registers rollout separately as 0039', () => {
    const migrationIds = serverMigrations.map((migration) => migration.id);
    const mailAclMigrationIndex = migrationIds.indexOf('0038_mail_acl');
    const rolloutMigrationIndex = migrationIds.indexOf('0039_mail_acl_rollout');
    const source = readFileSync(join(__dirname, '..', '..', 'packages', 'server', 'src', 'migrations', '0038_mail_acl.ts'), 'utf8')
      .replace(/\r\n/g, '\n');
    const sourceHash = createHash('sha256').update(source).digest('hex');

    expect(sourceHash).toBe(MIGRATION_0038_SOURCE_SHA256);
    expect(mailAclMigrationIndex).toBeGreaterThan(0);
    expect(rolloutMigrationIndex).toBe(mailAclMigrationIndex + 1);
    expect(serverMigrations[mailAclMigrationIndex]?.upSql.join('\n')).not.toContain('mail_acl_rollout_state');
    expect(serverMigrations[rolloutMigrationIndex]?.upSql.join('\n')).toContain('mail_acl_rollout_state');
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

  test('requires content read for message-bearing workflow execute routes and preserves no-message execution', async () => {
    const dryRun = jest.fn(async (input: { messageId?: number }) => ({
      success: true,
      dryRun: true,
      workflowId: 701,
      messageId: input.messageId,
      status: 'ok',
      blocked: false,
      blockReason: null,
      log: ['condition:secret-body'],
    }));
    const enqueue = jest.fn(async () => undefined);
    const workflow = {
      id: 701,
      sourceSqliteId: -701,
      name: 'ACL workflow',
      triggerName: 'manual',
      enabled: true,
      priority: 1,
      definition: {},
      graph: {},
      cronExpr: null,
      scheduleAccountSourceSqliteId: null,
      scheduleAccountId: null,
      accountSourceSqliteId: null,
      accountId: null,
      overrideKey: null,
      executionMode: 'graph',
      engineVersion: 1,
      legacyCreatedByUserId: null,
      createdByUserId: null,
      createdAt: null,
      updatedAt: '2026-07-19T12:00:00.000Z',
    };
    const api = createServerApi(makeHttpPorts({
      grants: new Map([
        ['mail.metadata.read', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
      ]),
      overrides: {
        workflows: {
          async list() {
            return { items: [workflow], nextCursor: null };
          },
          async get(input) {
            return input.id === workflow.id ? workflow : null;
          },
        },
        emailMessages: {
          list: async () => ({ items: [], nextCursor: null }),
          get: async (input) => (input.id === MESSAGE_A ? makeMessageRecord(MESSAGE_A) : null),
        },
        workflowExecution: { dryRun },
        jobQueue: { enqueue },
      },
    }));
    const principal = { ...makePrincipal(), capabilities: ['workflows.manage'] };

    for (const [path, body] of [
      [`/api/v1/workflows/${workflow.id}/execute`, { messageId: MESSAGE_A, dryRun: true }],
      ['/api/v1/workflows/by-source/-701/execute', { messageId: MESSAGE_A, dryRun: true }],
      [`/api/v1/workflows/${workflow.id}/execute`, { messageId: MESSAGE_A, dryRun: false }],
      ['/api/v1/workflows/by-source/-701/execute', { messageId: MESSAGE_A, dryRun: false }],
    ] as const) {
      const denied = await api.handle({ method: 'POST', path, body, principal });
      expect(denied.status).toBe(404);
      expect((denied.body as any).error.code).toBe('mail_resource_not_found');
    }
    expect(dryRun).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();

    for (const [path, body] of [
      [`/api/v1/workflows/${workflow.id}/execute`, { messageId: null, dryRun: true }],
      [`/api/v1/workflows/${workflow.id}/execute`, { messageId: '', dryRun: true }],
      [`/api/v1/workflows/${workflow.id}/execute`, { messageId: 0, dryRun: false }],
      ['/api/v1/workflows/by-source/-701/execute', { messageId: 'not-a-number', dryRun: false }],
    ] as const) {
      const denied = await api.handle({ method: 'POST', path, body, principal });
      expect(denied.status).toBe(404);
      expect((denied.body as any).error.code).toBe('mail_resource_not_found');
    }
    expect(dryRun).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();

    const noMessageDryRun = await api.handle({
      method: 'POST',
      path: `/api/v1/workflows/${workflow.id}/execute`,
      body: { dryRun: true },
      principal,
    });
    const noMessageEnqueue = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/by-source/-701/execute',
      body: { dryRun: false },
      principal,
    });

    expect(noMessageDryRun.status).toBe(200);
    expect(noMessageEnqueue.status).toBe(202);
    expect(dryRun).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  test('reply draft generation requires both target draft-create and source content-read grants', async () => {
    const generate = jest.fn(async () => ({ success: true, text: 'Antwortentwurf' }));
    const baseOverrides: Partial<ServerApiPorts> = {
      aiReplySuggestions: {
        async get() {
          return null;
        },
        async ensure() {
          return undefined;
        },
        generate,
      },
    };
    const draftOnlyApi = createServerApi(makeHttpPorts({
      grants: new Map([
        ['mail.draft.create', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
      ]),
      overrides: baseOverrides,
    }));
    const contentOnlyApi = createServerApi(makeHttpPorts({
      grants: new Map([
        ['mail.content.read', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
      ]),
      overrides: baseOverrides,
    }));
    const bothApi = createServerApi(makeHttpPorts({
      grants: new Map([
        ['mail.draft.create', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
        ['mail.content.read', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
      ]),
      overrides: baseOverrides,
    }));

    const path = `/api/v1/email/messages/${MESSAGE_A}/reply-draft`;
    const draftOnly = await draftOnlyApi.handle({ method: 'POST', path, principal: makePrincipal(), body: {} });
    const contentOnly = await contentOnlyApi.handle({ method: 'POST', path, principal: makePrincipal(), body: {} });
    const both = await bothApi.handle({ method: 'POST', path, principal: makePrincipal(), body: {} });

    expect(draftOnly.status).toBe(404);
    expect(contentOnly.status).toBe(404);
    expect(both.status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(1);
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
    // Transmitting through the replacement account requires mail.send on it too,
    // not just mail.send_as (R10-3).
    attachmentAndSendAs.set('mail.send', [
      { resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null },
      { resourceType: 'account', accountId: ACCOUNT_A_OTHER, folderId: null, messageId: null },
    ]);
    // compose/send rewrites the stored draft from request content, so it also
    // requires mail.draft.edit on the draft (R9-3); grant it on the draft account.
    attachmentAndSendAs.set('mail.draft.edit', [
      { resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null },
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

  test('requires mail.draft.edit to send (send rewrites the stored draft)', async () => {
    const getMessage = jest.fn(async () => makeMessageRecord(MESSAGE_A));
    const send = jest.fn(async () => ({ ok: true as const, messageId: MESSAGE_A, accountId: ACCOUNT_A }));
    const sendBody = {
      accountId: ACCOUNT_A,
      draftMessageId: MESSAGE_A,
      subject: 'Rewritten',
      bodyText: 'Injected content',
      to: 'recipient@example.test',
    };

    // send + content, but NOT draft.edit → a custom send-only delegate cannot
    // rewrite another user's draft content at send time.
    const sendOnly = new Map<MailPermission, readonly import('../../packages/server/src/mail-access/types').MailAccessGrant[]>([
      ['mail.content.read', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
      ['mail.send', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
    ]);
    const sendOnlyApi = createServerApi(makeHttpPorts({
      grants: sendOnly,
      overrides: { emailMessages: { get: getMessage }, emailComposeSender: { send } },
    }));
    const denied = await sendOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/compose/send',
      principal: makePrincipal(),
      body: sendBody,
    });
    expect(denied.status).toBe(404);
    expect(send).not.toHaveBeenCalled();

    // Add draft.edit → the send is authorized.
    const sendAndEdit = new Map(sendOnly);
    sendAndEdit.set('mail.draft.edit', [
      { resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null },
    ]);
    const editApi = createServerApi(makeHttpPorts({
      grants: sendAndEdit,
      overrides: { emailMessages: { get: getMessage }, emailComposeSender: { send } },
    }));
    const allowed = await editApi.handle({
      method: 'POST',
      path: '/api/v1/email/compose/send',
      principal: makePrincipal(),
      body: sendBody,
    });
    expect(allowed.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('resolves account-scoped canned responses so their delegate can edit them', async () => {
    const update = jest.fn(async () => ({
      id: 8801,
      sourceSqliteId: 8801,
      title: 'Autosave',
      body: 'Body',
      accountSourceSqliteId: null,
      accountId: ACCOUNT_A,
      overrideKey: 'greeting',
      sortOrder: 0,
      createdAt: null,
      updatedAt: '2026-07-19T12:00:00.000Z',
    }));
    const patchBody = { title: 'Autosave' };
    const draftCreate = new Map<MailPermission, readonly import('../../packages/server/src/mail-access/types').MailAccessGrant[]>([
      ['mail.draft.create', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
    ]);
    const delegateApi = createServerApi(makeHttpPorts({
      grants: draftCreate,
      overrides: { emailCannedResponses: { update } as unknown as ServerApiPorts['emailCannedResponses'] },
    }));

    // 8801 is account-scoped to ACCOUNT_A; the account-level draft.create delegate
    // may autosave (PATCH) it.
    const allowed = await delegateApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/canned-responses/8801',
      principal: makePrincipal(),
      body: patchBody,
    });
    expect(allowed.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(1);

    // Without any grant the same PATCH is denied and the port never runs.
    const noGrantApi = createServerApi(makeHttpPorts({
      overrides: { emailCannedResponses: { update } as unknown as ServerApiPorts['emailCannedResponses'] },
    }));
    const denied = await noGrantApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/canned-responses/8801',
      principal: makePrincipal(),
      body: patchBody,
    });
    expect(denied.status).toBe(404);
    expect(update).toHaveBeenCalledTimes(1);

    // 8802 resolves to no account (global/missing) → the workspace-global scope
    // gate keeps the restricted-scope write owner/admin only.
    const globalDenied = await delegateApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/canned-responses/8802',
      principal: makePrincipal(),
      body: patchBody,
    });
    expect(globalDenied.status).toBe(404);
    expect(update).toHaveBeenCalledTimes(1);

    const globalAllowed = await delegateApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/canned-responses/8802',
      principal: makePrincipal('owner'),
      body: patchBody,
    });
    expect(globalAllowed.status).toBe(200);
    expect(update).toHaveBeenCalledTimes(2);
  });

  test('requires mail.send on the replacement account, not only mail.send_as', async () => {
    const send = jest.fn(async () => ({ ok: true as const, messageId: MESSAGE_A, accountId: ACCOUNT_A_OTHER }));
    const sendBody = {
      accountId: ACCOUNT_A_OTHER,
      draftMessageId: MESSAGE_A,
      subject: 'Cross-account',
      bodyText: 'Body',
      to: 'recipient@example.test',
    };
    // send + draft.edit on the draft account A, send_as on B — but NOT mail.send
    // on B. Transmitting through B's SMTP still requires mail.send on B.
    const grants = new Map<MailPermission, readonly import('../../packages/server/src/mail-access/types').MailAccessGrant[]>([
      ['mail.send', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
      ['mail.draft.edit', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
      ['mail.send_as', [{ resourceType: 'account', accountId: ACCOUNT_A_OTHER, folderId: null, messageId: null }]],
    ]);
    const api = createServerApi(makeHttpPorts({
      grants,
      overrides: { emailMessages: { get: async () => makeMessageRecord(MESSAGE_A) }, emailComposeSender: { send } },
    }));
    const denied = await api.handle({
      method: 'POST',
      path: '/api/v1/email/compose/send',
      principal: makePrincipal(),
      body: sendBody,
    });
    expect(denied.status).toBe(404);
    expect(send).not.toHaveBeenCalled();

    // Add mail.send on B → the cross-account send is authorized.
    const withSendB = new Map(grants);
    withSendB.set('mail.send', [
      { resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null },
      { resourceType: 'account', accountId: ACCOUNT_A_OTHER, folderId: null, messageId: null },
    ]);
    const allowedApi = createServerApi(makeHttpPorts({
      grants: withSendB,
      overrides: { emailMessages: { get: async () => makeMessageRecord(MESSAGE_A) }, emailComposeSender: { send } },
    }));
    const allowed = await allowedApi.handle({
      method: 'POST',
      path: '/api/v1/email/compose/send',
      principal: makePrincipal(),
      body: sendBody,
    });
    expect(allowed.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
  });

  test('classifies the decrypted PGP attachment name for the suspicious-download grant', async () => {
    const attachmentRecord = (filename: string) => ({
      get: async () => ({
        id: 701,
        sourceSqliteId: 701,
        messageSourceSqliteId: Number(MESSAGE_A),
        messageId: MESSAGE_A,
        filename,
        contentType: 'application/octet-stream',
        sizeBytes: 10,
        contentSha256: null,
        updatedAt: '2026-07-19T12:00:00.000Z',
      }),
    });
    const attachmentReadOnly = new Map<MailPermission, readonly import('../../packages/server/src/mail-access/types').MailAccessGrant[]>([
      ['mail.attachment.read', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
    ]);

    // invoice.exe.pgp decrypts to invoice.exe — dangerous → suspicious_download
    // required. Without it, the enforcer denies before the decrypt handler runs.
    const dangerousApi = createServerApi(makeHttpPorts({
      grants: attachmentReadOnly,
      overrides: { emailAttachments: attachmentRecord('invoice.exe.pgp') as unknown as ServerApiPorts['emailAttachments'] },
    }));
    const dangerousDenied = await dangerousApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/attachments/701/decrypt',
      principal: makePrincipal(),
      body: {},
    });
    expect(dangerousDenied).toMatchObject({ status: 404, body: { error: { code: 'mail_resource_not_found' } } });

    // notes.txt.pgp decrypts to notes.txt — safe → attachment.read alone suffices,
    // so the enforcer passes and the handler is reached (503, no pgp port wired).
    const safeApi = createServerApi(makeHttpPorts({
      grants: attachmentReadOnly,
      overrides: { emailAttachments: attachmentRecord('notes.txt.pgp') as unknown as ServerApiPorts['emailAttachments'] },
    }));
    const safePassed = await safeApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/attachments/701/decrypt',
      principal: makePrincipal(),
      body: {},
    });
    expect(safePassed.status).toBe(503);

    // Dangerous decrypted name WITH the grant → the enforcer passes too.
    const grantedApi = createServerApi(makeHttpPorts({
      grants: new Map(attachmentReadOnly).set('mail.attachment.suspicious_download', [
        { resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null },
      ]),
      overrides: { emailAttachments: attachmentRecord('invoice.exe.pgp') as unknown as ServerApiPorts['emailAttachments'] },
    }));
    const grantedPassed = await grantedApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/attachments/701/decrypt',
      principal: makePrincipal(),
      body: {},
    });
    expect(grantedPassed.status).toBe(503);
  });

  test('requires mail.attachment.read to export raw EML', async () => {
    const getRawHeaders = jest.fn(async () => ({
      rawEml: 'From: a@example.test\r\n\r\nbody',
      emlSource: 'original' as const,
      rawHeaders: 'From: a@example.test',
      messageIdHeader: '<msg@example.test>',
      fromJson: null,
    }));
    const contentOnly = new Map<MailPermission, readonly import('../../packages/server/src/mail-access/types').MailAccessGrant[]>([
      ['mail.content.read', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
    ]);
    const contentApi = createServerApi(makeHttpPorts({
      grants: contentOnly,
      overrides: { emailMessages: { getRawHeaders } as unknown as ServerApiPorts['emailMessages'] },
    }));
    const denied = await contentApi.handle({
      method: 'GET',
      path: `/api/v1/email/messages/${MESSAGE_A}/raw-headers`,
      principal: makePrincipal(),
    });
    expect(denied.status).toBe(404);
    expect(getRawHeaders).not.toHaveBeenCalled();

    const withAttachment = new Map(contentOnly);
    withAttachment.set('mail.attachment.read', [
      { resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null },
    ]);
    const attachmentApi = createServerApi(makeHttpPorts({
      grants: withAttachment,
      overrides: { emailMessages: { getRawHeaders } as unknown as ServerApiPorts['emailMessages'] },
    }));
    const allowed = await attachmentApi.handle({
      method: 'GET',
      path: `/api/v1/email/messages/${MESSAGE_A}/raw-headers`,
      principal: makePrincipal(),
    });
    expect(allowed.status).toBe(200);
    expect(getRawHeaders).toHaveBeenCalledTimes(1);
  });

  test('requires owner/admin to remember a remote-content sender/domain', async () => {
    const setRemoteContentPolicy = jest.fn(async () => ({
      ok: true as const,
      result: { policy: 'allowed_once' as const, allowRemote: true },
      message: makeMessageRecord(MESSAGE_A),
    }));
    const withManage = new Map<MailPermission, readonly import('../../packages/server/src/mail-access/types').MailAccessGrant[]>([
      ['mail.triage', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
      ['mail.account.manage', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
    ]);
    const manageApi = createServerApi(makeHttpPorts({
      grants: withManage,
      overrides: { emailMessages: { setRemoteContentPolicy } as unknown as ServerApiPorts['emailMessages'] },
    }));

    // A plain per-message decision (no remember) stays pure triage.
    const plainAllowed = await manageApi.handle({
      method: 'PATCH',
      path: `/api/v1/email/messages/${MESSAGE_A}/remote-content-policy`,
      principal: makePrincipal(),
      body: { policy: 'allowed_once' },
    });
    expect(plainAllowed.status).toBe(200);
    expect(setRemoteContentPolicy).toHaveBeenCalledTimes(1);

    // rememberSender/rememberDomain persist a workspace-wide allowlist row that governs
    // remote content for EVERY account, so an account-scoped mail.account.manage
    // delegate must NOT be able to set them — only owner/admin may.
    const rememberDeniedScoped = await manageApi.handle({
      method: 'PATCH',
      path: `/api/v1/email/messages/${MESSAGE_A}/remote-content-policy`,
      principal: makePrincipal(),
      body: { policy: 'allowed_sender', rememberSender: true },
    });
    expect(rememberDeniedScoped.status).toBe(404);
    expect(setRemoteContentPolicy).toHaveBeenCalledTimes(1);

    // An owner/admin (full-workspace authority) may set the remember flags.
    const adminRemember = await manageApi.handle({
      method: 'PATCH',
      path: `/api/v1/email/messages/${MESSAGE_A}/remote-content-policy`,
      principal: makePrincipal('admin'),
      body: { policy: 'allowed_domain', rememberDomain: true },
    });
    expect(adminRemember.status).toBe(200);
    expect(setRemoteContentPolicy).toHaveBeenCalledTimes(2);
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

  test('requires mail.account.manage to test a stored account by id', async () => {
    const testImap = jest.fn(async () => ({ success: true as const }));
    const storedAccountBody = {
      accountId: ACCOUNT_A,
      imapHost: 'imap.example.test',
      imapPort: 993,
      imapTls: true,
      imapUsername: 'user',
      imapPassword: '',
    };

    // No account.manage grant → the stored-account test is denied (404, not 403,
    // so it can't be used as an existence probe) and the port never runs.
    const deniedApi = createServerApi(makeHttpPorts({
      overrides: { mailConnectionTests: { testImap, async testPop3() { return { success: true }; }, async testSmtp() { return { success: true }; } } },
    }));
    const denied = await deniedApi.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/test-imap',
      principal: makePrincipal(),
      body: storedAccountBody,
    });
    expect(denied.status).toBe(404);
    expect(testImap).not.toHaveBeenCalled();

    // With account.manage on the account, the stored-account test is allowed.
    const manageGrant = new Map<MailPermission, readonly import('../../packages/server/src/mail-access/types').MailAccessGrant[]>([
      ['mail.account.manage', [{ resourceType: 'account', accountId: ACCOUNT_A, folderId: null, messageId: null }]],
    ]);
    const allowedApi = createServerApi(makeHttpPorts({
      grants: manageGrant,
      overrides: { mailConnectionTests: { testImap, async testPop3() { return { success: true }; }, async testSmtp() { return { success: true }; } } },
    }));
    const allowed = await allowedApi.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/test-imap',
      principal: makePrincipal(),
      body: storedAccountBody,
    });
    expect(allowed.status).toBe(200);
    expect(testImap).toHaveBeenCalledTimes(1);

    // Owner bypasses the grant map (workspace binding), so a stored-account test
    // still works for owners/admins the same as ad-hoc credential tests.
    const ownerAllowed = await deniedApi.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/test-imap',
      principal: makePrincipal('owner'),
      body: storedAccountBody,
    });
    expect(ownerAllowed.status).toBe(200);
    expect(testImap).toHaveBeenCalledTimes(2);
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

  test('gates body-derived search matches by the content scope', async () => {
    await ensureScopedGrantFixtures();
    const db = createApplicationDb();
    try {
      // A body term present only in MESSAGE_A_SECOND (FOLDER_A_SECOND), absent
      // from its subject "Hidden alpha".
      await client.query(`UPDATE email_messages SET body_text = 'zzsecretbody' WHERE workspace_id = '${WORKSPACE_A}' AND id = ${MESSAGE_A_SECOND}`);
      const port = createPostgresEmailMessageReadPort({ db });
      // Metadata scope spans the whole account; the narrow content scope covers
      // only FOLDER_A, so MESSAGE_A_SECOND is metadata-visible but content-redacted.
      const metadataScope: MailSqlScope = { kind: 'restricted', accountIds: [ACCOUNT_A], folderIds: [], messageIds: [] };
      const contentNarrow: MailSqlScope = { kind: 'restricted', accountIds: [], folderIds: [FOLDER_A], messageIds: [] };
      const contentWide: MailSqlScope = { kind: 'restricted', accountIds: [ACCOUNT_A], folderIds: [], messageIds: [] };

      const bodyRedacted = await port.list({
        ...withMailScope({ workspaceId: WORKSPACE_A, search: '/zzsecretbody/', limit: 10 }, metadataScope),
        mailContentScope: contentNarrow,
      });
      const bodyAuthorized = await port.list({
        ...withMailScope({ workspaceId: WORKSPACE_A, search: '/zzsecretbody/', limit: 10 }, metadataScope),
        mailContentScope: contentWide,
      });
      const subjectStillMatches = await port.list({
        ...withMailScope({ workspaceId: WORKSPACE_A, search: '/Hidden/', limit: 10 }, metadataScope),
        mailContentScope: contentNarrow,
      });

      // The body-only match is suppressed for a content-redacted row — a
      // metadata-only delegate cannot probe hidden body text via search...
      expect(bodyRedacted.items.map((item) => item.id)).toEqual([]);
      // ...but a content-authorized caller still matches it.
      expect(bodyAuthorized.items.map((item) => item.id)).toEqual([MESSAGE_A_SECOND]);
      // Subject (metadata) search stays unaffected by content redaction.
      expect(subjectStillMatches.items.map((item) => item.id)).toEqual([MESSAGE_A_SECOND]);
    } finally {
      await client.query(`UPDATE email_messages SET body_text = NULL WHERE workspace_id = '${WORKSPACE_A}' AND id = ${MESSAGE_A_SECOND}`).catch(() => undefined);
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
          WHEN id = ${MESSAGE_A} THEN '2099-07-20T12:00:00Z'::timestamptz
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

  test('claimed scheduled-send draft rejects before outbound validation side effects', async () => {
    await ensureScheduledSendProvenanceSchema();
    const db = createApplicationDb();
    const draftId = 88101;
    const claimedKey = `scheduled_send_claimed_at:${draftId}`;
    const approvalKey = outboundReviewApprovedKey(draftId);
    const validationCalls: unknown[] = [];
    try {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`
        INSERT INTO email_messages (
          id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
          account_id, folder_id, uid, subject, body_text, to_json, folder_kind,
          scheduled_send_at, scheduled_send_actor_user_id, scheduled_send_trusted_service_principal
        ) VALUES (
          ${draftId}, '${WORKSPACE_A}', ${draftId}, 1, 11,
          ${ACCOUNT_A}, ${FOLDER_A}, -${draftId}, 'Original claimed draft', 'Plain body',
          '{"value":[{"address":"kunde@example.test"}]}'::jsonb, 'draft',
          NULL, '${USER_SEND}', NULL
        )
      `);
      await client.query(`
        INSERT INTO sync_info (workspace_id, key, value, source_row)
        VALUES ('${WORKSPACE_A}', '${claimedKey}', '2026-08-01T10:00:00.000Z', '{}'::jsonb)
      `);
      await client.query(`RESET app.role; RESET app.cross_workspace_access`);

      const port = createPostgresEmailMessageReadPort({
        db,
        outboundValidation: {
          async validate(input) {
            validationCalls.push(input);
            await client.query(`
              UPDATE email_messages
              SET subject = 'validation side effect'
              WHERE workspace_id = '${WORKSPACE_A}' AND id = ${draftId}
            `);
            await client.query(`
              INSERT INTO sync_info (workspace_id, key, value, source_row)
              VALUES ('${WORKSPACE_A}', '${approvalKey}', 'validation-side-effect', '{}'::jsonb)
            `);
            return { allowed: true as const, reason: null, manualApprovalPersistenceRequired: true };
          },
        },
      });

      const result = await port.scheduleDraftSend?.({
        workspaceId: WORKSPACE_A,
        actorUserId: USER_SEND,
        messageId: draftId,
        sendAt: '2026-08-02T10:00:00.000Z',
      });
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      const row = await client.query<{
        subject: string;
        scheduled_send_at: Date | null;
        scheduled_send_actor_user_id: string | null;
      }>(`
        SELECT subject, scheduled_send_at, scheduled_send_actor_user_id
        FROM email_messages
        WHERE workspace_id = '${WORKSPACE_A}' AND id = ${draftId}
      `);
      const approval = await client.query(`
        SELECT value FROM sync_info
        WHERE workspace_id = '${WORKSPACE_A}' AND key = '${approvalKey}'
      `);

      expect(result).toMatchObject({ ok: false, reason: 'scheduled_send_claimed' });
      expect(validationCalls).toEqual([]);
      expect(row.rows).toEqual([{
        subject: 'Original claimed draft',
        scheduled_send_at: null,
        scheduled_send_actor_user_id: USER_SEND,
      }]);
      expect(approval.rows).toEqual([]);
    } finally {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`DELETE FROM sync_info WHERE workspace_id = '${WORKSPACE_A}' AND key IN ('${claimedKey}', '${approvalKey}')`).catch(() => undefined);
      await client.query(`DELETE FROM email_messages WHERE workspace_id = '${WORKSPACE_A}' AND id = ${draftId}`).catch(() => undefined);
      await client.query(`RESET app.role; RESET app.cross_workspace_access`).catch(() => undefined);
      await db.destroy();
    }
  });

  test('scheduled-send ticker discovers due drafts through forced RLS', async () => {
    await ensureScheduledSendProvenanceSchema();
    const db = createApplicationDb();
    const draftId = 88104;
    const warnings: unknown[] = [];
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
      warnings.push(args);
    });
    let runtime: ReturnType<typeof startScheduledSendTicker> | undefined;
    try {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`
        INSERT INTO email_messages (
          id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
          account_id, folder_id, uid, subject, body_text, to_json, folder_kind,
          scheduled_send_at, scheduled_send_actor_user_id, scheduled_send_trusted_service_principal
        ) VALUES (
          ${draftId}, '${WORKSPACE_A}', ${draftId}, 1, 11,
          ${ACCOUNT_A}, ${FOLDER_A}, -${draftId}, 'Due after restart', 'Plain body',
          '{"value":[{"address":"kunde@example.test"}]}'::jsonb, 'draft',
          NOW() - INTERVAL '1 minute', '${USER_SEND}', NULL
        )
      `);
      await client.query(`RESET app.role; RESET app.cross_workspace_access`);

      runtime = startScheduledSendTicker({
        db,
        pollIntervalMs: 60_000,
        composeSender: {
          async send(input) {
            return { ok: true as const, messageId: input.values.draftMessageId, accountId: input.values.accountId };
          },
        },
        auth: {
          async listUsers() {
            return [{ id: USER_SEND, role: 'user' as const, disabledAt: null }];
          },
        },
        mailResourceLookup: {
          async resolve() {
            return [{ type: 'message', accountId: String(ACCOUNT_A), folderId: String(FOLDER_A), messageId: String(draftId) }];
          },
        },
        mailAccess: {
          async assertPermission() {
            throw new Error('mail_access_denied');
          },
          async resolveScope() {
            return { kind: 'none' as const };
          },
        },
      });
      for (let attempt = 0; attempt < 100 && warnings.length === 0; attempt += 1) {
        await new Promise((resolveDone) => setTimeout(resolveDone, 20));
      }

      expect(String(warnings[0]?.[0] ?? '')).toContain(`scheduled send ticker workspace ${WORKSPACE_A} draft ${draftId}: authorization denied`);
    } finally {
      runtime?.stop();
      warnSpy.mockRestore();
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`DELETE FROM email_messages WHERE workspace_id = '${WORKSPACE_A}' AND id = ${draftId}`).catch(() => undefined);
      await client.query(`RESET app.role; RESET app.cross_workspace_access`).catch(() => undefined);
      await db.destroy();
    }
  });

  test('claimed scheduled-send drafts reject edit and delete mutations', async () => {
    await ensureScheduledSendProvenanceSchema();
    const db = createApplicationDb();
    const draftIds = [88105, 88106, 88107] as const;
    try {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      for (const draftId of draftIds) {
        await client.query(`
          INSERT INTO email_messages (
            id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
            account_id, folder_id, uid, subject, body_text, folder_kind,
            scheduled_send_at, scheduled_send_actor_user_id
          ) VALUES (
            ${draftId}, '${WORKSPACE_A}', ${draftId}, 1, 11,
            ${ACCOUNT_A}, ${FOLDER_A}, -${draftId}, 'Claimed ${draftId}', 'Plain body', 'draft',
            NULL, '${USER_SEND}'
          )
        `);
        await client.query(`
          INSERT INTO sync_info (workspace_id, key, value, source_row)
          VALUES ('${WORKSPACE_A}', 'scheduled_send_claimed_at:${draftId}', '2026-08-01T10:00:00.000Z', '{}'::jsonb)
        `);
      }
      await client.query(`RESET app.role; RESET app.cross_workspace_access`);

      const port = createPostgresEmailMessageReadPort({ db });
      const updated = await port.updateComposeDraft?.({
        workspaceId: WORKSPACE_A,
        messageId: draftIds[0],
        values: { subject: 'Mutated after claim' },
      });
      const bulkDeleted = await port.bulkDeleteLocalDrafts?.({
        workspaceId: WORKSPACE_A,
        messageIds: [draftIds[1]],
      });
      const deleted = await port.deleteLocalDraft?.({
        workspaceId: WORKSPACE_A,
        messageId: draftIds[2],
      });

      expect(updated).toMatchObject({ ok: false, reason: 'scheduled_send_claimed' });
      expect(bulkDeleted).toMatchObject({ ok: false, reason: 'scheduled_send_claimed' });
      expect(deleted).toMatchObject({ ok: false, reason: 'scheduled_send_claimed' });

      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      const rows = await client.query<{ id: string; subject: string }>(`
        SELECT id::text, subject
        FROM email_messages
        WHERE workspace_id = '${WORKSPACE_A}' AND id IN (${draftIds.join(', ')})
        ORDER BY id
      `);
      expect(rows.rows).toEqual(draftIds.map((id) => ({ id: String(id), subject: `Claimed ${id}` })));
    } finally {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`DELETE FROM sync_info WHERE workspace_id = '${WORKSPACE_A}' AND key IN (${draftIds.map((id) => `'scheduled_send_claimed_at:${id}'`).join(', ')})`).catch(() => undefined);
      await client.query(`DELETE FROM email_messages WHERE workspace_id = '${WORKSPACE_A}' AND id IN (${draftIds.join(', ')})`).catch(() => undefined);
      await client.query(`RESET app.role; RESET app.cross_workspace_access`).catch(() => undefined);
      await db.destroy();
    }
  });

  test('editing an unclaimed pending scheduled draft invalidates its pending send', async () => {
    await ensureScheduledSendProvenanceSchema();
    const db = createApplicationDb();
    const draftId = 88108;
    try {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      // A draft scheduled by USER_SEND that the ticker has NOT yet claimed (no
      // scheduled_send_claimed_at row), so it is still editable.
      await client.query(`
        INSERT INTO email_messages (
          id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
          account_id, folder_id, uid, subject, body_text, folder_kind,
          scheduled_send_at, scheduled_send_actor_user_id
        ) VALUES (
          ${draftId}, '${WORKSPACE_A}', ${draftId}, 1, 11,
          ${ACCOUNT_A}, ${FOLDER_A}, -${draftId}, 'Scheduled by sender', 'Plain body', 'draft',
          '2026-08-01T10:00:00.000Z', '${USER_SEND}'
        )
      `);
      await client.query(`RESET app.role; RESET app.cross_workspace_access`);

      const port = createPostgresEmailMessageReadPort({ db });
      // An editor (mail.draft.edit, no mail.send) can rewrite content; the edit
      // succeeds, but the pending send must be invalidated so the ticker cannot
      // later transmit the editor's content under the scheduler's provenance.
      const updated = await port.updateComposeDraft?.({
        workspaceId: WORKSPACE_A,
        messageId: draftId,
        values: { subject: 'Rewritten by editor' },
      });
      expect(updated).toMatchObject({ ok: true });

      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      const rows = await client.query<{ subject: string; scheduled_send_at: string | null; scheduled_send_actor_user_id: string | null }>(`
        SELECT subject, scheduled_send_at, scheduled_send_actor_user_id
        FROM email_messages
        WHERE workspace_id = '${WORKSPACE_A}' AND id = ${draftId}
      `);
      expect(rows.rows[0]?.subject).toBe('Rewritten by editor');
      expect(rows.rows[0]?.scheduled_send_at).toBeNull();
      expect(rows.rows[0]?.scheduled_send_actor_user_id).toBeNull();
    } finally {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`DELETE FROM email_messages WHERE workspace_id = '${WORKSPACE_A}' AND id = ${draftId}`).catch(() => undefined);
      await client.query(`RESET app.role; RESET app.cross_workspace_access`).catch(() => undefined);
      await db.destroy();
    }
  });

  test('scheduled-send approval validates non-persistently then persists with schedule atomically', async () => {
    await ensureScheduledSendProvenanceSchema();
    const db = createApplicationDb({ maxConnections: 2 });
    const draftId = 88102;
    const workflowId = 88103;
    const approvalKey = outboundReviewApprovedKey(draftId);
    const validationCalls: unknown[] = [];
    const workflowDryRuns: unknown[] = [];
    try {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES (
          ${workflowId}, '${WORKSPACE_A}', ${workflowId}, 'Outbound schedule approval', 'outbound', true, 1,
          '{}'::jsonb, '{}'::jsonb, 'graph', 1
        )
      `);
      await client.query(`
        INSERT INTO email_messages (
          id, workspace_id, source_sqlite_id, account_source_sqlite_id, folder_source_sqlite_id,
          account_id, folder_id, uid, subject, body_text, body_html, to_json, folder_kind,
          scheduled_send_at, scheduled_send_actor_user_id, scheduled_send_trusted_service_principal
        ) VALUES (
          ${draftId}, '${WORKSPACE_A}', ${draftId}, 1, 11,
          ${ACCOUNT_A}, ${FOLDER_A}, -${draftId}, 'Needs approval', 'Plain body', '<p>Plain body</p>',
          '{"value":[{"address":"kunde@example.test"}]}'::jsonb, 'draft',
          NULL, NULL, NULL
        )
      `);
      await client.query(`RESET app.role; RESET app.cross_workspace_access`);

      const realOutboundValidation = createPostgresEmailOutboundValidationPort({
        db,
        workflowDryRun: async (input) => {
          workflowDryRuns.push(input);
          return {
            success: true,
            dryRun: true,
            workflowId: Number(input.workflowId),
            messageId: input.messageId,
            status: 'ok',
            blocked: false,
          };
        },
      });
      const port = createPostgresEmailMessageReadPort({
        db,
        outboundValidation: {
          async validate(input) {
            validationCalls.push(input);
            return realOutboundValidation.validate(input);
          },
        },
      });
      const sendAt = '2026-08-02T12:00:00.000Z';

      const result = await port.scheduleDraftSend?.({
        workspaceId: WORKSPACE_A,
        actorUserId: USER_SEND,
        messageId: draftId,
        sendAt,
      });
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      const row = await client.query<{
        subject: string;
        scheduled_send_at: Date | null;
        scheduled_send_actor_user_id: string | null;
        outbound_hold: boolean;
        outbound_block_reason: string | null;
      }>(`
        SELECT subject, scheduled_send_at, scheduled_send_actor_user_id, outbound_hold, outbound_block_reason
        FROM email_messages
        WHERE workspace_id = '${WORKSPACE_A}' AND id = ${draftId}
      `);
      const approval = await client.query<{ value: string }>(`
        SELECT value FROM sync_info
        WHERE workspace_id = '${WORKSPACE_A}' AND key = '${approvalKey}'
      `);

      expect(result).toMatchObject({ ok: true });
      expect(validationCalls).toEqual([expect.objectContaining({
        workspaceId: WORKSPACE_A,
        actorUserId: USER_SEND,
        persistence: 'none',
        values: expect.objectContaining({
          messageId: draftId,
          subject: 'Needs approval',
          bodyText: 'Plain body',
          bodyHtml: '<p>Plain body</p>',
          to: 'kunde@example.test',
        }),
      })]);
      expect(workflowDryRuns).toEqual([expect.objectContaining({
        workspaceId: WORKSPACE_A,
        workflowId,
        messageId: draftId,
        triggerName: 'outbound',
        actorUserId: USER_SEND,
      })]);
      expect(row.rows).toHaveLength(1);
      expect(row.rows[0]).toMatchObject({
        scheduled_send_actor_user_id: USER_SEND,
        outbound_hold: false,
        outbound_block_reason: null,
      });
      expect(row.rows[0]?.scheduled_send_at?.toISOString()).toBe(sendAt);
      expect(row.rows[0]?.subject).toMatch(/Needs approval/);
      expect(approval.rows[0]?.value).toMatch(/^.+\|[0-9a-f]{32}$/);
    } finally {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`DELETE FROM sync_info WHERE workspace_id = '${WORKSPACE_A}' AND key = '${approvalKey}'`).catch(() => undefined);
      await client.query(`DELETE FROM email_messages WHERE workspace_id = '${WORKSPACE_A}' AND id = ${draftId}`).catch(() => undefined);
      await client.query(`DELETE FROM email_workflows WHERE workspace_id = '${WORKSPACE_A}' AND id = ${workflowId}`).catch(() => undefined);
      await client.query(`RESET app.role; RESET app.cross_workspace_access`).catch(() => undefined);
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

  test('scopes workflow runtime rows in PostgreSQL before exposing logs, context, destinations, or hidden pages', async () => {
    await ensureScopedGrantFixtures();
    const db = createApplicationDb();
    try {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES
          (7101, '${WORKSPACE_A}', 7101, 'Runtime ACL', 'manual', true, 1, '{}'::jsonb, '{}'::jsonb, 'graph', 1),
          (7102, '${WORKSPACE_B}', 7102, 'Runtime ACL B', 'manual', true, 1, '{}'::jsonb, '{}'::jsonb, 'graph', 1)
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        INSERT INTO email_workflow_runs (
          id, workspace_id, source_sqlite_id, workflow_source_sqlite_id, message_source_sqlite_id,
          workflow_id, message_id, direction, status, log_json, started_at
        ) VALUES
          (7301, '${WORKSPACE_A}', 7301, 7101, 31, 7101, ${MESSAGE_A}, 'inbound', 'ok', '{"log":"visible"}'::jsonb, '2026-07-19T12:00:00Z'),
          (7302, '${WORKSPACE_A}', 7302, 7101, 32, 7101, ${MESSAGE_A_SECOND}, 'inbound', 'ok', '{"log":"hidden"}'::jsonb, '2026-07-19T12:01:00Z'),
          (7303, '${WORKSPACE_A}', 7303, 7101, NULL, 7101, NULL, 'manual', 'ok', '{"log":"non-mail"}'::jsonb, '2026-07-19T12:02:00Z'),
          (7304, '${WORKSPACE_B}', 7304, 7102, 41, 7102, ${MESSAGE_B}, 'inbound', 'ok', '{"log":"workspace-b"}'::jsonb, '2026-07-19T12:03:00Z'),
          (7305, '${WORKSPACE_A}', 7305, 7101, 33, 7101, NULL, 'inbound', 'ok', '{"log":"orphan"}'::jsonb, '2026-07-19T12:04:00Z')
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        INSERT INTO email_workflow_run_steps (
          id, workspace_id, source_sqlite_id, run_source_sqlite_id, run_id, node_id,
          node_type, status, port, duration_ms, message, detail_json
        ) VALUES
          (7401, '${WORKSPACE_A}', 7401, 7301, 7301, 'visible-node', 'condition', 'ok', NULL, 1, 'visible', '{"detail":"visible-body"}'::jsonb),
          (7402, '${WORKSPACE_A}', 7402, 7302, 7302, 'hidden-node', 'condition', 'ok', NULL, 1, 'hidden', '{"detail":"hidden-body"}'::jsonb),
          (7403, '${WORKSPACE_A}', 7403, 7303, 7303, 'non-mail-node', 'condition', 'ok', NULL, 1, 'non-mail', '{"detail":"non-mail"}'::jsonb),
          (7404, '${WORKSPACE_A}', 7404, 7305, 7305, 'orphan-node', 'condition', 'ok', NULL, 1, 'orphan', '{"detail":"orphan-body"}'::jsonb)
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        INSERT INTO email_message_workflow_applied (
          id, workspace_id, source_sqlite_id, message_source_sqlite_id, workflow_source_sqlite_id,
          message_id, workflow_id, applied_at
        ) VALUES
          (7501, '${WORKSPACE_A}', 7501, 31, 7101, ${MESSAGE_A}, 7101, '2026-07-19T12:00:00Z'),
          (7502, '${WORKSPACE_A}', 7502, 32, 7101, ${MESSAGE_A_SECOND}, 7101, '2026-07-19T12:01:00Z')
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        INSERT INTO email_workflow_forward_dedup (
          id, workspace_id, source_sqlite_id, message_source_sqlite_id, workflow_source_sqlite_id,
          message_id, workflow_id, dest, created_at
        ) VALUES
          (7601, '${WORKSPACE_A}', 7601, 31, 7101, ${MESSAGE_A}, 7101, 'visible@example.test', '2026-07-19T12:00:00Z'),
          (7602, '${WORKSPACE_A}', 7602, 32, 7101, ${MESSAGE_A_SECOND}, 7101, 'hidden@example.test', '2026-07-19T12:01:00Z')
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        INSERT INTO workflow_delayed_jobs (
          id, workspace_id, source_sqlite_id, workflow_source_sqlite_id, message_source_sqlite_id,
          workflow_id, message_id, resume_node_id, execute_at, context_json, status
        ) VALUES
          (7701, '${WORKSPACE_A}', 7701, 7101, 31, 7101, ${MESSAGE_A}, 'visible-delay', '2026-07-20T12:00:00Z', '{"context":"visible-body"}'::jsonb, 'pending'),
          (7702, '${WORKSPACE_A}', 7702, 7101, 32, 7101, ${MESSAGE_A_SECOND}, 'hidden-delay', '2026-07-20T12:01:00Z', '{"context":"hidden-body"}'::jsonb, 'pending'),
          (7703, '${WORKSPACE_A}', 7703, 7101, NULL, 7101, NULL, 'non-mail-delay', '2026-07-20T12:02:00Z', '{"context":"non-mail"}'::jsonb, 'pending')
        ON CONFLICT DO NOTHING
      `);
      await client.query('RESET app.role; RESET app.cross_workspace_access');

      const noneScope = await resolveContentScope(db, USER_NONE);
      const folderScope = await resolveContentScope(db, USER_FOLDER);
      const runPort = createPostgresWorkflowRunReadPort({ db });
      const stepPort = createPostgresWorkflowRunStepReadPort({ db });
      const appliedPort = createPostgresWorkflowMessageAppliedReadPort({ db });
      const forwardPort = createPostgresWorkflowForwardDedupReadPort({ db });
      const delayedPort = createPostgresWorkflowDelayedJobReadPort({ db });

      const noneRuns = await runPort.list(withMailScope({ workspaceId: WORKSPACE_A, includeLog: true, limit: 10 }, noneScope));
      const folderRuns = await runPort.list(withMailScope({ workspaceId: WORKSPACE_A, includeLog: true, limit: 10 }, folderScope));
      const firstFolderPage = await runPort.list(withMailScope({ workspaceId: WORKSPACE_A, includeLog: false, limit: 1 }, folderScope));
      const hiddenRun = await runPort.get(withMailScope({ workspaceId: WORKSPACE_A, id: 7302, includeLog: true }, folderScope));
      const folderSteps = await stepPort.list(withMailScope({ workspaceId: WORKSPACE_A, includeDetail: true, limit: 10 }, folderScope));
      const noneSteps = await stepPort.list(withMailScope({ workspaceId: WORKSPACE_A, includeDetail: true, limit: 10 }, noneScope));
      const hiddenStep = await stepPort.get(withMailScope({ workspaceId: WORKSPACE_A, id: 7402, includeDetail: true }, folderScope));
      const appliedRows = await appliedPort.list(withMailScope({ workspaceId: WORKSPACE_A, limit: 10 }, folderScope));
      const hiddenApplied = await appliedPort.get(withMailScope({ workspaceId: WORKSPACE_A, id: 7502 }, folderScope));
      const forwardRows = await forwardPort.list(withMailScope({ workspaceId: WORKSPACE_A, limit: 10 }, folderScope));
      const hiddenForward = await forwardPort.get(withMailScope({ workspaceId: WORKSPACE_A, id: 7602 }, folderScope));
      const delayedRows = await delayedPort.list(withMailScope({ workspaceId: WORKSPACE_A, includeContext: true, limit: 10 }, folderScope));
      const hiddenDelayed = await delayedPort.get(withMailScope({ workspaceId: WORKSPACE_A, id: 7702, includeContext: true }, folderScope));

      expect(noneRuns.items.map((item) => item.id)).toEqual([7303]);
      expect(folderRuns.items.map((item) => item.id)).toEqual([7301, 7303]);
      expect(folderRuns.items.map((item) => item.log)).toEqual([{ log: 'visible' }, { log: 'non-mail' }]);
      expect(firstFolderPage.items.map((item) => item.id)).toEqual([7301]);
      expect(firstFolderPage.nextCursor).toBe(7301);
      expect(hiddenRun).toBeNull();
      expect(folderSteps.items.map((item) => item.id)).toEqual([7401, 7403]);
      expect(folderSteps.items.map((item) => item.detail)).toEqual([{ detail: 'visible-body' }, { detail: 'non-mail' }]);
      // A scope-'none' caller sees only the genuinely non-mail step. The orphaned
      // mail run 7305 (message deleted → message_id null, message_source_sqlite_id
      // still 33) must stay hidden — a single-column message_id-null test would
      // leak step 7404's node message/detail_json.
      expect(noneSteps.items.map((item) => item.id)).toEqual([7403]);
      expect(hiddenStep).toBeNull();
      expect(appliedRows.items.map((item) => item.id)).toEqual([7501]);
      expect(hiddenApplied).toBeNull();
      expect(forwardRows.items.map((item) => [item.id, item.dest])).toEqual([[7601, 'visible@example.test']]);
      expect(hiddenForward).toBeNull();
      expect(delayedRows.items.map((item) => [item.id, item.context])).toEqual([
        [7701, { context: 'visible-body' }],
        [7703, { context: 'non-mail' }],
      ]);
      expect(hiddenDelayed).toBeNull();
    } finally {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`).catch(() => undefined);
      await client.query(`DELETE FROM workflow_delayed_jobs WHERE workspace_id IN ('${WORKSPACE_A}', '${WORKSPACE_B}') AND id BETWEEN 7701 AND 7703`).catch(() => undefined);
      await client.query(`DELETE FROM email_workflow_forward_dedup WHERE workspace_id IN ('${WORKSPACE_A}', '${WORKSPACE_B}') AND id BETWEEN 7601 AND 7602`).catch(() => undefined);
      await client.query(`DELETE FROM email_message_workflow_applied WHERE workspace_id IN ('${WORKSPACE_A}', '${WORKSPACE_B}') AND id BETWEEN 7501 AND 7502`).catch(() => undefined);
      await client.query(`DELETE FROM email_workflow_run_steps WHERE workspace_id IN ('${WORKSPACE_A}', '${WORKSPACE_B}') AND id BETWEEN 7401 AND 7404`).catch(() => undefined);
      await client.query(`DELETE FROM email_workflow_runs WHERE workspace_id IN ('${WORKSPACE_A}', '${WORKSPACE_B}') AND id BETWEEN 7301 AND 7305`).catch(() => undefined);
      await client.query(`DELETE FROM email_workflows WHERE workspace_id IN ('${WORKSPACE_A}', '${WORKSPACE_B}') AND id BETWEEN 7101 AND 7102`).catch(() => undefined);
      await client.query('RESET app.role; RESET app.cross_workspace_access').catch(() => undefined);
      await db.destroy();
    }
  });

  test('authorizes delayed-job HTTP mutations in PostgreSQL before atomic row changes', async () => {
    await ensureScopedGrantFixtures();
    const db = createApplicationDb();
    try {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES
          (7201, '${WORKSPACE_A}', 7201, 'Mutation ACL', 'manual', true, 1, '{}'::jsonb, '{}'::jsonb, 'graph', 1),
          (7202, '${WORKSPACE_B}', 7202, 'Mutation ACL B', 'manual', true, 1, '{}'::jsonb, '{}'::jsonb, 'graph', 1)
        ON CONFLICT DO NOTHING
      `);
      await client.query(`
        INSERT INTO workflow_delayed_jobs (
          id, workspace_id, source_sqlite_id, workflow_source_sqlite_id, message_source_sqlite_id,
          workflow_id, message_id, resume_node_id, execute_at, context_json, status
        ) VALUES
          (7801, '${WORKSPACE_A}', 7801, 7201, 31, 7201, ${MESSAGE_A}, 'allowed', '2026-07-21T12:00:00Z', '{}'::jsonb, 'pending'),
          (7802, '${WORKSPACE_A}', 7802, 7201, 32, 7201, ${MESSAGE_A_SECOND}, 'hidden', '2026-07-21T12:01:00Z', '{}'::jsonb, 'pending'),
          (7803, '${WORKSPACE_A}', 7803, 7201, NULL, 7201, NULL, 'non-mail', '2026-07-21T12:02:00Z', '{}'::jsonb, 'pending'),
          (7804, '${WORKSPACE_B}', 7804, 7202, 41, 7202, ${MESSAGE_B}, 'cross-workspace', '2026-07-21T12:03:00Z', '{}'::jsonb, 'pending')
        ON CONFLICT DO NOTHING
      `);
      await client.query('RESET app.role; RESET app.cross_workspace_access');

      const mailAccess = new MailAccessService(createPostgresMailAccessPort({ db }));
      const resourceLookup = createPostgresMailResourceLookupPort({ db }) as ReturnType<typeof createPostgresMailResourceLookupPort> & {
        classifyWorkflowDelayedJob(input: { workspaceId: string; delayedJobId: number }): Promise<unknown>;
      };
      await expect(resourceLookup.classifyWorkflowDelayedJob({
        workspaceId: WORKSPACE_A,
        delayedJobId: 7801,
      })).resolves.toEqual({
        kind: 'message',
        resource: {
          type: 'message',
          accountId: String(ACCOUNT_A),
          folderId: String(FOLDER_A),
          messageId: String(MESSAGE_A),
        },
      });
      await expect(resourceLookup.classifyWorkflowDelayedJob({
        workspaceId: WORKSPACE_A,
        delayedJobId: 7803,
      })).resolves.toEqual({ kind: 'non_mail' });
      await expect(resourceLookup.classifyWorkflowDelayedJob({
        workspaceId: WORKSPACE_A,
        delayedJobId: 7804,
      })).resolves.toEqual({ kind: 'missing' });
      await expect(resourceLookup.classifyWorkflowDelayedJob({
        workspaceId: WORKSPACE_A,
        delayedJobId: 999999,
      })).resolves.toEqual({ kind: 'missing' });
      const api = createServerApi({
        auth: {} as ServerApiPorts['auth'],
        locks: {} as ServerApiPorts['locks'],
        mailAccess,
        mailResourceLookup: resourceLookup,
        workflowDelayedJobs: createPostgresWorkflowDelayedJobReadPort({ db }),
      });
      // Delayed-job PATCH/DELETE now additionally require the workflows.manage
      // capability; this test exercises the mail-ACL layer, so grant it to the
      // non-admin principals (owner bypasses via role).
      const user = { userId: USER_MESSAGE, workspaceId: WORKSPACE_A, role: 'user' as const, capabilities: ['workflows.manage'] };
      const noGrantUser = { userId: USER_NONE, workspaceId: WORKSPACE_A, role: 'user' as const, capabilities: ['workflows.manage'] };
      const owner = { userId: USER_CREATOR, workspaceId: WORKSPACE_A, role: 'owner' as const };
      const createBody = {
        workflowId: 7201,
        executeAt: '2026-07-22T12:00:00.000Z',
        status: 'pending',
      };

      const allowedCreate = await api.handle({
        method: 'POST', path: '/api/v1/workflow-delayed-jobs', principal: user,
        body: { ...createBody, messageId: MESSAGE_A },
      });
      const hiddenCreate = await api.handle({
        method: 'POST', path: '/api/v1/workflow-delayed-jobs', principal: user,
        body: { ...createBody, messageId: MESSAGE_A_SECOND },
      });
      const crossWorkspaceCreate = await api.handle({
        method: 'POST', path: '/api/v1/workflow-delayed-jobs', principal: user,
        body: { ...createBody, messageId: MESSAGE_B },
      });
      const absentCreate = await api.handle({
        method: 'POST', path: '/api/v1/workflow-delayed-jobs', principal: noGrantUser, body: createBody,
      });
      const nullCreate = await api.handle({
        method: 'POST', path: '/api/v1/workflow-delayed-jobs', principal: noGrantUser,
        body: { ...createBody, messageId: null },
      });
      for (const messageId of ['', 0, {}, false]) {
        const malformed = await api.handle({
          method: 'POST', path: '/api/v1/workflow-delayed-jobs', principal: user,
          body: { ...createBody, messageId },
        });
        expect(malformed.status).toBe(404);
      }

      expect(allowedCreate.status).toBe(201);
      expect(hiddenCreate.status).toBe(404);
      expect(crossWorkspaceCreate.status).toBe(404);
      expect(absentCreate.status).toBe(201);
      expect(nullCreate.status).toBe(201);

      const allowedPatch = await api.handle({
        method: 'PATCH', path: '/api/v1/workflow-delayed-jobs/7801', principal: user,
        body: { status: 'authorized-update' },
      });
      const hiddenReplacement = await api.handle({
        method: 'PATCH', path: '/api/v1/workflow-delayed-jobs/7801', principal: user,
        body: { messageId: MESSAGE_A_SECOND, status: 'must-not-commit' },
      });
      const hiddenCurrent = await api.handle({
        method: 'PATCH', path: '/api/v1/workflow-delayed-jobs/7802', principal: user,
        body: { messageId: MESSAGE_A, status: 'must-not-commit' },
      });
      const hiddenDelete = await api.handle({
        method: 'DELETE', path: '/api/v1/workflow-delayed-jobs/7802', principal: user,
      });
      const nonMailPatch = await api.handle({
        method: 'PATCH', path: '/api/v1/workflow-delayed-jobs/7803', principal: noGrantUser,
        body: { status: 'non-mail-update' },
      });
      const detach = await api.handle({
        method: 'PATCH', path: '/api/v1/workflow-delayed-jobs/7801', principal: user,
        body: { messageId: null },
      });
      const crossWorkspacePatch = await api.handle({
        method: 'PATCH', path: '/api/v1/workflow-delayed-jobs/7804', principal: owner,
        body: { status: 'must-not-commit' },
      });
      const ownerPatch = await api.handle({
        method: 'PATCH', path: '/api/v1/workflow-delayed-jobs/7802', principal: owner,
        body: { status: 'owner-update' },
      });

      expect(allowedPatch.status).toBe(200);
      expect(hiddenReplacement.status).toBe(404);
      expect(hiddenCurrent.status).toBe(404);
      expect(hiddenDelete.status).toBe(404);
      expect(nonMailPatch.status).toBe(200);
      expect(detach.status).toBe(200);
      expect(crossWorkspacePatch.status).toBe(404);
      expect(ownerPatch.status).toBe(200);

      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      const rows = await client.query<{ id: string; message_id: string | null; status: string }>(`
        SELECT id::text, message_id::text, status
        FROM workflow_delayed_jobs
        WHERE id IN (7801, 7802, 7803, 7804)
        ORDER BY id
      `);
      expect(rows.rows).toEqual([
        { id: '7801', message_id: null, status: 'authorized-update' },
        { id: '7802', message_id: String(MESSAGE_A_SECOND), status: 'owner-update' },
        { id: '7803', message_id: null, status: 'non-mail-update' },
        { id: '7804', message_id: String(MESSAGE_B), status: 'pending' },
      ]);

      const nonMailDelete = await api.handle({
        method: 'DELETE', path: '/api/v1/workflow-delayed-jobs/7803', principal: noGrantUser,
      });
      expect(nonMailDelete.status).toBe(200);
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      expect((await client.query<{ count: string }>(`SELECT count(*)::text AS count FROM workflow_delayed_jobs WHERE id = 7803`)).rows[0]?.count).toBe('0');
    } finally {
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`).catch(() => undefined);
      await client.query(`DELETE FROM workflow_delayed_jobs WHERE workflow_id IN (7201, 7202)`).catch(() => undefined);
      await client.query(`DELETE FROM email_workflows WHERE id IN (7201, 7202)`).catch(() => undefined);
      await client.query('RESET app.role; RESET app.cross_workspace_access').catch(() => undefined);
      await db.destroy();
    }
  });

  test('holds the delayed-job row lock from authorization through workflow completion', async () => {
    const workflowId = 7251;
    const delayedJobId = 7851;
    const advisoryLockKey = 7_251_851;
    const executionApplication = 'workflow-delayed-lock-execution';
    const patchApplication = 'workflow-delayed-lock-patch';
    const executionDb = createApplicationDb({ maxConnections: 1, applicationName: executionApplication });
    const patchDb = createApplicationDb({ maxConnections: 1, applicationName: patchApplication });
    const delayedPort = createPostgresWorkflowDelayedJobReadPort({ db: patchDb });
    const completionOrder: string[] = [];
    let advisoryLockHeld = false;
    let executionPromise: Promise<void> | undefined;
    let patchPromise: Promise<unknown> | undefined;
    try {
      const graph = {
        version: 1,
        nodes: [
          { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
          { id: 'tag-1', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'lock-race' } } },
        ],
        edges: [{ id: 'edge-1', source: 'trigger-1', target: 'tag-1' }],
      };
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`
        INSERT INTO email_workflows (
          id, workspace_id, source_sqlite_id, name, trigger_name, enabled, priority,
          definition_json, graph_json, execution_mode, engine_version
        ) VALUES ($1, $2, $1, 'Delayed lock race', 'manual', true, 1, '{}'::jsonb, $3::jsonb, 'graph', 1)
      `, [workflowId, WORKSPACE_A, JSON.stringify(graph)]);
      await client.query(`
        INSERT INTO workflow_delayed_jobs (
          id, workspace_id, source_sqlite_id, workflow_source_sqlite_id, message_source_sqlite_id,
          workflow_id, message_id, resume_node_id, execute_at, context_json, status
        ) VALUES ($1, $2, $1, $3, 31, $3, $4, 'tag-1', '2026-07-21T14:00:00Z', '{}'::jsonb, 'pending')
      `, [delayedJobId, WORKSPACE_A, workflowId, MESSAGE_A]);
      await client.query(`
        CREATE OR REPLACE FUNCTION workflow_delayed_execution_test_barrier()
        RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
          IF NEW.workflow_id = ${workflowId} THEN
            PERFORM pg_advisory_xact_lock(${advisoryLockKey});
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await client.query(`
        CREATE TRIGGER workflow_delayed_execution_test_barrier
        BEFORE INSERT ON email_workflow_runs
        FOR EACH ROW EXECUTE FUNCTION workflow_delayed_execution_test_barrier()
      `);
      await client.query('RESET app.role; RESET app.cross_workspace_access');
      await client.query('SELECT pg_advisory_lock($1)', [advisoryLockKey]);
      advisoryLockHeld = true;

      const executionPort = createPostgresWorkflowExecutionJobPort({ db: executionDb });
      executionPromise = executionPort.execute({
        workspaceId: WORKSPACE_A,
        workflowId,
        delayedJobId,
        authorizedDelayedJobMessageId: MESSAGE_A,
        triggerName: 'manual',
        context: {},
      }).then(() => {
        completionOrder.push('execution');
      });
      await waitForBlockedApplication(executionApplication, 'workflow execution to enter the pre-action barrier');

      patchPromise = delayedPort.update!({
        workspaceId: WORKSPACE_A,
        actorUserId: USER_CREATOR,
        id: delayedJobId,
        values: { messageId: MESSAGE_A_SECOND, status: 'relinked' },
        mailScope: { kind: 'all' },
      }).then((result) => {
        completionOrder.push('patch');
        return result;
      });
      await waitForBlockedApplication(patchApplication, 'delayed-job relink to wait for workflow execution');
      expect(completionOrder).toEqual([]);

      await client.query('SELECT pg_advisory_unlock($1)', [advisoryLockKey]);
      advisoryLockHeld = false;
      await executionPromise;
      await expect(patchPromise).resolves.toMatchObject({
        ok: true,
        job: { id: delayedJobId, messageId: MESSAGE_A_SECOND, status: 'relinked' },
      });
      expect(completionOrder).toEqual(['execution', 'patch']);

      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      const finalState = await client.query<{
        message_id: string | null;
        status: string;
        authorized_tags: string;
        hidden_tags: string;
      }>(`
        SELECT
          delayed.message_id::text,
          delayed.status,
          (SELECT count(*)::text FROM email_message_tags WHERE workspace_id = $1 AND message_id = $2 AND tag = 'lock-race') AS authorized_tags,
          (SELECT count(*)::text FROM email_message_tags WHERE workspace_id = $1 AND message_id = $3 AND tag = 'lock-race') AS hidden_tags
        FROM workflow_delayed_jobs AS delayed
        WHERE delayed.workspace_id = $1 AND delayed.id = $4
      `, [WORKSPACE_A, MESSAGE_A, MESSAGE_A_SECOND, delayedJobId]);
      expect(finalState.rows).toEqual([{
        message_id: String(MESSAGE_A_SECOND),
        status: 'relinked',
        authorized_tags: '1',
        hidden_tags: '0',
      }]);
    } finally {
      if (advisoryLockHeld) {
        await client.query('SELECT pg_advisory_unlock($1)', [advisoryLockKey]).catch(() => undefined);
      }
      await Promise.allSettled([
        ...(executionPromise ? [executionPromise] : []),
        ...(patchPromise ? [patchPromise] : []),
      ]);
      await client.query('DROP TRIGGER IF EXISTS workflow_delayed_execution_test_barrier ON email_workflow_runs').catch(() => undefined);
      await client.query('DROP FUNCTION IF EXISTS workflow_delayed_execution_test_barrier()').catch(() => undefined);
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`).catch(() => undefined);
      await client.query(`DELETE FROM email_message_tags WHERE workspace_id = '${WORKSPACE_A}' AND tag = 'lock-race'`).catch(() => undefined);
      await client.query(`DELETE FROM email_workflow_run_steps WHERE workspace_id = '${WORKSPACE_A}' AND run_id IN (SELECT id FROM email_workflow_runs WHERE workflow_id = ${workflowId})`).catch(() => undefined);
      await client.query(`DELETE FROM email_workflow_runs WHERE workspace_id = '${WORKSPACE_A}' AND workflow_id = ${workflowId}`).catch(() => undefined);
      await client.query(`DELETE FROM workflow_delayed_jobs WHERE workspace_id = '${WORKSPACE_A}' AND id = ${delayedJobId}`).catch(() => undefined);
      await client.query(`DELETE FROM email_workflows WHERE workspace_id = '${WORKSPACE_A}' AND id = ${workflowId}`).catch(() => undefined);
      await client.query('RESET app.role; RESET app.cross_workspace_access').catch(() => undefined);
      await executionDb.destroy();
      await patchDb.destroy();
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
      const accounts = JSON.parse(entries.get('accounts_redacted.json') ?? '[]') as Array<{ id: number; imap_host?: string; oauth_provider?: string | null }>;
      expect(messageLines.map((line) => (JSON.parse(line) as { id: number }).id)).toEqual([MESSAGE_A]);
      expect(accounts.map((account) => Number(account.id))).toEqual([ACCOUNT_A]);
      // ACCOUNT_A is reached only through the folder grant, so its connection
      // config must be redacted to identity-only (imap_host seeded as
      // 'imap.example.test' → '').
      expect(accounts[0]?.imap_host).toBe('');
      expect(accounts[0]?.oauth_provider).toBeNull();
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

  test('rollout migration creates RLS shadow state only for existing workspaces and missing rows default to enforce', async () => {
    const rolloutMigration = serverMigrations.find((candidate) => candidate.id === '0039_mail_acl_rollout');
    expect(rolloutMigration).toBeDefined();
    const workspacesBeforeRollout = await client.query<{ id: string }>('SELECT id FROM workspaces ORDER BY id');
    await applyStatementsInTransaction(rolloutMigration!.upSql);
    const db = createApplicationDb({ maxConnections: 2 });
    const port = createPostgresMailAclRolloutStatePort({ db });
    try {
      const existing = await Promise.all([
        port.getReadiness(WORKSPACE_A),
        port.getReadiness(WORKSPACE_B),
      ]);
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`
        INSERT INTO workspaces (id, name)
        VALUES ('${WORKSPACE_NEW_AFTER_ROLLOUT}', 'Workspace created after rollout')
        ON CONFLICT DO NOTHING
      `);
      await client.query('RESET app.role; RESET app.cross_workspace_access');
      const createdAfterRollout = await port.getReadiness(WORKSPACE_NEW_AFTER_ROLLOUT);
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      const storedRows = await client.query<{
        workspace_id: string;
        mode: string;
        in_flight: string;
        telemetry_healthy: boolean;
        diagnostic_code: string | null;
        diagnostic_at: Date | null;
      }>(`
        SELECT workspace_id, mode, in_flight::text, telemetry_healthy, diagnostic_code, diagnostic_at
        FROM mail_acl_rollout_state
        ORDER BY workspace_id
      `);
      await client.query('RESET app.role; RESET app.cross_workspace_access');

      expect(existing.map((row) => row.mode)).toEqual(['shadow', 'shadow']);
      expect(existing.every((row) => row.evaluated === 0n && row.ready === false && row.enforced === false)).toBe(true);
      expect(createdAfterRollout).toMatchObject({
        workspaceId: WORKSPACE_NEW_AFTER_ROLLOUT,
        mode: 'enforce',
        evaluated: 0n,
        legacyAllowNewDeny: 0n,
        legacyDenyNewAllow: 0n,
        notComparable: 0n,
        inFlight: 0n,
        ready: false,
        enforced: true,
        telemetryHealthy: true,
        diagnosticCode: null,
        diagnosticAt: null,
      });
      expect(storedRows.rows).toEqual(workspacesBeforeRollout.rows.map((row) => ({
        workspace_id: row.id,
        mode: 'shadow',
        in_flight: '0',
        telemetry_healthy: true,
        diagnostic_code: null,
        diagnostic_at: null,
      })));
      expect(storedRows.rows).not.toContainEqual(expect.objectContaining({
        workspace_id: WORKSPACE_NEW_AFTER_ROLLOUT,
        mode: 'shadow',
      }));
    } finally {
      await db.destroy();
    }
  });

  test('rollout state is workspace-isolated by FORCE RLS', async () => {
    const db = createApplicationDb({ maxConnections: 2 });
    try {
      const workspaceARows = await withWorkspaceTransaction(
        db,
        { workspaceId: WORKSPACE_A, userId: USER_READ, role: 'admin' },
        (trx) => trx
          .selectFrom('mail_acl_rollout_state')
          .select(['workspace_id', 'mode'])
          .execute(),
      );
      const workspaceBRows = await withWorkspaceTransaction(
        db,
        { workspaceId: WORKSPACE_B, userId: USER_WORKSPACE_B, role: 'admin' },
        (trx) => trx
          .selectFrom('mail_acl_rollout_state')
          .select(['workspace_id', 'mode'])
          .execute(),
      );
      const rls = await client.query<{ relrowsecurity: boolean; relforcerowsecurity: boolean }>(`
        SELECT relrowsecurity, relforcerowsecurity
        FROM pg_class
        WHERE relname = 'mail_acl_rollout_state'
      `);
      const policy = await client.query<{ qual: string; with_check: string }>(`
        SELECT qual, with_check
        FROM pg_policies
        WHERE schemaname = 'public'
          AND tablename = 'mail_acl_rollout_state'
          AND policyname = 'mail_acl_rollout_state_workspace_isolation'
      `);

      expect(workspaceARows).toEqual([{ workspace_id: WORKSPACE_A, mode: 'shadow' }]);
      expect(workspaceBRows).toEqual([{ workspace_id: WORKSPACE_B, mode: 'shadow' }]);
      expect(rls.rows).toEqual([{ relrowsecurity: true, relforcerowsecurity: true }]);
      expect(policy.rows[0]?.qual).toContain('app.can_access_workspace(workspace_id)');
      expect(policy.rows[0]?.with_check).toContain('app.can_access_workspace(workspace_id)');
    } finally {
      await db.destroy();
    }
  });

  test('rollout counter increments are atomic and stay workspace-scoped under concurrency', async () => {
    const db = createApplicationDb({ maxConnections: 8 });
    const port = createPostgresMailAclRolloutStatePort({ db });
    try {
      await port.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
      await port.resetShadowCounters({ workspaceId: WORKSPACE_B, actorUserId: USER_WORKSPACE_B });
      await Promise.all(Array.from({ length: 40 }, async (_, index) => {
        await port.increment(WORKSPACE_A, {
          evaluated: 1n,
          legacyAllowNewDeny: index % 2 === 0 ? 1n : 0n,
          legacyDenyNewAllow: index % 2 === 1 ? 1n : 0n,
        });
      }));
      await Promise.all(Array.from({ length: 13 }, async () => {
        await port.increment(WORKSPACE_B, { notComparable: 1n });
      }));

      const workspaceA = await port.getReadiness(WORKSPACE_A);
      const workspaceB = await port.getReadiness(WORKSPACE_B);

      expect(workspaceA).toMatchObject({
        evaluated: 40n,
        legacyAllowNewDeny: 20n,
        legacyDenyNewAllow: 20n,
        notComparable: 0n,
      });
      expect(workspaceB).toMatchObject({
        evaluated: 0n,
        legacyAllowNewDeny: 0n,
        legacyDenyNewAllow: 0n,
        notComparable: 13n,
      });
    } finally {
      await db.destroy();
    }
  });

  test('reset and enforce commit with exactly one hash-chained audit event or roll back together', async () => {
    const db = createApplicationDb({ maxConnections: 4 });
    const state = createPostgresMailAclRolloutStatePort({ db });
    const adminInput = { workspaceId: WORKSPACE_B, actorUserId: USER_WORKSPACE_B };
    const readAuditRows = async (): Promise<readonly AuditHashChainRow[]> => {
      await client.query(`SELECT set_config('app.workspace_id', '${WORKSPACE_B}', false), set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'off', false)`);
      const rows = await client.query<AuditHashChainRow>(`
        SELECT id, workspace_id, actor_user_id, action, entity_type, entity_id,
               metadata, previous_hash, event_hash, created_at
        FROM audit_events
        WHERE workspace_id = '${WORKSPACE_B}'
        ORDER BY id
      `);
      await client.query('RESET app.workspace_id; RESET app.role; RESET app.cross_workspace_access');
      return rows.rows;
    };
    const installAuditFailure = async (): Promise<void> => {
      await client.query(`
        CREATE OR REPLACE FUNCTION task8_fail_rollout_audit_insert()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.action IN ('mail_acl_rollout.counters_reset', 'mail_acl_rollout.enforced') THEN
            RAISE EXCEPTION 'task8 audit insert failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await client.query(`
        CREATE TRIGGER task8_fail_rollout_audit_insert
        BEFORE INSERT ON audit_events
        FOR EACH ROW EXECUTE FUNCTION task8_fail_rollout_audit_insert()
      `);
    };
    const removeAuditFailure = async (): Promise<void> => {
      await client.query('DROP TRIGGER IF EXISTS task8_fail_rollout_audit_insert ON audit_events');
      await client.query('DROP FUNCTION IF EXISTS task8_fail_rollout_audit_insert()');
    };
    try {
      await state.resetShadowCounters(adminInput);
      await state.increment(WORKSPACE_B, { evaluated: 3n, legacyAllowNewDeny: 1n });
      const beforeFailedReset = await state.getReadiness(WORKSPACE_B);
      const auditBeforeFailures = await readAuditRows();

      await installAuditFailure();
      await expect(state.resetShadowCounters(adminInput)).rejects.toThrow('task8 audit insert failure');
      await expect(state.getReadiness(WORKSPACE_B)).resolves.toEqual(beforeFailedReset);
      await expect(readAuditRows()).resolves.toHaveLength(auditBeforeFailures.length);
      await removeAuditFailure();

      await expect(state.resetShadowCounters(adminInput)).resolves.toEqual({ ok: true });
      await state.increment(WORKSPACE_B, { evaluated: 1n });
      await installAuditFailure();
      await expect(state.transitionToEnforce(adminInput)).rejects.toThrow('task8 audit insert failure');
      await expect(state.getReadiness(WORKSPACE_B)).resolves.toMatchObject({
        mode: 'shadow',
        evaluated: 1n,
      });
      await removeAuditFailure();

      const concurrent = await Promise.all([
        state.transitionToEnforce(adminInput),
        state.transitionToEnforce(adminInput),
      ]);
      expect(concurrent.filter((result) => result.ok)).toHaveLength(1);
      expect(concurrent.filter((result) => !result.ok)).toEqual([
        { ok: false, code: 'not_shadow' },
      ]);

      const auditAfterSuccess = await readAuditRows();
      const newEvents = auditAfterSuccess.slice(auditBeforeFailures.length);
      expect(newEvents.map((event) => event.action)).toEqual([
        'mail_acl_rollout.counters_reset',
        'mail_acl_rollout.enforced',
      ]);
      expect(newEvents.every((event) => event.actor_user_id === USER_WORKSPACE_B)).toBe(true);
      expect(verifyAuditHashChain(auditAfterSuccess)).toMatchObject({ ok: true });
    } finally {
      await removeAuditFailure().catch(() => undefined);
      await db.destroy();
    }
  });

  test('exclusive enforce waits for every earlier shared shadow evaluation and observes their mismatches', async () => {
    const evaluationDb = createApplicationDb({ maxConnections: 2, applicationName: 'task8-shadow-evaluation' });
    const adminDb = createApplicationDb({ maxConnections: 2, applicationName: 'task8-enforce-transition' });
    const evaluationState = createPostgresMailAclRolloutStatePort({ db: evaluationDb });
    const adminState = createPostgresMailAclRolloutStatePort({ db: adminDb });
    const allEvaluationsEntered = deferred<void>();
    const releases = [deferred<void>(), deferred<void>()];
    let entered = 0;
    const service = new MailAccessRolloutService({
      state: evaluationState,
      legacy: {
        async canAccessAccount() {
          const index = entered;
          entered += 1;
          if (entered === releases.length) allEvaluationsEntered.resolve(undefined);
          await releases[index]!.promise;
          return true;
        },
        async resolveAccountScope() { return [ACCOUNT_A]; },
      },
      newAcl: {
        async resolveGrants() { return []; },
      },
    });
    const request = {
      workspaceId: WORKSPACE_A,
      actor: {
        workspaceId: WORKSPACE_A,
        userId: USER_READ,
        isOwner: false,
        isAdmin: false,
      },
      permission: 'mail.content.read' as const,
      resource: {
        type: 'message' as const,
        accountId: String(ACCOUNT_A),
        folderId: String(FOLDER_A),
        messageId: String(MESSAGE_A),
      },
    };
    let evaluations: Array<Promise<void>> = [];
    let transition: Promise<Awaited<ReturnType<typeof adminState.transitionToEnforce>>> | undefined;
    try {
      await adminState.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
      evaluations = [service.assertPermission(request), service.assertPermission(request)];
      await allEvaluationsEntered.promise;
      await expect(adminState.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        inFlight: 2n,
        ready: false,
      });
      let transitionSettled = false;
      transition = adminState.transitionToEnforce({
        workspaceId: WORKSPACE_A,
        actorUserId: USER_READ,
      }).finally(() => {
        transitionSettled = true;
      });
      await waitForAdvisoryLockWaiters(1, 'enforce to wait on shared shadow evaluations');
      expect(transitionSettled).toBe(false);

      releases[0]!.resolve(undefined);
      await evaluations[0];
      await waitForAdvisoryLockWaiters(1, 'enforce to keep waiting on the second shadow evaluation');
      expect(transitionSettled).toBe(false);

      releases[1]!.resolve(undefined);
      await evaluations[1];
      await expect(transition).resolves.toEqual({ ok: false, code: 'mismatches_present' });
      await expect(adminState.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        mode: 'shadow',
        evaluated: 2n,
        legacyAllowNewDeny: 2n,
        inFlight: 0n,
      });
    } finally {
      for (const release of releases) release.resolve(undefined);
      await Promise.allSettled(evaluations);
      if (transition) await Promise.allSettled([transition]);
      await evaluationDb.destroy();
      await adminDb.destroy();
    }
  });

  test('exclusive reset waits for an earlier shadow evaluation and then clears its observation atomically', async () => {
    const evaluationDb = createApplicationDb({ maxConnections: 1, applicationName: 'task8-reset-evaluation' });
    const adminDb = createApplicationDb({ maxConnections: 1, applicationName: 'task8-reset-admin' });
    const evaluationState = createPostgresMailAclRolloutStatePort({ db: evaluationDb });
    const adminState = createPostgresMailAclRolloutStatePort({ db: adminDb });
    const evaluationEntered = deferred<void>();
    const releaseEvaluation = deferred<void>();
    const service = new MailAccessRolloutService({
      state: evaluationState,
      legacy: {
        async canAccessAccount() {
          evaluationEntered.resolve(undefined);
          await releaseEvaluation.promise;
          return true;
        },
        async resolveAccountScope() { return [ACCOUNT_A]; },
      },
      newAcl: {
        async resolveGrants() { return []; },
      },
    });
    let reset: Promise<Awaited<ReturnType<typeof adminState.resetShadowCounters>>> | undefined;
    const evaluation = service.assertPermission({
      workspaceId: WORKSPACE_A,
      actor: { workspaceId: WORKSPACE_A, userId: USER_READ, isOwner: false, isAdmin: false },
      permission: 'mail.metadata.read',
      resource: { type: 'account', accountId: String(ACCOUNT_A) },
    });
    try {
      await evaluationEntered.promise;
      await expect(adminState.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        inFlight: 1n,
        ready: false,
      });
      let resetSettled = false;
      reset = adminState.resetShadowCounters({
        workspaceId: WORKSPACE_A,
        actorUserId: USER_READ,
      }).finally(() => {
        resetSettled = true;
      });
      await waitForAdvisoryLockWaiters(1, 'reset to wait on the shared shadow evaluation');
      expect(resetSettled).toBe(false);

      releaseEvaluation.resolve(undefined);
      await expect(evaluation).resolves.toBeUndefined();
      await expect(reset).resolves.toEqual({ ok: true });
      await expect(adminState.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        mode: 'shadow',
        evaluated: 0n,
        legacyAllowNewDeny: 0n,
        legacyDenyNewAllow: 0n,
        notComparable: 0n,
        inFlight: 0n,
        observationStartedAt: null,
        observationUpdatedAt: null,
        telemetryHealthy: true,
        diagnosticCode: null,
        diagnosticAt: null,
      });
    } finally {
      releaseEvaluation.resolve(undefined);
      await Promise.allSettled([evaluation]);
      if (reset) await Promise.allSettled([reset]);
      await evaluationDb.destroy();
      await adminDb.destroy();
    }
  });

  test('single-connection rollout evaluation reuses its transaction and does not borrow a nested pool connection', async () => {
    const queries: string[] = [];
    const db = createApplicationDb({
      maxConnections: 1,
      applicationName: 'task8-single-connection-evaluation',
      onQuery: (query) => queries.push(query),
    });
    const state = createPostgresMailAclRolloutStatePort({ db });
    const service = new MailAccessRolloutService({
      state,
      legacy: createPostgresMailAclRolloutLegacyPort({ db }),
      newAcl: createPostgresMailAccessPort({ db }),
    });
    try {
      await state.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
      await expect(service.assertPermission({
        workspaceId: WORKSPACE_A,
        actor: { workspaceId: WORKSPACE_A, userId: USER_READ, isOwner: false, isAdmin: false },
        permission: 'mail.content.read',
        resource: {
          type: 'message',
          accountId: String(ACCOUNT_A),
          folderId: String(FOLDER_A),
          messageId: String(MESSAGE_A),
        },
      })).resolves.toBeUndefined();
      await expect(state.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        evaluated: 1n,
        inFlight: 0n,
        telemetryHealthy: true,
      });
      expect(queries.some((query) => query.includes('pg_advisory_unlock_shared'))).toBe(true);
      const heldSessionLocks = await client.query<{ held: string }>(`
        SELECT count(*)::text AS held
        FROM pg_locks locks
        JOIN pg_stat_activity activity ON activity.pid = locks.pid
        WHERE locks.locktype = 'advisory'
          AND activity.application_name = 'task8-single-connection-evaluation'
      `);
      expect(heldSessionLocks.rows).toEqual([{ held: '0' }]);
    } finally {
      await db.destroy();
    }
  }, 10_000);

  test('counter saturation marks telemetry unhealthy without changing allowed shadow decisions and reset starts a healthy window', async () => {
    const db = createApplicationDb({ maxConnections: 2 });
    const state = createPostgresMailAclRolloutStatePort({ db });
    const diagnostics: string[] = [];
    const serviceOptions = {
      state,
      legacy: {
        async canAccessAccount() { return true; },
        async resolveAccountScope() { return [ACCOUNT_A]; },
      },
      newAcl: {
        async resolveGrants() { return []; },
      },
      onTelemetryDiagnostic(event: { code: string }) {
        diagnostics.push(event.code);
      },
    };
    const service = new MailAccessRolloutService(serviceOptions);
    const maxBigint = 9_223_372_036_854_775_807n;
    try {
      await state.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`
        UPDATE mail_acl_rollout_state
        SET evaluated = '${(maxBigint - 1n).toString()}'::bigint
        WHERE workspace_id = '${WORKSPACE_A}'
      `);
      await client.query('RESET app.role; RESET app.cross_workspace_access');

      for (let index = 0; index < 2; index += 1) {
        await expect(service.assertPermission({
          workspaceId: WORKSPACE_A,
          actor: { workspaceId: WORKSPACE_A, userId: USER_READ, isOwner: false, isAdmin: false },
          permission: 'mail.content.read',
          resource: { type: 'account', accountId: String(ACCOUNT_A) },
        })).resolves.toBeUndefined();
      }

      await expect(state.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        evaluated: maxBigint,
        legacyAllowNewDeny: 2n,
        telemetryHealthy: false,
        diagnosticCode: 'counter_saturated',
        ready: false,
      });
      expect(diagnostics).toEqual(['counter_saturated']);
      await expect(state.transitionToEnforce({ workspaceId: WORKSPACE_A, actorUserId: USER_READ })).resolves.toEqual({
        ok: false,
        code: 'telemetry_unhealthy',
      });

      await expect(state.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ })).resolves.toEqual({ ok: true });
      await expect(state.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        evaluated: 0n,
        telemetryHealthy: true,
        diagnosticCode: null,
        diagnosticAt: null,
        ready: false,
      });

      await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
      await client.query(`
        UPDATE mail_acl_rollout_state
        SET evaluated = '${(maxBigint - 1n).toString()}'::bigint
        WHERE workspace_id = '${WORKSPACE_A}'
      `);
      await client.query('RESET app.role; RESET app.cross_workspace_access');
      const deniedService = new MailAccessRolloutService({
        state,
        legacy: {
          async canAccessAccount() { return false; },
          async resolveAccountScope() { return []; },
        },
        newAcl: {
          async resolveGrants() {
            return [{ resourceType: 'account' as const, accountId: ACCOUNT_A, folderId: null, messageId: null }];
          },
        },
        onTelemetryDiagnostic: serviceOptions.onTelemetryDiagnostic,
      });
      for (let index = 0; index < 2; index += 1) {
        await expect(deniedService.assertPermission({
          workspaceId: WORKSPACE_A,
          actor: { workspaceId: WORKSPACE_A, userId: USER_READ, isOwner: false, isAdmin: false },
          permission: 'mail.content.read',
          resource: { type: 'account', accountId: String(ACCOUNT_A) },
        })).rejects.toBeInstanceOf(MailAccessDeniedError);
      }
      await expect(state.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        evaluated: maxBigint,
        legacyDenyNewAllow: 2n,
        telemetryHealthy: false,
        diagnosticCode: 'counter_saturated',
      });
      expect(diagnostics).toEqual(['counter_saturated', 'counter_saturated']);
      await state.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
    } finally {
      await client.query('RESET app.role; RESET app.cross_workspace_access').catch(() => undefined);
      await db.destroy();
    }
  });

  test('unexpected PostgreSQL counter errors persist unhealthy diagnostics without replacing allow or deny decisions', async () => {
    const db = createApplicationDb({ maxConnections: 2 });
    const state = createPostgresMailAclRolloutStatePort({ db });
    const diagnostics: string[] = [];
    const newDeny = { async resolveGrants() { return []; } };
    const newAllow = {
      async resolveGrants() {
        return [{ resourceType: 'account' as const, accountId: ACCOUNT_A, folderId: null, messageId: null }];
      },
    };
    try {
      await state.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
      await client.query(`
        CREATE OR REPLACE FUNCTION task8_fail_rollout_counter_update()
        RETURNS trigger
        LANGUAGE plpgsql
        AS $$
        BEGIN
          IF NEW.evaluated IS DISTINCT FROM OLD.evaluated
            OR NEW.legacy_allow_new_deny IS DISTINCT FROM OLD.legacy_allow_new_deny
            OR NEW.legacy_deny_new_allow IS DISTINCT FROM OLD.legacy_deny_new_allow
            OR NEW.not_comparable IS DISTINCT FROM OLD.not_comparable
          THEN
            RAISE EXCEPTION 'task8 counter update failure';
          END IF;
          RETURN NEW;
        END;
        $$
      `);
      await client.query(`
        CREATE TRIGGER task8_fail_rollout_counter_update
        BEFORE UPDATE ON mail_acl_rollout_state
        FOR EACH ROW EXECUTE FUNCTION task8_fail_rollout_counter_update()
      `);

      const allowedService = new MailAccessRolloutService({
        state,
        legacy: {
          async canAccessAccount() { return true; },
          async resolveAccountScope() { return [ACCOUNT_A]; },
        },
        newAcl: newDeny,
        onTelemetryDiagnostic: (event) => diagnostics.push(event.code),
      });
      await expect(allowedService.assertPermission({
        workspaceId: WORKSPACE_A,
        actor: { workspaceId: WORKSPACE_A, userId: USER_READ, isOwner: false, isAdmin: false },
        permission: 'mail.content.read',
        resource: { type: 'account', accountId: String(ACCOUNT_A) },
      })).resolves.toBeUndefined();
      await expect(state.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        evaluated: 0n,
        inFlight: 1n,
        telemetryHealthy: false,
        diagnosticCode: 'counter_update_failed',
        ready: false,
      });
      await expect(state.transitionToEnforce({ workspaceId: WORKSPACE_A, actorUserId: USER_READ })).resolves.toEqual({
        ok: false,
        code: 'evaluations_in_flight',
      });

      await state.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
      const deniedService = new MailAccessRolloutService({
        state,
        legacy: {
          async canAccessAccount() { return false; },
          async resolveAccountScope() { return []; },
        },
        newAcl: newAllow,
        onTelemetryDiagnostic: (event) => diagnostics.push(event.code),
      });
      await expect(deniedService.assertPermission({
        workspaceId: WORKSPACE_A,
        actor: { workspaceId: WORKSPACE_A, userId: USER_READ, isOwner: false, isAdmin: false },
        permission: 'mail.content.read',
        resource: { type: 'account', accountId: String(ACCOUNT_A) },
      })).rejects.toBeInstanceOf(MailAccessDeniedError);
      await expect(state.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        evaluated: 0n,
        inFlight: 1n,
        telemetryHealthy: false,
        diagnosticCode: 'counter_update_failed',
      });
      expect(diagnostics).toEqual(['counter_update_failed', 'counter_update_failed']);
    } finally {
      await client.query('DROP TRIGGER IF EXISTS task8_fail_rollout_counter_update ON mail_acl_rollout_state');
      await client.query('DROP FUNCTION IF EXISTS task8_fail_rollout_counter_update()');
      await state.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ }).catch(() => undefined);
      await db.destroy();
    }
  });

  test('transaction-fatal finalization preserves computed allow and deny while a durable latch blocks readiness', async () => {
    const fatalDb = createApplicationDb({
      maxConnections: 1,
      applicationName: 'task8-fatal-finalization',
      onPoolError() {},
    });
    const observerDb = createApplicationDb({ maxConnections: 2, applicationName: 'task8-fatal-observer' });
    const observerState = createPostgresMailAclRolloutStatePort({ db: observerDb });
    let workspaceTransactions = 0;
    const fatalState = createPostgresMailAclRolloutStatePort({
      db: fatalDb,
      applyWorkspaceSession: async (trx, command) => {
        workspaceTransactions += 1;
        if (workspaceTransactions % 3 === 0) {
          await sql`SELECT pg_terminate_backend(pg_backend_pid())`.execute(trx);
          return;
        }
        await sql`
          SELECT
            set_config('app.workspace_id', ${command.params[0]}, true),
            set_config('app.user_id', ${command.params[1]}, true),
            set_config('app.role', ${command.params[2]}, true),
            set_config('app.cross_workspace_access', ${command.params[3]}, true)
        `.execute(trx);
      },
    });
    const request = {
      workspaceId: WORKSPACE_A,
      actor: { workspaceId: WORKSPACE_A, userId: USER_READ, isOwner: false, isAdmin: false },
      permission: 'mail.content.read' as const,
      resource: { type: 'account' as const, accountId: String(ACCOUNT_A) },
    };
    try {
      await observerState.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
      const allowedService = new MailAccessRolloutService({
        state: fatalState,
        legacy: {
          async canAccessAccount() { return true; },
          async resolveAccountScope() { return [ACCOUNT_A]; },
        },
        newAcl: { async resolveGrants() { return []; } },
      });
      await expect(allowedService.assertPermission(request)).resolves.toBeUndefined();
      await expect(observerState.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        evaluated: 0n,
        inFlight: 1n,
        ready: false,
      });
      await expect(observerState.transitionToEnforce({
        workspaceId: WORKSPACE_A,
        actorUserId: USER_READ,
      })).resolves.toEqual({ ok: false, code: 'evaluations_in_flight' });

      await expect(observerState.resetShadowCounters({
        workspaceId: WORKSPACE_A,
        actorUserId: USER_READ,
      })).resolves.toEqual({ ok: true });
      const deniedService = new MailAccessRolloutService({
        state: fatalState,
        legacy: {
          async canAccessAccount() { return false; },
          async resolveAccountScope() { return []; },
        },
        newAcl: {
          async resolveGrants() {
            return [{ resourceType: 'account' as const, accountId: ACCOUNT_A, folderId: null, messageId: null }];
          },
        },
      });
      await expect(deniedService.assertPermission(request)).rejects.toBeInstanceOf(MailAccessDeniedError);
      await expect(observerState.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        evaluated: 0n,
        inFlight: 1n,
        ready: false,
      });

      const heldSessionLocks = await client.query<{ held: string }>(`
        SELECT count(*)::text AS held
        FROM pg_locks locks
        JOIN pg_stat_activity activity ON activity.pid = locks.pid
        WHERE locks.locktype = 'advisory'
          AND activity.application_name = 'task8-fatal-finalization'
      `);
      expect(heldSessionLocks.rows).toEqual([{ held: '0' }]);
      await observerState.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
    } finally {
      await fatalDb.destroy();
      await observerDb.destroy();
    }
  });

  test('RLS zero-row counter updates are unhealthy, explicit, and cannot mutate another workspace', async () => {
    const normalDb = createApplicationDb({ maxConnections: 2 });
    const misScopedDb = createApplicationDb({ maxConnections: 1 });
    const normalState = createPostgresMailAclRolloutStatePort({ db: normalDb });
    let misScopedTransactions = 0;
    const misScopedState = createPostgresMailAclRolloutStatePort({
      db: misScopedDb,
      applyWorkspaceSession: async (trx, command) => {
        misScopedTransactions += 1;
        const finalization = misScopedTransactions % 3 === 0;
        await sql`
          SELECT
            set_config('app.workspace_id', ${finalization ? WORKSPACE_B : command.params[0]}, true),
            set_config('app.user_id', ${finalization ? USER_WORKSPACE_B : command.params[1]}, true),
            set_config('app.role', ${finalization ? 'admin' : command.params[2]}, true),
            set_config('app.cross_workspace_access', ${finalization ? 'off' : command.params[3]}, true)
        `.execute(trx);
      },
    });
    try {
      await normalState.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
      const workspaceBBefore = await normalState.getReadiness(WORKSPACE_B);
      const diagnostics: string[] = [];
      const allowedService = new MailAccessRolloutService({
        state: misScopedState,
        legacy: {
          async canAccessAccount() { return true; },
          async resolveAccountScope() { return [ACCOUNT_A]; },
        },
        newAcl: { async resolveGrants() { return []; } },
        onTelemetryDiagnostic: (event) => diagnostics.push(event.code),
      });
      const deniedService = new MailAccessRolloutService({
        state: misScopedState,
        legacy: {
          async canAccessAccount() { return false; },
          async resolveAccountScope() { return []; },
        },
        newAcl: {
          async resolveGrants() {
            return [{ resourceType: 'account' as const, accountId: ACCOUNT_A, folderId: null, messageId: null }];
          },
        },
        onTelemetryDiagnostic: (event) => diagnostics.push(event.code),
      });

      await expect(allowedService.assertPermission({
        workspaceId: WORKSPACE_A,
        actor: { workspaceId: WORKSPACE_A, userId: USER_READ, isOwner: false, isAdmin: false },
        permission: 'mail.content.read',
        resource: { type: 'account', accountId: String(ACCOUNT_A) },
      })).resolves.toBeUndefined();
      await normalState.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
      await expect(deniedService.assertPermission({
        workspaceId: WORKSPACE_A,
        actor: { workspaceId: WORKSPACE_A, userId: USER_READ, isOwner: false, isAdmin: false },
        permission: 'mail.content.read',
        resource: { type: 'account', accountId: String(ACCOUNT_A) },
      })).rejects.toBeInstanceOf(MailAccessDeniedError);

      expect(diagnostics).toEqual(['counter_update_zero_rows', 'counter_update_zero_rows']);
      await expect(normalState.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        evaluated: 0n,
        inFlight: 1n,
        ready: false,
      });
      await expect(normalState.getReadiness(WORKSPACE_B)).resolves.toEqual(workspaceBBefore);
    } finally {
      await normalState.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ }).catch(() => undefined);
      await normalDb.destroy();
      await misScopedDb.destroy();
    }
  });

  test('rollout transition is one-way, requires observations without mismatches, and reset is shadow-only', async () => {
    const db = createApplicationDb({ maxConnections: 4 });
    const port = createPostgresMailAclRolloutStatePort({ db });
    try {
      await port.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
      await expect(port.transitionToEnforce({ workspaceId: WORKSPACE_A, actorUserId: USER_READ })).resolves.toEqual({
        ok: false,
        code: 'no_observations',
      });

      await port.increment(WORKSPACE_A, { evaluated: 1n, legacyAllowNewDeny: 1n, legacyDenyNewAllow: 0n });
      await expect(port.transitionToEnforce({ workspaceId: WORKSPACE_A, actorUserId: USER_READ })).resolves.toEqual({
        ok: false,
        code: 'mismatches_present',
      });

      await port.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ });
      await port.increment(WORKSPACE_A, { evaluated: 3n, legacyAllowNewDeny: 0n, legacyDenyNewAllow: 0n });
      await expect(port.transitionToEnforce({ workspaceId: WORKSPACE_A, actorUserId: USER_READ })).resolves.toEqual({ ok: true });
      await expect(port.getReadiness(WORKSPACE_A)).resolves.toMatchObject({
        mode: 'enforce',
        ready: false,
        enforced: true,
        evaluated: 3n,
      });
      let legacyCalls = 0;
      const enforcedService = new MailAccessRolloutService({
        state: port,
        legacy: {
          async canAccessAccount() {
            legacyCalls += 1;
            return true;
          },
          async resolveAccountScope() {
            legacyCalls += 1;
            return [ACCOUNT_A];
          },
        },
        newAcl: {
          async resolveGrants() {
            return [{ resourceType: 'account' as const, accountId: ACCOUNT_A, folderId: null, messageId: null }];
          },
        },
      });
      await expect(enforcedService.assertPermission({
        workspaceId: WORKSPACE_A,
        actor: { workspaceId: WORKSPACE_A, userId: USER_READ, isOwner: false, isAdmin: false },
        permission: 'mail.content.read',
        resource: { type: 'account', accountId: String(ACCOUNT_A) },
      })).resolves.toBeUndefined();
      expect(legacyCalls).toBe(0);
      await expect(port.resetShadowCounters({ workspaceId: WORKSPACE_A, actorUserId: USER_READ })).resolves.toEqual({
        ok: false,
        code: 'not_shadow',
      });
    } finally {
      await db.destroy();
    }
  });

  test('down removes only ACL objects and preserves the legacy table', async () => {
    const mailAclMigration = serverMigrations.find((candidate) => candidate.id === '0038_mail_acl');
    const rolloutMigration = serverMigrations.find((candidate) => candidate.id === '0039_mail_acl_rollout');
    expect(mailAclMigration).toBeDefined();
    expect(rolloutMigration).toBeDefined();
    await applyStatements(rolloutMigration!.downSql);
    await applyStatements(mailAclMigration!.downSql);
    migrationDownApplied = true;
    await client.query(`SELECT set_config('app.role', 'system', false), set_config('app.cross_workspace_access', 'on', false)`);
    const relations = await client.query<{
      bindings: string | null;
      permissions: string | null;
      rollout: string | null;
      legacy: string | null;
      legacy_count: string;
    }>(`
      SELECT
        to_regclass('public.mail_acl_bindings')::text AS bindings,
        to_regclass('public.mail_acl_binding_permissions')::text AS permissions,
        to_regclass('public.mail_acl_rollout_state')::text AS rollout,
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
      rollout: null,
      legacy: 'user_account_access',
      legacy_count: '3',
    });
    expect(helperIndexes.rows.every((index) => index.relation === null)).toBe(true);
  });
});
