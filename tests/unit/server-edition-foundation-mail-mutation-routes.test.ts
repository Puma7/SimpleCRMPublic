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

describe('server edition foundation — mail-mutation-routes', () => {
  test('server email internal note mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailInternalNotes: {
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
            note: {
              ...makeEmailInternalNoteRecord(64),
              sourceSqliteId: -64,
              messageId: input.values.messageId ?? 11,
              messageSourceSqliteId: 110,
              body: input.values.body ?? 'Internal follow-up note',
            },
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 64
            ? {
              ...makeEmailInternalNoteRecord(64),
              sourceSqliteId: -64,
              body: input.values.body ?? 'Internal follow-up note',
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 64
            ? {
              ...makeEmailInternalNoteRecord(64),
              sourceSqliteId: -64,
            }
            : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/internal-notes',
      body: { body: ' New internal note ' },
      principal,
    });
    expect(created.status).toBe(201);
    expect((created.body as any).data.body).toBe('New internal note');
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        messageId: 11,
        body: 'New internal note',
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/internal-notes/64',
      body: { body: ' Updated internal note ' },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.body).toBe('Updated internal note');
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 64,
      values: {
        body: 'Updated internal note',
      },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/internal-notes/64',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 64,
    }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'email_internal_note.created',
      'email_internal_note.updated',
      'email_internal_note.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['email_internal_note.created', WORKSPACE_A_ID, 'email_internal_note', '64'],
      ['email_internal_note.updated', WORKSPACE_A_ID, 'email_internal_note', '64'],
      ['email_internal_note.deleted', WORKSPACE_A_ID, 'email_internal_note', '64'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 64,
      sourceSqliteId: -64,
      messageId: 11,
      messageSourceSqliteId: 110,
      body: 'New internal note',
    });
  });

  test('server email internal note mutation routes reject unsafe payloads and invalid references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      emailInternalNotes: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      emailInternalNotes: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return { ok: false, code: 'message_not_found' };
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
      path: '/api/v1/email/messages/11/internal-notes',
      body: { body: 'Note' },
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('email_internal_notes_unavailable');

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/internal-notes',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_email_internal_note_payload');

    const missingBody = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/internal-notes',
      body: {},
      principal,
    });
    expect(missingBody.status).toBe(400);
    expect((missingBody.body as any).error.code).toBe('validation_error');

    const mismatchedMessage = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/internal-notes',
      body: { messageId: '12', body: 'Note' },
      principal,
    });
    expect(mismatchedMessage.status).toBe(400);
    expect((mismatchedMessage.body as any).error.details.fields).toContainEqual({
      field: 'messageId',
      message: 'messageId muss mit der URL uebereinstimmen',
    });

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/internal-notes',
      body: {
        workspaceId: WORKSPACE_B_ID,
        messageId: 0,
        body: ' ',
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'messageId', message: 'messageId muss eine positive Ganzzahl sein' },
      { field: 'body', message: 'Feld darf nicht leer sein' },
    ]));

    const missingMessage = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/email/internal-notes',
      body: { messageId: 77, body: 'Note' },
      principal,
    });
    expect(missingMessage.status).toBe(404);
    expect((missingMessage.body as any).error.code).toBe('email_message_not_found');

    const forbiddenMessagePatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/internal-notes/64',
      body: { messageId: 11, body: 'Note' },
      principal,
    });
    expect(forbiddenMessagePatch.status).toBe(400);
    expect((forbiddenMessagePatch.body as any).error.details.fields).toContainEqual({
      field: 'messageId',
      message: 'Feld ist nicht erlaubt',
    });

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/internal-notes/64',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const missingUpdate = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/internal-notes/64',
      body: { body: 'Updated' },
      principal,
    });
    expect(missingUpdate.status).toBe(404);

    const missingDelete = await writableApi.handle({
      method: 'DELETE',
      path: '/api/v1/email/internal-notes/64',
      principal,
    });
    expect(missingDelete.status).toBe(404);
  });

  test('server settings routes read and update workspace sync_info values', async () => {
    const store = new Map<string, string | null>([
      ['workflow_imap_delete_opt_in', 'yes'],
      ['workflow_http_allowlist', ' api.example.com '],
      ['workflow_spam_score_threshold', '82'],
      ['email_webhook_secret', 'secret-1'],
      ['email_max_attachment_mb', '30'],
      ['mail_security_rspamd_enabled', '1'],
      ['mail_security_rspamd_url', 'http://rspamd.local/'],
      ['mail_security_spam_review_threshold', '44'],
      ['mail_security_spam_spam_threshold', '80'],
      ['snooze_default_times_v1', JSON.stringify({
        eveningHour: 19,
        eveningMinute: 15,
        morningHour: 8,
        morningMinute: 45,
        nextWeekWeekday: 2,
        nextWeekHour: 10,
        nextWeekMinute: 30,
      })],
      ['reply_suggestion_auto_enabled', '0'],
      ['reply_suggestion_trigger_inbound', '1'],
      ['reply_suggestion_trigger_on_open', '0'],
      ['reply_suggestion_category_mode', 'any'],
      ['reply_suggestion_category_ids', '[4]'],
      ['reply_suggestion_auto_enabled@5', '1'],
      ['reply_suggestion_category_mode@5', 'only_listed'],
      ['reply_suggestion_category_ids@5', '[7,8]'],
    ]);
    const getCalls: unknown[] = [];
    const setCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      syncInfo: {
        async getMany(input) {
          getCalls.push(input);
          return input.keys
            .filter((key) => store.has(key))
            .map((key) => ({
              key,
              value: store.get(key) ?? null,
              updatedAt: '2026-06-03T10:00:00.000Z',
            }));
        },
        async getByPrefix(input) {
          getCalls.push(input);
          return [...store.entries()]
            .filter(([key]) => key.startsWith(input.prefix))
            .slice(0, input.limit ?? 500)
            .map(([key, value]) => ({
              key,
              value,
              updatedAt: '2026-06-03T10:00:00.000Z',
            }));
        },
        async setMany(input) {
          setCalls.push(input);
          for (const [key, value] of Object.entries(input.values)) {
            store.set(key, value);
          }
          return Object.entries(input.values).map(([key, value]) => ({
            key,
            value,
            updatedAt: '2026-06-03T10:05:00.000Z',
          }));
        },
        async deleteMany(input) {
          setCalls.push(input);
          let count = 0;
          for (const key of input.keys) {
            if (store.delete(key)) count += 1;
          }
          return count;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };
    const adminPrincipal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'owner' as const };

    const workflow = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow/settings/automation',
      principal,
    });
    expect(workflow.status).toBe(200);
    expect((workflow.body as any).data).toEqual({
      imapDeleteOptIn: true,
      httpAllowlist: ' api.example.com ',
      senderWhitelist: '',
      senderBlacklist: '',
      spamScoreThreshold: '82',
    });

    const misc = await api.handle({
      method: 'GET',
      path: '/api/v1/email/settings/misc',
      principal,
    });
    expect(misc.status).toBe(200);
    expect((misc.body as any).data).toEqual({
      webhookSecret: 'se****-1',
      maxAttachmentMb: '30',
    });

    const security = await api.handle({
      method: 'GET',
      path: '/api/v1/email/settings/security',
      principal,
    });
    expect(security.status).toBe(200);
    expect((security.body as any).data).toMatchObject({
      rspamdEnabled: true,
      rspamdUrl: 'http://rspamd.local',
      rspamdTimeoutMs: 8000,
      spamReviewThreshold: 44,
      spamSpamThreshold: 80,
      localLearningEnabled: true,
    });

    const workflowPatch = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflow/settings/automation',
      body: {
        imapDeleteOptIn: false,
        httpAllowlist: ' hooks.example.com ',
        spamScoreThreshold: '101',
      },
      principal,
    });
    expect(workflowPatch.status).toBe(200);
    expect(setCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      values: {
        workflow_imap_delete_opt_in: 'false',
        workflow_http_allowlist: 'hooks.example.com',
        workflow_spam_score_threshold: '100',
      },
    });

    const miscPatchDenied = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/settings/misc',
      body: {
        webhookSecret: ' rotated ',
        maxAttachmentMb: 55,
      },
      principal,
    });
    expect(miscPatchDenied.status).toBe(403);

    const miscPatch = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/settings/misc',
      body: {
        webhookSecret: ' rotated ',
        maxAttachmentMb: 55,
      },
      principal: adminPrincipal,
    });
    expect(miscPatch.status).toBe(200);
    expect(setCalls[1]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      values: {
        email_webhook_secret: 'rotated',
        email_max_attachment_mb: '55',
      },
    });

    const securityPatch = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/settings/security',
      body: {
        rspamdEnabled: false,
        rspamdUrl: ' http://rspamd2.local/ ',
        rspamdTimeoutMs: 999,
        spamReviewThreshold: 47.9,
        senderWhitelist: ' trusted@example.com ',
      },
      principal,
    });
    expect(securityPatch.status).toBe(200);
    expect(setCalls[2]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      values: {
        mail_security_rspamd_enabled: '0',
        mail_security_rspamd_url: 'http://rspamd2.local',
        mail_security_rspamd_timeout_ms: '1000',
        mail_security_spam_review_threshold: '47',
        workflow_sender_whitelist: 'trusted@example.com',
      },
    });

    const snooze = await api.handle({
      method: 'GET',
      path: '/api/v1/email/settings/snooze',
      principal,
    });
    expect(snooze.status).toBe(200);
    expect((snooze.body as any).data).toEqual({
      eveningHour: 19,
      eveningMinute: 15,
      morningHour: 8,
      morningMinute: 45,
      nextWeekWeekday: 2,
      nextWeekHour: 10,
      nextWeekMinute: 30,
    });

    const snoozePatch = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/settings/snooze',
      body: {
        eveningHour: 18,
        eveningMinute: 0,
        morningHour: 9,
        morningMinute: 5,
        nextWeekWeekday: 1,
        nextWeekHour: 9,
        nextWeekMinute: 30,
      },
      principal,
    });
    expect(snoozePatch.status).toBe(200);
    expect(setCalls[3]).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      values: {
        snooze_default_times_v1: JSON.stringify({
          eveningHour: 18,
          eveningMinute: 0,
          morningHour: 9,
          morningMinute: 5,
          nextWeekWeekday: 1,
          nextWeekHour: 9,
          nextWeekMinute: 30,
        }),
      },
    });

    const reply = await api.handle({
      method: 'GET',
      path: '/api/v1/email/settings/reply-suggestion',
      query: { accountId: '5' },
      principal,
    });
    expect(reply.status).toBe(200);
    expect((reply.body as any).data).toEqual({
      autoEnabled: true,
      triggerOnInbound: true,
      triggerOnOpen: false,
      categoryMode: 'only_listed',
      categoryIds: [7, 8],
    });

    const replyPatch = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/settings/reply-suggestion',
      body: {
        accountId: 5,
        autoEnabled: false,
        triggerOnOpen: true,
        categoryMode: 'only_listed',
        categoryIds: [8, 9, 9],
      },
      principal,
    });
    expect(replyPatch.status).toBe(200);
    expect((replyPatch.body as any).data).toEqual({
      autoEnabled: false,
      triggerOnInbound: true,
      triggerOnOpen: true,
      categoryMode: 'only_listed',
      categoryIds: [8, 9],
    });
    expect(setCalls[4]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      values: {
        'reply_suggestion_auto_enabled@5': '0',
        'reply_suggestion_trigger_inbound@5': '1',
        'reply_suggestion_trigger_on_open@5': '1',
        'reply_suggestion_category_mode@5': 'only_listed',
        'reply_suggestion_category_ids@5': '[8,9]',
      },
    });
    expect(auditEvents.map((event) => [event.action, event.entityId, event.metadata])).toEqual([
      ['workflow_settings.updated', 'workflow.settings.automation', { keys: Object.keys((setCalls[0] as any).values) }],
      ['email_settings.misc.updated', 'email.settings.misc', { keys: Object.keys((setCalls[1] as any).values) }],
      ['email_settings.security.updated', 'email.settings.security', { keys: Object.keys((setCalls[2] as any).values) }],
      ['email_settings.snooze.updated', 'email.settings.snooze', { keys: Object.keys((setCalls[3] as any).values) }],
      ['email_settings.reply_suggestion.updated', 'email.settings.reply_suggestion.account.5', { keys: Object.keys((setCalls[4] as any).values) }],
    ]);
    expect(getCalls).toHaveLength(6);
  });

  test('server generic sync-info routes preserve legacy key value contract', async () => {
    const store = new Map<string, string | null>([
      ['lastCustomerSync', '2026-03-01'],
    ]);
    const getCalls: unknown[] = [];
    const setCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      syncInfo: {
        async getMany(input) {
          getCalls.push(input);
          return input.keys
            .filter((key) => store.has(key))
            .map((key) => ({
              key,
              value: store.get(key) ?? null,
              updatedAt: '2026-06-03T10:00:00.000Z',
            }));
        },
        async getByPrefix(input) {
          getCalls.push(input);
          return [...store.entries()]
            .filter(([key]) => key.startsWith(input.prefix))
            .map(([key, value]) => ({
              key,
              value,
              updatedAt: '2026-06-03T10:00:00.000Z',
            }));
        },
        async setMany(input) {
          setCalls.push(input);
          for (const [key, value] of Object.entries(input.values)) {
            store.set(key, value);
          }
          return Object.entries(input.values).map(([key, value]) => ({
            key,
            value,
            updatedAt: '2026-06-03T10:05:00.000Z',
          }));
        },
        async deleteMany(input) {
          setCalls.push(input);
          let count = 0;
          for (const key of input.keys) {
            if (store.delete(key)) count += 1;
          }
          return count;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const loaded = await api.handle({
      method: 'GET',
      path: '/api/v1/sync-info/lastCustomerSync',
      principal,
    });
    expect(loaded.status).toBe(200);
    expect((loaded.body as any).data).toEqual({
      key: 'lastCustomerSync',
      value: '2026-03-01',
    });

    const missing = await api.handle({
      method: 'GET',
      path: '/api/v1/sync-info/unknownKey',
      principal,
    });
    expect(missing.status).toBe(200);
    expect((missing.body as any).data).toEqual({
      key: 'unknownKey',
      value: null,
    });

    const saved = await api.handle({
      method: 'PATCH',
      path: '/api/v1/sync-info/lastCustomerSync',
      body: { value: '2026-03-16' },
      principal,
    });
    expect(saved.status).toBe(200);
    expect((saved.body as any).data).toEqual({ success: true });
    expect(setCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      values: { lastCustomerSync: '2026-03-16' },
    });
    expect(store.get('lastCustomerSync')).toBe('2026-03-16');
    expect(auditEvents).toEqual([
      expect.objectContaining({
        action: 'sync_info.updated',
        entityType: 'sync_info',
        entityId: 'lastCustomerSync',
        metadata: { keys: ['lastCustomerSync'] },
      }),
    ]);

    const invalid = await api.handle({
      method: 'PATCH',
      path: '/api/v1/sync-info/lastCustomerSync',
      body: { value: 42 },
      principal,
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.code).toBe('validation_error');
    expect(getCalls).toEqual([
      { workspaceId: WORKSPACE_A_ID, keys: ['lastCustomerSync'] },
      { workspaceId: WORKSPACE_A_ID, keys: ['unknownKey'] },
    ]);
  });

  test('server settings route tests rspamd connectivity', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };
    const originalFetch = globalThis.fetch;
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: true, status: 200 })
      .mockResolvedValueOnce({ ok: false, status: 403 });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      writable: true,
      value: fetchMock,
    });

    try {
      const ok = await api.handle({
        method: 'POST',
        path: '/api/v1/email/settings/security/test-rspamd',
        body: {
          rspamdUrl: ' http://rspamd.local/ ',
          rspamdTimeoutMs: 999,
        },
        principal,
      });
      expect(ok.status).toBe(200);
      expect((ok.body as any).data).toEqual({
        success: true,
        message: 'Rspamd erreichbar (http://rspamd.local)',
      });
      expect(fetchMock).toHaveBeenNthCalledWith(
        1,
        'http://rspamd.local/stat',
        expect.objectContaining({ signal: expect.any(Object) }),
      );

      const httpError = await api.handle({
        method: 'POST',
        path: '/api/v1/email/settings/security/test-rspamd',
        body: {
          rspamdUrl: 'http://rspamd.local',
        },
        principal,
      });
      expect(httpError.status).toBe(200);
      expect((httpError.body as any).data).toEqual({
        success: false,
        error: 'HTTP 403',
      });

      const invalid = await api.handle({
        method: 'POST',
        path: '/api/v1/email/settings/security/test-rspamd',
        body: {
          rspamdUrl: 'ftp://rspamd.local',
        },
        principal,
      });
      expect(invalid.status).toBe(400);
      expect((invalid.body as any).error.code).toBe('validation_error');
    } finally {
      Object.defineProperty(globalThis, 'fetch', {
        configurable: true,
        writable: true,
        value: originalFetch,
      });
    }
  });

  test('server MSSQL settings routes store sanitized settings and delegate password operations', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const calls: unknown[] = [];
    let savedSettings: unknown = {
      server: 'sql.local',
      database: 'JTL',
      user: 'crm',
      port: 1433,
      encrypt: true,
      trustServerCertificate: false,
      forcePort: false,
      hasPassword: true,
    };
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      mssqlSettings: {
        async getSettings(input) {
          calls.push(['get', input]);
          return savedSettings as any;
        },
        async saveSettings(input) {
          calls.push(['save', input]);
          savedSettings = { ...input.settings, password: undefined, hasPassword: 'password' in input.settings };
          return { success: true };
        },
        async clearPassword(input) {
          calls.push(['clear', input]);
          return { success: true, message: 'Password successfully cleared from secure storage.' };
        },
        async testConnection(input) {
          calls.push(['test', input]);
          return { success: true, rows: [{ ok: 1 }], rowCount: 1 };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };
    const adminPrincipal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'owner' as const };

    const loaded = await api.handle({
      method: 'GET',
      path: '/api/v1/mssql/settings',
      principal,
    });
    expect(loaded.status).toBe(200);
    expect((loaded.body as any).data).toMatchObject({
      server: 'sql.local',
      database: 'JTL',
      user: 'crm',
      hasPassword: true,
    });
    expect((loaded.body as any).data.password).toBeUndefined();

    const tested = await api.handle({
      method: 'POST',
      path: '/api/v1/mssql/test-connection',
      body: {
        server: ' sql.local ',
        database: ' JTL ',
        user: ' crm ',
        password: 'secret',
        port: '1433',
        hasPassword: true,
      },
      principal,
    });
    expect(tested.status).toBe(200);
    expect((tested.body as any).data.success).toBe(true);

    const saved = await api.handle({
      method: 'PATCH',
      path: '/api/v1/mssql/settings',
      body: {
        server: ' sql.local ',
        database: ' JTL ',
        user: ' crm ',
        password: 'secret',
        port: '1433',
        encrypt: true,
        trustServerCertificate: true,
        forcePort: true,
        cWaehrung: 'eur',
      },
      principal: adminPrincipal,
    });
    expect(saved.status).toBe(200);
    expect((saved.body as any).data).toEqual({ success: true });

    const cleared = await api.handle({
      method: 'DELETE',
      path: '/api/v1/mssql/password',
      principal: adminPrincipal,
    });
    expect(cleared.status).toBe(200);
    expect((cleared.body as any).data.success).toBe(true);

    expect(calls).toEqual([
      ['get', { workspaceId: WORKSPACE_A_ID }],
      ['test', {
        workspaceId: WORKSPACE_A_ID,
        settings: {
          server: 'sql.local',
          database: 'JTL',
          user: 'crm',
          password: 'secret',
          port: 1433,
        },
      }],
      ['save', {
        workspaceId: WORKSPACE_A_ID,
        settings: {
          server: 'sql.local',
          database: 'JTL',
          user: 'crm',
          password: 'secret',
          port: 1433,
          encrypt: true,
          trustServerCertificate: true,
          forcePort: true,
          cWaehrung: 'EUR',
        },
      }],
      ['clear', { workspaceId: WORKSPACE_A_ID }],
    ]);
    expect(auditEvents.map((event) => [event.action, event.metadata])).toEqual([
      ['mssql_settings.updated', {
        keys: ['server', 'database', 'user', 'port', 'encrypt', 'trustServerCertificate', 'forcePort', 'cWaehrung'],
        passwordChanged: true,
      }],
      ['mssql_settings.password_cleared', { passwordChanged: true }],
    ]);
  });

  test('server MSSQL settings routes skip audit events for failed saves', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      mssqlSettings: {
        async getSettings() {
          return null;
        },
        async saveSettings(input) {
          calls.push(['save', input]);
          return { success: false, error: 'MSSQL secret storage is not configured' };
        },
        async clearPassword() {
          return { success: true, message: 'No password found in secure storage for the current settings.' };
        },
        async testConnection() {
          return { success: false, error: 'not configured' };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'owner' as const };

    const saved = await api.handle({
      method: 'PATCH',
      path: '/api/v1/mssql/settings',
      body: {
        server: 'sql.local',
        database: 'JTL',
        user: 'crm',
        password: 'secret',
      },
      principal,
    });

    expect(saved.status).toBe(200);
    expect((saved.body as any).data).toEqual({
      success: false,
      error: 'MSSQL secret storage is not configured',
    });
    expect(calls).toEqual([[
      'save',
      {
        workspaceId: WORKSPACE_A_ID,
        settings: {
          server: 'sql.local',
          database: 'JTL',
          user: 'crm',
          password: 'secret',
        },
      },
    ]]);
    expect(auditEvents).toEqual([]);
  });

  test('server settings routes reject unsafe payloads and unavailable sync_info ports', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts());
    const writableApi = createServerApi(makeServerApiPorts({
      syncInfo: {
        async getMany() {
          return [];
        },
        async getByPrefix() {
          return [];
        },
        async setMany() {
          return [];
        },
        async deleteMany() {
          return 0;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'GET',
      path: '/api/v1/email/settings/misc',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('sync_info_unavailable');

    const invalidPayload = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/settings/security',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_mail_security_settings_payload');

    const unsafePayload = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/workflow/settings/automation',
      body: {
        workspaceId: WORKSPACE_B_ID,
        imapDeleteOptIn: 'yes',
        spamScoreThreshold: 'bad',
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'imapDeleteOptIn', message: 'imapDeleteOptIn muss ein Boolean sein' },
      { field: 'spamScoreThreshold', message: 'spamScoreThreshold muss eine Zahl zwischen 1 und 100 sein' },
    ]));

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/settings/misc',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);
    expect((emptyPatch.body as any).error.code).toBe('validation_error');

    const invalidReplyAccount = await writableApi.handle({
      method: 'GET',
      path: '/api/v1/email/settings/reply-suggestion',
      query: { accountId: 'nope' },
      principal,
    });
    expect(invalidReplyAccount.status).toBe(400);

    const invalidSnooze = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/settings/snooze',
      body: { eveningHour: 24 },
      principal,
    });
    expect(invalidSnooze.status).toBe(400);
    expect((invalidSnooze.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'eveningHour', message: 'eveningHour muss eine Ganzzahl zwischen 0 und 23 sein' },
      { field: 'eveningMinute', message: 'eveningMinute ist erforderlich' },
    ]));
  });

  test('server notice routes list and dismiss sync_info backed mail notices', async () => {
    const uidKey = 'uidvalidity_notice:1';
    const imapKey = 'imap_auth_notice:5';
    const fallbackImapKey = 'imap_auth_notice:6';
    const store = new Map<string, string | null>([
      [uidKey, JSON.stringify([
        {
          id: '1:keep',
          accountId: 1,
          folderPath: 'INBOX',
          oldValidity: '1',
          newValidity: '2',
          messageCount: 5,
          backedUpCount: 3,
          at: '2026-06-03T09:00:00.000Z',
        },
        {
          id: '1:dismiss',
          accountId: 1,
          folderPath: 'Archive',
          oldValidity: '2',
          newValidity: '3',
          messageCount: 2,
          backedUpCount: 1,
          at: '2026-06-03T10:00:00.000Z',
        },
      ])],
      [imapKey, JSON.stringify({
        accountId: 5,
        message: 'OAuth refresh failed',
        at: '2026-06-03T11:00:00.000Z',
      })],
      [fallbackImapKey, 'plain auth failure'],
    ]);
    const getCalls: unknown[] = [];
    const setCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      syncInfo: {
        async getMany(input) {
          getCalls.push(input);
          return input.keys
            .filter((key) => store.has(key))
            .map((key) => ({
              key,
              value: store.get(key) ?? null,
              updatedAt: '2026-06-03T10:00:00.000Z',
            }));
        },
        async getByPrefix(input) {
          getCalls.push(input);
          return [...store.entries()]
            .filter(([key]) => key.startsWith(input.prefix))
            .slice(0, input.limit ?? 500)
            .map(([key, value]) => ({
              key,
              value,
              updatedAt: '2026-06-03T10:00:00.000Z',
            }));
        },
        async setMany(input) {
          setCalls.push(input);
          for (const [key, value] of Object.entries(input.values)) {
            store.set(key, value);
          }
          return Object.entries(input.values).map(([key, value]) => ({
            key,
            value,
            updatedAt: '2026-06-03T10:05:00.000Z',
          }));
        },
        async deleteMany(input) {
          deleteCalls.push(input);
          let count = 0;
          for (const key of input.keys) {
            if (store.delete(key)) count += 1;
          }
          return count;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const uidList = await api.handle({
      method: 'GET',
      path: '/api/v1/email/notices/uid-validity',
      principal,
    });
    expect(uidList.status).toBe(200);
    expect((uidList.body as any).data.items.map((notice: any) => notice.id)).toEqual([
      '1:dismiss',
      '1:keep',
    ]);

    const dismissUid = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/notices/uid-validity',
      query: { noticeId: '1:dismiss' },
      principal,
    });
    expect(dismissUid.status).toBe(200);
    expect(setCalls[0]).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      values: {
        [uidKey]: expect.any(String),
      },
    });
    expect(JSON.parse(store.get(uidKey) ?? '[]').map((notice: any) => notice.id)).toEqual(['1:keep']);

    const imapList = await api.handle({
      method: 'GET',
      path: '/api/v1/email/notices/imap-auth',
      principal,
    });
    expect(imapList.status).toBe(200);
    expect((imapList.body as any).data.items).toEqual([
      {
        accountId: 5,
        message: 'OAuth refresh failed',
        at: '2026-06-03T11:00:00.000Z',
      },
      {
        accountId: 6,
        message: 'plain auth failure',
        at: '',
      },
    ]);

    const dismissImap = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/notices/imap-auth',
      query: { accountId: '5' },
      principal,
    });
    expect(dismissImap.status).toBe(200);
    expect(store.has(imapKey)).toBe(false);
    expect(deleteCalls).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        keys: [imapKey],
      },
    ]);
    expect(auditEvents.map((event) => [event.action, event.entityId])).toEqual([
      ['email_notice.uid_validity.dismissed', '1:dismiss'],
      ['email_notice.imap_auth.dismissed', imapKey],
    ]);

    const invalidNoticeId = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/notices/uid-validity',
      query: { noticeId: '' },
      principal,
    });
    expect(invalidNoticeId.status).toBe(400);
  });

  test('server mail diagnostics route uses principal workspace and hides local-only fields', async () => {
    const collectCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      emailDiagnostics: {
        async collect(input) {
          collectCalls.push(input);
          return {
            collectedAt: '2026-06-04T10:00:00.000Z',
            schemaGeneration: 13,
            schemaGenerationLabel: '0013_email_compose_draft_fields Compose draft fields',
            paths: {
              databaseSqlite: 'C:/secret/database.sqlite',
            },
            sizes: {
              databaseBytes: -1,
              attachmentsBytes: 2048,
            },
            messages: {
              total: 12,
              pendingPostProcess: 2,
              outboundHold: 1,
              byFolderKind: {
                inbox: 9,
                sent: 3,
                '': 99,
              },
            },
            workflows: {
              runsLast24h: 5,
              runsBlockedLast24h: 1,
              runsErrorLast24h: 2,
            },
            aiUsage: {
              events24h: 3,
              tokens24h: 1500,
              costMicroUsd24h: 450,
              avgLatencyMs24h: 1200,
              events30d: 10,
              tokens30d: 5000,
              costMicroUsd30d: 1500,
              byNodeType24h: { 'ai.classify': 2, 'ai.agent': 1 },
            },
            notices: {
              imapAuth: 1,
              uidValidity: 0,
            },
            syncInfo: {
              totalKeys: 4,
              prefixes: {
                'imap_auth_notice:': 1,
              },
            },
            background: {
              cronScheduled: true,
              cronTickInFlight: false,
              syncInFlightAccountIds: [7, -1, 2.5, 8],
              idleImapAccountIds: [7],
            },
            accounts: [
              {
                id: 7,
                email: 'mail@example.com',
                protocol: 'imap',
                inboxLastSyncedAt: '2026-06-04T09:00:00.000Z',
              },
            ],
          } as any;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unauthorized = await api.handle({
      method: 'GET',
      path: '/api/v1/email/diagnostics',
    });
    expect(unauthorized.status).toBe(401);

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/email/diagnostics',
      principal,
    });
    expect(response.status).toBe(200);
    expect(collectCalls).toEqual([{ workspaceId: WORKSPACE_A_ID }]);
    expect((response.body as any).data).toEqual(expect.objectContaining({
      schemaGeneration: 13,
      sizes: {
        databaseBytes: null,
        attachmentsBytes: 2048,
      },
      messages: expect.objectContaining({
        total: 12,
        byFolderKind: {
          inbox: 9,
          sent: 3,
        },
      }),
      aiUsage: {
        events24h: 3,
        tokens24h: 1500,
        costMicroUsd24h: 450,
        avgLatencyMs24h: 1200,
        events30d: 10,
        tokens30d: 5000,
        costMicroUsd30d: 1500,
        byNodeType24h: { 'ai.classify': 2, 'ai.agent': 1 },
      },
      background: expect.objectContaining({
        cronScheduled: true,
        syncInFlightAccountIds: [7, 8],
      }),
      accounts: [
        {
          id: 7,
          email: 'mail@example.com',
          protocol: 'imap',
          inboxLastSyncedAt: '2026-06-04T09:00:00.000Z',
        },
      ],
    }));
    expect((response.body as any).data.paths).toBeUndefined();
    expect(JSON.stringify((response.body as any).data)).not.toContain('secret');

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'GET',
      path: '/api/v1/email/diagnostics',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('email_diagnostics_unavailable');
  });

  test('server workflow read routes pass validated AI and workflow filters to ports', async () => {
    const profileListCalls: unknown[] = [];
    const promptListCalls: unknown[] = [];
    const workflowListCalls: unknown[] = [];
    const workflowNodeCatalogCalls: unknown[] = [];
    const workflowTemplateCalls: unknown[] = [];
    const ports = makeServerApiPorts({
      aiProfiles: {
        async list(input) {
          profileListCalls.push(input);
          return {
            items: [withRuntimeLeaks(makeAiProfileRecord(21))],
            nextCursor: null,
          };
        },
        async get(input) {
          return input.id === 21 ? withRuntimeLeaks(makeAiProfileRecord(21)) : null;
        },
      },
      aiPrompts: {
        async list(input) {
          promptListCalls.push(input);
          return {
            items: [makeAiPromptRecord(22)],
            nextCursor: 22,
          };
        },
        async get(input) {
          return input.id === 22 ? makeAiPromptRecord(22) : null;
        },
      },
      workflows: {
        async list(input) {
          workflowListCalls.push(input);
          return {
            items: [makeWorkflowRecord(23)],
            nextCursor: null,
          };
        },
        async get(input) {
          return input.id === 23 ? makeWorkflowRecord(23) : null;
        },
      },
      workflowNodeCatalog: {
        list(input) {
          workflowNodeCatalogCalls.push(input);
          return [
            {
              type: 'logic.stop',
              label: 'Stopp',
              category: 'logic',
              canvasType: 'action',
              execute: 'should-not-leak',
            } as any,
            {
              type: 'code.javascript',
              label: 'JavaScript',
              category: 'code',
              canvasType: 'registry',
              defaultConfig: { code: 'should-not-run' },
            } as any,
          ];
        },
      },
      workflowTemplates: {
        list(input) {
          workflowTemplateCalls.push(input);
          return [{
            id: 'manual-ping-log',
            name: 'Manuell: System-Check',
            description: 'Manueller Trigger',
            trigger: 'manual',
            graph: { version: 1, nodes: [], edges: [] },
          }];
        },
      },
    });
    const api = createServerApi(ports);
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const nodeCatalog = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow/node-catalog',
      principal,
    });
    expect(nodeCatalog.status).toBe(200);
    expect((nodeCatalog.body as any).data).toEqual([{
      type: 'logic.stop',
      label: 'Stopp',
      category: 'logic',
      canvasType: 'action',
    }]);
    expect(JSON.stringify(nodeCatalog.body)).not.toContain('should-not-leak');
    expect(JSON.stringify(nodeCatalog.body)).not.toContain('code.javascript');
    expect(workflowNodeCatalogCalls).toEqual([{ workspaceId: WORKSPACE_A_ID }]);

    const templates = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow/templates',
      principal,
    });
    expect(templates.status).toBe(200);
    expect((templates.body as any).data).toEqual([{
      id: 'manual-ping-log',
      name: 'Manuell: System-Check',
      description: 'Manueller Trigger',
      trigger: 'manual',
      graph: { version: 1, nodes: [], edges: [] },
    }]);
    expect(workflowTemplateCalls).toEqual([{ workspaceId: WORKSPACE_A_ID }]);

    const plugins = await api.handle({
      method: 'GET',
      path: '/api/v1/workflow/plugins',
      principal,
    });
    expect(plugins.status).toBe(200);
    expect((plugins.body as any).data).toEqual([]);

    const profiles = await api.handle({
      method: 'GET',
      path: '/api/v1/ai/profiles',
      query: { search: ' OpenAI ', limit: '10' },
      principal,
    });
    expect(profiles.status).toBe(200);
    expect((profiles.body as any).data.items[0].apiKeyConfigured).toBe(true);
    expect(JSON.stringify(profiles.body)).not.toContain('secret-id');
    expect(JSON.stringify(profiles.body)).not.toContain('keytar');
    expect(profileListCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, limit: 10, search: 'OpenAI' }]);

    const prompts = await api.handle({
      method: 'GET',
      path: '/api/v1/ai/prompts',
      query: { search: ' Reply ', target: 'reply', profileId: '21', cursor: '20' },
      principal,
    });
    expect(prompts.status).toBe(200);
    expect((prompts.body as any).data.nextCursor).toBe(22);
    expect(promptListCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      search: 'Reply',
      target: 'reply',
      profileId: 21,
      cursor: 20,
    }]);

    const workflows = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows',
      query: { search: ' Route ', triggerName: 'mail.received', enabled: 'true' },
      principal,
    });
    expect(workflows.status).toBe(200);
    expect((workflows.body as any).data.items[0].name).toBe('Workflow 23');
    expect(workflowListCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      search: 'Route',
      triggerName: 'mail.received',
      enabled: true,
    }]);

    const profile = await api.handle({
      method: 'GET',
      path: '/api/v1/ai/profiles/21',
      principal,
    });
    expect(profile.status).toBe(200);

    const missingWorkflow = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows/99',
      principal,
    });
    expect(missingWorkflow.status).toBe(404);
  });

  test('server workflow read routes validate auth, IDs, filters, and missing ports', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unauthorized = await api.handle({ method: 'GET', path: '/api/v1/ai/profiles' });
    expect(unauthorized.status).toBe(401);

    const invalidProfileId = await api.handle({
      method: 'GET',
      path: '/api/v1/ai/profiles/nope',
      principal,
    });
    expect(invalidProfileId.status).toBe(400);
    expect((invalidProfileId.body as any).error.code).toBe('invalid_ai_profile_id');

    const invalidPromptProfileFilter = await api.handle({
      method: 'GET',
      path: '/api/v1/ai/prompts',
      query: { profileId: '0' },
      principal,
    });
    expect(invalidPromptProfileFilter.status).toBe(400);
    expect((invalidPromptProfileFilter.body as any).error.code).toBe('invalid_profile_id');

    const invalidEnabled = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows',
      query: { enabled: 'yes' },
      principal,
    });
    expect(invalidEnabled.status).toBe(400);
    expect((invalidEnabled.body as any).error.code).toBe('invalid_enabled');

    const invalidTarget = await api.handle({
      method: 'GET',
      path: '/api/v1/ai/prompts',
      query: { target: 'x'.repeat(101) },
      principal,
    });
    expect(invalidTarget.status).toBe(400);
    expect((invalidTarget.body as any).error.code).toBe('invalid_target');

    const unavailableProfiles = await api.handle({
      method: 'GET',
      path: '/api/v1/ai/profiles',
      principal,
    });
    expect(unavailableProfiles.status).toBe(503);
    expect((unavailableProfiles.body as any).error.code).toBe('ai_profiles_unavailable');

    const unavailableWorkflows = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows',
      principal,
    });
    expect(unavailableWorkflows.status).toBe(503);
    expect((unavailableWorkflows.body as any).error.code).toBe('workflows_unavailable');
  });

  test('server AI profile mutation routes write audit records and server events without exposing secrets', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      aiProfiles: {
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
            profile: {
              ...makeAiProfileRecord(21),
              sourceSqliteId: -21,
              label: input.values.label ?? 'Primary OpenAI',
              provider: input.values.provider ?? 'openai',
              baseUrl: input.values.baseUrl ?? 'https://api.openai.com/v1',
              model: input.values.model ?? 'gpt-4.1',
              embeddingModel: input.values.embeddingModel ?? null,
              isDefault: input.values.isDefault ?? false,
              sortOrder: input.values.sortOrder ?? 0,
              apiKeyConfigured: typeof input.values.apiKey === 'string',
            },
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 21
            ? {
              ok: true,
              profile: {
                ...makeAiProfileRecord(21),
                sourceSqliteId: -21,
                model: input.values.model ?? 'gpt-4.1',
                embeddingModel: input.values.embeddingModel === undefined
                  ? 'text-embedding-3-small'
                  : input.values.embeddingModel,
                isDefault: input.values.isDefault ?? true,
                apiKeyConfigured: input.values.apiKey === null ? false : true,
              },
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 21
            ? { ok: true, profile: { ...makeAiProfileRecord(21), sourceSqliteId: -21 } }
            : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/ai/profiles',
      body: {
        label: ' Primary OpenAI ',
        provider: ' openai ',
        baseUrl: 'https://api.openai.com/v1/',
        model: ' gpt-4.1 ',
        embeddingModel: ' text-embedding-3-small ',
        isDefault: 'true',
        sortOrder: '2',
        apiKey: ' sk-test ',
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect((created.body as any).data.apiKeyConfigured).toBe(true);
    expect(JSON.stringify(created.body)).not.toContain('sk-test');
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        label: 'Primary OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        embeddingModel: 'text-embedding-3-small',
        isDefault: true,
        sortOrder: 2,
        apiKey: 'sk-test',
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/ai/profiles/21',
      body: { model: 'gpt-4.2', embeddingModel: null, apiKey: null, isDefault: false },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.apiKeyConfigured).toBe(false);
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 21,
      values: {
        model: 'gpt-4.2',
        embeddingModel: null,
        isDefault: false,
        apiKey: null,
      },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/ai/profiles/21',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 21 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'ai_profile.created',
      'ai_profile.updated',
      'ai_profile.deleted',
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain('sk-test');
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['ai_profile.created', WORKSPACE_A_ID, 'ai_profile', '21'],
      ['ai_profile.updated', WORKSPACE_A_ID, 'ai_profile', '21'],
      ['ai_profile.deleted', WORKSPACE_A_ID, 'ai_profile', '21'],
    ]);
    expect(JSON.stringify(events)).not.toContain('sk-test');
    expect(events[0].payload).toMatchObject({
      id: 21,
      sourceSqliteId: -21,
      label: 'Primary OpenAI',
      provider: 'openai',
      baseUrl: 'https://api.openai.com/v1',
      model: 'gpt-4.1',
      embeddingModel: 'text-embedding-3-small',
      isDefault: true,
      sortOrder: 2,
      apiKeyConfigured: true,
    });
  });

  test('server AI profile mutation routes reject unsafe payloads and unavailable secret storage', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      aiProfiles: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      aiProfiles: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.apiKey === 'needs-secret-port') return { ok: false, code: 'secret_port_unavailable' };
          return { ok: true, profile: makeAiProfileRecord(21) };
        },
        async update(input) {
          if (input.values.apiKey === 'needs-secret-port') return { ok: false, code: 'secret_port_unavailable' };
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
      path: '/api/v1/ai/profiles',
      body: {
        label: 'OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
      },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/ai/profiles',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_ai_profile_payload');

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/ai/profiles',
      body: {
        workspaceId: WORKSPACE_B_ID,
        label: 123,
        provider: ' ',
        baseUrl: 'file:///tmp/key',
        model: '',
        embeddingModel: '',
        isDefault: 'yes',
        sortOrder: -1,
        apiKey: '',
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'label', message: 'label muss ein String sein' },
      { field: 'provider', message: 'provider darf nicht leer sein' },
      { field: 'baseUrl', message: 'baseUrl muss eine http- oder https-URL sein' },
      { field: 'model', message: 'model darf nicht leer sein' },
      { field: 'embeddingModel', message: 'embeddingModel darf nicht leer sein' },
      { field: 'isDefault', message: 'isDefault muss ein Boolean sein' },
      { field: 'sortOrder', message: 'sortOrder muss eine nichtnegative Ganzzahl sein' },
      { field: 'apiKey', message: 'apiKey darf nicht leer sein' },
    ]));

    const missingRequired = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/ai/profiles',
      body: { label: 'OpenAI' },
      principal,
    });
    expect(missingRequired.status).toBe(400);

    const secretUnavailable = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/ai/profiles',
      body: {
        label: 'OpenAI',
        provider: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: 'gpt-4.1',
        apiKey: 'needs-secret-port',
      },
      principal,
    });
    expect(secretUnavailable.status).toBe(503);
    expect((secretUnavailable.body as any).error.code).toBe('ai_profile_secret_unavailable');

    const invalidId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/ai/profiles/0',
      body: { model: 'gpt-4.1' },
      principal,
    });
    expect(invalidId.status).toBe(400);

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/ai/profiles/21',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const secretUnavailableUpdate = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/ai/profiles/21',
      body: { apiKey: 'needs-secret-port' },
      principal,
    });
    expect(secretUnavailableUpdate.status).toBe(503);

    const missingWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/ai/profiles/22', body: { model: 'gpt-4.1' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/ai/profiles/22', principal }),
    ]);
    expect(missingWrites.map((response) => response.status)).toEqual([404, 404]);
  });

  test('server AI prompt mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const reorderCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      aiPrompts: {
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
            prompt: {
              ...makeAiPromptRecord(22),
              sourceSqliteId: -22,
              label: input.values.label ?? 'Reply prompt',
              userTemplate: input.values.userTemplate ?? 'Prompt template',
              target: input.values.target ?? 'reply',
              profileId: input.values.profileId ?? null,
              profileSourceSqliteId: input.values.profileId === undefined || input.values.profileId === null ? null : 210,
              sortOrder: input.values.sortOrder ?? 0,
            },
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 22
            ? {
              ok: true,
              prompt: {
                ...makeAiPromptRecord(22),
                sourceSqliteId: -22,
                target: input.values.target ?? 'reply',
                profileId: input.values.profileId === undefined ? 21 : input.values.profileId,
                profileSourceSqliteId: input.values.profileId === null ? null : 210,
              },
            }
            : null;
        },
        async reorder(input) {
          reorderCalls.push(input);
          return {
            ok: true,
            prompts: input.updates.map((update) => ({
              ...makeAiPromptRecord(update.id),
              sourceSqliteId: -update.id,
              sortOrder: update.sortOrder,
            })),
          };
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 22 ? { ...makeAiPromptRecord(22), sourceSqliteId: -22 } : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/ai/prompts',
      body: {
        label: ' Reply prompt ',
        userTemplate: ' {{message.body}} ',
        target: ' reply ',
        profileId: '21',
        sortOrder: '2',
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        label: 'Reply prompt',
        userTemplate: '{{message.body}}',
        target: 'reply',
        profileId: 21,
        sortOrder: 2,
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/ai/prompts/22',
      body: { target: 'summary', profileId: null },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.profileId).toBeNull();
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 22,
      values: { target: 'summary', profileId: null },
    }]);

    const reordered = await api.handle({
      method: 'POST',
      path: '/api/v1/ai/prompts/reorder',
      body: {
        updates: [
          { id: 22, sortOrder: 0 },
          { id: 23, sortOrder: 1 },
        ],
      },
      principal,
    });
    expect(reordered.status).toBe(200);
    expect((reordered.body as any).data.success).toBe(true);
    expect(reorderCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      updates: [
        { id: 22, sortOrder: 0 },
        { id: 23, sortOrder: 1 },
      ],
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/ai/prompts/22',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 22 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'ai_prompt.created',
      'ai_prompt.updated',
      'ai_prompt.updated',
      'ai_prompt.updated',
      'ai_prompt.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['ai_prompt.created', WORKSPACE_A_ID, 'ai_prompt', '22'],
      ['ai_prompt.updated', WORKSPACE_A_ID, 'ai_prompt', '22'],
      ['ai_prompt.updated', WORKSPACE_A_ID, 'ai_prompt', '22'],
      ['ai_prompt.updated', WORKSPACE_A_ID, 'ai_prompt', '23'],
      ['ai_prompt.deleted', WORKSPACE_A_ID, 'ai_prompt', '22'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 22,
      sourceSqliteId: -22,
      label: 'Reply prompt',
      target: 'reply',
      profileId: 21,
      profileSourceSqliteId: 210,
      sortOrder: 2,
    });
  });

  test('server AI prompt mutation routes reject unsafe payloads and invalid references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      aiPrompts: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      aiPrompts: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.profileId === 99) return { ok: false, code: 'profile_not_found' };
          return { ok: true, prompt: makeAiPromptRecord(22) };
        },
        async update(input) {
          if (input.values.profileId === 99) return { ok: false, code: 'profile_not_found' };
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
      path: '/api/v1/ai/prompts',
      body: { label: 'Reply', userTemplate: 'Body', target: 'reply' },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/ai/prompts',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_ai_prompt_payload');

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/ai/prompts',
      body: {
        workspaceId: WORKSPACE_B_ID,
        label: 123,
        userTemplate: ' ',
        target: 'x'.repeat(101),
        profileId: 0,
        sortOrder: -1,
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'label', message: 'label muss ein String sein' },
      { field: 'userTemplate', message: 'userTemplate darf nicht leer sein' },
      { field: 'target', message: 'target darf maximal 100 Zeichen haben' },
      { field: 'profileId', message: 'profileId muss eine positive Ganzzahl sein' },
      { field: 'sortOrder', message: 'sortOrder muss eine nichtnegative Ganzzahl sein' },
    ]));

    const missingRequired = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/ai/prompts',
      body: { label: 'Reply' },
      principal,
    });
    expect(missingRequired.status).toBe(400);

    const missingProfile = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/ai/prompts',
      body: { label: 'Reply', userTemplate: 'Body', target: 'reply', profileId: 99 },
      principal,
    });
    expect(missingProfile.status).toBe(404);
    expect((missingProfile.body as any).error.code).toBe('ai_profile_not_found');

    const invalidId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/ai/prompts/0',
      body: { target: 'reply' },
      principal,
    });
    expect(invalidId.status).toBe(400);

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/ai/prompts/22',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const missingPatchProfile = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/ai/prompts/22',
      body: { profileId: 99 },
      principal,
    });
    expect(missingPatchProfile.status).toBe(404);

    const missingWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/ai/prompts/22', body: { target: 'reply' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/ai/prompts/22', principal }),
    ]);
    expect(missingWrites.map((response) => response.status)).toEqual([404, 404]);
  });

  test('server AI text transform route validates payloads and returns IPC-compatible results', async () => {
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      aiTextTransform: {
        async transformText(input) {
          calls.push(input);
          return { success: true, text: 'Freundlicher Text' };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const transformed = await api.handle({
      method: 'POST',
      path: '/api/v1/ai/transform-text',
      body: {
        promptId: '22',
        text: ' Bitte freundlicher ',
        customerId: '7',
      },
      principal,
    });
    expect(transformed.status).toBe(200);
    expect((transformed.body as any).data).toEqual({
      success: true,
      text: 'Freundlicher Text',
    });
    expect(calls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      promptId: 22,
      text: 'Bitte freundlicher',
      customerId: 7,
    }]);

    const failed = await createServerApi(makeServerApiPorts({
      aiTextTransform: {
        async transformText() {
          return { success: false, error: 'Prompt nicht gefunden' };
        },
      },
    })).handle({
      method: 'POST',
      path: '/api/v1/ai/transform-text',
      body: { promptId: 22, text: 'Hallo' },
      principal,
    });
    expect(failed.status).toBe(200);
    expect((failed.body as any).data).toEqual({
      success: false,
      error: 'Prompt nicht gefunden',
    });

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/ai/transform-text',
      body: { promptId: 0, text: '', extra: true },
      principal,
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'extra', message: 'Feld ist nicht erlaubt' },
      { field: 'promptId', message: 'promptId muss eine positive Ganzzahl sein' },
      { field: 'text', message: 'text darf nicht leer sein' },
    ]));

    const insertMode = await api.handle({
      method: 'POST',
      path: '/api/v1/ai/transform-text',
      body: {
        promptId: '22',
        text: '',
        insertMode: true,
        inboundContextText: 'Kundenanfrage',
      },
      principal,
    });
    expect(insertMode.status).toBe(200);
    expect(calls.at(-1)).toEqual(expect.objectContaining({
      promptId: 22,
      text: '',
      insertMode: true,
      inboundContextText: 'Kundenanfrage',
    }));

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'POST',
      path: '/api/v1/ai/transform-text',
      body: { promptId: 22, text: 'Hallo' },
      principal,
    });
    expect(unavailable.status).toBe(503);
  });

  test('server workflow graph compile route returns legacy-compatible compile results', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };
    const graph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'condition-1', type: 'condition', data: { field: 'subject', op: 'contains', value: 'VIP' } },
        { id: 'action-1', type: 'action', data: { actionType: 'tag', tag: 'vip' } },
      ],
      edges: [
        { id: 'edge-1', source: 'trigger-1', target: 'condition-1' },
        { id: 'edge-2', source: 'condition-1', target: 'action-1', label: 'yes' },
      ],
    };

    const compiled = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/compile-graph',
      body: graph,
      principal,
    });
    expect(compiled.status).toBe(200);
    expect((compiled.body as any).data).toEqual({
      success: true,
      definitionJson: '{"version":1,"rules":[{"when":{"field":"subject","op":"contains","value":"VIP"},"then":[{"type":"tag","tag":"vip"}]}]}',
      registryOnly: false,
    });

    const registryOnly = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/compile-graph',
      body: {
        graphJson: JSON.stringify({
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            { id: 'registry-1', type: 'registry', data: { nodeType: 'logic.stop', config: {} } },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'registry-1' }],
        }),
      },
      principal,
    });
    expect(registryOnly.status).toBe(200);
    expect((registryOnly.body as any).data).toMatchObject({
      success: true,
      registryOnly: true,
    });

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/compile-graph',
      body: { graphJson: '{' },
      principal,
    });
    expect(invalid.status).toBe(200);
    expect((invalid.body as any).data).toEqual({
      success: false,
      error: 'Workflow graph JSON ist ungueltig',
    });

    const unauthorized = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows/compile-graph',
      body: graph,
    });
    expect(unauthorized.status).toBe(401);
  });

  test('server workflow mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      workflows: {
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
            workflow: {
              ...makeWorkflowRecord(23),
              sourceSqliteId: -23,
              name: input.values.name ?? 'Inbound triage',
              triggerName: input.values.triggerName ?? 'mail.received',
              enabled: input.values.enabled ?? true,
              priority: input.values.priority ?? 100,
              definition: input.values.definition ?? { nodes: [] },
              graph: input.values.graph ?? null,
              cronExpr: input.values.cronExpr ?? null,
              scheduleAccountSourceSqliteId: input.values.scheduleAccountId === undefined
                || input.values.scheduleAccountId === null
                ? null
                : 1,
              scheduleAccountId: input.values.scheduleAccountId ?? null,
              executionMode: input.values.executionMode ?? 'graph',
              engineVersion: input.values.engineVersion ?? 1,
              createdByUserId: input.actorUserId,
            },
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 23
            ? {
              ok: true,
              workflow: {
                ...makeWorkflowRecord(23),
                sourceSqliteId: -23,
                enabled: input.values.enabled ?? true,
                graph: input.values.graph === undefined ? { nodes: [] } : input.values.graph,
                scheduleAccountId: input.values.scheduleAccountId === undefined ? 1 : input.values.scheduleAccountId,
                scheduleAccountSourceSqliteId: input.values.scheduleAccountId === null ? null : 1,
              },
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 23 ? { ...makeWorkflowRecord(23), sourceSqliteId: -23 } : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows',
      body: {
        name: ' Inbound triage ',
        triggerName: ' mail.received ',
        enabled: 'false',
        priority: '5',
        definition: { nodes: [{ id: 'start', type: 'trigger' }] },
        graph: { edges: [] },
        cronExpr: ' 0 8 * * * ',
        scheduleAccountId: '1',
        executionMode: ' graph ',
        engineVersion: '2',
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        name: 'Inbound triage',
        triggerName: 'mail.received',
        enabled: false,
        priority: 5,
        definition: { nodes: [{ id: 'start', type: 'trigger' }] },
        graph: { edges: [] },
        cronExpr: '0 8 * * *',
        scheduleAccountId: 1,
        executionMode: 'graph',
        engineVersion: 2,
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/23',
      body: { enabled: true, graph: null, scheduleAccountId: null },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.scheduleAccountId).toBeNull();
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 23,
      values: { enabled: true, graph: null, scheduleAccountId: null },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/workflows/23',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 23 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'workflow.created',
      'workflow.updated',
      'workflow.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['workflow.created', WORKSPACE_A_ID, 'workflow', '23'],
      ['workflow.updated', WORKSPACE_A_ID, 'workflow', '23'],
      ['workflow.deleted', WORKSPACE_A_ID, 'workflow', '23'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 23,
      sourceSqliteId: -23,
      name: 'Inbound triage',
      triggerName: 'mail.received',
      enabled: false,
      priority: 5,
      scheduleAccountId: 1,
      executionMode: 'graph',
      engineVersion: 2,
    });
  });

  test('server workflow by-source routes resolve legacy ids before mutations', async () => {
    const listCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      workflows: {
        async list(input) {
          listCalls.push(input);
          return {
            items: [{ ...makeWorkflowRecord(23), sourceSqliteId: -23 }],
            nextCursor: null,
          };
        },
        async get() {
          return null;
        },
        async update(input) {
          updateCalls.push(input);
          return {
            ok: true,
            workflow: {
              ...makeWorkflowRecord(23),
              sourceSqliteId: -23,
              enabled: input.values.enabled ?? true,
            },
          };
        },
        async delete(input) {
          deleteCalls.push(input);
          return { ...makeWorkflowRecord(23), sourceSqliteId: -23 };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const fetched = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows/by-source/-23',
      principal,
    });
    expect(fetched.status).toBe(200);
    expect((fetched.body as any).data.sourceSqliteId).toBe(-23);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/by-source/-23',
      body: { enabled: false },
      principal,
    });
    expect(updated.status).toBe(200);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/workflows/by-source/-23',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 23,
      values: { enabled: false },
    }]);
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 23 }]);
    expect(listCalls).toHaveLength(3);

    const invalid = await api.handle({
      method: 'GET',
      path: '/api/v1/workflows/by-source/0',
      principal,
    });
    expect(invalid.status).toBe(400);
  });

});
