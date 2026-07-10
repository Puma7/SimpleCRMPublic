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

describe('server edition foundation — sqlite-import', () => {
  test('sqlite database source reads counts, rowid tables, and binary values without interpolating identifiers', async () => {
    const database = makeSqliteDatabaseLike();
    const source = createSqliteDatabaseMigrationSource(database);

    await expect(source.tableExists('customers')).resolves.toBe(true);
    await expect(source.tableExists('missing_table')).resolves.toBe(false);
    await expect(source.countRows('customers')).resolves.toBe(2);

    const customerRows = await source.readRows({
      tableName: 'customers',
      primaryKey: 'id',
      afterPrimaryKey: '1',
      limit: 10,
    });
    expect(customerRows).toEqual([{
      id: 2,
      name: 'Bob',
      avatar: {
        encoding: 'base64',
        type: 'sqlite_blob',
        value: Buffer.from('avatar').toString('base64'),
      },
    }]);

    const categoryRows = await source.readRows({
      tableName: 'email_message_categories',
      primaryKey: 'rowid',
      afterPrimaryKey: null,
      limit: 5,
    });
    expect(categoryRows).toEqual([{ rowid: 7, message_id: 12, category_id: 3 }]);
    expect(database.statements.some((sql) => sql.includes('customers;DROP'))).toBe(false);
    await expect(source.countRows('customers;DROP')).rejects.toThrow('Invalid SQLite tableName');
  });

  test('sqlite attachment-copying source rewrites storage paths and rejects source traversal', async () => {
    const sourceRoot = join(tmpdir(), 'simplecrm-source-attachments');
    const targetRoot = join(tmpdir(), 'simplecrm-target-attachments');
    const copied: Array<{ source: string; target: string }> = [];
    const madeDirs: string[] = [];
    const source = createAttachmentCopyingSqliteSource({
      source: makeSqliteSource({
        email_message_attachments: [{
          id: 31,
          message_id: 11,
          filename_display: 'invoice:31.pdf',
          storage_path: join('11', 'invoice-31.pdf'),
        }],
      }),
      workspaceId: WORKSPACE_A_ID,
      sourceAttachmentsRoot: sourceRoot,
      targetAttachmentsRoot: targetRoot,
      async mkdir(path) {
        madeDirs.push(path);
      },
      async copyFile(sourcePath, targetPath) {
        copied.push({ source: sourcePath, target: targetPath });
      },
    });

    const rows = await source.readRows({
      tableName: 'email_message_attachments',
      primaryKey: 'id',
      afterPrimaryKey: null,
      limit: 10,
    });

    expect(rows[0].storage_path).toBe(`${WORKSPACE_A_ID}/email-attachments/11/31-invoice_31.pdf`);
    expect(copied).toEqual([{
      source: join(sourceRoot, '11', 'invoice-31.pdf'),
      target: join(targetRoot, WORKSPACE_A_ID, 'email-attachments', '11', '31-invoice_31.pdf'),
    }]);
    expect(madeDirs[0]).toBe(join(targetRoot, WORKSPACE_A_ID, 'email-attachments', '11'));
    expect(buildServerAttachmentStoragePath({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      sourcePk: 31,
      filename: 'invoice:31.pdf',
    })).toBe(`${WORKSPACE_A_ID}/email-attachments/11/31-invoice_31.pdf`);
    expect(resolveSourceAttachmentPath(sourceRoot, join('..', 'outside.pdf'))).toBeNull();
  });

  test('sqlite attachment-copying source fails closed for missing or unsafe storage paths', async () => {
    const sourceRoot = join(tmpdir(), 'simplecrm-source-attachments');
    const missingPathSource = createAttachmentCopyingSqliteSource({
      source: makeSqliteSource({
        email_message_attachments: [{ id: 31, message_id: 11, filename_display: 'a.pdf' }],
      }),
      workspaceId: WORKSPACE_A_ID,
      sourceAttachmentsRoot: sourceRoot,
      targetAttachmentsRoot: join(tmpdir(), 'simplecrm-target-attachments'),
      async copyFile() {
        throw new Error('copy should not run');
      },
    });

    await expect(missingPathSource.readRows({
      tableName: 'email_message_attachments',
      primaryKey: 'id',
      afterPrimaryKey: null,
      limit: 10,
    })).rejects.toThrow('missing storage_path');

    const outsideSource = createAttachmentCopyingSqliteSource({
      source: makeSqliteSource({
        email_message_attachments: [{
          id: 31,
          message_id: 11,
          filename_display: 'a.pdf',
          storage_path: join('..', 'outside.pdf'),
        }],
      }),
      workspaceId: WORKSPACE_A_ID,
      sourceAttachmentsRoot: sourceRoot,
      targetAttachmentsRoot: join(tmpdir(), 'simplecrm-target-attachments'),
      async copyFile() {
        throw new Error('copy should not run');
      },
    });

    await expect(outsideSource.readRows({
      tableName: 'email_message_attachments',
      primaryKey: 'id',
      afterPrimaryKey: null,
      limit: 10,
    })).rejects.toThrow('outside source attachment root');
  });

  test('sqlite file fingerprint uses sha256 and rejects empty paths', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'simplecrm-sqlite-fingerprint-'));
    const filePath = join(dir, 'source.sqlite');
    try {
      writeFileSync(filePath, 'sqlite-fixture');
      await expect(computeSqliteFileFingerprint(filePath)).resolves.toBe(
        `sha256:${createHash('sha256').update('sqlite-fixture').digest('hex')}`,
      );
      await expect(computeSqliteFileFingerprint(' ')).rejects.toThrow('SQLite file path is required');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test('postgres sqlite final import orchestrates all final table mappers in dependency order', async () => {
    const commands = buildPostgresSqliteFinalImportCommands({
      workspaceId: 'workspace-a',
      runId: 'run-1',
    });
    expect(commands).toHaveLength(49);
    expect(commands[0]).toMatchObject({ domain: 'core_crm', tableName: 'sync_info' });
    expect(commands[14]).toMatchObject({ domain: 'core_crm', tableName: 'jtl_versandarten' });
    expect(commands[15]).toMatchObject({ domain: 'core_mail', tableName: 'email_accounts' });
    expect(commands[16]).toMatchObject({ domain: 'core_mail', tableName: 'email_account_mail_settings' });
    expect(commands[32]).toMatchObject({ domain: 'workflow_security', tableName: 'email_ai_profiles' });
    expect(commands[48]).toMatchObject({ domain: 'workflow_security', tableName: 'pgp_peer_keys' });
    expect(commands.every((command) => command.params[0] === 'workspace-a' && command.params[2] === 'run-1'))
      .toBe(true);
    expect(commands.map((command) => command.sql).join('\n')).not.toContain('workspace-a');

    const client = makeCoreCrmImportPgClient();
    const result = await runPostgresSqliteFinalImport(client, {
      workspaceId: 'workspace-a',
      runId: 'run-1',
    });

    expect(client.queries).toHaveLength(49);
    expect(client.queries[0].params).toEqual(['workspace-a', 'sync_info', 'run-1']);
    expect(client.queries[48].params).toEqual(['workspace-a', 'pgp_peer_keys', 'run-1']);
    expect(result.domains.map((domain) => [domain.domain, domain.commandCount])).toEqual([
      ['core_crm', 15],
      ['core_mail', 17],
      ['workflow_security', 17],
    ]);
  });

  test('postgres sqlite final import supports domain subsets and rejects ambiguous domains', async () => {
    const commands = buildPostgresSqliteFinalImportCommands({
      workspaceId: 'workspace-a',
      runId: 'run-1',
      domains: ['workflow_security'],
    });
    expect(commands).toHaveLength(17);
    expect(commands[0]).toMatchObject({ domain: 'workflow_security', tableName: 'email_ai_profiles' });

    expect(() => buildPostgresSqliteFinalImportCommands({
      workspaceId: ' ',
      runId: 'run-1',
    })).toThrow('workspaceId');
    expect(() => buildPostgresSqliteFinalImportCommands({
      workspaceId: 'workspace-a',
      runId: ' ',
    })).toThrow('runId');
    expect(() => buildPostgresSqliteFinalImportCommands({
      workspaceId: 'workspace-a',
      runId: 'run-1',
      domains: [],
    })).toThrow('At least one');
    expect(() => buildPostgresSqliteFinalImportCommands({
      workspaceId: 'workspace-a',
      runId: 'run-1',
      domains: ['core_mail', 'core_mail'],
    })).toThrow('Duplicate');
  });

  test('migrate-from-sqlite CLI parses staging and finalization options', async () => {
    expect(parseMigrateFromSqliteCliArgs([
      '--sqlite',
      'crm.sqlite',
      '--workspace-id',
      WORKSPACE_A_ID,
      '--stage-only',
      '--batch-size',
      '25',
      '--copy-attachments',
      '--source-attachments-dir',
      'C:/source/email-attachments',
      '--attachments-dir',
      '/app/data/attachments',
      '--domain',
      'core_mail',
    ])).toMatchObject({
      mode: 'stage',
      sqlitePath: 'crm.sqlite',
      workspaceId: WORKSPACE_A_ID,
      batchSize: 25,
      copyAttachments: true,
      sourceAttachmentsDir: 'C:/source/email-attachments',
      attachmentsDir: '/app/data/attachments',
      domains: ['core_mail'],
    });

    expect(parseMigrateFromSqliteCliArgs([
      '--finalize-only',
      '--run-id',
      'run-1',
      '--workspace-id',
      WORKSPACE_A_ID,
      '--domains',
      'core_crm,workflow_security',
    ])).toMatchObject({
      mode: 'finalize',
      runId: 'run-1',
      domains: ['core_crm', 'workflow_security'],
    });

    expect(() => parseMigrateFromSqliteCliArgs(['--domain', 'unknown'])).toThrow('Unknown final');
    expect(() => parseMigrateFromSqliteCliArgs(['--stage-only', '--finalize-only']))
      .toThrow('Use only one');
    const invalidIo = makeCliIo();
    await expect(runMigrateFromSqliteCli({
      argv: ['--sqlite', 'crm.sqlite', '--workspace-id', WORKSPACE_A_ID, '--dry-run', '--copy-attachments'],
      env: { DATABASE_URL: 'postgres://simplecrm@postgres/simplecrm' },
      stdout: invalidIo.stdout,
      stderr: invalidIo.stderr,
    })).resolves.toBe(2);
    expect(invalidIo.stderrOutput()).toContain('--copy-attachments cannot be combined with --dry-run');
  });

  test('migrate-from-sqlite CLI stages source rows, applies RLS session, and finalizes selected domains', async () => {
    const source = makeSqliteSource({
      customers: [{ id: 1, name: 'Alice' }],
    });
    const client = makeMigrateFromSqlitePgClient();
    const io = makeCliIo();
    let openedPath = '';
    let closed = false;
    let receivedDatabaseUrl = '';

    const exitCode = await runMigrateFromSqliteCli({
      argv: [
        '--sqlite',
        'crm.sqlite',
        '--workspace-id',
        WORKSPACE_A_ID,
        '--domain',
        'core_crm',
      ],
      env: { DATABASE_URL: 'postgres://simplecrm:secret-password@postgres:5432/simplecrm' },
      stdout: io.stdout,
      stderr: io.stderr,
      plan: makeSqlitePlan(['customers']),
      createClient(databaseUrl) {
        receivedDatabaseUrl = databaseUrl;
        return client;
      },
      openSource(sqlitePath) {
        openedPath = sqlitePath;
        return {
          source,
          close() {
            closed = true;
          },
        };
      },
      async computeFingerprint(sqlitePath) {
        return `sha256:${sqlitePath}`;
      },
    });

    expect(exitCode).toBe(0);
    expect(client.connected).toBe(true);
    expect(client.ended).toBe(true);
    expect(closed).toBe(true);
    expect(openedPath).toBe('crm.sqlite');
    expect(receivedDatabaseUrl).toBe('postgres://simplecrm:secret-password@postgres:5432/simplecrm');
    expect(client.queries[0].sql).toContain("set_config('app.workspace_id'");
    expect(client.queries[0].params).toEqual([WORKSPACE_A_ID, '', 'system', 'off']);
    expect(client.queries.some((query) => query.sql.includes('INSERT INTO sqlite_import_rows'))).toBe(true);
    expect(client.queries.some((query) => query.sql.includes('INSERT INTO customers'))).toBe(true);
    expect(client.queries.some((query) => query.sql.includes('INSERT INTO email_accounts'))).toBe(false);

    const output = JSON.parse(io.stdoutOutput());
    expect(output.runId).toBe('run-1');
    expect(output.staging.status).toBe('succeeded');
    expect(output.finalImport.domains).toEqual([expect.objectContaining({
      domain: 'core_crm',
      commandCount: 15,
    })]);
    expect(io.stderrOutput()).toBe('');
    expect(io.stdoutOutput()).not.toContain('secret-password');
  });

  test('core CRM import mapper builds ordered parameterized commands from staging rows', () => {
    const commands = buildCoreCrmImportCommands({
      workspaceId: 'workspace-a',
      runId: 'run-1',
    });

    expect(commands.map((command) => command.tableName)).toEqual([
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
    ]);
    expect(commands.every((command) => command.params[0] === 'workspace-a' && command.params[2] === 'run-1'))
      .toBe(true);
    expect(commands[1].sql).toContain('INSERT INTO customers');
    expect(commands[1].sql).toContain('ON CONFLICT (workspace_id, source_sqlite_id)');
    expect(commands[1].sql).toContain("r.source_row->>'customerNumber'");
    expect(commands[1].sql).toContain("CASE lower(NULLIF(r.source_row->>'jtl_blocked', ''))");
    expect(commands[3].sql).toContain('LEFT JOIN customers c');
    expect(commands[5].sql).toContain('LEFT JOIN deals d');
    expect(commands[5].sql).toContain('LEFT JOIN products p');
    expect(commands[6].sql).toContain('INSERT INTO calendar_events');
    expect(commands[8].sql).toContain('LEFT JOIN customer_custom_fields f');
    expect(commands[9].sql).toContain('LEFT JOIN deals d');
    expect(commands[11].sql).toContain('r.source_pk::bigint');
    expect(JSON.stringify(commands)).not.toContain('secret-password');
  });

  test('core CRM import runner executes commands without interpolating workspace or run ids', async () => {
    const client = makeCoreCrmImportPgClient();

    await runPostgresCoreCrmImport(client, {
      workspaceId: 'workspace-a',
      runId: 'run-1',
    });

    expect(client.queries).toHaveLength(15);
    expect(client.queries[0].params).toEqual(['workspace-a', 'sync_info', 'run-1']);
    expect(client.queries[14].params).toEqual(['workspace-a', 'jtl_versandarten', 'run-1']);
    expect(client.queries[1].sql).not.toContain('workspace-a');
    expect(client.queries[1].sql).not.toContain('run-1');
    expect(() => buildCoreCrmImportCommands({ workspaceId: ' ', runId: 'run-1' })).toThrow('workspaceId');
    expect(() => buildCoreCrmImportCommands({ workspaceId: 'workspace-a', runId: ' ' })).toThrow('runId');
  });

  test('core mail import mapper builds ordered parameterized commands from staging rows', () => {
    const commands = buildCoreMailImportCommands({
      workspaceId: 'workspace-a',
      runId: 'run-1',
    });

    expect(commands.map((command) => command.tableName)).toEqual([
      'email_accounts',
      'email_account_mail_settings',
      'email_folders',
      'email_team_members',
      'email_threads',
      'email_messages',
      'email_message_attachments',
      'email_message_tags',
      'email_categories',
      'email_message_categories',
      'email_internal_notes',
      'email_canned_responses',
      'email_account_signatures',
      'email_remote_content_allowlist',
      'email_read_receipt_log',
      'email_thread_edges',
      'email_thread_aliases',
    ]);
    expect(commands.every((command) => command.params[0] === 'workspace-a' && command.params[2] === 'run-1'))
      .toBe(true);
    expect(commands[0].sql).toContain('INSERT INTO email_accounts');
    expect(commands[0].sql).toContain('imap_password_secret_id');
    expect(commands[0].sql).toContain('smtp_password_secret_id');
    expect(commands[0].sql).toContain('oauth_refresh_secret_id');
    expect(commands[0].sql).toContain('NULL::uuid');
    expect(commands[1].sql).toContain('INSERT INTO email_account_mail_settings');
    expect(commands[1].sql).toContain("r.source_row->>'ticket_prefix'");
    expect(commands[2].sql).toContain('LEFT JOIN email_accounts a');
    expect(commands[4].sql).toContain('account_source_sqlite_id');
    expect(commands[5].sql).toContain('LEFT JOIN email_folders f');
    expect(commands[5].sql).toContain("r.source_row->>'from_json'");
    expect(commands[5].sql).toContain("r.source_row->>'auth_spf'");
    expect(commands[5].sql).toContain("r.source_row->>'rspamd_score'");
    expect(commands[5].sql).toContain("r.source_row->>'reply_suggestion_text'");
    expect(commands[5].sql).toContain('reply_suggestion_updated_at = EXCLUDED.reply_suggestion_updated_at');
    expect(commands[5].sql).toContain('ON CONFLICT (workspace_id, source_sqlite_id)');
    expect(commands[5].sql).toContain('legacy_assigned_to_user_id');
    expect(commands[5].sql).not.toContain("assigned_to_user_id', '')::uuid");
    expect(commands[6].sql).toContain('LEFT JOIN email_messages m');
    expect(commands[9].sql).toContain('LEFT JOIN email_categories c');
    expect(commands[11].sql).toContain('override_key');
    expect(commands[15].sql).toContain('LEFT JOIN email_messages parent');
    expect(commands[16].sql).toContain('account_source_sqlite_id');
    expect(commands[16].sql).toContain("r.source_row->>'alias_thread_id' <> r.source_row->>'canonical_thread_id'");
    expect(commands.map((command) => command.sql).join('\n')).not.toContain('workspace-a');
  });

  test('core mail import runner executes all commands without interpolating workspace or run ids', async () => {
    const client = makeCoreCrmImportPgClient();

    await runPostgresCoreMailImport(client, {
      workspaceId: 'workspace-a',
      runId: 'run-1',
    });

    expect(client.queries).toHaveLength(17);
    expect(client.queries[0].params).toEqual(['workspace-a', 'email_accounts', 'run-1']);
    expect(client.queries[16].params).toEqual(['workspace-a', 'email_thread_aliases', 'run-1']);
    expect(client.queries[5].sql).not.toContain('workspace-a');
    expect(client.queries[5].sql).not.toContain('run-1');
    expect(() => buildCoreMailImportCommands({ workspaceId: ' ', runId: 'run-1' })).toThrow('workspaceId');
    expect(() => buildCoreMailImportCommands({ workspaceId: 'workspace-a', runId: ' ' })).toThrow('runId');
  });

  test('workflow/security import mapper builds ordered parameterized commands from staging rows', () => {
    const commands = buildWorkflowSecurityImportCommands({
      workspaceId: 'workspace-a',
      runId: 'run-1',
    });

    expect(commands.map((command) => command.tableName)).toEqual([
      'email_ai_profiles',
      'email_ai_prompts',
      'email_workflows',
      'email_workflow_versions',
      'email_workflow_runs',
      'email_workflow_run_steps',
      'email_message_workflow_applied',
      'email_workflow_forward_dedup',
      'workflow_knowledge_bases',
      'workflow_knowledge_chunks',
      'workflow_delayed_jobs',
      'email_spam_list_entries',
      'email_spam_learning_events',
      'email_spam_feature_stats',
      'email_spam_decisions',
      'pgp_identities',
      'pgp_peer_keys',
    ]);
    expect(commands.every((command) => command.params[0] === 'workspace-a' && command.params[2] === 'run-1'))
      .toBe(true);
    expect(commands[0].sql).toContain('INSERT INTO email_ai_profiles');
    expect(commands[1].sql).toContain('LEFT JOIN email_ai_profiles p');
    expect(commands[1].sql).toContain('override_key');
    expect(commands[2].sql).toContain('LEFT JOIN email_accounts schedule_account');
    expect(commands[2].sql).toContain('LEFT JOIN email_accounts scope_account');
    expect(commands[2].sql).toContain('override_key');
    expect(commands[2].sql).toContain('legacy_created_by_user_id');
    expect(commands[2].sql).not.toContain("created_by_user_id', '')::uuid");
    expect(commands[4].sql).toContain('LEFT JOIN email_messages m');
    expect(commands[5].sql).toContain('LEFT JOIN email_workflow_runs wr');
    expect(commands[7].sql).toContain('INSERT INTO email_workflow_forward_dedup');
    expect(commands[8].sql).toContain('override_key');
    expect(commands[9].sql).toContain('LEFT JOIN workflow_knowledge_bases kb');
    expect(commands[11].sql).toContain('LEFT JOIN email_accounts a');
    expect(commands[13].sql).toContain('FROM sqlite_import_rows r');
    expect(commands[15].sql).toContain('legacy_user_id');
    expect(commands[15].sql).not.toContain("user_id', '')::uuid");
    expect(commands[16].sql).toContain('legacy_verified_by_user_id');
    expect(commands[16].sql).not.toContain("verified_by_user_id', '')::uuid");
    expect(commands.map((command) => command.sql).join('\n')).not.toContain('workspace-a');
  });

  test('workflow/security import runner executes all commands without interpolating workspace or run ids', async () => {
    const client = makeCoreCrmImportPgClient();

    await runPostgresWorkflowSecurityImport(client, {
      workspaceId: 'workspace-a',
      runId: 'run-1',
    });

    expect(client.queries).toHaveLength(17);
    expect(client.queries[0].params).toEqual(['workspace-a', 'email_ai_profiles', 'run-1']);
    expect(client.queries[16].params).toEqual(['workspace-a', 'pgp_peer_keys', 'run-1']);
    expect(client.queries[2].sql).not.toContain('workspace-a');
    expect(client.queries[2].sql).not.toContain('run-1');
    expect(() => buildWorkflowSecurityImportCommands({ workspaceId: ' ', runId: 'run-1' }))
      .toThrow('workspaceId');
    expect(() => buildWorkflowSecurityImportCommands({ workspaceId: 'workspace-a', runId: ' ' }))
      .toThrow('runId');
  });

  test('legacy credential importer writes keytar values to Postgres secrets and links target rows', async () => {
    const legacyRows = {
      email_accounts: [
        {
          id: 1,
          workspace_id: WORKSPACE_A_ID,
          keytar_account_key: 'imap-key',
          imap_password_secret_id: null,
          smtp_keytar_account_key: 'smtp-key',
          smtp_password_secret_id: null,
          oauth_refresh_keytar_key: 'oauth-key',
          oauth_refresh_secret_id: null,
        },
        {
          id: 2,
          workspace_id: WORKSPACE_A_ID,
          keytar_account_key: 'already-linked',
          imap_password_secret_id: 'existing-secret',
          smtp_keytar_account_key: null,
          smtp_password_secret_id: null,
          oauth_refresh_keytar_key: null,
          oauth_refresh_secret_id: null,
        },
      ],
      email_ai_profiles: [{
        id: 3,
        workspace_id: WORKSPACE_A_ID,
        legacy_keytar_account: 'ai-key',
        secret_id: null,
      }],
      pgp_identities: [{
        id: 4,
        workspace_id: WORKSPACE_A_ID,
        legacy_keytar_private_key_handle: 'pgp-key',
        private_key_secret_id: null,
      }],
    };
    const db = makeLegacyCredentialImportDb(legacyRows);
    const sourceReads: Array<{ service: string; account: string }> = [];
    const legacySecrets = new Map([
      [`${LEGACY_EMAIL_KEYTAR_SERVICE}:imap-key`, 'imap-password'],
      [`${LEGACY_EMAIL_KEYTAR_SERVICE}:smtp-key`, ''],
      [`${LEGACY_EMAIL_KEYTAR_SERVICE}:oauth-key`, 'oauth-refresh-token'],
      [`${LEGACY_EMAIL_AI_KEYTAR_SERVICE}:ai-key`, 'ai-api-key'],
      [`${LEGACY_PGP_KEYTAR_SERVICE}:pgp-key`, 'pgp-private-key'],
    ]);
    const writtenSecrets: Array<{
      workspaceId: string;
      kind: string;
      name: string;
      value: string | Buffer;
    }> = [];
    const result = await importLegacyCredentialsToPostgresSecrets({
      workspaceId: WORKSPACE_A_ID,
      db,
      applyWorkspaceSession: async () => undefined,
      source: {
        async readSecret(input) {
          sourceReads.push(input);
          return legacySecrets.get(`${input.service}:${input.account}`) ?? null;
        },
      },
      secrets: {
        async writeSecret(input) {
          writtenSecrets.push(input);
          return {
            id: `secret-${writtenSecrets.length}`,
            workspaceId: input.workspaceId,
            kind: input.kind,
            name: input.name,
            keyId: 'primary',
            algorithm: 'xchacha20poly1305-ietf',
            updatedAt: '2026-06-03T00:00:00.000Z',
          };
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

    expect(sourceReads).toEqual([
      { service: LEGACY_EMAIL_KEYTAR_SERVICE, account: 'imap-key' },
      { service: LEGACY_EMAIL_KEYTAR_SERVICE, account: 'smtp-key' },
      { service: LEGACY_EMAIL_KEYTAR_SERVICE, account: 'oauth-key' },
      { service: LEGACY_EMAIL_AI_KEYTAR_SERVICE, account: 'ai-key' },
      { service: LEGACY_PGP_KEYTAR_SERVICE, account: 'pgp-key' },
    ]);
    expect(writtenSecrets.map((secret) => [secret.kind, secret.name])).toEqual([
      ['email.account.imap_password', 'email_account:1:imap'],
      ['email.account.oauth_refresh_token', 'email_account:1:oauth_refresh'],
      ['email.ai_profile.api_key', 'email_ai_profile:3:api_key'],
      ['pgp.identity.private_key', 'pgp_identity:4:private_key'],
    ]);
    expect(legacyRows.email_accounts[0]).toMatchObject({
      imap_password_secret_id: 'secret-1',
      smtp_password_secret_id: null,
      oauth_refresh_secret_id: 'secret-2',
    });
    expect(legacyRows.email_ai_profiles[0].secret_id).toBe('secret-3');
    expect(legacyRows.pgp_identities[0].private_key_secret_id).toBe('secret-4');
    expect(result.skipped).toEqual([
      {
        targetTable: 'email_accounts',
        targetId: 1,
        service: LEGACY_EMAIL_KEYTAR_SERVICE,
        account: 'smtp-key',
        reason: 'missing_legacy_secret',
      },
      {
        targetTable: 'email_accounts',
        targetId: 2,
        service: LEGACY_EMAIL_KEYTAR_SERVICE,
        account: 'already-linked',
        reason: 'already_linked',
      },
    ]);
    expect(JSON.stringify(result)).not.toContain('imap-password');
    expect(JSON.stringify(result)).not.toContain('oauth-refresh-token');
    expect(JSON.stringify(result)).not.toContain('ai-api-key');
    expect(JSON.stringify(result)).not.toContain('pgp-private-key');
  });

  test('migrate CLI keeps offline modes available without DATABASE_URL', async () => {
    const manifest = makeCliIo();
    const manifestExit = await runMigrateCli({
      argv: ['--manifest'],
      env: {},
      stdout: manifest.stdout,
      stderr: manifest.stderr,
      createClient: () => {
        throw new Error('client should not be created');
      },
    });

    expect(manifestExit).toBe(0);
    expect(manifest.stderrOutput()).toBe('');
    expect(JSON.parse(manifest.stdoutOutput()).migrations.map((migration: { id: string }) => migration.id))
      .toEqual(EXPECTED_SERVER_MIGRATION_IDS);

    const sql = makeCliIo();
    const sqlExit = await runMigrateCli({
      argv: ['--sql', '--down'],
      env: {},
      stdout: sql.stdout,
      stderr: sql.stderr,
    });

    expect(sqlExit).toBe(0);
    expect(sql.stdoutOutput()).toContain('DROP TABLE IF EXISTS workspaces');
  });

  test('migrate CLI requires DATABASE_URL for apply mode', async () => {
    const io = makeCliIo();

    const exitCode = await runMigrateCli({
      argv: [],
      env: {},
      stdout: io.stdout,
      stderr: io.stderr,
    });

    expect(exitCode).toBe(2);
    expect(io.stderrOutput()).toContain('DATABASE_URL is required');
  });

  test('migrate CLI applies migrations through pg client without leaking credentials', async () => {
    const io = makeCliIo();
    const client = makeMigrationPgClient();
    let receivedDatabaseUrl = '';

    const exitCode = await runMigrateCli({
      argv: [],
      env: { DATABASE_URL: 'postgres://simplecrm:secret-password@postgres:5432/simplecrm' },
      stdout: io.stdout,
      stderr: io.stderr,
      createClient(databaseUrl) {
        receivedDatabaseUrl = databaseUrl;
        return client;
      },
    });

    const output = JSON.parse(io.stdoutOutput());
    expect(exitCode).toBe(0);
    expect(receivedDatabaseUrl).toBe('postgres://simplecrm:secret-password@postgres:5432/simplecrm');
    expect(io.stderrOutput()).toBe('');
    expect(io.stdoutOutput()).not.toContain('secret-password');
    expect(output.appliedIds).toEqual(EXPECTED_SERVER_MIGRATION_IDS);
    expect(client.connectCount).toBe(1);
    expect(client.endCount).toBe(1);
    expect(client.metadataRows.map((row) => row.id)).toEqual(output.appliedIds);
    expect(client.queries.map((query) => query.sql)).toContain('BEGIN');
    expect(client.queries.map((query) => query.sql)).toContain('COMMIT');
  });

  test('doctor CLI reports migration, queue, lock, database, and backup health without leaking credentials', async () => {
    const backupDir = mkdtempSync(join(tmpdir(), 'simplecrm-doctor-'));
    const dumpName = 'db-2026-06-03T00-00-00Z.dump';
    const auditArchiveName = 'audit-archive-2026-06-03T00-00-00Z.tar';
    writeFileSync(join(backupDir, dumpName), 'backup');
    writeFileSync(join(backupDir, auditArchiveName), 'audit-archive');
    writeFileSync(
      join(backupDir, 'backup-2026-06-03T00-00-00Z.sha256'),
      [
        `${sha256Text('backup')}  ${dumpName}`,
        `${sha256Text('audit-archive')}  ${auditArchiveName}`,
      ].join('\n') + '\n',
    );
    const io = makeCliIo();
    const client = makeDoctorPgClient();
    let receivedDatabaseUrl = '';

    try {
      const exitCode = await runDoctorCli({
        argv: ['--json', '--backup-dir', backupDir],
        env: { DATABASE_URL: 'postgres://simplecrm:secret-password@postgres:5432/simplecrm' },
        stdout: io.stdout,
        stderr: io.stderr,
        createClient(databaseUrl) {
          receivedDatabaseUrl = databaseUrl;
          return client;
        },
      });

      const output = JSON.parse(io.stdoutOutput());
      expect(exitCode).toBe(0);
      expect(receivedDatabaseUrl).toBe('postgres://simplecrm:secret-password@postgres:5432/simplecrm');
      expect(io.stderrOutput()).toBe('');
      expect(io.stdoutOutput()).not.toContain('secret-password');
      expect(output.status).toBe('ok');
      expect(output.checks.map((check: { name: string }) => check.name)).toEqual([
        'database',
        'migrations',
        'job_queue',
        'conversation_locks',
        'backups',
      ]);
      expect(output.checks.find((check: { name: string }) => check.name === 'database').details)
        .toEqual({ databaseName: 'simplecrm', databaseSize: '42 MB' });
      expect(output.checks.find((check: { name: string }) => check.name === 'job_queue').details)
        .toEqual({ readyJobs: 2, lockedJobs: 0, lagSeconds: 30, oldestLockedSeconds: null });
      expect(output.checks.find((check: { name: string }) => check.name === 'backups').message)
        .toContain('verified');
      expect(JSON.stringify(output.checks.find((check: { name: string }) => check.name === 'backups').details))
        .toContain(auditArchiveName);
      expect(client.connectCount).toBe(1);
      expect(client.endCount).toBe(1);
      expect(client.queries.some((query) => query.sql.includes('FROM job_queue'))).toBe(true);
    } finally {
      rmSync(backupDir, { recursive: true, force: true });
    }
  });

  test('doctor CLI fails backup health on checksum mismatch', async () => {
    const backupDir = mkdtempSync(join(tmpdir(), 'simplecrm-doctor-bad-backup-'));
    try {
      const dumpName = 'db-2026-06-03T00-00-00Z.dump';
      writeFileSync(join(backupDir, dumpName), 'backup');
      writeFileSync(join(backupDir, 'backup-2026-06-03T00-00-00Z.sha256'), `${'0'.repeat(64)}  ${dumpName}\n`);
      const io = makeCliIo();

      const exitCode = await runDoctorCli({
        argv: ['--json', '--backup-dir', backupDir],
        env: { DATABASE_URL: 'postgres://simplecrm@postgres:5432/simplecrm' },
        stdout: io.stdout,
        stderr: io.stderr,
        createClient: () => makeDoctorPgClient(),
      });

      const output = JSON.parse(io.stdoutOutput());
      expect(exitCode).toBe(1);
      expect(output.status).toBe('fail');
      expect(output.checks.find((check: { name: string }) => check.name === 'backups')).toMatchObject({
        status: 'fail',
        message: expect.stringContaining('checksum mismatch'),
      });
    } finally {
      rmSync(backupDir, { recursive: true, force: true });
    }
  });

});
