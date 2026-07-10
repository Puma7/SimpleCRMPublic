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

describe('server edition foundation — compose-send', () => {
  test('server compose sender uses outbox claim and recovers without duplicate SMTP', async () => {
    const smtpSends: unknown[] = [];
    const syncInfo = new Map<string, string | null>();
    let locked = false;
    const draft = {
      id: 48,
      accountId: 7,
      uid: -48,
      folderKind: 'draft' as const,
      subject: 'Outbox',
      bodyText: 'Retry',
      bodyHtml: null,
      messageIdHeader: null,
      inReplyToHeader: null,
      referencesHeader: null,
      ticketCode: null,
      threadId: null,
      draftAttachmentPathsJson: null,
      outboundHold: false,
      outboundBlockReason: null,
    };
    const account = {
      id: 7,
      sourceSqliteId: 70,
      displayName: 'Support',
      emailAddress: 'agent@example.com',
      imapHost: 'imap.example.com',
      imapUsername: 'agent@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpTls: true,
      smtpUsername: 'smtp-agent@example.com',
      smtpUseImapAuth: false,
      oauthProvider: null,
      protocol: 'imap' as const,
      requestReadReceipt: false,
    };
    let smtpAttempts = 0;
    const sender = createEmailComposeSenderPort({
      now: () => new Date('2026-07-03T08:05:00.000Z'),
      smtpSend: async (input) => {
        smtpAttempts += 1;
        if (smtpAttempts === 1) throw new Error('smtp transient');
        smtpSends.push(input);
      },
      store: {
        async getDraft(input) {
          return input.messageId === 48 ? draft : null;
        },
        async getAccount(input) {
          return input.accountId === 7 ? account : null;
        },
        async getParentMessage() {
          return null;
        },
        async getOrCreateThreadForTicket() {
          return 'th-outbox';
        },
        async readSecret(input) {
          return input.kind === 'email.account.smtp_password' ? Buffer.from('smtp-secret') : null;
        },
        async getSyncInfo(input) {
          return new Map(input.keys.map((key) => [key, syncInfo.get(key) ?? null]));
        },
        async setSyncInfo(input) {
          for (const [key, value] of Object.entries(input.values)) syncInfo.set(key, value);
        },
        async deleteSyncInfo(input) {
          for (const key of input.keys) syncInfo.delete(key);
        },
        async claimSmtpOutbox(input) {
          const key = `email_compose_smtp_ok:${input.messageId}`;
          const existing = syncInfo.get(key);
          if (existing === '1' || existing === 'sent') return 'committed';
          if (existing === 'outbox') return 'outbox';
          syncInfo.set(key, 'outbox');
          return 'claimed';
        },
        async tryAcquireSendingLock() {
          if (locked) return false;
          locked = true;
          return true;
        },
        async releaseSendingLock() {
          locked = false;
        },
        async updateDraftForSend() {
          return undefined;
        },
        async markDraftAsSent() {
          return undefined;
        },
        async markMessageDone() {
          return undefined;
        },
      },
    });

    await expect(sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 48,
        subject: 'Outbox',
        bodyText: 'Retry',
        to: 'customer@example.com',
      },
    })).resolves.toEqual({
      ok: false,
      error: 'smtp transient',
    });
    expect(syncInfo.get('email_compose_smtp_ok:48')).toBeUndefined();
    expect(smtpSends).toHaveLength(0);

    syncInfo.set('email_compose_smtp_ok:48', 'outbox');
    await expect(sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 48,
        subject: 'Outbox',
        bodyText: 'Retry',
        to: 'customer@example.com',
      },
    })).resolves.toMatchObject({
      ok: true,
      messageId: 48,
    });
    expect(smtpSends).toHaveLength(1);
    expect(smtpAttempts).toBe(2);

    smtpSends.length = 0;
    syncInfo.set('email_compose_smtp_ok:48', 'sent');
    await expect(sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 48,
        subject: 'Outbox',
        bodyText: 'Retry',
        to: 'customer@example.com',
      },
    })).resolves.toMatchObject({
      ok: true,
      messageId: 48,
      recoveredSentAppend: true,
    });
    expect(smtpSends).toHaveLength(0);
    expect(smtpAttempts).toBe(2);

    smtpSends.length = 0;
    syncInfo.set('email_compose_smtp_ok:48', '1');
    await expect(sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 48,
        subject: 'Outbox',
        bodyText: 'Retry',
        to: 'customer@example.com',
      },
    })).resolves.toMatchObject({
      ok: true,
      messageId: 48,
      recoveredSentAppend: true,
    });
    expect(smtpSends).toHaveLength(0);
    expect(smtpAttempts).toBe(2);
  });

  test('server read receipt responder validates MDN guards and sends through SMTP port', async () => {
    const smtpSends: unknown[] = [];
    const recorded: unknown[] = [];
    const secretReads: unknown[] = [];
    const receipt = {
      ...makeEmailReadReceiptRecord(80),
      sourceSqliteId: -80,
      messageId: 11,
      messageSourceSqliteId: 110,
      direction: 'sent_back',
      recipient: 'sender@example.com',
      at: '2026-07-03T08:05:00.000Z',
    };
    let message = {
      id: 11,
      accountId: 7,
      subject: 'Hallo Kunde',
      messageIdHeader: '<inbound@example.com>',
      referencesHeader: '<prior@example.com>',
      rawHeaders: 'Disposition-Notification-To: Sender <sender@example.com>',
      fromJson: JSON.stringify({ value: [{ address: 'sender@example.com' }] }),
      isSpam: false,
      folderKind: 'inbox',
      softDeleted: false,
    };
    let account = {
      id: 7,
      displayName: 'Support',
      emailAddress: 'agent@example.com',
      imapHost: 'imap.example.com',
      imapUsername: 'agent@example.com',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpTls: true,
      smtpUsername: 'smtp-agent@example.com',
      smtpUseImapAuth: false,
      oauthProvider: null,
      respondToReadReceipts: 'ask',
      readReceiptTrustedDomains: 'example.com',
    };
    const responder = createEmailReadReceiptResponderPort({
      now: () => new Date('2026-07-03T08:05:00.000Z'),
      smtpSend: async (input) => {
        smtpSends.push(input);
      },
      store: {
        async getMessage() {
          return message;
        },
        async getAccount() {
          return account;
        },
        async readSecret(input) {
          secretReads.push(input);
          return input.kind === 'email.account.smtp_password' ? Buffer.from('smtp-secret') : null;
        },
        async recordSentBack(input) {
          recorded.push(input);
          return receipt;
        },
      },
    });

    await expect(responder.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 11,
    })).resolves.toEqual({ success: true, receipt });
    expect(secretReads).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      kind: 'email.account.smtp_password',
      name: 'email_account:7:smtp',
    }]);
    expect(smtpSends).toHaveLength(1);
    expect(smtpSends[0]).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      tls: true,
      user: 'smtp-agent@example.com',
      password: 'smtp-secret',
      envelopeFrom: 'agent@example.com',
      recipients: ['sender@example.com'],
    });
    expect((smtpSends[0] as { rfc822: string }).rfc822).toContain('Subject: Gelesen: Hallo Kunde');
    expect((smtpSends[0] as { rfc822: string }).rfc822).toContain('In-Reply-To: <inbound@example.com>');
    expect(recorded).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 11,
      recipient: 'sender@example.com',
    }]);

    message = {
      ...message,
      rawHeaders: 'Disposition-Notification-To: attacker@example.net',
    };
    await expect(responder.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 11,
    })).resolves.toEqual({
      success: false,
      error: 'MDN-Empfaenger stimmt nicht mit dem Absender ueberein (RFC 8098)',
    });

    message = {
      ...message,
      rawHeaders: 'Disposition-Notification-To: Sender <sender@example.com>',
    };
    account = {
      ...account,
      respondToReadReceipts: 'always_trusted',
      readReceiptTrustedDomains: 'trusted.example',
    };
    await expect(responder.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 11,
    })).resolves.toEqual({
      success: false,
      error: 'Absenderdomain ist nicht als vertrauenswuerdig konfiguriert',
    });
  });

  test('server read receipt responder runs outbound workflow guard before SMTP send', async () => {
    const smtpSends: unknown[] = [];
    const guardCalls: unknown[] = [];
    const secretReads: unknown[] = [];
    const recorded: unknown[] = [];
    const responder = createEmailReadReceiptResponderPort({
      now: () => new Date('2026-07-03T08:05:00.000Z'),
      smtpSend: async (input) => {
        smtpSends.push(input);
      },
      outboundReview: {
        async review(input) {
          guardCalls.push(input);
          return { allowed: false, error: 'MDN durch Workflow blockiert' };
        },
      },
      store: {
        async getMessage() {
          return {
            id: 12,
            accountId: 7,
            subject: 'Guard Hallo',
            messageIdHeader: '<guard@example.com>',
            referencesHeader: null,
            rawHeaders: 'Disposition-Notification-To: Sender <sender@example.com>',
            fromJson: JSON.stringify({ value: [{ address: 'sender@example.com' }] }),
            isSpam: false,
            folderKind: 'inbox',
            softDeleted: false,
          };
        },
        async getAccount() {
          return {
            id: 7,
            displayName: 'Support',
            emailAddress: 'agent@example.com',
            imapHost: 'imap.example.com',
            imapUsername: 'agent@example.com',
            smtpHost: 'smtp.example.com',
            smtpPort: 587,
            smtpTls: true,
            smtpUsername: 'smtp-agent@example.com',
            smtpUseImapAuth: false,
            oauthProvider: null,
            respondToReadReceipts: 'ask',
            readReceiptTrustedDomains: null,
          };
        },
        async readSecret(input) {
          secretReads.push(input);
          return Buffer.from('smtp-secret');
        },
        async recordSentBack(input) {
          recorded.push(input);
          return makeEmailReadReceiptRecord(82);
        },
      },
    });

    await expect(responder.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 12,
    })).resolves.toEqual({
      success: false,
      error: 'MDN durch Workflow blockiert',
    });
    expect(guardCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 12,
      subject: 'Gelesen: Guard Hallo',
      bodyText: [
        'Dies ist eine Lesebestaetigung fuer Ihre Nachricht.',
        'Original-Message-ID: <guard@example.com>',
        'Gelesen am: 2026-07-03T08:05:00.000Z',
      ].join('\n'),
      to: 'sender@example.com',
    }]);
    expect(secretReads).toEqual([]);
    expect(smtpSends).toEqual([]);
    expect(recorded).toEqual([]);
  });

  test('postgres read receipt outbound guard queues workflow reviews fail-closed', async () => {
    const now = new Date('2026-07-03T08:06:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [
        {
          id: 91,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 910,
          trigger_name: 'outbound',
          name: 'MDN Review A',
          enabled: true,
          priority: 20,
          definition_json: { version: 1, rules: [] },
          graph_json: null,
          execution_mode: 'graph',
        },
        {
          id: 92,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: null,
          trigger_name: 'outbound',
          name: 'MDN Review B',
          enabled: true,
          priority: 30,
          definition_json: { version: 1, rules: [] },
          graph_json: null,
          execution_mode: 'graph',
        },
        {
          id: 93,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 930,
          trigger_name: 'inbound',
          name: 'Ignored inbound',
          enabled: true,
          priority: 10,
          definition_json: { version: 1, rules: [] },
          graph_json: null,
          execution_mode: 'graph',
        },
      ],
      messages: [{
        id: 12,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 120,
        subject: 'MDN inbound',
        from_json: { value: [{ address: 'sender@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'MDN inbound',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const guard = createPostgresReadReceiptOutboundReviewPort({
      db,
      applyWorkspaceSession: async () => undefined,
      now: () => now,
    });

    await expect(guard.review({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 12,
      subject: 'Gelesen: MDN inbound',
      bodyText: 'Lesebestaetigung',
      to: 'sender@example.com',
    })).resolves.toMatchObject({
      allowed: false,
      error: 'Ausgangspruefung fuer Lesebestaetigung wird serverseitig ausgefuehrt; Versand bleibt blockiert, bis die Pruefung abgeschlossen ist.',
      workflowRunId: 1,
    });
    expect(rows.runs.map((run) => ({
      workflow_id: run.workflow_id,
      workflow_source_sqlite_id: run.workflow_source_sqlite_id,
      message_id: run.message_id,
      message_source_sqlite_id: run.message_source_sqlite_id,
      direction: run.direction,
      status: run.status,
      log_json: run.log_json,
      updated_at: run.updated_at,
    }))).toEqual([
      {
        workflow_id: 91,
        workflow_source_sqlite_id: 910,
        message_id: 12,
        message_source_sqlite_id: 120,
        direction: 'outbound',
        status: 'queued',
        log_json: ['queued:server_read_receipt_outbound_review'],
        updated_at: now,
      },
      {
        workflow_id: 92,
        workflow_source_sqlite_id: -92,
        message_id: 12,
        message_source_sqlite_id: 120,
        direction: 'outbound',
        status: 'queued',
        log_json: ['queued:server_read_receipt_outbound_review'],
        updated_at: now,
      },
    ]);
    expect(rows.jobs.map((job) => ({
      type: job.type,
      run_after: job.run_after,
      max_attempts: job.max_attempts,
      workspace_id: job.workspace_id,
      updated_at: job.updated_at,
    }))).toEqual([
      {
        type: 'workflow.execute',
        run_after: now,
        max_attempts: 5,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      },
      {
        type: 'workflow.execute',
        run_after: now,
        max_attempts: 5,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      },
    ]);
    expect(rows.jobs.map((job) => job.payload)).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        workflowId: 91,
        messageId: 12,
        runId: 1,
        triggerName: 'outbound',
        actorUserId: USER_A_ID,
        context: {
          outbound: {
            messageId: 12,
            subject: 'Gelesen: MDN inbound',
            bodyText: 'Lesebestaetigung',
            bodyHtml: null,
            to: 'sender@example.com',
            cc: '',
            bcc: '',
            inReplyToMessageId: null,
            attachmentCount: 0,
            attachmentPaths: [],
          },
          readReceipt: true,
          source: 'server_read_receipt_outbound_review',
        },
      },
      {
        workspaceId: WORKSPACE_A_ID,
        workflowId: 92,
        messageId: 12,
        runId: 2,
        triggerName: 'outbound',
        actorUserId: USER_A_ID,
        context: {
          outbound: {
            messageId: 12,
            subject: 'Gelesen: MDN inbound',
            bodyText: 'Lesebestaetigung',
            bodyHtml: null,
            to: 'sender@example.com',
            cc: '',
            bcc: '',
            inReplyToMessageId: null,
            attachmentCount: 0,
            attachmentPaths: [],
          },
          readReceipt: true,
          source: 'server_read_receipt_outbound_review',
        },
      },
    ]);
  });

  test('server read receipt responder refreshes OAuth tokens for SMTP MDN responses', async () => {
    const smtpSends: unknown[] = [];
    const secretReads: unknown[] = [];
    const secretWrites: unknown[] = [];
    const oauthRequests: Array<{ url: string; body: string }> = [];
    const receipt = {
      ...makeEmailReadReceiptRecord(81),
      sourceSqliteId: -81,
      messageId: 12,
      messageSourceSqliteId: 120,
      direction: 'sent_back',
      recipient: 'sender@example.com',
      at: '2026-07-03T08:05:00.000Z',
    };
    const responder = createEmailReadReceiptResponderPort({
      now: () => new Date('2026-07-03T08:05:00.000Z'),
      oauthFetchImpl: (async (url, init) => {
        oauthRequests.push({
          url: String(url),
          body: String(init?.body ?? ''),
        });
        return {
          ok: true,
          json: async () => ({
            access_token: 'oauth-access-token',
            refresh_token: 'oauth-refresh-token-2',
            expires_in: 3600,
          }),
        } as Response;
      }) as typeof fetch,
      smtpSend: async (input) => {
        smtpSends.push(input);
      },
      store: {
        async getMessage() {
          return {
            id: 12,
            accountId: 7,
            subject: 'OAuth Hallo',
            messageIdHeader: '<inbound-oauth@example.com>',
            referencesHeader: null,
            rawHeaders: 'Disposition-Notification-To: Sender <sender@example.com>',
            fromJson: JSON.stringify({ value: [{ address: 'sender@example.com' }] }),
            isSpam: false,
            folderKind: 'inbox',
            softDeleted: false,
          };
        },
        async getAccount() {
          return {
            id: 7,
            displayName: 'Support',
            emailAddress: 'agent@example.com',
            imapHost: 'imap.example.com',
            imapUsername: 'agent@example.com',
            smtpHost: 'smtp.office365.com',
            smtpPort: 587,
            smtpTls: true,
            smtpUsername: null,
            smtpUseImapAuth: true,
            oauthProvider: 'microsoft',
            respondToReadReceipts: 'ask',
            readReceiptTrustedDomains: null,
          };
        },
        async readSecret(input) {
          secretReads.push(input);
          return input.kind === 'email.account.oauth_refresh_token'
            ? Buffer.from('oauth-refresh-token-1')
            : null;
        },
        async writeSecret(input) {
          secretWrites.push(input);
        },
        async getSyncInfo(input) {
          return new Map(input.keys.map((key) => [
            key,
            key.endsWith('_client_id') ? 'ms-client' : 'ms-secret',
          ]));
        },
        async recordSentBack() {
          return receipt;
        },
      },
    });

    await expect(responder.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 12,
    })).resolves.toEqual({ success: true, receipt });

    expect(secretReads).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        kind: 'email.account.imap_password',
        name: 'email_account:7:imap',
      },
      {
        workspaceId: WORKSPACE_A_ID,
        kind: 'email.account.oauth_refresh_token',
        name: 'email_account:7:oauth_refresh',
      },
    ]);
    expect(oauthRequests).toHaveLength(1);
    expect(oauthRequests[0]?.url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    expect(oauthRequests[0]?.body).toContain('grant_type=refresh_token');
    expect(oauthRequests[0]?.body).toContain('client_id=ms-client');
    expect(oauthRequests[0]?.body).toContain('refresh_token=oauth-refresh-token-1');
    expect(secretWrites).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      kind: 'email.account.oauth_refresh_token',
      name: 'email_account:7:oauth_refresh',
      value: 'oauth-refresh-token-2',
    }]);
    expect(smtpSends).toHaveLength(1);
    expect(smtpSends[0]).toMatchObject({
      host: 'smtp.office365.com',
      port: 587,
      tls: true,
      user: 'agent@example.com',
      accessToken: 'oauth-access-token',
      envelopeFrom: 'agent@example.com',
      recipients: ['sender@example.com'],
    });
    expect((smtpSends[0] as { password?: string }).password).toBeUndefined();
  });

  test('server mail OAuth routes manage app settings and link refresh tokens safely', async () => {
    const syncValues = new Map<string, string | null>();
    const syncWrites: unknown[] = [];
    const authorizeCalls: unknown[] = [];
    const exchangeCalls: unknown[] = [];
    const oauthLinkCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const account = makeEmailAccountRecord(1);
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      syncInfo: {
        async getMany(input) {
          return input.keys.map((key) => ({
            key,
            value: syncValues.get(key) ?? null,
            updatedAt: '2026-06-03T10:00:00.000Z',
          }));
        },
        async getByPrefix() {
          return [];
        },
        async setMany(input) {
          syncWrites.push(input);
          for (const [key, value] of Object.entries(input.values)) {
            syncValues.set(key, value);
          }
          return Object.entries(input.values).map(([key, value]) => ({
            key,
            value,
            updatedAt: '2026-06-03T10:01:00.000Z',
          }));
        },
        async deleteMany() {
          return [];
        },
      },
      emailOAuth: {
        buildAuthorizeUrl(input) {
          authorizeCalls.push(input);
          return `https://oauth.example.com/${input.provider}?redirect=${encodeURIComponent(input.redirectUri)}`;
        },
        async exchangeAuthCode(input) {
          exchangeCalls.push(input);
          return { accessToken: 'access-token', refreshToken: 'refresh-secret' };
        },
      },
      emailAccounts: {
        async list() {
          return { items: [] };
        },
        async get() {
          return account;
        },
        async setOAuthRefreshToken(input) {
          oauthLinkCalls.push(input);
          return {
            ok: true,
            account: {
              ...account,
              oauthProvider: input.provider,
              oauthRefreshConfigured: true,
            },
          };
        },
      },
    }));
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const empty = await api.handle({
      method: 'GET',
      path: '/api/v1/email/oauth/google/app',
      principal,
    });
    expect(empty.status).toBe(200);
    expect((empty.body as any).data).toEqual({ success: true, clientId: '', clientSecret: '' });

    const saved = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/oauth/google/app',
      body: { clientId: ' google-client ', clientSecret: ' google-secret ' },
      principal,
    });
    expect(saved.status).toBe(200);
    expect((saved.body as any).data).toEqual({ success: true });
    expect(syncWrites[0]).toEqual({
      workspaceId: WORKSPACE_A_ID,
      values: {
        email_google_oauth_client_id: 'google-client',
        email_google_oauth_client_secret: 'google-secret',
      },
    });
    expect(JSON.stringify(auditEvents)).not.toContain('google-secret');

    const url = await api.handle({
      method: 'POST',
      path: '/api/v1/email/oauth/google/authorize-url',
      body: { redirectUri: 'http://127.0.0.1:1' },
      principal,
    });
    expect(url.status).toBe(200);
    expect((url.body as any).data).toEqual({
      success: true,
      url: 'https://oauth.example.com/google?redirect=http%3A%2F%2F127.0.0.1%3A1',
    });
    expect(authorizeCalls).toEqual([{
      provider: 'google',
      clientId: 'google-client',
      clientSecret: 'google-secret',
      redirectUri: 'http://127.0.0.1:1',
    }]);

    const finished = await api.handle({
      method: 'POST',
      path: '/api/v1/email/oauth/google/finish',
      body: { accountId: 1, redirectUri: 'http://127.0.0.1:1', code: 'code-1' },
      principal,
    });
    expect(finished.status).toBe(200);
    expect((finished.body as any).data).toMatchObject({ success: true, account: { oauthProvider: 'google' } });
    expect(exchangeCalls).toEqual([{
      provider: 'google',
      clientId: 'google-client',
      clientSecret: 'google-secret',
      redirectUri: 'http://127.0.0.1:1',
      code: 'code-1',
    }]);
    expect(oauthLinkCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'user-a',
      id: 1,
      provider: 'google',
      refreshToken: 'refresh-secret',
    }]);
    expect(auditEvents[1]).toMatchObject({
      action: 'email_account.updated',
      entityType: 'email_account',
      entityId: '1',
      metadata: {
        fields: ['oauthProvider', 'oauthRefreshToken'],
        oauthProvider: 'google',
        oauthRefreshTokenChanged: true,
      },
    });
    expect(events[0]).toMatchObject({
      type: 'email_account.updated',
      entityType: 'email_account',
      entityId: '1',
      payload: {
        fields: ['oauthProvider', 'oauthRefreshToken'],
        oauthProvider: 'google',
        oauthRefreshTokenChanged: true,
      },
    });
    expect(JSON.stringify(auditEvents)).not.toContain('code-1');
    expect(JSON.stringify(auditEvents)).not.toContain('refresh-secret');
    expect(JSON.stringify(events)).not.toContain('refresh-secret');
  });

  test('server mail remote-content routes consume and set policy safely', async () => {
    const consumeCalls: unknown[] = [];
    const setCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const message = makeEmailMessageRecord(11, true);
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async consumeRemoteContentPolicy(input) {
          consumeCalls.push(input);
          return input.messageId === 11 ? { policy: 'allowed_once', allowRemote: true } : null;
        },
        async setRemoteContentPolicy(input) {
          setCalls.push(input);
          if (input.messageId !== 11) return { ok: false, reason: 'not_found' };
          return {
            ok: true,
            result: { policy: input.values.policy, allowRemote: input.values.policy !== 'blocked' },
            message: {
              ...message,
              remoteContentPolicy: input.values.policy,
            },
          };
        },
      },
    }));
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const consumed = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/remote-content-policy/consume',
      principal,
    });
    expect(consumed.status).toBe(200);
    expect((consumed.body as any).data).toEqual({ policy: 'allowed_once', allowRemote: true });
    expect(consumeCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, messageId: 11 }]);

    const missingConsumed = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/12/remote-content-policy/consume',
      principal,
    });
    expect(missingConsumed.status).toBe(200);
    expect((missingConsumed.body as any).data).toEqual({ policy: 'blocked', allowRemote: false });

    const invalid = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/remote-content-policy',
      body: { policy: 'always', rememberSender: true },
      principal,
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.code).toBe('validation_error');

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/remote-content-policy',
      body: { policy: 'allowed_sender', rememberSender: true },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data).toEqual({ success: true, policy: 'allowed_sender', allowRemote: true });
    expect(setCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'user-a',
      messageId: 11,
      values: { policy: 'allowed_sender', rememberSender: true },
    }]);
    expect(auditEvents[0]).toMatchObject({
      action: 'email_message.remote_content_policy_updated',
      entityType: 'email_message',
      entityId: '11',
      metadata: {
        policy: 'allowed_sender',
        rememberSender: true,
        rememberDomain: false,
      },
    });
    expect(events[0]).toMatchObject({
      type: 'email_message.updated',
      entityType: 'email_message',
      entityId: '11',
      payload: {
        action: 'remote_content_policy_updated',
        remoteContentPolicy: 'allowed_sender',
        rememberSender: true,
        rememberDomain: false,
      },
    });
    expect(JSON.stringify(auditEvents)).not.toContain('Body text');
    expect(JSON.stringify(events)).not.toContain('Body text');
  });

  test('server mail read routes validate auth, IDs, filters, and missing ports', async () => {
    const api = createServerApi(makeServerApiPorts());
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unauthorized = await api.handle({ method: 'GET', path: '/api/v1/email/accounts' });
    expect(unauthorized.status).toBe(401);

    const invalidAccountId = await api.handle({
      method: 'GET',
      path: '/api/v1/email/accounts/nope',
      principal,
    });
    expect(invalidAccountId.status).toBe(400);
    expect((invalidAccountId.body as any).error.code).toBe('invalid_email_account_id');

    const invalidMessageId = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/0',
      principal,
    });
    expect(invalidMessageId.status).toBe(400);
    expect((invalidMessageId.body as any).error.code).toBe('invalid_email_message_id');

    const invalidAttachmentId = await api.handle({
      method: 'GET',
      path: '/api/v1/email/attachments/nope',
      principal,
    });
    expect(invalidAttachmentId.status).toBe(400);
    expect((invalidAttachmentId.body as any).error.code).toBe('invalid_email_attachment_id');

    const invalidAttachmentContentId = await api.handle({
      method: 'GET',
      path: '/api/v1/email/attachments/nope/content',
      principal,
    });
    expect(invalidAttachmentContentId.status).toBe(400);
    expect((invalidAttachmentContentId.body as any).error.code).toBe('invalid_email_attachment_id');

    const invalidSeen = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages',
      query: { seen: 'yes' },
      principal,
    });
    expect(invalidSeen.status).toBe(400);
    expect((invalidSeen.body as any).error.code).toBe('invalid_seen');

    const invalidAccountFilter = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages',
      query: { accountId: '-1' },
      principal,
    });
    expect(invalidAccountFilter.status).toBe(400);
    expect((invalidAccountFilter.body as any).error.code).toBe('invalid_account_id');

    const invalidCategoryCountsAccountFilter = await api.handle({
      method: 'GET',
      path: '/api/v1/email/category-counts',
      query: { accountId: '-1' },
      principal,
    });
    expect(invalidCategoryCountsAccountFilter.status).toBe(400);
    expect((invalidCategoryCountsAccountFilter.body as any).error.code).toBe('invalid_account_id');

    const invalidFolderCountsAccountFilter = await api.handle({
      method: 'GET',
      path: '/api/v1/email/folder-counts',
      query: { accountId: '-1' },
      principal,
    });
    expect(invalidFolderCountsAccountFilter.status).toBe(400);
    expect((invalidFolderCountsAccountFilter.body as any).error.code).toBe('invalid_account_id');

    const invalidIncludeBody = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11',
      query: { includeBody: 'yes' },
      principal,
    });
    expect(invalidIncludeBody.status).toBe(400);
    expect((invalidIncludeBody.body as any).error.code).toBe('invalid_include_body');

    const unavailableAccounts = await api.handle({
      method: 'GET',
      path: '/api/v1/email/accounts',
      principal,
    });
    expect(unavailableAccounts.status).toBe(503);
    expect((unavailableAccounts.body as any).error.code).toBe('email_accounts_unavailable');

    const unavailableAccountCreate = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts',
      body: {
        displayName: 'Mailbox',
        emailAddress: 'mailbox@example.com',
        imapHost: 'imap.example.com',
        imapUsername: 'mailbox@example.com',
        imapPassword: 'secret',
      },
      principal,
    });
    expect(unavailableAccountCreate.status).toBe(503);
    expect((unavailableAccountCreate.body as any).error.code).toBe('email_accounts_unavailable');

    const unavailableMessages = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages',
      principal,
    });
    expect(unavailableMessages.status).toBe(503);
    expect((unavailableMessages.body as any).error.code).toBe('email_messages_unavailable');

    const unavailableFolderCounts = await api.handle({
      method: 'GET',
      path: '/api/v1/email/folder-counts',
      principal,
    });
    expect(unavailableFolderCounts.status).toBe(503);
    expect((unavailableFolderCounts.body as any).error.code).toBe('email_messages_unavailable');

    const unavailableReadReceiptState = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/read-receipt-state',
      principal,
    });
    expect(unavailableReadReceiptState.status).toBe(503);
    expect((unavailableReadReceiptState.body as any).error.code).toBe('email_messages_unavailable');

    const unavailableComposeRecoveryState = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/compose-draft-recovery-state',
      principal,
    });
    expect(unavailableComposeRecoveryState.status).toBe(503);
    expect((unavailableComposeRecoveryState.body as any).error.code).toBe('email_messages_unavailable');

    const unavailableAttachments = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/attachments',
      principal,
    });
    expect(unavailableAttachments.status).toBe(503);
    expect((unavailableAttachments.body as any).error.code).toBe('email_attachments_unavailable');

    const unavailableAttachmentContent = await api.handle({
      method: 'GET',
      path: '/api/v1/email/attachments/31/content',
      principal,
    });
    expect(unavailableAttachmentContent.status).toBe(503);
    expect((unavailableAttachmentContent.body as any).error.code).toBe('email_attachment_content_unavailable');
  });

  test('server mail single status mutation routes validate and call safe ports', async () => {
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async softDelete(input) {
          calls.push(['softDelete', input]);
          return { count: 1 };
        },
        async restore(input) {
          calls.push(['restore', input]);
          return { count: 1 };
        },
        async deleteLocalDraft(input) {
          calls.push(['deleteLocalDraft', input]);
          return input.messageId === 99
            ? { ok: false as const, reason: 'not_local_draft' as const }
            : { ok: true as const, count: 1 };
        },
        async setArchived(input) {
          calls.push(['setArchived', input]);
          return { count: 1 };
        },
        async setSeen(input) {
          calls.push(['setSeen', input]);
          return { count: 1 };
        },
        async setDone(input) {
          calls.push(['setDone', input]);
          return { count: 1 };
        },
        async moveToView(input) {
          calls.push(['moveToView', input]);
          return { count: 1 };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const softDelete = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/soft-delete',
      principal,
    });
    expect(softDelete.status).toBe(200);
    expect((softDelete.body as any).data.count).toBe(1);

    const restore = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/restore',
      principal,
    });
    expect(restore.status).toBe(200);
    expect((restore.body as any).data.count).toBe(1);

    const deleteDraft = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/messages/11/local-draft',
      principal,
    });
    expect(deleteDraft.status).toBe(200);
    expect((deleteDraft.body as any).data.count).toBe(1);

    const archive = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/archive',
      body: { archived: true },
      principal,
    });
    expect(archive.status).toBe(200);

    const seen = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/seen',
      body: { seen: false, syncToServer: false },
      principal,
    });
    expect(seen.status).toBe(200);

    const done = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/done',
      body: { done: true },
      principal,
    });
    expect(done.status).toBe(200);

    const move = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/move',
      body: { view: 'archived' },
      principal,
    });
    expect(move.status).toBe(200);

    const moveSpamReview = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/move',
      body: { view: 'spam_review' },
      principal,
    });
    expect(moveSpamReview.status).toBe(200);

    const moveSpam = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/move',
      body: { view: 'spam' },
      principal,
    });
    expect(moveSpam.status).toBe(200);

    const unsupportedMove = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/move',
      body: { view: 'sent' },
      principal,
    });
    expect(unsupportedMove.status).toBe(409);
    expect((unsupportedMove.body as any).error.code).toBe('email_message_move_view_unsupported');

    const nonLocalDraft = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/messages/99/local-draft',
      principal,
    });
    expect(nonLocalDraft.status).toBe(409);
    expect((nonLocalDraft.body as any).error.code).toBe('email_message_not_local_draft');

    const invalidSeen = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/seen',
      body: { seen: 'yes' },
      principal,
    });
    expect(invalidSeen.status).toBe(400);
    expect((invalidSeen.body as any).error.code).toBe('validation_error');

    expect(calls).toEqual([
      ['softDelete', { workspaceId: WORKSPACE_A_ID, messageId: 11 }],
      ['restore', { workspaceId: WORKSPACE_A_ID, messageId: 11 }],
      ['deleteLocalDraft', { workspaceId: WORKSPACE_A_ID, messageId: 11 }],
      ['setArchived', { workspaceId: WORKSPACE_A_ID, messageId: 11, archived: true }],
      ['setSeen', { workspaceId: WORKSPACE_A_ID, messageId: 11, seen: false, syncToServer: false }],
      ['setDone', { workspaceId: WORKSPACE_A_ID, messageId: 11, done: true }],
      ['moveToView', { workspaceId: WORKSPACE_A_ID, messageId: 11, view: 'archived' }],
      ['moveToView', { workspaceId: WORKSPACE_A_ID, messageId: 11, view: 'spam_review' }],
      ['moveToView', { workspaceId: WORKSPACE_A_ID, messageId: 11, view: 'spam' }],
      ['deleteLocalDraft', { workspaceId: WORKSPACE_A_ID, messageId: 99 }],
    ]);
  });

  test('server inbox archive recovery routes validate preview and restore guards', async () => {
    const calls: unknown[] = [];
    let previewCount = 3;
    const api = createServerApi(makeServerApiPorts({
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async previewInboxArchiveRecovery(input) {
          calls.push(['preview', input]);
          if (input.accountId === 99) return null;
          return {
            accountId: input.accountId,
            count: previewCount,
            accountEmail: 'support@example.com',
            accountLabel: 'Support',
          };
        },
        async restoreInboxFromArchive(input) {
          calls.push(['restoreInboxFromArchive', input]);
          if (input.confirmPhrase.toLowerCase() !== 'support@example.com') {
            return { ok: false as const, error: 'Bestaetigung fehlgeschlagen: E-Mail-Adresse des Kontos exakt eingeben.' };
          }
          if (input.expectedCount !== previewCount) {
            return { ok: false as const, error: 'Die Anzahl betroffener Nachrichten hat sich geaendert. Bitte Vorschau erneut ausfuehren.' };
          }
          return { ok: true as const, restored: previewCount };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const preview = await api.handle({
      method: 'GET',
      path: '/api/v1/email/accounts/7/inbox-archive-recovery',
      principal,
    });
    expect(preview.status).toBe(200);
    expect((preview.body as any).data).toMatchObject({
      success: true,
      accountId: 7,
      count: 3,
      accountEmail: 'support@example.com',
      accountLabel: 'Support',
    });

    const restored = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/7/inbox-archive-recovery',
      body: { expectedCount: 3, confirmPhrase: 'support@example.com' },
      principal,
    });
    expect(restored.status).toBe(200);
    expect((restored.body as any).data).toEqual({ success: true, restored: 3 });

    previewCount = 4;
    const changed = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/7/inbox-archive-recovery',
      body: { expectedCount: 3, confirmPhrase: 'support@example.com' },
      principal,
    });
    expect(changed.status).toBe(409);
    expect((changed.body as any).error.code).toBe('email_inbox_archive_recovery_failed');

    const missing = await api.handle({
      method: 'GET',
      path: '/api/v1/email/accounts/99/inbox-archive-recovery',
      principal,
    });
    expect(missing.status).toBe(404);
    expect((missing.body as any).error.code).toBe('email_account_not_found');

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/7/inbox-archive-recovery',
      body: { expectedCount: -1, confirmPhrase: '' },
      principal,
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.code).toBe('validation_error');

    expect(calls).toEqual([
      ['preview', { workspaceId: WORKSPACE_A_ID, accountId: 7 }],
      ['restoreInboxFromArchive', {
        workspaceId: WORKSPACE_A_ID,
        accountId: 7,
        expectedCount: 3,
        confirmPhrase: 'support@example.com',
      }],
      ['restoreInboxFromArchive', {
        workspaceId: WORKSPACE_A_ID,
        accountId: 7,
        expectedCount: 3,
        confirmPhrase: 'support@example.com',
      }],
      ['preview', { workspaceId: WORKSPACE_A_ID, accountId: 99 }],
    ]);
  });

  test('server mail message metadata mutation routes validate and call safe ports', async () => {
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      emailMessages: {
        async linkCustomer(input) {
          calls.push(['linkCustomer', input]);
          if (input.customerId === 77) return { ok: false as const, reason: 'customer_not_found' as const };
          return {
            ok: true as const,
            message: {
              ...makeEmailMessageRecord(input.messageId, false),
              customerId: input.customerId,
            },
          };
        },
        async assign(input) {
          calls.push(['assign', input]);
          if (input.teamMemberId === 'missing') return { ok: false as const, reason: 'team_member_not_found' as const };
          return {
            ok: true as const,
            message: {
              ...makeEmailMessageRecord(input.messageId, false),
              assignedTo: input.teamMemberId,
            },
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const linked = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/customer-link',
      body: { customerId: '7' },
      principal,
    });
    expect(linked.status).toBe(200);
    expect((linked.body as any).data.customerId).toBe(7);

    const assigned = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/assignment',
      body: { teamMemberId: ' agent-1 ' },
      principal,
    });
    expect(assigned.status).toBe(200);
    expect((assigned.body as any).data.assignedTo).toBe('agent-1');

    const unlinked = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/customer-link',
      body: { customerId: null },
      principal,
    });
    expect(unlinked.status).toBe(200);
    expect((unlinked.body as any).data.customerId).toBeNull();

    const customerMissing = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/customer-link',
      body: { customerId: 77 },
      principal,
    });
    expect(customerMissing.status).toBe(409);
    expect((customerMissing.body as any).error.code).toBe('customer_not_found');

    const teamMissing = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/assignment',
      body: { teamMemberId: 'missing' },
      principal,
    });
    expect(teamMissing.status).toBe(409);
    expect((teamMissing.body as any).error.code).toBe('email_team_member_not_found');

    const invalidCustomer = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/customer-link',
      body: { customerId: 0 },
      principal,
    });
    expect(invalidCustomer.status).toBe(400);

    const invalidAssignment = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/assignment',
      body: { teamMemberId: '' },
      principal,
    });
    expect(invalidAssignment.status).toBe(400);

    expect(calls).toEqual([
      ['linkCustomer', { workspaceId: WORKSPACE_A_ID, messageId: 11, customerId: 7 }],
      ['assign', { workspaceId: WORKSPACE_A_ID, messageId: 11, teamMemberId: 'agent-1' }],
      ['linkCustomer', { workspaceId: WORKSPACE_A_ID, messageId: 11, customerId: null }],
      ['linkCustomer', { workspaceId: WORKSPACE_A_ID, messageId: 11, customerId: 77 }],
      ['assign', { workspaceId: WORKSPACE_A_ID, messageId: 11, teamMemberId: 'missing' }],
    ]);
  });

  test('server mail message action route delegates documented automation actions', async () => {
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      emailMessages: {
        async setArchived(input) {
          calls.push(['setArchived', input]);
          return { count: 1 };
        },
        async setSeen(input) {
          calls.push(['setSeen', input]);
          return { count: 1 };
        },
        async setSpamStatus(input) {
          calls.push(['setSpamStatus', input]);
          return {
            ...makeEmailMessageRecord(input.messageId, false),
            spamStatus: input.values.status,
            isSpam: input.values.status === 'spam',
          };
        },
        async linkCustomer(input) {
          calls.push(['linkCustomer', input]);
          return {
            ok: true as const,
            message: {
              ...makeEmailMessageRecord(input.messageId, false),
              customerId: input.customerId,
            },
          };
        },
        async assign(input) {
          calls.push(['assign', input]);
          return {
            ok: true as const,
            message: {
              ...makeEmailMessageRecord(input.messageId, false),
              assignedTo: input.teamMemberId,
            },
          };
        },
      },
      emailMessageTags: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          calls.push(['createTag', input]);
          return {
            ok: true as const,
            tag: {
              ...makeEmailMessageTagRecord(70),
              messageId: input.values.messageId ?? null,
              tag: input.values.tag ?? '',
            },
          };
        },
        async delete() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    for (const body of [
      { action: 'archive' },
      { action: 'mark_unseen', payload: { syncToServer: false } },
      { action: 'spam', payload: { train: true } },
      { action: 'link_customer', customerId: 7 },
      { action: 'assign', payload: { teamMemberId: 'agent-1' } },
      { action: 'add_tag', payload: { tag: 'vip' } },
    ]) {
      const response = await api.handle({
        method: 'POST',
        path: '/api/v1/email/messages/11/actions',
        body,
        principal,
      });
      expect(response.status).toBe(200);
      expect((response.body as any).data).toEqual({ success: true });
    }

    const unknown = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/actions',
      body: { action: 'unknown' },
      principal,
    });
    expect(unknown.status).toBe(400);
    expect((unknown.body as any).error.code).toBe('action_failed');

    expect(calls).toEqual([
      ['setArchived', { workspaceId: WORKSPACE_A_ID, messageId: 11, archived: true }],
      ['setSeen', { workspaceId: WORKSPACE_A_ID, messageId: 11, seen: false, syncToServer: false }],
      ['setSpamStatus', {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        messageId: 11,
        values: { status: 'spam', train: true, source: 'api' },
      }],
      ['linkCustomer', { workspaceId: WORKSPACE_A_ID, messageId: 11, customerId: 7 }],
      ['assign', { workspaceId: WORKSPACE_A_ID, messageId: 11, teamMemberId: 'agent-1' }],
      ['createTag', {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        values: { messageId: 11, tag: 'vip' },
      }],
    ]);
  });

  test('server mail customer-link backfill route validates payload and uses principal workspace', async () => {
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      emailMessages: {
        async backfillCustomerLinks(input) {
          calls.push(input);
          return { count: 3 };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const backfilled = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/backfill-customer-links',
      body: { accountId: '7', limit: '7000' },
      principal,
    });
    expect(backfilled.status).toBe(200);
    expect((backfilled.body as any).data).toEqual({ success: true, count: 3 });

    const defaultBackfill = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/backfill-customer-links',
      principal,
    });
    expect(defaultBackfill.status).toBe(200);

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/backfill-customer-links',
      body: { limit: 0, extra: true },
      principal,
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.code).toBe('validation_error');

    const unavailable = await createServerApi(makeServerApiPorts({
      emailMessages: {},
    })).handle({
      method: 'POST',
      path: '/api/v1/email/messages/backfill-customer-links',
      body: { limit: 500 },
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('email_messages_unavailable');

    expect(calls).toEqual([
      { workspaceId: WORKSPACE_A_ID, accountId: 7, limit: 7000 },
      { workspaceId: WORKSPACE_A_ID },
    ]);
  });

  test('server mail spam-status mutation route writes audit records and server events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const spamStatusCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async setSpamStatus(input) {
          spamStatusCalls.push(input);
          return input.messageId === 11
            ? {
              ...makeEmailMessageRecord(11, true),
              isSpam: input.values.status === 'spam',
              spamStatus: input.values.status ?? 'clean',
            }
            : null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/spam-status',
      body: {
        status: ' spam ',
        train: true,
        source: ' manual ',
        featureKeys: [' sender:domain:example.com ', 'sender:domain:example.com'],
      },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data.spamStatus).toBe('spam');
    expect((updated.body as any).data.isSpam).toBe(true);
    expect((updated.body as any).data.bodyText).toBeUndefined();

    const defaulted = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/spam-status',
      body: { status: 'clean' },
      principal,
    });
    expect(defaulted.status).toBe(200);

    expect(spamStatusCalls).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        messageId: 11,
        values: {
          status: 'spam',
          train: true,
          source: 'manual',
          featureKeys: ['sender:domain:example.com'],
        },
      },
      {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        messageId: 11,
        values: {
          status: 'clean',
          train: true,
          source: 'manual',
        },
      },
    ]);
    expect(auditEvents.map((event) => event.action)).toEqual([
      'email_message.spam_status_updated',
      'email_message.spam_status_updated',
    ]);
    expect(events.map((event) => [event.type, event.workspaceId, event.entityType, event.entityId])).toEqual([
      ['email_message.updated', WORKSPACE_A_ID, 'email_message', '11'],
      ['email_message.updated', WORKSPACE_A_ID, 'email_message', '11'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 11,
      sourceSqliteId: 11,
      accountId: 1,
      spamStatus: 'spam',
      isSpam: true,
      train: true,
      source: 'manual',
      featureKeyCount: 1,
    });
    expect(events[0].payload.featureKeys).toBeUndefined();
    expect((auditEvents[0].metadata as any).featureKeys).toBeUndefined();
  });

  test('server mail spam-status mutation route rejects unsafe payloads and missing ports', async () => {
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
        async setSpamStatus() {
          return null;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const unavailable = await readOnlyApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/spam-status',
      body: { status: 'spam' },
      principal,
    });
    expect(unavailable.status).toBe(503);

    const invalidId = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/0/spam-status',
      body: { status: 'spam' },
      principal,
    });
    expect(invalidId.status).toBe(400);

    const invalidPayload = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/spam-status',
      body: [],
      principal,
    });
    expect(invalidPayload.status).toBe(400);
    expect((invalidPayload.body as any).error.code).toBe('invalid_email_message_spam_status_payload');

    const unsafePayload = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/spam-status',
      body: {
        workspaceId: WORKSPACE_B_ID,
        status: 'maybe',
        train: 'yes',
        source: ' ',
        featureKeys: [''],
      },
      principal,
    });
    expect(unsafePayload.status).toBe(400);
    expect((unsafePayload.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'status', message: 'status muss clean, review oder spam sein' },
      { field: 'train', message: 'train muss true oder false sein' },
      { field: 'source', message: 'source darf nicht leer sein' },
      { field: 'featureKeys', message: 'featureKeys darf keine leeren Eintraege enthalten' },
    ]));

    const missingStatus = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/spam-status',
      body: { train: true },
      principal,
    });
    expect(missingStatus.status).toBe(400);

    const missingMessage = await writableApi.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/spam-status',
      body: { status: 'spam' },
      principal,
    });
    expect(missingMessage.status).toBe(404);
    expect((missingMessage.body as any).error.code).toBe('email_message_not_found');
  });

  test('rspamd learning helper posts stored RFC822 messages to learn endpoints', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl: typeof fetch = async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return makeFetchResponse({ json: {} });
    };

    const spam = await learnMessageWithRspamd({
      rawHeaders: [
        'From: Sender <sender@example.com>',
        'To: Mailbox <mail1@example.com>',
        'Subject: Learn Spam',
      ].join('\r\n'),
      rawRfc822B64: null,
      bodyText: 'Buy now',
      bodyHtml: null,
      label: 'spam',
      rspamdUrl: 'http://rspamd.local/',
      rspamdTimeoutMs: 1000,
      fetchImpl,
    });
    const ham = await learnMessageWithRspamd({
      rawHeaders: 'From: Sender <sender@example.com>\r\nSubject: Learn Ham',
      rawRfc822B64: null,
      bodyText: 'Thanks for the update',
      bodyHtml: null,
      label: 'ham',
      rspamdUrl: 'http://rspamd.local',
      rspamdTimeoutMs: 1000,
      fetchImpl,
    });

    expect(spam).toEqual({ success: true, label: 'spam' });
    expect(ham).toEqual({ success: true, label: 'ham' });
    expect(calls.map((call) => call.url)).toEqual([
      'http://rspamd.local/learnspam',
      'http://rspamd.local/learnham',
    ]);
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ 'Content-Type': 'message/rfc822' });
    expect(Buffer.from(calls[0].init.body as Uint8Array).toString('utf8')).toContain('Subject: Learn Spam');

    const missingMessage = await learnMessageWithRspamd({
      rawHeaders: null,
      rawRfc822B64: null,
      bodyText: null,
      bodyHtml: null,
      label: 'spam',
      rspamdUrl: 'http://rspamd.local',
      rspamdTimeoutMs: 1000,
      fetchImpl,
    });
    expect(missingMessage).toEqual({
      success: false,
      label: 'spam',
      error: 'Keine Nachricht zum Lernen',
    });

    const failed = await learnMessageWithRspamd({
      rawHeaders: 'From: Sender <sender@example.com>',
      rawRfc822B64: null,
      bodyText: 'Blocked',
      bodyHtml: null,
      label: 'spam',
      rspamdUrl: 'http://rspamd.local',
      rspamdTimeoutMs: 1000,
      fetchImpl: async () => makeFetchResponse({ status: 403, text: 'denied' }),
    });
    expect(failed).toEqual({
      success: false,
      label: 'spam',
      error: 'Rspamd HTTP 403: denied',
    });
  });

  test('postgres mail spam-status mutation learns spam through rspamd best-effort', async () => {
    const { db, rows } = makeWorkflowExecutionDb({
      messages: [makePostgresEmailMessageRow({ id: 11, spam_status: 'clean', is_spam: false })],
      syncInfo: [
        { workspace_id: WORKSPACE_A_ID, key: 'mail_security_rspamd_enabled', value: '1' },
        { workspace_id: WORKSPACE_A_ID, key: 'mail_security_spam_rspamd_learning_enabled', value: '1' },
        { workspace_id: WORKSPACE_A_ID, key: 'mail_security_spam_local_learning_enabled', value: '0' },
        { workspace_id: WORKSPACE_A_ID, key: 'mail_security_rspamd_url', value: 'http://rspamd.local/' },
        { workspace_id: WORKSPACE_A_ID, key: 'mail_security_rspamd_timeout_ms', value: '1500' },
      ],
    });
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    const port = createPostgresEmailMessageReadPort({
      db,
      applyWorkspaceSession: async () => undefined,
      rspamdFetch: async (url, init) => {
        fetchCalls.push({ url: String(url), init: init ?? {} });
        return makeFetchResponse({ json: {} });
      },
    });

    const message = await port.setSpamStatus({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 11,
      values: { status: 'spam', source: 'manual' },
    });

    expect(message?.spamStatus).toBe('spam');
    expect(rows.messages[0].spam_status).toBe('spam');
    expect(rows.messages[0].is_spam).toBe(true);
    expect(rows.spamLearningEvents).toHaveLength(0);
    expect(fetchCalls.map((call) => call.url)).toEqual(['http://rspamd.local/learnspam']);
    expect(fetchCalls[0].init.method).toBe('POST');
    expect(Buffer.from(fetchCalls[0].init.body as Uint8Array).toString('utf8')).toContain('Message 11');
  });

  test('postgres mail bulk spam-status mutation learns ham through rspamd best-effort', async () => {
    const { db, rows } = makeWorkflowExecutionDb({
      messages: [makePostgresEmailMessageRow({
        id: 12,
        spam_status: 'spam',
        is_spam: true,
        folder_kind: 'spam',
      })],
      syncInfo: [
        { workspace_id: WORKSPACE_A_ID, key: 'mail_security_rspamd_enabled', value: '1' },
        { workspace_id: WORKSPACE_A_ID, key: 'mail_security_spam_rspamd_learning_enabled', value: '1' },
        { workspace_id: WORKSPACE_A_ID, key: 'mail_security_spam_local_learning_enabled', value: '0' },
        { workspace_id: WORKSPACE_A_ID, key: 'mail_security_rspamd_url', value: 'http://rspamd.local' },
      ],
    });
    const fetchCalls: Array<{ url: string; init: RequestInit }> = [];
    const port = createPostgresEmailMessageReadPort({
      db,
      applyWorkspaceSession: async () => undefined,
      rspamdFetch: async (url, init) => {
        fetchCalls.push({ url: String(url), init: init ?? {} });
        return makeFetchResponse({ json: {} });
      },
    });

    const result = await port.bulkSetSpamStatus({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageIds: [12],
      values: { status: 'clean', source: 'bulk-manual' },
    });

    expect(result).toEqual({ count: 1 });
    expect(rows.messages[0].spam_status).toBe('clean');
    expect(rows.messages[0].is_spam).toBe(false);
    expect(rows.spamLearningEvents).toHaveLength(0);
    expect(fetchCalls.map((call) => call.url)).toEqual(['http://rspamd.local/learnham']);
  });

  test('server mail spam-decision route evaluates, audits, and publishes sanitized events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async evaluateSpamDecision(input) {
          calls.push(input);
          return {
            message: {
              ...makeEmailMessageRecord(input.messageId, true),
              isSpam: input.values.applyStatus === true,
              spamStatus: input.values.applyStatus === true ? 'spam' : 'unknown',
            },
            decision: {
              ...makeSpamDecisionRecord(77),
              messageId: input.messageId,
              score: 88,
              status: 'spam',
              source: 'local+learning',
              breakdown: {
                reasons: [{ code: 'content.suspicious_terms', label: 'Suspicious terms', points: 12 }],
                featureKeys: ['sender:domain:example.com'],
              },
            },
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/spam-decision',
      body: { applyStatus: true },
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data.message.bodyText).toBeUndefined();
    expect((response.body as any).data.message.spamStatus).toBe('spam');
    expect((response.body as any).data.decision).toMatchObject({
      id: 77,
      score: 88,
      status: 'spam',
      source: 'local+learning',
    });
    expect(calls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 11,
      values: { applyStatus: true },
    }]);
    expect(auditEvents.map((event) => event.action)).toEqual(['email_message.spam_decision_evaluated']);
    expect(events.map((event) => [event.type, event.entityType, event.entityId])).toEqual([
      ['spam_decision.created', 'spam_decision', '77'],
      ['email_message.updated', 'email_message', '11'],
    ]);
    expect(events[0].payload).toMatchObject({
      id: 77,
      messageId: 11,
      score: 88,
      status: 'spam',
      source: 'local+learning',
      hasBreakdown: true,
      reasonCount: 1,
      featureKeyCount: 1,
    });
    expect(JSON.stringify(auditEvents)).not.toContain('sender:domain:example.com');
    expect(JSON.stringify(events)).not.toContain('sender:domain:example.com');
  });

  test('server mail security-check route runs security pipeline, audits, and publishes sanitized events', async () => {
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async runSecurityCheck(input) {
          calls.push(input);
          return {
            message: {
              ...makeEmailMessageRecord(input.messageId, true),
              isSpam: input.values.applyStatus === true,
              spamStatus: input.values.applyStatus === true ? 'review' : 'clean',
            },
            security: {
              authSpf: 'pass',
              authDkim: 'pass',
              authDmarc: 'pass',
              authArc: 'none',
              authDkimDomains: 'example.com',
              authError: null,
              rspamdScore: 2.5,
              rspamdAction: 'no action',
              rspamdSymbols: 'BAYES_HAM',
              rspamdError: null,
              securityCheckedAt: '2026-06-05T12:00:00.000Z',
              spamStatus: 'review',
              spamScore: 61,
              spamScoreLabel: 'review',
              spamDecisionSource: 'server-spam-engine',
              spamScoreBreakdownJson: { featureKeys: ['sender:domain:example.com'] },
              spamDecidedAt: '2026-06-05T12:00:00.000Z',
            },
            decision: {
              ...makeSpamDecisionRecord(78),
              messageId: input.messageId,
              score: 61,
              status: 'review',
              source: 'server-spam-engine',
              breakdown: {
                reasons: [{ code: 'rspamd.score', label: 'Rspamd score', points: 2.5 }],
                featureKeys: ['sender:domain:example.com'],
              },
            },
            authChecked: true,
            rspamdChecked: true,
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/security/check',
      body: { applyStatus: true },
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data).toMatchObject({
      authChecked: true,
      rspamdChecked: true,
      security: {
        authSpf: 'pass',
        rspamdScore: 2.5,
        spamScore: 61,
      },
      decision: {
        id: 78,
        score: 61,
        status: 'review',
      },
    });
    expect((response.body as any).data.message.bodyText).toBeUndefined();
    expect(calls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      messageId: 11,
      values: { applyStatus: true },
    }]);
    expect(auditEvents.map((event) => event.action)).toEqual([
      'email_message.security_checked',
      'email_message.spam_decision_evaluated',
    ]);
    expect(events.map((event) => [event.type, event.entityType, event.entityId])).toEqual([
      ['spam_decision.created', 'spam_decision', '78'],
      ['email_message.updated', 'email_message', '11'],
    ]);
    expect(events[1].payload).toMatchObject({
      securityChecked: true,
      authChecked: true,
      rspamdChecked: true,
      spamDecisionId: 78,
      spamScore: 61,
      spamScoreStatus: 'review',
      applyStatus: true,
    });
    expect(JSON.stringify(auditEvents)).not.toContain('sender:domain:example.com');
    expect(JSON.stringify(events)).not.toContain('sender:domain:example.com');
  });

});
