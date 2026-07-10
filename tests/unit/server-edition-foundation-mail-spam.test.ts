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

describe('server edition foundation — mail-spam', () => {
  test('server mail spam-decision route rejects unsafe payloads and missing ports', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async evaluateSpamDecision() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/spam-decision',
      body: {},
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidId = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/nope/spam-decision',
      body: {},
      principal,
    });
    expect(invalidId.status).toBe(400);

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/spam-decision',
      body: { applyStatus: 'yes', workspaceId: WORKSPACE_A_ID },
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.details.fields).toEqual([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'applyStatus', message: 'applyStatus muss true oder false sein' },
    ]);

    const notFound = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/spam-decision',
      body: {},
      principal,
    });
    expect(notFound.status).toBe(404);
  });

  test('server mail security-check route rejects unsafe payloads and missing ports', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async runSecurityCheck() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/security/check',
      body: {},
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidId = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/nope/security/check',
      body: {},
      principal,
    });
    expect(invalidId.status).toBe(400);

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/security/check',
      body: { applyStatus: 'yes', workspaceId: WORKSPACE_A_ID },
      principal,
    });
    expect(invalidPayload.status).toBe(400);

    const notFound = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/security/check',
      body: {},
      principal,
    });
    expect(notFound.status).toBe(404);
  });

  test('server mail metadata read routes expose imported records without source-row leaks', async () => {
    const calls: Record<string, unknown[]> = {
      accountSignatures: [],
      cannedResponses: [],
      categories: [],
      categoryCounts: [],
      folders: [],
      internalNotes: [],
      messageCategories: [],
      messageTags: [],
      readReceipts: [],
      remoteContentAllowlist: [],
      teamMembers: [],
      threadAliases: [],
      threadAliasWarnings: [],
      threadEdges: [],
      threads: [],
    };
    const ports = makeServerApiPorts({
      emailAccountSignatures: {
        async list(input) {
          calls.accountSignatures.push(input);
          return { items: [withRuntimeLeaks(makeEmailAccountSignatureRecord(-71))], nextCursor: -71 };
        },
        async get(input) {
          return input.id === -71 ? withRuntimeLeaks(makeEmailAccountSignatureRecord(-71)) : null;
        },
      },
      emailCannedResponses: {
        async list(input) {
          calls.cannedResponses.push(input);
          return { items: [withRuntimeLeaks(makeEmailCannedResponseRecord(70))], nextCursor: null };
        },
        async get(input) {
          return input.id === 70 ? withRuntimeLeaks(makeEmailCannedResponseRecord(70)) : null;
        },
      },
      emailCategories: {
        async list(input) {
          calls.categories.push(input);
          return { items: [withRuntimeLeaks(makeEmailCategoryRecord(61))], nextCursor: null };
        },
        async get(input) {
          return input.id === 61 ? withRuntimeLeaks(makeEmailCategoryRecord(61)) : null;
        },
      },
      emailFolders: {
        async list(input) {
          calls.folders.push(input);
          return { items: [withRuntimeLeaks(makeEmailFolderRecord(2))], nextCursor: 2 };
        },
        async get(input) {
          return input.id === 2 ? withRuntimeLeaks(makeEmailFolderRecord(2)) : null;
        },
      },
      emailInternalNotes: {
        async list(input) {
          calls.internalNotes.push(input);
          return { items: [withRuntimeLeaks(makeEmailInternalNoteRecord(63))], nextCursor: null };
        },
        async get(input) {
          return input.id === 63 ? withRuntimeLeaks(makeEmailInternalNoteRecord(63)) : null;
        },
      },
      emailMessageCategories: {
        async list(input) {
          calls.messageCategories.push(input);
          return { items: [withRuntimeLeaks(makeEmailMessageCategoryRecord(62))], nextCursor: null };
        },
        async get(input) {
          return input.id === 62 ? withRuntimeLeaks(makeEmailMessageCategoryRecord(62)) : null;
        },
        async listCounts(input) {
          calls.categoryCounts.push(input);
          return [
            { categoryId: 61, count: 3 },
            { categoryId: 62, count: 0 },
          ];
        },
      },
      emailMessageTags: {
        async list(input) {
          calls.messageTags.push(input);
          return { items: [withRuntimeLeaks(makeEmailMessageTagRecord(60))], nextCursor: null };
        },
        async get(input) {
          return input.id === 60 ? withRuntimeLeaks(makeEmailMessageTagRecord(60)) : null;
        },
      },
      emailReadReceipts: {
        async list(input) {
          calls.readReceipts.push(input);
          return { items: [withRuntimeLeaks(makeEmailReadReceiptRecord(73))], nextCursor: null };
        },
        async get(input) {
          return input.id === 73 ? withRuntimeLeaks(makeEmailReadReceiptRecord(73)) : null;
        },
      },
      emailRemoteContentAllowlist: {
        async list(input) {
          calls.remoteContentAllowlist.push(input);
          return { items: [withRuntimeLeaks(makeEmailRemoteContentAllowlistRecord(72))], nextCursor: null };
        },
        async get(input) {
          return input.id === 72 ? withRuntimeLeaks(makeEmailRemoteContentAllowlistRecord(72)) : null;
        },
      },
      emailTeamMembers: {
        async list(input) {
          calls.teamMembers.push(input);
          return { items: [withRuntimeLeaks(makeEmailTeamMemberRecord('agent-1'))], nextCursor: null };
        },
        async get(input) {
          return input.id === 'agent-1' ? withRuntimeLeaks(makeEmailTeamMemberRecord('agent-1')) : null;
        },
      },
      emailThreadAliases: {
        async list(input) {
          calls.threadAliases.push(input);
          return { items: [withRuntimeLeaks(makeEmailThreadAliasRecord(75))], nextCursor: null };
        },
        async get(input) {
          return input.id === 75 ? withRuntimeLeaks(makeEmailThreadAliasRecord(75)) : null;
        },
        async listWarnings(input) {
          calls.threadAliasWarnings.push(input);
          return [withRuntimeLeaks({
            messageId: 88,
            accountId: 2,
            subject: 'Possible cross account thread',
            aliasThreadId: 'thread-alias',
            canonicalThreadId: 'thread-canonical',
            confidence: 'medium',
          })];
        },
      },
      emailThreadEdges: {
        async list(input) {
          calls.threadEdges.push(input);
          return { items: [withRuntimeLeaks(makeEmailThreadEdgeRecord(74))], nextCursor: null };
        },
        async get(input) {
          return input.id === 74 ? withRuntimeLeaks(makeEmailThreadEdgeRecord(74)) : null;
        },
      },
      emailThreads: {
        async list(input) {
          calls.threads.push(input);
          return { items: [withRuntimeLeaks(makeEmailThreadRecord('thread-1'))], nextCursor: null };
        },
        async get(input) {
          return input.id === 'thread-1' ? withRuntimeLeaks(makeEmailThreadRecord('thread-1')) : null;
        },
      },
    });
    const api = createServerApi(ports);
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const folders = await api.handle({
      method: 'GET',
      path: '/api/v1/email/folders',
      query: { accountId: '1', search: ' INBOX ', cursor: '1', limit: '5' },
      principal,
    });
    expect(folders.status).toBe(200);
    expect((folders.body as any).data.items[0].path).toBe('INBOX');
    expect((folders.body as any).data.nextCursor).toBe(2);
    expect(calls.folders).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      accountId: 1,
      search: 'INBOX',
      cursor: 1,
      limit: 5,
    }]);

    const folder = await api.handle({ method: 'GET', path: '/api/v1/email/folders/2', principal });
    expect(folder.status).toBe(200);
    expect((folder.body as any).data.accountId).toBe(1);

    const teamMembers = await api.handle({
      method: 'GET',
      path: '/api/v1/email/team-members',
      query: { role: 'agent', search: 'Agent', cursor: 'agent-0' },
      principal,
    });
    expect(teamMembers.status).toBe(200);
    expect((teamMembers.body as any).data.items[0].id).toBe('agent-1');
    expect(calls.teamMembers).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      cursor: 'agent-0',
      search: 'Agent',
      role: 'agent',
    }]);

    const thread = await api.handle({ method: 'GET', path: '/api/v1/email/threads/thread-1', principal });
    expect(thread.status).toBe(200);
    expect((thread.body as any).data.ticketCode).toBe('T-2026-1');

    const threads = await api.handle({
      method: 'GET',
      path: '/api/v1/email/threads',
      query: {
        accountId: '2',
        view: 'inbox',
        offset: '10',
        hasUnread: 'true',
        hasAttachments: 'true',
        search: 'customer',
      },
      principal,
    });
    expect(threads.status).toBe(200);
    expect(calls.threads).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      accountId: 2,
      view: 'inbox',
      offset: 10,
      limit: 50,
      search: 'customer',
      hasUnread: true,
      hasAttachments: true,
    }]);

    const messageTags = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/tags',
      query: { limit: '5' },
      principal,
    });
    expect(messageTags.status).toBe(200);
    expect((messageTags.body as any).data.items[0].tag).toBe('priority');
    expect(calls.messageTags).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 5, messageId: 11 }]);

    const categories = await api.handle({
      method: 'GET',
      path: '/api/v1/email/categories',
      query: { search: 'Support' },
      principal,
    });
    expect(categories.status).toBe(200);
    expect((categories.body as any).data.items[0].name).toBe('Support');

    const categoryCounts = await api.handle({
      method: 'GET',
      path: '/api/v1/email/category-counts',
      query: { accountId: '1' },
      principal,
    });
    expect(categoryCounts.status).toBe(200);
    expect((categoryCounts.body as any).data).toEqual([
      { categoryId: 61, count: 3 },
      { categoryId: 62, count: 0 },
    ]);
    expect(calls.categoryCounts).toEqual([{ workspaceId: WORKSPACE_A_ID, accountId: 1 }]);

    const messageCategories = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/categories',
      principal,
    });
    expect(messageCategories.status).toBe(200);
    expect((messageCategories.body as any).data.items[0].categoryId).toBe(61);
    expect(calls.messageCategories).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 50, messageId: 11 }]);

    const internalNotes = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/internal-notes',
      principal,
    });
    expect(internalNotes.status).toBe(200);
    expect((internalNotes.body as any).data.items[0].body).toBe('Internal follow-up note');

    const cannedResponses = await api.handle({
      method: 'GET',
      path: '/api/v1/email/canned-responses',
      query: { search: 'Shipping' },
      principal,
    });
    expect(cannedResponses.status).toBe(200);
    expect((cannedResponses.body as any).data.items[0].title).toBe('Shipping update');

    const signatures = await api.handle({
      method: 'GET',
      path: '/api/v1/email/account-signatures',
      query: { cursor: '-72', limit: '5' },
      principal,
    });
    expect(signatures.status).toBe(200);
    expect((signatures.body as any).data.nextCursor).toBe(-71);
    expect(calls.accountSignatures).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      cursor: -72,
      limit: 5,
    }]);

    const signature = await api.handle({
      method: 'GET',
      path: '/api/v1/email/account-signatures/-71',
      principal,
    });
    expect(signature.status).toBe(200);
    expect((signature.body as any).data.signatureHtml).toBe('<p>Mailbox signature</p>');

    const remoteAllowlist = await api.handle({
      method: 'GET',
      path: '/api/v1/email/remote-content-allowlist',
      query: { scope: 'domain', search: 'example' },
      principal,
    });
    expect(remoteAllowlist.status).toBe(200);
    expect((remoteAllowlist.body as any).data.items[0].value).toBe('example.com');

    const readReceipts = await api.handle({
      method: 'GET',
      path: '/api/v1/email/read-receipts',
      query: { messageId: '11', direction: 'outbound' },
      principal,
    });
    expect(readReceipts.status).toBe(200);
    expect((readReceipts.body as any).data.items[0].recipient).toBe('customer@example.com');

    const threadEdges = await api.handle({
      method: 'GET',
      path: '/api/v1/email/thread-edges',
      query: { parentMessageId: '10', childMessageId: '11' },
      principal,
    });
    expect(threadEdges.status).toBe(200);
    expect((threadEdges.body as any).data.items[0].childMessageId).toBe(11);

    const threadAliases = await api.handle({
      method: 'GET',
      path: '/api/v1/email/thread-aliases',
      query: { aliasThreadId: 'thread-alias', canonicalThreadId: 'thread-canonical', confidence: 'high', source: 'import' },
      principal,
    });
    expect(threadAliases.status).toBe(200);
    expect((threadAliases.body as any).data.items[0].canonicalThreadId).toBe('thread-canonical');

    const threadAliasWarnings = await api.handle({
      method: 'GET',
      path: '/api/v1/email/thread-alias-warnings',
      query: { limit: '5' },
      principal,
    });
    expect(threadAliasWarnings.status).toBe(200);
    expect((threadAliasWarnings.body as any).data.items).toEqual([
      {
        messageId: 88,
        accountId: 2,
        subject: 'Possible cross account thread',
        aliasThreadId: 'thread-alias',
        canonicalThreadId: 'thread-canonical',
        confidence: 'medium',
      },
    ]);
    expect(calls.threadAliasWarnings).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 5 }]);

    const serializedBodies = [
      folders.body,
      teamMembers.body,
      thread.body,
      messageTags.body,
      categories.body,
      categoryCounts.body,
      messageCategories.body,
      internalNotes.body,
      cannedResponses.body,
      signatures.body,
      signature.body,
      remoteAllowlist.body,
      readReceipts.body,
      threadEdges.body,
      threadAliases.body,
      threadAliasWarnings.body,
    ].map((body) => JSON.stringify(body)).join('\n');
    expect(serializedBodies).not.toContain('source-row-leak');
    expect(serializedBodies).not.toContain('sqlite-import-run-id');
    expect(serializedBodies).not.toContain('/data/attachments');
  });

  test('server mail metadata routes validate auth, IDs, filters, and missing ports', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unauthorized = await api.handle({ method: 'GET', path: '/api/v1/email/folders' });
    expect(unauthorized.status).toBe(401);

    const invalidFolderId = await api.handle({
      method: 'GET',
      path: '/api/v1/email/folders/nope',
      principal,
    });
    expect(invalidFolderId.status).toBe(400);
    expect((invalidFolderId.body as any).error.code).toBe('invalid_email_folder_id');

    const invalidMessageScopedId = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/nope/tags',
      principal,
    });
    expect(invalidMessageScopedId.status).toBe(400);
    expect((invalidMessageScopedId.body as any).error.code).toBe('invalid_email_message_id');

    const invalidThreadFilter = await api.handle({
      method: 'GET',
      path: '/api/v1/email/threads',
      query: { hasUnread: 'yes' },
      principal,
    });
    expect(invalidThreadFilter.status).toBe(400);
    expect((invalidThreadFilter.body as any).error.code).toBe('invalid_has_unread');

    const invalidAccountFilter = await api.handle({
      method: 'GET',
      path: '/api/v1/email/folders',
      query: { accountId: '-1' },
      principal,
    });
    expect(invalidAccountFilter.status).toBe(400);
    expect((invalidAccountFilter.body as any).error.code).toBe('invalid_account_id');

    const invalidLimit = await api.handle({
      method: 'GET',
      path: '/api/v1/email/canned-responses',
      query: { limit: '101' },
      principal,
    });
    expect(invalidLimit.status).toBe(400);
    expect((invalidLimit.body as any).error.code).toBe('invalid_limit');

    const invalidThreadAliasWarningLimit = await api.handle({
      method: 'GET',
      path: '/api/v1/email/thread-alias-warnings',
      query: { limit: '101' },
      principal,
    });
    expect(invalidThreadAliasWarningLimit.status).toBe(400);
    expect((invalidThreadAliasWarningLimit.body as any).error.code).toBe('invalid_limit');

    const unavailableThreadAliasWarnings = await api.handle({
      method: 'GET',
      path: '/api/v1/email/thread-alias-warnings',
      principal,
    });
    expect(unavailableThreadAliasWarnings.status).toBe(503);
    expect((unavailableThreadAliasWarnings.body as any).error.code).toBe('email_thread_alias_warnings_unavailable');

    const unavailable = await api.handle({
      method: 'GET',
      path: '/api/v1/email/folders',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('email_folders_unavailable');

    const unavailableCategoryCounts = await api.handle({
      method: 'GET',
      path: '/api/v1/email/category-counts',
      principal,
    });
    expect(unavailableCategoryCounts.status).toBe(503);
    expect((unavailableCategoryCounts.body as any).error.code).toBe('email_message_categories_unavailable');
  });

  test('server email message tag delete route resolves legacy message/tag inputs', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const tagListCalls: unknown[] = [];
    const tagDeleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailMessageTags: {
        async list(input) {
          tagListCalls.push(input);
          return {
            items: [{
              ...makeEmailMessageTagRecord(65),
              sourceSqliteId: -65,
              messageId: 11,
              messageSourceSqliteId: 110,
              tag: 'Priority',
            }],
            nextCursor: null,
          };
        },
        async get() {
          return null;
        },
        async delete(input) {
          tagDeleteCalls.push(input);
          return input.id === 65
            ? {
              ...makeEmailMessageTagRecord(65),
              sourceSqliteId: -65,
              messageId: 11,
              messageSourceSqliteId: 110,
              tag: 'Priority',
            }
            : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const response = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/messages/11/tags',
      query: { tag: ' Priority ' },
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data.deleted).toBe(true);
    expect((response.body as any).data.tag.tag).toBe('Priority');
    expect(tagListCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 1,
      messageId: 11,
      tag: 'Priority',
    }]);
    expect(tagDeleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 65,
    }]);
    expect(auditEvents.map((event) => event.action)).toEqual(['email_message_tag.deleted']);
    expect(events.map((event) => [event.type, event.entityType, event.entityId])).toEqual([
      ['email_message_tag.deleted', 'email_message_tag', '65'],
    ]);
  });

  test('server email tag and category mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const tagCreateCalls: unknown[] = [];
    const tagDeleteCalls: unknown[] = [];
    const categoryCreateCalls: unknown[] = [];
    const categoryUpdateCalls: unknown[] = [];
    const categoryReorderCalls: unknown[] = [];
    const categoryDeleteCalls: unknown[] = [];
    const messageCategoryCreateCalls: unknown[] = [];
    const messageCategoryDeleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailMessageTags: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          tagCreateCalls.push(input);
          return {
            ok: true,
            tag: {
              ...makeEmailMessageTagRecord(65),
              sourceSqliteId: -65,
              messageId: input.values.messageId ?? 11,
              messageSourceSqliteId: 110,
              tag: input.values.tag ?? 'priority',
            },
          };
        },
        async delete(input) {
          tagDeleteCalls.push(input);
          return input.id === 65
            ? {
              ...makeEmailMessageTagRecord(65),
              sourceSqliteId: -65,
              messageSourceSqliteId: 110,
              tag: 'Priority',
            }
            : null;
        },
      },
      emailCategories: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          categoryCreateCalls.push(input);
          return {
            ok: true,
            category: {
              ...makeEmailCategoryRecord(66),
              sourceSqliteId: -66,
              parentId: input.values.parentId ?? null,
              parentSourceSqliteId: input.values.parentId === null || input.values.parentId === undefined ? null : 610,
              name: input.values.name ?? 'Support',
              sortOrder: input.values.sortOrder ?? 0,
            },
          };
        },
        async update(input) {
          categoryUpdateCalls.push(input);
          return input.id === 66
            ? {
              ok: true,
              category: {
                ...makeEmailCategoryRecord(66),
                sourceSqliteId: -66,
                parentId: input.values.parentId ?? null,
                parentSourceSqliteId: input.values.parentId === null || input.values.parentId === undefined ? null : 610,
                name: input.values.name ?? 'Support',
                sortOrder: input.values.sortOrder ?? 1,
              },
            }
            : null;
        },
        async reorder(input) {
          categoryReorderCalls.push(input);
          return {
            ok: true,
            categories: input.updates.map((update) => ({
              ...makeEmailCategoryRecord(update.id),
              sourceSqliteId: -update.id,
              parentId: update.parentId,
              parentSourceSqliteId: update.parentId === null ? null : -update.parentId,
              sortOrder: update.sortOrder,
            })),
          };
        },
        async delete(input) {
          categoryDeleteCalls.push(input);
          return input.id === 66
            ? {
              ...makeEmailCategoryRecord(66),
              sourceSqliteId: -66,
              name: 'VIP',
            }
            : null;
        },
      },
      emailMessageCategories: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          messageCategoryCreateCalls.push(input);
          return {
            ok: true,
            category: {
              ...makeEmailMessageCategoryRecord(67),
              sourceSqliteId: -67,
              messageId: input.values.messageId ?? 11,
              messageSourceSqliteId: 110,
              categoryId: input.values.categoryId ?? 66,
              categorySourceSqliteId: 660,
            },
          };
        },
        async delete(input) {
          messageCategoryDeleteCalls.push(input);
          return input.id === 67
            ? {
              ...makeEmailMessageCategoryRecord(67),
              sourceSqliteId: -67,
              messageSourceSqliteId: 110,
              categorySourceSqliteId: 660,
            }
            : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const tagCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/tags',
      body: { tag: ' Priority ' },
      principal,
    });
    expect(tagCreated.status).toBe(201);
    expect((tagCreated.body as any).data.tag).toBe('Priority');
    expect(tagCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        messageId: 11,
        tag: 'Priority',
      },
    }]);

    const tagDeleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/tags/65',
      principal,
    });
    expect(tagDeleted.status).toBe(200);
    expect((tagDeleted.body as any).data.deleted).toBe(true);

    const categoryCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/categories',
      body: { name: ' Support ', parentId: null, sortOrder: '2' },
      principal,
    });
    expect(categoryCreated.status).toBe(201);
    expect(categoryCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        name: 'Support',
        parentId: null,
        sortOrder: 2,
      },
    }]);

    const categoryUpdated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/categories/66',
      body: { name: ' VIP ', parentId: '61', sortOrder: 3 },
      principal,
    });
    expect(categoryUpdated.status).toBe(200);
    expect((categoryUpdated.body as any).data.parentId).toBe(61);
    expect(categoryUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 66,
      values: {
        name: 'VIP',
        parentId: 61,
        sortOrder: 3,
      },
    }]);

    const categoryReordered = await api.handle({
      method: 'POST',
      path: '/api/v1/email/categories/reorder',
      body: {
        updates: [
          { id: 66, parentId: null, sortOrder: 0 },
          { id: 67, parentId: 66, sortOrder: 1 },
        ],
      },
      principal,
    });
    expect(categoryReordered.status).toBe(200);
    expect((categoryReordered.body as any).data.success).toBe(true);
    expect(categoryReorderCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      updates: [
        { id: 66, parentId: null, sortOrder: 0 },
        { id: 67, parentId: 66, sortOrder: 1 },
      ],
    }]);

    const categoryDeleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/categories/66',
      principal,
    });
    expect(categoryDeleted.status).toBe(200);
    expect((categoryDeleted.body as any).data.category.name).toBe('VIP');

    const messageCategoryCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/categories',
      body: { categoryId: '66' },
      principal,
    });
    expect(messageCategoryCreated.status).toBe(201);
    expect(messageCategoryCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        messageId: 11,
        categoryId: 66,
      },
    }]);

    const messageCategoryDeleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/message-categories/67',
      principal,
    });
    expect(messageCategoryDeleted.status).toBe(200);
    expect((messageCategoryDeleted.body as any).data.deleted).toBe(true);
    expect(tagDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 65 }]);
    expect(categoryDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 66 }]);
    expect(messageCategoryDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 67 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'email_message_tag.created',
      'email_message_tag.deleted',
      'email_category.created',
      'email_category.updated',
      'email_category.updated',
      'email_category.updated',
      'email_category.deleted',
      'email_message_category.created',
      'email_message_category.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['email_message_tag.created', WORKSPACE_A_ID, 'email_message_tag', '65'],
      ['email_message_tag.deleted', WORKSPACE_A_ID, 'email_message_tag', '65'],
      ['email_category.created', WORKSPACE_A_ID, 'email_category', '66'],
      ['email_category.updated', WORKSPACE_A_ID, 'email_category', '66'],
      ['email_category.updated', WORKSPACE_A_ID, 'email_category', '66'],
      ['email_category.updated', WORKSPACE_A_ID, 'email_category', '67'],
      ['email_category.deleted', WORKSPACE_A_ID, 'email_category', '66'],
      ['email_message_category.created', WORKSPACE_A_ID, 'email_message_category', '67'],
      ['email_message_category.deleted', WORKSPACE_A_ID, 'email_message_category', '67'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 65,
      sourceSqliteId: -65,
      messageId: 11,
      messageSourceSqliteId: 110,
      tag: 'Priority',
    });
    expect(events[7].payload).toMatchObject({
      id: 67,
      sourceSqliteId: -67,
      messageId: 11,
      categoryId: 66,
      categorySourceSqliteId: 660,
    });
  });

  test('server email tag and category mutation routes reject unsafe payloads and invalid references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      emailMessageTags: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
      emailCategories: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
      emailMessageCategories: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      emailMessageTags: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          return input.values.tag === 'exists'
            ? { ok: false, code: 'tag_conflict' }
            : { ok: false, code: 'message_not_found' };
        },
        async delete() {
          return null;
        },
      },
      emailCategories: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          return input.values.parentId === 99
            ? { ok: false, code: 'parent_not_found' }
            : { ok: false, code: 'invalid_parent' };
        },
        async update(input) {
          if (input.values.parentId === 99) return { ok: false, code: 'invalid_parent' };
          return null;
        },
        async delete() {
          return null;
        },
      },
      emailMessageCategories: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.categoryId === 66) return { ok: false, code: 'category_not_found' };
          if (input.values.categoryId === 67) return { ok: false, code: 'category_conflict' };
          return { ok: false, code: 'message_not_found' };
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailableTag = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/tags',
      body: { tag: 'Priority' },
      principal,
    });
    expect(unavailableTag.status).toBe(503);
    expect((unavailableTag.body as any).error.code).toBe('email_message_tags_unavailable');

    const invalidTagPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/tags',
      body: [],
      principal,
    });
    expect(invalidTagPayload.status).toBe(400);
    expect((invalidTagPayload.body as any).error.code).toBe('invalid_email_tag_payload');

    const mismatchedTagMessage = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/tags',
      body: { messageId: 12, tag: 'Priority' },
      principal,
    });
    expect(mismatchedTagMessage.status).toBe(400);
    expect((mismatchedTagMessage.body as any).error.details.fields).toContainEqual({
      field: 'messageId',
      message: 'messageId muss mit der URL uebereinstimmen',
    });

    const conflictingTag = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/tags',
      body: { messageId: 11, tag: 'exists' },
      principal,
    });
    expect(conflictingTag.status).toBe(409);
    expect((conflictingTag.body as any).error.code).toBe('email_tag_conflict');

    const unsafeCategoryPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/categories',
      body: {
        workspaceId: WORKSPACE_B_ID,
        name: ' ',
        parentId: 0,
        sortOrder: -1,
      },
      principal,
    });
    expect(unsafeCategoryPayload.status).toBe(400);
    expect((unsafeCategoryPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'name', message: 'Feld darf nicht leer sein' },
      { field: 'parentId', message: 'parentId muss eine positive Ganzzahl sein' },
      { field: 'sortOrder', message: 'sortOrder muss mindestens 0 sein' },
    ]));

    const missingParent = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/categories',
      body: { name: 'VIP', parentId: 99 },
      principal,
    });
    expect(missingParent.status).toBe(404);
    expect((missingParent.body as any).error.code).toBe('email_category_parent_not_found');

    const invalidParentPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/categories/66',
      body: { parentId: 99 },
      principal,
    });
    expect(invalidParentPatch.status).toBe(400);
    expect((invalidParentPatch.body as any).error.code).toBe('invalid_email_category_parent');

    const emptyCategoryPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/categories/66',
      body: {},
      principal,
    });
    expect(emptyCategoryPatch.status).toBe(400);

    const missingMessageCategory = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/categories',
      body: { categoryId: 66 },
      principal,
    });
    expect(missingMessageCategory.status).toBe(404);
    expect((missingMessageCategory.body as any).error.code).toBe('email_category_not_found');

    const conflictingMessageCategory = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/categories',
      body: { categoryId: 67 },
      principal,
    });
    expect(conflictingMessageCategory.status).toBe(409);
    expect((conflictingMessageCategory.body as any).error.code).toBe('email_message_category_conflict');

    const missingDeletes = await Promise.all([
      writableApi.handle({ method: 'DELETE', path: '/api/v1/email/tags/65', principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/email/categories/66', principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/email/message-categories/67', principal }),
    ]);
    expect(missingDeletes.map((response) => response.status)).toEqual([404, 404, 404]);
  });

  test('server email canned response and remote allowlist mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const cannedCreateCalls: unknown[] = [];
    const cannedUpdateCalls: unknown[] = [];
    const cannedDeleteCalls: unknown[] = [];
    const allowlistCreateCalls: unknown[] = [];
    const allowlistUpdateCalls: unknown[] = [];
    const allowlistDeleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailCannedResponses: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          cannedCreateCalls.push(input);
          return {
            ...makeEmailCannedResponseRecord(70),
            sourceSqliteId: -70,
            title: input.values.title ?? 'Shipping update',
            body: input.values.body ?? 'Your order is on the way.',
            sortOrder: input.values.sortOrder ?? 0,
          };
        },
        async update(input) {
          cannedUpdateCalls.push(input);
          return input.id === 70
            ? {
              ...makeEmailCannedResponseRecord(70),
              sourceSqliteId: -70,
              title: input.values.title ?? 'Shipping update',
              body: input.values.body ?? 'Your order is on the way.',
              sortOrder: input.values.sortOrder ?? 1,
            }
            : null;
        },
        async delete(input) {
          cannedDeleteCalls.push(input);
          return input.id === 70
            ? {
              ...makeEmailCannedResponseRecord(70),
              sourceSqliteId: -70,
              title: 'Invoice update',
            }
            : null;
        },
      },
      emailRemoteContentAllowlist: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          allowlistCreateCalls.push(input);
          return {
            ok: true,
            entry: {
              ...makeEmailRemoteContentAllowlistRecord(72),
              sourceSqliteId: -72,
              scope: input.values.scope ?? 'domain',
              value: input.values.value ?? 'example.com',
            },
          };
        },
        async update(input) {
          allowlistUpdateCalls.push(input);
          return input.id === 72
            ? {
              ok: true,
              entry: {
                ...makeEmailRemoteContentAllowlistRecord(72),
                sourceSqliteId: -72,
                scope: input.values.scope ?? 'domain',
                value: input.values.value ?? 'example.com',
              },
            }
            : null;
        },
        async delete(input) {
          allowlistDeleteCalls.push(input);
          return input.id === 72
            ? {
              ...makeEmailRemoteContentAllowlistRecord(72),
              sourceSqliteId: -72,
              scope: 'domain',
              value: 'cdn.example.com',
            }
            : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const cannedCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/canned-responses',
      body: {
        title: ' Invoice update ',
        body: ' Payment received. ',
        sortOrder: '2',
      },
      principal,
    });
    expect(cannedCreated.status).toBe(201);
    expect(cannedCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        title: 'Invoice update',
        body: 'Payment received.',
        sortOrder: 2,
      },
    }]);

    const cannedUpdated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/canned-responses/70',
      body: { body: ' Updated canned body. ' },
      principal,
    });
    expect(cannedUpdated.status).toBe(200);
    expect((cannedUpdated.body as any).data.body).toBe('Updated canned body.');

    const cannedDeleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/canned-responses/70',
      principal,
    });
    expect(cannedDeleted.status).toBe(200);
    expect((cannedDeleted.body as any).data.deleted).toBe(true);
    expect(cannedUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 70,
      values: { body: 'Updated canned body.' },
    }]);
    expect(cannedDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 70 }]);

    const allowlistCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/remote-content-allowlist',
      body: { scope: ' domain ', value: ' cdn.example.com ' },
      principal,
    });
    expect(allowlistCreated.status).toBe(201);
    expect(allowlistCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        scope: 'domain',
        value: 'cdn.example.com',
      },
    }]);

    const allowlistUpdated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/remote-content-allowlist/72',
      body: { value: ' images.example.com ' },
      principal,
    });
    expect(allowlistUpdated.status).toBe(200);
    expect((allowlistUpdated.body as any).data.value).toBe('images.example.com');

    const allowlistDeleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/remote-content-allowlist/72',
      principal,
    });
    expect(allowlistDeleted.status).toBe(200);
    expect((allowlistDeleted.body as any).data.deleted).toBe(true);
    expect(allowlistUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 72,
      values: { value: 'images.example.com' },
    }]);
    expect(allowlistDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 72 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'email_canned_response.created',
      'email_canned_response.updated',
      'email_canned_response.deleted',
      'email_remote_content_allowlist.created',
      'email_remote_content_allowlist.updated',
      'email_remote_content_allowlist.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['email_canned_response.created', WORKSPACE_A_ID, 'email_canned_response', '70'],
      ['email_canned_response.updated', WORKSPACE_A_ID, 'email_canned_response', '70'],
      ['email_canned_response.deleted', WORKSPACE_A_ID, 'email_canned_response', '70'],
      ['email_remote_content_allowlist.created', WORKSPACE_A_ID, 'email_remote_content_allowlist', '72'],
      ['email_remote_content_allowlist.updated', WORKSPACE_A_ID, 'email_remote_content_allowlist', '72'],
      ['email_remote_content_allowlist.deleted', WORKSPACE_A_ID, 'email_remote_content_allowlist', '72'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 70,
      sourceSqliteId: -70,
      title: 'Invoice update',
      body: 'Payment received.',
      sortOrder: 2,
    });
    expect(events[3].payload).toMatchObject({
      id: 72,
      sourceSqliteId: -72,
      scope: 'domain',
      value: 'cdn.example.com',
    });
  });

  test('server email canned response and remote allowlist mutation routes reject unsafe payloads and conflicts', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      emailCannedResponses: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
      emailRemoteContentAllowlist: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      emailCannedResponses: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return makeEmailCannedResponseRecord(70);
        },
        async update() {
          return null;
        },
        async delete() {
          return null;
        },
      },
      emailRemoteContentAllowlist: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return { ok: false, code: 'allowlist_conflict' };
        },
        async update(input) {
          if (input.values.value === 'conflict.example.com') return { ok: false, code: 'allowlist_conflict' };
          return null;
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailableCanned = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/canned-responses',
      body: { title: 'Reply', body: 'Thanks' },
      principal,
    });
    expect(unavailableCanned.status).toBe(503);
    expect((unavailableCanned.body as any).error.code).toBe('email_canned_responses_unavailable');

    const invalidCannedPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/canned-responses',
      body: [],
      principal,
    });
    expect(invalidCannedPayload.status).toBe(400);
    expect((invalidCannedPayload.body as any).error.code).toBe('invalid_email_canned_response_payload');

    const emptyBodyCanned = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/canned-responses',
      body: {
        title: 'Draft',
        body: '',
      },
      principal,
    });
    expect(emptyBodyCanned.status).toBe(201);

    const unsafeCannedPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/canned-responses',
      body: {
        workspaceId: WORKSPACE_B_ID,
        title: ' ',
        body: ' ',
        sortOrder: -1,
      },
      principal,
    });
    expect(unsafeCannedPayload.status).toBe(400);
    expect((unsafeCannedPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'title', message: 'Feld darf nicht leer sein' },
      { field: 'sortOrder', message: 'sortOrder muss mindestens 0 sein' },
    ]));

    const emptyCannedPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/canned-responses/70',
      body: {},
      principal,
    });
    expect(emptyCannedPatch.status).toBe(400);

    const missingCannedWrite = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/email/canned-responses/70', body: { title: 'Reply' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/email/canned-responses/70', principal }),
    ]);
    expect(missingCannedWrite.map((response) => response.status)).toEqual([404, 404]);

    const invalidAllowlistPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/remote-content-allowlist',
      body: [],
      principal,
    });
    expect(invalidAllowlistPayload.status).toBe(400);
    expect((invalidAllowlistPayload.body as any).error.code).toBe('invalid_email_remote_content_allowlist_payload');

    const unsafeAllowlistPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/remote-content-allowlist',
      body: {
        workspaceId: WORKSPACE_B_ID,
        scope: ' ',
        value: ' ',
      },
      principal,
    });
    expect(unsafeAllowlistPayload.status).toBe(400);
    expect((unsafeAllowlistPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'scope', message: 'Feld darf nicht leer sein' },
      { field: 'value', message: 'Feld darf nicht leer sein' },
    ]));

    const conflictingAllowlistCreate = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/remote-content-allowlist',
      body: { scope: 'domain', value: 'example.com' },
      principal,
    });
    expect(conflictingAllowlistCreate.status).toBe(409);
    expect((conflictingAllowlistCreate.body as any).error.code).toBe('email_remote_content_allowlist_conflict');

    const conflictingAllowlistPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/remote-content-allowlist/72',
      body: { value: 'conflict.example.com' },
      principal,
    });
    expect(conflictingAllowlistPatch.status).toBe(409);

    const emptyAllowlistPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/remote-content-allowlist/72',
      body: {},
      principal,
    });
    expect(emptyAllowlistPatch.status).toBe(400);

    const missingAllowlistWrite = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/email/remote-content-allowlist/72', body: { value: 'images.example.com' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/email/remote-content-allowlist/72', principal }),
    ]);
    expect(missingAllowlistWrite.map((response) => response.status)).toEqual([404, 404]);
  });

  test('server email team member mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailTeamMembers: {
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
            member: {
              ...makeEmailTeamMemberRecord(input.values.id ?? 'agent-2'),
              displayName: input.values.displayName ?? 'Agent Two',
              role: input.values.role ?? 'agent',
              signatureHtml: input.values.signatureHtml ?? null,
              sortOrder: input.values.sortOrder ?? 0,
            },
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 'agent-2'
            ? {
              ...makeEmailTeamMemberRecord(input.id),
              displayName: input.values.displayName ?? 'Agent Two',
              role: input.values.role ?? 'agent',
              signatureHtml: input.values.signatureHtml === undefined ? '<p>Signature</p>' : input.values.signatureHtml,
              sortOrder: input.values.sortOrder ?? 1,
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 'agent-2' ? makeEmailTeamMemberRecord(input.id) : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/email/team-members',
      body: {
        id: ' agent-2 ',
        displayName: ' Agent Two ',
        role: ' manager ',
        signatureHtml: ' <p>Signature</p> ',
        sortOrder: '4',
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        id: 'agent-2',
        displayName: 'Agent Two',
        role: 'manager',
        signatureHtml: '<p>Signature</p>',
        sortOrder: 4,
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/team-members/agent-2',
      body: { signatureHtml: null, sortOrder: 5 },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.signatureHtml).toBeNull();
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 'agent-2',
      values: {
        signatureHtml: null,
        sortOrder: 5,
      },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/team-members/agent-2',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 'agent-2' }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'email_team_member.created',
      'email_team_member.updated',
      'email_team_member.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['email_team_member.created', WORKSPACE_A_ID, 'email_team_member', 'agent-2'],
      ['email_team_member.updated', WORKSPACE_A_ID, 'email_team_member', 'agent-2'],
      ['email_team_member.deleted', WORKSPACE_A_ID, 'email_team_member', 'agent-2'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 'agent-2',
      displayName: 'Agent Two',
      role: 'manager',
      signatureHtml: '<p>Signature</p>',
      sortOrder: 4,
    });
  });

  test('server email team member upsert route preserves legacy save semantics', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailTeamMembers: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          if (input.values.id === 'agent-existing') {
            return { ok: false, code: 'team_member_conflict' };
          }
          return {
            ok: true,
            member: {
              ...makeEmailTeamMemberRecord(input.values.id ?? 'agent-new'),
              displayName: input.values.displayName ?? 'Agent New',
              role: input.values.role ?? 'agent',
              signatureHtml: input.values.signatureHtml ?? null,
              sortOrder: input.values.sortOrder ?? 0,
            },
          };
        },
        async update(input) {
          updateCalls.push(input);
          return {
            ...makeEmailTeamMemberRecord(input.id),
            displayName: input.values.displayName ?? 'Agent Existing',
            role: input.values.role ?? 'agent',
            signatureHtml: input.values.signatureHtml === undefined ? '<p>Old</p>' : input.values.signatureHtml,
            sortOrder: input.values.sortOrder ?? 1,
          };
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/email/team-members/agent-new/upsert',
      body: {
        displayName: ' Agent New ',
        signatureHtml: ' <p>New</p> ',
        sortOrder: '2',
      },
      principal,
    });
    expect(created.status).toBe(201);

    const updated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/team-members/agent-existing/upsert',
      body: {
        displayName: ' Agent Existing ',
        role: ' manager ',
        signatureHtml: null,
      },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.signatureHtml).toBeNull();

    expect(createCalls).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        values: {
          id: 'agent-new',
          displayName: 'Agent New',
          signatureHtml: '<p>New</p>',
          sortOrder: 2,
        },
      },
      {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        values: {
          id: 'agent-existing',
          displayName: 'Agent Existing',
          role: 'manager',
          signatureHtml: null,
        },
      },
    ]);
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 'agent-existing',
      values: {
        displayName: 'Agent Existing',
        role: 'manager',
        signatureHtml: null,
      },
    }]);
    expect(auditEvents.map((event) => event.action)).toEqual([
      'email_team_member.created',
      'email_team_member.updated',
    ]);
    expect(events.map((event) => [event.type, event.entityId])).toEqual([
      ['email_team_member.created', 'agent-new'],
      ['email_team_member.updated', 'agent-existing'],
    ]);
  });

  test('server email team member mutation routes reject unsafe payloads and conflicts', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      emailTeamMembers: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      emailTeamMembers: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return { ok: false, code: 'team_member_conflict' };
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
      path: '/api/v1/email/team-members',
      body: { id: 'agent-2', displayName: 'Agent Two' },
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('email_team_members_unavailable');

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/team-members',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_email_team_member_payload');

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/team-members',
      body: {
        workspaceId: WORKSPACE_B_ID,
        id: ' ',
        displayName: ' ',
        role: ' ',
        signatureHtml: 123,
        sortOrder: -1,
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'id', message: 'Feld darf nicht leer sein' },
      { field: 'displayName', message: 'Feld darf nicht leer sein' },
      { field: 'role', message: 'Feld darf nicht leer sein' },
      { field: 'signatureHtml', message: 'signatureHtml muss ein String oder null sein' },
      { field: 'sortOrder', message: 'sortOrder muss mindestens 0 sein' },
    ]));

    const conflict = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/team-members',
      body: { id: 'agent-2', displayName: 'Agent Two' },
      principal,
    });
    expect(conflict.status).toBe(409);
    expect((conflict.body as any).error.code).toBe('email_team_member_conflict');

    const forbiddenIdPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/team-members/agent-2',
      body: { id: 'agent-3', displayName: 'Agent Three' },
      principal,
    });
    expect(forbiddenIdPatch.status).toBe(400);
    expect((forbiddenIdPatch.body as any).error.details.fields).toContainEqual({
      field: 'id',
      message: 'Feld ist nicht erlaubt',
    });

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/team-members/agent-2',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const missingWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/email/team-members/agent-2', body: { displayName: 'Agent Two' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/email/team-members/agent-2', principal }),
    ]);
    expect(missingWrites.map((response) => response.status)).toEqual([404, 404]);
  });

  test('server email thread edge and alias mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const edgeCreateCalls: unknown[] = [];
    const edgeDeleteCalls: unknown[] = [];
    const aliasCreateCalls: unknown[] = [];
    const aliasUpdateCalls: unknown[] = [];
    const aliasDeleteCalls: unknown[] = [];
    const aliasMergeCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailThreadEdges: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          edgeCreateCalls.push(input);
          return {
            ok: true,
            edge: {
              ...makeEmailThreadEdgeRecord(76),
              sourceSqliteId: -76,
              parentMessageId: input.values.parentMessageId ?? 10,
              childMessageId: input.values.childMessageId ?? 11,
              parentMessageSourceSqliteId: 100,
              childMessageSourceSqliteId: 110,
            },
          };
        },
        async delete(input) {
          edgeDeleteCalls.push(input);
          return input.id === 76
            ? {
              ...makeEmailThreadEdgeRecord(76),
              sourceSqliteId: -76,
              parentMessageSourceSqliteId: 100,
              childMessageSourceSqliteId: 110,
            }
            : null;
        },
      },
      emailThreadAliases: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          aliasCreateCalls.push(input);
          return {
            ok: true,
            alias: {
              ...makeEmailThreadAliasRecord(77),
              sourceSqliteId: -77,
              aliasThreadId: input.values.aliasThreadId ?? 'thread-alias',
              canonicalThreadId: input.values.canonicalThreadId ?? 'thread-canonical',
              confidence: input.values.confidence ?? 'high',
              source: input.values.source ?? 'manual',
            },
          };
        },
        async update(input) {
          aliasUpdateCalls.push(input);
          return input.id === 77
            ? {
              ok: true,
              alias: {
                ...makeEmailThreadAliasRecord(77),
                sourceSqliteId: -77,
                aliasThreadId: input.values.aliasThreadId ?? 'thread-alias',
                canonicalThreadId: input.values.canonicalThreadId ?? 'thread-root',
                confidence: input.values.confidence ?? 'medium',
                source: input.values.source ?? 'manual',
              },
            }
            : null;
        },
        async delete(input) {
          aliasDeleteCalls.push(input);
          return input.id === 77
            ? {
              ...makeEmailThreadAliasRecord(77),
              sourceSqliteId: -77,
              aliasThreadId: 'thread-alias',
              canonicalThreadId: 'thread-root',
            }
            : null;
        },
        async merge(input) {
          aliasMergeCalls.push(input);
          return {
            ok: true,
            alias: {
              ...makeEmailThreadAliasRecord(78),
              sourceSqliteId: -78,
              aliasThreadId: input.aliasThreadId,
              canonicalThreadId: input.canonicalThreadId,
              confidence: 'high',
              source: 'manual_merge',
            },
            movedMessageCount: 2,
            orphanThreadDeleted: true,
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const edgeCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/thread-edges',
      body: {
        parentMessageId: '10',
        childMessageId: 11,
      },
      principal,
    });
    expect(edgeCreated.status).toBe(201);
    expect(edgeCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        parentMessageId: 10,
        childMessageId: 11,
      },
    }]);

    const edgeDeleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/thread-edges/76',
      principal,
    });
    expect(edgeDeleted.status).toBe(200);
    expect((edgeDeleted.body as any).data.deleted).toBe(true);
    expect(edgeDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 76 }]);

    const aliasCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/thread-aliases',
      body: {
        aliasThreadId: ' thread-alias ',
        canonicalThreadId: ' thread-root ',
        confidence: ' medium ',
        source: ' manual ',
      },
      principal,
    });
    expect(aliasCreated.status).toBe(201);
    expect(aliasCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        aliasThreadId: 'thread-alias',
        canonicalThreadId: 'thread-root',
        confidence: 'medium',
        source: 'manual',
      },
    }]);

    const aliasUpdated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/thread-aliases/77',
      body: { confidence: ' low ' },
      principal,
    });
    expect(aliasUpdated.status).toBe(200);
    expect((aliasUpdated.body as any).data.confidence).toBe('low');
    expect(aliasUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 77,
      values: { confidence: 'low' },
    }]);

    const aliasDeleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/thread-aliases/77',
      principal,
    });
    expect(aliasDeleted.status).toBe(200);
    expect((aliasDeleted.body as any).data.deleted).toBe(true);
    expect(aliasDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 77 }]);

    const aliasMerged = await api.handle({
      method: 'POST',
      path: '/api/v1/email/threads/merge',
      body: {
        aliasThreadId: ' thread-alias ',
        canonicalThreadId: ' thread-canonical ',
        accountId: '1',
      },
      principal,
    });
    expect(aliasMerged.status).toBe(200);
    expect((aliasMerged.body as any).data).toMatchObject({
      success: true,
      movedMessageCount: 2,
      orphanThreadDeleted: true,
      threadAlias: {
        id: 78,
        aliasThreadId: 'thread-alias',
        canonicalThreadId: 'thread-canonical',
        confidence: 'high',
        source: 'manual_merge',
      },
    });
    expect(aliasMergeCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      aliasThreadId: 'thread-alias',
      canonicalThreadId: 'thread-canonical',
      accountId: 1,
    }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'email_thread_edge.created',
      'email_thread_edge.deleted',
      'email_thread_alias.created',
      'email_thread_alias.updated',
      'email_thread_alias.deleted',
      'email_thread_alias.updated',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['email_thread_edge.created', WORKSPACE_A_ID, 'email_thread_edge', '76'],
      ['email_thread_edge.deleted', WORKSPACE_A_ID, 'email_thread_edge', '76'],
      ['email_thread_alias.created', WORKSPACE_A_ID, 'email_thread_alias', '77'],
      ['email_thread_alias.updated', WORKSPACE_A_ID, 'email_thread_alias', '77'],
      ['email_thread_alias.deleted', WORKSPACE_A_ID, 'email_thread_alias', '77'],
      ['email_thread_alias.updated', WORKSPACE_A_ID, 'email_thread_alias', '78'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 76,
      sourceSqliteId: -76,
      parentMessageId: 10,
      childMessageId: 11,
      parentMessageSourceSqliteId: 100,
      childMessageSourceSqliteId: 110,
    });
    expect(events[2].payload).toMatchObject({
      id: 77,
      sourceSqliteId: -77,
      aliasThreadId: 'thread-alias',
      canonicalThreadId: 'thread-root',
      confidence: 'medium',
      source: 'manual',
    });
  });

  test('server email thread split route writes audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const splitCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailThreads: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async splitMessage(input) {
          splitCalls.push(input);
          return {
            ok: true,
            threadId: 'th-split',
            ticketCode: 'SCR-ABC123',
            previousThreadId: 'thread-root',
            thread: {
              ...makeEmailThreadRecord('th-split'),
              ticketCode: 'SCR-ABC123',
              messageCount: 1,
              rootMessageId: input.messageId,
              rootMessageSourceSqliteId: 110,
            },
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const split = await api.handle({
      method: 'POST',
      path: '/api/v1/email/threads/split-message',
      body: { messageId: '11' },
      principal,
    });
    expect(split.status).toBe(200);
    expect((split.body as any).data).toMatchObject({
      success: true,
      threadId: 'th-split',
      ticketCode: 'SCR-ABC123',
      previousThreadId: 'thread-root',
      thread: {
        id: 'th-split',
        ticketCode: 'SCR-ABC123',
        messageCount: 1,
      },
    });
    expect(splitCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 11,
    }]);
    expect(auditEvents.map((event) => event.action)).toEqual(['email_thread.updated']);
    expect(auditEvents[0]?.metadata).toMatchObject({
      id: 'th-split',
      ticketCode: 'SCR-ABC123',
      messageId: 11,
      previousThreadId: 'thread-root',
      operation: 'split_message_thread',
    });
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['email_thread.updated', WORKSPACE_A_ID, 'email_thread', 'th-split'],
      ['email_message.updated', WORKSPACE_A_ID, 'email_message', '11'],
    ]);
    expect(events[1].payload).toMatchObject({
      messageId: 11,
      threadId: 'th-split',
      ticketCode: 'SCR-ABC123',
    });
  });

  test('server email thread edge and alias mutation routes reject unsafe payloads and invalid references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      emailThreadEdges: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
      emailThreadAliases: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      emailThreadEdges: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.parentMessageId === 99) return { ok: false, code: 'parent_message_not_found' };
          if (input.values.childMessageId === 98) return { ok: false, code: 'child_message_not_found' };
          if (input.values.parentMessageId === 10 && input.values.childMessageId === 11) return { ok: false, code: 'edge_conflict' };
          return { ok: false, code: 'invalid_edge' };
        },
        async delete() {
          return null;
        },
      },
      emailThreadAliases: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.aliasThreadId === input.values.canonicalThreadId) return { ok: false, code: 'invalid_alias' };
          return { ok: false, code: 'alias_conflict' };
        },
        async update(input) {
          if (input.values.aliasThreadId === 'same-thread') return { ok: false, code: 'invalid_alias' };
          if (input.values.canonicalThreadId === 'thread-existing') return { ok: false, code: 'alias_conflict' };
          return null;
        },
        async delete() {
          return null;
        },
        async merge(input) {
          if (input.accountId === 99) return { ok: false, code: 'account_not_found' };
          if (input.aliasThreadId === 'cycle-a') return { ok: false, code: 'alias_cycle' };
          return { ok: false, code: 'invalid_alias' };
        },
      },
      emailThreads: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async splitMessage(input) {
          if (input.messageId === 99) return { ok: false, code: 'message_not_found' };
          return { ok: false, code: 'message_not_found' };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailableEdge = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/thread-edges',
      body: { parentMessageId: 10, childMessageId: 11 },
      principal,
    });
    expect(unavailableEdge.status).toBe(503);
    expect((unavailableEdge.body as any).error.code).toBe('email_thread_edges_unavailable');

    const invalidEdgePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/thread-edges',
      body: [],
      principal,
    });
    expect(invalidEdgePayload.status).toBe(400);
    expect((invalidEdgePayload.body as any).error.code).toBe('invalid_email_thread_edge_payload');

    const unsafeEdgePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/thread-edges',
      body: {
        workspaceId: WORKSPACE_B_ID,
        parentMessageId: 0,
        childMessageId: 'nope',
      },
      principal,
    });
    expect(unsafeEdgePayload.status).toBe(400);
    expect((unsafeEdgePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'parentMessageId', message: 'parentMessageId muss eine positive Ganzzahl sein' },
      { field: 'childMessageId', message: 'childMessageId muss eine positive Ganzzahl sein' },
    ]));

    const selfEdge = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/thread-edges',
      body: { parentMessageId: 10, childMessageId: 10 },
      principal,
    });
    expect(selfEdge.status).toBe(400);
    expect((selfEdge.body as any).error.code).toBe('invalid_email_thread_edge');

    const missingParent = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/thread-edges',
      body: { parentMessageId: 99, childMessageId: 11 },
      principal,
    });
    expect(missingParent.status).toBe(404);
    expect((missingParent.body as any).error.code).toBe('email_parent_message_not_found');

    const missingChild = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/thread-edges',
      body: { parentMessageId: 10, childMessageId: 98 },
      principal,
    });
    expect(missingChild.status).toBe(404);
    expect((missingChild.body as any).error.code).toBe('email_child_message_not_found');

    const conflictingEdge = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/thread-edges',
      body: { parentMessageId: 10, childMessageId: 11 },
      principal,
    });
    expect(conflictingEdge.status).toBe(409);
    expect((conflictingEdge.body as any).error.code).toBe('email_thread_edge_conflict');

    const unavailableAlias = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/thread-aliases',
      body: { aliasThreadId: 'thread-a', canonicalThreadId: 'thread-b' },
      principal,
    });
    expect(unavailableAlias.status).toBe(503);
    expect((unavailableAlias.body as any).error.code).toBe('email_thread_aliases_unavailable');

    const unavailableMerge = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/merge',
      body: { aliasThreadId: 'thread-a', canonicalThreadId: 'thread-b', accountId: 1 },
      principal,
    });
    expect(unavailableMerge.status).toBe(503);
    expect((unavailableMerge.body as any).error.code).toBe('email_thread_merge_unavailable');

    const unavailableSplit = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/split-message',
      body: { messageId: 11 },
      principal,
    });
    expect(unavailableSplit.status).toBe(503);
    expect((unavailableSplit.body as any).error.code).toBe('email_thread_split_unavailable');

    const unsafeAliasPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/thread-aliases',
      body: {
        workspaceId: WORKSPACE_B_ID,
        aliasThreadId: ' ',
        canonicalThreadId: ' ',
        confidence: ' ',
        source: ' ',
      },
      principal,
    });
    expect(unsafeAliasPayload.status).toBe(400);
    expect((unsafeAliasPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'aliasThreadId', message: 'Feld darf nicht leer sein' },
      { field: 'canonicalThreadId', message: 'Feld darf nicht leer sein' },
      { field: 'confidence', message: 'Feld darf nicht leer sein' },
      { field: 'source', message: 'Feld darf nicht leer sein' },
    ]));

    const sameAlias = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/thread-aliases',
      body: { aliasThreadId: 'same-thread', canonicalThreadId: 'same-thread' },
      principal,
    });
    expect(sameAlias.status).toBe(400);
    expect((sameAlias.body as any).error.code).toBe('invalid_email_thread_alias');

    const invalidMergePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/merge',
      body: [],
      principal,
    });
    expect(invalidMergePayload.status).toBe(400);
    expect((invalidMergePayload.body as any).error.code).toBe('invalid_email_thread_merge_payload');

    const unsafeMergePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/merge',
      body: {
        workspaceId: WORKSPACE_B_ID,
        aliasThreadId: ' ',
        canonicalThreadId: ' ',
        accountId: 0,
      },
      principal,
    });
    expect(unsafeMergePayload.status).toBe(400);
    expect((unsafeMergePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'aliasThreadId', message: 'Feld darf nicht leer sein' },
      { field: 'canonicalThreadId', message: 'Feld darf nicht leer sein' },
      { field: 'accountId', message: 'accountId muss eine positive Ganzzahl sein' },
    ]));

    const invalidSplitPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/split-message',
      body: [],
      principal,
    });
    expect(invalidSplitPayload.status).toBe(400);
    expect((invalidSplitPayload.body as any).error.code).toBe('invalid_email_thread_split_payload');

    const unsafeSplitPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/split-message',
      body: {
        workspaceId: WORKSPACE_B_ID,
        messageId: 0,
      },
      principal,
    });
    expect(unsafeSplitPayload.status).toBe(400);
    expect((unsafeSplitPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'messageId', message: 'messageId muss eine positive Ganzzahl sein' },
    ]));

    const sameMerge = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/merge',
      body: { aliasThreadId: 'same-thread', canonicalThreadId: 'same-thread', accountId: 1 },
      principal,
    });
    expect(sameMerge.status).toBe(400);
    expect((sameMerge.body as any).error.code).toBe('invalid_email_thread_alias');

    const mergeMissingAccount = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/merge',
      body: { aliasThreadId: 'thread-a', canonicalThreadId: 'thread-b', accountId: 99 },
      principal,
    });
    expect(mergeMissingAccount.status).toBe(404);
    expect((mergeMissingAccount.body as any).error.code).toBe('email_account_not_found');

    const mergeCycle = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/merge',
      body: { aliasThreadId: 'cycle-a', canonicalThreadId: 'cycle-b', accountId: 1 },
      principal,
    });
    expect(mergeCycle.status).toBe(400);
    expect((mergeCycle.body as any).error.code).toBe('email_thread_alias_cycle');

    const splitMissingMessage = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/threads/split-message',
      body: { messageId: 99 },
      principal,
    });
    expect(splitMissingMessage.status).toBe(404);
    expect((splitMissingMessage.body as any).error.code).toBe('email_message_not_found');

    const conflictingAlias = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/thread-aliases',
      body: { aliasThreadId: 'thread-a', canonicalThreadId: 'thread-b' },
      principal,
    });
    expect(conflictingAlias.status).toBe(409);
    expect((conflictingAlias.body as any).error.code).toBe('email_thread_alias_conflict');

    const emptyAliasPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/thread-aliases/77',
      body: {},
      principal,
    });
    expect(emptyAliasPatch.status).toBe(400);

    const invalidAliasPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/thread-aliases/77',
      body: { aliasThreadId: 'same-thread' },
      principal,
    });
    expect(invalidAliasPatch.status).toBe(400);

    const conflictingAliasPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/thread-aliases/77',
      body: { canonicalThreadId: 'thread-existing' },
      principal,
    });
    expect(conflictingAliasPatch.status).toBe(409);

    const missingDeletes = await Promise.all([
      writableApi.handle({ method: 'DELETE', path: '/api/v1/email/thread-edges/76', principal }),
      writableApi.handle({ method: 'PATCH', path: '/api/v1/email/thread-aliases/77', body: { confidence: 'low' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/email/thread-aliases/77', principal }),
    ]);
    expect(missingDeletes.map((response) => response.status)).toEqual([404, 404, 404]);
  });

  test('server email account signature and read receipt mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const signatureCreateCalls: unknown[] = [];
    const signatureUpdateCalls: unknown[] = [];
    const signatureDeleteCalls: unknown[] = [];
    const receiptCreateCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailAccountSignatures: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          signatureCreateCalls.push(input);
          return {
            ok: true,
            signature: {
              ...makeEmailAccountSignatureRecord(-71),
              accountId: input.values.accountId ?? 1,
              accountSourceSqliteId: 100,
              signatureHtml: input.values.signatureHtml ?? null,
            },
          };
        },
        async update(input) {
          signatureUpdateCalls.push(input);
          return input.id === -71
            ? {
              ok: true,
              signature: {
                ...makeEmailAccountSignatureRecord(-71),
                accountId: input.values.accountId ?? 1,
                accountSourceSqliteId: 100,
                signatureHtml: input.values.signatureHtml === undefined ? '<p>Mailbox signature</p>' : input.values.signatureHtml,
              },
            }
            : null;
        },
        async delete(input) {
          signatureDeleteCalls.push(input);
          return input.id === -71 ? makeEmailAccountSignatureRecord(-71) : null;
        },
      },
      emailReadReceipts: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          receiptCreateCalls.push(input);
          return {
            ok: true,
            receipt: {
              ...makeEmailReadReceiptRecord(78),
              sourceSqliteId: -78,
              messageId: input.values.messageId ?? 11,
              messageSourceSqliteId: 110,
              direction: input.values.direction ?? 'outbound',
              recipient: input.values.recipient ?? null,
              at: input.values.at ?? '2026-07-03T08:00:00.000Z',
            },
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const signatureCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/account-signatures',
      body: {
        accountId: '1',
        signatureHtml: ' <p>Signature</p> ',
      },
      principal,
    });
    expect(signatureCreated.status).toBe(201);
    expect(signatureCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 1,
        signatureHtml: '<p>Signature</p>',
      },
    }]);

    const signatureUpdated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/account-signatures/-71',
      body: { signatureHtml: null },
      principal,
    });
    expect(signatureUpdated.status).toBe(200);
    expect((signatureUpdated.body as any).data.signatureHtml).toBeNull();
    expect(signatureUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: -71,
      values: { signatureHtml: null },
    }]);

    const signatureDeleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/account-signatures/-71',
      principal,
    });
    expect(signatureDeleted.status).toBe(200);
    expect((signatureDeleted.body as any).data.deleted).toBe(true);
    expect(signatureDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: -71 }]);

    const receiptCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/read-receipts',
      body: {
        messageId: '11',
        direction: ' outbound ',
        recipient: ' customer@example.com ',
        at: '2026-07-03T08:00:00.000Z',
      },
      principal,
    });
    expect(receiptCreated.status).toBe(201);
    expect(receiptCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        messageId: 11,
        direction: 'outbound',
        recipient: 'customer@example.com',
        at: '2026-07-03T08:00:00.000Z',
      },
    }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'email_account_signature.created',
      'email_account_signature.updated',
      'email_account_signature.deleted',
      'email_read_receipt.created',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['email_account_signature.created', WORKSPACE_A_ID, 'email_account_signature', '-71'],
      ['email_account_signature.updated', WORKSPACE_A_ID, 'email_account_signature', '-71'],
      ['email_account_signature.deleted', WORKSPACE_A_ID, 'email_account_signature', '-71'],
      ['email_read_receipt.created', WORKSPACE_A_ID, 'email_read_receipt', '78'],
    ]);
    expect(events[0].payload).toMatchObject({
      sourceSqliteId: -71,
      accountSourceSqliteId: 100,
      accountId: 1,
      signatureHtml: '<p>Signature</p>',
    });
    expect(events[3].payload).toMatchObject({
      id: 78,
      sourceSqliteId: -78,
      messageSourceSqliteId: 110,
      messageId: 11,
      direction: 'outbound',
      recipient: 'customer@example.com',
      at: '2026-07-03T08:00:00.000Z',
    });
  });

  test('server email read receipt response route logs declines and delegates sends', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const receiptCreateCalls: unknown[] = [];
    const responderCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailReadReceipts: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          receiptCreateCalls.push(input);
          return {
            ok: true,
            receipt: {
              ...makeEmailReadReceiptRecord(78),
              sourceSqliteId: -78,
              messageId: input.values.messageId ?? 11,
              messageSourceSqliteId: 110,
              direction: input.values.direction ?? 'declined',
              recipient: input.values.recipient ?? null,
              at: input.values.at ?? '2026-07-03T08:00:00.000Z',
            },
          };
        },
      },
      emailReadReceiptResponder: {
        async send(input) {
          responderCalls.push(input);
          return input.messageId === 12
            ? { success: false, error: 'SMTP fehlt' }
            : {
              success: true,
              receipt: {
                ...makeEmailReadReceiptRecord(79),
                sourceSqliteId: -79,
                messageId: input.messageId,
                messageSourceSqliteId: 110,
                direction: 'sent_back',
                recipient: 'sender@example.com',
                at: '2026-07-03T08:05:00.000Z',
              },
            };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const declined = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/read-receipt-response',
      body: { action: 'decline' },
      principal,
    });
    expect(declined.status).toBe(200);
    expect((declined.body as any).data).toEqual({ success: true });
    expect(receiptCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        messageId: 11,
        direction: 'declined',
      },
    }]);
    expect(auditEvents.map((event) => event.action)).toEqual(['email_read_receipt.created']);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['email_read_receipt.created', WORKSPACE_A_ID, 'email_read_receipt', '78'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 78,
      sourceSqliteId: -78,
      messageSourceSqliteId: 110,
      messageId: 11,
      direction: 'declined',
    });

    const sent = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/read-receipt-response',
      body: { action: 'send' },
      principal,
    });
    expect(sent.status).toBe(200);
    expect((sent.body as any).data).toEqual({ success: true });
    expect(auditEvents.map((event) => event.action)).toEqual([
      'email_read_receipt.created',
      'email_read_receipt.created',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['email_read_receipt.created', WORKSPACE_A_ID, 'email_read_receipt', '78'],
      ['email_read_receipt.created', WORKSPACE_A_ID, 'email_read_receipt', '79'],
    ]);
    expect(events[1].payload).toMatchObject({
      id: 79,
      sourceSqliteId: -79,
      messageSourceSqliteId: 110,
      messageId: 11,
      direction: 'sent_back',
      recipient: 'sender@example.com',
    });

    const sendFailed = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/12/read-receipt-response',
      body: { action: 'send' },
      principal,
    });
    expect(sendFailed.status).toBe(200);
    expect((sendFailed.body as any).data).toEqual({ success: false, error: 'SMTP fehlt' });
    expect(responderCalls).toEqual([
      { workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, messageId: 11 },
      { workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, messageId: 12 },
    ]);
  });

  test('server email read receipt response route rejects unsafe payloads and missing ports', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts());
    const missingMessageApi = createServerApi(makeServerApiPorts({
      emailReadReceipts: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return { ok: false, code: 'message_not_found' };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailableDecline = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/read-receipt-response',
      body: { action: 'decline' },
      principal,
    });
    expect(unavailableDecline.status).toBe(503);
    expect((unavailableDecline.body as any).error.code).toBe('email_read_receipts_unavailable');

    const unavailableSend = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/read-receipt-response',
      body: { action: 'send' },
      principal,
    });
    expect(unavailableSend.status).toBe(503);
    expect((unavailableSend.body as any).error.code).toBe('email_read_receipt_responder_unavailable');

    const invalidPayload = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/read-receipt-response',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_email_read_receipt_response_payload');

    const unsafePayload = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/read-receipt-response',
      body: { workspaceId: WORKSPACE_B_ID, action: 'archive' },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'action', message: 'action muss send oder decline sein' },
    ]));

    const missingMessage = await missingMessageApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/read-receipt-response',
      body: { action: 'decline' },
      principal,
    });
    expect(missingMessage.status).toBe(404);
    expect((missingMessage.body as any).error.code).toBe('email_message_not_found');
  });

  test('server email account signature upsert route preserves legacy save semantics', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const signatureListCalls: unknown[] = [];
    const signatureCreateCalls: unknown[] = [];
    const signatureUpdateCalls: unknown[] = [];
    const signatureDeleteCalls: unknown[] = [];
    let existingSignature: EmailAccountSignatureRecord | null = null;
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailAccountSignatures: {
        async list(input) {
          signatureListCalls.push(input);
          return { items: existingSignature ? [existingSignature] : [], nextCursor: null };
        },
        async get() {
          return existingSignature;
        },
        async create(input) {
          signatureCreateCalls.push(input);
          existingSignature = {
            ...makeEmailAccountSignatureRecord(-71),
            accountSourceSqliteId: input.values.accountId ?? 1,
            accountId: 101,
            signatureHtml: input.values.signatureHtml ?? null,
          };
          return { ok: true, signature: existingSignature };
        },
        async update(input) {
          signatureUpdateCalls.push(input);
          if (!existingSignature || input.id !== existingSignature.sourceSqliteId) return null;
          existingSignature = {
            ...existingSignature,
            signatureHtml: input.values.signatureHtml === undefined
              ? existingSignature.signatureHtml
              : input.values.signatureHtml,
          };
          return { ok: true, signature: existingSignature };
        },
        async delete(input) {
          signatureDeleteCalls.push(input);
          if (!existingSignature || input.id !== existingSignature.sourceSqliteId) return null;
          const deleted = existingSignature;
          existingSignature = null;
          return deleted;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/email/account-signatures/by-account/1/upsert',
      body: { signatureHtml: ' <p>Created</p> ' },
      principal,
    });
    const updated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/account-signatures/by-account/1/upsert',
      body: { signatureHtml: '<p>Updated</p>' },
      principal,
    });
    const cleared = await api.handle({
      method: 'POST',
      path: '/api/v1/email/account-signatures/by-account/1/upsert',
      body: { signatureHtml: null },
      principal,
    });
    const clearedAgain = await api.handle({
      method: 'POST',
      path: '/api/v1/email/account-signatures/by-account/1/upsert',
      body: { signatureHtml: '   ' },
      principal,
    });

    expect([created.status, updated.status, cleared.status, clearedAgain.status]).toEqual([201, 200, 200, 200]);
    expect((created.body as any).data.signatureHtml).toBe('<p>Created</p>');
    expect((updated.body as any).data.signatureHtml).toBe('<p>Updated</p>');
    expect((cleared.body as any).data.deleted).toBe(true);
    expect((clearedAgain.body as any).data.deleted).toBe(false);
    expect(signatureListCalls).toEqual([
      { workspaceId: WORKSPACE_A_ID, limit: 1, accountId: 1 },
      { workspaceId: WORKSPACE_A_ID, limit: 1, accountId: 1 },
      { workspaceId: WORKSPACE_A_ID, limit: 1, accountId: 1 },
      { workspaceId: WORKSPACE_A_ID, limit: 1, accountId: 1 },
    ]);
    expect(signatureCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: { accountId: 1, signatureHtml: '<p>Created</p>' },
    }]);
    expect(signatureUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: -71,
      values: { signatureHtml: '<p>Updated</p>' },
    }]);
    expect(signatureDeleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: -71,
    }]);
    expect(auditEvents.map((event) => event.action)).toEqual([
      'email_account_signature.created',
      'email_account_signature.updated',
      'email_account_signature.deleted',
    ]);
    expect(events.map((event) => event.type)).toEqual([
      'email_account_signature.created',
      'email_account_signature.updated',
      'email_account_signature.deleted',
    ]);
  });

  test('server email account signature and read receipt mutation routes reject unsafe payloads and invalid references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      emailAccountSignatures: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
      emailReadReceipts: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      emailAccountSignatures: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.accountId === 99) return { ok: false, code: 'account_not_found' };
          return { ok: false, code: 'signature_conflict' };
        },
        async update(input) {
          if (input.values.accountId === 99) return { ok: false, code: 'account_not_found' };
          if (input.values.accountId === 2) return { ok: false, code: 'signature_conflict' };
          return null;
        },
        async delete() {
          return null;
        },
      },
      emailReadReceipts: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return { ok: false, code: 'message_not_found' };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailableSignature = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/account-signatures',
      body: { accountId: 1 },
      principal,
    });
    expect(unavailableSignature.status).toBe(503);
    expect((unavailableSignature.body as any).error.code).toBe('email_account_signatures_unavailable');

    const invalidSignaturePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/account-signatures',
      body: [],
      principal,
    });
    expect(invalidSignaturePayload.status).toBe(400);
    expect((invalidSignaturePayload.body as any).error.code).toBe('invalid_email_account_signature_payload');

    const unsafeSignaturePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/account-signatures',
      body: {
        workspaceId: WORKSPACE_B_ID,
        accountId: 0,
        signatureHtml: 123,
      },
      principal,
    });
    expect(unsafeSignaturePayload.status).toBe(400);
    expect((unsafeSignaturePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'accountId', message: 'accountId muss eine positive Ganzzahl sein' },
      { field: 'signatureHtml', message: 'signatureHtml muss ein String oder null sein' },
    ]));

    const missingAccount = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/account-signatures',
      body: { accountId: 99 },
      principal,
    });
    expect(missingAccount.status).toBe(404);
    expect((missingAccount.body as any).error.code).toBe('email_account_not_found');

    const conflictingSignature = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/account-signatures',
      body: { accountId: 1 },
      principal,
    });
    expect(conflictingSignature.status).toBe(409);
    expect((conflictingSignature.body as any).error.code).toBe('email_account_signature_conflict');

    const emptySignaturePatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/account-signatures/71',
      body: {},
      principal,
    });
    expect(emptySignaturePatch.status).toBe(400);

    const conflictingSignaturePatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/account-signatures/71',
      body: { accountId: 2 },
      principal,
    });
    expect(conflictingSignaturePatch.status).toBe(409);

    const missingSignatureWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/email/account-signatures/71', body: { signatureHtml: '<p>Sig</p>' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/email/account-signatures/71', principal }),
    ]);
    expect(missingSignatureWrites.map((response) => response.status)).toEqual([404, 404]);

    const unavailableReceipt = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/email/read-receipts',
      body: { messageId: 11, direction: 'outbound' },
      principal,
    });
    expect(unavailableReceipt.status).toBe(503);
    expect((unavailableReceipt.body as any).error.code).toBe('email_read_receipts_unavailable');

    const invalidReceiptPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/read-receipts',
      body: [],
      principal,
    });
    expect(invalidReceiptPayload.status).toBe(400);
    expect((invalidReceiptPayload.body as any).error.code).toBe('invalid_email_read_receipt_payload');

    const unsafeReceiptPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/read-receipts',
      body: {
        workspaceId: WORKSPACE_B_ID,
        messageId: 0,
        direction: ' ',
        recipient: 123,
        at: 'not-a-date',
      },
      principal,
    });
    expect(unsafeReceiptPayload.status).toBe(400);
    expect((unsafeReceiptPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'messageId', message: 'messageId muss eine positive Ganzzahl sein' },
      { field: 'direction', message: 'Feld darf nicht leer sein' },
      { field: 'recipient', message: 'recipient muss ein String oder null sein' },
      { field: 'at', message: 'at muss ein valides Datum sein' },
    ]));

    const missingMessage = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/read-receipts',
      body: { messageId: 11, direction: 'outbound' },
      principal,
    });
    expect(missingMessage.status).toBe(404);
    expect((missingMessage.body as any).error.code).toBe('email_message_not_found');
  });

});
