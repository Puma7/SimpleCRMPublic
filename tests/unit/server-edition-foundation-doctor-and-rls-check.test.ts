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

describe('server edition foundation — doctor-and-rls-check', () => {
  test('doctor CLI exits non-zero when a health check fails', async () => {
    const io = makeCliIo();
    const client = makeDoctorPgClient({ failJobQueue: true });

    const exitCode = await runDoctorCli({
      argv: ['--json'],
      env: { DATABASE_URL: 'postgres://simplecrm@postgres:5432/simplecrm' },
      stdout: io.stdout,
      stderr: io.stderr,
      createClient: () => client,
    });

    const output = JSON.parse(io.stdoutOutput());
    expect(exitCode).toBe(1);
    expect(output.status).toBe('fail');
    expect(output.checks.find((check: { name: string }) => check.name === 'job_queue').status).toBe('fail');
    expect(output.checks.find((check: { name: string }) => check.name === 'backups').status).toBe('warn');
  });

  test('conversation lock commands match the pessimistic locking policy', () => {
    expect(CONVERSATION_LOCK_HEARTBEAT_SECONDS).toBe(30);
    expect(CONVERSATION_LOCK_TIMEOUT_SECONDS).toBe(120);

    const acquire = acquireConversationLockCommand({
      messageId: 42,
      userId: 'user-a',
      workspaceId: 'workspace-a',
      reason: 'reply',
    });
    expect(acquire.sql).toContain('ON CONFLICT (message_id) DO NOTHING');
    expect(acquire.params).toEqual([42, 'user-a', 'workspace-a', 'reply']);

    const release = releaseConversationLockCommand({
      messageId: 42,
      userId: 'user-a',
      workspaceId: 'workspace-a',
    });
    expect(release.sql).toContain('(user_id = $3 OR $4::boolean = true)');
    expect(release.params).toEqual([42, 'workspace-a', 'user-a', false]);

    const cleanup = cleanupStaleConversationLocksCommand('workspace-a');
    expect(cleanup.sql).toContain("interval '2 minutes'");
    expect(cleanup.params).toEqual(['workspace-a']);

    const takeover = forceTakeoverConversationLockCommand({
      messageId: 42,
      newUserId: 'admin-a',
      workspaceId: 'workspace-a',
      reason: 'edit',
    });
    expect(takeover.sql).toContain('WITH removed AS');
    expect(takeover.sql).toContain('COALESCE((SELECT takeover_count + 1 FROM removed), 1)');
    expect(takeover.params).toEqual([42, 'workspace-a', 'admin-a', 'edit']);
  });

  test('audit event recording locks the workspace hash chain before reading the previous hash', async () => {
    const [previous] = makeAuditChainRows([
      { id: 1, createdAt: '2026-06-02T12:00:00.000Z' },
    ]);
    const { db, rows, calls } = makeAuditPortDb([previous]);
    const createdAt = new Date('2026-06-02T12:00:01.000Z');
    const port = createPostgresAuditPort({
      db,
      now: () => createdAt,
    });

    await port.record({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      action: 'customer.update',
      entityType: 'customer',
      entityId: '42',
      metadata: { field: 'name' },
    });

    expect(calls.map((call) => call.kind)).toEqual(['raw', 'raw', 'select', 'insert']);
    expect(calls[0]).toMatchObject({
      kind: 'raw',
      parameters: [WORKSPACE_A_ID, '', 'system', 'off'],
    });
    expect((calls[0] as AuditPortRawCall).sql).toContain("set_config('app.workspace_id', $1, true)");
    expect(calls[1]).toEqual({
      kind: 'raw',
      sql: 'SELECT pg_advisory_xact_lock(hashtext($1))',
      parameters: [`audit:${WORKSPACE_A_ID}`],
    });
    expect(calls[2]).toEqual({
      kind: 'select',
      table: 'audit_events',
      selected: 'event_hash',
      wheres: [['workspace_id', '=', WORKSPACE_A_ID]],
      orderBy: ['id', 'desc'],
    });
    expect(calls[3]).toMatchObject({
      kind: 'insert',
      table: 'audit_events',
    });
    const inserted = (calls[3] as AuditPortInsertCall).values;
    expect(inserted).toMatchObject({
      workspace_id: WORKSPACE_A_ID,
      actor_user_id: USER_A_ID,
      action: 'customer.update',
      entity_type: 'customer',
      entity_id: '42',
      metadata: { field: 'name' },
      previous_hash: previous.event_hash,
      created_at: createdAt,
    });
    expect(inserted.event_hash).toBe(hashAuditEvent({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      action: 'customer.update',
      entityType: 'customer',
      entityId: '42',
      metadata: { field: 'name' },
      previousHash: previous.event_hash,
      createdAt,
    }));
    expect(rows.at(-1)).toEqual(inserted);
  });

  test('audit event recording serializes concurrent records into one hash chain', async () => {
    const { db, rows } = makeAuditPortDb([], { serializeAdvisoryLocks: true });
    let nowOffset = 0;
    const port = createPostgresAuditPort({
      db,
      now: () => new Date(Date.parse('2026-06-02T12:00:00.000Z') + nowOffset++),
    });

    await Promise.all([
      port.record({
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        action: 'audit.concurrent.first',
        entityType: 'email_message',
        entityId: '1',
        metadata: { worker: 'a' },
      }),
      port.record({
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        action: 'audit.concurrent.second',
        entityType: 'email_message',
        entityId: '2',
        metadata: { worker: 'b' },
      }),
    ]);

    const auditRows = rows as unknown as AuditHashChainRow[];
    expect(auditRows).toHaveLength(2);
    expect(auditRows[0].previous_hash).toBeNull();
    expect(auditRows[1].previous_hash).toBe(auditRows[0].event_hash);
    expect(verifyAuditHashChain(auditRows)).toMatchObject({
      ok: true,
      checkedRows: 2,
      firstId: 1,
      lastId: 2,
    });
  });

  test('audit event hashes are chained over stable event fields', () => {
    const first = hashAuditEvent({
      workspaceId: 'workspace-a',
      actorUserId: 'admin-a',
      action: 'conversation_lock.force_takeover',
      entityType: 'email_message',
      entityId: '42',
      metadata: { messageId: 42, reason: 'edit' },
      previousHash: null,
      createdAt: new Date('2026-06-02T12:00:00.000Z'),
    });
    const second = hashAuditEvent({
      workspaceId: 'workspace-a',
      actorUserId: 'admin-a',
      action: 'conversation_lock.force_takeover',
      entityType: 'email_message',
      entityId: '42',
      metadata: { messageId: 42, reason: 'edit' },
      previousHash: first,
      createdAt: new Date('2026-06-02T12:00:01.000Z'),
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(second).toMatch(/^[a-f0-9]{64}$/);
    expect(second).not.toBe(first);
    expect(hashAuditEvent({
      workspaceId: 'workspace-a',
      actorUserId: 'admin-a',
      action: 'metadata.canonical',
      entityType: 'email_message',
      entityId: '42',
      metadata: { b: 2, nested: { z: true, a: false }, a: 1 },
      previousHash: null,
      createdAt: new Date('2026-06-02T12:00:00.000Z'),
    })).toBe(hashAuditEvent({
      workspaceId: 'workspace-a',
      actorUserId: 'admin-a',
      action: 'metadata.canonical',
      entityType: 'email_message',
      entityId: '42',
      metadata: { a: 1, nested: { a: false, z: true }, b: 2 },
      previousHash: null,
      createdAt: new Date('2026-06-02T12:00:00.000Z'),
    }));
  });

  test('audit hash-chain verification detects tampering and broken links', () => {
    const rows = makeAuditChainRows([
      { id: 1, createdAt: '2026-06-02T12:00:00.000Z', metadata: { b: 2, a: 1 } },
      { id: 2, createdAt: '2026-06-02T12:00:01.000Z' },
    ]);

    expect(verifyAuditHashChain(rows)).toEqual({
      ok: true,
      checkedRows: 2,
      firstId: 1,
      lastId: 2,
    });
    expect(verifyAuditHashChain([
      rows[0],
      { ...rows[1], previous_hash: 'broken-link' },
    ])).toMatchObject({
      ok: false,
      error: expect.stringContaining('hash does not match'),
    });
    expect(verifyAuditHashChain([
      rows[0],
      {
        ...rows[1],
        previous_hash: null,
        event_hash: hashAuditEvent({
          workspaceId: rows[1].workspace_id,
          actorUserId: rows[1].actor_user_id,
          action: rows[1].action,
          entityType: rows[1].entity_type,
          entityId: rows[1].entity_id,
          metadata: rows[1].metadata as Record<string, unknown>,
          previousHash: null,
          createdAt: new Date(rows[1].created_at),
        }),
      },
    ])).toMatchObject({
      ok: false,
      error: expect.stringContaining('does not link'),
    });
  });

  test('login brute-force policy escalates and resets counters after success', () => {
    expect(LOGIN_BACKOFF_SECONDS).toEqual([30, 300, 3600, 86400]);
    expect(LOGIN_PERMANENT_LOCK_AFTER_FAILURES).toBe(50);
    expect(calculateLoginPenalty(0)).toEqual({ kind: 'none' });
    expect(calculateLoginPenalty(1)).toEqual({ kind: 'temporary', lockSeconds: 30 });
    expect(calculateLoginPenalty(2)).toEqual({ kind: 'temporary', lockSeconds: 300 });
    expect(calculateLoginPenalty(3)).toEqual({ kind: 'temporary', lockSeconds: 3600 });
    expect(calculateLoginPenalty(4)).toEqual({ kind: 'temporary', lockSeconds: 86400 });
    expect(calculateLoginPenalty(49)).toEqual({ kind: 'temporary', lockSeconds: 86400 });
    expect(calculateLoginPenalty(50)).toEqual({ kind: 'permanent' });
    expect(shouldResetFailureCounterAfterSuccess()).toBe(true);
    expect(() => calculateLoginPenalty(-1)).toThrow('non-negative integer');
  });

  test('security utilities validate master keys and hash refresh tokens', () => {
    const keyBytes = Buffer.alloc(MASTER_KEY_BYTES, 7);
    const parsed = parseBase64MasterKey(keyBytes.toString('base64'), 'primary');
    expect(equalSecretBytes(parsed.bytes, keyBytes)).toBe(true);
    expect(parsed.keyId).toBe('primary');

    const envelope = createSecretEnvelopeMetadata(parsed);
    expect(envelope.algorithm).toBe(SECRET_ENVELOPE_ALGORITHM);
    expect(envelope.keyId).toBe('primary');
    expect(envelope.nonce).toHaveLength(24);

    expect(() => parseBase64MasterKey(Buffer.alloc(16).toString('base64'))).toThrow('32 bytes');

    const hash = hashRefreshToken('refresh-token');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyRefreshTokenHash('refresh-token', hash)).toBe(true);
    expect(verifyRefreshTokenHash('other-token', hash)).toBe(false);
  });

  test('libsodium secret envelopes encrypt, bind associated data, and rotate keys', async () => {
    const key = parseBase64MasterKey(Buffer.alloc(32, 11).toString('base64'), 'primary');
    const nextKey = parseBase64MasterKey(Buffer.alloc(32, 12).toString('base64'), 'rotated');
    const associatedData = {
      workspaceId: 'workspace-a',
      kind: 'smtp',
      name: 'default',
    };

    const envelope = await encryptSecretValue({
      key,
      value: 'smtp-password',
      associatedData,
    });
    expect(envelope.algorithm).toBe(SECRET_ENVELOPE_ALGORITHM);
    expect(envelope.keyId).toBe('primary');
    expect(envelope.nonce).toHaveLength(24);
    expect(envelope.ciphertext.toString('utf8')).not.toContain('smtp-password');

    const plaintext = await decryptSecretValue({ key, envelope, associatedData });
    expect(plaintext.toString('utf8')).toBe('smtp-password');

    await expect(decryptSecretValue({
      key,
      envelope,
      associatedData: { ...associatedData, name: 'other' },
    })).rejects.toThrow('Secret decryption failed');
    await expect(decryptSecretValue({
      key: nextKey,
      envelope,
      associatedData,
    })).rejects.toThrow('requires key primary');

    const rotated = await rotateSecretEnvelope({
      currentKey: key,
      nextKey,
      envelope,
      associatedData,
    });
    expect(rotated.keyId).toBe('rotated');
    await expect(decryptSecretValue({ key, envelope: rotated, associatedData })).rejects.toThrow('requires key rotated');
    await expect(decryptSecretValue({ key: nextKey, envelope: rotated, associatedData }))
      .resolves.toEqual(Buffer.from('smtp-password', 'utf8'));

    expect(encodeAssociatedData(associatedData).toString('utf8')).toBe(JSON.stringify(associatedData));
    expect(() => encodeAssociatedData({ ...associatedData, kind: ' ' })).toThrow('kind');
  });

  test('PGP private key envelopes derive per-user DEKs and bind identity context', async () => {
    const privateKey = '-----BEGIN PGP PRIVATE KEY-----\nsecret\n-----END PGP PRIVATE KEY-----';
    const associatedData = {
      workspaceId: WORKSPACE_A_ID,
      userId: USER_A_ID,
      identityId: 'pgp-identity-1',
      fingerprint: 'ABCDEF123456',
    };
    const fastKdf = {
      opsLimit: 1,
      memLimit: 8192,
      salt: Buffer.alloc(16, 4),
    };

    const envelope = await encryptPgpPrivateKeyWithPassphrase({
      privateKeyArmored: privateKey,
      passphrase: 'correct horse battery staple',
      associatedData,
      kdf: fastKdf,
    });
    expect(envelope.algorithm).toBe(PGP_PRIVATE_KEY_ENVELOPE_ALGORITHM);
    expect(envelope.salt).toEqual(fastKdf.salt);
    expect(envelope.nonce).toHaveLength(24);
    expect(envelope.ciphertext.toString('utf8')).not.toContain('PGP PRIVATE KEY');
    const serializedEnvelope = serializePgpPrivateKeyEnvelope(envelope);
    const deserializedEnvelope = deserializePgpPrivateKeyEnvelope(serializedEnvelope);
    expect(deserializedEnvelope).toMatchObject({
      algorithm: envelope.algorithm,
      kdf: envelope.kdf,
      opsLimit: envelope.opsLimit,
      memLimit: envelope.memLimit,
    });
    expect(deserializedEnvelope.salt).toEqual(envelope.salt);
    expect(deserializedEnvelope.nonce).toEqual(envelope.nonce);
    expect(deserializedEnvelope.ciphertext).toEqual(envelope.ciphertext);
    expect(serializedEnvelope).not.toContain('PGP PRIVATE KEY');
    expect(pgpIdentityPrivateKeySecretIdentifier(WORKSPACE_A_ID, 41)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      kind: 'pgp.identity.private_key',
      name: 'pgp_identity:41:private_key',
    });
    expect(() => deserializePgpPrivateKeyEnvelope('[]')).toThrow('Invalid PGP private key envelope JSON');
    expect(() => deserializePgpPrivateKeyEnvelope(JSON.stringify({
      algorithm: 'unsupported',
      kdf: envelope.kdf,
      opsLimit: envelope.opsLimit,
      memLimit: envelope.memLimit,
      salt: envelope.salt.toString('base64'),
      nonce: envelope.nonce.toString('base64'),
      ciphertext: envelope.ciphertext.toString('base64'),
    }))).toThrow('Unsupported PGP private key envelope algorithm');

    await expect(decryptPgpPrivateKeyWithPassphrase({
      envelope,
      passphrase: 'correct horse battery staple',
      associatedData,
    })).resolves.toEqual(Buffer.from(privateKey, 'utf8'));

    await expect(decryptPgpPrivateKeyWithPassphrase({
      envelope,
      passphrase: 'wrong passphrase',
      associatedData,
    })).rejects.toThrow('PGP private key decryption failed');
    await expect(decryptPgpPrivateKeyWithPassphrase({
      envelope,
      passphrase: 'correct horse battery staple',
      associatedData: { ...associatedData, userId: USER_B_ID },
    })).rejects.toThrow('PGP private key decryption failed');

    const rotated = await rotatePgpPrivateKeyPassphrase({
      envelope,
      currentPassphrase: 'correct horse battery staple',
      nextPassphrase: 'new passphrase',
      associatedData,
      kdf: { ...fastKdf, salt: Buffer.alloc(16, 5) },
    });
    expect(rotated.salt).toEqual(Buffer.alloc(16, 5));
    await expect(decryptPgpPrivateKeyWithPassphrase({
      envelope: rotated,
      passphrase: 'correct horse battery staple',
      associatedData,
    })).rejects.toThrow('PGP private key decryption failed');
    await expect(decryptPgpPrivateKeyWithPassphrase({
      envelope: rotated,
      passphrase: 'new passphrase',
      associatedData,
    })).resolves.toEqual(Buffer.from(privateKey, 'utf8'));

    expect(encodePgpPrivateKeyAssociatedData(associatedData).toString('utf8'))
      .toContain('"purpose":"pgp_private_key"');
    expect(() => encodePgpPrivateKeyAssociatedData({ ...associatedData, fingerprint: ' ' }))
      .toThrow('fingerprint');
  });

  test('access tokens are signed, expiring, and bearer-header parseable', () => {
    const signer = accessTokenSignerFromBase64(Buffer.alloc(32, 3).toString('base64'), 'primary');
    const issuedAt = new Date('2026-06-02T12:00:00.000Z');
    const token = createAccessToken({
      signer,
      issuedAt,
      expiresInSeconds: 60,
      principal: {
        userId: 'user-a',
        workspaceId: 'workspace-a',
        role: 'admin',
        sessionId: 'session-a',
      },
    });

    expect(bearerTokenFromAuthorizationHeader(`Bearer ${token}`)).toBe(token);
    expect(verifyAccessToken({
      token,
      signer,
      now: new Date('2026-06-02T12:00:30.000Z'),
    })).toEqual({
      userId: 'user-a',
      workspaceId: 'workspace-a',
      role: 'admin',
      sessionId: 'session-a',
    });
    expect(verifyAccessToken({
      token,
      signer,
      now: new Date('2026-06-02T12:01:01.000Z'),
    })).toBeNull();
    expect(verifyAccessToken({
      token: `${token.split('.').slice(0, 2).join('.')}.invalid-signature`,
      signer,
      now: new Date('2026-06-02T12:00:30.000Z'),
    })).toBeNull();
    expect(() => accessTokenSignerFromBase64(Buffer.alloc(16).toString('base64'))).toThrow('32 bytes');
  });

  test('bearer principal resolver can require a persisted token session', async () => {
    const signer = accessTokenSignerFromBase64(Buffer.alloc(32, 4).toString('base64'), 'primary');
    const issuedAt = new Date();
    const token = createAccessToken({
      signer,
      issuedAt,
      expiresInSeconds: 60,
      principal: {
        userId: 'user-a',
        workspaceId: 'workspace-a',
        role: 'admin',
        sessionId: 'session-a',
      },
    });
    const fallback = jest.fn(() => ({
      userId: 'fallback-user',
      workspaceId: 'fallback-workspace',
      role: 'user' as const,
    }));
    const validate = jest.fn(async ({ principal }) => (
      principal.sessionId === 'session-a'
        ? { ...principal, role: 'user' as const }
        : null
    ));
    const automationPrincipal = {
      userId: USER_A_ID,
      workspaceId: WORKSPACE_A_ID,
      role: 'user' as const,
      automationApiKeyId: '55555555-5555-4555-8555-555555555555',
      automationScopes: ['workflows'],
    };
    const automationFallback = jest.fn(async ({ token }: { token: string }) => (
      token === 'scrm_webhook_key' ? automationPrincipal : null
    ));
    const resolver = createBearerTokenPrincipalResolver(signer, fallback, validate, automationFallback);

    await expect(resolver({
      headers: { authorization: `Bearer ${token}` },
    } as any)).resolves.toEqual({
      userId: 'user-a',
      workspaceId: 'workspace-a',
      role: 'user',
      sessionId: 'session-a',
    });
    expect(accessTokenFromWebSocketProtocol(`chat, simplecrm.access-token.${token}`)).toBe(token);
    await expect(resolver({
      headers: { 'sec-websocket-protocol': `simplecrm.access-token.${token}` },
    } as any)).resolves.toEqual({
      userId: 'user-a',
      workspaceId: 'workspace-a',
      role: 'user',
      sessionId: 'session-a',
    });
    expect(validate).toHaveBeenCalledWith({
      principal: {
        userId: 'user-a',
        workspaceId: 'workspace-a',
        role: 'admin',
        sessionId: 'session-a',
      },
    });
    expect(fallback).not.toHaveBeenCalled();

    const rejectedToken = createAccessToken({
      signer,
      issuedAt,
      expiresInSeconds: 60,
      principal: {
        userId: 'user-a',
        workspaceId: 'workspace-a',
        role: 'admin',
      },
    });
    await expect(resolver({
      headers: { authorization: `Bearer ${rejectedToken}` },
    } as any)).resolves.toBeUndefined();
    expect(automationFallback).not.toHaveBeenCalled();

    await expect(resolver({
      headers: { authorization: 'Bearer scrm_webhook_key' },
      url: '/api/v1/workflows/webhook/incoming',
    } as any)).resolves.toEqual(automationPrincipal);
    expect(automationFallback).toHaveBeenCalledTimes(1);
    expect(automationFallback.mock.calls[0]?.[0].token).toBe('scrm_webhook_key');

    await expect(resolver({
      headers: { 'sec-websocket-protocol': 'simplecrm.access-token.scrm_webhook_key' },
      url: '/api/v1/events',
    } as any)).resolves.toBeUndefined();
    expect(automationFallback).toHaveBeenCalledTimes(1);

    await expect(resolver({
      headers: {
        'x-simplecrm-user-id': 'fallback-user',
        'x-simplecrm-workspace-id': 'fallback-workspace',
        'x-simplecrm-role': 'user',
      },
    } as any)).resolves.toEqual({
      userId: 'fallback-user',
      workspaceId: 'fallback-workspace',
      role: 'user',
    });
  });

  test('postgres auth port issues access tokens bound to refresh-token session ids', async () => {
    const signer = accessTokenSignerFromBase64(Buffer.alloc(32, 5).toString('base64'), 'primary');
    const now = new Date('2026-06-02T12:00:00.000Z');
    const insertedValues: Array<Record<string, unknown>> = [];
    const db = {
      insertInto(table: string) {
        expect(table).toBe('refresh_tokens');
        const builder = {
          values(value: Record<string, unknown>) {
            insertedValues.push(value);
            return builder;
          },
          returning(columns: readonly string[]) {
            expect(columns).toEqual(['id']);
            return builder;
          },
          async executeTakeFirst() {
            return { id: 'session-created' };
          },
        };
        return builder;
      },
      transaction() {
        return {
          execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
        };
      },
    } as unknown as Kysely<ServerDatabase>;
    const port = createPostgresAuthPort({
      db,
      accessTokenSigner: signer,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });
    const user: AuthUserRecord = {
      id: USER_A_ID,
      workspaceId: WORKSPACE_A_ID,
      email: 'owner@example.com',
      displayName: 'Owner',
      role: 'owner',
      passwordHash: 'hash',
    };

    const tokens = await port.issueTokenPair({ user, device: 'desktop' });

    expect(insertedValues[0]).toMatchObject({
      user_id: USER_A_ID,
      workspace_id: WORKSPACE_A_ID,
      device: 'desktop',
    });
    expect(typeof insertedValues[0].token_hash).toBe('string');
    expect(verifyAccessToken({
      token: tokens.accessToken,
      signer,
      now: new Date('2026-06-02T12:00:30.000Z'),
    })).toEqual({
      userId: USER_A_ID,
      workspaceId: WORKSPACE_A_ID,
      role: 'owner',
      sessionId: 'session-created',
    });
    expect(tokens.expiresInSeconds).toBe(900);
    expect(tokens.refreshToken).toEqual(expect.any(String));
  });

  test('postgres auth port resolves access-token principals only for active sessions', async () => {
    const signer = accessTokenSignerFromBase64(Buffer.alloc(32, 6).toString('base64'), 'primary');
    const rows: PostgresAuthSessionFakeRow[] = [
      {
        token_id: 'session-active',
        user_id: 'user-a',
        workspace_id: 'workspace-a',
        role: 'user',
        expires_at: '2026-06-03T12:00:00.000Z',
        revoked_at: null,
        disabled_at: null,
      },
      {
        token_id: 'session-revoked',
        user_id: 'user-a',
        workspace_id: 'workspace-a',
        role: 'user',
        expires_at: '2026-06-03T12:00:00.000Z',
        revoked_at: '2026-06-02T12:01:00.000Z',
        disabled_at: null,
      },
      {
        token_id: 'session-expired',
        user_id: 'user-a',
        workspace_id: 'workspace-a',
        role: 'user',
        expires_at: '2026-06-02T11:59:59.000Z',
        revoked_at: null,
        disabled_at: null,
      },
      {
        token_id: 'session-disabled',
        user_id: 'user-b',
        workspace_id: 'workspace-a',
        role: 'admin',
        expires_at: '2026-06-03T12:00:00.000Z',
        revoked_at: null,
        disabled_at: '2026-06-02T12:00:00.000Z',
      },
    ];
    const db = {
      selectFrom(table: string) {
        expect(table).toBe('refresh_tokens');
        return new FakePostgresAuthSessionSelect(rows);
      },
      transaction() {
        return {
          execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
        };
      },
    } as unknown as Kysely<ServerDatabase>;
    const port = createPostgresAuthPort({
      db,
      accessTokenSigner: signer,
      now: () => new Date('2026-06-02T12:00:00.000Z'),
      applyWorkspaceSession: async () => undefined,
    });

    await expect(port.resolveAccessTokenPrincipal?.({
      principal: {
        userId: 'user-a',
        workspaceId: 'workspace-a',
        role: 'admin',
        sessionId: 'session-active',
      },
    })).resolves.toEqual({
      userId: 'user-a',
      workspaceId: 'workspace-a',
      role: 'user',
      sessionId: 'session-active',
    });
    await expect(port.resolveAccessTokenPrincipal?.({
      principal: {
        userId: 'user-a',
        workspaceId: 'workspace-a',
        role: 'user',
      },
    })).resolves.toBeNull();
    for (const sessionId of ['session-revoked', 'session-expired', 'session-disabled', 'missing-session']) {
      await expect(port.resolveAccessTokenPrincipal?.({
        principal: {
          userId: sessionId === 'session-disabled' ? 'user-b' : 'user-a',
          workspaceId: 'workspace-a',
          role: 'user',
          sessionId,
        },
      })).resolves.toBeNull();
    }
  });

  test('server auth route requires captcha for unknown emails when workspace captcha is enabled', async () => {
    const ports = {
      ...makeServerApiPorts(),
      loginSecurity: {
        async getLoginConfig() {
          return {
            captcha: { enabled: true, provider: 'turnstile' as const, siteKey: 'site-key' },
            pinKeypad: { enabled: false },
            mfa: { enabled: false, methods: [] },
            user: null,
          };
        },
        assertCaptchaChallenge() {
          return false;
        },
      },
    };
    const api = createServerApi(ports);

    const blocked = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/login',
      ip: '127.0.0.1',
      body: { email: 'unknown@example.com', password: 'guess' },
    });
    expect(blocked.status).toBe(403);
    expect((blocked.body as { error: { code: string } }).error.code).toBe('captcha_required');
  });

  test('server auth security route allows non-admin users to enable email MFA for themselves', async () => {
    const enableCalls: Array<{ workspaceId: string; userId: string }> = [];
    const ports = {
      ...makeServerApiPorts(),
      loginSecurity: {
        async enableEmailMfa(input: { workspaceId: string; userId: string }) {
          enableCalls.push(input);
        },
      },
    };
    const api = createServerApi(ports);
    const userPrincipal = { userId: 'user-b', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const enabled = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/users/user-b/mfa/email',
      principal: userPrincipal,
    });
    expect(enabled.status).toBe(200);
    expect((enabled.body as { data: { enabled: boolean; method: string } }).data).toEqual({
      enabled: true,
      method: 'email',
    });
    expect(enableCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, userId: 'user-b' }]);

    const forbidden = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/users/user-a/mfa/email',
      principal: userPrincipal,
    });
    expect(forbidden.status).toBe(403);
  });

  test('server auth routes login, refresh, and logout without leaking password hash', async () => {
    const ports = makeServerApiPorts();
    const api = createServerApi(ports);

    const login = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/login',
      ip: '127.0.0.1',
      body: { email: ' OWNER@EXAMPLE.COM ', password: 'correct', device: 'test-client' },
    });
    expect(login.status).toBe(200);
    expect(JSON.stringify(login.body)).not.toContain('passwordHash');
    expect((login.body as any).data.user.email).toBe('owner@example.com');
    expect((login.body as any).data.tokens.accessToken).toBe('access-token');
    expect((login.body as any).data.resetFailureCounter).toBe(true);

    const refresh = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: 'refresh-token' },
    });
    expect(refresh.status).toBe(200);
    expect((refresh.body as any).data.tokens.refreshToken).toBe('refresh-token-rotated');

    const logout = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/logout',
      body: { refreshToken: 'refresh-token-rotated' },
    });
    expect(logout.status).toBe(200);
    expect((logout.body as any).data.revoked).toBe(true);
  });

  test('server API serves documented OpenAPI spec without authentication', async () => {
    const api = createServerApi(makeServerApiPorts());

    const spec = await api.handle({
      method: 'GET',
      path: '/api/v1/openapi.json',
    });
    expect(spec.status).toBe(200);
    expect((spec.body as any).openapi).toBe('3.0.3');
    expect((spec.body as any).servers).toEqual([{ url: '/api/v1' }]);
    expect((spec.body as any).paths['/deals/{id}/stage'].post.summary).toContain('stage');
    expect((spec.body as any).paths['/tasks/{id}/toggle'].post.summary).toContain('completion');
    expect((spec.body as any).paths['/calendar-events'].post.summary).toContain('calendar');
    expect((spec.body as any).paths['/dashboard/stats'].get.summary).toContain('dashboard');
    expect((spec.body as any).paths['/email/messages/{id}/actions'].post.summary).toContain('message action');
    expect((spec.body as any).paths['/email/messages/{id}/move'].patch.summary).toContain('Move message');
    expect((spec.body as any).paths['/email/compose/send'].post.summary).toContain('compose draft');
    expect((spec.body as any).paths['/email/settings/security'].patch.summary).toContain('security');
    expect((spec.body as any).paths['/email/gdpr-export'].get.summary).toContain('GDPR export');
    expect((spec.body as any).paths['/email/gdpr-export'].post).toBeUndefined();
    expect((spec.body as any).paths['/email/messages/{id}/seen'].patch.summary).toContain('seen');
    expect((spec.body as any).paths['/workflow-versions'].post.summary).toContain('workflow version');
    expect((spec.body as any).paths['/pgp/identities'].post.summary).toContain('PGP identity');
    expect((spec.body as any).paths['/spam/list-entries'].post.summary).toContain('spam list entry');
    expect(JSON.stringify(spec.body)).toContain('mark_unseen');
    expect(JSON.stringify(spec.body)).toContain('spam_review');

    const invalidMethod = await api.handle({
      method: 'POST',
      path: '/api/v1/openapi.json',
    });
    expect(invalidMethod.status).toBe(405);
  });

  test('server auth setup routes expose initial state and create first owner without leaking secrets', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const ports = {
      ...makeServerApiPorts({ auditEvents, initialSetupNeeded: true }),
      initialSetupToken: 'setup-token-secret',
    };
    const api = createServerApi(ports);

    const state = await api.handle({
      method: 'GET',
      path: '/api/v1/auth/setup-state',
    });
    expect(state.status).toBe(200);
    expect((state.body as any).data).toEqual({ needsInitialSetup: true });

    const missingToken = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/initial-setup',
      body: {
        email: 'owner@example.com',
        password: 'new-passphrase',
      },
    });
    expect(missingToken.status).toBe(403);
    expect((missingToken.body as any).error.code).toBe('forbidden');

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/initial-setup',
      body: {
        email: ' OWNER@EXAMPLE.COM ',
        password: 'new-passphrase',
        displayName: ' Owner ',
        workspaceName: ' Vertrieb ',
        device: 'browser',
        initialSetupToken: 'setup-token-secret',
      },
    });
    expect(created.status).toBe(201);
    expect((created.body as any).data.user).toMatchObject({
      email: 'owner@example.com',
      displayName: 'Owner',
      role: 'owner',
    });
    expect((created.body as any).data.tokens.refreshToken).toBe('refresh-token');
    expect(auditEvents.map((event) => event.action)).toEqual(['auth.initial_owner_created']);
    expect(auditEvents[0].metadata).toEqual({
      email: 'owner@example.com',
      workspaceName: 'Vertrieb',
      device: 'browser',
    });
    expect(JSON.stringify(created.body)).not.toContain('passwordHash');
    expect(JSON.stringify(auditEvents)).not.toContain('new-passphrase');
    expect(JSON.stringify(auditEvents)).not.toContain('refresh-token');

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/initial-setup',
      body: { email: 'invalid', password: 'short', initialSetupToken: 'setup-token-secret' },
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.code).toBe('validation_error');

    const blocked = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/initial-setup',
      body: {
        email: 'second@example.com',
        password: 'another-passphrase',
        initialSetupToken: 'setup-token-secret',
      },
    });
    expect(blocked.status).toBe(409);
    expect((blocked.body as any).error.code).toBe('already_configured');
  });

  test('postgres auth port serializes initial owner creation inside the setup transaction', () => {
    const source = readFileSync(join(process.cwd(), 'packages', 'server', 'src', 'db', 'postgres-auth-port.ts'), 'utf8');
    const lockIndex = source.indexOf('await acquireInitialSetupLock(trx);');
    const racedSelectIndex = source.indexOf('const raced = await selectAnyUser(trx);');

    expect(source).toContain("const INITIAL_OWNER_SETUP_LOCK_KEY = 'simplecrm.initial_owner_setup';");
    expect(source).toContain('SELECT pg_advisory_xact_lock(hashtext(${INITIAL_OWNER_SETUP_LOCK_KEY}))');
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(racedSelectIndex).toBeGreaterThan(lockIndex);
  });

});
