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

describe('server edition foundation — job-queue', () => {
  test('postgres job queue uses cross-workspace RLS context for global claims and stale-lock release', async () => {
    const { db, rows, sessionCommands } = makeFakePostgresJobQueueDb();
    rows.push(makeFakePostgresJobQueueRow({
      id: 1,
      run_after: new Date('2026-06-05T08:00:00.000Z'),
      workspace_id: WORKSPACE_A_ID,
    }));
    const port = createPostgresJobQueuePort({
      db,
      now: () => new Date('2026-06-05T08:30:00.000Z'),
      applyWorkspaceSession: async (_trx, command) => {
        sessionCommands.push(command);
      },
    });

    const claimed = await port.claimNext({
      workerId: 'worker-a',
      now: new Date('2026-06-05T08:30:00.000Z'),
    });
    expect(claimed?.id).toBe(1);
    expect(claimed?.lockedBy).toBe('worker-a');

    const released = await port.releaseStaleLocks({
      staleBefore: new Date('2026-06-05T08:45:00.000Z'),
      limit: 10,
    });
    expect(released.map((job) => job.id)).toEqual([1]);
    expect(rows[0]?.locked_at).toBeNull();
    expect(sessionCommands).toHaveLength(2);
    expect(sessionCommands.map((command) => command.params[2])).toEqual(['system', 'system']);
    expect(sessionCommands.map((command) => command.params[3])).toEqual(['on', 'on']);
  });

  test('job worker completes successful jobs and records failures for missing or throwing handlers', async () => {
    const queue = makeJobQueuePort([
      makeQueuedJob({ id: 1, type: 'mail.sync.imap' }),
      makeQueuedJob({ id: 2, type: 'mail.send.scheduled' }),
      makeQueuedJob({ id: 3, type: 'webhook.fire' }),
    ]);
    const handled: number[] = [];

    await expect(runJobQueueOnce({
      queue,
      workerId: 'worker-a',
      handlers: {
        'mail.sync.imap': async (job) => {
          handled.push(job.id);
        },
      },
    })).resolves.toMatchObject({ status: 'completed' });
    expect(handled).toEqual([1]);
    expect(queue.completedIds).toEqual([1]);

    const missingHandler = await runJobQueueOnce({
      queue,
      workerId: 'worker-a',
      handlers: {},
    });
    expect(missingHandler.status).toBe('failed');
    expect(queue.failures[0]).toContain('No handler registered for job type mail.send.scheduled');

    const throwingHandler = await runJobQueueOnce({
      queue,
      workerId: 'worker-a',
      handlers: {
        'webhook.fire': async () => {
          throw new Error('workflow failed');
        },
      },
    });
    expect(throwingHandler).toMatchObject({ status: 'failed', error: 'workflow failed' });
    expect(queue.failures[1]).toContain('workflow failed');

    await expect(runJobQueueOnce({
      queue,
      workerId: 'worker-a',
      handlers: {},
    })).resolves.toEqual({ status: 'idle' });
  });

  test('graphile worker foundation maps AP-7 concurrency, queues, and job specs', () => {
    const plan = buildGraphileWorkerPlan({
      connectionString: 'postgres://simplecrm@postgres/simplecrm',
      concurrency: {
        mailAccountCount: 100,
        aiConcurrency: 7,
      },
    });

    expect(plan.concurrentJobs).toBe(57);
    expect(plan.taskTypes).toEqual(SERVER_JOB_TYPES);
    expect(graphileQueueNameForJob('mail.sync.imap', { accountId: 42 })).toBe('account-42');
    expect(graphileQueueNameForJob('mail.sync.imap', { accountId: '' })).toBeUndefined();
    expect(graphileQueueNameForJob('ai.reply_suggestion', {})).toBe('ai');
    expect(graphileQueueNameForJob('ai.agent', {})).toBe('ai');
    expect(graphileQueueNameForJob('ai.classify', {})).toBe('ai');
    expect(graphileQueueNameForJob('ai.review', {})).toBe('ai');
    expect(graphileQueueNameForJob('ai.transform_text', {})).toBe('ai');
    expect(graphileQueueNameForJob('mail.spam.score', {})).toBe('spam');
    expect(graphileQueueNameForJob('mail.vacation.auto_reply', {})).toBe('mail');
    expect(graphileQueueNameForJob('webhook.fire', {})).toBe('webhook');
    expect(graphileQueueNameForJob('workflow.execute', {})).toBe('workflow');
    expect(graphileQueueNameForJob('workflow.http_request', {})).toBe('workflow');
    expect(graphileQueueNameForJob('workflow.forward_copy', {})).toBe('workflow');
    expect(graphileJobKeyForJob('mail.sync.pop3', { accountId: 42 }, 'workspace-a'))
      .toBe('mail.sync.pop3:workspace-a:42');
    expect(graphileJobKeyForJob('mail.sync.pop3', { workspaceId: 'workspace-payload', accountId: 42 }))
      .toBe('mail.sync.pop3:workspace-payload:42');
    expect(graphileJobKeyForJob('mail.spam.score', { messageId: 11 }, 'workspace-a'))
      .toBe('mail.spam.score:workspace-a:11');
    expect(graphileJobKeyForJob('mail.vacation.auto_reply', { messageId: 11 }, 'workspace-a'))
      .toBe('mail.vacation.auto_reply:workspace-a:11');
    expect(graphileJobKeyForJob('mail.send.scheduled', { draftId: 42 }, 'workspace-a'))
      .toBe('mail.send.scheduled:workspace-a:42');
    expect(graphileJobKeyForJob('ai.reply_suggestion', { messageId: 11 }, 'workspace-a'))
      .toBe('ai.reply_suggestion:workspace-a:11');
    expect(graphileJobKeyForJob('ai.agent', { messageId: 11, workflowId: 23, resumeNodeId: 'tag-1' }, 'workspace-a'))
      .toBe('ai.agent:workspace-a:23:11:tag-1');
    expect(graphileJobKeyForJob('ai.classify', { messageId: 11, workflowId: 23, resumeNodeId: 'switch-1' }, 'workspace-a'))
      .toBe('ai.classify:workspace-a:23:11:switch-1');
    expect(graphileJobKeyForJob('ai.review', { messageId: 11, workflowId: 23, resumeNodeId: 'tag-1' }, 'workspace-a'))
      .toBe('ai.review:workspace-a:23:11:tag-1');
    expect(graphileJobKeyForJob('ai.transform_text', {
      messageId: 11,
      workflowId: 23,
      resumeNodeId: 'tag-1',
      targetVariable: 'ai.summary',
    }, 'workspace-a')).toBe('ai.transform_text:workspace-a:23:11:tag-1:ai.summary');
    expect(graphileJobKeyForJob('webhook.fire', { dedupeKey: 'customer-7' }, 'workspace-a'))
      .toBe('webhook.fire:workspace-a:customer-7');
    expect(graphileJobKeyForJob('webhook.fire', { url: 'https://hooks.example.com' }, 'workspace-a'))
      .toBeUndefined();
    expect(graphileJobKeyForJob('workflow.http_request', { workflowId: 23, messageId: 11, resumeNodeId: 'tag-1' }, 'workspace-a'))
      .toBe('workflow.http_request:workspace-a:23:11:tag-1');
    expect(graphileJobKeyForJob('workflow.forward_copy', { workflowId: 23, messageId: 11, to: 'audit@example.com' }, 'workspace-a'))
      .toBe('workflow.forward_copy:workspace-a:23:11:audit@example.com');
    expect(graphileJobKeyForJob('workflow.execute', { workflowId: 23, messageId: 11 }, 'workspace-a'))
      .toBe('workflow.execute:workspace-a:23:message:11');
    expect(graphileJobKeyForJob('workflow.execute', { workflowId: 23, delayedJobId: 87 }, 'workspace-a'))
      .toBe('workflow.execute:workspace-a:delayed:87');
    expect(graphileJobKeyForJob('lock.cleanup', { workspaceId: 'workspace-a' }))
      .toBe('lock.cleanup:workspace-a');
    expect(graphileSpecFromJob({
      type: 'mail.sync.imap',
      workspaceId: 'workspace-a',
      payload: { accountId: 42 },
      runAfter: new Date('2026-06-03T00:00:00.000Z'),
      maxAttempts: 9,
    })).toEqual({
      queueName: 'account-42',
      runAt: new Date('2026-06-03T00:00:00.000Z'),
      maxAttempts: 9,
      jobKey: 'mail.sync.imap:workspace-a:42',
      jobKeyMode: 'replace',
    });
    expect(graphileSpecFromJob({
      type: 'mail.send.scheduled',
      workspaceId: 'workspace-a',
      payload: { workspaceId: 'workspace-a', draftId: 42, dueBefore: '2026-06-03T14:00:00.000Z' },
      runAfter: new Date('2026-06-03T14:00:00.000Z'),
    })).toEqual({
      queueName: undefined,
      runAt: new Date('2026-06-03T14:00:00.000Z'),
      maxAttempts: 5,
      jobKey: 'mail.send.scheduled:workspace-a:42',
      jobKeyMode: 'replace',
    });
    expect(() => buildGraphileWorkerPlan({
      connectionString: ' ',
      concurrency: { mailAccountCount: 1 },
    })).toThrow('connectionString');
    expect(() => graphileSpecFromJob({
      type: 'mail.sync',
      workspaceId: 'workspace-a',
      payload: {},
    })).toThrow('unsupported server job type');
  });

  test('graphile queue port enqueues validated server jobs through worker utils', async () => {
    const added: Array<{ identifier: string; payload: Record<string, unknown>; spec: unknown }> = [];
    const removed: string[] = [];
    let migrated = 0;
    let released = 0;
    const queue = await createGraphileQueuePort({
      connectionString: 'postgres://simplecrm@postgres/simplecrm',
      migrateOnStart: true,
      createUtils: async () => ({
        async addJob(identifier, payload, spec) {
          added.push({ identifier, payload, spec });
        },
        async withPgClient(callback) {
          await callback({
            async query(sql, values) {
              if (sql.includes('remove_job') && values?.[0]) removed.push(String(values[0]));
            },
          });
        },
        async migrate() {
          migrated += 1;
        },
        async release() {
          released += 1;
        },
      }),
    });

    await queue.enqueue({
      type: 'mail.sync.imap',
      workspaceId: 'workspace-a',
      payload: { workspaceId: 'workspace-a', accountId: 7 },
      maxAttempts: 4,
    });
    await queue.enqueue({
      type: 'mail.send.scheduled',
      workspaceId: 'workspace-a',
      payload: { workspaceId: 'workspace-a', draftId: 42, dueBefore: '2026-06-03T14:00:00.000Z' },
      runAfter: new Date('2026-06-03T14:00:00.000Z'),
    });
    await queue.clearScheduledSendJob?.({ workspaceId: 'workspace-a', draftId: 42 });
    await expect(queue.enqueue({
      type: 'mail.sync',
      workspaceId: 'workspace-a',
      payload: {},
    })).rejects.toThrow('unsupported server job type');
    await queue.migrate();
    await queue.release();

    expect(migrated).toBe(2);
    expect(released).toBe(1);
    expect(removed).toEqual(['mail.send.scheduled:workspace-a:42']);
    expect(added).toEqual([
      {
        identifier: 'mail.sync.imap',
        payload: { workspaceId: 'workspace-a', accountId: 7 },
        spec: {
          queueName: 'account-7',
          runAt: undefined,
          maxAttempts: 4,
          jobKey: 'mail.sync.imap:workspace-a:7',
          jobKeyMode: 'replace',
        },
      },
      {
        identifier: 'mail.send.scheduled',
        payload: {
          workspaceId: 'workspace-a',
          draftId: 42,
          dueBefore: '2026-06-03T14:00:00.000Z',
        },
        spec: {
          queueName: undefined,
          runAt: new Date('2026-06-03T14:00:00.000Z'),
          maxAttempts: 5,
          jobKey: 'mail.send.scheduled:workspace-a:42',
          jobKeyMode: 'replace',
        },
      },
    ]);
  });

  test('graphile task list bridges server handlers and fails missing handlers', async () => {
    const handled: QueuedJob[] = [];
    const taskList = buildGraphileTaskList({
      'webhook.fire': async (job) => {
        handled.push(job);
      },
    });

    await taskList['webhook.fire']?.({ workspaceId: 'workspace-a', event: 'created' });
    await expect(taskList['mail.sync.imap']?.({ workspaceId: 'workspace-a', accountId: 1 }))
      .rejects.toThrow('No handler registered for job type mail.sync.imap');

    expect(handled).toHaveLength(1);
    expect(handled[0]).toMatchObject({
      type: 'webhook.fire',
      workspaceId: 'workspace-a',
      payload: { workspaceId: 'workspace-a', event: 'created' },
    });
  });

  test('production job handlers validate payloads and delegate to server-side ports', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    expect(buildMailSyncJobPlan({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      actorUserId: ' user-a ',
    }, WORKSPACE_A_ID, 'imap')).toEqual({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      protocol: 'imap',
      actorUserId: 'user-a',
    });
    expect(buildMailSyncJobPlan({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      fullInbox: true,
    }, WORKSPACE_A_ID, 'imap')).toEqual({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      protocol: 'imap',
      fullInbox: true,
    });
    expect(buildScheduledSendJobPlan({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      draftId: 99,
      dueBefore: '2026-06-03T12:30:00.000Z',
      limit: 10,
    }, WORKSPACE_A_ID, now)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      draftId: 99,
      dueBefore: new Date('2026-06-03T12:30:00.000Z'),
      limit: 10,
    });
    expect(buildScheduledSendJobPlan({ workspaceId: WORKSPACE_A_ID }, WORKSPACE_A_ID, now)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      dueBefore: now,
      limit: 50,
    });
    expect(buildAiReplySuggestionJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      profileId: 21,
      promptId: 22,
      trigger: 'open',
      force: true,
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      profileId: 21,
      promptId: 22,
      trigger: 'open',
      force: true,
    });
    expect(buildMailVacationAutoReplyJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 12,
      actorUserId: ' user-a ',
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      messageId: 12,
      actorUserId: 'user-a',
    });
    expect(buildAiAgentJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      profileId: 21,
      systemPrompt: ' Agent ',
      knowledgeBaseId: 5,
      createDraft: false,
      eventStrings: { subject: 'Hallo' },
      eventVariables: { 'message.id': 11 },
      continuation: {
        workflowId: 23,
        triggerName: ' inbound ',
        resumeNodeId: 'tag-1',
      },
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      profileId: 21,
      systemPrompt: 'Agent',
      knowledgeBaseId: 5,
      createDraft: false,
      eventStrings: { subject: 'Hallo' },
      eventVariables: { 'message.id': 11 },
      continuation: {
        workflowId: 23,
        triggerName: 'inbound',
        resumeNodeId: 'tag-1',
      },
    });
    expect(buildAiClassificationJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      profileId: 21,
      labels: ['Rechnung', ' Support ', 'Spam'],
      contextMode: 'full',
      continuation: {
        workflowId: 23,
        triggerName: ' inbound ',
        resumeNodeId: 'switch-1',
        eventStrings: { subject: 'Hallo' },
        eventVariables: { 'message.id': 11 },
      },
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      profileId: 21,
      labels: ['Rechnung', 'Support', 'Spam'],
      contextMode: 'full',
      continuation: {
        workflowId: 23,
        triggerName: 'inbound',
        resumeNodeId: 'switch-1',
        eventStrings: { subject: 'Hallo' },
        eventVariables: { 'message.id': 11 },
      },
    });
    expect(buildAiTransformTextJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      profileId: 21,
      promptId: 22,
      targetVariable: 'ai.summary',
      eventStrings: { subject: 'Hallo' },
      eventVariables: { 'message.id': 11 },
      continuation: {
        workflowId: 23,
        triggerName: ' inbound ',
        resumeNodeId: 'tag-1',
      },
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      profileId: 21,
      promptId: 22,
      targetVariable: 'ai.summary',
      eventStrings: { subject: 'Hallo' },
      eventVariables: { 'message.id': 11 },
      continuation: {
        workflowId: 23,
        triggerName: 'inbound',
        resumeNodeId: 'tag-1',
      },
    });
    expect(buildAiReviewJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      profileId: 21,
      promptId: 22,
      blockKeyword: ' BLOCK ',
      direction: 'outbound',
      continuation: {
        workflowId: 23,
        resumeNodeId: 'tag-1',
      },
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      profileId: 21,
      promptId: 22,
      blockKeyword: 'BLOCK',
      direction: 'outbound',
      continuation: {
        workflowId: 23,
        resumeNodeId: 'tag-1',
      },
    });
    expect(buildWorkflowExecutionJobPlan({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      messageId: 11,
      delayedJobId: 87,
      triggerName: ' mail.received ',
      context: { source: 'sync' },
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      messageId: 11,
      delayedJobId: 87,
      triggerName: 'mail.received',
      context: { source: 'sync' },
    });
    expect(buildWorkflowHttpRequestJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      method: 'post',
      url: ' https://api.example.com/hook ',
      body: { ok: true },
      timeoutMs: 5000,
      continuation: {
        workflowId: 23,
        triggerName: ' inbound ',
        resumeNodeId: 'tag-1',
      },
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      method: 'POST',
      url: 'https://api.example.com/hook',
      body: '{"ok":true}',
      timeoutMs: 5000,
      continuation: {
        workflowId: 23,
        triggerName: 'inbound',
        resumeNodeId: 'tag-1',
      },
    });
    expect(buildWorkflowForwardCopyJobPlan({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      messageId: 11,
      to: ' audit@example.com ',
      continuation: {
        workflowId: 23,
        triggerName: ' inbound ',
        resumeNodeId: 'tag-1',
      },
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      messageId: 11,
      to: 'audit@example.com',
      includeAttachments: false,
      runOutboundReview: false,
      continuation: {
        workflowId: 23,
        triggerName: 'inbound',
        resumeNodeId: 'tag-1',
      },
    });

    expect(() => buildMailSyncJobPlan({
      workspaceId: WORKSPACE_B_ID,
      accountId: 7,
    }, WORKSPACE_A_ID, 'imap')).toThrow('workspaceId must match');
    expect(() => buildScheduledSendJobPlan({
      workspaceId: WORKSPACE_A_ID,
      limit: 1001,
    }, WORKSPACE_A_ID, now)).toThrow('limit must be an integer');
    expect(() => buildWorkflowExecutionJobPlan({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      context: [],
    }, WORKSPACE_A_ID)).toThrow('context must be an object');
    expect(() => buildWorkflowHttpRequestJobPlan({
      workspaceId: WORKSPACE_A_ID,
      method: 'PUT',
      url: 'https://api.example.com',
    }, WORKSPACE_A_ID)).toThrow('method must be GET or POST');
    expect(() => buildWorkflowHttpRequestJobPlan({
      workspaceId: WORKSPACE_A_ID,
      url: 'x'.repeat(2049),
    }, WORKSPACE_A_ID)).toThrow('url must not exceed 2048 characters');
    expect(() => buildWorkflowForwardCopyJobPlan({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      messageId: 11,
      to: 'x'.repeat(1001),
    }, WORKSPACE_A_ID)).toThrow('to must not exceed 1000 characters');
    expect(() => buildAiReplySuggestionJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      trigger: 'manual',
    }, WORKSPACE_A_ID)).toThrow('trigger must be inbound or open');
    expect(buildAiReplySuggestionJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      force: true,
      skipIfReady: true,
      trigger: 'inbound',
    }, WORKSPACE_A_ID)).toMatchObject({
      messageId: 11,
      force: true,
      skipIfReady: true,
      trigger: 'inbound',
    });
    expect(() => buildAiReplySuggestionJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      skipIfReady: 'yes',
    }, WORKSPACE_A_ID)).toThrow('skipIfReady must be a boolean');
    expect(() => buildMailVacationAutoReplyJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 0,
    }, WORKSPACE_A_ID)).toThrow('messageId must be a positive integer');
    expect(() => buildAiAgentJobPlan({
      workspaceId: WORKSPACE_A_ID,
      createDraft: 'yes',
    }, WORKSPACE_A_ID)).toThrow('createDraft must be a boolean');
    expect(() => buildAiAgentJobPlan({
      workspaceId: WORKSPACE_A_ID,
      systemPrompt: 'x'.repeat(4001),
    }, WORKSPACE_A_ID)).toThrow('systemPrompt must not exceed 4000 characters');
    expect(() => buildAiClassificationJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      labels: '',
    }, WORKSPACE_A_ID)).toThrow('labels must contain at least one label');
    expect(() => buildAiClassificationJobPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      labels: ['Support'],
      contextMode: 'summary',
    }, WORKSPACE_A_ID)).toThrow('contextMode must be metadata or full');
    expect(() => buildAiTransformTextJobPlan({
      workspaceId: WORKSPACE_A_ID,
      targetVariable: '',
    }, WORKSPACE_A_ID)).not.toThrow();
    expect(buildAiTransformTextJobPlan({
      workspaceId: WORKSPACE_A_ID,
    }, WORKSPACE_A_ID).targetVariable).toBe('ai.text');
    expect(() => buildAiReviewJobPlan({
      workspaceId: WORKSPACE_A_ID,
      direction: 'manual',
    }, WORKSPACE_A_ID)).toThrow('direction must be inbound or outbound');

    const calls: string[] = [];
    const handlers = createProductionJobHandlers({
      now: () => now,
      mailSync: {
        async sync(input) {
          calls.push(`sync:${input.protocol}:${input.accountId}`);
          return { inboundMessageIds: [101, 102] };
        },
      },
      mailSyncPostProcess: {
        async afterSync(input) {
          calls.push([
            `post-sync:${input.protocol}:${input.accountId}`,
            input.syncStartedAt.toISOString(),
            input.syncFinishedAt.toISOString(),
            input.result?.inboundMessageIds?.join(',') ?? '',
          ].join(':'));
        },
      },
      scheduledSend: {
        async processDue(input) {
          calls.push(`scheduled:${input.limit}:${input.dueBefore.toISOString()}`);
        },
      },
      aiReplySuggestion: {
        async ensure(input) {
          calls.push(`ai:${input.messageId}:${input.force}:${input.trigger ?? ''}`);
        },
      },
      mailVacationAutoReply: {
        async autoReply(input) {
          calls.push(`vacation:${input.messageId}:${input.actorUserId ?? ''}`);
        },
      },
      aiAgent: {
        async runAgent(input) {
          calls.push(`agent:${input.messageId ?? 0}:${input.knowledgeBaseId ?? 0}:${input.continuation?.resumeNodeId ?? ''}`);
        },
      },
      aiClassification: {
        async classify(input) {
          calls.push(`classify:${input.messageId}:${input.labels.join('|')}:${input.continuation?.resumeNodeId ?? ''}`);
        },
      },
      aiReview: {
        async review(input) {
          calls.push(`review:${input.messageId ?? 0}:${input.direction}:${input.blockKeyword}:${input.continuation?.resumeNodeId ?? ''}`);
        },
      },
      aiTransformText: {
        async transformText(input) {
          calls.push(`transform:${input.messageId ?? 0}:${input.targetVariable}:${input.continuation?.resumeNodeId ?? ''}`);
        },
      },
      workflowExecution: {
        async execute(input) {
          calls.push(`workflow:${input.workflowId}:${input.context.source ?? ''}`);
        },
      },
      workflowHttpRequest: {
        async request(input) {
          calls.push(`http:${input.method}:${input.url}:${input.continuation?.resumeNodeId ?? ''}`);
        },
      },
      workflowForwardCopy: {
        async forwardCopy(input) {
          calls.push(`forward:${input.messageId}:${input.to}:${input.continuation?.resumeNodeId ?? ''}`);
        },
      },
    });

    await handlers['mail.sync.imap']?.(makeQueuedJob({
      type: 'mail.sync.imap',
      workspaceId: WORKSPACE_A_ID,
      payload: { workspaceId: WORKSPACE_A_ID, accountId: 7 },
    }));
    await handlers['mail.send.scheduled']?.(makeQueuedJob({
      type: 'mail.send.scheduled',
      workspaceId: WORKSPACE_A_ID,
      payload: { workspaceId: WORKSPACE_A_ID, limit: 5 },
    }));
    await handlers['ai.reply_suggestion']?.(makeQueuedJob({
      type: 'ai.reply_suggestion',
      workspaceId: WORKSPACE_A_ID,
      payload: { workspaceId: WORKSPACE_A_ID, messageId: 11, force: true, trigger: 'open' },
    }));
    await handlers['mail.vacation.auto_reply']?.(makeQueuedJob({
      type: 'mail.vacation.auto_reply',
      workspaceId: WORKSPACE_A_ID,
      payload: { workspaceId: WORKSPACE_A_ID, messageId: 12, actorUserId: USER_A_ID },
    }));
    await handlers['ai.agent']?.(makeQueuedJob({
      type: 'ai.agent',
      workspaceId: WORKSPACE_A_ID,
      payload: {
        workspaceId: WORKSPACE_A_ID,
        messageId: 11,
        knowledgeBaseId: 5,
        createDraft: false,
        continuation: { workflowId: 23, resumeNodeId: 'tag-1' },
      },
    }));
    await handlers['ai.classify']?.(makeQueuedJob({
      type: 'ai.classify',
      workspaceId: WORKSPACE_A_ID,
      payload: {
        workspaceId: WORKSPACE_A_ID,
        messageId: 11,
        labels: ['Rechnung', 'Support'],
        continuation: { workflowId: 23, resumeNodeId: 'switch-1' },
      },
    }));
    await handlers['ai.review']?.(makeQueuedJob({
      type: 'ai.review',
      workspaceId: WORKSPACE_A_ID,
      payload: {
        workspaceId: WORKSPACE_A_ID,
        messageId: 11,
        direction: 'outbound',
        blockKeyword: 'BLOCK',
        continuation: { workflowId: 23, resumeNodeId: 'tag-1' },
      },
    }));
    await handlers['ai.transform_text']?.(makeQueuedJob({
      type: 'ai.transform_text',
      workspaceId: WORKSPACE_A_ID,
      payload: {
        workspaceId: WORKSPACE_A_ID,
        messageId: 11,
        targetVariable: 'ai.summary',
        continuation: { workflowId: 23, resumeNodeId: 'tag-1' },
      },
    }));
    await handlers['workflow.execute']?.(makeQueuedJob({
      type: 'workflow.execute',
      workspaceId: WORKSPACE_A_ID,
      payload: { workspaceId: WORKSPACE_A_ID, workflowId: 23, context: { source: 'sync' } },
    }));
    await handlers['workflow.http_request']?.(makeQueuedJob({
      type: 'workflow.http_request',
      workspaceId: WORKSPACE_A_ID,
      payload: {
        workspaceId: WORKSPACE_A_ID,
        method: 'POST',
        url: 'https://api.example.com/hook',
        body: 'body',
        continuation: { workflowId: 23, resumeNodeId: 'tag-1' },
      },
    }));
    await handlers['workflow.forward_copy']?.(makeQueuedJob({
      type: 'workflow.forward_copy',
      workspaceId: WORKSPACE_A_ID,
      payload: {
        workspaceId: WORKSPACE_A_ID,
        workflowId: 23,
        messageId: 11,
        to: ' audit@example.com ',
        continuation: { workflowId: 23, resumeNodeId: 'tag-1' },
      },
    }));

    expect(calls).toEqual([
      'sync:imap:7',
      'post-sync:imap:7:2026-06-03T12:00:00.000Z:2026-06-03T12:00:00.000Z:101,102',
      'scheduled:5:2026-06-03T12:00:00.000Z',
      'ai:11:true:open',
      `vacation:12:${USER_A_ID}`,
      'agent:11:5:tag-1',
      'classify:11:Rechnung|Support:switch-1',
      'review:11:outbound:BLOCK:tag-1',
      'transform:11:ai.summary:tag-1',
      'workflow:23:sync',
      'http:POST:https://api.example.com/hook:tag-1',
      'forward:11:audit@example.com:tag-1',
    ]);
    await expect(createProductionJobHandlers({})['mail.sync.pop3']?.(makeQueuedJob({
      type: 'mail.sync.pop3',
      workspaceId: WORKSPACE_A_ID,
      payload: { workspaceId: WORKSPACE_A_ID, accountId: 7 },
    }))).rejects.toThrow('mail sync job port is not configured');
    await expect(createProductionJobHandlers({})['mail.vacation.auto_reply']?.(makeQueuedJob({
      type: 'mail.vacation.auto_reply',
      workspaceId: WORKSPACE_A_ID,
      payload: { workspaceId: WORKSPACE_A_ID, messageId: 12 },
    }))).rejects.toThrow('mail vacation auto-reply job port is not configured');
  });

  test('server mail sync job port imports IMAP messages and tolerates optional folder failures', async () => {
    const now = new Date('2026-07-05T10:00:00.000Z');
    const account = makeServerMailSyncAccount({
      protocol: 'imap',
      imapSyncSpam: true,
    });
    const upserts: any[] = [];
    const attachmentWrites: any[] = [];
    const folderUpdates: any[] = [];
    const folders = new Map<string, any>([
      ['INBOX', makeServerMailSyncFolder({ id: 71, sourceSqliteId: -710, path: 'INBOX', lastUid: 5 })],
      ['Junk', makeServerMailSyncFolder({ id: 72, sourceSqliteId: -720, path: 'Junk', lastUid: 0 })],
    ]);
    const store = makeServerMailSyncStore({
      account,
      folders,
      upserts,
      attachmentWrites,
      folderUpdates,
      messageIds: [1001, 1002],
    });
    const imapFactoryInputs: any[] = [];
    const fetchedUids: string[] = [];
    const releasedLocks: string[] = [];
    const client = {
      async connect() {
        return undefined;
      },
      async list() {
        return [
          { path: 'Junk', name: 'Junk', delimiter: '/', flags: new Set(['\\Junk']), specialUse: '\\Junk' },
        ];
      },
      async status(path: string) {
        if (path === 'Junk') throw new Error('optional mailbox missing');
        return { uidValidity: 22 };
      },
      async getMailboxLock(path: string) {
        return { release: () => releasedLocks.push(path) };
      },
      async search(query: any) {
        if (query.uid === '6:*') return [6, 7];
        if (query.all) return [1, 2, 3, 4, 5, 6, 7];
        return [];
      },
      async fetchOne(uid: string) {
        fetchedUids.push(uid);
        return {
          source: Buffer.from(`Subject: ${uid}\r\n\r\nBody ${uid}`),
          flags: uid === '6' ? new Set(['\\Seen']) : new Set<string>(),
          threadId: `thread-${uid}`,
        };
      },
      async logout() {
        return undefined;
      },
    };

    const port = createServerMailSyncJobPort({
      store,
      now: () => now,
      parser: async (source) => {
        const seed = source.toString('utf8');
        const parsed = makeParsedServerMailSyncMessage(seed);
        return seed.includes('Subject: 6')
          ? {
            ...parsed,
            hasAttachments: true,
            attachmentsJson: [{ filename: 'invoice.pdf', contentType: 'application/pdf', size: 7 }],
            attachments: [{
              filename: 'invoice.pdf',
              contentType: 'application/pdf',
              sizeBytes: 7,
              contentSha256: 'hash-1',
              content: Buffer.from('payload'),
            }],
          }
          : parsed;
      },
      imapClientFactory(input) {
        imapFactoryInputs.push(input);
        return client as any;
      },
    });

    await expect(port.sync({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      protocol: 'imap',
      actorUserId: USER_A_ID,
    })).resolves.toEqual({ inboundMessageIds: [1001, 1002] });

    expect(imapFactoryInputs).toEqual([expect.objectContaining({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      auth: { user: 'sync@example.com', pass: 'imap-secret' },
    })]);
    expect(fetchedUids).toEqual(['6', '7']);
    expect(releasedLocks).toEqual(['INBOX', 'Junk']);
    expect(upserts.map((item) => ({
      uid: item.uid,
      seenLocal: item.seenLocal,
      folderKind: item.folderKind,
      imapThreadId: item.imapThreadId,
    }))).toEqual([
      { uid: 6, seenLocal: true, folderKind: 'inbox', imapThreadId: 'thread-6' },
      { uid: 7, seenLocal: false, folderKind: 'inbox', imapThreadId: 'thread-7' },
    ]);
    expect(attachmentWrites).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      messageId: 1001,
      attachments: [expect.objectContaining({
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        sizeBytes: 7,
      })],
    }]);
    expect(folderUpdates).toEqual([expect.objectContaining({
      workspaceId: WORKSPACE_A_ID,
      folderId: 71,
      lastUid: 7,
      uidvalidity: 22,
      uidvalidityStr: '22',
      syncedAt: now,
    })]);
  });

  test('server mail sync full inbox backfill imports only missing older messages without moving the cursor', async () => {
    const now = new Date('2026-07-06T10:00:00.000Z');
    const account = makeServerMailSyncAccount({ protocol: 'imap' });
    const upserts: any[] = [];
    const folderUpdates: any[] = [];
    const folders = new Map<string, any>([
      ['INBOX', makeServerMailSyncFolder({ id: 71, path: 'INBOX', lastUid: 7 })],
    ]);
    const store = makeServerMailSyncStore({ account, folders, upserts, folderUpdates, messageIds: [201, 202, 203, 204] });
    // UIDs 5,6,7 already imported; 1-4 are older mail skipped by the first-sync cap.
    store.loadImapUidToId = async () => new Map([[5, 105], [6, 106], [7, 107]]);
    const fetchedUids: string[] = [];
    const searchedQueries: any[] = [];
    const client = {
      async connect() { return undefined; },
      async list() { return []; },
      async status() { return { uidValidity: 22 }; },
      async getMailboxLock() { return { release: () => undefined }; },
      async search(query: any) {
        searchedQueries.push(query);
        return query.all ? [1, 2, 3, 4, 5, 6, 7] : [];
      },
      async fetchOne(uid: string) {
        fetchedUids.push(uid);
        return {
          source: Buffer.from(`Subject: ${uid}\r\n\r\nBody ${uid}`),
          flags: new Set(['\\Seen']),
          threadId: null,
        };
      },
      async logout() { return undefined; },
    };
    const port = createServerMailSyncJobPort({
      store,
      now: () => now,
      parser: async (source) => makeParsedServerMailSyncMessage(source.toString('utf8')),
      imapClientFactory() { return client as any; },
    });

    const result = await port.sync({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      protocol: 'imap',
      actorUserId: USER_A_ID,
      fullInbox: true,
    });

    // Only the missing older messages are downloaded.
    expect(fetchedUids).toEqual(['1', '2', '3', '4']);
    expect(upserts.map((item) => item.uid)).toEqual([1, 2, 3, 4]);
    // Backfill uses a single full search, never the incremental window.
    expect(searchedQueries).toEqual([{ all: true }]);
    // The sync cursor is not moved by a backfill.
    expect(folderUpdates[0].lastUid).toBe(7);
    // Historical mail must not trigger inbound workflows/spam/AI.
    expect(result).toEqual({ inboundMessageIds: [] });
  });

  test('server mail sync skips a failing message and keeps advancing the cursor past it', async () => {
    const now = new Date('2026-07-07T10:00:00.000Z');
    const account = makeServerMailSyncAccount({ protocol: 'imap' });
    const upserts: any[] = [];
    const folderUpdates: any[] = [];
    const folders = new Map<string, any>([
      ['INBOX', makeServerMailSyncFolder({ id: 71, path: 'INBOX', lastUid: 5 })],
    ]);
    const store = makeServerMailSyncStore({ account, folders, upserts, folderUpdates, messageIds: [301, 302] });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const client = {
      async connect() { return undefined; },
      async list() { return []; },
      async status() { return { uidValidity: 22 }; },
      async getMailboxLock() { return { release: () => undefined }; },
      async search(query: any) {
        if (query.uid === '6:*') return [6, 7, 8];
        return query.all ? [1, 2, 3, 4, 5, 6, 7, 8] : [];
      },
      async fetchOne(uid: string) {
        return {
          source: Buffer.from(`Subject: ${uid}\r\n\r\nBody ${uid}`),
          flags: new Set<string>(),
          threadId: null,
        };
      },
      async logout() { return undefined; },
    };
    const port = createServerMailSyncJobPort({
      store,
      now: () => now,
      // UID 7 fails to parse; it must not block UID 8 or freeze the cursor.
      parser: async (source) => {
        const seed = source.toString('utf8');
        if (seed.includes('Subject: 7')) throw new Error('boom parsing UID 7');
        return makeParsedServerMailSyncMessage(seed);
      },
      imapClientFactory() { return client as any; },
    });

    await port.sync({ workspaceId: WORKSPACE_A_ID, accountId: 7, protocol: 'imap', actorUserId: USER_A_ID });

    // 6 and 8 import; 7 is skipped (not upserted) but logged.
    expect(upserts.map((item) => item.uid)).toEqual([6, 8]);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('UID 7'));
    // Crucially the cursor advances PAST the failed UID 7 so newer mail is not blocked.
    expect(folderUpdates[0].lastUid).toBe(8);
    warn.mockRestore();
  });

  test('server mail sync job port restores local metadata after UIDVALIDITY resets', async () => {
    const now = new Date('2026-07-05T10:30:00.000Z');
    const upserts: any[] = [];
    const folderUpdates: any[] = [];
    const uidValidityResets: any[] = [];
    const uidValidityRestores: any[] = [];
    const folders = new Map<string, any>([
      ['INBOX', makeServerMailSyncFolder({
        id: 71,
        sourceSqliteId: -710,
        path: 'INBOX',
        lastUid: 42,
        uidvalidity: 21,
        uidvalidityStr: '21',
      })],
    ]);
    const store = makeServerMailSyncStore({
      folders,
      upserts,
      folderUpdates,
      uidValidityResets,
      uidValidityRestores,
      messageIds: [3001],
    });
    const fetchedUids: string[] = [];
    const client = {
      async connect() {
        return undefined;
      },
      async list() {
        return [];
      },
      async status() {
        return { uidValidity: 22 };
      },
      async getMailboxLock(path: string) {
        return { release: () => void path };
      },
      async search(query: any) {
        if (query.all) return [9];
        return [];
      },
      async fetchOne(uid: string) {
        fetchedUids.push(uid);
        return {
          source: Buffer.from('Subject: UID reset\r\nMessage-ID: <stable@example.com>\r\n\r\nBody'),
          flags: new Set<string>(),
        };
      },
      async logout() {
        return undefined;
      },
    };
    const port = createServerMailSyncJobPort({
      store,
      now: () => now,
      parser: async (source) => ({
        ...makeParsedServerMailSyncMessage(source.toString('utf8')),
        messageId: '<stable@example.com>',
      }),
      imapClientFactory() {
        return client as any;
      },
    });

    await expect(port.sync({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      protocol: 'imap',
    })).resolves.toEqual({ inboundMessageIds: [3001] });

    expect(uidValidityResets).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      folderId: 71,
      folderPath: 'INBOX',
      oldUidValidity: '21',
      newUidValidity: '22',
      now,
    }]);
    expect(fetchedUids).toEqual(['9']);
    expect(upserts).toEqual([expect.objectContaining({
      uid: 9,
      messageId: '<stable@example.com>',
      folderKind: 'inbox',
    })]);
    expect(uidValidityRestores).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      folderId: 71,
      messageId: 3001,
      messageIdHeader: '<stable@example.com>',
      now,
    }]);
    expect(folderUpdates).toEqual([expect.objectContaining({
      workspaceId: WORKSPACE_A_ID,
      folderId: 71,
      lastUid: 9,
      uidvalidity: 22,
      uidvalidityStr: '22',
      syncedAt: now,
    })]);
  });

  test('postgres mail sync attachment replacement cleans up files when metadata insert fails', async () => {
    const root = mkdtempSync(join(tmpdir(), 'mail-sync-attachment-cleanup-'));
    const insertedRows: Array<Record<string, unknown>> = [];
    const db = {
      transaction() {
        return {
          execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
        };
      },
      selectFrom(table: string) {
        if (table !== 'email_messages') throw new Error(`unexpected select table ${table}`);
        return {
          select() {
            return this;
          },
          where() {
            return this;
          },
          async executeTakeFirst() {
            return { id: 901, source_sqlite_id: 9901 };
          },
        };
      },
      deleteFrom(table: string) {
        if (table !== 'email_message_attachments') throw new Error(`unexpected delete table ${table}`);
        return {
          where() {
            return this;
          },
          async execute() {
            return undefined;
          },
        };
      },
      insertInto(table: string) {
        if (table !== 'email_message_attachments') throw new Error(`unexpected insert table ${table}`);
        return {
          values(value: Record<string, unknown> | Array<Record<string, unknown>>) {
            insertedRows.push(...(Array.isArray(value) ? value : [value]));
            return this;
          },
          async execute() {
            throw new Error('metadata insert failed');
          },
        };
      },
    } as unknown as Kysely<any>;

    try {
      await expect(replacePostgresMailSyncAttachments({
        db,
        attachmentsRoot: root,
        workspaceId: WORKSPACE_A_ID,
        messageId: 901,
        applyWorkspaceSession: async () => undefined,
        attachments: [{
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          sizeBytes: 7,
          contentSha256: 'hash-1',
          content: Buffer.from('payload'),
        }],
      })).rejects.toThrow('metadata insert failed');

      expect(insertedRows).toHaveLength(1);
      const storagePath = String(insertedRows[0].storage_path);
      expect(storagePath).toContain('/mail-sync/901/');
      expect(existsSync(join(root, storagePath))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('server mail sync job port skips known POP3 UIDLs and returns only new message ids', async () => {
    const now = new Date('2026-07-05T11:00:00.000Z');
    const account = makeServerMailSyncAccount({
      protocol: 'pop3',
      pop3Host: 'pop3.example.com',
      pop3Port: 995,
      pop3Tls: true,
    });
    const upserts: any[] = [];
    const folderUpdates: any[] = [];
    const retrCalls: number[] = [];
    const store = makeServerMailSyncStore({
      account,
      folders: new Map([['INBOX', makeServerMailSyncFolder({ id: 81, sourceSqliteId: -810, path: 'INBOX', lastUid: 1 })]]),
      upserts,
      folderUpdates,
      pop3Known: new Map([['known-uidl', 77]]),
      messageIds: [2002],
    });
    const pop3FactoryInputs: any[] = [];
    let quitCalled = false;
    const port = createServerMailSyncJobPort({
      store,
      now: () => now,
      parser: async (source) => makeParsedServerMailSyncMessage(source.toString('utf8')),
      pop3ClientFactory(input) {
        pop3FactoryInputs.push(input);
        return {
          async connect() {
            return undefined;
          },
          async uidl() {
            return [[1, 'known-uidl'], [2, 'new-uidl']] as [number, string][];
          },
          async retr(messageNumber: number) {
            retrCalls.push(messageNumber);
            return Buffer.from(`Subject: POP3 ${messageNumber}\r\n\r\nBody`);
          },
          async quit() {
            quitCalled = true;
          },
        };
      },
    });

    await expect(port.sync({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      protocol: 'pop3',
    })).resolves.toEqual({ inboundMessageIds: [2002] });

    expect(pop3FactoryInputs).toEqual([expect.objectContaining({
      host: 'pop3.example.com',
      port: 995,
      tls: true,
      user: 'sync@example.com',
      password: 'imap-secret',
    })]);
    expect(retrCalls).toEqual([2]);
    expect(upserts).toEqual([expect.objectContaining({
      pop3Uidl: 'new-uidl',
      folderKind: 'inbox',
      seenLocal: false,
    })]);
    expect(folderUpdates).toEqual([expect.objectContaining({
      workspaceId: WORKSPACE_A_ID,
      folderId: 81,
      lastUid: 2,
      pop3UidlStr: JSON.stringify(['known-uidl', 'new-uidl']),
      syncedAt: now,
    })]);
    expect(quitCalled).toBe(true);
  });

  test('server mail sync job port rejects account protocol mismatches', async () => {
    const store = makeServerMailSyncStore({
      account: makeServerMailSyncAccount({ protocol: 'imap' }),
    });
    const port = createServerMailSyncJobPort({ store });
    await expect(port.sync({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      protocol: 'pop3',
    })).rejects.toThrow('Job erwartet pop3');
  });

  test('postgres email vacation test port sends account auto-reply test via server SMTP secrets', async () => {
    const now = new Date('2026-06-04T08:30:00.000Z');
    const { db } = makeAiReplySuggestionDb({
      accounts: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        display_name: 'Support, Team <CRM>',
        email_address: 'support@example.com',
        imap_host: 'imap.example.com',
        imap_username: 'imap-user',
        smtp_host: 'smtp.example.com',
        smtp_port: 465,
        smtp_tls: true,
        smtp_username: 'smtp-user',
        smtp_use_imap_auth: false,
        oauth_provider: null,
        vacation_subject: 'Wir sind unterwegs',
        vacation_body_text: 'Danke fuer Ihre Nachricht.\nBis bald.',
      }],
    });
    const secretReads: unknown[] = [];
    const smtpInputs: any[] = [];
    const secrets = {
      async readSecret(input: unknown) {
        secretReads.push(input);
        if ((input as { kind?: string }).kind === 'email.account.smtp_password') {
          return Buffer.from('smtp-secret');
        }
        return null;
      },
    } as any;
    const port = createPostgresEmailVacationTestPort({
      db,
      secrets,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      async smtpSend(input) {
        smtpInputs.push(input);
      },
    });

    await expect(port.sendTest({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      accountId: 7,
    })).resolves.toEqual({
      success: true,
      accountId: 7,
      emailAddress: 'support@example.com',
    });

    expect(secretReads).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      kind: 'email.account.smtp_password',
      name: 'email_account:7:smtp',
    }]);
    expect(smtpInputs).toHaveLength(1);
    expect(smtpInputs[0]).toMatchObject({
      host: 'smtp.example.com',
      port: 465,
      tls: true,
      user: 'smtp-user',
      password: 'smtp-secret',
      envelopeFrom: 'support@example.com',
      recipients: ['support@example.com'],
    });

    const rfc822 = String(smtpInputs[0].rfc822);
    const encodedName = Buffer.from('Support, Team CRM', 'utf8').toString('base64');
    expect(rfc822).toContain(`From: =?UTF-8?B?${encodedName}?= <support@example.com>`);
    expect(rfc822).toContain('To: support@example.com');
    expect(rfc822).toContain('Subject: [Test] Wir sind unterwegs');
    expect(rfc822).toContain('Auto-Submitted: auto-replied');
    expect(rfc822).toContain('Danke fuer Ihre Nachricht.\r\nBis bald.\r\n\r\n-- Test der Abwesenheitsantwort (SimpleCRM)');

    await expect(port.sendTest({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      accountId: 99,
    })).resolves.toEqual({ success: false, error: 'Konto nicht gefunden' });
    expect(smtpInputs).toHaveLength(1);
  });

  test('postgres email vacation auto-reply port sends eligible inbound mail once per sender', async () => {
    const now = new Date('2026-06-04T09:30:00.000Z');
    const { db, rows } = makeAiReplySuggestionDb({
      accounts: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        display_name: 'Support',
        email_address: 'support@example.com',
        imap_host: 'imap.example.com',
        imap_username: 'imap-user',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_tls: false,
        smtp_username: null,
        smtp_use_imap_auth: true,
        oauth_provider: null,
        vacation_enabled: true,
        vacation_subject: 'Away',
        vacation_body_text: 'Back soon',
      }],
      messages: [{
        id: 33,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 330,
        account_id: 7,
        uid: 11,
        pop3_uidl: null,
        message_id: '<inbound@example.net>',
        from_json: { value: [{ name: 'Guest', address: 'guest@example.com' }] },
        raw_headers: 'From: Guest <guest@example.com>',
        customer_id: 9,
        customer_source_sqlite_id: 90,
        archived: false,
        soft_deleted: false,
        is_spam: false,
        spam_status: 'clean',
        spam_score_label: 'clean',
        folder_kind: 'inbox',
      }],
    });
    const smtpInputs: any[] = [];
    const port = createPostgresEmailVacationAutoReplyPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      secrets: {
        async readSecret(input) {
          expect(input).toEqual({
            workspaceId: WORKSPACE_A_ID,
            kind: 'email.account.imap_password',
            name: 'email_account:7:imap',
          });
          return Buffer.from('imap-secret');
        },
      } as any,
      async smtpSend(input) {
        smtpInputs.push(input);
      },
    });

    await port.autoReply({
      workspaceId: WORKSPACE_A_ID,
      messageId: 33,
      actorUserId: USER_A_ID,
    });

    expect(smtpInputs).toHaveLength(1);
    expect(smtpInputs[0]).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      tls: false,
      user: 'imap-user',
      password: 'imap-secret',
      envelopeFrom: 'support@example.com',
      recipients: ['guest@example.com'],
    });
    const rfc822 = String(smtpInputs[0].rfc822);
    expect(rfc822).toContain('From: Support <support@example.com>');
    expect(rfc822).toContain('To: guest@example.com');
    expect(rfc822).toContain('Subject: Away');
    expect(rfc822).toContain('In-Reply-To: <inbound@example.net>');
    expect(rfc822).toContain('Auto-Submitted: auto-replied');
    expect(rfc822).toContain('Back soon');
    expect(rows.syncInfo).toEqual([expect.objectContaining({
      workspace_id: WORKSPACE_A_ID,
      key: 'vacation_reply_sent:7:guest@example.com',
      value: now.toISOString(),
    })]);
    expect(rows.activityLog).toEqual([expect.objectContaining({
      workspace_id: WORKSPACE_A_ID,
      customer_id: 9,
      customer_source_sqlite_id: 90,
      activity_type: 'email_vacation_auto_reply',
      title: 'Abwesenheitsantwort gesendet',
      description: 'Automatische Antwort an guest@example.com',
      metadata: {
        accountId: 7,
        inboundMessageId: 33,
        subject: 'Away',
      },
    })]);

    await port.autoReply({
      workspaceId: WORKSPACE_A_ID,
      messageId: 33,
    });

    expect(smtpInputs).toHaveLength(1);
    expect(rows.activityLog).toHaveLength(1);
  });

  test('postgres email vacation auto-reply port records SMTP failures and suppresses retries briefly', async () => {
    const now = new Date('2026-06-04T09:45:00.000Z');
    const { db, rows } = makeAiReplySuggestionDb({
      accounts: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        display_name: 'Support',
        email_address: 'support@example.com',
        imap_host: 'imap.example.com',
        imap_username: 'imap-user',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_tls: false,
        smtp_username: null,
        smtp_use_imap_auth: true,
        oauth_provider: null,
        vacation_enabled: true,
        vacation_subject: 'Away',
        vacation_body_text: 'Back soon',
      }],
      messages: [{
        id: 34,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 340,
        account_id: 7,
        uid: 12,
        pop3_uidl: null,
        message_id: '<failure@example.net>',
        from_json: { value: [{ address: 'fail@example.com' }] },
        raw_headers: 'From: fail@example.com',
        customer_id: null,
        customer_source_sqlite_id: null,
        archived: false,
        soft_deleted: false,
        is_spam: false,
        spam_status: 'clean',
        spam_score_label: 'clean',
        folder_kind: 'inbox',
      }],
    });
    const smtpInputs: any[] = [];
    const port = createPostgresEmailVacationAutoReplyPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      secrets: {
        async readSecret() {
          return Buffer.from('imap-secret');
        },
      } as any,
      async smtpSend(input) {
        smtpInputs.push(input);
        throw new Error('smtp down');
      },
    });

    await port.autoReply({
      workspaceId: WORKSPACE_A_ID,
      messageId: 34,
    });

    expect(smtpInputs).toHaveLength(1);
    expect(rows.syncInfo).toEqual([expect.objectContaining({
      workspace_id: WORKSPACE_A_ID,
      key: 'vacation_smtp_fail:7:fail@example.com',
      value: now.toISOString(),
    })]);
    expect(rows.activityLog).toEqual([expect.objectContaining({
      activity_type: 'email_vacation_auto_reply_failed',
      title: 'Abwesenheitsantwort fehlgeschlagen',
      description: 'smtp down',
      metadata: {
        accountId: 7,
        inboundMessageId: 34,
        sender: 'fail@example.com',
      },
    })]);

    await port.autoReply({
      workspaceId: WORKSPACE_A_ID,
      messageId: 34,
    });

    expect(smtpInputs).toHaveLength(1);
    expect(rows.activityLog).toHaveLength(1);
  });

  test('postgres AI reply suggestion port generates and persists ready replies', async () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    const { db, rows } = makeAiReplySuggestionDb({
      messages: [{
        id: 11,
        workspace_id: WORKSPACE_A_ID,
        account_id: 7,
        uid: 101,
        pop3_uidl: null,
        soft_deleted: false,
        is_spam: false,
        spam_status: 'clean',
        spam_score_label: 'clean',
        folder_kind: 'inbox',
        raw_headers: 'From: sender@example.com',
        subject: 'Retourenfrage',
        from_json: { value: [{ name: 'Max Kunde', address: 'max@example.com' }] },
        body_text: 'Ich moechte eine Retoure anmelden.',
        snippet: null,
        customer_id: 5,
        reply_suggestion_text: null,
        reply_suggestion_status: null,
        reply_suggestion_error: null,
        reply_suggestion_updated_at: null,
        updated_at: now,
      }],
      prompts: [{
        id: 22,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 22,
        label: 'Reply',
        user_template: 'Betreff {{subject}} von {{from}} fuer {{customer.name}}: {{body}}',
        target: 'reply',
        profile_source_sqlite_id: null,
        profile_id: 21,
        sort_order: 1,
        source_row: {},
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      }],
      profiles: [{
        id: 21,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 21,
        label: 'OpenAI',
        provider: 'openai',
        base_url: 'https://api.openai.test/v1',
        model: 'gpt-test',
        embedding_model: null,
        legacy_keytar_account: null,
        secret_id: 'secret-21',
        is_default: true,
        sort_order: 1,
        source_row: {},
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      }],
      customers: [{
        id: 5,
        workspace_id: WORKSPACE_A_ID,
        name: 'Max Kunde',
        first_name: 'Max',
        email: 'max@example.com',
      }],
    });
    const chatInputs: unknown[] = [];
    const secrets = {
      async readSecret(input: unknown) {
        expect(input).toEqual({
          workspaceId: WORKSPACE_A_ID,
          kind: 'email.ai_profile.api_key',
          name: 'email_ai_profile:21:api_key',
        });
        return Buffer.from('sk-test');
      },
    } as any;
    const port = createPostgresAiReplySuggestionPort({
      db,
      secrets,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      async chatCompletion(input) {
        chatInputs.push(input);
        return 'Guten Tag, gern helfen wir weiter.';
      },
    });

    await port.ensure({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      promptId: 22,
      force: true,
    });

    expect(rows.messages[0]).toMatchObject({
      reply_suggestion_status: 'ready',
      reply_suggestion_text: 'Guten Tag, gern helfen wir weiter.',
      reply_suggestion_error: null,
      reply_suggestion_updated_at: now,
    });
    expect((chatInputs[0] as any).apiKey).toBe('sk-test');
    expect((chatInputs[0] as any).user).toContain('Retourenfrage');
    expect((chatInputs[0] as any).user).toContain('Max Kunde');

    await expect(port.get({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      now,
    })).resolves.toEqual({
      status: 'ready',
      text: 'Guten Tag, gern helfen wir weiter.',
      error: null,
      updatedAt: now.toISOString(),
    });
  });

  test('postgres AI classification port tags messages and resumes workflows', async () => {
    const now = new Date('2026-06-03T12:15:00.000Z');
    const { db, rows } = makeAiReplySuggestionDb({
      messages: [{
        id: 11,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 110,
        subject: 'Supportfrage',
        from_json: { value: [{ name: 'Max Kunde', address: 'max@example.com' }] },
        to_json: { value: [{ address: 'support@example.com' }] },
        cc_json: null,
        snippet: 'Ich brauche Hilfe mit meiner Bestellung.',
        body_text: 'Ich brauche Hilfe mit meiner Bestellung.',
        has_attachments: false,
        attachments_json: null,
      }],
      profiles: [{
        id: 21,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 21,
        label: 'OpenAI',
        provider: 'openai',
        base_url: 'https://api.openai.test/v1',
        model: 'gpt-test',
        embedding_model: null,
        legacy_keytar_account: null,
        secret_id: 'secret-21',
        is_default: true,
        sort_order: 1,
        source_row: {},
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      }],
    });
    const chatInputs: unknown[] = [];
    const secrets = {
      async readSecret(input: unknown) {
        expect(input).toEqual({
          workspaceId: WORKSPACE_A_ID,
          kind: 'email.ai_profile.api_key',
          name: 'email_ai_profile:21:api_key',
        });
        return Buffer.from('sk-test');
      },
    } as any;
    const port = createPostgresAiClassificationPort({
      db,
      secrets,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      async chatCompletion(input) {
        chatInputs.push(input);
        return 'Support | 85';
      },
    });

    await port.classify({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      labels: ['Rechnung', 'Support', 'Spam'],
      contextMode: 'metadata',
      continuation: {
        workflowId: 23,
        triggerName: 'inbound',
        resumeNodeId: 'switch-1',
        eventStrings: { subject: 'Supportfrage' },
        eventVariables: { 'message.id': 11 },
      },
    });

    expect(rows.tags).toEqual([
      expect.objectContaining({
        workspace_id: WORKSPACE_A_ID,
        message_source_sqlite_id: 110,
        message_id: 11,
        tag: 'ki:Support',
        created_at: now,
        updated_at: now,
      }),
    ]);
    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'workflow.execute',
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toEqual({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      messageId: 11,
      triggerName: 'inbound',
      context: {
        resumeNodeId: 'switch-1',
        eventStrings: { subject: 'Supportfrage' },
        eventVariables: {
          'message.id': 11,
          'ai.class': 'Support',
          'ai.class_confidence': 85,
        },
      },
    });
    expect((chatInputs[0] as any).apiKey).toBe('sk-test');
    expect((chatInputs[0] as any).user).toContain('Supportfrage');
    expect((chatInputs[0] as any).user).toContain('Rechnung, Support, Spam');
  });

  test('postgres AI transform text port stores output in resumed workflow variables', async () => {
    const now = new Date('2026-06-03T12:25:00.000Z');
    const { db, rows } = makeAiReplySuggestionDb({
      messages: [{
        id: 12,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 120,
        subject: 'Lange Anfrage',
        from_json: { value: [{ address: 'max@example.com' }] },
        to_json: { value: [{ address: 'support@example.com' }] },
        cc_json: null,
        snippet: 'Bitte zusammenfassen.',
        body_text: 'Bitte fasse diese Anfrage kurz zusammen.',
        has_attachments: false,
        attachments_json: null,
      }],
      prompts: [{
        id: 22,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 22,
        label: 'Summary',
        user_template: 'Fasse {{subject}} zusammen: {{body_text}} / {{customer.name}}',
        target: 'summary',
        profile_source_sqlite_id: null,
        profile_id: 21,
        sort_order: 1,
        source_row: {},
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      }],
      profiles: [{
        id: 21,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 21,
        label: 'OpenAI',
        provider: 'openai',
        base_url: 'https://api.openai.test/v1',
        model: 'gpt-test',
        embedding_model: null,
        legacy_keytar_account: null,
        secret_id: 'secret-21',
        is_default: true,
        sort_order: 1,
        source_row: {},
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      }],
    });
    const chatInputs: unknown[] = [];
    const secrets = {
      async readSecret() {
        return Buffer.from('sk-test');
      },
    } as any;
    const port = createPostgresAiTransformTextPort({
      db,
      secrets,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      async chatCompletion(input) {
        chatInputs.push(input);
        return 'Kurzfassung der Anfrage';
      },
    });

    await port.transformText({
      workspaceId: WORKSPACE_A_ID,
      messageId: 12,
      promptId: 22,
      targetVariable: 'ai.summary',
      eventVariables: { 'customer.name': 'Max Kunde' },
      continuation: {
        workflowId: 24,
        triggerName: 'inbound',
        resumeNodeId: 'tag-1',
        eventVariables: { 'message.id': 12 },
      },
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'workflow.execute',
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toEqual({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 24,
      messageId: 12,
      triggerName: 'inbound',
      context: {
        resumeNodeId: 'tag-1',
        eventStrings: {},
        eventVariables: {
          'message.id': 12,
          'ai.summary': 'Kurzfassung der Anfrage',
        },
      },
    });
    expect((chatInputs[0] as any).user).toContain('Lange Anfrage');
    expect((chatInputs[0] as any).user).toContain('Max Kunde');
  });

  test('postgres AI text transform API port returns transformed compose text with customer placeholders', async () => {
    const now = new Date('2026-06-03T12:27:00.000Z');
    const { db } = makeAiReplySuggestionDb({
      customers: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        name: 'Muster GmbH',
        first_name: 'Max',
        email: 'max@example.com',
      }],
      prompts: [{
        id: 22,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 22,
        label: 'Friendly',
        user_template: 'Formuliere freundlicher fuer {{customer.name}} / {{customer.firstName}}: {{text}}',
        target: 'reply',
        profile_source_sqlite_id: null,
        profile_id: 21,
        sort_order: 1,
        source_row: {},
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      }],
      profiles: [{
        id: 21,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 21,
        label: 'OpenAI',
        provider: 'openai',
        base_url: 'https://api.openai.test/v1',
        model: 'gpt-test',
        embedding_model: null,
        legacy_keytar_account: null,
        secret_id: 'secret-21',
        is_default: true,
        sort_order: 1,
        source_row: {},
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      }],
    });
    const chatInputs: unknown[] = [];
    const port = createPostgresAiTextTransformApiPort({
      db,
      secrets: {
        async readSecret() {
          return Buffer.from('sk-test');
        },
      } as any,
      applyWorkspaceSession: async () => undefined,
      async chatCompletion(input) {
        chatInputs.push(input);
        return 'Sehr gerne helfe ich weiter.';
      },
    });

    await expect(port.transformText({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      promptId: 22,
      text: 'hilf mir',
      customerId: 7,
    })).resolves.toEqual({
      success: true,
      text: 'Sehr gerne helfe ich weiter.',
    });
    expect((chatInputs[0] as any).apiKey).toBe('sk-test');
    expect((chatInputs[0] as any).user).toContain('Muster GmbH');
    expect((chatInputs[0] as any).user).toContain('Max');
    expect((chatInputs[0] as any).user).toContain('hilf mir');
    // Default (no contextText): system prompt is the simple "rewrite the text".
    expect((chatInputs[0] as any).system).not.toContain('markiert');

    // Selection-aware mode: contextText supplied → system prompt instructs to
    // use the full email as context but return ONLY the rewritten selection,
    // and the full email is embedded as context.
    await expect(port.transformText({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      promptId: 22,
      text: 'hilf mir',
      contextText: 'Sehr geehrte Damen und Herren, hilf mir bitte. Mit freundlichen Gruessen',
      customerId: 7,
    })).resolves.toEqual({ success: true, text: 'Sehr gerne helfe ich weiter.' });
    const selectionCall = chatInputs[1] as any;
    expect(selectionCall.system).toContain('markiert');
    expect(selectionCall.system).toContain('AUSSCHLIESSLICH');
    expect(selectionCall.system).toContain('Mit freundlichen Gruessen');
    // The selection itself is still the {{text}} in the user message.
    expect(selectionCall.user).toContain('hilf mir');

    await expect(port.transformText({
      workspaceId: WORKSPACE_A_ID,
      promptId: 99,
      text: 'hilf mir',
    })).resolves.toEqual({ success: false, error: 'Prompt nicht gefunden' });
  });

});
