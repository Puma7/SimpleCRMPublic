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

describe('server edition foundation — workflow-routes', () => {
  test('server workflow execute routes enqueue workspace-scoped workflow jobs', async () => {
    const workflow = { ...makeWorkflowRecord(23), sourceSqliteId: -23 };
    const queueCalls: unknown[] = [];
    const dryRunCalls: unknown[] = [];
    const workflowGetCalls: unknown[] = [];
    const workflowListCalls: unknown[] = [];
    const messageGetCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      workflows: {
        async list(input) {
          workflowListCalls.push(input);
          return { items: [workflow], nextCursor: null };
        },
        async get(input) {
          workflowGetCalls.push(input);
          return input.id === 23 ? workflow : null;
        },
      },
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get(input) {
          messageGetCalls.push(input);
          return input.id === 11 ? makeEmailMessageRecord(11) : null;
        },
      },
      jobQueue: {
        async enqueue(input) {
          queueCalls.push(input);
        },
      },
      workflowExecution: {
        async dryRun(input) {
          dryRunCalls.push(input);
          return {
            success: true,
            dryRun: true,
            workflowId: 23,
            messageId: input.messageId,
            status: 'ok',
            blocked: false,
            blockReason: null,
            log: ['dry_run:server', 'dry_run:email.tag'],
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const bySource = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/by-source/-23/execute',
      body: { messageId: '11' },
      principal,
    });
    expect(bySource.status).toBe(200);
    expect((bySource.body as any).data).toEqual({
      success: true,
      dryRun: true,
      workflowId: -23,
      messageId: 11,
      status: 'ok',
      blocked: false,
      blockReason: null,
      log: ['dry_run:server', 'dry_run:email.tag'],
    });

    const byId = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/23/execute',
      body: {},
      principal,
    });
    expect(byId.status).toBe(200);
    expect((byId.body as any).data.dryRun).toBe(true);

    const liveDenied = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/by-source/-23/execute',
      body: { messageId: 11, dryRun: false },
      principal,
    });
    expect(liveDenied.status).toBe(403);

    const adminPrincipal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'owner' as const };
    const liveQueued = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/by-source/-23/execute',
      body: { messageId: 11, dryRun: false },
      principal: adminPrincipal,
    });
    expect(liveQueued.status).toBe(202);
    expect((liveQueued.body as any).data).toEqual({
      success: true,
      queued: true,
      status: 'queued',
      workflowId: -23,
      messageId: 11,
    });

    const missingMessage = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/by-source/-23/execute',
      body: { messageId: 77 },
      principal,
    });
    expect(missingMessage.status).toBe(404);
    expect((missingMessage.body as any).error.code).toBe('email_message_not_found');

    const dryRun = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/by-source/-23/execute',
      body: { messageId: 11, dryRun: true },
      principal,
    });
    expect(dryRun.status).toBe(200);
    expect((dryRun.body as any).data).toEqual({
      success: true,
      dryRun: true,
      workflowId: -23,
      messageId: 11,
      status: 'ok',
      blocked: false,
      blockReason: null,
      log: ['dry_run:server', 'dry_run:email.tag'],
    });

    const invalidPayload = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/by-source/-23/execute',
      body: { messageId: 0, extra: true },
      principal,
    });
    expect(invalidPayload.status).toBe(400);

    const unavailable = await createServerApi(makeServerApiPorts({
      workflows: {
        async list() {
          return { items: [workflow], nextCursor: null };
        },
        async get() {
          return workflow;
        },
      },
    })).handle({
      method: 'POST',
      path: '/api/v1/workflows/by-source/-23/execute',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('workflow_dry_run_unavailable');

    expect(workflowListCalls).toEqual([
      expect.objectContaining({ workspaceId: WORKSPACE_A_ID, limit: 100 }),
      expect.objectContaining({ workspaceId: WORKSPACE_A_ID, limit: 100 }),
      expect.objectContaining({ workspaceId: WORKSPACE_A_ID, limit: 100 }),
      expect.objectContaining({ workspaceId: WORKSPACE_A_ID, limit: 100 }),
      expect.objectContaining({ workspaceId: WORKSPACE_A_ID, limit: 100 }),
      expect.objectContaining({ workspaceId: WORKSPACE_A_ID, limit: 100 }),
    ]);
    expect(workflowGetCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, id: 23 }]);
    expect(messageGetCalls).toEqual([
      { workspaceId: WORKSPACE_A_ID, id: 11, includeBody: false },
      { workspaceId: WORKSPACE_A_ID, id: 11, includeBody: false },
      { workspaceId: WORKSPACE_A_ID, id: 11, includeBody: false },
      { workspaceId: WORKSPACE_A_ID, id: 77, includeBody: false },
      { workspaceId: WORKSPACE_A_ID, id: 11, includeBody: false },
    ]);
    expect(dryRunCalls).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        workflowId: 23,
        messageId: 11,
        triggerName: 'manual',
        actorUserId: USER_A_ID,
        context: {},
      },
      {
        workspaceId: WORKSPACE_A_ID,
        workflowId: 23,
        triggerName: 'manual',
        actorUserId: USER_A_ID,
        context: {},
      },
      {
        workspaceId: WORKSPACE_A_ID,
        workflowId: 23,
        messageId: 11,
        triggerName: 'manual',
        actorUserId: USER_A_ID,
        context: {},
      },
    ]);
    expect(queueCalls).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        type: 'workflow.execute',
        payload: {
          workspaceId: WORKSPACE_A_ID,
          workflowId: 23,
          messageId: 11,
          triggerName: 'manual',
          actorUserId: USER_A_ID,
          context: {},
        },
      },
    ]);
  });

  test('server workflow inbound backfill route delegates to workspace-scoped backfill port', async () => {
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      workflowInboundBackfill: {
        async backfill(input) {
          calls.push(input);
          return {
            success: true,
            messages: 3,
            workflows: 2,
            queued: 6,
            clearedApplied: 4,
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const queued = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/inbound/backfill',
      body: { limit: '25', clearApplied: false },
      principal,
    });
    expect(queued.status).toBe(202);
    expect((queued.body as any).data).toEqual({
      success: true,
      messages: 3,
      workflows: 2,
      queued: 6,
      clearedApplied: 4,
    });
    expect(calls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      limit: 25,
      clearApplied: false,
    }]);

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/inbound/backfill',
      body: { limit: 0, extra: true },
      principal,
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'limit', message: 'limit muss eine positive Ganzzahl sein' },
      { field: 'extra', message: 'Feld ist nicht erlaubt' },
    ]));

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'POST',
      path: '/api/v1/workflows/inbound/backfill',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('workflow_backfill_unavailable');
  });

  test('server incoming webhook workflow route validates secret, deduplicates, and enqueues workflow jobs', async () => {
    const bodyJson = JSON.stringify({ orderId: 7, source: 'unit' });
    const activeWebhookA = { ...makeWorkflowRecord(31), triggerName: 'webhook.incoming' };
    const activeWebhookB = { ...makeWorkflowRecord(32), triggerName: 'webhook.incoming' };
    const disabledWebhook = { ...makeWorkflowRecord(33), triggerName: 'webhook.incoming', enabled: false };
    const wrongTrigger = { ...makeWorkflowRecord(34), triggerName: 'mail.received' };
    const syncStore = new Map<string, string | null>([
      ['email_webhook_secret', 'secret-1'],
    ]);
    const syncGetCalls: unknown[] = [];
    const syncSetCalls: unknown[] = [];
    const workflowListCalls: unknown[] = [];
    const queueCalls: unknown[] = [];
    const operationLog: string[] = [];
    const api = createServerApi(makeServerApiPorts({
      syncInfo: {
        async getMany(input) {
          syncGetCalls.push(input);
          return input.keys
            .filter((key) => syncStore.has(key))
            .map((key) => ({
              key,
              value: syncStore.get(key) ?? null,
              updatedAt: '2026-06-04T10:00:00.000Z',
            }));
        },
        async getByPrefix() {
          return [];
        },
        async setMany(input) {
          operationLog.push('dedupe');
          syncSetCalls.push(input);
          for (const [key, value] of Object.entries(input.values)) {
            syncStore.set(key, value);
          }
          return Object.entries(input.values).map(([key, value]) => ({
            key,
            value,
            updatedAt: '2026-06-04T10:01:00.000Z',
          }));
        },
        async deleteMany(input) {
          let deleted = 0;
          for (const key of input.keys) {
            if (syncStore.delete(key)) deleted += 1;
          }
          return deleted;
        },
      },
      workflows: {
        async list(input) {
          workflowListCalls.push(input);
          return {
            items: [activeWebhookA, disabledWebhook, wrongTrigger, activeWebhookB],
            nextCursor: null,
          };
        },
        async get() {
          return null;
        },
      },
      jobQueue: {
        async enqueue(input) {
          operationLog.push(`enqueue:${(input.payload as { workflowId?: unknown }).workflowId}`);
          queueCalls.push(input);
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const fired = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/webhook/incoming',
      body: { secret: 'secret-1', body: { orderId: 7, source: 'unit' } },
      principal,
    });
    expect(fired.status).toBe(202);
    expect((fired.body as any).data).toEqual({ success: true, queued: true, fired: 2 });
    expect(workflowListCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      triggerName: 'webhook.incoming',
      enabled: true,
      limit: 100,
    }]);
    expect(syncGetCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      keys: ['email_webhook_secret', expect.stringMatching(/^webhook_dedup:/)],
    });
    expect(syncSetCalls).toHaveLength(1);
    expect(syncSetCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      values: expect.any(Object),
    });
    const dedupeValues = (syncSetCalls[0] as any).values as Record<string, string>;
    const dedupeKeys = Object.keys(dedupeValues);
    expect(dedupeKeys).toHaveLength(1);
    expect(dedupeKeys[0]).toMatch(/^webhook_dedup:/);
    expect(dedupeValues[dedupeKeys[0]]).toEqual(expect.any(String));
    expect(queueCalls).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        type: 'workflow.execute',
        payload: {
          workspaceId: WORKSPACE_A_ID,
          workflowId: 31,
          triggerName: 'webhook.incoming',
          actorUserId: USER_A_ID,
          context: expect.objectContaining({
            webhook_body: bodyJson,
            eventStrings: expect.objectContaining({
              subject: 'Webhook',
              snippet: bodyJson,
              combined_text: bodyJson,
            }),
            eventVariables: { webhook_body: bodyJson },
          }),
        },
      },
      {
        workspaceId: WORKSPACE_A_ID,
        type: 'workflow.execute',
        payload: {
          workspaceId: WORKSPACE_A_ID,
          workflowId: 32,
          triggerName: 'webhook.incoming',
          actorUserId: USER_A_ID,
          context: expect.objectContaining({
            webhook_body: bodyJson,
            eventVariables: { webhook_body: bodyJson },
          }),
        },
      },
    ]);
    expect(operationLog).toEqual(['enqueue:31', 'enqueue:32', 'dedupe']);

    const deduped = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/webhook/incoming',
      body: { secret: 'secret-1', body: { orderId: 7, source: 'unit' } },
      principal,
    });
    expect(deduped.status).toBe(200);
    expect((deduped.body as any).data).toEqual({ success: true, fired: 0, deduplicated: true });
    expect(workflowListCalls).toHaveLength(1);
    expect(queueCalls).toHaveLength(2);

    const wrongSecret = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/webhook/incoming',
      body: { secret: 'nope', body: { orderId: 8 } },
      principal,
    });
    expect(wrongSecret.status).toBe(200);
    expect((wrongSecret.body as any).data).toEqual({
      success: false,
      error: 'Ungueltiges Webhook-Secret',
      fired: 0,
    });
    expect(workflowListCalls).toHaveLength(1);
    expect(queueCalls).toHaveLength(2);

    const automationPrincipal = {
      userId: USER_A_ID,
      workspaceId: WORKSPACE_A_ID,
      role: 'user' as const,
      automationApiKeyId: '55555555-5555-4555-8555-555555555555',
      automationScopes: ['workflows'],
    };
    const automationTriggered = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/webhook/incoming',
      body: { body: { orderId: 9, source: 'api-key' } },
      principal: automationPrincipal,
    });
    expect(automationTriggered.status).toBe(202);
    expect((automationTriggered.body as any).data).toEqual({ success: true, queued: true, fired: 2 });
    expect(syncGetCalls.at(-1)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      keys: [expect.stringMatching(/^webhook_dedup:/)],
    });
    expect(workflowListCalls).toHaveLength(2);
    expect(queueCalls).toHaveLength(4);
    expect((queueCalls[2] as any).payload.actorUserId).toBe(USER_A_ID);

    const scopedOut = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/webhook/incoming',
      body: { body: { orderId: 10, source: 'api-key' } },
      principal: {
        ...automationPrincipal,
        automationScopes: ['email'],
      },
    });
    expect(scopedOut.status).toBe(403);
    expect((scopedOut.body as any).error.code).toBe('automation_scope_required');
    expect(workflowListCalls).toHaveLength(2);
    expect(queueCalls).toHaveLength(4);

    const aliasTriggered = await api.handle({
      method: 'POST',
      path: '/api/v1/webhooks/incoming',
      body: { secret: 'secret-1', body: { orderId: 11, source: 'alias' } },
      principal,
    });
    expect(aliasTriggered.status).toBe(202);
    expect((aliasTriggered.body as any).data).toEqual({ success: true, queued: true, fired: 2 });
    expect(workflowListCalls).toHaveLength(3);
    expect(queueCalls).toHaveLength(6);

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/webhook/incoming',
      body: { secret: 'secret-1', body: ['not-object'], extra: true },
      principal,
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'extra', message: 'Feld ist nicht erlaubt' },
      { field: 'body', message: 'body muss ein JSON-Objekt sein' },
    ]));
  });

  test('server incoming webhook workflow route does not dedupe when queue enqueue fails', async () => {
    const activeWebhook = { ...makeWorkflowRecord(41), triggerName: 'webhook.incoming' };
    const syncStore = new Map<string, string | null>([
      ['email_webhook_secret', 'secret-1'],
    ]);
    const syncSetCalls: unknown[] = [];
    const queueCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      syncInfo: {
        async getMany(input) {
          return input.keys
            .filter((key) => syncStore.has(key))
            .map((key) => ({
              key,
              value: syncStore.get(key) ?? null,
              updatedAt: '2026-06-04T10:00:00.000Z',
            }));
        },
        async getByPrefix() {
          return [];
        },
        async setMany(input) {
          syncSetCalls.push(input);
          for (const [key, value] of Object.entries(input.values)) {
            syncStore.set(key, value);
          }
          return Object.entries(input.values).map(([key, value]) => ({
            key,
            value,
            updatedAt: '2026-06-04T10:01:00.000Z',
          }));
        },
        async deleteMany() {
          return 0;
        },
      },
      workflows: {
        async list() {
          return {
            items: [activeWebhook],
            nextCursor: null,
          };
        },
        async get() {
          return null;
        },
      },
      jobQueue: {
        async enqueue(input) {
          queueCalls.push(input);
          throw new Error('queue unavailable');
        },
      },
    }));

    await expect(api.handle({
      method: 'POST',
      path: '/api/v1/workflows/webhook/incoming',
      body: { secret: 'secret-1', body: { orderId: 12, source: 'queue-fail' } },
      principal: { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' },
    })).rejects.toThrow('queue unavailable');

    expect(queueCalls).toHaveLength(1);
    expect(syncSetCalls).toHaveLength(0);
    expect([...syncStore.keys()].some((key) => key.startsWith('webhook_dedup:'))).toBe(false);
  });

  test('server workflow mutation routes reject unsafe payloads and invalid references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      workflows: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      workflows: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.scheduleAccountId === 99) return { ok: false, code: 'schedule_account_not_found' };
          return { ok: true, workflow: makeWorkflowRecord(23) };
        },
        async update(input) {
          if (input.values.scheduleAccountId === 99) return { ok: false, code: 'schedule_account_not_found' };
          return null;
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/workflows',
      body: { name: 'Flow', triggerName: 'mail.received', definition: { nodes: [] } },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflows',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_workflow_payload');

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflows',
      body: {
        workspaceId: WORKSPACE_B_ID,
        name: 123,
        triggerName: ' ',
        enabled: 'yes',
        priority: -1,
        definition: 'not-json-object',
        graph: { bad: undefined },
        scheduleAccountId: 0,
        executionMode: ' ',
        engineVersion: 0,
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'name', message: 'name muss ein String sein' },
      { field: 'triggerName', message: 'triggerName darf nicht leer sein' },
      { field: 'enabled', message: 'enabled muss ein Boolean sein' },
      { field: 'priority', message: 'priority muss eine nichtnegative Ganzzahl sein' },
      { field: 'definition', message: 'definition muss ein JSON-Objekt oder Array sein' },
      { field: 'graph', message: 'graph muss ein JSON-Objekt oder Array sein' },
      { field: 'scheduleAccountId', message: 'scheduleAccountId muss eine positive Ganzzahl sein' },
      { field: 'executionMode', message: 'executionMode darf nicht leer sein' },
      { field: 'engineVersion', message: 'engineVersion muss eine positive Ganzzahl sein' },
    ]));

    const missingRequired = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflows',
      body: { name: 'Flow' },
      principal,
    });
    expect(missingRequired.status).toBe(400);

    const missingAccount = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflows',
      body: {
        name: 'Flow',
        triggerName: 'mail.received',
        definition: { nodes: [] },
        scheduleAccountId: 99,
      },
      principal,
    });
    expect(missingAccount.status).toBe(404);
    expect((missingAccount.body as any).error.code).toBe('email_account_not_found');

    const invalidId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/0',
      body: { enabled: true },
      principal,
    });
    expect(invalidId.status).toBe(400);

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/23',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const missingPatchAccount = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/23',
      body: { scheduleAccountId: 99 },
      principal,
    });
    expect(missingPatchAccount.status).toBe(404);

    const missingWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/workflows/23', body: { enabled: true }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/workflows/23', principal }),
    ]);
    expect(missingWrites.map((response) => response.status)).toEqual([404, 404]);
  });

  test('server workflow version mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      workflowVersions: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          return {
            ok: true,
            version: {
              ...makeWorkflowVersionRecord(82),
              sourceSqliteId: -82,
              workflowId: input.values.workflowId ?? 23,
              workflowSourceSqliteId: 23,
              label: input.values.label ?? 'Initial graph',
              graph: input.values.graph ?? { nodes: [] },
              definition: input.values.definition ?? { steps: [] },
            },
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 82
            ? {
              ok: true,
              version: {
                ...makeWorkflowVersionRecord(82),
                sourceSqliteId: -82,
                label: input.values.label ?? 'Workflow version 82',
                graph: input.values.graph ?? { nodes: [] },
              },
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 82 ? { ...makeWorkflowVersionRecord(82), sourceSqliteId: -82 } : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/23/versions',
      body: {
        label: ' Initial graph ',
        graph: { nodes: [{ id: 'start' }], edges: [] },
        definition: { steps: [{ id: 'start' }] },
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        workflowId: 23,
        label: 'Initial graph',
        graph: { nodes: [{ id: 'start' }], edges: [] },
        definition: { steps: [{ id: 'start' }] },
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-versions/82',
      body: { label: 'Published graph', graph: { nodes: [] } },
      principal,
    });
    expect(updated.status).toBe(200);
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 82,
      values: { label: 'Published graph', graph: { nodes: [] } },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/workflow-versions/82',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 82 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'workflow_version.created',
      'workflow_version.updated',
      'workflow_version.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['workflow_version.created', WORKSPACE_A_ID, 'workflow_version', '82'],
      ['workflow_version.updated', WORKSPACE_A_ID, 'workflow_version', '82'],
      ['workflow_version.deleted', WORKSPACE_A_ID, 'workflow_version', '82'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 82,
      sourceSqliteId: -82,
      workflowId: 23,
      workflowSourceSqliteId: 23,
      label: 'Initial graph',
    });
  });

  test('server workflow version by-source routes snapshot and restore through legacy ids', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const workflowListCalls: unknown[] = [];
    const workflowUpdateCalls: unknown[] = [];
    const versionListCalls: unknown[] = [];
    const versionCreateCalls: unknown[] = [];
    const workflow = {
      ...makeWorkflowRecord(23),
      sourceSqliteId: -23,
      graph: { nodes: [{ id: 'current' }], edges: [] },
      definition: { steps: [{ id: 'current' }] },
    };
    const version = {
      ...makeWorkflowVersionRecord(82),
      sourceSqliteId: -82,
      workflowSourceSqliteId: -23,
      workflowId: 23,
      graph: { nodes: [{ id: 'versioned' }], edges: [] },
      definition: { steps: [{ id: 'versioned' }] },
    };
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      workflows: {
        async list(input) {
          workflowListCalls.push(input);
          return { items: [workflow], nextCursor: null };
        },
        async get() {
          return null;
        },
        async update(input) {
          workflowUpdateCalls.push(input);
          return {
            ok: true,
            workflow: {
              ...workflow,
              graph: input.values.graph ?? workflow.graph,
              definition: input.values.definition ?? workflow.definition,
            },
          };
        },
      },
      workflowVersions: {
        async list(input) {
          versionListCalls.push(input);
          return { items: [version], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          versionCreateCalls.push(input);
          return {
            ok: true,
            version: {
              ...version,
              label: input.values.label ?? 'Vor Speichern',
              graph: input.values.graph ?? {},
              definition: input.values.definition ?? {},
            },
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const listed = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows/by-source/-23/versions',
      principal,
    });
    expect(listed.status).toBe(200);
    expect((listed.body as any).data.items[0].sourceSqliteId).toBe(-82);

    const snapshotted = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/by-source/-23/versions/snapshot',
      body: { label: ' Vor Speichern ' },
      principal,
    });
    expect(snapshotted.status).toBe(201);
    expect(versionCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        workflowId: 23,
        label: 'Vor Speichern',
        graph: { nodes: [{ id: 'current' }], edges: [] },
        definition: { steps: [{ id: 'current' }] },
      },
    }]);

    const restored = await api.handle({
      method: 'POST',
      path: '/api/v1/workflow-versions/by-source/-82/restore',
      body: { workflowId: -23 },
      principal,
    });
    expect(restored.status).toBe(200);
    expect((restored.body as any).data.success).toBe(true);
    expect(workflowUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 23,
      values: {
        graph: { nodes: [{ id: 'versioned' }], edges: [] },
        definition: { steps: [{ id: 'versioned' }] },
      },
    }]);
    expect(versionListCalls).toEqual([
      { workspaceId: WORKSPACE_A_ID, limit: 50, workflowId: 23 },
      { workspaceId: WORKSPACE_A_ID, limit: 100 },
    ]);
    expect(workflowListCalls).toEqual([
      { workspaceId: WORKSPACE_A_ID, limit: 100 },
      { workspaceId: WORKSPACE_A_ID, limit: 100 },
    ]);
    expect(auditEvents.map((event) => event.action)).toEqual([
      'workflow_version.created',
      'workflow.updated',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['workflow_version.created', WORKSPACE_A_ID, 'workflow_version', '82'],
      ['workflow.updated', WORKSPACE_A_ID, 'workflow', '23'],
    ]);
  });

  test('server workflow run by-source routes resolve legacy ids for history reads', async () => {
    const workflowListCalls: unknown[] = [];
    const runListCalls: unknown[] = [];
    const stepListCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      workflows: {
        async list(input) {
          workflowListCalls.push(input);
          return {
            items: [{ ...makeWorkflowRecord(23), sourceSqliteId: -23 }],
            nextCursor: null,
          };
        },
        async get() {
          return null;
        },
      },
      workflowRuns: {
        async list(input) {
          runListCalls.push(input);
          return {
            items: [{
              ...makeWorkflowRunRecord(80),
              sourceSqliteId: -91,
              workflowSourceSqliteId: -23,
              workflowId: 23,
            }],
            nextCursor: null,
          };
        },
        async get() {
          return null;
        },
      },
      workflowRunSteps: {
        async list(input) {
          stepListCalls.push(input);
          return {
            items: [{
              ...makeWorkflowRunStepRecord(81),
              sourceSqliteId: -101,
              runSourceSqliteId: -91,
              runId: 80,
            }],
            nextCursor: null,
          };
        },
        async get() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const runs = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows/by-source/-23/runs',
      principal,
    });
    expect(runs.status).toBe(200);
    expect((runs.body as any).data.items[0].sourceSqliteId).toBe(-91);

    const steps = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-runs/by-source/-91/steps',
      principal,
    });
    expect(steps.status).toBe(200);
    expect((steps.body as any).data.items[0].sourceSqliteId).toBe(-101);
    expect(workflowListCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 100 }]);
    expect(runListCalls).toEqual([
      { workspaceId: WORKSPACE_A_ID, limit: 50, includeLog: false, workflowId: 23 },
      { workspaceId: WORKSPACE_A_ID, limit: 100, includeLog: false },
    ]);
    expect(stepListCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 50, includeDetail: false, runId: 80 }]);
  });

  test('server workflow version mutation routes reject unsafe payloads and invalid references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      workflowVersions: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      workflowVersions: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.workflowId === 99) return { ok: false, code: 'workflow_not_found' };
          return { ok: true, version: makeWorkflowVersionRecord(82) };
        },
        async update(input) {
          if (input.values.workflowId === 99) return { ok: false, code: 'workflow_not_found' };
          return null;
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-versions',
      body: { workflowId: 23, label: 'Initial', graph: { nodes: [] }, definition: { steps: [] } },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-versions',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_workflow_version_payload');

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-versions',
      body: {
        workspaceId: WORKSPACE_B_ID,
        workflowId: 0,
        label: 123,
        graph: 'not-json-object',
        definition: { bad: undefined },
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'workflowId', message: 'workflowId muss eine positive Ganzzahl sein' },
      { field: 'label', message: 'label muss ein String sein' },
      { field: 'graph', message: 'graph muss ein JSON-Objekt oder Array sein' },
      { field: 'definition', message: 'definition muss ein JSON-Objekt oder Array sein' },
    ]));

    const missingRequired = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-versions',
      body: { label: 'Initial' },
      principal,
    });
    expect(missingRequired.status).toBe(400);

    const mismatch = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflows/24/versions',
      body: { workflowId: 23, label: 'Initial', graph: { nodes: [] }, definition: { steps: [] } },
      principal,
    });
    expect(mismatch.status).toBe(400);
    expect((mismatch.body as any).error.code).toBe('workflow_id_mismatch');

    const missingWorkflow = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-versions',
      body: { workflowId: 99, label: 'Initial', graph: { nodes: [] }, definition: { steps: [] } },
      principal,
    });
    expect(missingWorkflow.status).toBe(404);
    expect((missingWorkflow.body as any).error.code).toBe('workflow_not_found');

    const invalidId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-versions/0',
      body: { label: 'Published' },
      principal,
    });
    expect(invalidId.status).toBe(400);

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-versions/82',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const missingPatchWorkflow = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-versions/82',
      body: { workflowId: 99 },
      principal,
    });
    expect(missingPatchWorkflow.status).toBe(404);

    const missingWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/workflow-versions/82', body: { label: 'Published' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/workflow-versions/82', principal }),
    ]);
    expect(missingWrites.map((response) => response.status)).toEqual([404, 404]);
  });

  test('server workflow knowledge base mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      workflowKnowledgeBases: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          return {
            ...makeWorkflowKnowledgeBaseRecord(90),
            sourceSqliteId: -90,
            name: input.values.name ?? 'Support KB',
            description: input.values.description ?? null,
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 90
            ? {
              ...makeWorkflowKnowledgeBaseRecord(90),
              sourceSqliteId: -90,
              name: input.values.name ?? 'Support KB',
              description: input.values.description === undefined ? 'Support snippets' : input.values.description,
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 90 ? { ...makeWorkflowKnowledgeBaseRecord(90), sourceSqliteId: -90 } : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/workflow-knowledge-bases',
      body: { name: ' Support KB ', description: ' Support snippets ' },
      principal,
    });
    expect(created.status).toBe(201);
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: { name: 'Support KB', description: 'Support snippets' },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-knowledge-bases/90',
      body: { description: null },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.description).toBeNull();
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 90,
      values: { description: null },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/workflow-knowledge-bases/90',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 90 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'workflow_knowledge_base.created',
      'workflow_knowledge_base.updated',
      'workflow_knowledge_base.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['workflow_knowledge_base.created', WORKSPACE_A_ID, 'workflow_knowledge_base', '90'],
      ['workflow_knowledge_base.updated', WORKSPACE_A_ID, 'workflow_knowledge_base', '90'],
      ['workflow_knowledge_base.deleted', WORKSPACE_A_ID, 'workflow_knowledge_base', '90'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 90,
      sourceSqliteId: -90,
      name: 'Support KB',
      description: 'Support snippets',
    });
  });

  test('server workflow knowledge base mutation routes reject unsafe payloads', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      workflowKnowledgeBases: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      workflowKnowledgeBases: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return makeWorkflowKnowledgeBaseRecord(90);
        },
        async update() {
          return null;
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-knowledge-bases',
      body: { name: 'Support KB' },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-knowledge-bases',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_workflow_knowledge_base_payload');

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-knowledge-bases',
      body: {
        workspaceId: WORKSPACE_B_ID,
        name: ' ',
        description: 123,
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'name', message: 'name darf nicht leer sein' },
      { field: 'description', message: 'description muss ein String sein' },
    ]));

    const missingRequired = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-knowledge-bases',
      body: { description: 'Only description' },
      principal,
    });
    expect(missingRequired.status).toBe(400);

    const invalidId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-knowledge-bases/0',
      body: { name: 'Support KB' },
      principal,
    });
    expect(invalidId.status).toBe(400);

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-knowledge-bases/90',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const missingWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/workflow-knowledge-bases/90', body: { name: 'Support KB' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/workflow-knowledge-bases/90', principal }),
    ]);
    expect(missingWrites.map((response) => response.status)).toEqual([404, 404]);
  });

  test('server workflow knowledge chunk mutation routes write audit records and server events without exposing content', async () => {
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createdChunk: WorkflowKnowledgeChunkRecord = {
      ...makeWorkflowKnowledgeChunkRecord(91, true),
      sourceSqliteId: -91,
      knowledgeBaseSourceSqliteId: -90,
      knowledgeBaseId: 90,
      title: 'Return window',
      content: 'Customers can return items within 30 days.',
      sourcePath: 'returns.md',
      embeddingConfigured: false,
    };
    const updatedChunk: WorkflowKnowledgeChunkRecord = {
      ...createdChunk,
      title: 'Return policy',
      content: 'Updated private return policy text.',
      sourcePath: null,
      updatedAt: '2026-06-03T12:00:00.000Z',
    };
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      workflowKnowledgeChunks: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          return { ok: true, chunk: withRuntimeLeaks(createdChunk) };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 91 ? { ok: true, chunk: withRuntimeLeaks(updatedChunk) } : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 91 ? withRuntimeLeaks(updatedChunk) : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/workflow-knowledge-chunks',
      body: {
        knowledgeBaseId: 90,
        title: ' Return window ',
        content: ' Customers can return items within 30 days. ',
        sourcePath: ' returns.md ',
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect((created.body as any).data).toMatchObject({
      id: 91,
      sourceSqliteId: -91,
      knowledgeBaseId: 90,
      title: 'Return window',
      sourcePath: 'returns.md',
      embeddingConfigured: false,
    });
    expect((created.body as any).data.content).toBeUndefined();
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        knowledgeBaseId: 90,
        title: 'Return window',
        content: 'Customers can return items within 30 days.',
        sourcePath: 'returns.md',
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-knowledge-chunks/91',
      body: {
        title: ' Return policy ',
        content: ' Updated private return policy text. ',
        sourcePath: null,
      },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.title).toBe('Return policy');
    expect((updated.body as any).data.content).toBeUndefined();
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 91,
      values: {
        title: 'Return policy',
        content: 'Updated private return policy text.',
        sourcePath: null,
      },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/workflow-knowledge-chunks/91',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect((deleted.body as any).data.knowledgeChunk.content).toBeUndefined();
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 91 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'workflow_knowledge_chunk.created',
      'workflow_knowledge_chunk.updated',
      'workflow_knowledge_chunk.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['workflow_knowledge_chunk.created', WORKSPACE_A_ID, 'workflow_knowledge_chunk', '91'],
      ['workflow_knowledge_chunk.updated', WORKSPACE_A_ID, 'workflow_knowledge_chunk', '91'],
      ['workflow_knowledge_chunk.deleted', WORKSPACE_A_ID, 'workflow_knowledge_chunk', '91'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 91,
      sourceSqliteId: -91,
      knowledgeBaseId: 90,
      knowledgeBaseSourceSqliteId: -90,
      title: 'Return window',
      sourcePath: 'returns.md',
      embeddingConfigured: false,
    });
    expect(JSON.stringify(auditEvents)).not.toContain('Customers can return');
    expect(JSON.stringify(events)).not.toContain('Customers can return');
    expect(JSON.stringify(auditEvents)).not.toContain('Updated private return policy text');
    expect(JSON.stringify(events)).not.toContain('Updated private return policy text');
    expect(JSON.stringify(created.body)).not.toContain('source-row-leak');
    expect(JSON.stringify(updated.body)).not.toContain('embedding_json');
  });

  test('server workflow knowledge chunk mutation routes reject unsafe payloads', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      workflowKnowledgeChunks: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      workflowKnowledgeChunks: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.knowledgeBaseId === 99) return { ok: false, code: 'knowledge_base_not_found' };
          return { ok: true, chunk: makeWorkflowKnowledgeChunkRecord(91, true) };
        },
        async update(input) {
          if (input.values.knowledgeBaseId === 99) return { ok: false, code: 'knowledge_base_not_found' };
          return null;
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-knowledge-chunks',
      body: { knowledgeBaseId: 90, content: 'Return policy' },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-knowledge-chunks',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_workflow_knowledge_chunk_payload');

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-knowledge-chunks',
      body: {
        workspaceId: WORKSPACE_B_ID,
        knowledgeBaseId: 0,
        title: ' ',
        content: 123,
        sourcePath: 123,
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'knowledgeBaseId', message: 'knowledgeBaseId muss eine positive Ganzzahl sein' },
      { field: 'title', message: 'title darf nicht leer sein' },
      { field: 'content', message: 'content muss ein String sein' },
      { field: 'sourcePath', message: 'sourcePath muss ein String sein' },
    ]));

    const missingRequired = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-knowledge-chunks',
      body: { content: 'Return policy' },
      principal,
    });
    expect(missingRequired.status).toBe(400);

    const missingBase = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-knowledge-chunks',
      body: { knowledgeBaseId: 99, content: 'Return policy' },
      principal,
    });
    expect(missingBase.status).toBe(404);
    expect((missingBase.body as any).error.code).toBe('workflow_knowledge_base_not_found');

    const invalidId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-knowledge-chunks/0',
      body: { title: 'Return policy' },
      principal,
    });
    expect(invalidId.status).toBe(400);

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-knowledge-chunks/91',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const missingPatchBase = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-knowledge-chunks/91',
      body: { knowledgeBaseId: 99 },
      principal,
    });
    expect(missingPatchBase.status).toBe(404);
    expect((missingPatchBase.body as any).error.code).toBe('workflow_knowledge_base_not_found');

    const missingWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/workflow-knowledge-chunks/91', body: { title: 'Return policy' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/workflow-knowledge-chunks/91', principal }),
    ]);
    expect(missingWrites.map((response) => response.status)).toEqual([404, 404]);
  });

  test('server workflow delayed job mutation routes write audit records and server events without exposing context', async () => {
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createdJob: WorkflowDelayedJobRecord = {
      ...makeWorkflowDelayedJobRecord(87, true),
      sourceSqliteId: -87,
      workflowSourceSqliteId: -23,
      messageSourceSqliteId: 11,
      workflowId: 23,
      messageId: 11,
      resumeNodeId: 'wait-1',
      executeAt: '2026-06-03T12:00:00.000Z',
      context: { secret: 'delayed-context-secret' },
      status: 'pending',
    };
    const updatedJob: WorkflowDelayedJobRecord = {
      ...createdJob,
      executeAt: '2026-06-04T12:00:00.000Z',
      context: { secret: 'updated-delayed-context-secret' },
      status: 'cancelled',
      updatedAt: '2026-06-03T13:00:00.000Z',
    };
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      workflowDelayedJobs: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          return { ok: true, job: withRuntimeLeaks(createdJob) };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 87 ? { ok: true, job: withRuntimeLeaks(updatedJob) } : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 87 ? withRuntimeLeaks(updatedJob) : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/workflow-delayed-jobs',
      body: {
        workflowId: 23,
        messageId: 11,
        resumeNodeId: ' wait-1 ',
        executeAt: '2026-06-03T12:00:00.000Z',
        context: { secret: 'delayed-context-secret' },
        status: ' pending ',
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect((created.body as any).data).toMatchObject({
      id: 87,
      sourceSqliteId: -87,
      workflowId: 23,
      messageId: 11,
      resumeNodeId: 'wait-1',
      status: 'pending',
    });
    expect((created.body as any).data.context).toBeUndefined();
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        workflowId: 23,
        messageId: 11,
        resumeNodeId: 'wait-1',
        executeAt: '2026-06-03T12:00:00.000Z',
        context: { secret: 'delayed-context-secret' },
        status: 'pending',
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-delayed-jobs/87',
      body: {
        executeAt: '2026-06-04T12:00:00.000Z',
        context: { secret: 'updated-delayed-context-secret' },
        status: 'cancelled',
      },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.status).toBe('cancelled');
    expect((updated.body as any).data.context).toBeUndefined();
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 87,
      values: {
        executeAt: '2026-06-04T12:00:00.000Z',
        context: { secret: 'updated-delayed-context-secret' },
        status: 'cancelled',
      },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/workflow-delayed-jobs/87',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect((deleted.body as any).data.delayedJob.context).toBeUndefined();
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 87 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'workflow_delayed_job.created',
      'workflow_delayed_job.updated',
      'workflow_delayed_job.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['workflow_delayed_job.created', WORKSPACE_A_ID, 'workflow_delayed_job', '87'],
      ['workflow_delayed_job.updated', WORKSPACE_A_ID, 'workflow_delayed_job', '87'],
      ['workflow_delayed_job.deleted', WORKSPACE_A_ID, 'workflow_delayed_job', '87'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 87,
      sourceSqliteId: -87,
      workflowId: 23,
      workflowSourceSqliteId: -23,
      messageId: 11,
      messageSourceSqliteId: 11,
      resumeNodeId: 'wait-1',
      executeAt: '2026-06-03T12:00:00.000Z',
      status: 'pending',
    });
    expect(JSON.stringify(auditEvents)).not.toContain('delayed-context-secret');
    expect(JSON.stringify(events)).not.toContain('delayed-context-secret');
    expect(JSON.stringify(auditEvents)).not.toContain('updated-delayed-context-secret');
    expect(JSON.stringify(events)).not.toContain('updated-delayed-context-secret');
  });

  test('server workflow delayed job mutation routes reject unsafe payloads and missing references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      workflowDelayedJobs: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      workflowDelayedJobs: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.workflowId === 99) return { ok: false, code: 'workflow_not_found' };
          if (input.values.messageId === 99) return { ok: false, code: 'message_not_found' };
          return { ok: true, job: makeWorkflowDelayedJobRecord(87, true) };
        },
        async update(input) {
          if (input.values.workflowId === 99) return { ok: false, code: 'workflow_not_found' };
          if (input.values.messageId === 99) return { ok: false, code: 'message_not_found' };
          return null;
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-delayed-jobs',
      body: { workflowId: 23, executeAt: '2026-06-03T12:00:00.000Z', status: 'pending' },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-delayed-jobs',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_workflow_delayed_job_payload');

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-delayed-jobs',
      body: {
        workspaceId: WORKSPACE_B_ID,
        workflowId: 0,
        messageId: 0,
        resumeNodeId: ' ',
        executeAt: 'not-a-date',
        context: 'not-json-object',
        status: 123,
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'workflowId', message: 'workflowId muss eine positive Ganzzahl sein' },
      { field: 'messageId', message: 'messageId muss eine positive Ganzzahl sein' },
      { field: 'resumeNodeId', message: 'resumeNodeId darf nicht leer sein' },
      { field: 'executeAt', message: 'executeAt muss ein valides Datum sein' },
      { field: 'context', message: 'context muss ein JSON-Objekt oder Array sein' },
      { field: 'status', message: 'status muss ein String sein' },
    ]));

    const missingRequired = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-delayed-jobs',
      body: { workflowId: 23 },
      principal,
    });
    expect(missingRequired.status).toBe(400);

    const missingWorkflow = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-delayed-jobs',
      body: { workflowId: 99, executeAt: '2026-06-03T12:00:00.000Z', status: 'pending' },
      principal,
    });
    expect(missingWorkflow.status).toBe(404);
    expect((missingWorkflow.body as any).error.code).toBe('workflow_not_found');

    const missingMessage = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/workflow-delayed-jobs',
      body: { workflowId: 23, messageId: 99, executeAt: '2026-06-03T12:00:00.000Z', status: 'pending' },
      principal,
    });
    expect(missingMessage.status).toBe(404);
    expect((missingMessage.body as any).error.code).toBe('email_message_not_found');

    const invalidId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-delayed-jobs/0',
      body: { status: 'cancelled' },
      principal,
    });
    expect(invalidId.status).toBe(400);

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-delayed-jobs/87',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const missingPatchWorkflow = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow-delayed-jobs/87',
      body: { workflowId: 99 },
      principal,
    });
    expect(missingPatchWorkflow.status).toBe(404);
    expect((missingPatchWorkflow.body as any).error.code).toBe('workflow_not_found');

    const missingWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/workflow-delayed-jobs/87', body: { status: 'cancelled' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/workflow-delayed-jobs/87', principal }),
    ]);
    expect(missingWrites.map((response) => response.status)).toEqual([404, 404]);
  });

  test('server workflow runtime read routes expose runs, steps, knowledge, and delayed jobs with gated details', async () => {
    const calls: Record<string, unknown[]> = {
      delayedJobs: [],
      forwardDedup: [],
      knowledgeBases: [],
      knowledgeChunks: [],
      messageApplied: [],
      runs: [],
      runSteps: [],
      versions: [],
    };
    const ports = makeServerApiPorts({
      workflowDelayedJobs: {
        async list(input) {
          calls.delayedJobs.push(input);
          return { items: [withRuntimeLeaks(makeWorkflowDelayedJobRecord(87, true))], nextCursor: null };
        },
        async get(input) {
          return input.id === 87 ? makeWorkflowDelayedJobRecord(87, input.includeContext) : null;
        },
      },
      workflowForwardDedup: {
        async list(input) {
          calls.forwardDedup.push(input);
          return { items: [withRuntimeLeaks(makeWorkflowForwardDedupRecord(85))], nextCursor: null };
        },
        async get(input) {
          return input.id === 85 ? withRuntimeLeaks(makeWorkflowForwardDedupRecord(85)) : null;
        },
      },
      workflowKnowledgeBases: {
        async list(input) {
          calls.knowledgeBases.push(input);
          return { items: [withRuntimeLeaks(makeWorkflowKnowledgeBaseRecord(90))], nextCursor: null };
        },
        async get(input) {
          return input.id === 90 ? withRuntimeLeaks(makeWorkflowKnowledgeBaseRecord(90)) : null;
        },
      },
      workflowKnowledgeChunks: {
        async list(input) {
          calls.knowledgeChunks.push(input);
          return { items: [withRuntimeLeaks(makeWorkflowKnowledgeChunkRecord(91, true))], nextCursor: null };
        },
        async get(input) {
          return input.id === 91 ? makeWorkflowKnowledgeChunkRecord(91, input.includeContent) : null;
        },
      },
      workflowMessageApplied: {
        async list(input) {
          calls.messageApplied.push(input);
          return { items: [withRuntimeLeaks(makeWorkflowMessageAppliedRecord(84))], nextCursor: null };
        },
        async get(input) {
          return input.id === 84 ? withRuntimeLeaks(makeWorkflowMessageAppliedRecord(84)) : null;
        },
      },
      workflowRuns: {
        async list(input) {
          calls.runs.push(input);
          return { items: [withRuntimeLeaks(makeWorkflowRunRecord(80, true))], nextCursor: 80 };
        },
        async get(input) {
          return input.id === 80 ? makeWorkflowRunRecord(80, input.includeLog) : null;
        },
      },
      workflowRunSteps: {
        async list(input) {
          calls.runSteps.push(input);
          return { items: [withRuntimeLeaks(makeWorkflowRunStepRecord(81, true))], nextCursor: null };
        },
        async get(input) {
          return input.id === 81 ? makeWorkflowRunStepRecord(81, input.includeDetail) : null;
        },
      },
      workflowVersions: {
        async list(input) {
          calls.versions.push(input);
          return { items: [withRuntimeLeaks(makeWorkflowVersionRecord(82))], nextCursor: null };
        },
        async get(input) {
          return input.id === 82 ? withRuntimeLeaks(makeWorkflowVersionRecord(82)) : null;
        },
      },
    });
    const api = createServerApi(ports);
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const versions = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows/23/versions',
      query: { search: 'Version', cursor: '81', limit: '5' },
      principal,
    });
    expect(versions.status).toBe(200);
    expect((versions.body as any).data.items[0].label).toBe('Version 82');
    expect(calls.versions).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      cursor: 81,
      limit: 5,
      search: 'Version',
      workflowId: 23,
    }]);

    const runs = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows/23/runs',
      query: { messageId: '11', direction: 'inbound', status: 'succeeded' },
      principal,
    });
    expect(runs.status).toBe(200);
    expect((runs.body as any).data.items[0].log).toBeUndefined();
    expect((runs.body as any).data.nextCursor).toBe(80);
    expect(calls.runs[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      workflowId: 23,
      messageId: 11,
      direction: 'inbound',
      status: 'succeeded',
      includeLog: false,
    });

    const run = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-runs/80',
      query: { includeLog: 'true' },
      principal,
    });
    expect(run.status).toBe(200);
    expect((run.body as any).data.log).toEqual({ entries: ['run-log-entry'] });

    const messageRuns = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/workflow-runs',
      principal,
    });
    expect(messageRuns.status).toBe(200);
    expect(calls.runs[1]).toEqual({ workspaceId: WORKSPACE_A_ID, limit: 50, includeLog: false, messageId: 11 });

    const runSteps = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-runs/80/steps',
      query: { nodeType: 'ai.reply', status: 'succeeded' },
      principal,
    });
    expect(runSteps.status).toBe(200);
    expect((runSteps.body as any).data.items[0].detail).toBeUndefined();
    expect(calls.runSteps[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      runId: 80,
      nodeType: 'ai.reply',
      status: 'succeeded',
      includeDetail: false,
    });

    const runStep = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-run-steps/81',
      query: { includeDetail: 'true' },
      principal,
    });
    expect(runStep.status).toBe(200);
    expect((runStep.body as any).data.detail).toEqual({ tokens: 42 });

    const applied = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-message-applied',
      query: { messageId: '11', workflowId: '23' },
      principal,
    });
    expect(applied.status).toBe(200);
    expect((applied.body as any).data.items[0].appliedAt).toBe('2026-06-02T12:00:00.000Z');
    expect(calls.messageApplied).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 50, messageId: 11, workflowId: 23 }]);

    const dedup = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-forward-dedup',
      query: { messageId: '11', workflowId: '23', dest: 'ops@example.com' },
      principal,
    });
    expect(dedup.status).toBe(200);
    expect((dedup.body as any).data.items[0].dest).toBe('ops@example.com');

    const knowledgeBases = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-knowledge-bases',
      query: { search: 'Returns' },
      principal,
    });
    expect(knowledgeBases.status).toBe(200);
    expect((knowledgeBases.body as any).data.items[0].name).toBe('Returns policy');
    expect(calls.knowledgeBases).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 50, search: 'Returns' }]);

    const chunks = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-knowledge-chunks',
      query: { knowledgeBaseId: '90', search: 'return' },
      principal,
    });
    expect(chunks.status).toBe(200);
    expect((chunks.body as any).data.items[0].content).toBeUndefined();
    expect((chunks.body as any).data.items[0].embeddingConfigured).toBe(true);
    expect(calls.knowledgeChunks[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      knowledgeBaseId: 90,
      search: 'return',
      includeContent: false,
    });

    const chunk = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-knowledge-chunks/91',
      query: { includeContent: 'true' },
      principal,
    });
    expect(chunk.status).toBe(200);
    expect((chunk.body as any).data.content).toBe('Customers can return items within 30 days.');

    const delayedJobs = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-delayed-jobs',
      query: { workflowId: '23', messageId: '11', status: 'pending' },
      principal,
    });
    expect(delayedJobs.status).toBe(200);
    expect((delayedJobs.body as any).data.items[0].context).toBeUndefined();
    expect(calls.delayedJobs[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      workflowId: 23,
      messageId: 11,
      status: 'pending',
      includeContext: false,
    });

    const delayedJob = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-delayed-jobs/87',
      query: { includeContext: 'true' },
      principal,
    });
    expect(delayedJob.status).toBe(200);
    expect((delayedJob.body as any).data.context).toEqual({ retry: true });

    const serialized = [
      versions.body,
      runs.body,
      runSteps.body,
      applied.body,
      dedup.body,
      knowledgeBases.body,
      chunks.body,
      delayedJobs.body,
    ].map((body) => JSON.stringify(body)).join('\n');
    expect(serialized).not.toContain('source-row-leak');
    expect(serialized).not.toContain('sqlite-import-run-id');
    expect(serialized).not.toContain('log-leak');
    expect(serialized).not.toContain('detail-leak');
    expect(serialized).not.toContain('context-leak');
  });

  test('server workflow runtime routes validate auth, IDs, include flags, filters, and missing ports', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unauthorized = await api.handle({ method: 'GET', path: '/api/v1/workflow-runs' });
    expect(unauthorized.status).toBe(401);

    const invalidWorkflowId = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows/nope/runs',
      principal,
    });
    expect(invalidWorkflowId.status).toBe(400);
    expect((invalidWorkflowId.body as any).error.code).toBe('invalid_workflow_id');

    const invalidRunId = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-runs/0',
      principal,
    });
    expect(invalidRunId.status).toBe(400);
    expect((invalidRunId.body as any).error.code).toBe('invalid_workflow_run_id');

    const invalidIncludeLog = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-runs',
      query: { includeLog: 'yes' },
      principal,
    });
    expect(invalidIncludeLog.status).toBe(400);
    expect((invalidIncludeLog.body as any).error.code).toBe('invalid_include_log');

    const invalidKnowledgeFilter = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-knowledge-chunks',
      query: { knowledgeBaseId: '-1' },
      principal,
    });
    expect(invalidKnowledgeFilter.status).toBe(400);
    expect((invalidKnowledgeFilter.body as any).error.code).toBe('invalid_knowledge_base_id');

    const invalidLimit = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-delayed-jobs',
      query: { limit: '101' },
      principal,
    });
    expect(invalidLimit.status).toBe(400);
    expect((invalidLimit.body as any).error.code).toBe('invalid_limit');

    const unavailable = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow-runs',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('workflow_runs_unavailable');
  });

  test('server PGP read routes pass validated filters and hide private key references', async () => {
    const identityListCalls: unknown[] = [];
    const peerKeyListCalls: unknown[] = [];
    const ports = makeServerApiPorts({
      pgpIdentities: {
        async list(input) {
          identityListCalls.push(input);
          return {
            items: [withRuntimeLeaks(makePgpIdentityRecord(41))],
            nextCursor: 41,
          };
        },
        async get(input) {
          return input.id === 41 ? withRuntimeLeaks(makePgpIdentityRecord(41)) : null;
        },
      },
      pgpPeerKeys: {
        async list(input) {
          peerKeyListCalls.push(input);
          return {
            items: [makePgpPeerKeyRecord(42)],
            nextCursor: null,
          };
        },
        async get(input) {
          return input.id === 42 ? makePgpPeerKeyRecord(42) : null;
        },
      },
    });
    const api = createServerApi(ports);
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const identities = await api.handle({
      method: 'GET',
      path: '/api/v1/pgp/identities',
      query: { search: ' fingerprint ', email: ' identity@example.com ', cursor: '40', limit: '10' },
      principal,
    });
    expect(identities.status).toBe(200);
    expect((identities.body as any).data.items[0].privateKeyConfigured).toBe(true);
    expect(JSON.stringify(identities.body)).not.toContain('secret-id');
    expect(JSON.stringify(identities.body)).not.toContain('keytar');
    expect(identityListCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 10,
      cursor: 40,
      search: 'fingerprint',
      email: 'identity@example.com',
    }]);

    const peerKeys = await api.handle({
      method: 'GET',
      path: '/api/v1/pgp/peer-keys',
      query: { search: ' peer ', email: ' peer@example.com ', trustLevel: 'verified' },
      principal,
    });
    expect(peerKeys.status).toBe(200);
    expect((peerKeys.body as any).data.items[0].email).toBe('peer@example.com');
    expect(peerKeyListCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      search: 'peer',
      email: 'peer@example.com',
      trustLevel: 'verified',
    }]);

    const identity = await api.handle({
      method: 'GET',
      path: '/api/v1/pgp/identities/41',
      principal,
    });
    expect(identity.status).toBe(200);

    const missingPeerKey = await api.handle({
      method: 'GET',
      path: '/api/v1/pgp/peer-keys/99',
      principal,
    });
    expect(missingPeerKey.status).toBe(404);
  });

  test('server PGP read routes validate auth, IDs, filters, and missing ports', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unauthorized = await api.handle({ method: 'GET', path: '/api/v1/pgp/identities' });
    expect(unauthorized.status).toBe(401);

    const invalidIdentityId = await api.handle({
      method: 'GET',
      path: '/api/v1/pgp/identities/nope',
      principal,
    });
    expect(invalidIdentityId.status).toBe(400);
    expect((invalidIdentityId.body as any).error.code).toBe('invalid_pgp_identity_id');

    const invalidTrustLevel = await api.handle({
      method: 'GET',
      path: '/api/v1/pgp/peer-keys',
      query: { trustLevel: 'x'.repeat(101) },
      principal,
    });
    expect(invalidTrustLevel.status).toBe(400);
    expect((invalidTrustLevel.body as any).error.code).toBe('invalid_trust_level');

    const unavailableIdentities = await api.handle({
      method: 'GET',
      path: '/api/v1/pgp/identities',
      principal,
    });
    expect(unavailableIdentities.status).toBe(503);
    expect((unavailableIdentities.body as any).error.code).toBe('pgp_identities_unavailable');

    const unavailablePeerKeys = await api.handle({
      method: 'GET',
      path: '/api/v1/pgp/peer-keys',
      principal,
    });
    expect(unavailablePeerKeys.status).toBe(503);
    expect((unavailablePeerKeys.body as any).error.code).toBe('pgp_peer_keys_unavailable');
  });

  test('server PGP identity mutation routes write audit records and server events without exposing private keys', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const createdIdentity: PgpIdentityRecord = {
      ...makePgpIdentityRecord(41),
      sourceSqliteId: -41,
      legacyUserId: null,
      email: 'identity@example.com',
      fingerprint: 'PGP-FINGERPRINT-41',
      hasPrivateKey: true,
      privateKeyConfigured: true,
      isPrimary: true,
    };
    const updatedIdentity: PgpIdentityRecord = {
      ...createdIdentity,
      hasPrivateKey: false,
      privateKeyConfigured: false,
      isPrimary: false,
      updatedAt: '2026-06-03T12:00:00.000Z',
    };
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      pgpIdentities: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          return { ok: true, identity: withRuntimeLeaks(createdIdentity) };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 41 ? { ok: true, identity: withRuntimeLeaks(updatedIdentity) } : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 41 ? { ok: true, identity: withRuntimeLeaks(updatedIdentity) } : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/identities',
      body: {
        email: ' identity@example.com ',
        fingerprint: ' PGP-FINGERPRINT-41 ',
        publicKeyArmor: ' -----BEGIN PGP PUBLIC KEY BLOCK-----\nidentity\n-----END PGP PUBLIC KEY BLOCK----- ',
        privateKeyArmored: ' -----BEGIN PGP PRIVATE KEY BLOCK-----\nPRIVATE KEY MATERIAL\n-----END PGP PRIVATE KEY BLOCK----- ',
        privateKeyPassphrase: ' passphrase-secret ',
        expiresAt: '2027-06-02T12:00:00.000Z',
        isPrimary: true,
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect((created.body as any).data.privateKeyConfigured).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain('PRIVATE KEY MATERIAL');
    expect(JSON.stringify(created.body)).not.toContain('passphrase-secret');
    expect(JSON.stringify(created.body)).not.toContain('secret-id');
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        email: 'identity@example.com',
        fingerprint: 'PGP-FINGERPRINT-41',
        publicKeyArmor: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nidentity\n-----END PGP PUBLIC KEY BLOCK-----',
        privateKeyArmored: '-----BEGIN PGP PRIVATE KEY BLOCK-----\nPRIVATE KEY MATERIAL\n-----END PGP PRIVATE KEY BLOCK-----',
        privateKeyPassphrase: ' passphrase-secret ',
        expiresAt: '2027-06-02T12:00:00.000Z',
        isPrimary: true,
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/pgp/identities/41',
      body: { privateKeyArmored: null, isPrimary: false },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.privateKeyConfigured).toBe(false);
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 41,
      values: { privateKeyArmored: null, isPrimary: false },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/pgp/identities/41',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 41 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'pgp_identity.created',
      'pgp_identity.updated',
      'pgp_identity.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['pgp_identity.created', WORKSPACE_A_ID, 'pgp_identity', '41'],
      ['pgp_identity.updated', WORKSPACE_A_ID, 'pgp_identity', '41'],
      ['pgp_identity.deleted', WORKSPACE_A_ID, 'pgp_identity', '41'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 41,
      sourceSqliteId: -41,
      userId: USER_A_ID,
      email: 'identity@example.com',
      fingerprint: 'PGP-FINGERPRINT-41',
      privateKeyConfigured: true,
      isPrimary: true,
    });
    expect(JSON.stringify(auditEvents)).not.toContain('PRIVATE KEY MATERIAL');
    expect(JSON.stringify(events)).not.toContain('PRIVATE KEY MATERIAL');
    expect(JSON.stringify(auditEvents)).not.toContain('passphrase-secret');
    expect(JSON.stringify(events)).not.toContain('passphrase-secret');
    expect(JSON.stringify(events)).not.toContain('PUBLIC KEY BLOCK');
  });

});
