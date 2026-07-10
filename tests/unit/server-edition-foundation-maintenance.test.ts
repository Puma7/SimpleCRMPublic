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

describe('server edition foundation — maintenance', () => {
  test('maintenance job plans validate workspace payloads and bounded retention windows', () => {
    const now = new Date('2026-06-03T12:00:00.000Z');
    expect(buildLockCleanupPlan({
      workspaceId: ` ${WORKSPACE_A_ID} `,
      staleSeconds: 60,
      limit: 2,
    }, now)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      staleBefore: new Date('2026-06-03T11:59:00.000Z'),
      limit: 2,
    });
    expect(buildAuditRetentionPlan({
      workspaceId: WORKSPACE_A_ID,
      retentionDays: 30,
      limit: 1,
    }, now)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      olderThan: new Date('2026-05-04T12:00:00.000Z'),
      limit: 1,
    });
    expect(() => buildLockCleanupPlan({ workspaceId: '' }, now)).toThrow('workspaceId');
    expect(() => buildAuditRetentionPlan({
      workspaceId: WORKSPACE_A_ID,
      retentionDays: 0,
    }, now)).toThrow('retentionDays');
  });

  test('spam scoring job plan and handler evaluate one message through the mail port', async () => {
    expect(buildSpamScoringPlan({
      workspaceId: ` ${WORKSPACE_A_ID} `,
      messageId: 11,
      applyStatus: true,
      actorUserId: ` ${USER_A_ID} `,
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      applyStatus: true,
      runSecurityCheck: false,
      enqueueInboundWorkflows: false,
      actorUserId: USER_A_ID,
    });
    expect(buildSpamScoringPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      applyStatus: false,
      runSecurityCheck: false,
      enqueueInboundWorkflows: false,
    });
    expect(() => buildSpamScoringPlan({
      workspaceId: WORKSPACE_B_ID,
      messageId: 11,
    }, WORKSPACE_A_ID)).toThrow('workspaceId must match');
    expect(() => buildSpamScoringPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 0,
    }, WORKSPACE_A_ID)).toThrow('messageId');

    const calls: unknown[] = [];
    const handlers = createSpamScoringJobHandlers({
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async evaluateSpamDecision(input) {
          calls.push(input);
          if (input.messageId !== 11) return null;
          return {
            message: makeEmailMessageRecord(input.messageId),
            decision: makeSpamDecisionRecord(77),
          };
        },
      },
    });

    await handlers['mail.spam.score']?.(makeQueuedJob({
      id: 45,
      type: 'mail.spam.score',
      payload: {
        workspaceId: 'workspace-a',
        messageId: 11,
        applyStatus: true,
        runSecurityCheck: true,
      },
    }));
    await expect(handlers['mail.spam.score']?.(makeQueuedJob({
      id: 46,
      type: 'mail.spam.score',
      payload: {
        workspaceId: 'workspace-a',
        messageId: 12,
      },
    }))).rejects.toThrow('email message not found');

    expect(calls).toEqual([
      {
        workspaceId: 'workspace-a',
        messageId: 11,
        values: { applyStatus: true },
      },
      {
        workspaceId: 'workspace-a',
        messageId: 12,
        values: { applyStatus: false },
      },
    ]);
  });

  test('spam scoring job uses full mail security check when requested', async () => {
    expect(buildSpamScoringPlan({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      applyStatus: true,
      runSecurityCheck: true,
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      applyStatus: true,
      runSecurityCheck: true,
      enqueueInboundWorkflows: false,
    });

    const calls: unknown[] = [];
    const handlers = createSpamScoringJobHandlers({
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async evaluateSpamDecision() {
          throw new Error('plain spam scoring should not run');
        },
        async runSecurityCheck(input) {
          calls.push(input);
          return {
            message: makeEmailMessageRecord(input.messageId),
            security: {
              authSpf: 'pass',
              authDkim: null,
              authDmarc: 'pass',
              authArc: null,
              authDkimDomains: null,
              authError: null,
              rspamdScore: null,
              rspamdAction: null,
              rspamdSymbols: null,
              rspamdError: null,
              securityCheckedAt: '2026-07-04T09:00:00.000Z',
              spamStatus: 'clean',
              spamScore: 77,
              spamScoreLabel: 'clean',
              spamDecisionSource: 'local',
              spamScoreBreakdownJson: null,
              spamDecidedAt: '2026-07-04T09:00:00.000Z',
            },
            decision: makeSpamDecisionRecord(77),
            authChecked: true,
            rspamdChecked: true,
          };
        },
      },
    });

    await handlers['mail.spam.score']?.(makeQueuedJob({
      id: 47,
      type: 'mail.spam.score',
      workspaceId: WORKSPACE_A_ID,
      payload: {
        workspaceId: WORKSPACE_A_ID,
        messageId: 11,
        applyStatus: true,
        runSecurityCheck: true,
      },
    }));

    expect(calls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      messageId: 11,
      values: { applyStatus: true },
    }]);
  });

  test('webhook fire job validates payloads, allowlist DNS, and dispatches HTTP requests', async () => {
    expect(buildWebhookFirePlan({
      workspaceId: ` ${WORKSPACE_A_ID} `,
      url: ' https://hooks.example.com/simplecrm ',
      headers: { Authorization: 'Bearer token' },
      body: { event: 'created' },
      timeoutMs: 5000,
    }, WORKSPACE_A_ID)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      url: 'https://hooks.example.com/simplecrm',
      method: 'POST',
      headers: { Authorization: 'Bearer token' },
      body: '{"event":"created"}',
      timeoutMs: 5000,
    });
    expect(() => buildWebhookFirePlan({
      workspaceId: WORKSPACE_A_ID,
      url: 'https://hooks.example.com/simplecrm',
      method: 'PUT',
    }, WORKSPACE_A_ID)).toThrow('method must be GET or POST');
    expect(() => buildWebhookFirePlan({
      workspaceId: WORKSPACE_B_ID,
      url: 'https://hooks.example.com/simplecrm',
    }, WORKSPACE_A_ID)).toThrow('workspaceId must match');
    expect(() => buildWebhookFirePlan({
      workspaceId: WORKSPACE_A_ID,
      url: 'https://hooks.example.com/simplecrm',
      method: 'GET',
      body: 'not allowed',
    }, WORKSPACE_A_ID)).toThrow('body is not allowed');

    const lookupHosts: string[] = [];
    const fetchCalls: Array<{
      url: string;
      method: string;
      headers: Record<string, string>;
      body?: string;
    }> = [];
    const dispatcher = createFetchWebhookDispatchPort({
      allowlist: 'hooks.example.com',
      lookup: async (hostname) => {
        lookupHosts.push(hostname);
        return [{ address: '8.8.8.8' }];
      },
      fetch: async (url, init) => {
        fetchCalls.push({
          url,
          method: init.method,
          headers: init.headers,
          ...(init.body !== undefined ? { body: init.body } : {}),
        });
        return {
          ok: true,
          status: 202,
          text: async () => 'accepted',
        };
      },
    });
    const handlers = createWebhookJobHandlers({ dispatcher });

    await handlers['webhook.fire']?.(makeQueuedJob({
      id: 47,
      type: 'webhook.fire',
      payload: {
        workspaceId: 'workspace-a',
        url: 'https://hooks.example.com/simplecrm',
        headers: { Authorization: 'Bearer token' },
        body: { event: 'created' },
      },
    }));

    await expect(createWebhookJobHandlers({})['webhook.fire']?.(makeQueuedJob({
      id: 48,
      type: 'webhook.fire',
      payload: {
        workspaceId: 'workspace-a',
        url: 'https://hooks.example.com/simplecrm',
      },
    }))).rejects.toThrow('webhook dispatch is not configured');
    await expect(assertWebhookUrlAllowed(
      'https://localhost/simplecrm',
      'localhost',
      async () => [{ address: '8.8.8.8' }],
    )).rejects.toThrow('blocked host');
    await expect(assertWebhookUrlAllowed(
      'https://hooks.example.com/simplecrm',
      'hooks.example.com',
      async () => [{ address: '127.0.0.1' }],
    )).rejects.toThrow('DNS lookup resolved to a blocked address');
    await expect(assertWebhookUrlAllowed(
      'https://other.example.com/simplecrm',
      'hooks.example.com',
      async () => [{ address: '8.8.8.8' }],
    )).rejects.toThrow('host is not in the allowlist');

    expect(lookupHosts).toEqual(['hooks.example.com']);
    expect(fetchCalls).toEqual([{
      url: 'https://hooks.example.com/simplecrm',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: 'Bearer token',
      },
      body: '{"event":"created"}',
    }]);
  });

  test('maintenance job handlers delete stale locks and old audit events in workspace batches', async () => {
    const auditRows = makeAuditChainRows([
      { id: 7, createdAt: '2026-05-01T12:00:00.000Z' },
      { id: 8, createdAt: '2026-05-02T12:00:00.000Z' },
      { id: 9, createdAt: '2026-05-03T12:00:00.000Z' },
    ]);
    const { db, calls } = makeMaintenanceDb({
      conversation_locks: [{ message_id: 41 }, { message_id: 42 }],
      audit_events: auditRows,
    });
    const sessionCommands: unknown[] = [];
    const archivedBatches: Array<{
      workspaceId: string;
      olderThan: Date;
      ids: number[];
    }> = [];
    const handlers = createMaintenanceJobHandlers({
      db,
      now: () => new Date('2026-06-03T12:00:00.000Z'),
      auditArchive: {
        async archive(input) {
          archivedBatches.push({
            workspaceId: input.workspaceId,
            olderThan: input.olderThan,
            ids: input.rows.map((row) => row.id),
          });
        },
      },
      applyWorkspaceSession: async (_trx, command) => {
        sessionCommands.push(command);
      },
    });

    await handlers['lock.cleanup']?.(makeQueuedJob({
      id: 41,
      type: 'lock.cleanup',
      payload: {
        workspaceId: WORKSPACE_A_ID,
        staleSeconds: 120,
        limit: 2,
      },
    }));
    await handlers['audit.retention']?.(makeQueuedJob({
      id: 42,
      type: 'audit.retention',
      payload: {
        workspaceId: WORKSPACE_A_ID,
        retentionDays: 30,
        limit: 2,
      },
    }));

    expect(sessionCommands).toEqual([
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_A_ID, role: 'system' }),
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_A_ID, role: 'system' }),
    ]);
    expect(calls).toEqual([
      {
        kind: 'select',
        table: 'conversation_locks',
        selected: 'message_id',
        wheres: [
          ['workspace_id', '=', WORKSPACE_A_ID],
          ['last_heartbeat_at', '<', new Date('2026-06-03T11:58:00.000Z')],
        ],
        orderBy: ['last_heartbeat_at', 'asc'],
        limit: 2,
      },
      {
        kind: 'delete',
        table: 'conversation_locks',
        wheres: [
          ['workspace_id', '=', WORKSPACE_A_ID],
          ['message_id', 'in', [41, 42]],
        ],
      },
      {
        kind: 'select',
        table: 'audit_events',
        selected: [
          'id',
          'workspace_id',
          'actor_user_id',
          'action',
          'entity_type',
          'entity_id',
          'metadata',
          'previous_hash',
          'event_hash',
          'created_at',
        ],
        wheres: [
          ['workspace_id', '=', WORKSPACE_A_ID],
        ],
        orderBy: ['id', 'asc'],
        limit: 3,
      },
      {
        kind: 'delete',
        table: 'audit_events',
        wheres: [
          ['workspace_id', '=', WORKSPACE_A_ID],
          ['id', 'in', [7, 8]],
        ],
      },
    ]);
    expect(archivedBatches).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      olderThan: new Date('2026-05-04T12:00:00.000Z'),
      ids: [7, 8],
    }]);
  });

  test('audit retention preserves a boundary event before retained chain segments', () => {
    expect(auditRetentionDeletionIds([
      { id: 1, created_at: '2026-05-01T00:00:00.000Z' },
      { id: 2, created_at: '2026-05-02T00:00:00.000Z' },
      { id: 3, created_at: '2026-06-01T00:00:00.000Z' },
    ], new Date('2026-05-04T00:00:00.000Z'))).toEqual([1]);
    expect(auditRetentionDeletionIds([
      { id: 1, created_at: '2026-06-01T00:00:00.000Z' },
      { id: 2, created_at: '2026-05-01T00:00:00.000Z' },
    ], new Date('2026-05-04T00:00:00.000Z'))).toEqual([]);
    expect(auditRetentionDeletionIds([
      { id: 1, created_at: '2026-05-01T00:00:00.000Z' },
    ], new Date('2026-05-04T00:00:00.000Z'))).toEqual([]);
  });

  test('audit retention archive selection contains only rows that will be deleted', () => {
    const rows = makeAuditChainRows([
      { id: 7, createdAt: '2026-05-01T12:00:00.000Z' },
      { id: 8, createdAt: '2026-05-02T12:00:00.000Z' },
      { id: 9, createdAt: '2026-05-03T12:00:00.000Z' },
    ]);

    expect(auditRetentionRowsByIds(rows, [7, 9]).map((row) => row.id)).toEqual([7, 9]);
    expect(auditRetentionRowsByIds(rows, [99]).map((row) => row.id)).toEqual([]);
  });

  test('jsonl audit retention archive port writes deterministic workspace-scoped exports', async () => {
    const mkdirCalls: unknown[] = [];
    const writes: Array<{ path: string; data: string }> = [];
    const auditArchiveRoot = 'C:\\audit-archive';
    const expectedWorkspaceDir = join(resolve(auditArchiveRoot), WORKSPACE_A_ID);
    const expectedArchivePath = join(
      expectedWorkspaceDir,
      'audit-retention_2026-05-04T12_00_00.000Z_ids-7-8_count-2.jsonl',
    );
    const port = createJsonlAuditRetentionArchivePort({
      rootDir: auditArchiveRoot,
      mkdir: async (path, options) => {
        mkdirCalls.push({ path, options });
      },
      writeFile: async (path, data) => {
        writes.push({ path, data });
      },
    });

    await port.archive({
      workspaceId: WORKSPACE_A_ID,
      olderThan: new Date('2026-05-04T12:00:00.000Z'),
      rows: makeAuditChainRows([
        { id: 7, createdAt: '2026-05-01T12:00:00.000Z' },
        { id: 8, createdAt: '2026-05-02T12:00:00.000Z' },
      ]),
    });

    expect(archiveFileName({
      olderThan: new Date('2026-05-04T12:00:00.000Z'),
      firstId: 7,
      lastId: 8,
      count: 2,
    })).toBe('audit-retention_2026-05-04T12_00_00.000Z_ids-7-8_count-2.jsonl');
    expect(mkdirCalls).toEqual([{
      path: expectedWorkspaceDir,
      options: { recursive: true },
    }]);
    expect(writes).toHaveLength(1);
    expect(writes[0].path).toBe(expectedArchivePath);
    const lines = writes[0].data.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => line.id)).toEqual([7, 8]);
    expect(lines[0]).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      action: 'audit.retention.probe',
      entityType: 'email_message',
      entityId: '7',
      createdAt: '2026-05-01T12:00:00.000Z',
    });
  });

  test('audit retention refuses deletion when the selected hash chain is invalid', async () => {
    const auditRows = makeAuditChainRows([
      { id: 7, createdAt: '2026-05-01T12:00:00.000Z' },
      { id: 8, createdAt: '2026-05-02T12:00:00.000Z' },
    ]).map((row) => (
      row.id === 8 ? { ...row, previous_hash: 'broken-link' } : row
    ));
    const { db, calls } = makeMaintenanceDb({ audit_events: auditRows });
    const handlers = createMaintenanceJobHandlers({
      db,
      now: () => new Date('2026-06-03T12:00:00.000Z'),
      applyWorkspaceSession: async () => undefined,
    });

    await expect(handlers['audit.retention']?.(makeQueuedJob({
      id: 42,
      type: 'audit.retention',
      payload: {
        workspaceId: WORKSPACE_A_ID,
        retentionDays: 30,
        limit: 1,
      },
    }))).rejects.toThrow('unverifiable hash chain');

    expect(calls.some((call) => call.kind === 'delete')).toBe(false);
  });

  test('maintenance handler registry can be overridden by production job handlers', async () => {
    const fallback = jest.fn(async () => undefined);
    const override = jest.fn(async () => undefined);
    const registry = mergeJobHandlerRegistries(
      { 'lock.cleanup': fallback },
      { 'lock.cleanup': override },
    );

    await registry['lock.cleanup']?.(makeQueuedJob({
      id: 9,
      type: 'lock.cleanup',
      payload: { workspaceId: WORKSPACE_A_ID },
    }));

    expect(fallback).not.toHaveBeenCalled();
    expect(override).toHaveBeenCalledTimes(1);
  });

  test('sqlite migration manifest follows real Electron table names and dependency order', () => {
    const names = sqliteServerEditionMigrationPlan.tables.map((table) => table.name);
    expect(names.slice(0, 7)).toEqual([
      'sync_info',
      'customers',
      'products',
      'deals',
      'tasks',
      'deal_products',
      'calendar_events',
    ]);
    expect(names).toContain('email_accounts');
    expect(names).toContain('email_messages');
    expect(names).toContain('email_workflows');
    expect(names).toContain('workflow_knowledge_chunks');
    expect(names).toContain('automation_api_keys');

    const customers = sqliteServerEditionMigrationPlan.tables.find((table) => table.name === 'customers');
    const deals = sqliteServerEditionMigrationPlan.tables.find((table) => table.name === 'deals');
    const emailAccounts = sqliteServerEditionMigrationPlan.tables.find((table) => table.name === 'email_accounts');
    const emailThreads = sqliteServerEditionMigrationPlan.tables.find((table) => table.name === 'email_threads');
    const emailMessageCategories = sqliteServerEditionMigrationPlan.tables
      .find((table) => table.name === 'email_message_categories');
    const emailAccountSignatures = sqliteServerEditionMigrationPlan.tables
      .find((table) => table.name === 'email_account_signatures');
    const emailAiProfiles = sqliteServerEditionMigrationPlan.tables
      .find((table) => table.name === 'email_ai_profiles');
    const emailAiPrompts = sqliteServerEditionMigrationPlan.tables
      .find((table) => table.name === 'email_ai_prompts');
    expect(customers?.required).toBe(true);
    expect(deals?.dependsOn).toEqual(['customers']);
    expect(emailAccounts?.required).toBe(false);
    expect(emailThreads?.primaryKey).toBe('id');
    expect(emailMessageCategories?.primaryKey).toBe('rowid');
    expect(emailAccountSignatures?.primaryKey).toBe('account_id');
    expect(emailAiProfiles?.primaryKey).toBe('id');
    expect(emailAiPrompts?.dependsOn).toEqual(['email_ai_profiles']);
    expect(names.indexOf('customers')).toBeLessThan(names.indexOf('deals'));
    expect(names.indexOf('products')).toBeLessThan(names.indexOf('deal_products'));
    expect(names.indexOf('email_ai_profiles')).toBeLessThan(names.indexOf('email_ai_prompts'));
  });

  test('sqlite migration row hashes are deterministic and source-primary-key ordered', () => {
    const left = { id: 2, name: 'Bob', flags: { active: true, tags: ['b', 'a'] } };
    const reordered = { flags: { tags: ['b', 'a'], active: true }, name: 'Bob', id: 2 };
    const right = { id: 10, name: 'Zoe' };
    const leftHash = hashSqliteMigrationRow(left);

    expect(leftHash).toMatch(/^[a-f0-9]{64}$/);
    expect(hashSqliteMigrationRow(reordered)).toBe(leftHash);
    expect(hashSqliteMigrationRowSet([
      { sourcePk: '10', rowHash: hashSqliteMigrationRow(right) },
      { sourcePk: '2', rowHash: leftHash },
    ])).toBe(hashSqliteMigrationRowSet([
      { sourcePk: '2', rowHash: leftHash },
      { sourcePk: '10', rowHash: hashSqliteMigrationRow(right) },
    ]));
  });

  test('sqlite migration engine dry-runs without writing rows', async () => {
    const source = makeSqliteSource({
      customers: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });
    const target = makeSqliteImportTarget();

    const result = await runSqliteToPostgresMigration({
      source,
      target,
      plan: makeSqlitePlan(['customers']),
      workspaceId: 'workspace-a',
      sourceFingerprint: 'sqlite-sha-1',
      dryRun: true,
    });

    expect(result.status).toBe('dry_run');
    expect(result.tables).toEqual([{
      tableName: 'customers',
      status: 'dry_run',
      sourceRowCount: 2,
      copiedRowCount: 0,
      lastSourcePrimaryKey: null,
    }]);
    expect(target.upserts).toEqual([]);
    expect(target.checkpoints.get('customers')?.status).toBe('dry_run');
    expect(target.completedRuns[0].status).toBe('dry_run');
  });

  test('sqlite migration engine resumes from table checkpoints and records batch progress', async () => {
    const source = makeSqliteSource({
      customers: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Chris' },
      ],
    });
    const target = makeSqliteImportTarget({
      checkpoints: [{
        runId: 'run-1',
        tableName: 'customers',
        status: 'running',
        sourceRowCount: 3,
        copiedRowCount: 1,
        lastSourcePrimaryKey: '1',
      }],
    });
    const copiedEvents: string[] = [];

    const result = await runSqliteToPostgresMigration({
      source,
      target,
      plan: makeSqlitePlan(['customers']),
      workspaceId: 'workspace-a',
      sourceFingerprint: 'sqlite-sha-1',
      batchSize: 1,
      reporter: {
        onBatchCopied(event) {
          copiedEvents.push(`${event.tableName}:${event.copiedRowCount}:${event.lastSourcePrimaryKey}`);
        },
      },
    });

    expect(result.status).toBe('succeeded');
    expect(result.tables[0]).toEqual({
      tableName: 'customers',
      status: 'succeeded',
      sourceRowCount: 3,
      copiedRowCount: 3,
      lastSourcePrimaryKey: '3',
    });
    expect(source.reads[0]).toMatchObject({ tableName: 'customers', afterPrimaryKey: '1', limit: 1 });
    expect(target.upserts.map((upsert) => upsert.rows.map((row) => row.id))).toEqual([[2], [3]]);
    expect(target.checkpoints.get('customers')?.lastSourcePrimaryKey).toBe('3');
    expect(copiedEvents).toEqual(['customers:2:2', 'customers:3:3']);
  });

  test('sqlite migration engine validates staged row counts and table hashes when target supports it', async () => {
    const source = makeSqliteSource({
      customers: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });
    const target = makeSqliteImportTarget({ validateStagedTables: true });

    const result = await runSqliteToPostgresMigration({
      source,
      target,
      plan: makeSqlitePlan(['customers']),
      workspaceId: 'workspace-a',
      sourceFingerprint: 'sqlite-sha-1',
      batchSize: 2,
    });

    expect(result.status).toBe('succeeded');
    expect(result.tables[0].sourceTableHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(result.tables[0].stagedTableHash).toBe(result.tables[0].sourceTableHash);
    expect(target.validations).toEqual([{ tableName: 'customers', ok: true }]);
    expect(target.checkpoints.get('customers')?.status).toBe('succeeded');
  });

  test('sqlite migration engine fails the run when staged validation does not match the source', async () => {
    const source = makeSqliteSource({
      customers: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });
    const target = makeSqliteImportTarget({
      validateStagedTables: true,
      forceValidationMismatch: true,
    });

    await expect(runSqliteToPostgresMigration({
      source,
      target,
      plan: makeSqlitePlan(['customers']),
      workspaceId: 'workspace-a',
      sourceFingerprint: 'sqlite-sha-1',
    })).rejects.toThrow('forced validation mismatch for customers');

    expect(target.validations).toEqual([{ tableName: 'customers', ok: false }]);
    expect(target.checkpoints.get('customers')?.status).toBe('failed');
    expect(target.failedRuns[0].error).toContain('forced validation mismatch');
  });

  test('sqlite migration engine skips optional missing tables and fails required missing tables', async () => {
    const optionalTarget = makeSqliteImportTarget();

    const optionalResult = await runSqliteToPostgresMigration({
      source: makeSqliteSource({ customers: [] }),
      target: optionalTarget,
      plan: makeSqlitePlan(['customers', 'email_accounts']),
      workspaceId: 'workspace-a',
      sourceFingerprint: 'sqlite-sha-1',
    });
    expect(optionalResult.tables.map((table) => [table.tableName, table.status])).toEqual([
      ['customers', 'succeeded'],
      ['email_accounts', 'skipped'],
    ]);
    expect(optionalTarget.checkpoints.get('email_accounts')?.status).toBe('skipped');

    const requiredTarget = makeSqliteImportTarget();
    await expect(runSqliteToPostgresMigration({
      source: makeSqliteSource({}),
      target: requiredTarget,
      plan: makeSqlitePlan(['customers']),
      workspaceId: 'workspace-a',
      sourceFingerprint: 'sqlite-sha-1',
    })).rejects.toThrow('Required SQLite table missing: customers');
    expect(requiredTarget.failedRuns[0].error).toContain('customers');
  });

  test('postgres sqlite import target parameterizes run, checkpoint, and JSONB row upserts', async () => {
    const client = makeSqliteImportPgClient();
    const target = createPostgresSqliteImportTarget(client);

    const begin = await target.beginRun({
      workspaceId: 'workspace-a',
      planId: 'plan-a',
      sourceFingerprint: 'sha-1',
      dryRun: false,
      startedAt: new Date('2026-06-02T12:00:00.000Z'),
      metadata: { source: 'desktop' },
    });
    expect(begin.runId).toBe('run-1');

    const table = makeSqlitePlan(['customers']).tables[0];
    await target.beginTable({
      runId: begin.runId,
      table,
      sourceRowCount: 2,
      status: 'running',
    });
    await target.upsertRows({
      runId: begin.runId,
      workspaceId: 'workspace-a',
      table,
      rows: [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ],
    });
    await target.updateTableCheckpoint({
      runId: begin.runId,
      tableName: 'customers',
      sourceRowCount: 2,
      copiedRowCount: 2,
      lastSourcePrimaryKey: '2',
      status: 'succeeded',
    });
    await target.completeRun({
      runId: begin.runId,
      status: 'succeeded',
      finishedAt: new Date('2026-06-02T12:01:00.000Z'),
    });

    const rowInsertQueries = client.queries.filter((query) => query.sql.includes('INSERT INTO sqlite_import_rows'));
    expect(rowInsertQueries).toHaveLength(2);
    expect(rowInsertQueries[0].params).toEqual([
      'workspace-a',
      'customers',
      '1',
      JSON.stringify({ id: 1, name: 'Alice' }),
      hashSqliteMigrationRow({ id: 1, name: 'Alice' }),
      'run-1',
    ]);
    expect(rowInsertQueries[0].sql).toContain('$4::jsonb');
    expect(rowInsertQueries[0].sql).toContain('source_row_sha256');
    expect(rowInsertQueries[0].sql).not.toContain('Alice');
    expect(client.queries.some((query) => query.sql.includes('ON CONFLICT (run_id, table_name)'))).toBe(true);
    expect(client.queries.some((query) => query.sql.includes('copied_row_count = EXCLUDED.copied_row_count'))).toBe(true);
    expect(client.queries[client.queries.length - 1].sql).toContain('UPDATE sqlite_import_runs');
  });

  test('postgres sqlite import target maps checkpoints and validates source primary keys', async () => {
    const client = makeSqliteImportPgClient({
      checkpoint: {
        run_id: 'run-1',
        table_name: 'customers',
        status: 'running',
        source_row_count: 3,
        copied_row_count: 1,
        last_source_pk: '1',
        error: null,
      },
    });
    const target = createPostgresSqliteImportTarget(client);
    const table = makeSqlitePlan(['customers']).tables[0];

    await expect(target.getTableCheckpoint('run-1', 'customers')).resolves.toEqual({
      runId: 'run-1',
      tableName: 'customers',
      status: 'running',
      sourceRowCount: 3,
      copiedRowCount: 1,
      lastSourcePrimaryKey: '1',
      error: null,
    });
    await target.beginTable({
      runId: 'run-1',
      table,
      sourceRowCount: 3,
      status: 'running',
    });
    const beginTableQuery = client.queries.find((query) => query.sql.includes('DO UPDATE SET')
      && query.sql.includes('source_row_count = EXCLUDED.source_row_count'));
    expect(beginTableQuery?.sql).not.toContain('copied_row_count = EXCLUDED.copied_row_count');

    await expect(target.upsertRows({
      runId: 'run-1',
      workspaceId: 'workspace-a',
      table,
      rows: [{ name: 'Missing id' }],
    })).rejects.toThrow('primary key id');
  });

  test('postgres sqlite import target validates staged row counts and hashes from imported rows', async () => {
    const aliceHash = hashSqliteMigrationRow({ id: 1, name: 'Alice' });
    const bobHash = hashSqliteMigrationRow({ id: 2, name: 'Bob' });
    const expectedTableHash = hashSqliteMigrationRowSet([
      { sourcePk: '1', rowHash: aliceHash },
      { sourcePk: '2', rowHash: bobHash },
    ]);
    const client = makeSqliteImportPgClient({
      stagedRows: [
        { source_pk: '2', source_row_sha256: bobHash },
        { source_pk: '1', source_row_sha256: aliceHash },
      ],
    });
    const target = createPostgresSqliteImportTarget(client);
    const table = makeSqlitePlan(['customers']).tables[0];
    expect(target.validateStagedTable).toBeDefined();

    await expect(target.validateStagedTable!({
      runId: 'run-1',
      workspaceId: 'workspace-a',
      table,
      sourceRowCount: 2,
      sourceTableHash: expectedTableHash,
    })).resolves.toEqual({
      ok: true,
      stagedRowCount: 2,
      sourceRowCount: 2,
      sourceTableHash: expectedTableHash,
      stagedTableHash: expectedTableHash,
    });

    const validationQuery = client.queries.find((query) => query.sql.includes('source_row_sha256')
      && query.sql.includes('imported_in_run_id'));
    expect(validationQuery?.params).toEqual(['workspace-a', 'customers', 'run-1']);
  });

});
