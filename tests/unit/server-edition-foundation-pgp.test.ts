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

describe('server edition foundation — pgp', () => {
  test('server PGP identity mutation routes reject unsafe payloads and secret edge cases', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      pgpIdentities: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      pgpIdentities: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.fingerprint === 'duplicate') return { ok: false, code: 'fingerprint_conflict' };
          if (input.values.fingerprint === 'needs-secret') return { ok: false, code: 'private_key_secret_unavailable' };
          return { ok: true, identity: makePgpIdentityRecord(41) };
        },
        async update(input) {
          if (input.values.fingerprint === 'needs-rewrite') return { ok: false, code: 'private_key_rewrite_required' };
          if (input.values.privateKeyArmored === 'needs-secret') return { ok: false, code: 'private_key_secret_unavailable' };
          return null;
        },
        async delete(input) {
          if (input.id === 42) return { ok: false, code: 'private_key_secret_unavailable' };
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/identities',
      body: { email: 'identity@example.com', fingerprint: 'fingerprint', publicKeyArmor: 'public-key' },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/identities',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_pgp_identity_payload');

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/identities',
      body: {
        workspaceId: WORKSPACE_B_ID,
        userId: USER_B_ID,
        email: 123,
        fingerprint: ' ',
        publicKeyArmor: 123,
        privateKeyArmored: 'private-key',
        expiresAt: 'not-a-date',
        isPrimary: 'yes',
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'userId', message: 'Feld ist nicht erlaubt' },
      { field: 'email', message: 'email muss ein String sein' },
      { field: 'fingerprint', message: 'fingerprint darf nicht leer sein' },
      { field: 'publicKeyArmor', message: 'publicKeyArmor muss ein String sein' },
      { field: 'privateKeyPassphrase', message: 'privateKeyPassphrase ist fuer privateKeyArmored erforderlich' },
      { field: 'expiresAt', message: 'expiresAt muss ein valides Datum sein' },
      { field: 'isPrimary', message: 'isPrimary muss ein Boolean sein' },
    ]));

    const missingRequired = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/identities',
      body: { email: 'identity@example.com' },
      principal,
    });
    expect(missingRequired.status).toBe(400);

    const duplicate = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/identities',
      body: { email: 'identity@example.com', fingerprint: 'duplicate', publicKeyArmor: 'public-key' },
      principal,
    });
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as any).error.code).toBe('pgp_identity_fingerprint_conflict');

    const secretUnavailable = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/identities',
      body: {
        email: 'identity@example.com',
        fingerprint: 'needs-secret',
        publicKeyArmor: 'public-key',
        privateKeyArmored: 'private-key',
        privateKeyPassphrase: 'passphrase',
      },
      principal,
    });
    expect(secretUnavailable.status).toBe(503);
    expect((secretUnavailable.body as any).error.code).toBe('pgp_identity_private_key_secret_unavailable');

    const rewriteRequired = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/pgp/identities/41',
      body: { fingerprint: 'needs-rewrite' },
      principal,
    });
    expect(rewriteRequired.status).toBe(409);
    expect((rewriteRequired.body as any).error.code).toBe('pgp_identity_private_key_rewrite_required');

    const invalidId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/pgp/identities/nope',
      body: { email: 'identity@example.com' },
      principal,
    });
    expect(invalidId.status).toBe(400);

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/pgp/identities/41',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const updateSecretUnavailable = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/pgp/identities/41',
      body: { privateKeyArmored: 'needs-secret', privateKeyPassphrase: 'passphrase' },
      principal,
    });
    expect(updateSecretUnavailable.status).toBe(503);

    const deleteSecretUnavailable = await writableApi.handle({
      method: 'DELETE',
      path: '/api/v1/pgp/identities/42',
      principal,
    });
    expect(deleteSecretUnavailable.status).toBe(503);

    const missingWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/pgp/identities/41', body: { email: 'identity@example.com' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/pgp/identities/41', principal }),
    ]);
    expect(missingWrites.map((response) => response.status)).toEqual([404, 404]);
  });

  test('server PGP identity passphrase rotation route preserves secrets and publishes sanitized events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const rotateCalls: unknown[] = [];
    const identity = {
      ...makePgpIdentityRecord(41),
      sourceSqliteId: -41,
      userId: USER_A_ID,
      email: 'identity@example.com',
      fingerprint: 'PGP-FINGERPRINT-41',
      hasPrivateKey: true,
      privateKeyConfigured: true,
    };
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      pgpIdentities: {
        async list() {
          return { items: [identity], nextCursor: null };
        },
        async get() {
          return null;
        },
        async rotatePrivateKeyPassphrase(input) {
          rotateCalls.push(input);
          if (input.id === 42) return { ok: false, code: 'private_key_unavailable' };
          if (input.id === 43) return { ok: false, code: 'private_key_secret_unavailable' };
          if (input.id === 44) return { ok: false, code: 'decrypt_failed' };
          return input.id === 41 ? { ok: true, identity } : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const rotated = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/identities/by-source/-41/private-key/passphrase',
      body: {
        currentPassphrase: ' old passphrase with spaces ',
        nextPassphrase: ' new passphrase with spaces ',
      },
      principal,
    });

    expect(rotated.status).toBe(200);
    expect((rotated.body as any).data.privateKeyConfigured).toBe(true);
    expect(rotateCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 41,
      currentPassphrase: ' old passphrase with spaces ',
      nextPassphrase: ' new passphrase with spaces ',
    });
    expect(auditEvents.map((event) => event.action)).toEqual(['pgp_identity.private_key_passphrase_rotated']);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['pgp_identity.updated', WORKSPACE_A_ID, 'pgp_identity', '41'],
    ]);
    expect(JSON.stringify(rotated.body)).not.toContain('old passphrase');
    expect(JSON.stringify(rotated.body)).not.toContain('new passphrase');
    expect(JSON.stringify(auditEvents)).not.toContain('old passphrase');
    expect(JSON.stringify(auditEvents)).not.toContain('new passphrase');
    expect(JSON.stringify(events)).not.toContain('old passphrase');
    expect(JSON.stringify(events)).not.toContain('new passphrase');

    const failures = await Promise.all([
      api.handle({
        method: 'POST',
        path: '/api/v1/pgp/identities/42/private-key/passphrase',
        body: { currentPassphrase: 'old', nextPassphrase: 'new' },
        principal,
      }),
      api.handle({
        method: 'POST',
        path: '/api/v1/pgp/identities/43/private-key/passphrase',
        body: { currentPassphrase: 'old', nextPassphrase: 'new' },
        principal,
      }),
      api.handle({
        method: 'POST',
        path: '/api/v1/pgp/identities/44/private-key/passphrase',
        body: { currentPassphrase: 'old', nextPassphrase: 'new' },
        principal,
      }),
      api.handle({
        method: 'POST',
        path: '/api/v1/pgp/identities/45/private-key/passphrase',
        body: { currentPassphrase: 'old', nextPassphrase: 'new' },
        principal,
      }),
      api.handle({
        method: 'POST',
        path: '/api/v1/pgp/identities/nope/private-key/passphrase',
        body: { currentPassphrase: 'old', nextPassphrase: 'new' },
        principal,
      }),
      api.handle({
        method: 'POST',
        path: '/api/v1/pgp/identities/41/private-key/passphrase',
        body: { currentPassphrase: ' ', nextPassphrase: 'new', extra: true },
        principal,
      }),
    ]);
    expect(failures.map((response) => response.status)).toEqual([409, 503, 400, 404, 400, 400]);
    expect((failures[0].body as any).error.code).toBe('pgp_identity_private_key_unavailable');
    expect((failures[1].body as any).error.code).toBe('pgp_identity_private_key_secret_unavailable');
    expect((failures[2].body as any).error.code).toBe('pgp_identity_private_key_decrypt_failed');
    expect((failures[3].body as any).error.code).toBe('pgp_identity_not_found');
    expect((failures[4].body as any).error.code).toBe('invalid_pgp_identity_id');
    expect((failures[5].body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'currentPassphrase', message: 'currentPassphrase darf nicht leer sein' },
      { field: 'extra', message: 'Feld ist nicht erlaubt' },
    ]));

    const unavailable = await createServerApi(makeServerApiPorts({
      pgpIdentities: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    })).handle({
      method: 'POST',
      path: '/api/v1/pgp/identities/41/private-key/passphrase',
      body: { currentPassphrase: 'old', nextPassphrase: 'new' },
      principal,
    });
    expect(unavailable.status).toBe(503);
  });

  test('server PGP peer key mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      pgpPeerKeys: {
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
            peerKey: {
              ...makePgpPeerKeyRecord(42),
              sourceSqliteId: -42,
              email: input.values.email ?? 'peer@example.com',
              fingerprint: input.values.fingerprint ?? 'fingerprint-42',
              publicKeyArmor: input.values.publicKeyArmor ?? 'public-key',
              source: input.values.source ?? 'server_api',
              verifiedAt: input.values.verifiedAt ?? null,
              verifiedByUserId: input.values.verifiedAt ? USER_A_ID : null,
              trustLevel: input.values.trustLevel ?? 'unknown',
            },
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 42
            ? {
              ok: true,
              peerKey: {
                ...makePgpPeerKeyRecord(42),
                sourceSqliteId: -42,
                trustLevel: input.values.trustLevel ?? 'verified',
                verifiedAt: input.values.verifiedAt === undefined ? '2026-06-01T12:00:00.000Z' : input.values.verifiedAt,
                verifiedByUserId: input.values.verifiedAt === null ? null : USER_A_ID,
              },
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 42 ? { ...makePgpPeerKeyRecord(42), sourceSqliteId: -42 } : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/peer-keys',
      body: {
        email: ' peer@example.com ',
        fingerprint: ' fingerprint-42 ',
        publicKeyArmor: ' -----BEGIN PGP PUBLIC KEY BLOCK-----\npeer\n-----END PGP PUBLIC KEY BLOCK----- ',
        source: ' manual ',
        verifiedAt: '2026-06-03T08:00:00.000Z',
        trustLevel: ' verified ',
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        email: 'peer@example.com',
        fingerprint: 'fingerprint-42',
        publicKeyArmor: '-----BEGIN PGP PUBLIC KEY BLOCK-----\npeer\n-----END PGP PUBLIC KEY BLOCK-----',
        source: 'manual',
        verifiedAt: '2026-06-03T08:00:00.000Z',
        trustLevel: 'verified',
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/pgp/peer-keys/42',
      body: { verifiedAt: null, trustLevel: 'revoked' },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.verifiedAt).toBeNull();
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 42,
      values: { verifiedAt: null, trustLevel: 'revoked' },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/pgp/peer-keys/42',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 42 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'pgp_peer_key.created',
      'pgp_peer_key.updated',
      'pgp_peer_key.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['pgp_peer_key.created', WORKSPACE_A_ID, 'pgp_peer_key', '42'],
      ['pgp_peer_key.updated', WORKSPACE_A_ID, 'pgp_peer_key', '42'],
      ['pgp_peer_key.deleted', WORKSPACE_A_ID, 'pgp_peer_key', '42'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 42,
      sourceSqliteId: -42,
      email: 'peer@example.com',
      fingerprint: 'fingerprint-42',
      trustLevel: 'verified',
      verifiedByUserId: USER_A_ID,
    });
  });

  test('server PGP peer key mutation routes reject unsafe payloads and conflicts', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      pgpPeerKeys: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      pgpPeerKeys: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create() {
          return { ok: false, code: 'fingerprint_conflict' };
        },
        async update(input) {
          if (input.values.fingerprint === 'duplicate') return { ok: false, code: 'fingerprint_conflict' };
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
      path: '/api/v1/pgp/peer-keys',
      body: { email: 'peer@example.com', fingerprint: 'fingerprint', publicKeyArmor: 'public-key' },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/peer-keys',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_pgp_peer_key_payload');

    const unsafePayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/peer-keys',
      body: {
        workspaceId: WORKSPACE_B_ID,
        verifiedByUserId: USER_B_ID,
        email: 123,
        fingerprint: ' ',
        publicKeyArmor: 123,
        verifiedAt: 'not-a-date',
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'verifiedByUserId', message: 'Feld ist nicht erlaubt' },
      { field: 'email', message: 'email muss ein String sein' },
      { field: 'fingerprint', message: 'fingerprint darf nicht leer sein' },
      { field: 'publicKeyArmor', message: 'publicKeyArmor muss ein String sein' },
      { field: 'verifiedAt', message: 'verifiedAt muss ein valides Datum sein' },
    ]));

    const missingFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/peer-keys',
      body: { email: 'peer@example.com' },
      principal,
    });
    expect(missingFields.status).toBe(400);

    const conflictingCreate = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/pgp/peer-keys',
      body: { email: 'peer@example.com', fingerprint: 'duplicate', publicKeyArmor: 'public-key' },
      principal,
    });
    expect(conflictingCreate.status).toBe(409);
    expect((conflictingCreate.body as any).error.code).toBe('pgp_peer_key_fingerprint_conflict');

    const invalidId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/pgp/peer-keys/0',
      body: { trustLevel: 'verified' },
      principal,
    });
    expect(invalidId.status).toBe(400);

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/pgp/peer-keys/42',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const conflictingPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/pgp/peer-keys/42',
      body: { fingerprint: 'duplicate' },
      principal,
    });
    expect(conflictingPatch.status).toBe(409);

    const missingWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/pgp/peer-keys/42', body: { trustLevel: 'verified' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/pgp/peer-keys/42', principal }),
    ]);
    expect(missingWrites.map((response) => response.status)).toEqual([404, 404]);
  });

  test('server PGP message decrypt route validates payloads and maps port failures', async () => {
    const decryptCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      pgpMessages: {
        async decryptMessage(input) {
          decryptCalls.push(input);
          if (input.messageId === 41) {
            return { ok: true, result: { text: 'decrypted body', status: 'decrypted' } };
          }
          if (input.messageId === 42) return { ok: false, code: 'not_pgp_message' };
          if (input.messageId === 43) return { ok: false, code: 'private_key_unavailable' };
          if (input.messageId === 44) return { ok: false, code: 'private_key_secret_unavailable' };
          if (input.messageId === 45) return { ok: false, code: 'decrypt_failed', message: 'bad passphrase' };
          return { ok: false, code: 'message_not_found' };
        },
        async verifyMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async prepareOutboundBody(input) {
          return { ok: true, bodyText: input.bodyText };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const success = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/41/decrypt',
      body: { passphrase: ' passphrase with spaces ' },
      principal,
    });
    expect(success.status).toBe(200);
    expect((success.body as any).data).toEqual({ text: 'decrypted body', status: 'decrypted' });
    expect(decryptCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 41,
      passphrase: ' passphrase with spaces ',
    });

    const failures = await Promise.all([
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/42/decrypt', body: { passphrase: 'passphrase' }, principal }),
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/43/decrypt', body: { passphrase: 'passphrase' }, principal }),
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/44/decrypt', body: { passphrase: 'passphrase' }, principal }),
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/45/decrypt', body: { passphrase: 'passphrase' }, principal }),
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/46/decrypt', body: { passphrase: 'passphrase' }, principal }),
    ]);
    expect(failures.map((response) => response.status)).toEqual([400, 409, 503, 400, 404]);
    expect((failures[0].body as any).error.code).toBe('pgp_message_not_encrypted');
    expect((failures[1].body as any).error.code).toBe('pgp_private_key_unavailable');
    expect((failures[2].body as any).error.code).toBe('pgp_private_key_secret_unavailable');
    expect((failures[3].body as any).error.message).toBe('bad passphrase');
    expect((failures[4].body as any).error.code).toBe('pgp_message_not_found');

    const invalidId = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/nope/decrypt',
      body: { passphrase: 'passphrase' },
      principal,
    });
    expect(invalidId.status).toBe(400);
    expect((invalidId.body as any).error.code).toBe('invalid_pgp_message_id');

    const invalidPayload = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/41/decrypt',
      body: { passphrase: '', workspaceId: WORKSPACE_B_ID },
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'passphrase', message: 'passphrase darf nicht leer sein' },
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
    ]));

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/41/decrypt',
      body: { passphrase: 'passphrase' },
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('pgp_messages_unavailable');
  });

  test('server PGP message verify route maps signature status and failures', async () => {
    const verifyCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      pgpMessages: {
        async detectMessage() {
          return { ok: true, result: { detected: false, status: null } };
        },
        async decryptMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async verifyMessage(input) {
          verifyCalls.push(input);
          if (input.messageId === 41) {
            return {
              ok: true,
              result: {
                valid: true,
                status: 'signed_valid',
                fingerprint: 'abcdef1234567890',
              },
            };
          }
          if (input.messageId === 42) return { ok: true, result: { valid: false, status: 'key_missing' } };
          if (input.messageId === 43) return { ok: false, code: 'not_signed' };
          if (input.messageId === 44) return { ok: false, code: 'verify_failed', message: 'bad signature armor' };
          return { ok: false, code: 'message_not_found' };
        },
        async prepareOutboundBody(input) {
          return { ok: true, bodyText: input.bodyText };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const success = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/41/verify',
      principal,
    });
    expect(success.status).toBe(200);
    expect((success.body as any).data).toEqual({
      valid: true,
      status: 'signed_valid',
      fingerprint: 'abcdef1234567890',
    });
    expect(verifyCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 41,
    });

    const failures = await Promise.all([
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/42/verify', principal }),
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/43/verify', principal }),
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/44/verify', principal }),
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/45/verify', principal }),
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/nope/verify', principal }),
    ]);
    expect(failures.map((response) => response.status)).toEqual([200, 400, 400, 404, 400]);
    expect((failures[0].body as any).data).toEqual({ valid: false, status: 'key_missing' });
    expect((failures[1].body as any).error.code).toBe('pgp_message_not_signed');
    expect((failures[2].body as any).error.message).toBe('bad signature armor');
    expect((failures[3].body as any).error.code).toBe('pgp_message_not_found');
    expect((failures[4].body as any).error.code).toBe('invalid_pgp_message_id');

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/41/verify',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('pgp_messages_unavailable');
  });

  test('server PGP inbound detect route maps message classification and failures', async () => {
    const detectCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      pgpMessages: {
        async detectMessage(input) {
          detectCalls.push(input);
          if (input.messageId === 41) {
            return { ok: true, result: { detected: true, status: 'encrypted_unread' } };
          }
          if (input.messageId === 42) {
            return { ok: true, result: { detected: true, status: 'signed_unknown_key' } };
          }
          if (input.messageId === 43) {
            return { ok: true, result: { detected: false, status: null } };
          }
          return { ok: false, code: 'message_not_found' };
        },
        async decryptMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async verifyMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async prepareOutboundBody(input) {
          return { ok: true, bodyText: input.bodyText };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const encrypted = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/41/detect',
      principal,
    });
    expect(encrypted.status).toBe(200);
    expect((encrypted.body as any).data).toEqual({ detected: true, status: 'encrypted_unread' });
    expect(detectCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 41,
    });

    const results = await Promise.all([
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/42/detect', principal }),
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/43/detect', principal }),
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/44/detect', principal }),
      api.handle({ method: 'POST', path: '/api/v1/pgp/messages/nope/detect', principal }),
      api.handle({ method: 'GET', path: '/api/v1/pgp/messages/41/detect', principal }),
    ]);
    expect(results.map((response) => response.status)).toEqual([200, 200, 404, 400, 405]);
    expect((results[0].body as any).data).toEqual({ detected: true, status: 'signed_unknown_key' });
    expect((results[1].body as any).data).toEqual({ detected: false, status: null });
    expect((results[2].body as any).error.code).toBe('pgp_message_not_found');
    expect((results[3].body as any).error.code).toBe('invalid_pgp_message_id');
    expect((results[4].body as any).error.code).toBe('method_not_allowed');

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/41/detect',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('pgp_messages_unavailable');
  });

  test('server PGP plaintext encrypt and sign routes delegate to outbound crypto port', async () => {
    const prepareCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      pgpMessages: {
        async detectMessage() {
          return { ok: true, result: { detected: false, status: null } };
        },
        async decryptMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async verifyMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async prepareOutboundBody(input) {
          prepareCalls.push(input);
          if (input.bodyText === 'fail') return { ok: false, error: 'missing recipient key' };
          if (input.sign) return { ok: true, bodyText: '-----BEGIN PGP SIGNED MESSAGE-----\nsigned' };
          return { ok: true, bodyText: '-----BEGIN PGP MESSAGE-----\nencrypted' };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const encrypted = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/encrypt',
      body: {
        plaintext: '  plaintext with spaces  ',
        recipientEmails: [' peer@example.com '],
      },
      principal,
    });
    expect(encrypted.status).toBe(200);
    expect((encrypted.body as any).data).toEqual({ armored: '-----BEGIN PGP MESSAGE-----\nencrypted' });
    expect(prepareCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      bodyText: '  plaintext with spaces  ',
      recipientEmails: ['peer@example.com'],
      encrypt: true,
    });

    const signed = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/sign',
      body: {
        plaintext: '  signed plaintext  ',
        passphrase: ' passphrase with spaces ',
      },
      principal,
    });
    expect(signed.status).toBe(200);
    expect((signed.body as any).data).toEqual({ armored: '-----BEGIN PGP SIGNED MESSAGE-----\nsigned' });
    expect(prepareCalls[1]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      bodyText: '  signed plaintext  ',
      recipientEmails: [],
      sign: true,
      passphrase: ' passphrase with spaces ',
    });

    const failures = await Promise.all([
      api.handle({
        method: 'POST',
        path: '/api/v1/pgp/messages/encrypt',
        body: { plaintext: 'fail', recipientEmails: ['peer@example.com'] },
        principal,
      }),
      api.handle({
        method: 'POST',
        path: '/api/v1/pgp/messages/encrypt',
        body: { plaintext: '', recipientEmails: [] },
        principal,
      }),
      api.handle({
        method: 'POST',
        path: '/api/v1/pgp/messages/sign',
        body: { plaintext: 'hello', passphrase: '', workspaceId: WORKSPACE_B_ID },
        principal,
      }),
      api.handle({
        method: 'GET',
        path: '/api/v1/pgp/messages/sign',
        principal,
      }),
    ]);
    expect(failures.map((response) => response.status)).toEqual([400, 400, 400, 405]);
    expect((failures[0].body as any).error.code).toBe('pgp_message_encrypt_failed');
    expect((failures[0].body as any).error.message).toBe('missing recipient key');
    expect((failures[1].body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'plaintext', message: 'plaintext darf nicht leer sein' },
      { field: 'recipientEmails', message: 'recipientEmails darf nicht leer sein' },
    ]));
    expect((failures[2].body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'passphrase', message: 'passphrase darf nicht leer sein' },
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
    ]));
    expect((failures[3].body as any).error.code).toBe('method_not_allowed');

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/encrypt',
      body: { plaintext: 'hello', recipientEmails: ['peer@example.com'] },
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('pgp_messages_unavailable');
  });

  test('server PGP plaintext routes can prepare JSON attachment payloads', async () => {
    const prepareCalls: unknown[] = [];
    const prepareAttachmentCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      pgpMessages: {
        async detectMessage() {
          return { ok: true, result: { detected: false, status: null } };
        },
        async decryptMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async verifyMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async prepareOutboundBody(input) {
          prepareCalls.push(input);
          return { ok: true, bodyText: input.sign ? 'signed-body' : 'encrypted-body' };
        },
        async prepareOutboundAttachments(input) {
          prepareAttachmentCalls.push(input);
          if (input.attachments.some((attachment) => attachment.filename === 'fail.bin')) {
            return { ok: false, error: 'attachment crypto failed' };
          }
          return {
            ok: true,
            attachments: input.attachments.map((attachment) => ({
              filename: input.encrypt ? `${attachment.filename}.pgp` : `${attachment.filename}.asc`,
              contentType: input.encrypt ? 'application/pgp-encrypted' : 'application/pgp-signature',
              content: Buffer.from(`${input.encrypt ? 'encrypted' : 'signed'}:${attachment.filename}:${Buffer.from(attachment.bytes).toString('utf8')}`),
            })),
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const encrypted = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/encrypt',
      body: {
        plaintext: 'hello',
        recipientEmails: ['peer@example.com'],
        attachments: [{
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          contentBase64: Buffer.from('invoice bytes').toString('base64'),
        }],
      },
      principal,
    });
    expect(encrypted.status).toBe(200);
    expect((encrypted.body as any).data).toEqual({
      armored: 'encrypted-body',
      attachments: [{
        filename: 'invoice.pdf.pgp',
        contentType: 'application/pgp-encrypted',
        contentBase64: Buffer.from('encrypted:invoice.pdf:invoice bytes').toString('base64'),
      }],
    });
    expect(prepareAttachmentCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      attachments: [{
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        bytes: Buffer.from('invoice bytes'),
      }],
      recipientEmails: ['peer@example.com'],
      encrypt: true,
    });
    expect(prepareCalls[0]).toEqual(expect.objectContaining({
      bodyText: 'hello',
      recipientEmails: ['peer@example.com'],
      encrypt: true,
    }));

    const signed = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/sign',
      body: {
        plaintext: 'hello',
        passphrase: ' passphrase ',
        attachments: [{
          filename: 'note.txt',
          contentBase64: Buffer.from('note bytes').toString('base64'),
        }],
      },
      principal,
    });
    expect(signed.status).toBe(200);
    expect((signed.body as any).data).toEqual({
      armored: 'signed-body',
      attachments: [{
        filename: 'note.txt.asc',
        contentType: 'application/pgp-signature',
        contentBase64: Buffer.from('signed:note.txt:note bytes').toString('base64'),
      }],
    });
    expect(prepareAttachmentCalls[1]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      attachments: [{
        filename: 'note.txt',
        bytes: Buffer.from('note bytes'),
      }],
      recipientEmails: [],
      sign: true,
      passphrase: ' passphrase ',
    });
    expect(prepareCalls[1]).toEqual(expect.objectContaining({
      bodyText: 'hello',
      recipientEmails: [],
      sign: true,
      passphrase: ' passphrase ',
    }));

    const failedAttachment = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/encrypt',
      body: {
        plaintext: 'hello',
        recipientEmails: ['peer@example.com'],
        attachments: [{
          filename: 'fail.bin',
          contentBase64: Buffer.from('fail bytes').toString('base64'),
        }],
      },
      principal,
    });
    expect(failedAttachment.status).toBe(400);
    expect((failedAttachment.body as any).error.code).toBe('pgp_message_attachment_crypto_failed');
    expect((failedAttachment.body as any).error.message).toBe('attachment crypto failed');

    const invalidPayload = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/encrypt',
      body: {
        plaintext: 'hello',
        recipientEmails: ['peer@example.com'],
        attachments: [{ filename: 'bad.txt', contentBase64: 'not base64' }],
      },
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'attachments[0].contentBase64', message: 'attachments[0].contentBase64 muss valides Base64 sein' },
    ]));

    const unavailable = await createServerApi(makeServerApiPorts({
      pgpMessages: {
        async decryptMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async verifyMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async prepareOutboundBody(input) {
          return { ok: true, bodyText: input.bodyText };
        },
      },
    })).handle({
      method: 'POST',
      path: '/api/v1/pgp/messages/sign',
      body: {
        plaintext: 'hello',
        passphrase: 'passphrase',
        attachments: [{ filename: 'note.txt', contentBase64: Buffer.from('note bytes').toString('base64') }],
      },
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('pgp_message_attachments_unavailable');
  });

  test('server PGP attachment routes decrypt and verify stored attachment content transiently', async () => {
    const decryptCalls: unknown[] = [];
    const verifyCalls: unknown[] = [];
    const attachments = new Map([
      [31, { ...makeEmailAttachmentRecord(31), filename: 'invoice.pdf.pgp', contentType: 'application/pgp-encrypted', sizeBytes: 1200 }],
      [32, { ...makeEmailAttachmentRecord(32), filename: 'invoice.pdf', contentType: 'application/pdf', sizeBytes: 900 }],
      [33, { ...makeEmailAttachmentRecord(33), filename: 'invoice.pdf.asc', contentType: 'application/pgp-signature', sizeBytes: 500 }],
      [34, { ...makeEmailAttachmentRecord(34), filename: 'huge.bin.pgp', sizeBytes: 30 * 1024 * 1024 }],
    ]);
    const contents = new Map([
      [31, Buffer.from('-----BEGIN PGP MESSAGE-----\nattachment\n-----END PGP MESSAGE-----')],
      [32, Buffer.from('invoice bytes')],
      [33, Buffer.from('-----BEGIN PGP SIGNATURE-----\nsignature\n-----END PGP SIGNATURE-----')],
      [34, Buffer.from('too large')],
    ]);
    const api = createServerApi(makeServerApiPorts({
      emailAttachments: {
        async listForMessage() {
          return { items: [] };
        },
        async get(input) {
          return attachments.get(input.id) ?? null;
        },
      },
      emailAttachmentContent: {
        async get(input) {
          const attachment = attachments.get(input.id);
          const content = contents.get(input.id);
          if (!attachment || !content) return { ok: false, reason: 'not_found' };
          return {
            ok: true,
            record: {
              id: attachment.id,
              filename: attachment.filename,
              contentType: attachment.contentType,
              sizeBytes: attachment.sizeBytes,
              contentSha256: attachment.contentSha256,
              content,
            },
          };
        },
      },
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get(input) {
          return {
            ...makeEmailMessageRecord(input.id),
            from: { value: [{ address: 'sender@example.com' }] },
          };
        },
      },
      pgpMessages: {
        async decryptMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async verifyMessage() {
          return { ok: false, code: 'message_not_found' };
        },
        async decryptAttachment(input) {
          decryptCalls.push(input);
          if (input.passphrase === 'bad') return { ok: false, code: 'decrypt_failed', message: 'bad passphrase' };
          return {
            ok: true,
            result: {
              filename: 'invoice.pdf',
              contentType: 'application/pdf',
              content: Buffer.from('decrypted invoice'),
              status: 'decrypted',
            },
          };
        },
        async verifyAttachment(input) {
          verifyCalls.push(input);
          return {
            ok: true,
            result: {
              valid: true,
              status: 'signed_valid',
              fingerprint: 'abcdef1234567890',
            },
          };
        },
        async prepareOutboundBody(input) {
          return { ok: true, bodyText: input.bodyText };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const decrypted = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/attachments/31/decrypt',
      body: { passphrase: ' passphrase ' },
      principal,
    });
    expect(decrypted.status).toBe(200);
    expect((decrypted.body as any).data).toEqual({
      filename: 'invoice.pdf',
      contentType: 'application/pdf',
      contentBase64: Buffer.from('decrypted invoice').toString('base64'),
      sizeBytes: Buffer.byteLength('decrypted invoice'),
      status: 'decrypted',
    });
    expect(decryptCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      passphrase: ' passphrase ',
      attachment: {
        id: 31,
        filename: 'invoice.pdf.pgp',
        contentType: 'application/pgp-encrypted',
        bytes: contents.get(31),
      },
    });

    const verified = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/attachments/32/verify',
      body: { signatureAttachmentId: 33 },
      principal,
    });
    expect(verified.status).toBe(200);
    expect((verified.body as any).data).toEqual({
      valid: true,
      status: 'signed_valid',
      fingerprint: 'abcdef1234567890',
    });
    expect(verifyCalls[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      signerEmail: 'sender@example.com',
      attachment: {
        id: 32,
        filename: 'invoice.pdf',
        contentType: 'application/pdf',
        bytes: contents.get(32),
      },
      signature: {
        id: 33,
        filename: 'invoice.pdf.asc',
        contentType: 'application/pgp-signature',
        bytes: contents.get(33),
      },
    });

    const inlineSignature = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/attachments/32/verify',
      body: {
        signatureBase64: Buffer.from('-----BEGIN PGP SIGNATURE-----\ninline\n-----END PGP SIGNATURE-----').toString('base64'),
        signerEmail: 'explicit@example.com',
      },
      principal,
    });
    expect(inlineSignature.status).toBe(200);
    expect((verifyCalls[1] as any).signerEmail).toBe('explicit@example.com');
    expect((verifyCalls[1] as any).signature.id).toBeUndefined();

    const tooLarge = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/attachments/34/decrypt',
      body: { passphrase: 'passphrase' },
      principal,
    });
    expect(tooLarge.status).toBe(413);
    expect((tooLarge.body as any).error.code).toBe('pgp_attachment_too_large');

    const invalidVerifyPayload = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/attachments/32/verify',
      body: { signatureAttachmentId: 33, signatureBase64: Buffer.from('sig').toString('base64') },
      principal,
    });
    expect(invalidVerifyPayload.status).toBe(400);
    expect((invalidVerifyPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'signatureBase64', message: 'signatureBase64 darf nicht zusammen mit signatureAttachmentId gesetzt werden' },
    ]));
  });

  test('server PGP compatibility routes preserve legacy keyring channel semantics', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const identityCreateCalls: unknown[] = [];
    const identityDeleteCalls: unknown[] = [];
    const peerCreateCalls: unknown[] = [];
    const peerDeleteCalls: unknown[] = [];
    const peerListCalls: unknown[] = [];
    const identity: PgpIdentityRecord = {
      ...makePgpIdentityRecord(41),
      sourceSqliteId: -41,
      fingerprint: 'abcdefidentity',
    };
    const peerKey: PgpPeerKeyRecord = {
      ...makePgpPeerKeyRecord(42),
      sourceSqliteId: -42,
      email: 'peer@example.com',
      fingerprint: 'abcdefpeer',
      trustLevel: 'imported',
    };
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      pgpKeyMaterial: {
        async generateIdentity() {
          return {
            fingerprint: 'abcdefidentity',
            publicKeyArmor: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nidentity\n-----END PGP PUBLIC KEY BLOCK-----',
            privateKeyArmored: '-----BEGIN PGP PRIVATE KEY BLOCK-----\nidentity\n-----END PGP PRIVATE KEY BLOCK-----',
          };
        },
        async readPublicKey() {
          return {
            email: 'peer@example.com',
            fingerprint: 'abcdefpeer',
          };
        },
      },
      pgpIdentities: {
        async list(input) {
          return { items: [identity], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          identityCreateCalls.push(input);
          return { ok: true, identity };
        },
        async delete(input) {
          identityDeleteCalls.push(input);
          return { ok: true, identity };
        },
      },
      pgpPeerKeys: {
        async list(input) {
          peerListCalls.push(input);
          if (input.email === 'missing@example.com') return { items: [], nextCursor: null };
          return { items: [peerKey], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          peerCreateCalls.push(input);
          return { ok: true, peerKey };
        },
        async delete(input) {
          peerDeleteCalls.push(input);
          return peerKey;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const generated = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/identities/generate',
      body: { email: 'identity@example.com', passphrase: 'passphrase' },
      principal,
    });
    expect(generated.status).toBe(201);
    expect((generated.body as any).data).toEqual({ fingerprint: 'abcdefidentity' });
    expect(identityCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        email: 'identity@example.com',
        fingerprint: 'abcdefidentity',
        publicKeyArmor: '-----BEGIN PGP PUBLIC KEY BLOCK-----\nidentity\n-----END PGP PUBLIC KEY BLOCK-----',
        privateKeyArmored: '-----BEGIN PGP PRIVATE KEY BLOCK-----\nidentity\n-----END PGP PRIVATE KEY BLOCK-----',
        privateKeyPassphrase: 'passphrase',
        isPrimary: true,
      },
    }]);

    const imported = await api.handle({
      method: 'POST',
      path: '/api/v1/pgp/peer-keys/import',
      body: { armored: '-----BEGIN PGP PUBLIC KEY BLOCK-----\npeer\n-----END PGP PUBLIC KEY BLOCK-----' },
      principal,
    });
    expect(imported.status).toBe(201);
    expect((imported.body as any).data).toEqual({ fingerprint: 'abcdefpeer' });
    expect(peerCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        email: 'peer@example.com',
        fingerprint: 'abcdefpeer',
        publicKeyArmor: '-----BEGIN PGP PUBLIC KEY BLOCK-----\npeer\n-----END PGP PUBLIC KEY BLOCK-----',
        source: 'manual',
        trustLevel: 'imported',
      },
    }]);

    const recipientStatus = await api.handle({
      method: 'GET',
      path: '/api/v1/pgp/recipient-key-status',
      query: { emails: JSON.stringify(['peer@example.com', 'missing@example.com']) },
      principal,
    });
    expect(recipientStatus.status).toBe(200);
    expect((recipientStatus.body as any).data).toEqual([
      { email: 'peer@example.com', hasKey: true, fingerprint: 'abcdefpeer' },
      { email: 'missing@example.com', hasKey: false },
    ]);

    const deletedIdentity = await api.handle({
      method: 'DELETE',
      path: '/api/v1/pgp/identities/by-source/-41',
      principal,
    });
    const deletedPeerKey = await api.handle({
      method: 'DELETE',
      path: '/api/v1/pgp/peer-keys/by-source/-42',
      principal,
    });
    expect(deletedIdentity.status).toBe(200);
    expect(deletedPeerKey.status).toBe(200);
    expect(identityDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 41 }]);
    expect(peerDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 42 }]);
    expect(peerListCalls).toEqual(expect.arrayContaining([
      { workspaceId: WORKSPACE_A_ID, email: 'peer@example.com', limit: 100 },
      { workspaceId: WORKSPACE_A_ID, email: 'missing@example.com', limit: 100 },
      { workspaceId: WORKSPACE_A_ID, limit: 100 },
    ]));
    expect(auditEvents.map((event) => event.action)).toEqual([
      'pgp_identity.created',
      'pgp_peer_key.created',
      'pgp_identity.deleted',
      'pgp_peer_key.deleted',
    ]);
    expect(events.map((event) => event.type)).toEqual([
      'pgp_identity.created',
      'pgp_peer_key.created',
      'pgp_identity.deleted',
      'pgp_peer_key.deleted',
    ]);
  });

  test('server spam read routes pass validated filters to list, learning, decision, and stat ports', async () => {
    const listEntryCalls: unknown[] = [];
    const learningCalls: unknown[] = [];
    const decisionCalls: unknown[] = [];
    const featureStatCalls: unknown[] = [];
    const featureStatGetCalls: unknown[] = [];
    const ports = makeServerApiPorts({
      spamListEntries: {
        async list(input) {
          listEntryCalls.push(input);
          return { items: [makeSpamListEntryRecord(51)], nextCursor: 51 };
        },
        async get(input) {
          return input.id === 51 ? makeSpamListEntryRecord(51) : null;
        },
      },
      spamLearningEvents: {
        async list(input) {
          learningCalls.push(input);
          return { items: [makeSpamLearningEventRecord(52)], nextCursor: null };
        },
        async get(input) {
          return input.id === 52 ? makeSpamLearningEventRecord(52) : null;
        },
      },
      spamDecisions: {
        async list(input) {
          decisionCalls.push(input);
          return { items: [makeSpamDecisionRecord(53)], nextCursor: null };
        },
        async get(input) {
          return input.id === 53 ? makeSpamDecisionRecord(53) : null;
        },
      },
      spamFeatureStats: {
        async list(input) {
          featureStatCalls.push(input);
          return { items: [makeSpamFeatureStatRecord('sender:example.com')], nextCursor: 'sender:next.example.com' };
        },
        async get(input) {
          featureStatGetCalls.push(input);
          return input.featureKey === 'sender:example.com' ? makeSpamFeatureStatRecord('sender:example.com') : null;
        },
      },
    });
    const api = createServerApi(ports);
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const entries = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/list-entries',
      query: {
        listType: 'block',
        patternType: 'domain',
        accountId: '1',
        search: ' example ',
        cursor: '50',
        limit: '10',
      },
      principal,
    });
    expect(entries.status).toBe(200);
    expect((entries.body as any).data.nextCursor).toBe(51);
    expect(listEntryCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 10,
      cursor: 50,
      listType: 'block',
      patternType: 'domain',
      accountId: 1,
      search: 'example',
    }]);

    const learning = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/learning-events',
      query: { label: 'spam', accountId: '1', messageId: '11' },
      principal,
    });
    expect(learning.status).toBe(200);
    expect((learning.body as any).data.items[0].featureKeys).toEqual(['sender:example.com']);
    expect(learningCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      label: 'spam',
      accountId: 1,
      messageId: 11,
    }]);

    const decisions = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/decisions',
      query: { status: 'review', accountId: '1', messageId: '11' },
      principal,
    });
    expect(decisions.status).toBe(200);
    expect((decisions.body as any).data.items[0].status).toBe('review');
    expect(decisionCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      status: 'review',
      accountId: 1,
      messageId: 11,
    }]);

    const stats = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/feature-stats',
      query: { search: ' sender ', cursor: 'sender:alpha.example.com' },
      principal,
    });
    expect(stats.status).toBe(200);
    expect((stats.body as any).data.nextCursor).toBe('sender:next.example.com');
    expect(featureStatCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 50,
      cursor: 'sender:alpha.example.com',
      search: 'sender',
    }]);

    const stat = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/feature-stats/sender%3Aexample.com',
      principal,
    });
    expect(stat.status).toBe(200);
    expect((stat.body as any).data.featureKey).toBe('sender:example.com');
    expect(featureStatGetCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, featureKey: 'sender:example.com' }]);
  });

  test('server spam read routes validate auth, IDs, filters, and missing ports', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unauthorized = await api.handle({ method: 'GET', path: '/api/v1/spam/list-entries' });
    expect(unauthorized.status).toBe(401);

    const invalidListType = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/list-entries',
      query: { listType: 'maybe' },
      principal,
    });
    expect(invalidListType.status).toBe(400);
    expect((invalidListType.body as any).error.code).toBe('invalid_list_type');

    const invalidLabel = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/learning-events',
      query: { label: 'maybe' },
      principal,
    });
    expect(invalidLabel.status).toBe(400);
    expect((invalidLabel.body as any).error.code).toBe('invalid_label');

    const invalidStatus = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/decisions',
      query: { status: 'maybe' },
      principal,
    });
    expect(invalidStatus.status).toBe(400);
    expect((invalidStatus.body as any).error.code).toBe('invalid_status');

    const invalidId = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/decisions/nope',
      principal,
    });
    expect(invalidId.status).toBe(400);
    expect((invalidId.body as any).error.code).toBe('invalid_spam_decision_id');

    const invalidFeatureKey = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/feature-stats/%E0%A4%A',
      principal,
    });
    expect(invalidFeatureKey.status).toBe(400);
    expect((invalidFeatureKey.body as any).error.code).toBe('invalid_feature_key');

    const unavailableEntries = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/list-entries',
      principal,
    });
    expect(unavailableEntries.status).toBe(503);
    expect((unavailableEntries.body as any).error.code).toBe('spam_list_entries_unavailable');

    const unavailableStats = await api.handle({
      method: 'GET',
      path: '/api/v1/spam/feature-stats',
      principal,
    });
    expect(unavailableStats.status).toBe(503);
    expect((unavailableStats.body as any).error.code).toBe('spam_feature_stats_unavailable');
  });

  test('server spam mutation routes write audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const listCreateCalls: unknown[] = [];
    const listUpdateCalls: unknown[] = [];
    const listDeleteCalls: unknown[] = [];
    const learningCreateCalls: unknown[] = [];
    const decisionCreateCalls: unknown[] = [];
    const decisionUpdateCalls: unknown[] = [];
    const decisionDeleteCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      spamListEntries: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          listCreateCalls.push(input);
          return {
            ok: true,
            entry: {
              ...makeSpamListEntryRecord(60),
              sourceSqliteId: -60,
              listType: input.values.listType ?? 'block',
              patternType: input.values.patternType ?? 'domain',
              pattern: input.values.pattern ?? 'example.com',
              accountId: input.values.accountId ?? null,
              accountSourceSqliteId: input.values.accountId === undefined || input.values.accountId === null ? null : 100,
              note: input.values.note ?? null,
            },
          };
        },
        async update(input) {
          listUpdateCalls.push(input);
          return input.id === 60
            ? {
              ok: true,
              entry: {
                ...makeSpamListEntryRecord(60),
                sourceSqliteId: -60,
                note: input.values.note === undefined ? 'Imported block rule' : input.values.note,
              },
            }
            : null;
        },
        async delete(input) {
          listDeleteCalls.push(input);
          return input.id === 60 ? { ...makeSpamListEntryRecord(60), sourceSqliteId: -60 } : null;
        },
      },
      spamLearningEvents: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          learningCreateCalls.push(input);
          return {
            ok: true,
            event: {
              ...makeSpamLearningEventRecord(61),
              sourceSqliteId: -61,
              accountId: input.values.accountId ?? 1,
              accountSourceSqliteId: 100,
              messageId: input.values.messageId ?? null,
              messageSourceSqliteId: input.values.messageId === undefined || input.values.messageId === null ? null : 110,
              label: input.values.label ?? 'spam',
              source: input.values.source ?? 'server_api',
              featureKeys: input.values.featureKeys ?? null,
            },
          };
        },
      },
      spamDecisions: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          decisionCreateCalls.push(input);
          return {
            ok: true,
            decision: {
              ...makeSpamDecisionRecord(62),
              sourceSqliteId: -62,
              accountId: input.values.accountId ?? 1,
              accountSourceSqliteId: 100,
              messageId: input.values.messageId ?? null,
              messageSourceSqliteId: input.values.messageId === undefined || input.values.messageId === null ? null : 110,
              score: input.values.score ?? 0,
              status: input.values.status ?? 'clean',
              source: input.values.source ?? 'server_api',
              breakdown: input.values.breakdown ?? null,
              modelVersion: input.values.modelVersion ?? 1,
            },
          };
        },
        async update(input) {
          decisionUpdateCalls.push(input);
          return input.id === 62
            ? {
              ok: true,
              decision: {
                ...makeSpamDecisionRecord(62),
                sourceSqliteId: -62,
                score: input.values.score ?? 73,
                status: input.values.status ?? 'review',
                breakdown: input.values.breakdown === undefined ? { sender: 42 } : input.values.breakdown,
              },
            }
            : null;
        },
        async delete(input) {
          decisionDeleteCalls.push(input);
          return input.id === 62 ? { ...makeSpamDecisionRecord(62), sourceSqliteId: -62 } : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const listCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/spam/list-entries',
      body: {
        listType: ' block ',
        patternType: ' domain ',
        pattern: ' example.com ',
        accountId: '1',
        note: ' Imported block rule ',
      },
      principal,
    });
    expect(listCreated.status).toBe(201);
    expect(listCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        listType: 'block',
        patternType: 'domain',
        pattern: 'example.com',
        accountId: 1,
        note: 'Imported block rule',
      },
    }]);

    const listUpdated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/spam/list-entries/60',
      body: { note: null },
      principal,
    });
    expect(listUpdated.status).toBe(200);
    expect((listUpdated.body as any).data.note).toBeNull();
    expect(listUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 60,
      values: { note: null },
    }]);

    const listDeleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/spam/list-entries/60',
      principal,
    });
    expect(listDeleted.status).toBe(200);
    expect((listDeleted.body as any).data.deleted).toBe(true);
    expect(listDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 60 }]);

    const learningCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/spam/learning-events',
      body: {
        accountId: '1',
        messageId: '11',
        label: ' spam ',
        source: ' user ',
        featureKeys: ['sender:example.com'],
      },
      principal,
    });
    expect(learningCreated.status).toBe(201);
    expect(learningCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 1,
        messageId: 11,
        label: 'spam',
        source: 'user',
        featureKeys: ['sender:example.com'],
      },
    }]);

    const decisionCreated = await api.handle({
      method: 'POST',
      path: '/api/v1/spam/decisions',
      body: {
        accountId: '1',
        messageId: '11',
        score: '85',
        status: ' spam ',
        source: ' local ',
        breakdown: { reason: 'sender' },
        modelVersion: '2',
      },
      principal,
    });
    expect(decisionCreated.status).toBe(201);
    expect((decisionCreated.body as any).data.breakdown).toEqual({ reason: 'sender' });
    expect(decisionCreateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 1,
        messageId: 11,
        score: 85,
        status: 'spam',
        source: 'local',
        breakdown: { reason: 'sender' },
        modelVersion: 2,
      },
    }]);

    const decisionUpdated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/spam/decisions/62',
      body: { score: 20, status: 'clean', breakdown: null },
      principal,
    });
    expect(decisionUpdated.status).toBe(200);
    expect((decisionUpdated.body as any).data.breakdown).toBeNull();
    expect(decisionUpdateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 62,
      values: { score: 20, status: 'clean', breakdown: null },
    }]);

    const decisionDeleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/spam/decisions/62',
      principal,
    });
    expect(decisionDeleted.status).toBe(200);
    expect((decisionDeleted.body as any).data.deleted).toBe(true);
    expect(decisionDeleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, id: 62 }]);

    expect(auditEvents.map((event) => event.action)).toEqual([
      'spam_list_entry.created',
      'spam_list_entry.updated',
      'spam_list_entry.deleted',
      'spam_learning_event.created',
      'spam_decision.created',
      'spam_decision.updated',
      'spam_decision.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['spam_list_entry.created', WORKSPACE_A_ID, 'spam_list_entry', '60'],
      ['spam_list_entry.updated', WORKSPACE_A_ID, 'spam_list_entry', '60'],
      ['spam_list_entry.deleted', WORKSPACE_A_ID, 'spam_list_entry', '60'],
      ['spam_learning_event.created', WORKSPACE_A_ID, 'spam_learning_event', '61'],
      ['spam_decision.created', WORKSPACE_A_ID, 'spam_decision', '62'],
      ['spam_decision.updated', WORKSPACE_A_ID, 'spam_decision', '62'],
      ['spam_decision.deleted', WORKSPACE_A_ID, 'spam_decision', '62'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 60,
      sourceSqliteId: -60,
      listType: 'block',
      patternType: 'domain',
      pattern: 'example.com',
      accountId: 1,
    });
    expect(events[3].payload).toMatchObject({
      id: 61,
      sourceSqliteId: -61,
      accountId: 1,
      messageId: 11,
      label: 'spam',
      source: 'user',
    });
    expect(events[4].payload).toMatchObject({
      id: 62,
      sourceSqliteId: -62,
      accountId: 1,
      messageId: 11,
      score: 85,
      status: 'spam',
      source: 'local',
      modelVersion: 2,
      hasBreakdown: true,
    });
    expect(events.slice(4).map((event) => event.payload.breakdown)).toEqual([undefined, undefined, undefined]);
    expect(auditEvents.slice(4).map((event) => (event.metadata as any).breakdown)).toEqual([undefined, undefined, undefined]);
  });

  test('server spam list entry upsert preserves legacy save semantics on conflicts', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const listCalls: unknown[] = [];
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      spamListEntries: {
        async list(input) {
          listCalls.push(input);
          return {
            items: [{
              ...makeSpamListEntryRecord(60),
              id: 60,
              listType: 'allow',
              patternType: 'email',
              pattern: 'user@example.com',
              accountId: null,
              accountSourceSqliteId: null,
              note: 'old note',
            }],
            nextCursor: null,
          };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          return { ok: false, code: 'entry_conflict' };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 60
            ? {
              ok: true,
              entry: {
                ...makeSpamListEntryRecord(60),
                id: 60,
                listType: input.values.listType ?? 'allow',
                patternType: input.values.patternType ?? 'email',
                pattern: input.values.pattern ?? 'user@example.com',
                accountId: input.values.accountId ?? null,
                accountSourceSqliteId: null,
                note: input.values.note ?? null,
              },
            }
            : null;
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/spam/list-entries/upsert',
      body: {
        listType: ' allow ',
        patternType: ' email ',
        pattern: ' user@example.com ',
        note: ' updated note ',
      },
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data.note).toBe('updated note');
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        listType: 'allow',
        patternType: 'email',
        pattern: 'user@example.com',
        note: 'updated note',
      },
    }]);
    expect(listCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 100,
      listType: 'allow',
      patternType: 'email',
      search: 'user@example.com',
    }]);
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 60,
      values: {
        listType: 'allow',
        patternType: 'email',
        pattern: 'user@example.com',
        note: 'updated note',
      },
    }]);
    expect(auditEvents.map((event) => event.action)).toEqual(['spam_list_entry.updated']);
    expect(events.map((event) => [event.type, event.entityType, event.entityId])).toEqual([
      ['spam_list_entry.updated', 'spam_list_entry', '60'],
    ]);
  });

  test('server spam mutation routes reject unsafe payloads and invalid references', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      spamListEntries: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
      spamLearningEvents: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
      spamDecisions: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      spamListEntries: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.accountId === 99) return { ok: false, code: 'account_not_found' };
          return { ok: false, code: 'entry_conflict' };
        },
        async update(input) {
          if (input.values.accountId === 99) return { ok: false, code: 'account_not_found' };
          if (input.values.pattern === 'duplicate.com') return { ok: false, code: 'entry_conflict' };
          return null;
        },
        async delete() {
          return null;
        },
      },
      spamLearningEvents: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.accountId === 99) return { ok: false, code: 'account_not_found' };
          if (input.values.messageId === 99) return { ok: false, code: 'message_not_found' };
          return { ok: false, code: 'message_account_mismatch' };
        },
      },
      spamDecisions: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.accountId === 99) return { ok: false, code: 'account_not_found' };
          if (input.values.messageId === 99) return { ok: false, code: 'message_not_found' };
          return { ok: false, code: 'message_account_mismatch' };
        },
        async update(input) {
          if (input.values.accountId === 99) return { ok: false, code: 'account_not_found' };
          if (input.values.messageId === 99) return { ok: false, code: 'message_not_found' };
          if (input.values.messageId === 88) return { ok: false, code: 'message_account_mismatch' };
          return null;
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailableListEntry = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/spam/list-entries',
      body: { listType: 'block', patternType: 'domain', pattern: 'example.com' },
      principal,
    });
    expect(unavailableListEntry.status).toBe(503);

    const invalidListPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/list-entries',
      body: [],
      principal,
    });
    expect(invalidListPayload.status).toBe(400);
    expect((invalidListPayload.body as any).error.code).toBe('invalid_spam_list_entry_payload');

    const unsafeListPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/list-entries',
      body: {
        workspaceId: WORKSPACE_B_ID,
        listType: 'maybe',
        patternType: 'domain',
        pattern: ' ',
        accountId: 0,
        note: 123,
      },
      principal,
    });
    expect(unsafeListPayload.status).toBe(400);
    expect((unsafeListPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'listType', message: 'listType muss allow oder block sein' },
      { field: 'pattern', message: 'pattern darf nicht leer sein' },
      { field: 'accountId', message: 'accountId muss eine positive Ganzzahl sein' },
      { field: 'note', message: 'note muss ein String oder null sein' },
    ]));

    const missingListFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/list-entries',
      body: { listType: 'block' },
      principal,
    });
    expect(missingListFields.status).toBe(400);

    const missingListAccount = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/list-entries',
      body: { listType: 'block', patternType: 'domain', pattern: 'example.com', accountId: 99 },
      principal,
    });
    expect(missingListAccount.status).toBe(404);
    expect((missingListAccount.body as any).error.code).toBe('email_account_not_found');

    const conflictingListEntry = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/list-entries',
      body: { listType: 'block', patternType: 'domain', pattern: 'example.com' },
      principal,
    });
    expect(conflictingListEntry.status).toBe(409);

    const invalidListId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/spam/list-entries/0',
      body: { note: 'updated' },
      principal,
    });
    expect(invalidListId.status).toBe(400);

    const emptyListPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/spam/list-entries/60',
      body: {},
      principal,
    });
    expect(emptyListPatch.status).toBe(400);

    const missingListWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/spam/list-entries/60', body: { note: 'updated' }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/spam/list-entries/60', principal }),
    ]);
    expect(missingListWrites.map((response) => response.status)).toEqual([404, 404]);

    const unavailableLearning = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/spam/learning-events',
      body: { accountId: 1, label: 'spam' },
      principal,
    });
    expect(unavailableLearning.status).toBe(503);

    const invalidLearningPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/learning-events',
      body: [],
      principal,
    });
    expect(invalidLearningPayload.status).toBe(400);
    expect((invalidLearningPayload.body as any).error.code).toBe('invalid_spam_learning_event_payload');

    const unsafeLearningPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/learning-events',
      body: {
        workspaceId: WORKSPACE_B_ID,
        accountId: 0,
        messageId: 0,
        label: 'maybe',
        source: ' ',
        featureKeys: () => 'not-json',
      },
      principal,
    });
    expect(unsafeLearningPayload.status).toBe(400);
    expect((unsafeLearningPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'accountId', message: 'accountId muss eine positive Ganzzahl sein' },
      { field: 'messageId', message: 'messageId muss eine positive Ganzzahl sein' },
      { field: 'label', message: 'label muss spam oder ham sein' },
      { field: 'source', message: 'source darf nicht leer sein' },
      { field: 'featureKeys', message: 'featureKeys muss JSON-kompatibel sein' },
    ]));

    const missingLearningFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/learning-events',
      body: { accountId: 1 },
      principal,
    });
    expect(missingLearningFields.status).toBe(400);

    const missingLearningAccount = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/learning-events',
      body: { accountId: 99, label: 'spam' },
      principal,
    });
    expect(missingLearningAccount.status).toBe(404);
    expect((missingLearningAccount.body as any).error.code).toBe('email_account_not_found');

    const missingLearningMessage = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/learning-events',
      body: { accountId: 1, messageId: 99, label: 'spam' },
      principal,
    });
    expect(missingLearningMessage.status).toBe(404);
    expect((missingLearningMessage.body as any).error.code).toBe('email_message_not_found');

    const mismatchedLearningMessage = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/learning-events',
      body: { accountId: 1, messageId: 11, label: 'spam' },
      principal,
    });
    expect(mismatchedLearningMessage.status).toBe(400);
    expect((mismatchedLearningMessage.body as any).error.code).toBe('spam_learning_event_account_mismatch');

    const unavailableDecision = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/spam/decisions',
      body: { accountId: 1, score: 50, status: 'review', source: 'local' },
      principal,
    });
    expect(unavailableDecision.status).toBe(503);

    const invalidDecisionPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/decisions',
      body: [],
      principal,
    });
    expect(invalidDecisionPayload.status).toBe(400);
    expect((invalidDecisionPayload.body as any).error.code).toBe('invalid_spam_decision_payload');

    const unsafeDecisionPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/decisions',
      body: {
        workspaceId: WORKSPACE_B_ID,
        accountId: 0,
        messageId: 0,
        score: 101,
        status: 'maybe',
        source: ' ',
        breakdown: 'sender',
        modelVersion: 0,
      },
      principal,
    });
    expect(unsafeDecisionPayload.status).toBe(400);
    expect((unsafeDecisionPayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'accountId', message: 'accountId muss eine positive Ganzzahl sein' },
      { field: 'messageId', message: 'messageId muss eine positive Ganzzahl sein' },
      { field: 'score', message: 'score muss eine Ganzzahl zwischen 0 und 100 sein' },
      { field: 'status', message: 'status muss clean, review oder spam sein' },
      { field: 'source', message: 'source darf nicht leer sein' },
      { field: 'breakdown', message: 'breakdown muss ein JSON-Objekt, JSON-Array oder null sein' },
      { field: 'modelVersion', message: 'modelVersion muss eine positive Ganzzahl sein' },
    ]));

    const missingDecisionFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/decisions',
      body: { accountId: 1, score: 50, status: 'review' },
      principal,
    });
    expect(missingDecisionFields.status).toBe(400);

    const missingDecisionAccount = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/decisions',
      body: { accountId: 99, score: 50, status: 'review', source: 'local' },
      principal,
    });
    expect(missingDecisionAccount.status).toBe(404);
    expect((missingDecisionAccount.body as any).error.code).toBe('email_account_not_found');

    const missingDecisionMessage = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/decisions',
      body: { accountId: 1, messageId: 99, score: 50, status: 'review', source: 'local' },
      principal,
    });
    expect(missingDecisionMessage.status).toBe(404);
    expect((missingDecisionMessage.body as any).error.code).toBe('email_message_not_found');

    const mismatchingDecision = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/spam/decisions',
      body: { accountId: 1, messageId: 11, score: 50, status: 'review', source: 'local' },
      principal,
    });
    expect(mismatchingDecision.status).toBe(409);
    expect((mismatchingDecision.body as any).error.code).toBe('spam_decision_message_account_mismatch');

    const invalidDecisionId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/spam/decisions/0',
      body: { score: 20 },
      principal,
    });
    expect(invalidDecisionId.status).toBe(400);

    const emptyDecisionPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/spam/decisions/62',
      body: {},
      principal,
    });
    expect(emptyDecisionPatch.status).toBe(400);

    const missingDecisionWrites = await Promise.all([
      writableApi.handle({ method: 'PATCH', path: '/api/v1/spam/decisions/62', body: { score: 20 }, principal }),
      writableApi.handle({ method: 'PATCH', path: '/api/v1/spam/decisions/62', body: { messageId: 88 }, principal }),
      writableApi.handle({ method: 'DELETE', path: '/api/v1/spam/decisions/62', principal }),
    ]);
    expect(missingDecisionWrites.map((response) => response.status)).toEqual([404, 409, 404]);
    expect((missingDecisionWrites[1].body as any).error.code).toBe('spam_decision_message_account_mismatch');
  });

  test('server lock routes enforce pessimistic lock and admin takeover', async () => {
    const ports = makeServerApiPorts();
    const api = createServerApi(ports);

    const user = { userId: 'user-a', workspaceId: 'workspace-a', role: 'user' as const };
    const other = { userId: 'user-b', workspaceId: 'workspace-a', role: 'user' as const };
    const admin = { userId: 'admin-a', workspaceId: 'workspace-a', role: 'admin' as const };

    const acquire = await api.handle({
      method: 'POST',
      path: '/api/v1/locks/42',
      principal: user,
      body: { reason: 'reply' },
    });
    expect(acquire.status).toBe(201);
    expect((acquire.body as any).data.lock.userId).toBe('user-a');

    const conflict = await api.handle({
      method: 'POST',
      path: '/api/v1/locks/42',
      principal: other,
      body: { reason: 'reply' },
    });
    expect(conflict.status).toBe(409);
    expect((conflict.body as any).error.code).toBe('conversation_locked');

    const listed = await api.handle({
      method: 'GET',
      path: '/api/v1/locks',
      query: { messageIds: '42,43,42' },
      principal: other,
    });
    expect(listed.status).toBe(200);
    expect((listed.body as any).data.locks.map((lock: any) => lock.messageId)).toEqual([42]);

    const heartbeat = await api.handle({
      method: 'PATCH',
      path: '/api/v1/locks/42/heartbeat',
      principal: user,
    });
    expect(heartbeat.status).toBe(200);

    const forbiddenTakeover = await api.handle({
      method: 'POST',
      path: '/api/v1/locks/42/takeover',
      principal: other,
    });
    expect(forbiddenTakeover.status).toBe(403);

    const takeover = await api.handle({
      method: 'POST',
      path: '/api/v1/locks/42/takeover',
      principal: admin,
      body: { reason: 'edit' },
    });
    expect(takeover.status).toBe(200);
    expect((takeover.body as any).data.lock.userId).toBe('admin-a');
    expect((takeover.body as any).data.lock.takeoverCount).toBe(1);
  });

  test('in-memory server event bus fans out events and supports unsubscribe', async () => {
    const bus = createInMemoryServerEventBus();
    const first: ServerEvent[] = [];
    const second: ServerEvent[] = [];
    const subscription = bus.subscribe((event) => {
      first.push(event);
    });
    bus.subscribe((event) => {
      second.push(event);
    });
    const event: ServerEvent = {
      type: 'conversation_lock.acquired',
      workspaceId: 'workspace-a',
      entityType: 'email_message',
      entityId: '42',
      actorUserId: 'user-a',
      occurredAt: '2026-06-03T00:00:00.000Z',
      payload: { messageId: 42 },
    };

    await bus.publish(event);
    subscription.unsubscribe();
    await bus.publish({ ...event, entityId: '43', payload: { messageId: 43 } });

    expect(first.map((item) => item.entityId)).toEqual(['42']);
    expect(first.map((item) => item.sequence)).toEqual([1]);
    expect(second.map((item) => item.entityId)).toEqual(['42', '43']);
    expect(second.map((item) => item.sequence)).toEqual([1, 2]);
  });

  test('in-memory server event bus keeps bounded workspace replay history', async () => {
    const bus = createInMemoryServerEventBus({ replayLimit: 2 });
    const base: ServerEvent = {
      type: 'conversation_lock.acquired',
      workspaceId: 'workspace-a',
      entityType: 'email_message',
      entityId: '41',
      actorUserId: 'user-a',
      occurredAt: '2026-06-03T00:00:00.000Z',
      payload: { messageId: 41 },
    };

    await bus.publish(base);
    await bus.publish({ ...base, workspaceId: 'workspace-b', entityId: '42', payload: { messageId: 42 } });
    await bus.publish({ ...base, entityId: '43', payload: { messageId: 43 } });

    expect(bus.replay({ workspaceId: 'workspace-a' }).map((event) => event.entityId)).toEqual(['43']);
    expect(bus.replay({ workspaceId: 'workspace-b' }).map((event) => event.entityId)).toEqual(['42']);
    expect(bus.replay({ workspaceId: 'workspace-a', afterSequence: 2 }).map((event) => event.sequence)).toEqual([3]);
  });

  test('postgres server event port persists events, replays by workspace, and fans out notifications', async () => {
    const fake = makePostgresEventDb();
    const notifications = makeFakePostgresEventNotifications();
    const port = createPostgresServerEventPort({
      db: fake.db,
      notifications,
      applyWorkspaceSession: async (_trx, command) => {
        fake.sessionCommands.push(command);
      },
    });
    const otherPort = createPostgresServerEventPort({
      db: fake.db,
      notifications,
      applyWorkspaceSession: async (_trx, command) => {
        fake.sessionCommands.push(command);
      },
    });
    const received: ServerEvent[] = [];
    const receivedByOtherInstance: ServerEvent[] = [];
    port.subscribe((event) => {
      received.push(event);
    });
    otherPort.subscribe((event) => {
      receivedByOtherInstance.push(event);
    });

    await port.publish(makeServerEventForTest({
      workspaceId: WORKSPACE_A_ID,
      entityId: '41',
      actorUserId: USER_A_ID,
    }));
    await port.publish(makeServerEventForTest({
      workspaceId: WORKSPACE_B_ID,
      entityId: '42',
      actorUserId: USER_B_ID,
    }));
    await port.publish(makeServerEventForTest({
      workspaceId: WORKSPACE_A_ID,
      entityId: '43',
      actorUserId: USER_A_ID,
    }));
    await port.publish(makeServerEventForTest({
      workspaceId: WORKSPACE_A_ID,
      entityId: '44',
      actorUserId: USER_A_ID,
      type: 'customer.created',
      entityType: 'customer',
      payload: { id: 44, sourceSqliteId: -44 },
    }));
    await port.publish(makeServerEventForTest({
      workspaceId: WORKSPACE_A_ID,
      entityId: '45',
      actorUserId: USER_A_ID,
      type: 'deal_product.updated',
      entityType: 'deal_product',
      payload: { id: 45, dealId: 41, productId: 8 },
    }));

    const replay = await port.replay({ workspaceId: WORKSPACE_A_ID, afterSequence: 1 });

    expect(received.map((event) => [event.sequence, event.workspaceId, event.entityType, event.entityId])).toEqual([
      [1, WORKSPACE_A_ID, 'email_message', '41'],
      [2, WORKSPACE_B_ID, 'email_message', '42'],
      [3, WORKSPACE_A_ID, 'email_message', '43'],
      [4, WORKSPACE_A_ID, 'customer', '44'],
      [5, WORKSPACE_A_ID, 'deal_product', '45'],
    ]);
    expect(receivedByOtherInstance.map((event) => [event.sequence, event.workspaceId, event.entityType, event.entityId])).toEqual([
      [1, WORKSPACE_A_ID, 'email_message', '41'],
      [2, WORKSPACE_B_ID, 'email_message', '42'],
      [3, WORKSPACE_A_ID, 'email_message', '43'],
      [4, WORKSPACE_A_ID, 'customer', '44'],
      [5, WORKSPACE_A_ID, 'deal_product', '45'],
    ]);
    expect(replay.map((event) => [event.sequence, event.workspaceId, event.entityType, event.entityId])).toEqual([
      [3, WORKSPACE_A_ID, 'email_message', '43'],
      [4, WORKSPACE_A_ID, 'customer', '44'],
      [5, WORKSPACE_A_ID, 'deal_product', '45'],
    ]);
    expect(notifications.sent).toEqual([
      { workspaceId: WORKSPACE_A_ID, sequence: 1 },
      { workspaceId: WORKSPACE_B_ID, sequence: 2 },
      { workspaceId: WORKSPACE_A_ID, sequence: 3 },
      { workspaceId: WORKSPACE_A_ID, sequence: 4 },
      { workspaceId: WORKSPACE_A_ID, sequence: 5 },
    ]);
    expect(fake.rows.map((row) => row.payload)).toEqual([
      { messageId: 41 },
      { messageId: 42 },
      { messageId: 43 },
      { id: 44, sourceSqliteId: -44 },
      { id: 45, dealId: 41, productId: 8 },
    ]);
    expect(fake.sessionCommands).toEqual([
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_A_ID, role: 'system' }),
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_A_ID, role: 'system' }),
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_B_ID, role: 'system' }),
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_B_ID, role: 'system' }),
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_A_ID, role: 'system' }),
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_A_ID, role: 'system' }),
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_A_ID, role: 'system' }),
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_A_ID, role: 'system' }),
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_A_ID, role: 'system' }),
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_A_ID, role: 'system' }),
      buildWorkspaceSessionCommand({ workspaceId: WORKSPACE_A_ID, role: 'system' }),
    ]);
  });

});
