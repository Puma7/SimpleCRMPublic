import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { createHash } from 'crypto';
import net from 'net';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { PassThrough } from 'stream';

import type { Kysely } from 'kysely';

import {
  SERVER_EDITION_DEPLOY_MODES,
  SERVER_EDITION_TARGETS,
  createCoreRuntime,
  isServerEditionDeployMode,
  listBuiltinWorkflowNodeCatalog,
} from '../../packages/core/src';
import {
  DESKTOP_DEPLOY_CONFIG_FILE,
  DESKTOP_DEPLOY_CONFIG_VERSION,
  STANDALONE_MASTER_KEY_SECRET,
  STANDALONE_POSTGRES_DATABASE,
  STANDALONE_POSTGRES_HOST,
  STANDALONE_POSTGRES_MAJOR,
  STANDALONE_POSTGRES_PASSWORD_SECRET,
  STANDALONE_POSTGRES_USER,
  SIMPLECRM_DESKTOP_MODE_ENV,
  SIMPLECRM_STANDALONE_PG_HOST_ENV,
  SIMPLECRM_STANDALONE_PG_PORT_ENV,
  STANDALONE_KEYTAR_SERVICE,
  StandalonePostgresManager,
  buildDesktopDeployConfig,
  buildDesktopDeployConfigPath,
  buildStandalonePostgresConnectionString,
  buildStandalonePostgresLayout,
  buildStandaloneToServerMigrationPlan,
  createElectronStandalonePostgresManager,
  createEmbeddedPostgresEngineFactory,
  createKeytarStandaloneSecretStore,
  ensureStandaloneSecret,
  normalizeDesktopDeployConfig,
  normalizeServerBaseUrl,
  readDesktopDeployConfig,
  resolveDesktopDeployMode,
  runStandaloneToServerMigration,
  shouldShowSetupWizard,
  standaloneSecretAccountName,
  writeDesktopDeployConfig,
  type EmbeddedPostgresEngineInput,
} from '../../packages/desktop/src';
import {
  runMigrateCli,
  type MigrationPgClient,
} from '../../packages/server/src/cli/migrate';
import {
  runMigrateFromSqliteCli,
  parseMigrateFromSqliteCliArgs,
  type MigrateFromSqlitePgClient,
} from '../../packages/server/src/cli/migrate-from-sqlite';
import {
  parseMigrateStandaloneToServerCliArgs,
  runMigrateStandaloneToServerCli,
} from '../../packages/desktop/src/cli/migrate-to-server';
import {
  runDoctorCli,
  type DoctorPgClient,
} from '../../packages/server/src/cli/doctor';
import {
  runRlsCheckCli,
  type RlsCheckPgClient,
} from '../../packages/server/src/cli/rls-check';
import {
  SERVER_POSTGRES_MAJOR,
  CI_SMOKE_ACCESS_TOKEN_SECRET,
  CI_SMOKE_MASTER_KEY,
  KNOWN_WEAK_CI_SMOKE_ACCESS_TOKEN_SECRETS,
  KNOWN_WEAK_CI_SMOKE_MASTER_KEYS,
  CONVERSATION_LOCK_HEARTBEAT_SECONDS,
  CONVERSATION_LOCK_TIMEOUT_SECONDS,
  buildCoreMailImportCommands,
  buildWorkflowSecurityImportCommands,
  JOB_DEFAULT_MAX_ATTEMPTS,
  JOB_RETRY_BASE_DELAY_SECONDS,
  JOB_RETRY_MAX_DELAY_SECONDS,
  LEGACY_EMAIL_AI_KEYTAR_SERVICE,
  LEGACY_EMAIL_KEYTAR_SERVICE,
  LEGACY_PGP_KEYTAR_SERVICE,
  LOGIN_BACKOFF_SECONDS,
  LOGIN_PERMANENT_LOCK_AFTER_FAILURES,
  MASTER_KEY_BYTES,
  PGP_PRIVATE_KEY_ENVELOPE_ALGORITHM,
  SECRET_ENVELOPE_ALGORITHM,
  RLS_POLICY_COVERAGE_TABLES,
  SERVER_JOB_TYPES,
  accessTokenSignerFromBase64,
  accountSyncAdvisoryLockCommand,
  accountSyncAdvisoryLockKey,
  acquireConversationLockCommand,
  archiveFileName,
  assertServerJobType,
  assertWebhookUrlAllowed,
  assertValidJobType,
  auditRetentionDeletionIds,
  auditRetentionRowsByIds,
  bearerTokenFromAuthorizationHeader,
  buildServerAttachmentStoragePath,
  buildAuditRetentionPlan,
  buildWorkspaceSessionCommand,
  buildCoreCrmImportCommands,
  buildPostgresSqliteFinalImportCommands,
  buildAiReplySuggestionJobPlan,
  buildAiAgentJobPlan,
  buildAiClassificationJobPlan,
  buildAiReviewJobPlan,
  buildAiTransformTextJobPlan,
  buildMailSyncJobPlan,
  buildMailVacationAutoReplyJobPlan,
  buildScheduledSendJobPlan,
  buildSpamScoringPlan,
  buildWorkflowExecutionJobPlan,
  buildWorkflowForwardCopyJobPlan,
  buildWorkflowHttpRequestJobPlan,
  buildWebhookFirePlan,
  calculateJobRetryDelaySeconds,
  calculateLoginPenalty,
  calculateMailSyncPoolSize,
  checksumMigration,
  collectMigrationSql,
  computeSqliteFileFingerprint,
  createAttachmentCopyingSqliteSource,
  createAccessToken,
  createInMemoryServerEventBus,
  createPgMigrationDatabase,
  createSqliteDatabaseMigrationSource,
  createPostgresSqliteImportTarget,
  createPostgresServerApiPorts,
  createPostgresServerEventPort,
  createPostgresServerEventNotificationChannel,
  createPostgresJobQueuePort,
  createFetchWebhookDispatchPort,
  createProductionJobHandlers,
  createSpamScoringJobHandlers,
  createWebhookJobHandlers,
  cleanupStaleConversationLocksCommand,
  createSecretEnvelopeMetadata,
  createServerApi,
  decryptPgpPrivateKeyWithPassphrase,
  decryptSecretValue,
  deserializePgpPrivateKeyEnvelope,
  equalSecretBytes,
  encodeAssociatedData,
  encodePgpPrivateKeyAssociatedData,
  encryptPgpPrivateKeyWithPassphrase,
  encryptSecretValue,
  forceTakeoverConversationLockCommand,
  buildGraphileTaskList,
  buildGraphileWorkerPlan,
  buildLockCleanupPlan,
  createGraphileQueuePort,
  createAuthInvitationMailerPort,
  createJsonlAuditRetentionArchivePort,
  createMaintenanceJobHandlers,
  createEmailComposeSenderPort,
  createPostgresAiAgentPort,
  createPostgresAiPickCannedPort,
  createPostgresAiClassificationPort,
  createPostgresAiReviewPort,
  createPostgresAiTextTransformApiPort,
  createPostgresAiTransformTextPort,
  createPostgresAiReplySuggestionPort,
  createPostgresEmailVacationAutoReplyPort,
  createPostgresEmailVacationTestPort,
  createPostgresEmailMessageReadPort,
  createPostgresMailSyncPostProcessor,
  createServerMailSyncJobPort,
  replacePostgresMailSyncAttachments,
  createPostgresJtlOrderPort,
  createJtlSyncPort,
  createPostgresMssqlSettingsPort,
  createPostgresComposeOutboundReviewPort,
  createPostgresWorkflowExecutionJobPort,
  createPostgresWorkflowInboundBackfillPort,
  createPostgresWorkflowForwardCopyPort,
  createPostgresWorkflowHttpRequestPort,
  listServerWorkflowNodeCatalog,
  createEmailReadReceiptResponderPort,
  createPostgresReadReceiptOutboundReviewPort,
  createScheduledSendJobPort,
  createServerImapSentCopyAppenderPort,
  createServerWorkflowImapActionPort,
  createServerMailConnectionTestPort,
  createBearerTokenPrincipalResolver,
  accessTokenFromWebSocketProtocol,
  createPostgresAutomationApiKeyReadPort,
  createPostgresAuthPort,
  createPostgresAuditPort,
  graphileJobKeyForJob,
  graphileQueueNameForJob,
  graphileSpecFromJob,
  hashAuditEvent,
  hashRefreshToken,
  importLegacyCredentialsToPostgresSecrets,
  learnMessageWithRspamd,
  mergeJobHandlerRegistries,
  normalizeAiJobConcurrency,
  normalizePublicBaseUrl,
  parseAuthInvitationMailConfig,
  planServerMigrations,
  parseServerEditionConfig,
  parseServerJobWorkerConfig,
  parseBase64MasterKey,
  parsePort,
  pgpIdentityPrivateKeySecretIdentifier,
  releaseConversationLockCommand,
  resolveAttachmentStoragePath,
  rotatePgpPrivateKeyPassphrase,
  rotateSecretEnvelope,
  runJobQueueOnce,
  runRlsIsolationCheck,
  runPostgresCoreMailImport,
  runPostgresCoreCrmImport,
  runPostgresSqliteFinalImport,
  runPostgresWorkflowSecurityImport,
  runSqliteToPostgresMigration,
  runServerMigrations,
  serverMigrations,
  sendSmtpMessage,
  serializePgpPrivateKeyEnvelope,
  shouldResetFailureCounterAfterSuccess,
  sqliteServerEditionMigrationPlan,
  verifyAccessToken,
  verifyAuditHashChain,
  verifyRefreshTokenHash,
  validateReadOnlyMssqlQuery,
  withWorkspaceTransaction,
  hashSqliteMigrationRow,
  hashSqliteMigrationRowSet,
  imapTimeoutsForMessageBytes,
  resolveSourceAttachmentPath,
  type ActivityLogRecord,
  type AiProfileRecord,
  type AiPromptRecord,
  type AutomationApiKeyRecord,
  type AuditHashChainRow,
  type AuthInvitationRecord,
  type AuthUserAdminRecord,
  type AuthUserRecord,
  type BeginSqliteImportRunInput,
  type BeginSqliteImportTableInput,
  type ConversationLockRecord,
  type CompleteSqliteImportRunInput,
  type CalendarEventRecord,
  type CustomerRecord,
  type CustomerCustomFieldRecord,
  type CustomerCustomFieldValueRecord,
  type DealRecord,
  type EmailAccountRecord,
  type EmailAccountSignatureRecord,
  type EmailAttachmentRecord,
  type EmailCannedResponseRecord,
  type EmailCategoryRecord,
  type EmailFolderRecord,
  type EmailInternalNoteRecord,
  type EmailMessageCategoryRecord,
  type EmailMessageRecord,
  type EmailMessageTagRecord,
  type EmailReadReceiptRecord,
  type EmailRemoteContentAllowlistRecord,
  type EmailTeamMemberRecord,
  type EmailThreadAliasRecord,
  type EmailThreadEdgeRecord,
  type EmailThreadRecord,
  type FailSqliteImportRunInput,
  type JobQueuePort,
  type JtlReferenceRecord,
  type QueuedJob,
  type MigrationDatabase,
  type MigrationMetadataRow,
  type PgpIdentityRecord,
  type PgpPeerKeyRecord,
  type ServerApiPorts,
  type ServerDatabase,
  type ServerEvent,
  type SpamDecisionRecord,
  type SpamFeatureStatRecord,
  type SpamLearningEventRecord,
  type SpamListEntryRecord,
  type SavedViewRecord,
  type SqliteDatabaseLike,
  type ProductRecord,
  type SqliteImportPgClient,
  type SqliteImportTableCheckpoint,
  type SqliteMigrationPlan,
  type SqliteMigrationReadRowsInput,
  type SqliteMigrationRow,
  type SqliteMigrationSourcePort,
  type SqliteMigrationTargetPort,
  type UpdateSqliteImportTableCheckpointInput,
  type UpsertSqliteMigrationRowsInput,
  type TaskRecord,
  type WorkflowDelayedJobRecord,
  type WorkflowForwardDedupRecord,
  type WorkflowKnowledgeBaseRecord,
  type WorkflowKnowledgeChunkRecord,
  type WorkflowMessageAppliedRecord,
  type WorkflowRecord,
  type WorkflowRunRecord,
  type WorkflowRunStepRecord,
  type WorkflowVersionRecord,
} from '../../packages/server/src';

import {
  EXPECTED_SERVER_MIGRATION_IDS,
  FakeAiReplySuggestionInsert,
  FakeAiReplySuggestionSelect,
  FakeAiReplySuggestionUpdate,
  FakeAuditPortInsert,
  FakeAuditPortSelect,
  FakeLegacyCredentialSelect,
  FakeLegacyCredentialUpdate,
  FakeMailSyncPostProcessSelect,
  FakeMaintenanceDelete,
  FakeMaintenanceSelect,
  FakePostgresAuthSessionSelect,
  FakePostgresEventInsert,
  FakePostgresEventSelect,
  FakePostgresJobQueueSelect,
  FakePostgresJobQueueUpdate,
  FakeWorkflowExecutionDelete,
  FakeWorkflowExecutionInsert,
  FakeWorkflowExecutionSelect,
  FakeWorkflowExecutionUpdate,
  JSONB_STRING_COLUMNS,
  USER_A_ID,
  USER_B_ID,
  WORKSPACE_A_ID,
  WORKSPACE_B_ID,
  checkpointFromUpdate,
  compareSqlitePrimaryKey,
  compileAuditRawNode,
  decodeJsonbStringColumns,
  ilikeMatch,
  isTestRecord,
  makeActivityLogRecord,
  makeAiProfileRecord,
  makeAiPromptRecord,
  makeAiReplySuggestionDb,
  makeAuditChainRows,
  makeAuditPortDb,
  makeAuditPortLockManager,
  makeAutomationApiKeyRecord,
  makeCalendarEventRecord,
  makeCliIo,
  makeCoreCrmImportPgClient,
  makeCustomerCustomFieldRecord,
  makeCustomerCustomFieldValueRecord,
  makeCustomerRecord,
  makeDealRecord,
  makeDoctorPgClient,
  makeEmailAccountRecord,
  makeEmailAccountSignatureRecord,
  makeEmailAttachmentRecord,
  makeEmailCannedResponseRecord,
  makeEmailCategoryRecord,
  makeEmailFolderRecord,
  makeEmailInternalNoteRecord,
  makeEmailMessageCategoryRecord,
  makeEmailMessageRecord,
  makeEmailMessageTagRecord,
  makeEmailReadReceiptRecord,
  makeEmailRemoteContentAllowlistRecord,
  makeEmailTeamMemberRecord,
  makeEmailThreadAliasRecord,
  makeEmailThreadEdgeRecord,
  makeEmailThreadRecord,
  makeFakeNotificationClient,
  makeFakePostgresEventNotifications,
  makeFakePostgresJobQueueDb,
  makeFakePostgresJobQueueRow,
  makeFetchResponse,
  makeJobQueuePort,
  makeJtlReferenceRecord,
  makeLegacyCredentialImportDb,
  makeLock,
  makeMailSyncPostProcessDb,
  makeMaintenanceDb,
  makeMigrateFromSqlitePgClient,
  makeMigrationDatabase,
  makeMigrationPgClient,
  makeParsedServerMailSyncMessage,
  makePgpIdentityRecord,
  makePgpPeerKeyRecord,
  makePostgresEmailMessageRow,
  makePostgresEventDb,
  makeProductRecord,
  makeQueuedJob,
  makeRlsCheckClient,
  makeSavedViewRecord,
  makeServerApiPorts,
  makeServerEventForTest,
  makeServerMailSyncAccount,
  makeServerMailSyncFolder,
  makeServerMailSyncStore,
  makeSpamDecisionRecord,
  makeSpamFeatureStatRecord,
  makeSpamLearningEventRecord,
  makeSpamListEntryRecord,
  makeSqliteDatabaseLike,
  makeSqliteImportPgClient,
  makeSqliteImportTarget,
  makeSqlitePlan,
  makeSqliteSource,
  makeTaskRecord,
  makeWorkflowDelayedJobRecord,
  makeWorkflowExecutionDb,
  makeWorkflowForwardDedupRecord,
  makeWorkflowKnowledgeBaseRecord,
  makeWorkflowKnowledgeChunkRecord,
  makeWorkflowMessageAppliedRecord,
  makeWorkflowRecord,
  makeWorkflowRunRecord,
  makeWorkflowRunStepRecord,
  makeWorkflowVersionRecord,
  normalizeSqlForTest,
  projectAuditRow,
  sha256Text,
  startLineServer,
  timestampMillis,
  withRuntimeLeaks,
  type AiReplySuggestionFakeRows,
  type AuditPortDbCall,
  type AuditPortInsertCall,
  type AuditPortRawCall,
  type AuditPortSelectCall,
  type CapturedAuditEvent,
  type FakePostgresJobQueueRow,
  type KyselyRawOperationNode,
  type MaintenanceDbCall,
  type MaintenanceWhere,
  type PostgresAuthSessionFakeRow,
  type PostgresEventFakeRow,
  type RlsFakeRow,
  type WorkflowExecutionFakeRows,
} from '../helpers/server-edition';

describe('server edition foundation — rls-and-sessions', () => {
  test('workspace session command validates UUID context for RLS transactions', () => {
    expect(buildWorkspaceSessionCommand({
      workspaceId: WORKSPACE_A_ID,
      userId: USER_A_ID,
      role: 'admin',
      crossWorkspaceAccess: true,
    })).toEqual({
      sql: "SELECT set_config('app.workspace_id', $1, true), set_config('app.user_id', $2, true), set_config('app.role', $3, true), set_config('app.cross_workspace_access', $4, true);",
      params: [WORKSPACE_A_ID, USER_A_ID, 'admin', 'on'],
    });
    expect(buildWorkspaceSessionCommand({
      workspaceId: WORKSPACE_A_ID.toUpperCase(),
    }).params).toEqual([WORKSPACE_A_ID, '', 'system', 'off']);
    expect(() => buildWorkspaceSessionCommand({
      workspaceId: 'workspace-a',
    })).toThrow('workspaceId');
    expect(() => buildWorkspaceSessionCommand({
      workspaceId: WORKSPACE_A_ID,
      userId: 'user-a',
    })).toThrow('userId');
  });

  test('workspace transaction applies RLS session context before database work', async () => {
    const calls: string[] = [];
    const fakeTrx = { name: 'trx' };
    const fakeDb = {
      transaction() {
        return {
          execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(fakeTrx),
        };
      },
    } as unknown as Kysely<ServerDatabase>;

    const result = await withWorkspaceTransaction(
      fakeDb,
      {
        workspaceId: WORKSPACE_A_ID,
        userId: USER_A_ID,
        role: 'owner',
      },
      async (trx) => {
        expect(trx).toBe(fakeTrx);
        calls.push('operation');
        return 'ok';
      },
      {
        applySession: async (_trx, command) => {
          expect(_trx).toBe(fakeTrx);
          expect(command).toEqual(buildWorkspaceSessionCommand({
            workspaceId: WORKSPACE_A_ID,
            userId: USER_A_ID,
            role: 'owner',
          }));
          calls.push('session');
        },
      },
    );

    expect(result).toBe('ok');
    expect(calls).toEqual(['session', 'operation']);
  });

  test('RLS isolation checker probes cross-workspace reads, writes, and rollback cleanup', async () => {
    const client = makeRlsCheckClient();
    const result = await runRlsIsolationCheck(client);

    expect(result.status).toBe('passed');
    expect(result.checks).toHaveLength((RLS_POLICY_COVERAGE_TABLES.length * 3) + 11);
    expect(result.checks.every((check) => check.status === 'passed')).toBe(true);
    expect(result.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'workspaces_rls_enabled', status: 'passed' }),
      expect.objectContaining({ name: 'workspaces_rls_forced', status: 'passed' }),
      expect.objectContaining({ name: 'workspaces_workspace_policy', status: 'passed' }),
      expect.objectContaining({ name: 'sqlite_import_table_checkpoints_workspace_policy', status: 'passed' }),
      expect.objectContaining({ name: 'automation_api_keys_workspace_policy', status: 'passed' }),
      expect.objectContaining({ name: 'workspace_a_reads_own_customer', status: 'passed' }),
      expect.objectContaining({ name: 'workspace_a_cannot_read_workspace_b_customer', status: 'passed' }),
      expect.objectContaining({ name: 'workspace_a_cannot_read_workspace_b_secret', status: 'passed' }),
      expect.objectContaining({ name: 'workspace_a_cannot_insert_workspace_b_customer', status: 'passed' }),
      expect.objectContaining({ name: 'workspace_a_cannot_move_customer_to_workspace_b', status: 'passed' }),
      expect.objectContaining({ name: 'workspace_a_cannot_delete_workspace_b_customer', status: 'passed' }),
      expect.objectContaining({ name: 'workspace_b_reads_own_customer', status: 'passed' }),
      expect.objectContaining({ name: 'workspace_b_cannot_read_workspace_a_customer', status: 'passed' }),
      expect.objectContaining({ name: 'admin_without_cross_workspace_flag_cannot_read_other_workspace', status: 'passed' }),
      expect.objectContaining({ name: 'user_with_cross_workspace_flag_cannot_read_other_workspace', status: 'passed' }),
      expect.objectContaining({ name: 'admin_with_cross_workspace_flag_reads_other_workspace', status: 'passed' }),
    ]));
    expect(client.queries[0].sql).toBe('BEGIN');
    expect(client.queries.at(-1)?.sql).toBe('ROLLBACK');
    expect(client.queries.some((query) => query.sql.startsWith('SAVEPOINT rls_probe_'))).toBe(true);
  });

  test('RLS check CLI requires a database and reports live check status', async () => {
    const missing = makeCliIo();
    await expect(runRlsCheckCli({
      argv: [],
      env: {},
      stdout: missing.stdout,
      stderr: missing.stderr,
    })).resolves.toBe(2);
    expect(missing.stderrOutput()).toContain('DATABASE_URL is required');

    const client = makeRlsCheckClient();
    const ok = makeCliIo();
    await expect(runRlsCheckCli({
      argv: ['--database-url', 'postgres://simplecrm@postgres/simplecrm'],
      env: {},
      stdout: ok.stdout,
      stderr: ok.stderr,
      createClient: () => client,
    })).resolves.toBe(0);

    expect(client.connected).toBe(true);
    expect(client.ended).toBe(true);
    expect(JSON.parse(ok.stdoutOutput()).status).toBe('passed');
  });

  test('first migration includes RLS, refresh tokens, PG queue, and conversation locks', () => {
    expect(serverMigrations.map((m) => m.id)).toEqual(EXPECTED_SERVER_MIGRATION_IDS);
    const sql = collectMigrationSql('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS refresh_tokens');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS auth_invitations');
    expect(sql).toContain('auth_invitations_live_email_idx');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS users_workspace_email_unique_idx');
    expect(sql).not.toContain('UNIQUE (workspace_id, lower(email))');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS job_queue');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS job_queue_ready_idx');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS conversation_locks');
    expect(sql).toContain('last_heartbeat_at timestamptz NOT NULL DEFAULT now()');
    expect(sql).toContain('reply_suggestion_text text');
    expect(sql).toContain('email_messages_reply_suggestion_pending_idx');
    expect(sql).toContain('email_threads_workspace_account_ticket_idx');
    expect(sql).toContain('email_account_mail_settings_workspace_isolation');
    expect(sql).toContain('email_thread_aliases_workspace_account_pair_idx');
    expect(sql).toContain('email_ai_prompts_scope_idx');
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY');
    expect(sql).toContain('FORCE ROW LEVEL SECURITY');
    expect(sql).toContain("current_setting('app.workspace_id', true)");
    expect(sql).toContain("current_setting('app.cross_workspace_access', true)");
    expect(sql).toContain('CREATE OR REPLACE FUNCTION app.can_access_workspace(target_workspace_id uuid)');
    expect(sql).toContain("app.current_role() IN ('owner', 'admin', 'system')");
    expect(sql).not.toContain('INDEX (run_after, locked_at) WHERE locked_at IS NULL');
  });

  test('desktop SQLite schema strings include account-scope fresh-install and roadmap parity', () => {
    const schemaSource = readFileSync(join(process.cwd(), 'electron', 'database-schema.ts'), 'utf8');
    const roadmapSource = readFileSync(join(process.cwd(), 'electron', 'mail-roadmap-migrations.ts'), 'utf8');

    expect(schemaSource).toContain("EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE = 'email_account_mail_settings'");
    expect(schemaSource).toContain('CREATE TABLE IF NOT EXISTS ${EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE}');
    expect(schemaSource).toContain('ticket_prefix TEXT NOT NULL');
    expect(schemaSource).toContain('ticket_next_number INTEGER NOT NULL DEFAULT 1');
    expect(schemaSource).toContain('thread_namespace TEXT NOT NULL');
    expect(schemaSource).toContain('account_id INTEGER,');
    expect(schemaSource).toContain('idx_email_thread_aliases_account_pair');
    expect(roadmapSource).toContain('ensureTable(conn, EMAIL_ACCOUNT_MAIL_SETTINGS_TABLE, createEmailAccountMailSettingsTable');
    expect(roadmapSource).toContain("addCol(conn, EMAIL_THREAD_ALIASES_TABLE, 'account_id'");
    expect(roadmapSource).toContain('idx_email_thread_aliases_account_pair');
  });

  test('all RLS-enabled migration tables force owner-level policy enforcement', () => {
    const sql = collectMigrationSql('up');
    const enabledTables: string[] = [];
    const forcedTables = new Set<string>();
    const policyTables = new Set<string>();
    const enableRegex = /ALTER TABLE ([a-z_]+) ENABLE ROW LEVEL SECURITY;/g;
    const forceRegex = /ALTER TABLE ([a-z_]+) FORCE ROW LEVEL SECURITY;/g;
    const policyRegex = /CREATE POLICY ([a-z_]+)_workspace_isolation ON ([a-z_]+)/g;
    let match: RegExpExecArray | null;

    while ((match = enableRegex.exec(sql)) !== null) {
      enabledTables.push(match[1]);
    }
    while ((match = forceRegex.exec(sql)) !== null) {
      forcedTables.add(match[1]);
    }
    while ((match = policyRegex.exec(sql)) !== null) {
      expect(match[1]).toBe(match[2]);
      policyTables.add(match[2]);
    }

    expect(enabledTables).toEqual(expect.arrayContaining([
      'workspaces',
      'auth_invitations',
      'customers',
      'secrets',
      'email_messages',
      'automation_api_keys',
    ]));
    expect(enabledTables.filter((tableName) => !forcedTables.has(tableName))).toEqual([]);
    expect(enabledTables.filter((tableName) => !policyTables.has(tableName))).toEqual([]);
    expect(RLS_POLICY_COVERAGE_TABLES.map((table) => table.tableName).toSorted()).toEqual(
      Array.from(new Set(enabledTables)).toSorted(),
    );
  });

  test('workspace RLS policies use the explicit cross-workspace access helper', () => {
    const sql = collectMigrationSql('up');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION app.cross_workspace_access_enabled()');
    expect(sql).toContain('CREATE OR REPLACE FUNCTION app.can_access_workspace(target_workspace_id uuid)');
    expect(sql).toContain("app.current_role() IN ('owner', 'admin', 'system')");
    expect(sql).not.toMatch(/USING \((?:id|workspace_id) = app\.current_workspace_id\(\)\)/);
    expect(sql).not.toMatch(/WITH CHECK \((?:id|workspace_id) = app\.current_workspace_id\(\)\)/);
  });

  test('security migration includes encrypted secret storage, login failures, audit events, and RLS', () => {
    const sql = collectMigrationSql('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS secrets');
    expect(sql).toContain('ciphertext bytea NOT NULL');
    expect(sql).toContain('nonce bytea NOT NULL');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS auth_login_failures');
    expect(sql).toContain('failed_attempts integer NOT NULL');
    expect(sql).toContain('auth_login_failures_email_ip_unique_idx');
    expect(sql).toContain("penalty_kind text NOT NULL CHECK (penalty_kind IN ('none', 'temporary', 'permanent'))");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS audit_events');
    expect(sql).toContain('previous_hash text');
    expect(sql).toContain('event_hash text NOT NULL');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS server_events');
    expect(sql).toContain('server_events_workspace_sequence_idx');
    expect(sql).toContain('CREATE POLICY server_events_workspace_isolation');
    expect(sql).toContain('CREATE POLICY secrets_workspace_isolation');
    expect(sql).toContain('CREATE POLICY audit_events_workspace_isolation');
  });

  test('sqlite import migration records resumable runs, table checkpoints, and RLS', () => {
    const sql = collectMigrationSql('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sqlite_import_runs');
    expect(sql).toContain('source_fingerprint text NOT NULL');
    expect(sql).toContain("status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed', 'dry_run'))");
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sqlite_import_table_checkpoints');
    expect(sql).toContain('last_source_pk text');
    expect(sql).toContain("status text NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed', 'skipped', 'dry_run'))");
    expect(sql).toContain('CREATE POLICY sqlite_import_runs_workspace_isolation');
    expect(sql).toContain('CREATE POLICY sqlite_import_table_checkpoints_workspace_isolation');
  });

  test('sqlite import staging migration preserves source rows as workspace-isolated JSONB', () => {
    const sql = collectMigrationSql('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS sqlite_import_rows');
    expect(sql).toContain('source_row jsonb NOT NULL');
    expect(sql).toContain('source_row_sha256 text NOT NULL');
    expect(sql).toContain('ALTER TABLE sqlite_import_rows ADD COLUMN IF NOT EXISTS source_row_sha256 text');
    expect(sql).toContain('imported_in_run_id uuid NOT NULL REFERENCES sqlite_import_runs(id) ON DELETE CASCADE');
    expect(sql).toContain('PRIMARY KEY (workspace_id, table_name, source_pk)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS sqlite_import_rows_table_idx');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS sqlite_import_rows_validation_idx');
    expect(sql).toContain('CREATE POLICY sqlite_import_rows_workspace_isolation');
  });

  test('core CRM migration creates workspace-isolated final tables for imported SQLite rows', () => {
    const sql = collectMigrationSql('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS customers');
    expect(sql).toContain('source_sqlite_id bigint NOT NULL');
    expect(sql).toContain('UNIQUE (workspace_id, source_sqlite_id)');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS products');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS deals');
    expect(sql).toContain('customer_source_sqlite_id bigint NOT NULL');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS tasks');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS deal_products');
    expect(sql).toContain('CREATE POLICY customers_workspace_isolation');
    expect(sql).toContain('CREATE POLICY deal_products_workspace_isolation');
  });

  test('extended CRM migration creates workspace-isolated calendar, custom-field, activity, saved-view, and JTL tables', () => {
    const sql = collectMigrationSql('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS calendar_events');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS customer_custom_fields');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS customer_custom_field_values');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS activity_log');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS saved_views');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS jtl_firmen');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS jtl_warenlager');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS jtl_zahlungsarten');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS jtl_versandarten');
    expect(sql).toContain('CREATE SEQUENCE IF NOT EXISTS jtl_references_server_source_sqlite_id_seq');
    expect(sql).toContain('CREATE POLICY calendar_events_workspace_isolation');
    expect(sql).toContain('CREATE POLICY jtl_versandarten_workspace_isolation');
  });

  test('core mail migration creates workspace-isolated mail tables, FTS vector, and lock FK', () => {
    const sql = collectMigrationSql('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_accounts');
    expect(sql).toContain('imap_password_secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL');
    expect(sql).toContain('smtp_password_secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL');
    expect(sql).toContain('oauth_refresh_secret_id uuid REFERENCES secrets(id) ON DELETE SET NULL');
    expect(sql).toContain('ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS sync_spam_folder_path text');
    expect(sql).toContain('ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS vacation_enabled boolean NOT NULL DEFAULT false');
    expect(sql).toContain('ALTER TABLE email_accounts ADD COLUMN IF NOT EXISTS request_read_receipt boolean NOT NULL DEFAULT false');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_folders');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_account_mail_settings');
    expect(sql).toContain('ticket_prefix text NOT NULL');
    expect(sql).toContain('ticket_next_number bigint NOT NULL DEFAULT 1');
    expect(sql).toContain('thread_namespace text NOT NULL');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_threads');
    expect(sql).toContain('account_source_sqlite_id bigint');
    expect(sql).toContain('account_id bigint REFERENCES email_accounts(id) ON DELETE SET NULL');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_messages');
    expect(sql).toContain('search_vector tsvector GENERATED ALWAYS AS');
    expect(sql).toContain('bcc_json jsonb');
    expect(sql).toContain('draft_attachment_paths_json text');
    expect(sql).toContain('reply_parent_message_id bigint REFERENCES email_messages(id) ON DELETE SET NULL');
    expect(sql).toContain('scheduled_send_at timestamptz');
    expect(sql).toContain('trash_prev_archived boolean');
    expect(sql).toContain('ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS trash_prev_folder_kind text');
    expect(sql).toContain('ALTER TABLE email_messages ADD COLUMN IF NOT EXISTS scheduled_send_at timestamptz');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS email_messages_search_gin_idx ON email_messages USING gin (search_vector)');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS email_messages_workspace_account_folder_date_idx');
    expect(sql).toContain('CREATE INDEX IF NOT EXISTS email_messages_workspace_scheduled_send_idx');
    expect(sql).toContain('legacy_assigned_to_user_id text');
    expect(sql).toContain('auth_spf text');
    expect(sql).toContain('rspamd_score double precision');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_message_attachments');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_thread_aliases');
    expect(sql).toContain('email_thread_aliases_workspace_account_pair_all_idx');
    expect(sql).toContain('email_thread_aliases_workspace_global_pair_idx');
    expect(sql).toContain('CREATE POLICY email_messages_workspace_isolation');
    expect(sql).toContain('CREATE POLICY email_account_mail_settings_workspace_isolation');
    expect(sql).toContain('conversation_locks_message_fk');
  });

  test('account-scope additive migration is idempotent and matches fresh mail schema', () => {
    const sql = collectMigrationSql('up');
    expect(sql).toContain('ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES email_accounts(id) ON DELETE SET NULL;');
    expect(sql).toContain('ALTER TABLE email_threads ADD COLUMN IF NOT EXISTS account_source_sqlite_id bigint;');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_account_mail_settings');
    expect(sql).toContain('ALTER TABLE email_thread_aliases ADD COLUMN IF NOT EXISTS account_source_sqlite_id bigint;');
    expect(sql).toContain('ALTER TABLE email_thread_aliases ADD COLUMN IF NOT EXISTS account_id bigint REFERENCES email_accounts(id) ON DELETE CASCADE;');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS email_thread_aliases_workspace_account_pair_all_idx');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS email_canned_responses_account_override_key_idx');
    expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS email_ai_prompts_account_override_key_idx');
  });

  test('workflow/security migration creates AI, workflow, spam, PGP, and automation tables with RLS', () => {
    const sql = collectMigrationSql('up');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_ai_profiles');
    expect(sql).toContain('legacy_keytar_account text');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_ai_prompts');
    expect(sql).toContain('account_source_sqlite_id bigint');
    expect(sql).toContain('override_key text');
    expect(sql).toContain('email_ai_prompts_account_override_key_idx');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_workflows');
    expect(sql).toContain('email_workflows_scope_idx');
    expect(sql).toContain('trigger_name text NOT NULL');
    expect(sql).toContain('legacy_created_by_user_id text');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_workflow_runs');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS workflow_knowledge_chunks');
    expect(sql).toContain('search_vector tsvector GENERATED ALWAYS AS');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS email_spam_feature_stats');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS pgp_identities');
    expect(sql).toContain('legacy_user_id text');
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS automation_api_keys');
    expect(sql).toContain('CREATE POLICY email_workflows_workspace_isolation');
    expect(sql).toContain('CREATE POLICY automation_api_keys_workspace_isolation');
  });

  test('server migration runner applies pending migrations once and skips them afterwards', async () => {
    const database = makeMigrationDatabase();

    const firstRun = await runServerMigrations(database, serverMigrations);
    expect(firstRun.appliedIds).toEqual(EXPECTED_SERVER_MIGRATION_IDS);
    expect(firstRun.skippedIds).toEqual([]);
    expect(database.metadataRows.map((row) => row.id)).toEqual(firstRun.appliedIds);
    expect(database.transactionCount).toBe(EXPECTED_SERVER_MIGRATION_IDS.length);
    expect(database.executedSql.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS workspaces'))).toBe(true);
    expect(database.executedSql.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS secrets'))).toBe(true);
    expect(database.executedSql.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS sqlite_import_runs'))).toBe(true);
    expect(database.executedSql.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS sqlite_import_rows'))).toBe(true);
    expect(database.executedSql.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS customers'))).toBe(true);
    expect(database.executedSql.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS calendar_events'))).toBe(true);
    expect(database.executedSql.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS email_messages'))).toBe(true);
    expect(database.executedSql.some((sql) => sql.includes('CREATE TABLE IF NOT EXISTS email_workflows'))).toBe(true);

    const secondRun = await runServerMigrations(database, serverMigrations);
    expect(secondRun.appliedIds).toEqual([]);
    expect(secondRun.skippedIds).toEqual(EXPECTED_SERVER_MIGRATION_IDS);
    expect(database.transactionCount).toBe(EXPECTED_SERVER_MIGRATION_IDS.length);
  });

  test('server migration plan rejects checksum drift and non-prefix metadata', () => {
    const first = serverMigrations[0];
    const second = serverMigrations[1];

    expect(() => planServerMigrations(serverMigrations, [{
      id: first.id,
      description: first.description,
      checksum: 'bad-checksum',
      appliedAt: null,
    }])).toThrow('Checksum mismatch');

    expect(() => planServerMigrations(serverMigrations, [{
      id: second.id,
      description: second.description,
      checksum: checksumMigration(second),
      appliedAt: null,
    }])).toThrow('prefix');
  });

  test('pg-compatible migration adapter wraps callbacks in database transactions', async () => {
    const calls: Array<{ sql: string; params?: readonly unknown[] }> = [];
    const client = {
      async query<T extends Record<string, unknown> = Record<string, unknown>>(
        sql: string,
        params?: readonly unknown[],
      ): Promise<{ rows: readonly T[] }> {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };
    const database = createPgMigrationDatabase(client);

    await database.transaction?.(async (transaction) => {
      await transaction.execute('SELECT $1', [1]);
    });

    expect(calls.map((call) => call.sql)).toEqual(['BEGIN', 'SELECT $1', 'COMMIT']);
    expect(calls[1].params).toEqual([1]);
  });

  test('job queue retry policy validates types and caps exponential delay', () => {
    expect(JOB_DEFAULT_MAX_ATTEMPTS).toBe(5);
    expect(JOB_RETRY_BASE_DELAY_SECONDS).toBe(30);
    expect(JOB_RETRY_MAX_DELAY_SECONDS).toBe(3600);
    expect(SERVER_JOB_TYPES).toEqual([
      'mail.sync.imap',
      'mail.sync.pop3',
      'mail.spam.score',
      'mail.vacation.auto_reply',
      'mail.send.scheduled',
      'ai.reply_suggestion',
      'ai.agent',
      'ai.classify',
      'ai.review',
      'ai.transform_text',
      'workflow.execute',
      'workflow.http_request',
      'workflow.forward_copy',
      'webhook.fire',
      'lock.cleanup',
      'audit.retention',
    ]);
    expect(assertValidJobType('mail.sync')).toBe('mail.sync');
    expect(assertServerJobType('mail.sync.imap')).toBe('mail.sync.imap');
    expect(() => assertServerJobType('mail.sync')).toThrow('unsupported server job type');
    expect(() => assertValidJobType('Mail Sync')).toThrow('job type');
    expect(calculateJobRetryDelaySeconds(1)).toBe(30);
    expect(calculateJobRetryDelaySeconds(2)).toBe(60);
    expect(calculateJobRetryDelaySeconds(8)).toBe(3600);
    expect(() => calculateJobRetryDelaySeconds(0)).toThrow('positive integer');
    expect(calculateMailSyncPoolSize(0)).toBe(0);
    expect(calculateMailSyncPoolSize(10)).toBe(20);
    expect(calculateMailSyncPoolSize(100)).toBe(50);
    expect(normalizeAiJobConcurrency(undefined)).toBe(5);
    expect(normalizeAiJobConcurrency(12)).toBe(12);
    expect(() => normalizeAiJobConcurrency(0)).toThrow('AI job concurrency');
    expect(accountSyncAdvisoryLockKey(42)).toBe('account-42');
    expect(accountSyncAdvisoryLockCommand(42)).toEqual({
      sql: 'SELECT pg_advisory_xact_lock(hashtext($1));',
      params: ['account-42'],
    });
  });

});
