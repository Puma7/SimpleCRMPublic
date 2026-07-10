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

describe('server edition foundation — auth', () => {
  test('postgres auth port serializes live invitation creation per workspace email', () => {
    const source = readFileSync(join(process.cwd(), 'packages', 'server', 'src', 'db', 'postgres-auth-port.ts'), 'utf8');
    const lockIndex = source.indexOf('await acquireInvitationEmailLock(trx, input.workspaceId, input.email);');
    const duplicateUserIndex = source.indexOf('const existingUser = await selectUserByEmail(trx, input.workspaceId, input.email);');
    const duplicateInviteIndex = source.indexOf("selectFrom('auth_invitations')");

    expect(source).toContain("const AUTH_INVITATION_EMAIL_LOCK_PREFIX = 'simplecrm.auth_invitation.email';");
    expect(source).toContain('SELECT pg_advisory_xact_lock(hashtext(${invitationEmailLockKey(workspaceId, email)}))');
    expect(source).toContain('lower(email) = ${normalizeAuthEmail(input.email)}');
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    expect(duplicateUserIndex).toBeGreaterThan(lockIndex);
    expect(duplicateInviteIndex).toBeGreaterThan(lockIndex);
  });

  test('postgres auth port conditionally revokes refresh tokens before rotation', () => {
    const source = readFileSync(join(process.cwd(), 'packages', 'server', 'src', 'db', 'postgres-auth-port.ts'), 'utf8');
    const rotateIndex = source.indexOf('async rotateRefreshToken(input)');
    const revokeIndex = source.indexOf('const revokeResult = await trx', rotateIndex);
    const revokedNullIndex = source.indexOf(".where('revoked_at', 'is', null)", revokeIndex);
    const guardIndex = source.indexOf('Number(revokeResult.numUpdatedRows) < 1', revokeIndex);
    const issueIndex = source.indexOf('tokens: await issueTokenPair', revokeIndex);

    expect(rotateIndex).toBeGreaterThanOrEqual(0);
    expect(revokeIndex).toBeGreaterThan(rotateIndex);
    expect(revokedNullIndex).toBeGreaterThan(revokeIndex);
    expect(guardIndex).toBeGreaterThan(revokedNullIndex);
    expect(issueIndex).toBeGreaterThan(guardIndex);
  });

  test('postgres activity log port supports newest-first timeline sorting', () => {
    const source = readFileSync(join(process.cwd(), 'packages', 'server', 'src', 'db', 'postgres-extended-crm-read-ports.ts'), 'utf8');

    expect(source).toContain("input.sort === 'createdAtDesc'");
    expect(source).toContain("query.orderBy('created_at', 'desc').orderBy('id', 'desc')");
    expect(source).toContain("query.orderBy('id', 'asc')");
  });

  test('postgres mail message list uses sort-aligned composite cursors', () => {
    const source = readFileSync(join(process.cwd(), 'packages', 'server', 'src', 'db', 'postgres-mail-read-ports.ts'), 'utf8');
    const listSection = source.slice(
      source.indexOf('async list(input): Promise<EmailMessageListResult>'),
      source.indexOf('async get(input): Promise<EmailMessageRecord | null>'),
    );

    expect(listSection).toContain('const priorityCursor =');
    expect(listSection).toContain('fetchPriorityCursorAnchor(trx, input.workspaceId, input.cursor)');
    expect(listSection).toContain('query = applyMessageCursor(');
    expect(source).toContain("if (view === 'snoozed')");
    expect(source).toContain("if (sort === 'date_asc')");
    expect(source).toContain("if (sort === 'priority')");
    expect(source).toContain('messagePriorityRankSql');
    expect(source).toContain('cursorMessageSortDateSql');
    expect(source).toContain('coalesce(email_messages.date_received, email_messages.created_at)');
    expect(source).toContain('sortDate: Date | null');
    expect(source).toContain('IS NULL');
    expect(source).toContain('IS NOT NULL');
    expect(source).toContain('email_messages.id > cursor_message.id');
    expect(source).toContain('email_messages.id < cursor_message.id');
    expect(source).toContain('email_messages.snoozed_until > cursor_message.snoozed_until');
    expect(listSection.indexOf('query = applyMessageCursor('))
      .toBeLessThan(listSection.indexOf('query = applyMessageListOrder(query, input.sort, input.view);'));
  });

  test('postgres mail folder badge counts exclude done archived messages', () => {
    const source = readFileSync(join(process.cwd(), 'packages', 'server', 'src', 'db', 'postgres-mail-read-ports.ts'), 'utf8');
    const countsSection = source.slice(
      source.indexOf('async getFolderCounts(input): Promise<EmailMailFolderCounts>'),
      source.indexOf('function normalizeRestoreFolderKind'),
    );
    const archivedAggregate = countsSection.slice(
      countsSection.indexOf("`.as('archived')") - 450,
      countsSection.indexOf("`.as('archived')"),
    );

    expect(archivedAggregate).toContain('and archived = true');
    expect(archivedAggregate).toContain("and coalesce(spam_status, 'clean') = 'clean'");
    expect(archivedAggregate).toContain('and coalesce(done_local, false) = false');
  });

  test('server auth user admin routes list, create, update, and protect owners without secret leakage', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const ports = makeServerApiPorts({ auditEvents });
    const api = createServerApi(ports);
    const admin = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'admin' as const };

    const list = await api.handle({
      method: 'GET',
      path: '/api/v1/auth/users',
      principal: admin,
    });
    expect(list.status).toBe(200);
    expect((list.body as any).data).toEqual([
      expect.objectContaining({
        id: 'user-a',
        email: 'owner@example.com',
        displayName: 'Owner',
        role: 'owner',
        disabledAt: null,
      }),
    ]);

    const forbidden = await api.handle({
      method: 'GET',
      path: '/api/v1/auth/users',
      principal: { ...admin, role: 'user' },
    });
    expect(forbidden.status).toBe(403);

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/users',
      principal: admin,
      body: {
        username: ' AGENT@EXAMPLE.COM ',
        displayName: ' Agent ',
        role: 'agent',
        passphrase: 'agent-passphrase',
      },
    });
    expect(created.status).toBe(201);
    const createdUser = (created.body as any).data;
    expect(createdUser).toMatchObject({
      id: 'auth-user-1',
      email: 'agent@example.com',
      displayName: 'Agent',
      role: 'user',
      disabledAt: null,
    });

    const duplicate = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/users',
      principal: admin,
      body: {
        email: 'agent@example.com',
        displayName: 'Agent 2',
        role: 'user',
        password: 'another-passphrase',
      },
    });
    expect(duplicate.status).toBe(409);
    expect((duplicate.body as any).error.code).toBe('auth_user_duplicate_email');

    const updated = await api.handle({
      method: 'PATCH',
      path: `/api/v1/auth/users/${createdUser.id}`,
      principal: admin,
      body: {
        email: 'agent-renamed@example.com',
        displayName: 'Agent Renamed',
        role: 'admin',
        isActive: false,
      },
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data).toMatchObject({
      id: createdUser.id,
      email: 'agent-renamed@example.com',
      displayName: 'Agent Renamed',
      role: 'admin',
    });
    expect((updated.body as any).data.disabledAt).toBeTruthy();

    const ownerBlocked = await api.handle({
      method: 'PATCH',
      path: '/api/v1/auth/users/user-a',
      principal: admin,
      body: {
        email: 'owner@example.com',
        displayName: 'Owner',
        role: 'user',
      },
    });
    expect(ownerBlocked.status).toBe(409);
    expect((ownerBlocked.body as any).error.code).toBe('last_owner_required');

    expect(auditEvents.map((event) => event.action)).toEqual([
      'auth.user_created',
      'auth.user_updated',
    ]);
    expect(auditEvents[0]).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      entityType: 'user',
      entityId: createdUser.id,
      metadata: {
        email: 'agent@example.com',
        role: 'user',
        isActive: true,
        passwordChanged: true,
      },
    });
    expect(auditEvents[1].metadata).toEqual({
      email: 'agent-renamed@example.com',
      role: 'admin',
      isActive: false,
      passwordChanged: false,
      loginPinChanged: false,
    });
    expect(JSON.stringify(created.body)).not.toContain('agent-passphrase');
    expect(JSON.stringify(auditEvents)).not.toContain('agent-passphrase');
  });

  test('server auth invitation routes create single-use links and accept with user-owned password', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const mailDeliveries: unknown[] = [];
    const ports = makeServerApiPorts({
      auditEvents,
      authInvitationMailer: {
        async sendInvitation(input) {
          mailDeliveries.push(input);
          if (input.invitation.email === 'fail@example.com') throw new Error('smtp failed with invite-token-2');
          return {
            status: 'sent',
            recipient: input.invitation.email,
            sentAt: '2026-06-04T12:00:00.000Z',
          };
        },
      },
    });
    const api = createServerApi(ports);
    const admin = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'admin' as const };

    const forbidden = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/invitations',
      principal: { ...admin, role: 'user' },
      body: {
        email: 'invited@example.com',
        displayName: 'Invited',
        role: 'user',
      },
    });
    expect(forbidden.status).toBe(403);

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/invitations',
      principal: admin,
      body: {
        email: ' INVITED@EXAMPLE.COM ',
        displayName: ' Invited User ',
        role: 'agent',
        expiresInDays: 7,
      },
    });
    expect(created.status).toBe(201);
    expect((created.body as any).data).toMatchObject({
      token: 'invite-token-1',
      acceptPath: '/login?invite=invite-token-1',
      delivery: {
        status: 'sent',
        recipient: 'invited@example.com',
        sentAt: '2026-06-04T12:00:00.000Z',
      },
      invitation: {
        id: 'auth-invite-1',
        email: 'invited@example.com',
        displayName: 'Invited User',
        role: 'user',
        acceptedAt: null,
        revokedAt: null,
      },
    });
    expect(mailDeliveries).toHaveLength(1);
    expect(mailDeliveries[0]).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      acceptPath: '/login?invite=invite-token-1',
      invitation: {
        email: 'invited@example.com',
      },
    });

    const duplicateInvite = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/invitations',
      principal: admin,
      body: {
        email: 'invited@example.com',
        displayName: 'Invited User',
        role: 'user',
      },
    });
    expect(duplicateInvite.status).toBe(409);
    expect((duplicateInvite.body as any).error.code).toBe('auth_invitation_duplicate');

    const publicRead = await api.handle({
      method: 'GET',
      path: '/api/v1/auth/invitations/invite-token-1',
    });
    expect(publicRead.status).toBe(200);
    expect((publicRead.body as any).data).toMatchObject({
      email: 'invited@example.com',
      displayName: 'Invited User',
      role: 'user',
    });

    const invalidAccept = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/invitations/invite-token-1/accept',
      body: { password: 'short' },
    });
    expect(invalidAccept.status).toBe(400);

    const accepted = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/invitations/invite-token-1/accept',
      body: {
        password: 'invite-passphrase',
        device: 'browser',
      },
    });
    expect(accepted.status).toBe(200);
    expect((accepted.body as any).data).toMatchObject({
      user: {
        email: 'invited@example.com',
        displayName: 'Invited User',
        role: 'user',
      },
      tokens: {
        refreshToken: 'refresh-token',
      },
    });
    expect(JSON.stringify(accepted.body)).not.toContain('passwordHash');

    const acceptedAgain = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/invitations/invite-token-1/accept',
      body: { password: 'invite-passphrase' },
    });
    expect(acceptedAgain.status).toBe(410);
    expect((acceptedAgain.body as any).error.code).toBe('auth_invitation_accepted');

    const duplicateUser = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/invitations',
      principal: admin,
      body: {
        email: 'invited@example.com',
        displayName: 'Invited Again',
        role: 'user',
      },
    });
    expect(duplicateUser.status).toBe(409);
    expect((duplicateUser.body as any).error.code).toBe('auth_user_duplicate_email');

    const invalidRead = await api.handle({
      method: 'GET',
      path: '/api/v1/auth/invitations/not-a-token',
    });
    expect(invalidRead.status).toBe(404);

    const deliveryFailed = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/invitations',
      principal: admin,
      body: {
        email: 'fail@example.com',
        displayName: 'SMTP Fail',
        role: 'user',
      },
    });
    expect(deliveryFailed.status).toBe(201);
    expect((deliveryFailed.body as any).data.delivery).toEqual({
      status: 'failed',
      error: 'smtp_send_failed',
    });

    expect(auditEvents.map((event) => event.action)).toEqual([
      'auth.invitation_created',
      'auth.invitation_accepted',
      'auth.invitation_created',
    ]);
    expect(auditEvents[0]).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      entityType: 'auth_invitation',
      entityId: 'auth-invite-1',
      metadata: {
        email: 'invited@example.com',
        role: 'user',
        expiresAt: '2026-06-11T12:00:00.000Z',
        deliveryStatus: 'sent',
      },
    });
    expect(auditEvents[2]).toMatchObject({
      metadata: {
        email: 'fail@example.com',
        deliveryStatus: 'failed',
        deliveryError: 'smtp_send_failed',
      },
    });
    expect(auditEvents[1]).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      entityType: 'user',
      metadata: {
        email: 'invited@example.com',
        role: 'user',
        device: 'browser',
      },
    });
    expect(JSON.stringify(auditEvents)).not.toContain('invite-token-1');
    expect(JSON.stringify(auditEvents)).not.toContain('invite-token-2');
    expect(JSON.stringify(auditEvents)).not.toContain('invite-passphrase');
  });

  test('server auth route records failed login and returns penalty details', async () => {
    const ports = makeServerApiPorts();
    const api = createServerApi(ports);

    const bad = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/login',
      ip: '127.0.0.1',
      body: { email: 'owner@example.com', password: 'wrong' },
    });

    expect(bad.status).toBe(401);
    expect((bad.body as any).error.code).toBe('invalid_credentials');
    expect((bad.body as any).error.details.failedAttempts).toBe(1);
    expect((bad.body as any).error.details.penalty).toEqual({ kind: 'temporary', lockSeconds: 30 });
  });

  test('server auth route enforces active login locks before password verification', async () => {
    const ports = makeServerApiPorts();
    const findUserByEmail = jest.spyOn(ports.auth, 'findUserByEmail');
    const verifyPassword = jest.spyOn(ports.auth, 'verifyPassword');
    ports.auth.checkLoginLock = async () => ({ kind: 'temporary', lockSeconds: 12 });
    const api = createServerApi(ports);

    const blocked = await api.handle({
      method: 'POST',
      path: '/api/v1/auth/login',
      ip: '127.0.0.1',
      body: { email: 'owner@example.com', password: 'correct' },
    });

    expect(blocked.status).toBe(429);
    expect((blocked.body as any).error.code).toBe('rate_limited');
    expect((blocked.body as any).error.details.penalty).toEqual({ kind: 'temporary', lockSeconds: 12 });
    expect(findUserByEmail).not.toHaveBeenCalled();
    expect(verifyPassword).not.toHaveBeenCalled();
  });

  test('server auth routes record audit events without password or token leakage', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const ports = makeServerApiPorts({ auditEvents });
    const api = createServerApi(ports);

    await api.handle({
      method: 'POST',
      path: '/api/v1/auth/login',
      ip: '127.0.0.1',
      body: { email: 'owner@example.com', password: 'wrong' },
    });
    await api.handle({
      method: 'POST',
      path: '/api/v1/auth/login',
      ip: '127.0.0.1',
      body: { email: 'owner@example.com', password: 'correct', device: 'desktop' },
    });
    await api.handle({
      method: 'POST',
      path: '/api/v1/auth/refresh',
      body: { refreshToken: 'refresh-token' },
    });
    await api.handle({
      method: 'POST',
      path: '/api/v1/auth/logout',
      principal: { userId: 'user-a', workspaceId: 'workspace-a', role: 'user' },
      body: { refreshToken: 'refresh-token-rotated' },
    });

    expect(auditEvents.map((event) => event.action)).toEqual([
      'auth.login_failed',
      'auth.login_succeeded',
      'auth.refresh_rotated',
      'auth.logout',
    ]);
    expect(auditEvents[0]).toMatchObject({
      workspaceId: 'workspace-a',
      actorUserId: 'user-a',
      entityType: 'user',
      entityId: 'user-a',
      metadata: {
        email: 'owner@example.com',
        failedAttempts: 1,
        penaltyKind: 'temporary',
      },
    });
    expect(auditEvents[1].metadata).toEqual({
      email: 'owner@example.com',
      ip: '127.0.0.1',
      device: 'desktop',
    });
    expect(JSON.stringify(auditEvents)).not.toContain('correct');
    expect(JSON.stringify(auditEvents)).not.toContain('refresh-token');
    expect(JSON.stringify(auditEvents)).not.toContain('access-token');
  });

  test('server auth audit routes require admin and use principal workspace', async () => {
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      audit: {
        async record() {
          return undefined;
        },
        async list(input) {
          calls.push(['list', input]);
          return [{
            id: 4,
            workspaceId: input.workspaceId,
            actorUserId: USER_A_ID,
            action: 'email_message.customer_link.backfilled',
            entityType: 'email_message',
            entityId: 'bulk',
            metadata: { count: 3 },
            previousHash: null,
            eventHash: 'hash-4',
            createdAt: '2026-06-04T10:00:00.000Z',
          }];
        },
        async verify(input) {
          calls.push(['verify', input]);
          return { valid: true, checked: 1 };
        },
      },
    }));

    const admin = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'admin' as const };
    const list = await api.handle({
      method: 'GET',
      path: '/api/v1/auth/audit-log',
      query: { limit: '50', offset: '2' },
      principal: admin,
    });
    expect(list.status).toBe(200);
    expect((list.body as any).data[0]).toMatchObject({
      id: 4,
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      eventHash: 'hash-4',
    });

    const verify = await api.handle({
      method: 'GET',
      path: '/api/v1/auth/audit-chain/verify',
      principal: admin,
    });
    expect(verify.status).toBe(200);
    expect((verify.body as any).data).toEqual({ valid: true, checked: 1 });

    const forbidden = await api.handle({
      method: 'GET',
      path: '/api/v1/auth/audit-log',
      principal: { ...admin, role: 'user' },
    });
    expect(forbidden.status).toBe(403);

    const invalid = await api.handle({
      method: 'GET',
      path: '/api/v1/auth/audit-log',
      query: { limit: '501' },
      principal: admin,
    });
    expect(invalid.status).toBe(400);

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'GET',
      path: '/api/v1/auth/audit-chain/verify',
      principal: admin,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('audit_unavailable');

    expect(calls).toEqual([
      ['list', { workspaceId: WORKSPACE_A_ID, limit: 50, offset: 2 }],
      ['verify', { workspaceId: WORKSPACE_A_ID }],
    ]);
  });

  test('server automation API key routes expose metadata without key hashes or secret IDs', async () => {
    const listCalls: unknown[] = [];
    const getCalls: unknown[] = [];
    const ports = makeServerApiPorts({
      automationApiKeys: {
        async list(input) {
          listCalls.push(input);
          return {
            items: [withRuntimeLeaks(makeAutomationApiKeyRecord('55555555-5555-4555-8555-555555555555'))],
            nextCursor: '55555555-5555-4555-8555-555555555555',
          };
        },
        async get(input) {
          getCalls.push(input);
          return input.id === '55555555-5555-4555-8555-555555555555'
            ? withRuntimeLeaks(makeAutomationApiKeyRecord('55555555-5555-4555-8555-555555555555'))
            : null;
        },
      },
    });
    const api = createServerApi(ports);
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'admin' as const };

    const list = await api.handle({
      method: 'GET',
      path: '/api/v1/automation/api-keys',
      query: {
        search: ' Import ',
        revoked: 'false',
        cursor: '44444444-4444-4444-8444-444444444444',
        limit: '10',
      },
      principal,
    });
    expect(list.status).toBe(200);
    expect((list.body as any).data.items[0].secretConfigured).toBe(true);
    expect(JSON.stringify(list.body)).not.toContain('key_hash');
    expect(JSON.stringify(list.body)).not.toContain('secret-id');
    expect(listCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 10,
      cursor: '44444444-4444-4444-8444-444444444444',
      revoked: false,
      search: 'Import',
    }]);

    const get = await api.handle({
      method: 'GET',
      path: '/api/v1/automation/api-keys/55555555-5555-4555-8555-555555555555',
      principal,
    });
    expect(get.status).toBe(200);
    expect((get.body as any).data.label).toBe('Import webhook');
    expect(getCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      id: '55555555-5555-4555-8555-555555555555',
    }]);
  });

  test('server automation API key routes create and revoke keys without leaking secrets to audit or events', async () => {
    const createCalls: unknown[] = [];
    const revokeCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const apiKey = makeAutomationApiKeyRecord('55555555-5555-4555-8555-555555555555');
    const revokedApiKey: AutomationApiKeyRecord = {
      ...apiKey,
      revokedAt: '2026-06-03T12:00:00.000Z',
      secretConfigured: false,
      updatedAt: '2026-06-03T12:00:00.000Z',
    };
    const ports = makeServerApiPorts({
      auditEvents,
      events,
      automationApiKeys: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return apiKey;
        },
        async create(input) {
          createCalls.push(input);
          return {
            ok: true,
            apiKey: withRuntimeLeaks(apiKey),
            key: 'scrm_test_key',
          };
        },
        async revoke(input) {
          revokeCalls.push(input);
          return input.id === apiKey.id
            ? { ok: true, apiKey: withRuntimeLeaks(revokedApiKey) }
            : null;
        },
      },
    });
    const api = createServerApi(ports);
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'admin' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/automation/api-keys',
      body: {
        label: ' Import webhook ',
        scopes: [' webhook:fire ', 'mail:read'],
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect((created.body as any).data).toMatchObject({
      key: 'scrm_test_key',
      apiKey: {
        id: apiKey.id,
        label: 'Import webhook',
        secretConfigured: true,
      },
    });
    expect(JSON.stringify((created.body as any).data.apiKey)).not.toContain('key_hash');
    expect(JSON.stringify((created.body as any).data.apiKey)).not.toContain('automation-secret-id');
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        label: 'Import webhook',
        scopes: ['webhook:fire', 'mail:read'],
      },
    }]);

    const revoked = await api.handle({
      method: 'DELETE',
      path: `/api/v1/automation/api-keys/${apiKey.id}`,
      principal,
    });
    expect(revoked.status).toBe(200);
    expect((revoked.body as any).data).toMatchObject({
      revoked: true,
      apiKey: {
        id: apiKey.id,
        revokedAt: '2026-06-03T12:00:00.000Z',
        secretConfigured: false,
      },
    });
    expect(revokeCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: apiKey.id,
    }]);
    expect(auditEvents.map((event) => [event.action, event.entityType, event.entityId])).toEqual([
      ['automation_api_key.created', 'automation_api_key', apiKey.id],
      ['automation_api_key.revoked', 'automation_api_key', apiKey.id],
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['automation_api_key.created', WORKSPACE_A_ID, 'automation_api_key', apiKey.id],
      ['automation_api_key.revoked', WORKSPACE_A_ID, 'automation_api_key', apiKey.id],
    ]);
    expect(JSON.stringify(auditEvents)).not.toContain('scrm_test_key');
    expect(JSON.stringify(events)).not.toContain('scrm_test_key');
    expect(JSON.stringify(auditEvents)).not.toContain('hashed-api-key');
    expect(JSON.stringify(events)).not.toContain('automation-secret-id');
  });

  test('postgres automation API key port verifies hashed bearer keys with scoped principals', async () => {
    const keyId = '55555555-5555-4555-8555-555555555555';
    const now = new Date('2026-06-03T12:00:00.000Z');
    const selectedRow = {
      id: keyId,
      workspace_id: WORKSPACE_A_ID,
      scopes: ['workflows'],
      revoked_at: null,
      created_by_user_id: USER_A_ID,
    };
    const selectCalls: Array<{
      table: string;
      columns: readonly string[];
      wheres: Array<readonly [string, string, unknown]>;
    }> = [];
    const updateCalls: Array<{
      table: string;
      setValues: Record<string, unknown>;
      wheres: Array<readonly [string, string, unknown]>;
    }> = [];
    const sessionCommands: unknown[] = [];
    const trx = {
      selectFrom(table: string) {
        const call = { table, columns: [] as readonly string[], wheres: [] as Array<readonly [string, string, unknown]> };
        const builder = {
          select(columns: readonly string[]) {
            call.columns = columns;
            return builder;
          },
          where(column: string, operator: string, value: unknown) {
            call.wheres.push([column, operator, value]);
            return builder;
          },
          async executeTakeFirst() {
            selectCalls.push(call);
            return selectedRow;
          },
        };
        return builder;
      },
      updateTable(table: string) {
        const call = { table, setValues: {} as Record<string, unknown>, wheres: [] as Array<readonly [string, string, unknown]> };
        const builder = {
          set(values: Record<string, unknown>) {
            call.setValues = values;
            return builder;
          },
          where(column: string, operator: string, value: unknown) {
            call.wheres.push([column, operator, value]);
            return builder;
          },
          async execute() {
            updateCalls.push(call);
            return [];
          },
        };
        return builder;
      },
    };
    const db = {
      transaction() {
        return {
          execute(operation: (transaction: typeof trx) => Promise<unknown>) {
            return operation(trx);
          },
        };
      },
    } as unknown as Kysely<ServerDatabase>;
    const port = createPostgresAutomationApiKeyReadPort({
      db,
      applyWorkspaceSession: async (_trx, command) => {
        sessionCommands.push(command);
      },
      now: () => now,
    });
    const verify = port.verify!;

    await expect(verify({ key: ' scrm_live_key ', requiredScope: 'workflows' })).resolves.toEqual({
      userId: USER_A_ID,
      workspaceId: WORKSPACE_A_ID,
      role: 'user',
      automationApiKeyId: keyId,
      automationScopes: ['workflows'],
    });
    expect((sessionCommands[0] as any).params[3]).toBe('on');
    expect((sessionCommands[1] as any).params).toEqual([WORKSPACE_A_ID, USER_A_ID, 'system', 'off']);
    expect(selectCalls[0]).toMatchObject({
      table: 'automation_api_keys',
      wheres: [
        ['key_hash', '=', `sha256:${createHash('sha256').update('scrm_live_key', 'utf8').digest('hex')}`],
        ['revoked_at', 'is', null],
      ],
    });
    expect(updateCalls).toEqual([{
      table: 'automation_api_keys',
      setValues: {
        last_used_at: now,
        updated_at: now,
      },
      wheres: [
        ['workspace_id', '=', WORKSPACE_A_ID],
        ['id', '=', keyId],
        ['revoked_at', 'is', null],
      ],
    }]);

    await expect(verify({ key: 'scrm_live_key', requiredScope: 'email' })).resolves.toBeNull();
    expect(updateCalls).toHaveLength(1);
  });

  test('server automation API key routes validate auth, UUIDs, filters, and missing ports', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'admin' as const };

    const unauthorized = await api.handle({ method: 'GET', path: '/api/v1/automation/api-keys' });
    expect(unauthorized.status).toBe(401);

    const invalidId = await api.handle({
      method: 'GET',
      path: '/api/v1/automation/api-keys/not-a-uuid',
      principal,
    });
    expect(invalidId.status).toBe(400);
    expect((invalidId.body as any).error.code).toBe('invalid_automation_api_key_id');

    const invalidCursor = await api.handle({
      method: 'GET',
      path: '/api/v1/automation/api-keys',
      query: { cursor: 'not-a-uuid' },
      principal,
    });
    expect(invalidCursor.status).toBe(400);
    expect((invalidCursor.body as any).error.code).toBe('invalid_cursor');

    const invalidRevoked = await api.handle({
      method: 'GET',
      path: '/api/v1/automation/api-keys',
      query: { revoked: 'maybe' },
      principal,
    });
    expect(invalidRevoked.status).toBe(400);
    expect((invalidRevoked.body as any).error.code).toBe('invalid_revoked');

    const unavailable = await api.handle({
      method: 'GET',
      path: '/api/v1/automation/api-keys',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('automation_api_keys_unavailable');
  });

  test('server automation API key mutation routes reject unsafe payloads and unavailable secret storage', async () => {
    const readOnlyApi = createServerApi(makeServerApiPorts({
      automationApiKeys: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      automationApiKeys: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          if (input.values.label === 'Needs secret') return { ok: false, code: 'secret_port_unavailable' };
          return { ok: true, apiKey: makeAutomationApiKeyRecord('55555555-5555-4555-8555-555555555555'), key: 'scrm_test_key' };
        },
        async revoke(input) {
          if (input.id === '55555555-5555-4555-8555-555555555555') return { ok: false, code: 'secret_port_unavailable' };
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'admin' as const };

    const unavailableCreate = await readOnlyApi.handle({
      method: 'POST',
      path: '/api/v1/automation/api-keys',
      body: { label: 'Import webhook' },
      principal,
    });
    expect(unavailableCreate.status).toBe(503);
    expect((unavailableCreate.body as any).error.code).toBe('automation_api_keys_unavailable');

    const invalidPayload = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/automation/api-keys',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_automation_api_key_payload');

    const invalidLabel = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/automation/api-keys',
      body: { label: '   ' },
      principal,
    });
    expect(invalidLabel.status).toBe(400);
    expect((invalidLabel.body as any).error.code).toBe('invalid_automation_api_key_label');

    const invalidScopes = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/automation/api-keys',
      body: { label: 'Import webhook', scopes: ['webhook:fire', ''] },
      principal,
    });
    expect(invalidScopes.status).toBe(400);
    expect((invalidScopes.body as any).error.code).toBe('invalid_automation_api_key_scopes');

    const secretUnavailable = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/automation/api-keys',
      body: { label: 'Needs secret' },
      principal,
    });
    expect(secretUnavailable.status).toBe(503);
    expect((secretUnavailable.body as any).error.code).toBe('automation_api_key_secret_unavailable');

    const unavailableRevoke = await readOnlyApi.handle({
      method: 'DELETE',
      path: '/api/v1/automation/api-keys/55555555-5555-4555-8555-555555555555',
      principal,
    });
    expect(unavailableRevoke.status).toBe(503);
    expect((unavailableRevoke.body as any).error.code).toBe('automation_api_keys_unavailable');

    const invalidRevokeId = await writableApi.handle({
      method: 'DELETE',
      path: '/api/v1/automation/api-keys/not-a-uuid',
      principal,
    });
    expect(invalidRevokeId.status).toBe(400);
    expect((invalidRevokeId.body as any).error.code).toBe('invalid_automation_api_key_id');

    const revokeSecretUnavailable = await writableApi.handle({
      method: 'DELETE',
      path: '/api/v1/automation/api-keys/55555555-5555-4555-8555-555555555555',
      principal,
    });
    expect(revokeSecretUnavailable.status).toBe(503);
    expect((revokeSecretUnavailable.body as any).error.code).toBe('automation_api_key_secret_unavailable');

    const missingRevoke = await writableApi.handle({
      method: 'DELETE',
      path: '/api/v1/automation/api-keys/66666666-6666-4666-8666-666666666666',
      principal,
    });
    expect(missingRevoke.status).toBe(404);
    expect((missingRevoke.body as any).error.code).toBe('automation_api_key_not_found');
  });

  test('server customer routes require auth, validate pagination, and use principal workspace', async () => {
    const listCalls: unknown[] = [];
    const getCalls: unknown[] = [];
    const ports = makeServerApiPorts({
      customers: {
        async list(input) {
          listCalls.push(input);
          return {
            items: [makeCustomerRecord(7)],
            nextCursor: 7,
          };
        },
        async get(input) {
          getCalls.push(input);
          return input.id === 7 ? makeCustomerRecord(7) : null;
        },
      },
    });
    const api = createServerApi(ports);

    const unauthorized = await api.handle({
      method: 'GET',
      path: '/api/v1/customers',
    });
    expect(unauthorized.status).toBe(401);

    const list = await api.handle({
      method: 'GET',
      path: '/api/v1/customers',
      query: {
        search: ' Alice ',
        offset: '40',
        limit: '20',
        status: 'Lead',
        sortBy: 'fullName',
        sortDirection: 'desc',
      },
      principal: { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' },
    });
    expect(list.status).toBe(200);
    expect((list.body as any).data.items[0].id).toBe(7);
    expect(listCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      limit: 20,
      offset: 40,
      search: 'Alice',
      status: 'Lead',
      sortBy: 'fullName',
      sortDirection: 'desc',
    }]);

    const get = await api.handle({
      method: 'GET',
      path: '/api/v1/customers/7',
      principal: { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' },
    });
    expect(get.status).toBe(200);
    expect((get.body as any).data.email).toBe('customer7@example.com');
    expect(getCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, id: 7 }]);

    const missing = await api.handle({
      method: 'GET',
      path: '/api/v1/customers/8',
      principal: { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' },
    });
    expect(missing.status).toBe(404);
  });

  test('server customer routes fail closed for missing port and invalid query input', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await api.handle({
      method: 'GET',
      path: '/api/v1/customers',
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidLimit = await api.handle({
      method: 'GET',
      path: '/api/v1/customers',
      query: { limit: '101' },
      principal,
    });
    expect(invalidLimit.status).toBe(400);
    expect((invalidLimit.body as any).error.code).toBe('invalid_limit');

    const invalidCursor = await api.handle({
      method: 'GET',
      path: '/api/v1/customers',
      query: { cursor: '0' },
      principal,
    });
    expect(invalidCursor.status).toBe(400);

    const ambiguousPagination = await api.handle({
      method: 'GET',
      path: '/api/v1/customers',
      query: { cursor: '1', offset: '1' },
      principal,
    });
    expect(ambiguousPagination.status).toBe(400);

    const cursorWithSort = await api.handle({
      method: 'GET',
      path: '/api/v1/customers',
      query: { cursor: '1', sortBy: 'fullName' },
      principal,
    });
    expect(cursorWithSort.status).toBe(400);

    const invalidId = await api.handle({
      method: 'GET',
      path: '/api/v1/customers/nope',
      principal,
    });
    expect(invalidId.status).toBe(400);
  });

  test('server customer mutation routes validate payloads, use principal workspace, and audit changes', async () => {
    const createCalls: unknown[] = [];
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const ports = makeServerApiPorts({
      auditEvents,
      events,
      customers: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          return {
            ...makeCustomerRecord(21),
            sourceSqliteId: -21,
            name: input.values.name ?? null,
            email: input.values.email ?? null,
          };
        },
        async update(input) {
          updateCalls.push(input);
          return input.id === 21
            ? {
              ...makeCustomerRecord(21),
              phone: input.values.phone ?? '030-123',
              status: input.values.status ?? 'Active',
            }
            : null;
        },
        async delete(input) {
          deleteCalls.push(input);
          return input.id === 21 ? makeCustomerRecord(21) : null;
        },
      },
    });
    const api = createServerApi(ports);
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/customers',
      body: {
        name: ' Alice Example ',
        email: ' alice@example.com ',
        notes: '  important customer  ',
      },
      principal,
    });
    expect(created.status).toBe(201);
    expect((created.body as any).data).toMatchObject({
      id: 21,
      sourceSqliteId: -21,
      name: 'Alice Example',
      email: 'alice@example.com',
    });
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        name: 'Alice Example',
        email: 'alice@example.com',
        notes: 'important customer',
      },
    }]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/customers/21',
      body: {
        phone: ' ',
        status: ' Active ',
      },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.phone).toBe('030-123');
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 21,
      values: {
        phone: null,
        status: 'Active',
      },
    }]);

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/customers/21',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data.deleted).toBe(true);
    expect(deleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      id: 21,
    }]);
    expect(auditEvents.map((event) => event.action)).toEqual([
      'customer.created',
      'customer.updated',
      'customer.deleted',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['customer.created', WORKSPACE_A_ID, 'customer', '21'],
      ['customer.updated', WORKSPACE_A_ID, 'customer', '21'],
      ['customer.deleted', WORKSPACE_A_ID, 'customer', '21'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 21,
      sourceSqliteId: -21,
      name: 'Alice Example',
      email: 'alice@example.com',
    });
    expect(auditEvents[1]).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      entityType: 'customer',
      entityId: '21',
      metadata: {
        fields: ['phone', 'status'],
      },
    });
  });

  test('server customer mutation routes reject unsafe or incomplete payloads', async () => {
    const api = createServerApi(makeServerApiPorts({
      customers: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
      },
    }));
    const writableApi = createServerApi(makeServerApiPorts({
      customers: {
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

    const unavailable = await api.handle({
      method: 'POST',
      path: '/api/v1/customers',
      body: { name: 'Alice' },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidBody = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customers',
      body: ['not-object'],
      principal,
    });
    expect(invalidBody.status).toBe(400);
    expect((invalidBody.body as any).error.code).toBe('invalid_customer_payload');

    const missingIdentity = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customers',
      body: { phone: '030-123' },
      principal,
    });
    expect(missingIdentity.status).toBe(400);

    const emptyPatch = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/customers/21',
      body: {},
      principal,
    });
    expect(emptyPatch.status).toBe(400);

    const unsafeFields = await writableApi.handle({
      method: 'POST',
      path: '/api/v1/customers',
      body: {
        name: 'Alice',
        email: 'not an email',
        workspaceId: WORKSPACE_B_ID,
      },
      principal,
    });
    expect(unsafeFields.status).toBe(400);
    expect((unsafeFields.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'email', message: 'email muss eine gueltige Adresse sein' },
    ]));
  });

});
