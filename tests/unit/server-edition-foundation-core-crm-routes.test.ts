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

describe('server edition foundation — core-crm-routes', () => {
  test('server core CRM read routes pass validated product, deal, and task filters to ports', async () => {
    const productCalls: unknown[] = [];
    const dealCalls: unknown[] = [];
    const taskCalls: unknown[] = [];
    const ports = makeServerApiPorts({
      products: {
        async list(input) {
          productCalls.push(input);
          return { items: [makeProductRecord(3)], nextCursor: null };
        },
        async get(input) {
          return input.id === 3 ? makeProductRecord(3) : null;
        },
      },
      deals: {
        async list(input) {
          dealCalls.push(input);
          return { items: [makeDealRecord(4)], nextCursor: 4 };
        },
        async get(input) {
          return input.id === 4 ? makeDealRecord(4) : null;
        },
      },
      tasks: {
        async list(input) {
          taskCalls.push(input);
          return { items: [makeTaskRecord(5)], nextCursor: null };
        },
        async get(input) {
          return input.id === 5 ? makeTaskRecord(5) : null;
        },
      },
    });
    const api = createServerApi(ports);
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const products = await api.handle({
      method: 'GET',
      path: '/api/v1/products',
      query: { search: ' Widget ', limit: '10' },
      principal,
    });
    expect(products.status).toBe(200);
    expect((products.body as any).data.items[0].sku).toBe('SKU-3');
    expect(productCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 10, search: 'Widget' }]);

    const deals = await api.handle({
      method: 'GET',
      path: '/api/v1/deals',
      query: { search: ' Renewal ', stage: 'Won', customerId: '7', cursor: '2', limit: '20' },
      principal,
    });
    expect(deals.status).toBe(200);
    expect((deals.body as any).data.nextCursor).toBe(4);
    expect(dealCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 20,
      cursor: 2,
      search: 'Renewal',
      stage: 'Won',
      customerId: 7,
    }]);

    const tasks = await api.handle({
      method: 'GET',
      path: '/api/v1/tasks',
      query: { search: ' Call ', customerId: '7', completed: 'false' },
      principal,
    });
    expect(tasks.status).toBe(200);
    expect((tasks.body as any).data.items[0].title).toBe('Task 5');
    expect(taskCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      search: 'Call',
      customerId: 7,
      completed: false,
      viewer: { userId: 'user-a', role: 'user' },
    }]);

    const product = await api.handle({
      method: 'GET',
      path: '/api/v1/products/3',
      principal,
    });
    expect(product.status).toBe(200);
    const missingDeal = await api.handle({
      method: 'GET',
      path: '/api/v1/deals/99',
      principal,
    });
    expect(missingDeal.status).toBe(404);
  });

  test('server core CRM read routes validate auth, IDs, filters, and missing ports', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unauthorized = await api.handle({ method: 'GET', path: '/api/v1/products' });
    expect(unauthorized.status).toBe(401);

    const invalidProductId = await api.handle({
      method: 'GET',
      path: '/api/v1/products/nope',
      principal,
    });
    expect(invalidProductId.status).toBe(400);
    expect((invalidProductId.body as any).error.code).toBe('invalid_product_id');

    const invalidCompleted = await api.handle({
      method: 'GET',
      path: '/api/v1/tasks',
      query: { completed: 'yes' },
      principal,
    });
    expect(invalidCompleted.status).toBe(400);
    expect((invalidCompleted.body as any).error.code).toBe('invalid_completed');

    const invalidStage = await api.handle({
      method: 'GET',
      path: '/api/v1/deals',
      query: { stage: 'x'.repeat(101) },
      principal,
    });
    expect(invalidStage.status).toBe(400);

    const unavailable = await api.handle({
      method: 'GET',
      path: '/api/v1/products',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('products_unavailable');
  });

  test('server product mutation routes validate payloads, use principal workspace, and audit changes', async () => {
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      products: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          return {
            ...makeProductRecord(31),
            sourceSqliteId: -31,
            name: input.values.name ?? 'Product 31',
            price: input.values.price ?? '0.00',
            isActive: input.values.isActive ?? true,
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 31
            ? {
              ...makeProductRecord(31),
              price: input.values.price ?? '31.00',
              isActive: input.values.isActive ?? true,
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 31 ? makeProductRecord(31) : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/products',
      body: {
        name: ' Widget Pro ',
        sku: ' W-PRO ',
        price: 19.9,
        isActive: false,
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect((created.body as any).data).toMatchObject({
      id: 31,
      sourceSqliteId: -31,
      name: 'Widget Pro',
      price: '19.90',
      isActive: false,
    });
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        name: 'Widget Pro',
        sku: 'W-PRO',
        price: '19.90',
        isActive: false,
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/products/31',
      body: {
        description: ' ',
        price: '20.50',
        isActive: true,
      },
      principal,
    });
    expect(updated.status).toBe(200);
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 31,
      values: {
        description: null,
        price: '20.50',
        isActive: true,
      },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/products/31',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 31,
    }]);
    expect(auditEvents.map((event) => event.action)).toEqual([
      'product.created',
      'product.updated',
      'product.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['product.created', WORKSPACE_A_ID, 'product', '31'],
      ['product.updated', WORKSPACE_A_ID, 'product', '31'],
      ['product.deleted', WORKSPACE_A_ID, 'product', '31'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 31,
      sourceSqliteId: -31,
      sku: 'SKU-31',
      name: 'Widget Pro',
      price: '19.90',
      isActive: false,
    });
    expect(auditEvents[1]).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      entityType: 'product',
      entityId: '31',
      metadata: {
        fields: ['description', 'isActive', 'price'],
      },
    });
  });

  test('server product mutation routes reject unsafe payloads and missing write ports', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      products: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      products: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          throw new Error('must not be called for invalid payload');
        },
        async update() {
          throw new Error('must not be called for invalid payload');
        },
        async delete() {
          throw new Error('must not be called for invalid payload');
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/products',
      body: { name: 'Widget' },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidBody = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/products',
      body: null,
      principal,
    });
    expect(invalidBody.status).toBe(400);
    expect((invalidBody.body as any).error.code).toBe('invalid_product_payload');

    const missingName = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/products',
      body: { price: '10.00' },
      principal,
    });
    expect(missingName.status).toBe(400);

    const unsafeFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/products',
      body: {
        name: 'Widget',
        price: '10.001',
        workspaceId: WORKSPACE_B_ID,
      },
      principal,
    });
    expect(unsafeFields.status).toBe(400);
    expect((unsafeFields.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'price', message: 'price muss ein Dezimalwert mit maximal zwei Nachkommastellen sein' },
    ]));

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/products/31',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);
  });

  test('server deal and task mutation routes use principal workspace and publish audit/events', async () => {
    const dealCreateCalls: unknown[] = [];
    const dealUpdateCalls: unknown[] = [];
    const dealDeleteCalls: unknown[] = [];
    const taskCreateCalls: unknown[] = [];
    const taskUpdateCalls: unknown[] = [];
    const taskDeleteCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      deals: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          dealCreateCalls.push(input);
          return {
            ok: true,
            deal: {
              ...makeDealRecord(41),
              sourceSqliteId: -41,
              customerId: input.values.customerId ?? null,
              name: input.values.name ?? 'Deal 41',
              value: input.values.value ?? '0.00',
              stage: input.values.stage ?? 'New',
              expectedCloseDate: input.values.expectedCloseDate ?? null,
            },
          };
        },
        async update(input) {
          dealUpdateCalls.push(input);
          return input.id === 41
            ? {
              ok: true,
              deal: {
                ...makeDealRecord(41),
                stage: input.values.stage ?? 'Won',
                notes: input.values.notes ?? 'notes',
              },
            }
            : null;
        },
        async delete(input) {
          dealDeleteCalls.push(input);
          return input.id === 41 ? makeDealRecord(41) : null;
        },
      },
      tasks: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          taskCreateCalls.push(input);
          return {
            ok: true,
            task: {
              ...makeTaskRecord(51),
              sourceSqliteId: -51,
              customerId: input.values.customerId ?? null,
              title: input.values.title ?? 'Task 51',
              dueDate: input.values.dueDate ?? null,
              priority: input.values.priority ?? 'Medium',
              completed: input.values.completed ?? false,
            },
          };
        },
        async update(input) {
          taskUpdateCalls.push(input);
          return input.id === 51
            ? {
              ok: true,
              task: {
                ...makeTaskRecord(51),
                completed: input.values.completed ?? false,
                snoozedUntil: input.values.snoozedUntil ?? null,
              },
            }
            : null;
        },
        async delete(input) {
          taskDeleteCalls.push(input);
          return input.id === 51 ? makeTaskRecord(51) : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };
    const closeDate = new Date('2026-07-01').toISOString();
    const dueDate = new Date('2026-07-02T10:30:00.000Z').toISOString();

    const createdDeal = await api.handle({
      method: 'POST',
      path: '/api/v1/deals',
      body: {
        customerId: 7,
        name: ' Renewal ',
        value: 123.4,
        valueCalculationMethod: 'static',
        stage: ' Angebot ',
        expectedCloseDate: '2026-07-01',
      },
      principal,
    });
    expect(createdDeal.status).toBe(201);
    expect(dealCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        customerId: 7,
        name: 'Renewal',
        value: '123.40',
        valueCalculationMethod: 'static',
        stage: 'Angebot',
        expectedCloseDate: closeDate,
      },
    }]);

    const updatedDeal = await api.handle({
      method: 'PATCH',
      path: '/api/v1/deals/41',
      body: {
        customerId: '7',
        stage: ' Won ',
        notes: ' ',
      },
      principal,
    });
    expect(updatedDeal.status).toBe(200);
    expect(dealUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 41,
      values: {
        customerId: 7,
        stage: 'Won',
        notes: null,
      },
    }]);

    const updatedDealStage = await api.handle({
      method: 'POST',
      path: '/api/v1/deals/41/stage',
      body: { stage: ' Qualified ' },
      principal,
    });
    expect(updatedDealStage.status).toBe(200);
    expect((updatedDealStage.body as any).data.stage).toBe('Qualified');
    expect(dealUpdateCalls).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        id: 41,
        values: {
          customerId: 7,
          stage: 'Won',
          notes: null,
        },
      },
      {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        id: 41,
        values: {
          stage: 'Qualified',
        },
      },
    ]);

    const deletedDeal = await api.handle({
      method: 'DELETE',
      path: '/api/v1/deals/41',
      principal,
    });
    expect(deletedDeal.status).toBe(200);
    expect(dealDeleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 41,
    }]);

    const createdTask = await api.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: {
        customerId: 7,
        title: ' Follow up ',
        dueDate: '2026-07-02T10:30:00.000Z',
        priority: ' High ',
        completed: false,
      },
      principal,
    });
    expect(createdTask.status).toBe(201);
    expect(taskCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        customerId: 7,
        title: 'Follow up',
        dueDate,
        priority: 'High',
        completed: false,
      },
    }]);

    const updatedTask = await api.handle({
      method: 'PATCH',
      path: '/api/v1/tasks/51',
      body: {
        completed: true,
        snoozedUntil: null,
      },
      principal,
    });
    expect(updatedTask.status).toBe(200);
    expect(taskUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 51,
      values: {
        completed: true,
        snoozedUntil: null,
      },
      viewer: { userId: USER_A_ID, role: 'user' },
    }]);

    const toggledTask = await api.handle({
      method: 'POST',
      path: '/api/v1/tasks/51/toggle',
      body: { completed: false },
      principal,
    });
    expect(toggledTask.status).toBe(200);
    expect((toggledTask.body as any).data.completed).toBe(false);
    expect(taskUpdateCalls).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        id: 51,
        values: {
          completed: true,
          snoozedUntil: null,
        },
        viewer: { userId: USER_A_ID, role: 'user' },
      },
      {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        id: 51,
        values: {
          completed: false,
        },
        viewer: { userId: USER_A_ID, role: 'user' },
      },
    ]);

    const deletedTask = await api.handle({
      method: 'DELETE',
      path: '/api/v1/tasks/51',
      principal,
    });
    expect(deletedTask.status).toBe(200);
    expect(taskDeleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 51,
      viewer: { userId: USER_A_ID, role: 'user' },
    }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'deal.created',
      'deal.updated',
      'deal.updated',
      'deal.deleted',
      'task.created',
      'task.updated',
      'task.updated',
      'task.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['deal.created', WORKSPACE_A_ID, 'deal', '41'],
      ['deal.updated', WORKSPACE_A_ID, 'deal', '41'],
      ['deal.updated', WORKSPACE_A_ID, 'deal', '41'],
      ['deal.deleted', WORKSPACE_A_ID, 'deal', '41'],
      ['task.created', WORKSPACE_A_ID, 'task', '51'],
      ['task.updated', WORKSPACE_A_ID, 'task', '51'],
      ['task.updated', WORKSPACE_A_ID, 'task', '51'],
      ['task.deleted', WORKSPACE_A_ID, 'task', '51'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 41,
      sourceSqliteId: -41,
      customerId: 7,
      name: 'Renewal',
      value: '123.40',
      stage: 'Angebot',
    });
    expect(events[2].payload).toMatchObject({
      id: 41,
      stage: 'Qualified',
    });
    expect(events[4].payload).toMatchObject({
      id: 51,
      sourceSqliteId: -51,
      customerId: 7,
      title: 'Follow up',
      priority: 'High',
      completed: false,
      dueDate,
    });
  });

  test('server deal and task mutation routes reject unsafe payloads and missing customer references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      deals: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
      tasks: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      deals: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return { ok: false, code: 'customer_not_found' };
        },
        async update() {
          return { ok: false, code: 'customer_not_found' };
        },
        async delete() {
          return null;
        },
      },
      tasks: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return { ok: false, code: 'customer_not_found' };
        },
        async update() {
          return { ok: false, code: 'customer_not_found' };
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const dealUnavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/deals',
      body: { customerId: 7, name: 'Renewal' },
      principal,
    });
    expect(dealUnavailable.status).toBe(503);

    const taskUnavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: { customerId: 7, title: 'Follow up' },
      principal,
    });
    expect(taskUnavailable.status).toBe(503);

    const invalidDealBody = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/deals',
      body: [],
      principal,
    });
    expect(invalidDealBody.status).toBe(400);
    expect((invalidDealBody.body as any).error.code).toBe('invalid_deal_payload');

    const invalidTaskBody = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: null,
      principal,
    });
    expect(invalidTaskBody.status).toBe(400);
    expect((invalidTaskBody.body as any).error.code).toBe('invalid_task_payload');

    const missingDealCustomer = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/deals',
      body: { name: 'Renewal' },
      principal,
    });
    expect(missingDealCustomer.status).toBe(400);

    const invalidDealFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/deals',
      body: {
        customerId: 7,
        name: 'Renewal',
        value: '10.001',
        workspaceId: WORKSPACE_B_ID,
      },
      principal,
    });
    expect(invalidDealFields.status).toBe(400);
    expect((invalidDealFields.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'value', message: 'value muss ein Dezimalwert mit maximal zwei Nachkommastellen sein' },
    ]));

    const invalidDealStageRoute = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/deals/41/stage',
      body: {
        newStage: 'Won',
      },
      principal,
    });
    expect(invalidDealStageRoute.status).toBe(400);
    expect((invalidDealStageRoute.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'newStage', message: 'Feld ist nicht erlaubt' },
      { field: 'stage', message: 'stage ist erforderlich' },
    ]));

    const invalidTaskFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/tasks',
      body: {
        customerId: 7,
        title: 'Follow up',
        completed: 'yes',
        dueDate: 'not-a-date',
      },
      principal,
    });
    expect(invalidTaskFields.status).toBe(400);
    expect((invalidTaskFields.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'completed', message: 'Feld muss ein Boolean sein' },
      { field: 'dueDate', message: 'dueDate muss ein gueltiger ISO-Zeitpunkt oder ein Datum sein' },
    ]));

    const invalidTaskToggleRoute = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/tasks/51/toggle',
      body: {},
      principal,
    });
    expect(invalidTaskToggleRoute.status).toBe(400);
    expect((invalidTaskToggleRoute.body as any).error.details.fields).toEqual([
      { field: 'completed', message: 'completed (boolean) ist erforderlich' },
    ]);

    const missingCustomer = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/deals',
      body: { customerId: 7, name: 'Renewal' },
      principal,
    });
    expect(missingCustomer.status).toBe(404);
    expect((missingCustomer.body as any).error.code).toBe('customer_not_found');

    const emptyTaskPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/tasks/51',
      body: {},
      principal,
    });
    expect(emptyTaskPatch.status).toBe(400);
  });

  test('server calendar event mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      calendarEvents: {
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
            event: {
              ...makeCalendarEventRecord(61),
              sourceSqliteId: -61,
              title: input.values.title ?? 'Calendar 61',
              description: input.values.description ?? null,
              startDate: input.values.startDate ?? '2026-07-03T08:00:00.000Z',
              endDate: input.values.endDate ?? '2026-07-03T09:00:00.000Z',
              allDay: input.values.allDay ?? false,
              colorCode: input.values.colorCode ?? null,
              eventType: input.values.eventType ?? null,
              recurrenceRule: input.values.recurrenceRule ?? null,
              taskSourceSqliteId: input.values.taskId === null ? null : 510,
              taskId: input.values.taskId ?? null,
            },
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 61
            ? {
              ok: true,
              event: {
                ...makeCalendarEventRecord(61),
                title: input.values.title ?? 'Demo event 61',
                colorCode: input.values.colorCode ?? null,
                taskSourceSqliteId: input.values.taskId === null ? null : 510,
                taskId: input.values.taskId ?? 10,
              },
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 61 ? makeCalendarEventRecord(61) : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/calendar-events',
      body: {
        title: ' Planning ',
        description: ' Review call ',
        startDate: '2026-07-03T08:00:00.000Z',
        endDate: '2026-07-03T09:00:00.000Z',
        allDay: true,
        colorCode: ' #224466 ',
        eventType: ' meeting ',
        recurrenceRule: ' RRULE:FREQ=DAILY ',
        taskId: '51',
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        title: 'Planning',
        description: 'Review call',
        startDate: '2026-07-03T08:00:00.000Z',
        endDate: '2026-07-03T09:00:00.000Z',
        allDay: true,
        colorCode: '#224466',
        eventType: 'meeting',
        recurrenceRule: 'RRULE:FREQ=DAILY',
        taskId: 51,
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/calendar-events/61',
      body: {
        title: ' Updated planning ',
        colorCode: ' ',
        taskId: null,
      },
      principal,
    });
    expect(updated.status).toBe(200);
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 61,
      values: {
        title: 'Updated planning',
        colorCode: null,
        taskId: null,
      },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/calendar-events/61',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 61,
    }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'calendar_event.created',
      'calendar_event.updated',
      'calendar_event.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['calendar_event.created', WORKSPACE_A_ID, 'calendar_event', '61'],
      ['calendar_event.updated', WORKSPACE_A_ID, 'calendar_event', '61'],
      ['calendar_event.deleted', WORKSPACE_A_ID, 'calendar_event', '61'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 61,
      sourceSqliteId: -61,
      title: 'Planning',
      startDate: '2026-07-03T08:00:00.000Z',
      endDate: '2026-07-03T09:00:00.000Z',
      allDay: true,
      eventType: 'meeting',
      taskId: 51,
    });
  });

  test('server calendar event mutation routes reject unsafe payloads and invalid references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      calendarEvents: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      calendarEvents: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return { ok: false, code: 'task_not_found' };
        },
        async update(input) {
          if (input.values.startDate !== undefined) return { ok: false, code: 'invalid_date_range' };
          return { ok: false, code: 'task_not_found' };
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/calendar-events',
      body: {
        title: 'Planning',
        startDate: '2026-07-03T08:00:00.000Z',
        endDate: '2026-07-03T09:00:00.000Z',
      },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidBody = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/calendar-events',
      body: [],
      principal,
    });
    expect(invalidBody.status).toBe(400);
    expect((invalidBody.body as any).error.code).toBe('invalid_calendar_event_payload');

    const missingRequiredFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/calendar-events',
      body: { title: 'Planning', startDate: '2026-07-03T08:00:00.000Z' },
      principal,
    });
    expect(missingRequiredFields.status).toBe(400);
    expect((missingRequiredFields.body as any).error.code).toBe('validation_error');

    const invalidFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/calendar-events',
      body: {
        title: 'Planning',
        startDate: '2026-07-03T10:00:00.000Z',
        endDate: '2026-07-03T09:00:00.000Z',
        allDay: 'false',
        workspaceId: WORKSPACE_B_ID,
      },
      principal,
    });
    expect(invalidFields.status).toBe(400);
    expect((invalidFields.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'allDay', message: 'Feld muss ein Boolean sein' },
      { field: 'endDate', message: 'endDate darf nicht vor startDate liegen' },
    ]));

    const missingTask = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/calendar-events',
      body: {
        title: 'Planning',
        startDate: '2026-07-03T08:00:00.000Z',
        endDate: '2026-07-03T09:00:00.000Z',
        taskId: 51,
      },
      principal,
    });
    expect(missingTask.status).toBe(404);
    expect((missingTask.body as any).error.code).toBe('task_not_found');

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/calendar-events/61',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const invalidRangePatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/calendar-events/61',
      body: { startDate: '2026-07-04T08:00:00.000Z' },
      principal,
    });
    expect(invalidRangePatch.status).toBe(400);
    expect((invalidRangePatch.body as any).error.code).toBe('invalid_date_range');

    const missingDelete = await writableApi.handle({
      method: 'DELETE',
      path: '/api/v1/calendar-events/61',
      principal,
    });
    expect(missingDelete.status).toBe(404);
    expect((missingDelete.body as any).error.code).toBe('calendar_event_not_found');
  });

  test('server custom field mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const fieldCreateCalls: unknown[] = [];
    const fieldUpdateCalls: unknown[] = [];
    const fieldDeleteCalls: unknown[] = [];
    const valueCreateCalls: unknown[] = [];
    const valueUpdateCalls: unknown[] = [];
    const valueDeleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      customerCustomFields: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          fieldCreateCalls.push(input);
          return {
            ok: true,
            field: {
              ...makeCustomerCustomFieldRecord(61),
              sourceSqliteId: -61,
              name: input.values.name ?? 'field_61',
              label: input.values.label ?? 'Field 61',
              type: input.values.type ?? 'text',
              required: input.values.required ?? false,
              options: input.values.options ?? null,
              defaultValue: input.values.defaultValue ?? null,
              placeholder: input.values.placeholder ?? null,
              description: input.values.description ?? null,
              displayOrder: input.values.displayOrder ?? 0,
              active: input.values.active ?? true,
            },
          };
        },
        async update(input) {
          fieldUpdateCalls.push(input);
          return input.id === 61
            ? {
              ok: true,
              field: {
                ...makeCustomerCustomFieldRecord(61),
                label: input.values.label ?? 'VAT ID',
                active: input.values.active ?? true,
              },
            }
            : null;
        },
        async delete(input) {
          fieldDeleteCalls.push(input);
          return input.id === 61 ? makeCustomerCustomFieldRecord(61) : null;
        },
      },
      customerCustomFieldValues: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          valueCreateCalls.push(input);
          return {
            ok: true,
            value: {
              ...makeCustomerCustomFieldValueRecord(62),
              sourceSqliteId: -62,
              customerId: input.values.customerId ?? null,
              fieldId: input.values.fieldId ?? null,
              value: input.values.value ?? null,
            },
          };
        },
        async update(input) {
          valueUpdateCalls.push(input);
          return input.id === 62
            ? {
              ok: true,
              value: {
                ...makeCustomerCustomFieldValueRecord(62),
                customerId: input.values.customerId ?? 7,
                fieldId: input.values.fieldId ?? 61,
                value: input.values.value ?? null,
              },
            }
            : null;
        },
        async delete(input) {
          valueDeleteCalls.push(input);
          return input.id === 62 ? makeCustomerCustomFieldValueRecord(62) : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const createdField = await api.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-fields',
      body: {
        name: ' vat_id ',
        label: ' VAT ID ',
        type: ' select ',
        required: true,
        options: [{ value: 'de', label: 'Germany' }],
        defaultValue: ' ',
        placeholder: ' DE... ',
        description: ' Tax id ',
        displayOrder: '3',
        active: true,
      },
      principal,
    });
    expect(createdField.status).toBe(201);
    expect(fieldCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        name: 'vat_id',
        label: 'VAT ID',
        type: 'select',
        required: true,
        options: [{ value: 'de', label: 'Germany' }],
        defaultValue: null,
        placeholder: 'DE...',
        description: 'Tax id',
        displayOrder: 3,
        active: true,
      },
    }]);

    const updatedField = await api.handle({
      method: 'PATCH',
      path: '/api/v1/customer-custom-fields/61',
      body: { label: ' VAT number ', active: false },
      principal,
    });
    expect(updatedField.status).toBe(200);
    expect(fieldUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 61,
      values: {
        label: 'VAT number',
        active: false,
      },
    }]);

    const deletedField = await api.handle({
      method: 'DELETE',
      path: '/api/v1/customer-custom-fields/61',
      principal,
    });
    expect(deletedField.status).toBe(200);
    expect((deletedField.body as any).data.deleted).toBe(true);
    expect(fieldDeleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 61,
    }]);

    const createdValue = await api.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-field-values',
      body: {
        customerId: '7',
        fieldId: 61,
        value: { selected: 'de' },
      },
      principal,
    });
    expect(createdValue.status).toBe(201);
    expect(valueCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        customerId: 7,
        fieldId: 61,
        value: '{"selected":"de"}',
      },
    }]);

    const updatedValue = await api.handle({
      method: 'PATCH',
      path: '/api/v1/customer-custom-field-values/62',
      body: { value: false },
      principal,
    });
    expect(updatedValue.status).toBe(200);
    expect(valueUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 62,
      values: {
        value: 'false',
      },
    }]);

    const deletedValue = await api.handle({
      method: 'DELETE',
      path: '/api/v1/customer-custom-field-values/62',
      principal,
    });
    expect(deletedValue.status).toBe(200);
    expect((deletedValue.body as any).data.deleted).toBe(true);
    expect(valueDeleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 62,
    }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'custom_field.created',
      'custom_field.updated',
      'custom_field.deleted',
      'custom_field_value.created',
      'custom_field_value.updated',
      'custom_field_value.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['custom_field.created', WORKSPACE_A_ID, 'custom_field', '61'],
      ['custom_field.updated', WORKSPACE_A_ID, 'custom_field', '61'],
      ['custom_field.deleted', WORKSPACE_A_ID, 'custom_field', '61'],
      ['custom_field_value.created', WORKSPACE_A_ID, 'custom_field_value', '62'],
      ['custom_field_value.updated', WORKSPACE_A_ID, 'custom_field_value', '62'],
      ['custom_field_value.deleted', WORKSPACE_A_ID, 'custom_field_value', '62'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 61,
      sourceSqliteId: -61,
      name: 'vat_id',
      label: 'VAT ID',
      type: 'select',
      active: true,
    });
    expect(events[3].payload).toMatchObject({
      id: 62,
      sourceSqliteId: -62,
      customerId: 7,
      fieldId: 61,
      value: '{"selected":"de"}',
    });
  });

  test('server custom field mutation routes reject unsafe payloads, duplicates, and invalid references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      customerCustomFields: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
      customerCustomFieldValues: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      customerCustomFields: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return { ok: false, code: 'duplicate_name' };
        },
        async update() {
          return { ok: false, code: 'duplicate_name' };
        },
        async delete() {
          return null;
        },
      },
      customerCustomFieldValues: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.customerId === 77) return { ok: false, code: 'customer_not_found' };
          if (input.values.fieldId === 99) return { ok: false, code: 'custom_field_not_found' };
          return { ok: false, code: 'value_conflict' };
        },
        async update(input) {
          if (input.values.customerId === 77) return { ok: false, code: 'customer_not_found' };
          if (input.values.fieldId === 99) return { ok: false, code: 'custom_field_not_found' };
          return { ok: false, code: 'value_conflict' };
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const fieldUnavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-fields',
      body: { name: 'vat_id', label: 'VAT ID', type: 'text' },
      principal,
    });
    expect(fieldUnavailable.status).toBe(503);

    const valueUnavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-field-values',
      body: { customerId: 7, fieldId: 61, value: 'DE123456789' },
      principal,
    });
    expect(valueUnavailable.status).toBe(503);

    const invalidFieldBody = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-fields',
      body: null,
      principal,
    });
    expect(invalidFieldBody.status).toBe(400);
    expect((invalidFieldBody.body as any).error.code).toBe('invalid_customer_custom_field_payload');

    const invalidValueBody = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-field-values',
      body: [],
      principal,
    });
    expect(invalidValueBody.status).toBe(400);
    expect((invalidValueBody.body as any).error.code).toBe('invalid_customer_custom_field_value_payload');

    const missingFieldRequired = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-fields',
      body: { name: 'vat_id', label: 'VAT ID' },
      principal,
    });
    expect(missingFieldRequired.status).toBe(400);

    const invalidFieldPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-fields',
      body: {
        name: 'vat_id',
        label: 'VAT ID',
        type: 'text',
        required: 'yes',
        options: () => null,
        displayOrder: -1,
        workspaceId: WORKSPACE_B_ID,
      },
      principal,
    });
    expect(invalidFieldPayload.status).toBe(400);
    expect((invalidFieldPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'required', message: 'Feld muss ein Boolean sein' },
      { field: 'options', message: 'Feld muss JSON-kompatibel sein' },
      { field: 'displayOrder', message: 'displayOrder muss eine nichtnegative Ganzzahl sein' },
    ]));

    const duplicateName = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-fields',
      body: { name: 'vat_id', label: 'VAT ID', type: 'text' },
      principal,
    });
    expect(duplicateName.status).toBe(409);
    expect((duplicateName.body as any).error.code).toBe('duplicate_custom_field_name');

    const emptyFieldPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/customer-custom-fields/61',
      body: {},
      principal,
    });
    expect(emptyFieldPatch.status).toBe(400);

    const missingValueRequired = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-field-values',
      body: { customerId: 7 },
      principal,
    });
    expect(missingValueRequired.status).toBe(400);

    const invalidValuePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-field-values',
      body: { customerId: null, fieldId: 'nope', sourceSqliteId: 1 },
      principal,
    });
    expect(invalidValuePayload.status).toBe(400);
    expect((invalidValuePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'sourceSqliteId', message: 'Feld ist nicht erlaubt' },
      { field: 'customerId', message: 'customerId muss eine positive Ganzzahl sein' },
      { field: 'fieldId', message: 'fieldId muss eine positive Ganzzahl sein' },
    ]));

    const missingCustomer = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-field-values',
      body: { customerId: 77, fieldId: 61, value: 'x' },
      principal,
    });
    expect(missingCustomer.status).toBe(404);
    expect((missingCustomer.body as any).error.code).toBe('customer_not_found');

    const missingField = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-field-values',
      body: { customerId: 7, fieldId: 99, value: 'x' },
      principal,
    });
    expect(missingField.status).toBe(404);
    expect((missingField.body as any).error.code).toBe('customer_custom_field_not_found');

    const valueConflict = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customer-custom-field-values',
      body: { customerId: 7, fieldId: 61, value: 'x' },
      principal,
    });
    expect(valueConflict.status).toBe(409);
    expect((valueConflict.body as any).error.code).toBe('customer_custom_field_value_conflict');

    const emptyValuePatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/customer-custom-field-values/62',
      body: {},
      principal,
    });
    expect(emptyValuePatch.status).toBe(400);

    const missingFieldDelete = await writableApi.handle({
      method: 'DELETE',
      path: '/api/v1/customer-custom-fields/61',
      principal,
    });
    expect(missingFieldDelete.status).toBe(404);

    const missingValueDelete = await writableApi.handle({
      method: 'DELETE',
      path: '/api/v1/customer-custom-field-values/62',
      principal,
    });
    expect(missingValueDelete.status).toBe(404);
  });

  test('server saved view mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      savedViews: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          return {
            ...makeSavedViewRecord(70),
            sourceSqliteId: -70,
            name: input.values.name ?? 'Saved View 70',
            filters: input.values.filters ?? {},
            displayOrder: input.values.displayOrder ?? 0,
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 70
            ? {
              ...makeSavedViewRecord(70),
              name: input.values.name ?? 'Saved View 70',
              filters: input.values.filters ?? { status: 'Open' },
              displayOrder: input.values.displayOrder ?? 0,
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 70 ? makeSavedViewRecord(70) : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/saved-views',
      body: {
        name: ' Open leads ',
        filters: '{"status":"Open","priority":"High"}',
        displayOrder: '4',
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        name: 'Open leads',
        filters: { status: 'Open', priority: 'High' },
        displayOrder: 4,
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/saved-views/70',
      body: { filters: { status: 'Won' } },
      principal,
    });
    expect(updated.status).toBe(200);
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 70,
      values: {
        filters: { status: 'Won' },
      },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/saved-views/70',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 70,
    }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'saved_view.created',
      'saved_view.updated',
      'saved_view.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['saved_view.created', WORKSPACE_A_ID, 'saved_view', '70'],
      ['saved_view.updated', WORKSPACE_A_ID, 'saved_view', '70'],
      ['saved_view.deleted', WORKSPACE_A_ID, 'saved_view', '70'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 70,
      sourceSqliteId: -70,
      name: 'Open leads',
      filters: { status: 'Open', priority: 'High' },
      displayOrder: 4,
    });
  });

  test('server saved view mutation routes reject unsafe payloads and missing records', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      savedViews: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      savedViews: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return makeSavedViewRecord(70);
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
      path: '/api/v1/saved-views',
      body: { name: 'Open leads', filters: '{}' },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidBody = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/saved-views',
      body: [],
      principal,
    });
    expect(invalidBody.status).toBe(400);
    expect((invalidBody.body as any).error.code).toBe('invalid_saved_view_payload');

    const missingFilters = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/saved-views',
      body: { name: 'Open leads' },
      principal,
    });
    expect(missingFilters.status).toBe(400);

    const invalidFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/saved-views',
      body: {
        name: 'Open leads',
        filters: '{',
        displayOrder: -1,
        workspaceId: WORKSPACE_B_ID,
      },
      principal,
    });
    expect(invalidFields.status).toBe(400);
    expect((invalidFields.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'filters', message: 'filters muss valides JSON enthalten' },
      { field: 'displayOrder', message: 'displayOrder muss eine nichtnegative Ganzzahl sein' },
    ]));

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/saved-views/70',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const missingUpdate = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/saved-views/70',
      body: { name: 'Won leads' },
      principal,
    });
    expect(missingUpdate.status).toBe(404);

    const missingDelete = await writableApi.handle({
      method: 'DELETE',
      path: '/api/v1/saved-views/70',
      principal,
    });
    expect(missingDelete.status).toBe(404);
  });

  test('server activity log create route writes audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      activityLog: {
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
            activityLog: {
              ...makeActivityLogRecord(80, true),
              sourceSqliteId: -80,
              customerId: input.values.customerId ?? null,
              dealId: input.values.dealId ?? null,
              taskId: input.values.taskId ?? null,
              activityType: input.values.activityType ?? 'note',
              title: input.values.title ?? null,
              description: input.values.description ?? null,
              metadata: input.values.metadata ?? null,
              createdAt: input.values.createdAt ?? '2026-07-03T08:00:00.000Z',
            },
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/activity-log',
      body: {
        customerId: '7',
        dealId: 41,
        taskId: null,
        activityType: ' stage_change ',
        title: ' Changed stage ',
        description: ' ',
        metadata: '{"old_stage":"Open","new_stage":"Won"}',
        createdAt: '2026-07-03T08:00:00.000Z',
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        customerId: 7,
        dealId: 41,
        taskId: null,
        activityType: 'stage_change',
        title: 'Changed stage',
        description: null,
        metadata: { old_stage: 'Open', new_stage: 'Won' },
        createdAt: '2026-07-03T08:00:00.000Z',
      },
    }]);
    expect((created.body as any).data.metadata).toEqual({ old_stage: 'Open', new_stage: 'Won' });
    expect(auditEvents.map((event) => event.action)).toEqual(['activity_log.created']);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['activity_log.created', WORKSPACE_A_ID, 'activity_log', '80'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 80,
      sourceSqliteId: -80,
      activityType: 'stage_change',
      title: 'Changed stage',
      customerId: 7,
      dealId: 41,
      taskId: null,
      metadata: { old_stage: 'Open', new_stage: 'Won' },
    });
  });

  test('server activity log create route rejects unsafe payloads and invalid references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      activityLog: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      activityLog: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.customerId === 77) return { ok: false, code: 'customer_not_found' };
          if (input.values.dealId === 88) return { ok: false, code: 'deal_not_found' };
          return { ok: false, code: 'task_not_found' };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/activity-log',
      body: { activityType: 'note' },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidBody = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/activity-log',
      body: [],
      principal,
    });
    expect(invalidBody.status).toBe(400);
    expect((invalidBody.body as any).error.code).toBe('invalid_activity_log_payload');

    const missingActivityType = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/activity-log',
      body: { title: 'Note' },
      principal,
    });
    expect(missingActivityType.status).toBe(400);

    const invalidFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/activity-log',
      body: {
        activityType: 'note',
        customerId: 0,
        metadata: '{',
        createdAt: 'nope',
        workspaceId: WORKSPACE_B_ID,
      },
      principal,
    });
    expect(invalidFields.status).toBe(400);
    expect((invalidFields.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'customerId', message: 'customerId muss eine positive Ganzzahl sein' },
      { field: 'metadata', message: 'metadata muss valides JSON enthalten' },
      { field: 'createdAt', message: 'createdAt muss ein valides Datum sein' },
    ]));

    const missingCustomer = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/activity-log',
      body: { activityType: 'note', customerId: 77 },
      principal,
    });
    expect(missingCustomer.status).toBe(404);
    expect((missingCustomer.body as any).error.code).toBe('customer_not_found');

    const missingDeal = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/activity-log',
      body: { activityType: 'note', dealId: 88 },
      principal,
    });
    expect(missingDeal.status).toBe(404);
    expect((missingDeal.body as any).error.code).toBe('deal_not_found');

    const missingTask = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/activity-log',
      body: { activityType: 'note', taskId: 99 },
      principal,
    });
    expect(missingTask.status).toBe(404);
    expect((missingTask.body as any).error.code).toBe('task_not_found');
  });

  test('server extended CRM and JTL read routes expose imported records without source-row leaks', async () => {
    const activityLogCalls: unknown[] = [];
    const activityLogGetCalls: unknown[] = [];
    const calendarEventCalls: unknown[] = [];
    const customFieldCalls: unknown[] = [];
    const customFieldValueCalls: unknown[] = [];
    const savedViewCalls: unknown[] = [];
    const jtlFirmenCalls: unknown[] = [];
    const jtlFirmenGetCalls: unknown[] = [];
    const jtlWarenlagerCalls: unknown[] = [];
    const jtlZahlungsartenCalls: unknown[] = [];
    const jtlVersandartenCalls: unknown[] = [];
    const ports = makeServerApiPorts({
      activityLog: {
        async list(input) {
          activityLogCalls.push(input);
          return { items: [withRuntimeLeaks(makeActivityLogRecord(80, true))], nextCursor: null };
        },
        async get(input) {
          activityLogGetCalls.push(input);
          return input.id === 80 ? makeActivityLogRecord(80, true) : null;
        },
      },
      calendarEvents: {
        async list(input) {
          calendarEventCalls.push(input);
          return { items: [withRuntimeLeaks(makeCalendarEventRecord(30))], nextCursor: 30 };
        },
        async get(input) {
          return input.id === 30 ? withRuntimeLeaks(makeCalendarEventRecord(30)) : null;
        },
      },
      customerCustomFields: {
        async list(input) {
          customFieldCalls.push(input);
          return { items: [withRuntimeLeaks(makeCustomerCustomFieldRecord(61))], nextCursor: null };
        },
        async get(input) {
          return input.id === 61 ? withRuntimeLeaks(makeCustomerCustomFieldRecord(61)) : null;
        },
      },
      customerCustomFieldValues: {
        async list(input) {
          customFieldValueCalls.push(input);
          return { items: [withRuntimeLeaks(makeCustomerCustomFieldValueRecord(62))], nextCursor: null };
        },
        async get(input) {
          return input.id === 62 ? withRuntimeLeaks(makeCustomerCustomFieldValueRecord(62)) : null;
        },
      },
      savedViews: {
        async list(input) {
          savedViewCalls.push(input);
          return { items: [withRuntimeLeaks(makeSavedViewRecord(70))], nextCursor: null };
        },
        async get(input) {
          return input.id === 70 ? withRuntimeLeaks(makeSavedViewRecord(70)) : null;
        },
      },
      jtlFirmen: {
        async list(input) {
          jtlFirmenCalls.push(input);
          return { items: [withRuntimeLeaks(makeJtlReferenceRecord(100))], nextCursor: null };
        },
        async get(input) {
          jtlFirmenGetCalls.push(input);
          return input.sourceSqliteId === 100 ? withRuntimeLeaks(makeJtlReferenceRecord(100)) : null;
        },
      },
      jtlWarenlager: {
        async list(input) {
          jtlWarenlagerCalls.push(input);
          return { items: [withRuntimeLeaks(makeJtlReferenceRecord(101))], nextCursor: null };
        },
        async get(input) {
          return input.sourceSqliteId === 101 ? withRuntimeLeaks(makeJtlReferenceRecord(101)) : null;
        },
      },
      jtlZahlungsarten: {
        async list(input) {
          jtlZahlungsartenCalls.push(input);
          return { items: [withRuntimeLeaks(makeJtlReferenceRecord(102))], nextCursor: null };
        },
        async get(input) {
          return input.sourceSqliteId === 102 ? withRuntimeLeaks(makeJtlReferenceRecord(102)) : null;
        },
      },
      jtlVersandarten: {
        async list(input) {
          jtlVersandartenCalls.push(input);
          return { items: [withRuntimeLeaks(makeJtlReferenceRecord(103))], nextCursor: null };
        },
        async get(input) {
          return input.sourceSqliteId === 103 ? withRuntimeLeaks(makeJtlReferenceRecord(103)) : null;
        },
      },
    });
    const api = createServerApi(ports);
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const calendarEvents = await api.handle({
      method: 'GET',
      path: '/api/v1/calendar-events',
      query: {
        eventType: 'call',
        taskId: '10',
        startFrom: '2026-06-01',
        startTo: '2026-06-04',
        search: ' Demo ',
        cursor: '1',
        limit: '5',
      },
      principal,
    });
    expect(calendarEvents.status).toBe(200);
    expect((calendarEvents.body as any).data.items[0].title).toBe('Demo event 30');
    expect((calendarEvents.body as any).data.nextCursor).toBe(30);
    expect(calendarEventCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 5,
      cursor: 1,
      search: 'Demo',
      eventType: 'call',
      taskId: 10,
      startFrom: '2026-06-01T00:00:00.000Z',
      startTo: '2026-06-04T00:00:00.000Z',
    }]);

    const customFields = await api.handle({
      method: 'GET',
      path: '/api/v1/customer-custom-fields',
      query: { type: 'text', active: 'true', search: ' VAT ' },
      principal,
    });
    expect(customFields.status).toBe(200);
    expect((customFields.body as any).data.items[0].label).toBe('VAT ID');
    expect(customFieldCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      search: 'VAT',
      type: 'text',
      active: true,
    }]);

    const customFieldValues = await api.handle({
      method: 'GET',
      path: '/api/v1/customer-custom-field-values',
      query: { customerId: '7', fieldId: '61', search: ' DE ' },
      principal,
    });
    expect(customFieldValues.status).toBe(200);
    expect((customFieldValues.body as any).data.items[0].value).toBe('DE123456789');
    expect(customFieldValueCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      customerId: 7,
      fieldId: 61,
      search: 'DE',
    }]);

    const batchedCustomFieldValues = await api.handle({
      method: 'GET',
      path: '/api/v1/customer-custom-field-values',
      query: { customerIds: '7,8' },
      principal,
    });
    expect(batchedCustomFieldValues.status).toBe(200);
    expect(customFieldValueCalls.at(-1)).toEqual({
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      customerIds: [7, 8],
    });

    const conflictingCustomerFilters = await api.handle({
      method: 'GET',
      path: '/api/v1/customer-custom-field-values',
      query: { customerId: '7', customerIds: '8' },
      principal,
    });
    expect(conflictingCustomerFilters.status).toBe(400);
    expect((conflictingCustomerFilters.body as any).error.code).toBe('invalid_customer_filter');

    const activityLog = await api.handle({
      method: 'GET',
      path: '/api/v1/activity-log',
      query: { activityType: 'email', customerId: '7', includeMetadata: 'false' },
      principal,
    });
    expect(activityLog.status).toBe(200);
    expect((activityLog.body as any).data.items[0].metadata).toBeUndefined();
    const groupedActivityLog = await api.handle({
      method: 'GET',
      path: '/api/v1/activity-log',
      query: { timelineFilter: 'communication', customerId: '7', sort: 'createdAtDesc' },
      principal,
    });
    expect(groupedActivityLog.status).toBe(200);
    expect(activityLogCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      activityType: 'email',
      customerId: 7,
      includeMetadata: false,
    }, {
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      activityTypes: ['call', 'email', 'note'],
      customerId: 7,
      includeMetadata: false,
      sort: 'createdAtDesc',
    }]);

    const activityLogEntry = await api.handle({
      method: 'GET',
      path: '/api/v1/activity-log/80',
      query: { includeMetadata: 'true' },
      principal,
    });
    expect(activityLogEntry.status).toBe(200);
    expect((activityLogEntry.body as any).data.metadata).toEqual({ imported: true });
    expect(activityLogGetCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, id: 80, includeMetadata: true }]);

    const savedViews = await api.handle({
      method: 'GET',
      path: '/api/v1/saved-views',
      query: { search: ' Open ' },
      principal,
    });
    expect(savedViews.status).toBe(200);
    expect((savedViews.body as any).data.items[0].filters).toEqual({ status: 'Open' });
    expect(savedViewCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 50, search: 'Open' }]);

    const jtlFirmen = await api.handle({
      method: 'GET',
      path: '/api/v1/jtl/firmen',
      query: { cursor: '-99', search: ' Main ' },
      principal,
    });
    expect(jtlFirmen.status).toBe(200);
    expect((jtlFirmen.body as any).data.items[0].sourceSqliteId).toBe(100);
    expect(jtlFirmenCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 50, cursor: -99, search: 'Main' }]);

    const jtlFirma = await api.handle({
      method: 'GET',
      path: '/api/v1/jtl/firmen/100',
      principal,
    });
    expect(jtlFirma.status).toBe(200);
    expect((jtlFirma.body as any).data.name).toBe('JTL Reference 100');
    expect(jtlFirmenGetCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, sourceSqliteId: 100 }]);

    const jtlWarenlager = await api.handle({ method: 'GET', path: '/api/v1/jtl/warenlager', principal });
    const jtlZahlungsarten = await api.handle({ method: 'GET', path: '/api/v1/jtl/zahlungsarten', principal });
    const jtlVersandarten = await api.handle({ method: 'GET', path: '/api/v1/jtl/versandarten', principal });
    expect(jtlWarenlager.status).toBe(200);
    expect(jtlZahlungsarten.status).toBe(200);
    expect(jtlVersandarten.status).toBe(200);
    expect(jtlWarenlagerCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 50 }]);
    expect(jtlZahlungsartenCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 50 }]);
    expect(jtlVersandartenCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 50 }]);

    const serializedBodies = JSON.stringify([
      calendarEvents.body,
      customFields.body,
      customFieldValues.body,
      activityLog.body,
      activityLogEntry.body,
      savedViews.body,
      jtlFirmen.body,
      jtlFirma.body,
      jtlWarenlager.body,
      jtlZahlungsarten.body,
      jtlVersandarten.body,
    ]);
    expect(serializedBodies).not.toContain('source-row-leak');
    expect(serializedBodies).not.toContain('sqlite-import-run-id');
    expect(serializedBodies).not.toContain('keytar');
  });

  test('server extended CRM and JTL routes validate auth, IDs, filters, and missing ports', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unauthorized = await api.handle({ method: 'GET', path: '/api/v1/calendar-events' });
    expect(unauthorized.status).toBe(401);

    const invalidCalendarId = await api.handle({
      method: 'GET',
      path: '/api/v1/calendar-events/nope',
      principal,
    });
    expect(invalidCalendarId.status).toBe(400);
    expect((invalidCalendarId.body as any).error.code).toBe('invalid_calendar_event_id');

    const invalidStartFrom = await api.handle({
      method: 'GET',
      path: '/api/v1/calendar-events',
      query: { startFrom: 'nope' },
      principal,
    });
    expect(invalidStartFrom.status).toBe(400);
    expect((invalidStartFrom.body as any).error.code).toBe('invalid_start_from');

    const invalidIncludeMetadata = await api.handle({
      method: 'GET',
      path: '/api/v1/activity-log',
      query: { includeMetadata: 'yes' },
      principal,
    });
    expect(invalidIncludeMetadata.status).toBe(400);
    expect((invalidIncludeMetadata.body as any).error.code).toBe('invalid_include_metadata');

    const invalidActivityLogSort = await api.handle({
      method: 'GET',
      path: '/api/v1/activity-log',
      query: { sort: 'createdAtAsc' },
      principal,
    });
    expect(invalidActivityLogSort.status).toBe(400);
    expect((invalidActivityLogSort.body as any).error.code).toBe('invalid_activity_log_sort');

    const invalidActivityLogCursor = await api.handle({
      method: 'GET',
      path: '/api/v1/activity-log',
      query: { sort: 'createdAtDesc', cursor: '10' },
      principal,
    });
    expect(invalidActivityLogCursor.status).toBe(400);
    expect((invalidActivityLogCursor.body as any).error.code).toBe('invalid_activity_log_cursor');

    const invalidActive = await api.handle({
      method: 'GET',
      path: '/api/v1/customer-custom-fields',
      query: { active: 'yes' },
      principal,
    });
    expect(invalidActive.status).toBe(400);
    expect((invalidActive.body as any).error.code).toBe('invalid_active');

    const invalidJtlId = await api.handle({
      method: 'GET',
      path: '/api/v1/jtl/firmen/nope',
      principal,
    });
    expect(invalidJtlId.status).toBe(400);
    expect((invalidJtlId.body as any).error.code).toBe('invalid_jtl_firmen_id');

    const unavailable = await api.handle({
      method: 'GET',
      path: '/api/v1/calendar-events',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('calendar_events_unavailable');
  });

  test('server JTL order route validates payload, uses principal workspace, and writes audit on success', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const createCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      jtlOrders: {
        async createOrder(input) {
          createCalls.push(input);
          return input.order.simpleCrmCustomerId === 7
            ? { success: true, jtlOrderId: 123, jtlOrderNumber: 'EXTERN-123' }
            : { success: false, error: 'Kunde nicht in JTL synchronisiert' };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/jtl/orders',
      principal,
      body: {
        simpleCrmCustomerId: '7',
        kFirma: '1',
        kWarenlager: 2,
        kZahlungsart: '3',
        kVersandart: 4,
        products: [{ kArtikel: '900', cName: 'Artikel', cArtNr: 'SKU', nAnzahl: '2', fPreis: '19.99' }],
      },
    });
    expect(created.status).toBe(200);
    expect((created.body as any).data).toEqual({
      success: true,
      jtlOrderId: 123,
      jtlOrderNumber: 'EXTERN-123',
    });
    expect(createCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      order: {
        simpleCrmCustomerId: 7,
        kFirma: 1,
        kWarenlager: 2,
        kZahlungsart: 3,
        kVersandart: 4,
        products: [{ kArtikel: 900, cName: 'Artikel', cArtNr: 'SKU', nAnzahl: 2, fPreis: 19.99 }],
      },
    });
    expect(auditEvents).toEqual([expect.objectContaining({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      action: 'jtl_order.created',
      entityType: 'jtl_order',
      entityId: '123',
      metadata: {
        jtlOrderId: 123,
        jtlOrderNumber: 'EXTERN-123',
        simpleCrmCustomerId: 7,
        productCount: 1,
      },
    })]);

    const failed = await api.handle({
      method: 'POST',
      path: '/api/v1/jtl/orders',
      principal,
      body: {
        simpleCrmCustomerId: 8,
        kFirma: 1,
        kWarenlager: 2,
        kZahlungsart: 3,
        kVersandart: 4,
        products: [{ kArtikel: 900, nAnzahl: 2, fPreis: 19.99 }],
      },
    });
    expect(failed.status).toBe(200);
    expect((failed.body as any).data).toEqual({ success: false, error: 'Kunde nicht in JTL synchronisiert' });
    expect(auditEvents).toHaveLength(1);

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/jtl/orders',
      principal,
      body: { simpleCrmCustomerId: 'nope', products: [] },
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.code).toBe('validation_error');
    expect((invalid.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'simpleCrmCustomerId', message: 'muss eine positive Ganzzahl sein' },
      { field: 'products', message: 'muss eine nicht-leere Liste sein' },
    ]));

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'POST',
      path: '/api/v1/jtl/orders',
      principal,
      body: {
        simpleCrmCustomerId: 7,
        kFirma: 1,
        kWarenlager: 2,
        kZahlungsart: 3,
        kVersandart: 4,
        products: [{ kArtikel: 900, nAnzahl: 2, fPreis: 19.99 }],
      },
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('jtl_orders_unavailable');
  });

  test('server JTL sync routes expose status, run sync, and write audit', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      jtlSync: {
        async getStatus(input) {
          calls.push(['status', input]);
          return {
            status: 'Success',
            message: 'Server sync ok',
            timestamp: '2026-06-05T10:00:00.000Z',
          };
        },
        async run(input) {
          calls.push(['run', input]);
          return {
            success: true,
            message: 'Sync completed',
            details: {
              found: 6,
              synced: 6,
              customersFound: 1,
              customersSynced: 1,
              productsFound: 1,
              productsSynced: 1,
              firmenFound: 1,
              firmenSynced: 1,
              warenlagerFound: 1,
              warenlagerSynced: 1,
              zahlungsartenFound: 1,
              zahlungsartenSynced: 1,
              versandartenFound: 1,
              versandartenSynced: 1,
            },
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const status = await api.handle({
      method: 'GET',
      path: '/api/v1/jtl/sync/status',
      principal,
    });
    expect(status.status).toBe(200);
    expect((status.body as any).data).toEqual({
      status: 'Success',
      message: 'Server sync ok',
      timestamp: '2026-06-05T10:00:00.000Z',
    });

    const run = await api.handle({
      method: 'POST',
      path: '/api/v1/jtl/sync/run',
      principal,
    });
    expect(run.status).toBe(200);
    expect((run.body as any).data).toMatchObject({
      success: true,
      message: 'Sync completed',
      details: { found: 6, synced: 6 },
    });
    expect(calls).toEqual([
      ['status', { workspaceId: WORKSPACE_A_ID }],
      ['run', { workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID }],
    ]);
    expect(auditEvents).toEqual([expect.objectContaining({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      action: 'jtl_sync.completed',
      entityType: 'jtl_sync',
      entityId: WORKSPACE_A_ID,
      metadata: {
        success: true,
        details: expect.objectContaining({ found: 6, synced: 6 }),
      },
    })]);

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'POST',
      path: '/api/v1/jtl/sync/run',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('jtl_sync_unavailable');
  });

  test('server JTL reference mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      jtlFirmen: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          return {
            ...makeJtlReferenceRecord(-100),
            name: input.values.name ?? null,
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.sourceSqliteId === -100
            ? {
              ...makeJtlReferenceRecord(-100),
              name: input.values.name === undefined ? 'JTL Reference -100' : input.values.name,
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.sourceSqliteId === -100 ? makeJtlReferenceRecord(-100) : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/jtl/firmen',
      body: { name: ' Main Firma ' },
      principal,
    });
    expect(created.status).toBe(201);
    expect((created.body as any).data.name).toBe('Main Firma');
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: { name: 'Main Firma' },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/jtl/firmen/-100',
      body: { name: null },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.name).toBeNull();
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      sourceSqliteId: -100,
      values: { name: null },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/jtl/firmen/-100',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      sourceSqliteId: -100,
    }]);

    expect(auditEvents.map((event) => [event.action, event.entityType, event.entityId])).toEqual([
      ['jtl_reference.created', 'jtl_reference', 'firmen:-100'],
      ['jtl_reference.updated', 'jtl_reference', 'firmen:-100'],
      ['jtl_reference.deleted', 'jtl_reference', 'firmen:-100'],
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['jtl_reference.created', WORKSPACE_A_ID, 'jtl_reference', 'firmen:-100'],
      ['jtl_reference.updated', WORKSPACE_A_ID, 'jtl_reference', 'firmen:-100'],
      ['jtl_reference.deleted', WORKSPACE_A_ID, 'jtl_reference', 'firmen:-100'],
    ]);
    expect(events[0].payload).toMatchObject({
      resource: 'firmen',
      sourceSqliteId: -100,
      name: 'Main Firma',
    });
  });

  test('server JTL reference mutation routes reject unsafe payloads and missing records', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      jtlFirmen: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      jtlFirmen: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return makeJtlReferenceRecord(-100);
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
      path: '/api/v1/jtl/firmen',
      body: { name: 'Main Firma' },
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('jtl_firmen_unavailable');

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/jtl/firmen',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_jtl_firmen_payload');

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/jtl/firmen',
      body: { workspaceId: WORKSPACE_B_ID, name: 123 },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'name', message: 'Feld muss ein String sein' },
    ]));

    const missingName = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/jtl/firmen',
      body: {},
      principal,
    });
    expect(missingName.status).toBe(400);

    const invalidId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/jtl/firmen/0',
      body: { name: 'Main Firma' },
      principal,
    });
    expect(invalidId.status).toBe(400);
    expect((invalidId.body as any).error.code).toBe('invalid_jtl_firmen_id');

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/jtl/firmen/-100',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const missingWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/jtl/firmen/-100', body: { name: 'Main Firma' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/jtl/firmen/-100', principal }),
    ]);
    expect(missingWrites.map((response) => response.status)).toEqual([404, 404]);
  });

});
