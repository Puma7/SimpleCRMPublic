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

describe('server edition foundation — foundation-and-boundaries', () => {
  test('pins the server-edition baseline to PostgreSQL 18 and Node 22', () => {
    expect(SERVER_EDITION_TARGETS.postgresMajor).toBe(18);
    expect(SERVER_EDITION_TARGETS.nodeMajor).toBe(22);
    expect(SERVER_POSTGRES_MAJOR).toBe(18);
  });

  test('models the three planned deploy modes', () => {
    expect(SERVER_EDITION_DEPLOY_MODES).toEqual(['standalone', 'headless', 'server']);
    expect(isServerEditionDeployMode('standalone')).toBe(true);
    expect(isServerEditionDeployMode('server')).toBe(true);
    expect(isServerEditionDeployMode('sqlite-only')).toBe(false);
  });

  test('auth IPC/session boundaries keep direct SQLite access behind the auth store', () => {
    const authBoundaryFiles = [
      join(process.cwd(), 'electron', 'ipc', 'auth.ts'),
      join(process.cwd(), 'electron', 'ipc', 'pgp.ts'),
      join(process.cwd(), 'electron', 'ipc', 'register.ts'),
      join(process.cwd(), 'electron', 'auth', 'current-user.ts'),
    ];
    for (const filePath of authBoundaryFiles) {
      const source = readFileSync(filePath, 'utf8');
      expect(source).not.toContain("from '../sqlite-service'");
      expect(source).not.toMatch(/\bgetDb\s*\(/);
    }

    const authStoreSource = readFileSync(join(process.cwd(), 'electron', 'auth', 'auth-store.ts'), 'utf8');
    expect(authStoreSource).toContain("from '../sqlite-service'");
    expect(authStoreSource).toMatch(/\bgetDb\s*\(/);

    const emailIpcSource = readFileSync(join(process.cwd(), 'electron', 'ipc', 'email.ts'), 'utf8');
    expect(emailIpcSource).toContain('canAccessLocalAccount');
    expect(emailIpcSource).not.toContain('canAccessAccount');
  });

  test('deal product IPC boundary keeps table lookups behind the deal product store', () => {
    const dealsIpcSource = readFileSync(join(process.cwd(), 'electron', 'ipc', 'deals.ts'), 'utf8');
    expect(dealsIpcSource).not.toMatch(/\bgetDb\s*\(/);
    expect(dealsIpcSource).not.toContain('DEAL_PRODUCTS_TABLE');
    expect(dealsIpcSource).toContain("from '../deals/deal-products-store'");

    const dealProductsStoreSource = readFileSync(
      join(process.cwd(), 'electron', 'deals', 'deal-products-store.ts'),
      'utf8',
    );
    expect(dealProductsStoreSource).toContain("from '../sqlite-service'");
    expect(dealProductsStoreSource).toContain('DEAL_PRODUCTS_TABLE');
    expect(dealProductsStoreSource).toMatch(/\bgetDb\s*\(/);
  });

  test('email IPC keeps direct DB handles behind dedicated email stores', () => {
    const emailIpcSource = readFileSync(join(process.cwd(), 'electron', 'ipc', 'email.ts'), 'utf8');
    expect(emailIpcSource).not.toContain("from '../sqlite-service'");
    expect(emailIpcSource).not.toMatch(/\bgetDb\s*\(/);
    expect(emailIpcSource).toContain("from '../email/email-ai-customer-context-store'");
    expect(emailIpcSource).toContain("from '../email/email-remote-content-store'");
    expect(emailIpcSource).toContain("from '../email/email-read-receipt-store'");

    const aiCustomerContextStoreSource = readFileSync(
      join(process.cwd(), 'electron', 'email', 'email-ai-customer-context-store.ts'),
      'utf8',
    );
    expect(aiCustomerContextStoreSource).toContain("from '../sqlite-service'");
    expect(aiCustomerContextStoreSource).toMatch(/\bgetCustomerById\s*\(/);

    const remoteContentStoreSource = readFileSync(
      join(process.cwd(), 'electron', 'email', 'email-remote-content-store.ts'),
      'utf8',
    );
    expect(remoteContentStoreSource).toContain("from '../sqlite-service'");
    expect(remoteContentStoreSource).toMatch(/\bgetDb\s*\(/);

    const readReceiptStoreSource = readFileSync(
      join(process.cwd(), 'electron', 'email', 'email-read-receipt-store.ts'),
      'utf8',
    );
    expect(readReceiptStoreSource).toContain("from '../sqlite-service'");
    expect(readReceiptStoreSource).toMatch(/\bgetDb\s*\(/);
  });

  test('IPC sync info boundaries keep direct sync_info access behind the sync info store', () => {
    const syncInfoIpcFiles = [
      join(process.cwd(), 'electron', 'ipc', 'sync.ts'),
      join(process.cwd(), 'electron', 'ipc', 'workflow.ts'),
      join(process.cwd(), 'electron', 'ipc', 'email.ts'),
    ];
    for (const filePath of syncInfoIpcFiles) {
      const source = readFileSync(filePath, 'utf8');
      expect(source).not.toMatch(/\bgetSyncInfo\b/);
      expect(source).not.toMatch(/\bsetSyncInfo\b/);
      expect(source).toContain('sync-info-store');
    }

    const syncInfoStoreSource = readFileSync(join(process.cwd(), 'electron', 'sync-info-store.ts'), 'utf8');
    expect(syncInfoStoreSource).toContain("from './sqlite-service'");
    expect(syncInfoStoreSource).toMatch(/\bgetSyncInfo\b/);
    expect(syncInfoStoreSource).toMatch(/\bsetSyncInfo\b/);
  });

  test('server workflow node catalog hides local code and plugin nodes', () => {
    const builtinTypes = listBuiltinWorkflowNodeCatalog().map((entry) => entry.type);
    expect(builtinTypes).toEqual(expect.arrayContaining([
      'code.javascript',
      'code.python',
      'plugin.custom',
    ]));

    const serverTypes = listServerWorkflowNodeCatalog().map((entry) => entry.type);
    expect(serverTypes).toEqual(expect.arrayContaining([
      'email.forward_copy',
      'http.request',
      'mssql.query',
      'workflow.subflow',
    ]));
    expect(serverTypes).not.toEqual(expect.arrayContaining([
      'code.javascript',
      'code.python',
      'plugin.custom',
    ]));
  });

  test('desktop setup config persists AP-10 deploy-mode choices in userData config.json', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'simplecrm-config-'));
    try {
      expect(buildDesktopDeployConfigPath(userDataDir)).toBe(join(userDataDir, DESKTOP_DEPLOY_CONFIG_FILE));
      const missing = await readDesktopDeployConfig(userDataDir);
      expect(missing).toEqual({ status: 'missing' });
      expect(shouldShowSetupWizard(missing)).toBe(true);

      const selectedAt = new Date('2026-06-03T12:00:00.000Z');
      const config = buildDesktopDeployConfig({
        mode: 'server-client',
        now: selectedAt,
        server: {
          baseUrl: ' https://crm.example.com/api/ ',
          lastLoginUsername: ' pascal ',
        },
      });
      expect(config).toEqual({
        version: DESKTOP_DEPLOY_CONFIG_VERSION,
        mode: 'server-client',
        selectedAt: selectedAt.toISOString(),
        server: {
          baseUrl: 'https://crm.example.com/api',
          lastLoginUsername: 'pascal',
        },
      });

      await writeDesktopDeployConfig(userDataDir, config);
      const readBack = await readDesktopDeployConfig(userDataDir);
      expect(readBack).toEqual({ status: 'ok', config });
      expect(shouldShowSetupWizard(readBack)).toBe(false);
      expect(normalizeDesktopDeployConfig({
        version: 999,
        mode: 'server-install',
        selectedAt: '2026-06-03T12:00:00.000Z',
        serverInstall: {
          composeProjectName: ' simplecrm ',
          installDir: ' C:/SimpleCRM/server ',
        },
      })).toEqual({
        version: DESKTOP_DEPLOY_CONFIG_VERSION,
        mode: 'server-install',
        selectedAt: '2026-06-03T12:00:00.000Z',
        serverInstall: {
          composeProjectName: 'simplecrm',
          installDir: 'C:/SimpleCRM/server',
        },
      });
      expect(normalizeServerBaseUrl('http://localhost:3000/')).toBe('http://localhost:3000');
      expect(() => normalizeServerBaseUrl('file:///tmp/simplecrm')).toThrow('http or https');
      expect(() => normalizeDesktopDeployConfig({
        mode: 'server-client',
        selectedAt: '2026-06-03T12:00:00.000Z',
      })).toThrow('server config is required');
    } finally {
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('desktop setup config reports invalid persisted JSON instead of accepting it', async () => {
    const filePort = {
      async mkdir(): Promise<void> {
        return undefined;
      },
      async readFile(): Promise<string> {
        return '{bad json';
      },
      async writeFile(): Promise<void> {
        return undefined;
      },
      async rename(): Promise<void> {
        return undefined;
      },
    };
    const result = await readDesktopDeployConfig('C:/SimpleCRM/UserData', filePort);

    expect(result.status).toBe('invalid');
    expect(shouldShowSetupWizard(result)).toBe(true);
  });

  test('standalone to server migration plan uses pg_dump, pg_restore, and attachment sync without shell commands', async () => {
    const plan = buildStandaloneToServerMigrationPlan({
      sourceDatabaseUrl: 'postgres://simplecrm:local@127.0.0.1:15432/simplecrm',
      targetDatabaseUrl: 'postgres://simplecrm:server@crm.example.com:5432/simplecrm',
      dumpPath: 'C:/SimpleCRM/migration/standalone.dump',
      attachments: {
        mode: 'rsync',
        sourceDir: 'C:/SimpleCRM/UserData/email-attachments/',
        target: 'simplecrm@example.com:/srv/simplecrm/attachments',
      },
    });
    const executed: string[] = [];

    expect(plan.steps).toEqual([
      {
        type: 'pg_dump',
        command: 'pg_dump',
        args: [
          '-Fc',
          '--file',
          'C:/SimpleCRM/migration/standalone.dump',
          'postgres://simplecrm:local@127.0.0.1:15432/simplecrm',
        ],
        redactedArgs: ['-Fc', '--file', 'C:/SimpleCRM/migration/standalone.dump', '<source-database-url>'],
      },
      {
        type: 'pg_restore',
        command: 'pg_restore',
        args: [
          '--clean',
          '--if-exists',
          '--no-owner',
          '--dbname',
          'postgres://simplecrm:server@crm.example.com:5432/simplecrm',
          'C:/SimpleCRM/migration/standalone.dump',
        ],
        redactedArgs: [
          '--clean',
          '--if-exists',
          '--no-owner',
          '--dbname',
          '<target-database-url>',
          'C:/SimpleCRM/migration/standalone.dump',
        ],
      },
      {
        type: 'rsync_attachments',
        command: 'rsync',
        args: [
          '-a',
          '--delete',
          'C:/SimpleCRM/UserData/email-attachments/',
          'simplecrm@example.com:/srv/simplecrm/attachments',
        ],
      },
    ]);

    const result = await runStandaloneToServerMigration(plan, {
      async runCommand(command, args) {
        executed.push(`${command} ${args.join(' ')}`);
      },
      async copyDirectory(sourceDir, targetDir) {
        executed.push(`copy ${sourceDir} ${targetDir}`);
      },
    });

    expect(result).toEqual({
      status: 'succeeded',
      executedSteps: ['pg_dump', 'pg_restore', 'rsync_attachments'],
    });
    expect(executed).toEqual([
      'pg_dump -Fc --file C:/SimpleCRM/migration/standalone.dump postgres://simplecrm:local@127.0.0.1:15432/simplecrm',
      'pg_restore --clean --if-exists --no-owner --dbname postgres://simplecrm:server@crm.example.com:5432/simplecrm C:/SimpleCRM/migration/standalone.dump',
      'rsync -a --delete C:/SimpleCRM/UserData/email-attachments/ simplecrm@example.com:/srv/simplecrm/attachments',
    ]);
  });

  test('standalone to server migration CLI validates args and prints a redacted dry-run plan', async () => {
    expect(parseMigrateStandaloneToServerCliArgs([
      '--source-database-url',
      'postgres://source',
      '--target-database-url',
      'postgres://target',
      '--dump-path',
      'standalone.dump',
      '--attachments-mode',
      'local-copy',
      '--attachments-source-dir',
      'C:/source/attachments',
      '--attachments-target-dir',
      'C:/target/attachments',
      '--dry-run',
    ])).toMatchObject({
      sourceDatabaseUrl: 'postgres://source',
      targetDatabaseUrl: 'postgres://target',
      dumpPath: 'standalone.dump',
      attachmentsMode: 'local-copy',
      dryRun: true,
    });
    expect(() => parseMigrateStandaloneToServerCliArgs(['--attachments-mode', 'ftp']))
      .toThrow('--attachments-mode');

    let stdout = '';
    let stderr = '';
    const code = await runMigrateStandaloneToServerCli({
      argv: [
        '--source-database-url',
        'postgres://source-secret',
        '--target-database-url',
        'postgres://target-secret',
        '--dump-path',
        'standalone.dump',
        '--dry-run',
      ],
      stdout: { write: (chunk) => { stdout += chunk; } },
      stderr: { write: (chunk) => { stderr += chunk; } },
    });

    expect(code).toBe(0);
    expect(stderr).toBe('');
    expect(stdout).toContain('"status": "dry_run"');
    expect(stdout).toContain('<source-database-url>');
    expect(stdout).toContain('<target-database-url>');
    expect(stdout).not.toContain('source-secret');
    expect(stdout).not.toContain('target-secret');
  });

  test('desktop standalone embedded PostgreSQL manager models AP-8 lifecycle without real binaries', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'simplecrm-standalone-'));
    const secrets = new Map<string, string>();
    const calls: string[] = [];
    let capturedInput: EmbeddedPostgresEngineInput | null = null;
    const secretStore = {
      async readSecret(name: string): Promise<string | null> {
        return secrets.get(name) ?? null;
      },
      async writeSecret(name: string, value: string): Promise<void> {
        calls.push(`secret:${name}`);
        secrets.set(name, value);
      },
    };

    const manager = new StandalonePostgresManager({
      userDataDir,
      secretStore,
      startupTimeoutMs: 500,
      shutdownTimeoutMs: 500,
      allocatePort: async (host) => {
        calls.push(`allocate:${host}`);
        return 15432;
      },
      engineFactory: (input) => {
        capturedInput = input;
        return {
          async initialise() {
            calls.push('initialise');
          },
          async start() {
            calls.push('start');
          },
          async stop() {
            calls.push('stop');
          },
          async createDatabase(database) {
            calls.push(`create-database:${database}`);
          },
          getPgClient() {
            return {
              async connect() {
                calls.push('client-connect');
              },
              async query(sql) {
                calls.push(`client-query:${sql}`);
                return { rows: [{ ok: 1 }] };
              },
              async end() {
                calls.push('client-end');
              },
            };
          },
        };
      },
    });

    try {
      const started = await manager.start();
      const secondStart = await manager.start();
      const generatedPassword = secrets.get(STANDALONE_POSTGRES_PASSWORD_SECRET);

      expect(secondStart).toBe(started);
      expect(capturedInput).toMatchObject({
        host: STANDALONE_POSTGRES_HOST,
        port: 15432,
        database: STANDALONE_POSTGRES_DATABASE,
        user: STANDALONE_POSTGRES_USER,
        password: generatedPassword,
      });
      expect(started).toEqual({
        mode: 'standalone',
        postgresMajor: STANDALONE_POSTGRES_MAJOR,
        host: STANDALONE_POSTGRES_HOST,
        port: 15432,
        database: STANDALONE_POSTGRES_DATABASE,
        user: STANDALONE_POSTGRES_USER,
        connectionString: buildStandalonePostgresConnectionString({
          host: STANDALONE_POSTGRES_HOST,
          port: 15432,
          database: STANDALONE_POSTGRES_DATABASE,
          user: STANDALONE_POSTGRES_USER,
          password: generatedPassword ?? '',
        }),
        layout: buildStandalonePostgresLayout(userDataDir),
      });
      expect(secrets.get(STANDALONE_MASTER_KEY_SECRET)).toMatch(/^[A-Za-z0-9+/]+=*$/);
      expect(calls).toEqual([
        `allocate:${STANDALONE_POSTGRES_HOST}`,
        `secret:${STANDALONE_POSTGRES_PASSWORD_SECRET}`,
        `secret:${STANDALONE_MASTER_KEY_SECRET}`,
        'initialise',
        'start',
        `create-database:${STANDALONE_POSTGRES_DATABASE}`,
        'client-connect',
        'client-query:SELECT 1',
        'client-end',
      ]);

      await manager.stop();
      expect(calls.at(-1)).toBe('stop');
    } finally {
      await manager.stop();
      rmSync(userDataDir, { recursive: true, force: true });
    }
  });

  test('desktop embedded PostgreSQL runtime factory adapts constructor exports and validates config', async () => {
    type FakeEmbeddedPostgresOptions = {
      databaseDir: string;
      port: number;
      user: string;
      password: string;
      authMethod: 'scram-sha-256';
      persistent: boolean;
      onLog?: (message: string) => void;
      onError?: (message: unknown) => void;
    };
    class FakeEmbeddedPostgres {
      constructor(readonly options: FakeEmbeddedPostgresOptions) {}

      async initialise(): Promise<void> {}

      async start(): Promise<void> {}

      async stop(): Promise<void> {}
    }

    const layout = buildStandalonePostgresLayout('C:/SimpleCRM/UserData');
    const logs: string[] = [];
    const factory = createEmbeddedPostgresEngineFactory(() => ({ default: FakeEmbeddedPostgres }));
    const engine = factory({
      layout,
      host: STANDALONE_POSTGRES_HOST,
      port: 15432,
      database: STANDALONE_POSTGRES_DATABASE,
      user: STANDALONE_POSTGRES_USER,
      password: 'p@ ss',
      logger: {
        debug: (message) => logs.push(`debug:${message}`),
        error: (message, meta) => logs.push(`error:${message}:${String(meta?.message)}`),
      },
    });

    expect(engine).toBeInstanceOf(FakeEmbeddedPostgres);
    expect((engine as FakeEmbeddedPostgres).options).toMatchObject({
      databaseDir: layout.dataDir,
      port: 15432,
      user: STANDALONE_POSTGRES_USER,
      password: 'p@ ss',
      authMethod: 'scram-sha-256',
      persistent: true,
    });
    (engine as FakeEmbeddedPostgres).options.onLog?.('ready');
    (engine as FakeEmbeddedPostgres).options.onError?.('boom');
    expect(logs).toEqual(['debug:ready', 'error:embedded PostgreSQL error:boom']);
    await expect(ensureStandaloneSecret({
      async readSecret() {
        return ' persisted ';
      },
      async writeSecret() {
        throw new Error('unexpected write');
      },
    }, STANDALONE_POSTGRES_PASSWORD_SECRET, 'password')).resolves.toBe(' persisted ');
    expect(buildStandalonePostgresConnectionString({
      host: STANDALONE_POSTGRES_HOST,
      port: 15432,
      database: 'simple crm',
      user: 'crm user',
      password: 'p@ ss',
    })).toBe('postgres://crm%20user:p%40%20ss@127.0.0.1:15432/simple%20crm');
    expect(() => buildStandalonePostgresLayout(' ')).toThrow('userDataDir');
    expect(() => buildStandalonePostgresConnectionString({
      host: STANDALONE_POSTGRES_HOST,
      port: 70000,
      database: STANDALONE_POSTGRES_DATABASE,
      user: STANDALONE_POSTGRES_USER,
      password: 'secret',
    })).toThrow('port');
    expect(() => createEmbeddedPostgresEngineFactory(() => ({}))({
      layout,
      host: STANDALONE_POSTGRES_HOST,
      port: 15432,
      database: STANDALONE_POSTGRES_DATABASE,
      user: STANDALONE_POSTGRES_USER,
      password: 'secret',
    })).toThrow('embedded-postgres module did not export a constructor');
  });

  test('desktop Electron standalone adapter uses Keytar secrets and env configuration', async () => {
    const values = new Map<string, string>();
    const calls: string[] = [];
    const keytar = {
      async getPassword(service: string, account: string): Promise<string | null> {
        calls.push(`get:${service}:${account}`);
        return values.get(`${service}:${account}`) ?? null;
      },
      async setPassword(service: string, account: string, password: string): Promise<void> {
        calls.push(`set:${service}:${account}`);
        values.set(`${service}:${account}`, password);
      },
      async deletePassword(service: string, account: string): Promise<boolean> {
        calls.push(`delete:${service}:${account}`);
        return values.delete(`${service}:${account}`);
      },
    };
    const store = createKeytarStandaloneSecretStore(keytar);

    await store.writeSecret(' custom-secret ', 'persisted');
    await expect(store.readSecret('custom-secret')).resolves.toBe('persisted');
    await expect(store.deleteSecret('custom-secret')).resolves.toBe(true);
    expect(standaloneSecretAccountName(STANDALONE_POSTGRES_PASSWORD_SECRET))
      .toBe(`standalone:${STANDALONE_POSTGRES_PASSWORD_SECRET}`);
    expect(resolveDesktopDeployMode({
      [SIMPLECRM_DESKTOP_MODE_ENV]: 'thin-client',
    })).toBe('server-client');
    expect(createElectronStandalonePostgresManager({
      app: { getPath: () => 'C:/SimpleCRM/UserData' },
      keytar,
      env: { [SIMPLECRM_DESKTOP_MODE_ENV]: 'server-client' },
    })).toBeNull();
    expect(() => resolveDesktopDeployMode({
      [SIMPLECRM_DESKTOP_MODE_ENV]: 'headless',
    })).toThrow('SIMPLECRM_DESKTOP_MODE');
    expect(() => createElectronStandalonePostgresManager({
      app: { getPath: () => 'C:/SimpleCRM/UserData' },
      env: { [SIMPLECRM_DESKTOP_MODE_ENV]: 'standalone' },
    })).toThrow('keytar module is required');

    const manager = createElectronStandalonePostgresManager({
      app: { getPath: () => 'C:/SimpleCRM/UserData' },
      keytar,
      env: {
        [SIMPLECRM_DESKTOP_MODE_ENV]: 'standalone',
        [SIMPLECRM_STANDALONE_PG_HOST_ENV]: '127.0.0.2',
        [SIMPLECRM_STANDALONE_PG_PORT_ENV]: '15444',
      },
      startupTimeoutMs: 100,
      shutdownTimeoutMs: 100,
      engineFactory: (input) => ({
        async initialise() {
          calls.push(`initialise:${input.host}:${input.port}`);
        },
        async start() {
          calls.push(`start:${input.database}:${input.user}`);
        },
        async stop() {
          calls.push('stop');
        },
      }),
    });

    expect(manager).toBeInstanceOf(StandalonePostgresManager);
    const started = await manager?.start();
    await manager?.stop();

    expect(started).toMatchObject({
      mode: 'standalone',
      host: '127.0.0.2',
      port: 15444,
      database: STANDALONE_POSTGRES_DATABASE,
      user: STANDALONE_POSTGRES_USER,
    });
    expect(values.has(`${STANDALONE_KEYTAR_SERVICE}:${standaloneSecretAccountName(STANDALONE_POSTGRES_PASSWORD_SECRET)}`))
      .toBe(true);
    expect(values.has(`${STANDALONE_KEYTAR_SERVICE}:${standaloneSecretAccountName(STANDALONE_MASTER_KEY_SECRET)}`))
      .toBe(true);
    expect(calls).toEqual([
      `set:${STANDALONE_KEYTAR_SERVICE}:standalone:custom-secret`,
      `get:${STANDALONE_KEYTAR_SERVICE}:standalone:custom-secret`,
      `delete:${STANDALONE_KEYTAR_SERVICE}:standalone:custom-secret`,
      `get:${STANDALONE_KEYTAR_SERVICE}:${standaloneSecretAccountName(STANDALONE_POSTGRES_PASSWORD_SECRET)}`,
      `set:${STANDALONE_KEYTAR_SERVICE}:${standaloneSecretAccountName(STANDALONE_POSTGRES_PASSWORD_SECRET)}`,
      `get:${STANDALONE_KEYTAR_SERVICE}:${standaloneSecretAccountName(STANDALONE_MASTER_KEY_SECRET)}`,
      `set:${STANDALONE_KEYTAR_SERVICE}:${standaloneSecretAccountName(STANDALONE_MASTER_KEY_SECRET)}`,
      'initialise:127.0.0.2:15444',
      `start:${STANDALONE_POSTGRES_DATABASE}:${STANDALONE_POSTGRES_USER}`,
      'stop',
    ]);
    expect(() => createElectronStandalonePostgresManager({
      app: { getPath: () => 'C:/SimpleCRM/UserData' },
      keytar,
      env: { [SIMPLECRM_STANDALONE_PG_PORT_ENV]: '70000' },
    })).toThrow('SIMPLECRM_STANDALONE_PG_PORT');
  });

  test('desktop standalone PostgreSQL stop uses kill fallback after graceful shutdown timeout', async () => {
    const calls: string[] = [];
    const warnings: string[] = [];
    const manager = new StandalonePostgresManager({
      userDataDir: 'C:/SimpleCRM/UserData',
      port: 15433,
      password: 'fixed-password',
      startupTimeoutMs: 100,
      shutdownTimeoutMs: 100,
      logger: {
        warn: (message) => warnings.push(message),
      },
      engineFactory: () => ({
        async initialise() {
          calls.push('initialise');
        },
        async start() {
          calls.push('start');
        },
        async stop() {
          calls.push('stop');
          await new Promise<void>(() => undefined);
        },
        async kill() {
          calls.push('kill');
        },
      }),
    });

    await manager.start();
    await manager.stop();

    expect(calls).toEqual(['initialise', 'start', 'stop', 'kill']);
    expect(warnings).toEqual(['embedded PostgreSQL stop timed out; using kill fallback']);
  });

  test('core runtime requires an explicit workspace', () => {
    const ports = {
      paths: {
        userDataDir: () => '/tmp/simplecrm',
        attachmentsDir: () => '/tmp/simplecrm/email-attachments',
        tempDir: () => '/tmp',
      },
      dialog: {
        confirm: jest.fn(async () => true),
        chooseFile: jest.fn(async () => null),
      },
      secrets: {
        readSecret: jest.fn(async () => null),
        writeSecret: jest.fn(async () => undefined),
        deleteSecret: jest.fn(async () => undefined),
      },
      logger: {
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn(),
        error: jest.fn(),
      },
    };

    expect(() => createCoreRuntime({ mode: 'server', workspaceId: '', ports })).toThrow('workspaceId');
    expect(createCoreRuntime({ mode: 'server', workspaceId: 'workspace-1', ports }).workspaceId).toBe('workspace-1');
  });

  test('server config parsing rejects unsafe or invalid values', () => {
    expect(normalizePublicBaseUrl('https://crm.example.com/')).toBe('https://crm.example.com');
    expect(() => normalizePublicBaseUrl('file:///tmp/simplecrm')).toThrow('http or https');
    expect(parsePort('3000')).toBe(3000);
    expect(() => parsePort('70000')).toThrow('PORT');
    expect(parseAuthInvitationMailConfig({
      PUBLIC_BASE_URL: 'https://crm.example.com/',
      AUTH_INVITE_SMTP_PORT: '587',
      AUTH_INVITE_SMTP_TLS: 'true',
      AUTH_INVITE_SMTP_TIMEOUT_MS: '90000',
    })).toBeUndefined();
    expect(parseAuthInvitationMailConfig({
      PUBLIC_BASE_URL: 'https://crm.example.com/',
      AUTH_INVITE_FROM: 'crm@example.com',
      AUTH_INVITE_SMTP_HOST: 'smtp.example.com',
      AUTH_INVITE_SMTP_PASSWORD: 'smtp-secret',
      AUTH_INVITE_SMTP_PORT: '465',
      AUTH_INVITE_SMTP_TLS: 'yes',
      AUTH_INVITE_SMTP_TIMEOUT_MS: '15000',
    })).toEqual({
      publicBaseUrl: 'https://crm.example.com',
      from: 'crm@example.com',
      host: 'smtp.example.com',
      port: 465,
      tls: true,
      user: 'crm@example.com',
      password: 'smtp-secret',
      timeoutMs: 15000,
    });
    expect(() => parseAuthInvitationMailConfig({
      PUBLIC_BASE_URL: 'https://crm.example.com/',
      AUTH_INVITE_FROM: 'crm@example.com',
      AUTH_INVITE_SMTP_HOST: 'smtp.example.com',
    })).toThrow('AUTH_INVITE_SMTP_PASSWORD');
    expect(() => parseServerEditionConfig({
      DATABASE_URL: 'postgres://simplecrm@postgres/simplecrm',
      SIMPLECRM_MASTER_KEY: CI_SMOKE_MASTER_KEY,
      ACCESS_TOKEN_SECRET: CI_SMOKE_ACCESS_TOKEN_SECRET,
      PUBLIC_BASE_URL: 'https://crm.example.com/',
      NODE_ENV: 'production',
    })).toThrow('known weak CI smoke-test value');
    for (const weakMasterKey of KNOWN_WEAK_CI_SMOKE_MASTER_KEYS) {
      expect(() => parseServerEditionConfig({
        DATABASE_URL: 'postgres://simplecrm@postgres/simplecrm',
        SIMPLECRM_MASTER_KEY: weakMasterKey,
        ACCESS_TOKEN_SECRET: Buffer.alloc(32, 1).toString('base64'),
        PUBLIC_BASE_URL: 'https://crm.example.com/',
        NODE_ENV: 'production',
      })).toThrow('SIMPLECRM_MASTER_KEY');
    }
    for (const weakAccessTokenSecret of KNOWN_WEAK_CI_SMOKE_ACCESS_TOKEN_SECRETS) {
      expect(() => parseServerEditionConfig({
        DATABASE_URL: 'postgres://simplecrm@postgres/simplecrm',
        SIMPLECRM_MASTER_KEY: Buffer.alloc(32, 2).toString('base64'),
        ACCESS_TOKEN_SECRET: weakAccessTokenSecret,
        PUBLIC_BASE_URL: 'https://crm.example.com/',
        NODE_ENV: 'production',
      })).toThrow('ACCESS_TOKEN_SECRET');
    }
    expect(parseServerEditionConfig({
      DATABASE_URL: 'postgres://simplecrm@postgres/simplecrm',
      SIMPLECRM_MASTER_KEY: CI_SMOKE_MASTER_KEY,
      ACCESS_TOKEN_SECRET: CI_SMOKE_ACCESS_TOKEN_SECRET,
      PUBLIC_BASE_URL: 'https://crm.example.com/',
      NODE_ENV: 'production',
      CI: 'true',
    })).toMatchObject({
      databaseUrl: 'postgres://simplecrm@postgres/simplecrm',
    });
    expect(parseServerEditionConfig({
      DATABASE_URL: 'postgres://simplecrm@postgres/simplecrm',
      SIMPLECRM_MASTER_KEY: 'base64-master-key',
      ACCESS_TOKEN_SECRET: Buffer.alloc(32, 1).toString('base64'),
      PUBLIC_BASE_URL: 'https://crm.example.com/',
      CORS_ALLOWED_ORIGINS: 'https://app.example.com, http://localhost:5173/path, null',
      HOST: '127.0.0.1',
      PORT: '3001',
      ACCESS_TOKEN_KEY_ID: 'prod',
      JOB_WORKER_ENABLED: 'yes',
      JOB_WORKER_MAIL_ACCOUNT_COUNT: '12',
      JOB_WORKER_AI_CONCURRENCY: '8',
      JOB_WORKER_MIGRATE_ON_START: 'on',
    })).toMatchObject({
      databaseUrl: 'postgres://simplecrm@postgres/simplecrm',
      accessTokenKeyId: 'prod',
      publicBaseUrl: 'https://crm.example.com',
      corsAllowedOrigins: ['https://crm.example.com', 'https://app.example.com', 'http://localhost:5173', 'null'],
      attachmentsDir: '/app/data/attachments',
      host: '127.0.0.1',
      port: 3001,
      jobWorker: {
        enabled: true,
        mailAccountCount: 12,
        aiConcurrency: 8,
        migrateOnStart: true,
      },
    });
    expect(parseServerJobWorkerConfig({})).toEqual({
      enabled: false,
      mailAccountCount: 0,
      aiConcurrency: undefined,
      migrateOnStart: false,
    });
    expect(() => parseServerJobWorkerConfig({ JOB_WORKER_ENABLED: 'maybe' })).toThrow('JOB_WORKER_ENABLED');
    expect(() => parseServerJobWorkerConfig({ JOB_WORKER_AI_CONCURRENCY: '101' })).toThrow('JOB_WORKER_AI_CONCURRENCY');
    expect(() => parseServerEditionConfig({
      DATABASE_URL: 'postgres://simplecrm@postgres/simplecrm',
      SIMPLECRM_MASTER_KEY: 'base64-master-key',
      ACCESS_TOKEN_SECRET: Buffer.alloc(32, 1).toString('base64'),
      PUBLIC_BASE_URL: 'https://crm.example.com',
      CORS_ALLOWED_ORIGINS: 'file://desktop',
    })).toThrow('CORS_ALLOWED_ORIGINS');
  });

  test('server bootstrap creates DB-backed API ports with audit and events', () => {
    const accessTokenSigner = {
      keyId: 'test',
      secret: Buffer.alloc(32, 2),
    };
    const fakeDb = { destroy: jest.fn(async () => undefined) };
    const ports = createPostgresServerApiPorts({
      db: fakeDb as Parameters<typeof createPostgresServerApiPorts>[0]['db'],
      accessTokenSigner,
    });
    const inviteMailPorts = createPostgresServerApiPorts({
      db: fakeDb as Parameters<typeof createPostgresServerApiPorts>[0]['db'],
      accessTokenSigner,
      authInvitationMail: {
        publicBaseUrl: 'https://crm.example.com',
        from: 'crm@example.com',
        host: 'smtp.example.com',
        port: 587,
        tls: true,
        user: 'crm@example.com',
        password: 'smtp-secret',
      },
    });
    const secretBackedPorts = createPostgresServerApiPorts({
      db: fakeDb as Parameters<typeof createPostgresServerApiPorts>[0]['db'],
      accessTokenSigner,
      secrets: {
        async writeSecret() {
          throw new Error('not used');
        },
        async readSecret() {
          return null;
        },
        async deleteSecret() {
          return false;
        },
        async rotateSecret() {
          return null;
        },
      },
    });
    expect(ports.authInvitationMailer).toBeUndefined();
    expect(inviteMailPorts.authInvitationMailer).toBeDefined();
    expect(ports.aiProfiles).toBeDefined();
    expect(ports.aiPrompts).toBeDefined();
    expect(ports.automationApiKeys).toBeDefined();
    expect(ports.activityLog).toBeDefined();
    expect(ports.audit).toBeDefined();
    expect(ports.calendarEvents).toBeDefined();
    expect(ports.customerCustomFields).toBeDefined();
    expect(ports.customerCustomFieldValues).toBeDefined();
    expect(ports.customers).toBeDefined();
    expect(ports.deals).toBeDefined();
    expect(ports.emailAccounts).toBeDefined();
    expect(ports.emailAccountSignatures).toBeDefined();
    expect(ports.emailAttachmentContent).toBeDefined();
    expect(ports.emailAttachments).toBeDefined();
    expect(ports.emailCannedResponses).toBeDefined();
    expect(ports.emailCategories).toBeDefined();
    expect(ports.emailDiagnostics).toBeDefined();
    expect(ports.emailFolders).toBeDefined();
    expect(ports.emailInternalNotes).toBeDefined();
    expect(ports.emailMessageCategories).toBeDefined();
    expect(ports.emailMessages).toBeDefined();
    expect(ports.emailMessageTags).toBeDefined();
    expect(ports.emailReadReceipts).toBeDefined();
    expect(ports.emailReadReceiptResponder).toBeDefined();
    expect(ports.emailRemoteContentAllowlist).toBeDefined();
    expect(ports.emailTeamMembers).toBeDefined();
    expect(ports.emailThreadAliases).toBeDefined();
    expect(ports.emailThreadEdges).toBeDefined();
    expect(ports.emailThreads).toBeDefined();
    expect(ports.events?.subscribe).toBeDefined();
    expect(ports.events?.replay).toBeDefined();
    expect(ports.jtlFirmen).toBeDefined();
    expect(ports.jtlVersandarten).toBeDefined();
    expect(ports.jtlWarenlager).toBeDefined();
    expect(ports.jtlZahlungsarten).toBeDefined();
    expect(ports.pgpIdentities).toBeDefined();
    expect(ports.pgpMessages).toBeUndefined();
    expect(secretBackedPorts.pgpMessages).toBeDefined();
    expect(ports.pgpPeerKeys).toBeDefined();
    expect(ports.products).toBeDefined();
    expect(ports.savedViews).toBeDefined();
    expect(ports.spamDecisions).toBeDefined();
    expect(ports.spamFeatureStats).toBeDefined();
    expect(ports.spamLearningEvents).toBeDefined();
    expect(ports.spamListEntries).toBeDefined();
    expect(ports.tasks).toBeDefined();
    expect(ports.workflowDelayedJobs).toBeDefined();
    expect(ports.workflowForwardDedup).toBeDefined();
    expect(ports.workflowKnowledgeBases).toBeDefined();
    expect(ports.workflowKnowledgeChunks).toBeDefined();
    expect(ports.workflowMessageApplied).toBeDefined();
    expect(ports.workflowRuns).toBeDefined();
    expect(ports.workflowRunSteps).toBeDefined();
    expect(ports.workflowVersions).toBeDefined();
    expect(ports.workflows).toBeDefined();
  });

  test('auth invitation mailer sends SMTP invitation with absolute accept URL', async () => {
    const smtpSends: unknown[] = [];
    const mailer = createAuthInvitationMailerPort({
      publicBaseUrl: 'https://crm.example.com/app/',
      from: 'crm@example.com',
      host: 'smtp.example.com',
      port: 465,
      tls: true,
      user: 'smtp-user',
      password: 'smtp-secret',
      timeoutMs: 15000,
      now: () => new Date('2026-06-04T12:00:00.000Z'),
      smtpSend: async (input) => {
        smtpSends.push(input);
      },
    });

    await expect(mailer.sendInvitation({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      acceptPath: '/login?invite=invite-token-1',
      invitation: {
        id: 'auth-invite-1',
        email: 'invited@example.com',
        displayName: 'Invited User',
        role: 'user',
        invitedByUserId: USER_A_ID,
        acceptedUserId: null,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: '2026-06-11T12:00:00.000Z',
        createdAt: '2026-06-04T12:00:00.000Z',
      },
    })).resolves.toEqual({
      status: 'sent',
      recipient: 'invited@example.com',
      sentAt: '2026-06-04T12:00:00.000Z',
    });

    expect(smtpSends).toHaveLength(1);
    expect(smtpSends[0]).toMatchObject({
      host: 'smtp.example.com',
      port: 465,
      tls: true,
      user: 'smtp-user',
      password: 'smtp-secret',
      envelopeFrom: 'crm@example.com',
      recipients: ['invited@example.com'],
      timeoutMs: 15000,
    });
    const rfc822 = (smtpSends[0] as { rfc822: string }).rfc822;
    expect(rfc822).toContain('Subject: SimpleCRM Einladung');
    expect(rfc822).toContain('To: invited@example.com');
    expect(rfc822).toContain('https://crm.example.com/login?invite=invite-token-1');
    expect(rfc822).not.toContain('smtp-secret');
  });

  test('attachment storage path resolver keeps downloads inside the configured root', () => {
    const root = join(tmpdir(), 'simplecrm-attachments-root');
    const relativePath = join('workspace-a', 'message-1', 'file.pdf');
    const insideAbsolutePath = join(root, 'workspace-a', 'message-1', 'file.pdf');
    const outsideAbsolutePath = join(tmpdir(), 'simplecrm-outside-attachments', 'file.pdf');

    expect(resolveAttachmentStoragePath(root, relativePath)).toBe(insideAbsolutePath);
    expect(resolveAttachmentStoragePath(root, insideAbsolutePath)).toBe(insideAbsolutePath);
    expect(resolveAttachmentStoragePath(root, '..foo.pdf')).toBe(join(root, '..foo.pdf'));
    expect(resolveAttachmentStoragePath(root, join('..', 'file.pdf'))).toBeNull();
    expect(resolveAttachmentStoragePath(root, root)).toBeNull();
    expect(resolveAttachmentStoragePath(root, outsideAbsolutePath)).toBeNull();
  });

});
