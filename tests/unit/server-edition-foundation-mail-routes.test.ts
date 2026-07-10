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

describe('server edition foundation — mail-routes', () => {
  test('server mail read routes expose secret-safe accounts and body-gated messages', async () => {
    const accountListCalls: unknown[] = [];
    const accountGetCalls: unknown[] = [];
    const attachmentListCalls: unknown[] = [];
    const attachmentGetCalls: unknown[] = [];
    const attachmentContentCalls: unknown[] = [];
    const messageListCalls: unknown[] = [];
    const messageGetCalls: unknown[] = [];
    const messageSecurityCalls: unknown[] = [];
    const messageRawHeadersCalls: unknown[] = [];
    const messageReadReceiptStateCalls: unknown[] = [];
    const messageFolderCountsCalls: unknown[] = [];
    const conversationCalls: unknown[] = [];
    const threadMessageCalls: unknown[] = [];
    const bulkSoftDeleteCalls: unknown[] = [];
    const bulkArchiveCalls: unknown[] = [];
    const bulkDoneCalls: unknown[] = [];
    const bulkSpamStatusCalls: unknown[] = [];
    const bulkDraftDeleteCalls: unknown[] = [];
    const snoozeCalls: unknown[] = [];
    const ports = makeServerApiPorts({
      emailAccounts: {
        async list(input) {
          accountListCalls.push(input);
          return {
            items: [withRuntimeLeaks(makeEmailAccountRecord(1))],
          };
        },
        async get(input) {
          accountGetCalls.push(input);
          return input.id === 1 ? withRuntimeLeaks(makeEmailAccountRecord(1)) : null;
        },
      },
      emailAttachments: {
        async listForMessage(input) {
          attachmentListCalls.push(input);
          return {
            items: [withRuntimeLeaks(makeEmailAttachmentRecord(31))],
          };
        },
        async get(input) {
          attachmentGetCalls.push(input);
          return input.id === 31 ? withRuntimeLeaks(makeEmailAttachmentRecord(31)) : null;
        },
      },
      emailAttachmentContent: {
        async get(input) {
          attachmentContentCalls.push(input);
          return input.id === 31
            ? {
              ok: true,
              record: {
                id: 31,
                filename: 'quote "31".pdf',
                contentType: 'application/pdf',
                sizeBytes: 16,
                contentSha256: 'sha256-31',
                content: Buffer.from('attachment bytes'),
              },
            }
            : { ok: false, reason: 'not_found' };
        },
      },
      emailMessages: {
        async list(input) {
          messageListCalls.push(input);
          return {
            items: [withRuntimeLeaks(makeEmailMessageRecord(11, true))],
            nextCursor: 11,
          };
        },
        async get(input) {
          messageGetCalls.push(input);
          return input.id === 11 ? withRuntimeLeaks(makeEmailMessageRecord(11, input.includeBody)) : null;
        },
        async getSecurity(input) {
          messageSecurityCalls.push(input);
          return input.id === 11
            ? {
              authSpf: 'pass',
              authDkim: 'pass',
              authDmarc: 'pass',
              authArc: null,
              authDkimDomains: 'example.com',
              authError: null,
              rspamdScore: 1.25,
              rspamdAction: 'no action',
              rspamdSymbols: 'BAYES_HAM',
              rspamdError: null,
              securityCheckedAt: '2026-06-03T10:00:00.000Z',
              spamStatus: 'clean',
              spamScore: 12,
              spamScoreLabel: 'clean',
              spamDecisionSource: 'server',
              spamScoreBreakdownJson: { reasons: [{ label: 'trusted sender', points: -4 }] },
              spamDecidedAt: '2026-06-03T10:05:00.000Z',
            }
            : null;
        },
        async getRawHeaders(input) {
          messageRawHeadersCalls.push(input);
          return input.id === 11
            ? {
              rawEml: 'From: sender@example.com\r\n\r\nBody',
              emlSource: 'reconstructed',
              rawHeaders: 'From: sender@example.com',
              messageIdHeader: '<message-11@example.com>',
              fromJson: [{ address: 'sender@example.com', name: 'Sender' }],
            }
            : null;
        },
        async getReadReceiptState(input) {
          messageReadReceiptStateCalls.push(input);
          return input.messageId === 11
            ? {
              requested: true,
              respond: 'ask',
              trustedDomains: 'example.com',
            }
            : null;
        },
        async getFolderCounts(input) {
          messageFolderCountsCalls.push(input);
          return {
            inbox: 3,
            inboxUnread: 2,
            sentFailed: 1,
            drafts: 4,
            scheduledSend: 0,
            archived: 5,
            spamReview: 6,
            spam: 7,
            trash: 8,
            snoozed: 9,
          };
        },
        async listConversation(input) {
          conversationCalls.push(input);
          return {
            items: [withRuntimeLeaks(makeEmailMessageRecord(12, false))],
            nextCursor: null,
          };
        },
        async listThread(input) {
          threadMessageCalls.push(input);
          return {
            items: [withRuntimeLeaks(makeEmailMessageRecord(13, false))],
            nextCursor: null,
          };
        },
        async bulkSoftDelete(input) {
          bulkSoftDeleteCalls.push(input);
          return { count: input.messageIds.length };
        },
        async bulkSetArchived(input) {
          bulkArchiveCalls.push(input);
          return { count: input.messageIds.length };
        },
        async bulkSetDone(input) {
          bulkDoneCalls.push(input);
          return { count: input.messageIds.length };
        },
        async bulkSetSpamStatus(input) {
          bulkSpamStatusCalls.push(input);
          return { count: input.messageIds.length };
        },
        async bulkDeleteLocalDrafts(input) {
          bulkDraftDeleteCalls.push(input);
          return { count: input.messageIds.length };
        },
        async snooze(input) {
          snoozeCalls.push(input);
          return { count: 1 };
        },
      },
    });
    const api = createServerApi(ports);
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const accounts = await api.handle({
      method: 'GET',
      path: '/api/v1/email/accounts',
      principal,
    });
    expect(accounts.status).toBe(200);
    expect((accounts.body as any).data.items[0].imapPasswordConfigured).toBe(true);
    expect(JSON.stringify(accounts.body)).not.toContain('keytar');
    expect(JSON.stringify(accounts.body)).not.toContain('secret-id');
    expect(accountListCalls).toEqual([{ workspaceId: WORKSPACE_A_ID }]);

    const account = await api.handle({
      method: 'GET',
      path: '/api/v1/email/accounts/1',
      principal,
    });
    expect(account.status).toBe(200);
    expect((account.body as any).data.emailAddress).toBe('mail1@example.com');
    expect(accountGetCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, id: 1 }]);

    const messages = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages',
      query: {
        accountId: '1',
        folderPath: ' INBOX ',
        folderKind: ' inbox ',
        view: 'inbox',
        offset: '5',
        categoryId: '6',
        sort: 'priority',
        listFilter: 'unread',
        doneFilter: 'open',
        seen: 'false',
        done: 'true',
        spam: 'false',
        search: ' Hello ',
        cursor: '20',
        limit: '10',
      },
      principal,
    });
    expect(messages.status).toBe(200);
    expect((messages.body as any).data.nextCursor).toBe(11);
    expect((messages.body as any).data.items[0].bodyText).toBeUndefined();
    expect((messages.body as any).data.items[0].bodyHtml).toBeUndefined();
    expect(JSON.stringify(messages.body)).not.toContain('raw-body-leak');
    expect(messageListCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      accountId: 1,
      folderPath: 'INBOX',
      folderKind: 'inbox',
      view: 'inbox',
      offset: 5,
      categoryId: 6,
      sort: 'priority',
      listFilter: 'unread',
      doneFilter: 'open',
      seen: false,
      done: true,
      spam: false,
      search: 'Hello',
      cursor: 20,
      limit: 10,
    }]);

    const folderCounts = await api.handle({
      method: 'GET',
      path: '/api/v1/email/folder-counts',
      query: { accountId: '1' },
      principal,
    });
    expect(folderCounts.status).toBe(200);
    expect((folderCounts.body as any).data).toEqual({
      inbox: 3,
      inboxUnread: 2,
      sentFailed: 1,
      drafts: 4,
      scheduledSend: 0,
      archived: 5,
      spamReview: 6,
      spam: 7,
      trash: 8,
      snoozed: 9,
    });
    expect(messageFolderCountsCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, accountId: 1 }]);

    const message = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11',
      query: { includeBody: 'true' },
      principal,
    });
    expect(message.status).toBe(200);
    expect((message.body as any).data.bodyText).toBe('Body text 11');
    expect(messageGetCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, id: 11, includeBody: true }]);

    const security = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/security',
      principal,
    });
    expect(security.status).toBe(200);
    expect((security.body as any).data.authSpf).toBe('pass');
    expect((security.body as any).data.spamScoreBreakdownJson).toEqual({
      reasons: [{ label: 'trusted sender', points: -4 }],
    });
    expect(messageSecurityCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, id: 11 }]);

    const rawHeaders = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/raw-headers',
      principal,
    });
    expect(rawHeaders.status).toBe(200);
    expect((rawHeaders.body as any).data.rawEml).toContain('From: sender@example.com');
    expect((rawHeaders.body as any).data.emlSource).toBe('reconstructed');
    expect((rawHeaders.body as any).data.messageIdHeader).toBe('<message-11@example.com>');
    expect(messageRawHeadersCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, id: 11 }]);

    const readReceiptState = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/read-receipt-state',
      principal,
    });
    expect(readReceiptState.status).toBe(200);
    expect((readReceiptState.body as any).data).toEqual({
      success: true,
      requested: true,
      respond: 'ask',
      trustedDomains: 'example.com',
    });
    expect(messageReadReceiptStateCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, messageId: 11 }]);

    const conversation = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/conversation',
      query: {
        accountId: '1',
        messageId: '11',
        ticketCode: ' T-11 ',
        customerId: '7',
        correspondentEmail: ' sender@example.com ',
        limit: '20',
      },
      principal,
    });
    expect(conversation.status).toBe(200);
    expect((conversation.body as any).data.items[0].id).toBe(12);
    expect((conversation.body as any).data.items[0].imapThreadId).toBe('imap-thread-12');
    expect(conversationCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      accountId: 1,
      excludeMessageId: 11,
      ticketCode: 'T-11',
      customerId: 7,
      correspondentEmail: 'sender@example.com',
      limit: 20,
    }]);

    const threadMessages = await api.handle({
      method: 'GET',
      path: '/api/v1/email/threads/thread-1/messages',
      query: { limit: '25', offset: '5' },
      principal,
    });
    expect(threadMessages.status).toBe(200);
    expect((threadMessages.body as any).data.items[0].id).toBe(13);
    expect(threadMessageCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      threadId: 'thread-1',
      limit: 25,
      offset: 5,
    }]);

    const bulkArchive = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/bulk/archive',
      body: { messageIds: [11, '12', 12], archived: true, accountId: '1' },
      principal,
    });
    expect(bulkArchive.status).toBe(200);
    expect((bulkArchive.body as any).data.count).toBe(2);
    expect(bulkArchiveCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      messageIds: [11, 12],
      archived: true,
      accountId: 1,
    }]);

    const bulkDone = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/bulk/done',
      body: { messageIds: [11], done: false },
      principal,
    });
    expect(bulkDone.status).toBe(200);
    expect(bulkDoneCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      messageIds: [11],
      done: false,
    }]);

    const bulkSpamStatus = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/bulk/spam-status',
      body: { messageIds: [11, '12', 12], status: ' spam ', train: false, accountId: '1' },
      principal,
    });
    expect(bulkSpamStatus.status).toBe(200);
    expect((bulkSpamStatus.body as any).data.count).toBe(2);
    expect(bulkSpamStatusCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'user-a',
      messageIds: [11, 12],
      values: {
        status: 'spam',
        source: 'bulk-manual',
        train: false,
      },
      accountId: 1,
    }]);

    const bulkDelete = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/bulk/soft-delete',
      body: { messageIds: [11, 12], accountId: 1 },
      principal,
    });
    expect(bulkDelete.status).toBe(200);
    expect(bulkSoftDeleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      messageIds: [11, 12],
      accountId: 1,
    }]);

    const bulkDraftDelete = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/messages/bulk/local-drafts',
      body: { messageIds: [21, '22', 22] },
      principal,
    });
    expect(bulkDraftDelete.status).toBe(200);
    expect((bulkDraftDelete.body as any).data.count).toBe(2);
    expect(bulkDraftDeleteCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      messageIds: [21, 22],
    }]);

    const snooze = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/11/snooze',
      body: { until: null },
      principal,
    });
    expect(snooze.status).toBe(200);
    expect(snoozeCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, messageId: 11, until: null }]);

    const attachments = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/attachments',
      principal,
    });
    expect(attachments.status).toBe(200);
    expect((attachments.body as any).data.items[0].filename).toBe('attachment-31.pdf');
    expect(JSON.stringify(attachments.body)).not.toContain('storage');
    expect(JSON.stringify(attachments.body)).not.toContain('/data/attachments');
    expect(attachmentListCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, messageId: 11 }]);

    const attachment = await api.handle({
      method: 'GET',
      path: '/api/v1/email/attachments/31',
      principal,
    });
    expect(attachment.status).toBe(200);
    expect((attachment.body as any).data.sizeBytes).toBe(3100);
    expect(attachmentGetCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, id: 31 }]);

    const attachmentContent = await api.handle({
      method: 'GET',
      path: '/api/v1/email/attachments/31/content',
      principal,
    });
    expect(attachmentContent.status).toBe(200);
    expect(Buffer.isBuffer(attachmentContent.body)).toBe(true);
    expect(Buffer.from(attachmentContent.body as Uint8Array).toString('utf8')).toBe('attachment bytes');
    expect(attachmentContent.headers).toMatchObject({
      'Content-Type': 'application/pdf',
      'Content-Length': '16',
      'X-Content-Type-Options': 'nosniff',
      ETag: '"sha256:sha256-31"',
    });
    expect(attachmentContent.headers?.['Content-Disposition']).toContain('filename="quote _31_.pdf"');
    expect(JSON.stringify(attachmentContent.headers)).not.toContain('/data/attachments');
    expect(attachmentContentCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, id: 31 }]);
  });

  test('server mail GDPR export route streams ZIP downloads and validates query flags', async () => {
    const exportCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      emailGdprExport: {
        async export(input) {
          exportCalls.push(input);
          const stream = new PassThrough();
          stream.end('zip-bytes');
          return {
            ok: true as const,
            filename: 'simple export.zip',
            stream,
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const response = await api.handle({
      method: 'GET',
      path: '/api/v1/email/gdpr-export',
      query: { skipAttachments: 'true' },
      principal,
    });
    expect(response.status).toBe(200);
    expect(response.body).toBeInstanceOf(PassThrough);
    expect(response.headers).toMatchObject({
      'Content-Type': 'application/zip',
    });
    expect(response.headers?.['Content-Disposition']).toContain('filename="simple export.zip"');
    expect(exportCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, skipAttachments: true }]);

    const invalidFlag = await api.handle({
      method: 'GET',
      path: '/api/v1/email/gdpr-export',
      query: { skipAttachments: 'maybe' },
      principal,
    });
    expect(invalidFlag.status).toBe(400);
    expect((invalidFlag.body as any).error.code).toBe('invalid_skip_attachments');

    const tooLarge = await createServerApi(makeServerApiPorts({
      emailGdprExport: {
        async export() {
          return {
            ok: false as const,
            code: 'attachments_too_large' as const,
            attachmentBytes: 5,
            maxBytes: 4,
          };
        },
      },
    })).handle({
      method: 'GET',
      path: '/api/v1/email/gdpr-export',
      principal,
    });
    expect(tooLarge.status).toBe(409);
    expect((tooLarge.body as any).error.details).toEqual({
      attachmentBytes: 5,
      maxBytes: 4,
    });

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'GET',
      path: '/api/v1/email/gdpr-export',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('email_gdpr_export_unavailable');
  });

  test('server reply suggestion routes expose status, enqueue ensure jobs, and generate direct drafts', async () => {
    const calls: unknown[] = [];
    const enqueued: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get(input) {
          calls.push(['message.get', input]);
          return input.id === 11 ? makeEmailMessageRecord(11, false) : null;
        },
      },
      aiReplySuggestions: {
        async get(input) {
          calls.push(['suggestion.get', input]);
          return {
            status: 'ready',
            text: 'Guten Tag',
            error: null,
            updatedAt: '2026-06-03T12:00:00.000Z',
          };
        },
        async ensure(input) {
          calls.push(['suggestion.ensure', input]);
        },
        async generate(input) {
          calls.push(['suggestion.generate', input]);
          return { success: true, text: 'Direkter Entwurf' };
        },
      },
      jobQueue: {
        async enqueue(input) {
          enqueued.push(input);
          return undefined;
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const status = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/11/reply-suggestion',
      principal,
    });
    expect(status.status).toBe(200);
    expect((status.body as any).data).toEqual({
      status: 'ready',
      text: 'Guten Tag',
      error: null,
      updatedAt: '2026-06-03T12:00:00.000Z',
    });

    const ensure = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/reply-suggestion/ensure',
      body: { force: true, trigger: 'open' },
      principal,
    });
    expect(ensure.status).toBe(202);
    expect(enqueued).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      type: 'ai.reply_suggestion',
      payload: {
        workspaceId: WORKSPACE_A_ID,
        messageId: 11,
        actorUserId: USER_A_ID,
        force: true,
        trigger: 'open',
      },
    }]);

    const generated = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/reply-draft',
      body: { promptId: 22, customerId: null },
      principal,
    });
    expect(generated.status).toBe(200);
    expect((generated.body as any).data).toEqual({ success: true, text: 'Direkter Entwurf' });

    const invalidTrigger = await api.handle({
      method: 'POST',
      path: '/api/v1/email/messages/11/reply-suggestion/ensure',
      body: { trigger: 'manual' },
      principal,
    });
    expect(invalidTrigger.status).toBe(400);

    expect(calls).toEqual([
      ['suggestion.get', { workspaceId: WORKSPACE_A_ID, messageId: 11 }],
      ['message.get', { workspaceId: WORKSPACE_A_ID, id: 11, includeBody: false }],
      ['suggestion.generate', {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        messageId: 11,
        promptId: 22,
        customerId: null,
      }],
    ]);
  });

  test('server mail compose draft and scheduled-send routes normalize legacy payloads', async () => {
    const calls: unknown[] = [];
    const syncWrites: unknown[] = [];
    const draftRecord = (id: number): EmailMessageRecord => ({
      ...makeEmailMessageRecord(id, true),
      uid: -id,
      folderKind: 'draft',
      draftAttachmentPathsJson: '[]',
      replyParentMessageId: null,
    });
    const api = createServerApi(makeServerApiPorts({
      emailMessages: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get(input) {
          return input.id === 44 ? draftRecord(44) : null;
        },
        async createComposeDraft(input) {
          calls.push(['createComposeDraft', input]);
          return { ok: true as const, message: draftRecord(44) };
        },
        async updateComposeDraft(input) {
          calls.push(['updateComposeDraft', input]);
          return input.messageId === 98
            ? { ok: false as const, reason: 'not_local_draft' as const }
            : { ok: true as const, message: draftRecord(input.messageId) };
        },
        async scheduleDraftSend(input) {
          calls.push(['scheduleDraftSend', input]);
          return { ok: true as const, message: draftRecord(input.messageId) };
        },
        async getScheduledSendDraftState(input) {
          calls.push(['getScheduledSendDraftState', input]);
          return {
            failureCount: 2,
            status: 'failed' as const,
            lastError: 'SMTP rejected message',
          };
        },
        async getComposeDraftRecoveryState(input) {
          calls.push(['getComposeDraftRecoveryState', input]);
          return {
            smtpCommitted: true,
            needsResendFinalize: true,
          };
        },
        async clearScheduledSendDraftFailure(input) {
          calls.push(['clearScheduledSendDraftFailure', input]);
          return { success: true as const };
        },
        async retryScheduledSendDraft(input) {
          calls.push(['retryScheduledSendDraft', input]);
          return { ok: true as const, message: draftRecord(input.messageId) };
        },
      },
      emailComposeSender: {
        async send(input) {
          calls.push(['sendCompose', input]);
          return {
            ok: true as const,
            messageId: input.values.draftMessageId,
            accountId: input.values.accountId,
            warning: 'Server-Kopie per IMAP APPEND ist im Test nicht aktiv.',
          };
        },
      },
      syncInfo: {
        async getMany() {
          return [];
        },
        async getByPrefix() {
          return [];
        },
        async setMany(input) {
          syncWrites.push(input);
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
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/email/compose-drafts',
      body: {
        accountId: 7,
        subject: 'Draft',
        bodyText: 'Hello',
        to: 'Person <Person+tag@Example.com>; person@example.com',
      },
      principal,
    });
    expect(created.status).toBe(200);
    expect((created.body as any).data).toMatchObject({
      success: true,
      id: 44,
      message: {
        id: 44,
        bcc: [],
        draftAttachmentPathsJson: '[]',
        replyParentMessageId: null,
      },
    });

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/44/compose-draft',
      body: {
        subject: 'Updated',
        bodyText: 'Plain',
        bodyHtml: '<p>Plain</p>',
        to: 'To <to+tag@Example.com>',
        cc: 'cc@example.com',
        bcc: 'Bcc <bcc@example.com>; bcc@example.com',
        draftAttachmentPaths: [' /data/a.eml ', '', '/data/a.eml', '/data/b.eml'],
        replyParentMessageId: 11,
        markReplyParentDone: true,
      },
      principal,
    });
    expect(updated.status).toBe(200);
    expect(syncWrites).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      values: { 'compose_mark_parent_done:44': '1' },
    }]);

    const sent = await api.handle({
      method: 'POST',
      path: '/api/v1/email/compose/send',
      body: {
        accountId: 7,
        draftMessageId: 44,
        subject: 'Updated',
        bodyText: 'Plain',
        bodyHtml: '<p>Plain</p>',
        to: 'To <to+tag@Example.com>',
        cc: 'cc@example.com',
        bcc: 'bcc@example.com',
        inReplyToMessageId: 11,
        attachmentPaths: [],
        markReplyParentDone: true,
        requestReadReceipt: true,
      },
      principal,
    });
    expect(sent.status).toBe(200);
    expect((sent.body as any).data).toEqual({
      success: true,
      warning: 'Server-Kopie per IMAP APPEND ist im Test nicht aktiv.',
    });

    const scheduled = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/44/scheduled-send',
      body: { sendAt: '2026-06-04T15:00:00.000Z' },
      principal,
    });
    expect(scheduled.status).toBe(200);

    const state = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/44/scheduled-send-state',
      principal,
    });
    expect(state.status).toBe(200);
    expect((state.body as any).data).toEqual({
      success: true,
      failureCount: 2,
      status: 'failed',
      lastError: 'SMTP rejected message',
    });

    const recovery = await api.handle({
      method: 'GET',
      path: '/api/v1/email/messages/44/compose-draft-recovery-state',
      principal,
    });
    expect(recovery.status).toBe(200);
    expect((recovery.body as any).data).toEqual({
      success: true,
      smtpCommitted: true,
      needsResendFinalize: true,
    });

    const cleared = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/messages/44/scheduled-send-failure',
      principal,
    });
    expect(cleared.status).toBe(200);

    const retried = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/44/scheduled-send/retry',
      principal,
    });
    expect(retried.status).toBe(200);

    const notLocal = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/98/compose-draft',
      body: { subject: 'Nope' },
      principal,
    });
    expect(notLocal.status).toBe(409);
    expect((notLocal.body as any).error.code).toBe('email_message_not_local_draft');

    const invalid = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/messages/44/scheduled-send',
      body: { sendAt: 'not a date' },
      principal,
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.code).toBe('validation_error');

    expect(calls).toEqual([
      ['createComposeDraft', {
        workspaceId: WORKSPACE_A_ID,
        accountId: 7,
        values: {
          accountId: 7,
          subject: 'Draft',
          bodyText: 'Hello',
          toJson: { value: [{ address: 'person@example.com' }] },
        },
      }],
      ['updateComposeDraft', {
        workspaceId: WORKSPACE_A_ID,
        messageId: 44,
        values: {
          subject: 'Updated',
          bodyText: 'Plain',
          bodyHtml: '<p>Plain</p>',
          toJson: { value: [{ address: 'to@example.com' }] },
          ccJson: { value: [{ address: 'cc@example.com' }] },
          bccJson: { value: [{ address: 'bcc@example.com' }] },
          draftAttachmentPaths: ['/data/a.eml', '/data/b.eml'],
          replyParentMessageId: 11,
        },
      }],
      ['sendCompose', {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        values: {
          accountId: 7,
          draftMessageId: 44,
          subject: 'Updated',
          bodyText: 'Plain',
          bodyHtml: '<p>Plain</p>',
          to: 'To <to+tag@Example.com>',
          cc: 'cc@example.com',
          bcc: 'bcc@example.com',
          inReplyToMessageId: 11,
          attachmentPaths: [],
          markReplyParentDone: true,
          requestReadReceipt: true,
        },
      }],
      ['scheduleDraftSend', {
        workspaceId: WORKSPACE_A_ID,
        messageId: 44,
        sendAt: '2026-06-04T15:00:00.000Z',
      }],
      ['getScheduledSendDraftState', {
        workspaceId: WORKSPACE_A_ID,
        messageId: 44,
      }],
      ['getComposeDraftRecoveryState', {
        workspaceId: WORKSPACE_A_ID,
        messageId: 44,
      }],
      ['clearScheduledSendDraftFailure', {
        workspaceId: WORKSPACE_A_ID,
        messageId: 44,
      }],
      ['retryScheduledSendDraft', {
        workspaceId: WORKSPACE_A_ID,
        messageId: 44,
      }],
      ['updateComposeDraft', {
        workspaceId: WORKSPACE_A_ID,
        messageId: 98,
        values: { subject: 'Nope' },
      }],
    ]);
  });

  test('server outbound validation persists manual approval marker on success', () => {
    const source = readFileSync(resolve(__dirname, '../../packages/server/src/mail-compose-send.ts'), 'utf8');
    expect(source).toMatch(/persistManualOutboundApproval/);
    expect(source).toMatch(/evaluateComposeOutboundDryRun/);
  });

  test('server outbound validation route delegates to server review port', async () => {
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      emailOutboundValidation: {
        async validate(input) {
          calls.push(input);
          return {
            allowed: false as const,
            reason: 'Ausgangspruefung wird serverseitig ausgefuehrt',
            workflowRunId: 901,
          };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const response = await api.handle({
      method: 'POST',
      path: '/api/v1/email/compose/validate-outbound',
      body: {
        messageId: 44,
        subject: 'Pruefung',
        bodyText: 'Bitte pruefen',
        bodyHtml: '<p>Bitte pruefen</p>',
        to: 'kunde@example.com',
        cc: 'team@example.com',
        bcc: 'audit@example.com',
        inReplyToMessageId: 11,
        attachmentCount: 2,
      },
      principal,
    });

    expect(response.status).toBe(200);
    expect((response.body as any).data).toEqual({
      success: true,
      allowed: false,
      reason: 'Ausgangspruefung wird serverseitig ausgefuehrt',
      workflowRunId: 901,
    });
    expect(calls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        messageId: 44,
        subject: 'Pruefung',
        bodyText: 'Bitte pruefen',
        bodyHtml: '<p>Bitte pruefen</p>',
        to: 'kunde@example.com',
        cc: 'team@example.com',
        bcc: 'audit@example.com',
        inReplyToMessageId: 11,
        attachmentCount: 2,
      },
    }]);

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/email/compose/validate-outbound',
      body: {
        messageId: 0,
        subject: 'x',
        bodyText: 'x',
        to: 'kunde@example.com',
        workspaceId: WORKSPACE_A_ID,
      },
      principal,
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.details.fields).toEqual(expect.arrayContaining([
      { field: 'workspaceId', message: 'Feld ist nicht erlaubt' },
      { field: 'messageId', message: 'messageId muss eine positive Ganzzahl sein' },
    ]));

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'POST',
      path: '/api/v1/email/compose/validate-outbound',
      body: {
        messageId: 44,
        subject: 'Pruefung',
        bodyText: 'Bitte pruefen',
        to: 'kunde@example.com',
      },
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('email_outbound_validation_unavailable');
  });

  test('server mail account create route validates required fields and sanitizes secrets', async () => {
    const createCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const createdAccount: EmailAccountRecord = {
      ...makeEmailAccountRecord(17),
      sourceSqliteId: -4,
      displayName: 'Created mailbox',
      emailAddress: 'created@example.com',
      imapPasswordConfigured: true,
      smtpPasswordConfigured: true,
    };
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailAccounts: {
        async list() {
          return { items: [] };
        },
        async get() {
          return null;
        },
        async create(input) {
          createCalls.push(input);
          if (input.values.imapPassword === 'missing-secret-port') {
            return { ok: false, code: 'secret_port_unavailable' };
          }
          return { ok: true, account: createdAccount };
        },
      },
    }));
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const missingRequired = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts',
      body: {
        displayName: 'Created mailbox',
        emailAddress: 'created@example.com',
        imapHost: 'imap.example.com',
        imapUsername: 'created@example.com',
      },
      principal,
    });
    expect(missingRequired.status).toBe(400);
    expect((missingRequired.body as any).error.code).toBe('validation_error');
    expect(JSON.stringify(missingRequired.body)).toContain('imapPassword');
    expect(createCalls).toEqual([]);

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts',
      body: {
        displayName: ' Created mailbox ',
        emailAddress: 'created@example.com',
        imapHost: ' imap.example.com ',
        imapPort: 993,
        imapTls: true,
        imapUsername: ' created@example.com ',
        imapPassword: 'imap-secret',
        smtpHost: ' smtp.example.com ',
        smtpPort: 587,
        smtpTls: true,
        smtpUsername: ' created@example.com ',
        smtpUseImapAuth: false,
        smtpPassword: 'smtp-secret',
        protocol: 'imap',
        imapSyncSeenOnOpen: false,
      },
      principal,
    });
    expect(created.status).toBe(200);
    expect((created.body as any).data).toMatchObject({
      success: true,
      id: 17,
      account: {
        id: 17,
        sourceSqliteId: -4,
        displayName: 'Created mailbox',
        emailAddress: 'created@example.com',
        imapPasswordConfigured: true,
        smtpPasswordConfigured: true,
      },
    });
    expect(createCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'user-a',
      values: {
        displayName: 'Created mailbox',
        emailAddress: 'created@example.com',
        imapHost: 'imap.example.com',
        imapPort: 993,
        imapTls: true,
        imapUsername: 'created@example.com',
        imapPassword: 'imap-secret',
        smtpHost: 'smtp.example.com',
        smtpPort: 587,
        smtpTls: true,
        smtpUsername: 'created@example.com',
        smtpUseImapAuth: false,
        smtpPassword: 'smtp-secret',
        protocol: 'imap',
        imapSyncSeenOnOpen: false,
      },
    }]);
    expect(auditEvents[0]).toMatchObject({
      action: 'email_account.created',
      entityType: 'email_account',
      entityId: '17',
      metadata: {
        fields: [
          'displayName',
          'emailAddress',
          'imapHost',
          'imapPort',
          'imapSyncSeenOnOpen',
          'imapTls',
          'imapUsername',
          'protocol',
          'smtpHost',
          'smtpPort',
          'smtpTls',
          'smtpUseImapAuth',
          'smtpUsername',
        ],
        passwordChanged: { imap: true, smtp: true },
      },
    });
    expect(events[0]).toMatchObject({
      type: 'email_account.created',
      entityType: 'email_account',
      entityId: '17',
      payload: {
        passwordChanged: { imap: true, smtp: true },
      },
    });
    expect(JSON.stringify(created.body)).not.toContain('imap-secret');
    expect(JSON.stringify(created.body)).not.toContain('smtp-secret');
    expect(JSON.stringify(auditEvents)).not.toContain('imap-secret');
    expect(JSON.stringify(auditEvents)).not.toContain('smtp-secret');
    expect(JSON.stringify(events)).not.toContain('imap-secret');
    expect(JSON.stringify(events)).not.toContain('smtp-secret');

    const secretUnavailable = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts',
      body: {
        displayName: 'Created mailbox',
        emailAddress: 'created@example.com',
        imapHost: 'imap.example.com',
        imapUsername: 'created@example.com',
        imapPassword: 'missing-secret-port',
      },
      principal,
    });
    expect(secretUnavailable.status).toBe(503);
    expect((secretUnavailable.body as any).error.code).toBe('email_account_secret_unavailable');
  });

  test('server mail account mutation routes validate, audit, and publish sanitized events', async () => {
    const updateCalls: unknown[] = [];
    const deleteCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const events: ServerEvent[] = [];
    const account = makeEmailAccountRecord(1);
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      events,
      emailAccounts: {
        async list() {
          return { items: [] };
        },
        async get() {
          return account;
        },
        async update(input) {
          updateCalls.push(input);
          if (input.values.imapPassword === 'missing-secret-port') {
            return { ok: false, code: 'secret_port_unavailable' };
          }
          return {
            ok: true,
            account: {
              ...account,
              displayName: input.values.displayName ?? account.displayName,
              emailAddress: input.values.emailAddress ?? account.emailAddress,
              smtpHost: input.values.smtpHost ?? account.smtpHost,
              syncSpamFolderPath: Object.prototype.hasOwnProperty.call(input.values, 'syncSpamFolderPath')
                ? input.values.syncSpamFolderPath ?? null
                : account.syncSpamFolderPath,
              imapSyncSent: input.values.imapSyncSent ?? account.imapSyncSent,
              vacationBodyText: Object.prototype.hasOwnProperty.call(input.values, 'vacationBodyText')
                ? input.values.vacationBodyText ?? null
                : account.vacationBodyText,
              requestReadReceipt: input.values.requestReadReceipt ?? account.requestReadReceipt,
            },
          };
        },
        async delete(input) {
          deleteCalls.push(input);
          return { ok: true, account };
        },
      },
    }));
    const principal = { userId: 'user-a', workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const invalid = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/accounts/1',
      body: { displayName: 'Main', sourceSqliteId: 1 },
      principal,
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.code).toBe('validation_error');
    expect(updateCalls).toEqual([]);

    const updated = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/accounts/1',
      body: {
        displayName: ' Main mailbox ',
        emailAddress: 'main@example.com',
        smtpHost: ' smtp.example.com ',
        smtpPassword: 'smtp-secret',
        syncSpamFolderPath: '  ',
        imapSyncSent: true,
        vacationBodyText: ' Back later ',
        requestReadReceipt: true,
      },
      principal,
    });
    expect(updated.status).toBe(200);
    expect((updated.body as any).data).toMatchObject({
      success: true,
      account: {
        displayName: 'Main mailbox',
        emailAddress: 'main@example.com',
        smtpHost: 'smtp.example.com',
        syncSpamFolderPath: null,
        imapSyncSent: true,
        vacationBodyText: 'Back later',
        requestReadReceipt: true,
      },
    });
    expect(updateCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'user-a',
      id: 1,
      values: {
        displayName: 'Main mailbox',
        emailAddress: 'main@example.com',
        smtpHost: 'smtp.example.com',
        smtpPassword: 'smtp-secret',
        syncSpamFolderPath: null,
        imapSyncSent: true,
        vacationBodyText: 'Back later',
        requestReadReceipt: true,
      },
    }]);
    expect(auditEvents[0]).toMatchObject({
      action: 'email_account.updated',
      entityType: 'email_account',
      entityId: '1',
      metadata: {
        fields: ['displayName', 'emailAddress', 'imapSyncSent', 'requestReadReceipt', 'smtpHost', 'syncSpamFolderPath', 'vacationBodyText'],
        passwordChanged: { imap: false, smtp: true },
      },
    });
    expect(events[0]).toMatchObject({
      type: 'email_account.updated',
      entityType: 'email_account',
      entityId: '1',
      payload: {
        fields: ['displayName', 'emailAddress', 'imapSyncSent', 'requestReadReceipt', 'smtpHost', 'syncSpamFolderPath', 'vacationBodyText'],
        passwordChanged: { imap: false, smtp: true },
      },
    });
    expect(JSON.stringify(auditEvents)).not.toContain('smtp-secret');
    expect(JSON.stringify(events)).not.toContain('smtp-secret');

    const secretUnavailable = await api.handle({
      method: 'PATCH',
      path: '/api/v1/email/accounts/1',
      body: { imapPassword: 'missing-secret-port' },
      principal,
    });
    expect(secretUnavailable.status).toBe(503);
    expect((secretUnavailable.body as any).error.code).toBe('email_account_secret_unavailable');

    const deleted = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/accounts/1',
      principal,
    });
    expect(deleted.status).toBe(200);
    expect((deleted.body as any).data).toMatchObject({ success: true, deleted: true });
    expect(deleteCalls).toEqual([{ workspaceId: WORKSPACE_A_ID, actorUserId: 'user-a', id: 1 }]);
    expect(auditEvents[1]).toMatchObject({
      action: 'email_account.deleted',
      entityType: 'email_account',
      entityId: '1',
    });
    expect(events[1]).toMatchObject({
      type: 'email_account.deleted',
      entityType: 'email_account',
      entityId: '1',
    });
  });

  test('server mail account sync route enqueues workspace-scoped mail sync jobs', async () => {
    const queueCalls: unknown[] = [];
    const accountGetCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      emailAccounts: {
        async list() {
          return { items: [] };
        },
        async get(input) {
          accountGetCalls.push(input);
          if (input.id === 7) return { ...makeEmailAccountRecord(7), protocol: 'imap' };
          if (input.id === 8) return { ...makeEmailAccountRecord(8), protocol: 'pop3' };
          if (input.id === 9) return { ...makeEmailAccountRecord(9), protocol: 'smtp' };
          return null;
        },
      },
      jobQueue: {
        async enqueue(input) {
          queueCalls.push(input);
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const imap = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/7/sync',
      principal,
    });
    expect(imap.status).toBe(202);
    expect((imap.body as any).data).toEqual({
      success: true,
      queued: true,
      accountId: 7,
      jobType: 'mail.sync.imap',
      fullInbox: false,
    });

    const fullInbox = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/7/sync',
      body: { fullInbox: true },
      principal,
    });
    expect(fullInbox.status).toBe(202);
    expect((fullInbox.body as any).data.fullInbox).toBe(true);

    const pop3 = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/8/sync',
      principal,
    });
    expect(pop3.status).toBe(202);
    expect((pop3.body as any).data.jobType).toBe('mail.sync.pop3');

    const missing = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/77/sync',
      principal,
    });
    expect(missing.status).toBe(404);

    const unsupported = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/9/sync',
      principal,
    });
    expect(unsupported.status).toBe(409);
    expect((unsupported.body as any).error.code).toBe('unsupported_email_account_protocol');

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/0/sync',
      principal,
    });
    expect(invalid.status).toBe(400);

    const wrongMethod = await api.handle({
      method: 'GET',
      path: '/api/v1/email/accounts/7/sync',
      principal,
    });
    expect(wrongMethod.status).toBe(405);

    const unavailable = await createServerApi(makeServerApiPorts({
      emailAccounts: {
        async list() {
          return { items: [] };
        },
        async get() {
          return makeEmailAccountRecord(7);
        },
      },
    })).handle({
      method: 'POST',
      path: '/api/v1/email/accounts/7/sync',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('job_queue_unavailable');

    expect(accountGetCalls).toEqual([
      { workspaceId: WORKSPACE_A_ID, id: 7 },
      { workspaceId: WORKSPACE_A_ID, id: 7 },
      { workspaceId: WORKSPACE_A_ID, id: 8 },
      { workspaceId: WORKSPACE_A_ID, id: 77 },
      { workspaceId: WORKSPACE_A_ID, id: 9 },
    ]);
    expect(queueCalls).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        type: 'mail.sync.imap',
        payload: {
          workspaceId: WORKSPACE_A_ID,
          accountId: 7,
          actorUserId: USER_A_ID,
        },
      },
      {
        workspaceId: WORKSPACE_A_ID,
        type: 'mail.sync.imap',
        payload: {
          workspaceId: WORKSPACE_A_ID,
          accountId: 7,
          actorUserId: USER_A_ID,
          fullInbox: true,
        },
      },
      {
        workspaceId: WORKSPACE_A_ID,
        type: 'mail.sync.pop3',
        payload: {
          workspaceId: WORKSPACE_A_ID,
          accountId: 8,
          actorUserId: USER_A_ID,
        },
      },
    ]);
  });

  test('server mail account sync-lock route releases stale account sync job locks', async () => {
    const releaseCalls: unknown[] = [];
    const auditEvents: CapturedAuditEvent[] = [];
    const api = createServerApi(makeServerApiPorts({
      auditEvents,
      emailAccounts: {
        async list() {
          return { items: [] };
        },
        async get(input) {
          return input.id === 7 ? { ...makeEmailAccountRecord(7), protocol: 'imap' } : null;
        },
      },
      jobQueue: {
        async enqueue() {
          throw new Error('not used');
        },
        async releaseAccountSyncLocks(input) {
          releaseCalls.push(input);
          return [{ id: 501 }];
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const cleared = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/accounts/7/sync-lock',
      principal,
    });
    expect(cleared.status).toBe(200);
    expect((cleared.body as any).data).toEqual({
      success: true,
      accountId: 7,
      released: 1,
    });
    expect(releaseCalls).toHaveLength(1);
    expect(releaseCalls[0]).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      limit: 100,
    });
    expect((releaseCalls[0] as { staleBefore: Date }).staleBefore).toBeInstanceOf(Date);
    expect(auditEvents[0]).toMatchObject({
      action: 'email_account.sync_lock_cleared',
      entityType: 'email_account',
      entityId: '7',
      metadata: {
        accountId: 7,
        released: 1,
      },
    });

    const missing = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/accounts/77/sync-lock',
      principal,
    });
    expect(missing.status).toBe(404);

    const invalid = await api.handle({
      method: 'DELETE',
      path: '/api/v1/email/accounts/0/sync-lock',
      principal,
    });
    expect(invalid.status).toBe(400);

    const wrongMethod = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/7/sync-lock',
      principal,
    });
    expect(wrongMethod.status).toBe(405);

    const unavailable = await createServerApi(makeServerApiPorts({
      emailAccounts: {
        async list() {
          return { items: [] };
        },
        async get() {
          return makeEmailAccountRecord(7);
        },
      },
      jobQueue: {
        async enqueue() {
          throw new Error('not used');
        },
      },
    })).handle({
      method: 'DELETE',
      path: '/api/v1/email/accounts/7/sync-lock',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('job_queue_lock_release_unavailable');
  });

  test('server vacation auto-reply test route calls workspace-scoped sender and logs success', async () => {
    const senderCalls: unknown[] = [];
    const activityCalls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      emailVacationTests: {
        async sendTest(input) {
          senderCalls.push(input);
          if (input.accountId === 8) return { success: false, error: 'smtp failed' };
          return {
            success: true,
            accountId: input.accountId,
            emailAddress: 'agent@example.com',
          };
        },
      },
      activityLog: {
        async list() {
          return { items: [], nextCursor: null };
        },
        async get() {
          return null;
        },
        async create(input) {
          activityCalls.push(input);
          return { ok: true, activityLog: makeActivityLogRecord(1) };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const ok = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/7/vacation-test',
      principal,
    });
    expect(ok.status).toBe(200);
    expect((ok.body as any).data).toEqual({
      success: true,
      accountId: 7,
      emailAddress: 'agent@example.com',
    });

    const failed = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/8/vacation-test',
      principal,
    });
    expect(failed.status).toBe(200);
    expect((failed.body as any).data).toEqual({ success: false, error: 'smtp failed' });

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/0/vacation-test',
      principal,
    });
    expect(invalid.status).toBe(400);

    const wrongMethod = await api.handle({
      method: 'GET',
      path: '/api/v1/email/accounts/7/vacation-test',
      principal,
    });
    expect(wrongMethod.status).toBe(405);

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'POST',
      path: '/api/v1/email/accounts/7/vacation-test',
      principal,
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('email_vacation_test_unavailable');

    expect(senderCalls).toEqual([
      { workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, accountId: 7 },
      { workspaceId: WORKSPACE_A_ID, actorUserId: USER_A_ID, accountId: 8 },
    ]);
    expect(activityCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        activityType: 'email_vacation_test',
        title: 'Abwesenheitsantwort getestet',
        description: 'Testmail an agent@example.com',
        metadata: { accountId: 7 },
      },
    }]);
  });

  test('server mail account connection test routes call workspace-scoped test ports', async () => {
    const calls: unknown[] = [];
    const api = createServerApi(makeServerApiPorts({
      mailConnectionTests: {
        async testImap(input) {
          calls.push(['imap', input]);
          return { success: true };
        },
        async testPop3(input) {
          calls.push(['pop3', input]);
          return input.host === 'bad.example.com'
            ? { success: false, error: 'login failed' }
            : { success: true };
        },
        async testSmtp(input) {
          calls.push(['smtp', input]);
          return { success: true };
        },
      },
    }));
    const principal = { userId: USER_A_ID, workspaceId: WORKSPACE_A_ID, role: 'user' as const };

    const imap = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/test-imap',
      principal,
      body: {
        accountId: 7,
        imapHost: ' imap.example.com ',
        imapPort: 993,
        imapTls: true,
        imapUsername: ' user@example.com ',
        imapPassword: '',
      },
    });
    expect(imap.status).toBe(200);
    expect((imap.body as any).data).toEqual({ success: true });

    const pop3 = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/test-pop3',
      principal,
      body: {
        host: 'bad.example.com',
        port: 995,
        tls: true,
        user: 'user@example.com',
        password: 'secret',
      },
    });
    expect(pop3.status).toBe(200);
    expect((pop3.body as any).data).toEqual({ success: false, error: 'login failed' });

    const smtp = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/test-smtp',
      principal,
      body: {
        accountId: 7,
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'user@example.com',
        password: '',
        smtpUseImapAuth: true,
      },
    });
    expect(smtp.status).toBe(200);
    expect((smtp.body as any).data).toEqual({ success: true });

    const invalid = await api.handle({
      method: 'POST',
      path: '/api/v1/email/accounts/test-imap',
      principal,
      body: {
        imapHost: '',
        imapPort: 70000,
        imapTls: 'yes',
        imapUsername: 'user@example.com',
        imapPassword: 'secret',
      },
    });
    expect(invalid.status).toBe(400);
    expect((invalid.body as any).error.code).toBe('validation_error');

    const unavailable = await createServerApi(makeServerApiPorts()).handle({
      method: 'POST',
      path: '/api/v1/email/accounts/test-pop3',
      principal,
      body: {
        host: 'pop.example.com',
        port: 995,
        tls: true,
        user: 'user@example.com',
        password: 'secret',
      },
    });
    expect(unavailable.status).toBe(503);
    expect((unavailable.body as any).error.code).toBe('mail_connection_test_unavailable');

    expect(calls).toEqual([
      ['imap', {
        workspaceId: WORKSPACE_A_ID,
        accountId: 7,
        host: 'imap.example.com',
        port: 993,
        tls: true,
        user: 'user@example.com',
        password: '',
      }],
      ['pop3', {
        workspaceId: WORKSPACE_A_ID,
        host: 'bad.example.com',
        port: 995,
        tls: true,
        user: 'user@example.com',
        password: 'secret',
      }],
      ['smtp', {
        workspaceId: WORKSPACE_A_ID,
        accountId: 7,
        host: 'smtp.example.com',
        port: 587,
        tls: false,
        user: 'user@example.com',
        password: '',
        smtpUseImapAuth: true,
      }],
    ]);
  });

  test('server mail connection test port performs IMAP, POP3, and SMTP login probes', async () => {
    const imapLines: string[] = [];
    const imapServer = await startLineServer((line, socket) => {
      imapLines.push(line);
      if (line.startsWith('a001 LOGIN ')) socket.write('a001 OK login completed\r\n');
      else if (line.startsWith('a002 SELECT ')) socket.write('* FLAGS (\\Seen)\r\na002 OK select completed\r\n');
      else if (line.startsWith('a003 LOGOUT')) socket.write('* BYE logout\r\na003 OK logout completed\r\n');
      else socket.write('bad BAD unknown command\r\n');
    }, '* OK IMAP ready\r\n');

    const pop3Lines: string[] = [];
    const pop3Server = await startLineServer((line, socket) => {
      pop3Lines.push(line);
      if (line === 'USER user@example.com') socket.write('+OK user accepted\r\n');
      else if (line === 'PASS secret') socket.write('+OK pass accepted\r\n');
      else if (line === 'UIDL') socket.write('+OK uidl follows\r\n1 uid-1\r\n.\r\n');
      else if (line === 'QUIT') socket.write('+OK bye\r\n');
      else socket.write('-ERR unknown command\r\n');
    }, '+OK POP3 ready\r\n');

    const smtpLines: string[] = [];
    let inData = false;
    const smtpServer = await startLineServer((line, socket) => {
      smtpLines.push(line);
      if (inData) {
        if (line === '.') {
          inData = false;
          socket.write('250 2.0.0 queued\r\n');
        }
        return;
      }
      if (line === 'EHLO simplecrm.local') socket.write('250-localhost\r\n250-AUTH LOGIN\r\n250 OK\r\n');
      else if (line === 'AUTH LOGIN') socket.write('334 VXNlcm5hbWU6\r\n');
      else if (line === Buffer.from('user@example.com', 'utf8').toString('base64')) socket.write('334 UGFzc3dvcmQ6\r\n');
      else if (line === Buffer.from('secret', 'utf8').toString('base64')) socket.write('235 2.7.0 Authentication successful\r\n');
      else if (line === 'MAIL FROM:<user@example.com>') socket.write('250 sender ok\r\n');
      else if (line === 'RCPT TO:<user@example.com>') socket.write('250 recipient ok\r\n');
      else if (line === 'DATA') {
        inData = true;
        socket.write('354 end with dot\r\n');
      } else if (line === 'QUIT') socket.write('221 bye\r\n');
      else socket.write('500 unknown command\r\n');
    }, '220 SMTP ready\r\n');

    const smtpOauthLines: string[] = [];
    let smtpOauthPayload = '';
    let smtpOauthInData = false;
    const smtpOauthServer = await startLineServer((line, socket) => {
      smtpOauthLines.push(line);
      if (smtpOauthInData) {
        if (line === '.') {
          smtpOauthInData = false;
          socket.write('250 2.0.0 queued\r\n');
        }
        return;
      }
      if (line === 'EHLO simplecrm.local') socket.write('250-localhost\r\n250-AUTH XOAUTH2\r\n250 OK\r\n');
      else if (line.startsWith('AUTH XOAUTH2 ')) {
        smtpOauthPayload = Buffer.from(line.slice('AUTH XOAUTH2 '.length), 'base64').toString('utf8');
        socket.write('235 2.7.0 Authentication successful\r\n');
      } else if (line === 'MAIL FROM:<user@example.com>') socket.write('250 sender ok\r\n');
      else if (line === 'RCPT TO:<user@example.com>') socket.write('250 recipient ok\r\n');
      else if (line === 'DATA') {
        smtpOauthInData = true;
        socket.write('354 end with dot\r\n');
      } else if (line === 'QUIT') socket.write('221 bye\r\n');
      else socket.write('500 unknown command\r\n');
    }, '220 SMTP ready\r\n');

    try {
      const port = createServerMailConnectionTestPort({ timeoutMs: 1000 });

      await expect(port.testImap({
        workspaceId: WORKSPACE_A_ID,
        host: '127.0.0.1',
        port: imapServer.port,
        tls: false,
        user: 'user@example.com',
        password: 'secret',
      })).resolves.toEqual({ success: true });

      await expect(port.testPop3({
        workspaceId: WORKSPACE_A_ID,
        host: '127.0.0.1',
        port: pop3Server.port,
        tls: false,
        user: 'user@example.com',
        password: 'secret',
      })).resolves.toEqual({ success: true });

      await expect(port.testSmtp({
        workspaceId: WORKSPACE_A_ID,
        host: '127.0.0.1',
        port: smtpServer.port,
        tls: false,
        user: 'user@example.com',
        password: 'secret',
      })).resolves.toEqual({ success: true });

      await expect(port.testSmtp({
        workspaceId: WORKSPACE_A_ID,
        host: '127.0.0.1',
        port: smtpOauthServer.port,
        tls: false,
        user: 'user@example.com',
        accessToken: 'oauth-access-token',
      })).resolves.toEqual({ success: true });

      expect(imapLines).toContain('a001 LOGIN "user@example.com" "secret"');
      expect(imapLines).toContain('a002 SELECT "INBOX"');
      expect(pop3Lines).toContain('USER user@example.com');
      expect(pop3Lines).toContain('PASS secret');
      expect(pop3Lines).toContain('UIDL');
      expect(smtpLines).toContain('EHLO simplecrm.local');
      expect(smtpLines).toContain('AUTH LOGIN');
      expect(smtpLines).toContain(Buffer.from('user@example.com', 'utf8').toString('base64'));
      expect(smtpLines).toContain(Buffer.from('secret', 'utf8').toString('base64'));
      expect(smtpLines).toContain('MAIL FROM:<user@example.com>');
      expect(smtpLines).toContain('RCPT TO:<user@example.com>');
      expect(smtpLines).toContain('DATA');
      expect(smtpLines).toContain('.');
      expect(smtpOauthLines.find((line) => line.startsWith('AUTH XOAUTH2 '))).toBeTruthy();
      expect(smtpOauthPayload).toBe('user=user@example.com\u0001auth=Bearer oauth-access-token\u0001\u0001');

      await expect(port.testSmtp({
        workspaceId: WORKSPACE_A_ID,
        host: '',
        port: smtpServer.port,
        tls: false,
        user: 'user@example.com',
        password: 'secret',
      })).resolves.toEqual({
        success: false,
        error: expect.stringContaining('SMTP-Host fehlt'),
      });

      const guardedPort = createServerMailConnectionTestPort({
        timeoutMs: 1000,
        socketFactory: async () => {
          throw new Error('socket should not open for unsafe credentials');
        },
      });
      await expect(guardedPort.testPop3({
        workspaceId: WORKSPACE_A_ID,
        host: '127.0.0.1',
        port: pop3Server.port,
        tls: false,
        user: 'user@example.com\r\nDELE 1',
        password: 'secret',
      })).resolves.toEqual({
        success: false,
        error: 'Benutzername darf keine Zeilenumbrueche enthalten',
      });
      await expect(guardedPort.testSmtp({
        workspaceId: WORKSPACE_A_ID,
        host: '127.0.0.1',
        port: smtpServer.port,
        tls: false,
        user: 'user@example.com',
        password: 'secret\r\nRSET',
      })).resolves.toEqual({
        success: false,
        error: 'Passwort darf keine Zeilenumbrueche enthalten',
      });
    } finally {
      await imapServer.close();
      await pop3Server.close();
      await smtpServer.close();
      await smtpOauthServer.close();
    }
  });

  test('server SMTP sender performs authenticated DATA delivery with dot-stuffing', async () => {
    const smtpLines: string[] = [];
    let inData = false;
    const smtpServer = await startLineServer((line, socket) => {
      smtpLines.push(line);
      if (inData) {
        if (line === '.') {
          inData = false;
          socket.write('250 2.0.0 queued\r\n');
        }
        return;
      }
      if (line === 'EHLO simplecrm.local') socket.write('250-localhost\r\n250-AUTH PLAIN LOGIN\r\n250 OK\r\n');
      else if (line.startsWith('AUTH PLAIN ')) socket.write('235 2.7.0 Authentication successful\r\n');
      else if (line === 'MAIL FROM:<agent@example.com>') socket.write('250 sender ok\r\n');
      else if (line === 'RCPT TO:<sender@example.com>') socket.write('250 recipient ok\r\n');
      else if (line === 'DATA') {
        inData = true;
        socket.write('354 end with dot\r\n');
      } else if (line === 'QUIT') socket.write('221 bye\r\n');
      else socket.write('500 unknown command\r\n');
    }, '220 SMTP ready\r\n');

    try {
      await sendSmtpMessage({
        host: '127.0.0.1',
        port: smtpServer.port,
        tls: false,
        user: 'agent@example.com',
        password: 'secret',
        envelopeFrom: 'agent@example.com',
        recipients: ['sender@example.com'],
        rfc822: [
          'From: Agent <agent@example.com>',
          'To: sender@example.com',
          'Subject: Test',
          '',
          '.leading dot',
        ].join('\r\n'),
        timeoutMs: 1000,
      });
    } finally {
      await smtpServer.close();
    }

    expect(smtpLines).toContain('EHLO simplecrm.local');
    expect(smtpLines.find((line) => line.startsWith('AUTH PLAIN '))).toBeTruthy();
    expect(smtpLines).toContain('MAIL FROM:<agent@example.com>');
    expect(smtpLines).toContain('RCPT TO:<sender@example.com>');
    expect(smtpLines).toContain('DATA');
    expect(smtpLines).toContain('..leading dot');
    expect(smtpLines).toContain('.');

    await expect(sendSmtpMessage({
      host: '127.0.0.1',
      port: smtpServer.port,
      tls: false,
      user: 'agent@example.com\r\nRSET',
      password: 'secret',
      envelopeFrom: 'agent@example.com',
      recipients: ['sender@example.com'],
      rfc822: 'Subject: unsafe\r\n\r\nbody',
      timeoutMs: 1000,
      socketFactory: async () => {
        throw new Error('socket should not open for unsafe credentials');
      },
    })).rejects.toThrow('Benutzername enthaelt ungueltige Zeilenumbrueche');
  });

  test('server SMTP sender supports XOAUTH2 access-token authentication', async () => {
    const smtpLines: string[] = [];
    let authPayload = '';
    let inData = false;
    const smtpServer = await startLineServer((line, socket) => {
      smtpLines.push(line);
      if (inData) {
        if (line === '.') {
          inData = false;
          socket.write('250 2.0.0 queued\r\n');
        }
        return;
      }
      if (line === 'EHLO simplecrm.local') socket.write('250-localhost\r\n250-AUTH XOAUTH2\r\n250 OK\r\n');
      else if (line.startsWith('AUTH XOAUTH2 ')) {
        authPayload = Buffer.from(line.slice('AUTH XOAUTH2 '.length), 'base64').toString('utf8');
        socket.write('235 2.7.0 Authentication successful\r\n');
      } else if (line === 'MAIL FROM:<agent@example.com>') socket.write('250 sender ok\r\n');
      else if (line === 'RCPT TO:<sender@example.com>') socket.write('250 recipient ok\r\n');
      else if (line === 'DATA') {
        inData = true;
        socket.write('354 end with dot\r\n');
      } else if (line === 'QUIT') socket.write('221 bye\r\n');
      else socket.write('500 unknown command\r\n');
    }, '220 SMTP ready\r\n');

    try {
      await sendSmtpMessage({
        host: '127.0.0.1',
        port: smtpServer.port,
        tls: false,
        user: 'agent@example.com',
        accessToken: 'oauth-access-token',
        envelopeFrom: 'agent@example.com',
        recipients: ['sender@example.com'],
        rfc822: 'Subject: Test\r\n\r\nBody',
        timeoutMs: 1000,
      });
    } finally {
      await smtpServer.close();
    }

    expect(smtpLines.find((line) => line.startsWith('AUTH XOAUTH2 '))).toBeTruthy();
    expect(authPayload).toBe('user=agent@example.com\u0001auth=Bearer oauth-access-token\u0001\u0001');
    expect(smtpLines).toContain('MAIL FROM:<agent@example.com>');
    expect(smtpLines).toContain('RCPT TO:<sender@example.com>');
  });

  test('server IMAP sent-copy appender stores RFC822 in resolved sent mailbox', async () => {
    const clientOptions: unknown[] = [];
    const writtenSecrets: unknown[] = [];
    const client = {
      connect: jest.fn().mockResolvedValue(undefined),
      list: jest.fn().mockResolvedValue([
        {
          path: 'INBOX/Gesendet',
          name: 'Gesendet',
          delimiter: '/',
          specialUse: '\\Sent',
          flags: new Set(['\\Sent']),
        },
      ]),
      mailboxOpen: jest.fn().mockResolvedValue(undefined),
      append: jest.fn().mockResolvedValue({ uid: 123 }),
      logout: jest.fn().mockResolvedValue(undefined),
    };
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      json: async () => ({
        access_token: 'access-token',
        refresh_token: 'refresh-token-rotated',
        expires_in: 3600,
      }),
    })) as unknown as typeof fetch;
    const appender = createServerImapSentCopyAppenderPort({
      oauthFetchImpl: fetchImpl,
      imapClientFactory(input) {
        clientOptions.push(input);
        return client;
      },
      store: {
        async getAccount(input) {
          return input.accountId === 7
            ? {
              id: 7,
              protocol: 'imap',
              imapHost: 'imap.example.com',
              imapPort: 993,
              imapTls: true,
              imapUsername: 'agent@example.com',
              oauthProvider: 'microsoft',
              sentFolderPath: 'Sent',
            }
            : null;
        },
        async readSecret(input) {
          return input.kind === 'email.account.oauth_refresh_token'
            ? Buffer.from('refresh-token-1')
            : null;
        },
        async writeSecret(input) {
          writtenSecrets.push(input);
        },
        async getSyncInfo(input) {
          return new Map(input.keys.map((key) => [
            key,
            key === 'email_ms_oauth_client_id'
              ? 'client-id'
              : key === 'email_ms_oauth_client_secret'
                ? 'client-secret'
                : null,
          ]));
        },
      },
    });

    const source = 'Subject: Test\r\n\r\nBody';
    await expect(appender.append({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      rfc822: source,
    })).resolves.toEqual({
      ok: true,
      mailbox: 'INBOX/Gesendet',
    });

    expect(clientOptions[0]).toMatchObject({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      auth: { user: 'agent@example.com', accessToken: 'access-token' },
    });
    expect(client.append).toHaveBeenCalledWith('INBOX/Gesendet', Buffer.from(source, 'utf8'), ['\\Seen']);
    expect(writtenSecrets).toEqual([
      expect.objectContaining({
        workspaceId: WORKSPACE_A_ID,
        kind: 'email.account.oauth_refresh_token',
        name: 'email_account:7:oauth_refresh',
        value: 'refresh-token-rotated',
      }),
    ]);

    const small = imapTimeoutsForMessageBytes(100_000);
    const large = imapTimeoutsForMessageBytes(12 * 1024 * 1024);
    expect(large.socketTimeout).toBeGreaterThan(small.socketTimeout);
    expect(large.connectionTimeout).toBeGreaterThan(small.connectionTimeout);
  });

  test('server workflow IMAP action port moves and deletes messages through locked source folders', async () => {
    const clientOptions: unknown[] = [];
    const actions: unknown[] = [];
    const releases: string[] = [];
    const client = {
      connect: jest.fn().mockResolvedValue(undefined),
      getMailboxLock: jest.fn(async (path: string) => {
        actions.push(['lock', path]);
        return { release: () => releases.push(path) };
      }),
      messageMove: jest.fn(async (range, target, options) => {
        actions.push(['move', range, target, options]);
      }),
      messageDelete: jest.fn(async (range, options) => {
        actions.push(['delete', range, options]);
      }),
      messageFlagsAdd: jest.fn(async (range, flags, options) => {
        actions.push(['flagsAdd', range, flags, options]);
      }),
      messageFlagsRemove: jest.fn(async (range, flags, options) => {
        actions.push(['flagsRemove', range, flags, options]);
      }),
      logout: jest.fn().mockResolvedValue(undefined),
    };
    const port = createServerWorkflowImapActionPort({
      imapClientFactory(input) {
        clientOptions.push(input);
        return client;
      },
      store: {
        async getMessage(input) {
          return input.messageId === 90
            ? {
              id: 90,
              accountId: 7,
              folderId: 5,
              uid: 321,
              pop3Uidl: null,
              folderKind: 'inbox',
            }
            : null;
        },
        async getAccount(input) {
          return input.accountId === 7
            ? {
              id: 7,
              protocol: 'imap',
              imapHost: 'imap.example.com',
              imapPort: 993,
              imapTls: true,
              imapUsername: 'agent@example.com',
              oauthProvider: null,
            }
            : null;
        },
        async getFolder(input) {
          return input.folderId === 5
            ? { id: 5, path: 'INBOX' }
            : null;
        },
        async readSecret(input) {
          return input.kind === 'email.account.imap_password'
            ? Buffer.from('imap-password')
            : null;
        },
        async getSyncInfo(input) {
          return new Map(input.keys.map((key) => [key, key === 'workflow_imap_delete_opt_in' ? 'true' : null]));
        },
      },
    });

    await expect(port.move({
      workspaceId: WORKSPACE_A_ID,
      messageId: 90,
      targetFolderPath: 'Spam',
    })).resolves.toEqual({
      ok: true,
      sourceFolderPath: 'INBOX',
      targetFolderPath: 'Spam',
    });
    await expect(port.delete({
      workspaceId: WORKSPACE_A_ID,
      messageId: 90,
    })).resolves.toEqual({
      ok: true,
      sourceFolderPath: 'INBOX',
    });
    await expect(port.setSeen({
      workspaceId: WORKSPACE_A_ID,
      messageId: 90,
      seen: true,
    })).resolves.toEqual({
      ok: true,
      sourceFolderPath: 'INBOX',
    });
    await expect(port.setSeen({
      workspaceId: WORKSPACE_A_ID,
      messageId: 90,
      seen: false,
    })).resolves.toEqual({
      ok: true,
      sourceFolderPath: 'INBOX',
    });

    expect(clientOptions).toHaveLength(4);
    expect(clientOptions[0]).toMatchObject({
      host: 'imap.example.com',
      port: 993,
      secure: true,
      auth: { user: 'agent@example.com', pass: 'imap-password' },
    });
    expect(actions).toEqual([
      ['lock', 'INBOX'],
      ['move', { uid: 321 }, 'Spam', { uid: true }],
      ['lock', 'INBOX'],
      ['delete', { uid: 321 }, { uid: true }],
      ['lock', 'INBOX'],
      ['flagsAdd', { uid: 321 }, ['\\Seen'], { uid: true }],
      ['lock', 'INBOX'],
      ['flagsRemove', { uid: 321 }, ['\\Seen'], { uid: true }],
    ]);
    expect(releases).toEqual(['INBOX', 'INBOX', 'INBOX', 'INBOX']);
    expect(client.logout).toHaveBeenCalledTimes(4);
  });

  test('server compose sender sends SMTP and finalizes local drafts', async () => {
    const smtpSends: unknown[] = [];
    const updates: unknown[] = [];
    const pgpPrepareCalls: unknown[] = [];
    const pgpPrepareAttachmentCalls: unknown[] = [];
    const syncInfo = new Map<string, string | null>();
    let locked = false;
    const attachmentRoot = mkdtempSync(join(tmpdir(), 'server-compose-attach-'));
    const attachmentPath = join(attachmentRoot, 'invoice.pdf');
    writeFileSync(attachmentPath, 'invoice bytes');
    const draft = {
      id: 44,
      accountId: 7,
      uid: -44,
      folderKind: 'draft',
      subject: 'Antwort',
      bodyText: 'Hallo',
      bodyHtml: '<p>Hallo</p>',
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
      protocol: 'imap',
      requestReadReceipt: false,
    };
    const parent = {
      id: 11,
      messageIdHeader: '<parent@example.com>',
      referencesHeader: '<root@example.com>',
      ticketCode: 'SCR-ABCDEF',
      threadId: 'th-parent',
    };
    const sender = createEmailComposeSenderPort({
      attachmentsRoot: attachmentRoot,
      now: () => new Date('2026-07-03T08:05:00.000Z'),
      smtpSend: async (input) => {
        smtpSends.push(input);
      },
      pgpMessages: {
        async prepareOutboundBody(input) {
          pgpPrepareCalls.push(input);
          return {
            ok: true,
            bodyText: '-----BEGIN PGP MESSAGE-----\nprepared\n-----END PGP MESSAGE-----',
          };
        },
        async prepareOutboundAttachments(input) {
          pgpPrepareAttachmentCalls.push(input);
          return {
            ok: true,
            attachments: input.attachments.map((attachment) => ({
              filename: `${attachment.filename}.pgp`,
              contentType: 'application/pgp-encrypted',
              content: Buffer.from(`encrypted ${attachment.filename}`),
            })),
          };
        },
      },
      store: {
        async getDraft(input) {
          return input.messageId === 44 ? draft : null;
        },
        async getAccount(input) {
          return input.accountId === 7 ? account : null;
        },
        async getParentMessage(input) {
          return input.messageId === 11 ? parent : null;
        },
        async getOrCreateThreadForTicket() {
          throw new Error('parent thread should be reused');
        },
        async readSecret(input) {
          return input.kind === 'email.account.smtp_password' ? Buffer.from('smtp-secret') : null;
        },
        async getSyncInfo(input) {
          return new Map(input.keys.map((key) => [key, syncInfo.get(key) ?? null]));
        },
        async setSyncInfo(input) {
          updates.push(['setSyncInfo', input]);
          for (const [key, value] of Object.entries(input.values)) syncInfo.set(key, value);
        },
        async deleteSyncInfo(input) {
          updates.push(['deleteSyncInfo', input]);
          for (const key of input.keys) syncInfo.delete(key);
        },
        async claimSmtpOutbox(input) {
          const key = `email_compose_smtp_ok:${input.messageId}`;
          const existing = syncInfo.get(key);
          if (existing === '1' || existing === 'sent') return 'committed';
          if (existing === 'outbox') return 'outbox';
          syncInfo.set(key, 'outbox');
          updates.push(['claimSmtpOutbox', input]);
          return 'claimed';
        },
        async tryAcquireSendingLock() {
          if (locked) return false;
          locked = true;
          return true;
        },
        async releaseSendingLock(input) {
          updates.push(['releaseSendingLock', input]);
          locked = false;
        },
        async updateDraftForSend(input) {
          updates.push(['updateDraftForSend', input]);
        },
        async markDraftAsSent(input) {
          updates.push(['markDraftAsSent', input]);
        },
        async markMessageDone(input) {
          updates.push(['markMessageDone', input]);
        },
      },
    });

    await expect(sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 44,
        subject: 'Antwort',
        bodyText: 'Hallo',
        bodyHtml: '<p>Hallo</p>',
        to: 'Kunde <customer+shop@Example.com>',
        cc: 'cc@example.com',
        bcc: 'hidden@example.com',
        inReplyToMessageId: 11,
        markReplyParentDone: true,
        requestReadReceipt: true,
      },
    })).resolves.toMatchObject({
      ok: true,
      messageId: 44,
      accountId: 7,
      warning: expect.stringContaining('IMAP APPEND'),
    });

    expect(smtpSends).toHaveLength(1);
    expect(smtpSends[0]).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      tls: true,
      user: 'smtp-agent@example.com',
      password: 'smtp-secret',
      envelopeFrom: 'agent@example.com',
      recipients: ['customer@example.com', 'cc@example.com', 'hidden@example.com'],
    });
    const rfc822 = (smtpSends[0] as { rfc822: string }).rfc822;
    expect(rfc822).toContain('From: Support <agent@example.com>');
    expect(rfc822).toContain('To: customer@example.com');
    expect(rfc822).toContain('Cc: cc@example.com');
    expect(rfc822).not.toContain('hidden@example.com');
    expect(rfc822).toContain('Subject: [SCR-ABCDEF] Antwort');
    expect(rfc822).toContain('In-Reply-To: <parent@example.com>');
    expect(rfc822).toContain('References: <root@example.com> <parent@example.com>');
    expect(rfc822).toContain('Disposition-Notification-To: Support <agent@example.com>');
    expect(rfc822).toContain('Content-Type: multipart/alternative;');

    expect(updates).toEqual([
      ['updateDraftForSend', expect.objectContaining({
        workspaceId: WORKSPACE_A_ID,
        messageId: 44,
        subject: '[SCR-ABCDEF] Antwort',
        bodyText: 'Hallo',
        bodyHtml: '<p>Hallo</p>',
        toJson: { value: [{ address: 'customer@example.com' }] },
        ccJson: { value: [{ address: 'cc@example.com' }] },
        bccJson: { value: [{ address: 'hidden@example.com' }] },
        ticketCode: 'SCR-ABCDEF',
        threadId: 'th-parent',
        inReplyTo: '<parent@example.com>',
        references: '<root@example.com> <parent@example.com>',
      })],
      ['claimSmtpOutbox', {
        workspaceId: WORKSPACE_A_ID,
        messageId: 44,
      }],
      ['setSyncInfo', {
        workspaceId: WORKSPACE_A_ID,
        values: { 'email_compose_smtp_ok:44': 'sent' },
      }],
      ['markDraftAsSent', {
        workspaceId: WORKSPACE_A_ID,
        messageId: 44,
        sentImapSyncFailed: true,
      }],
      ['deleteSyncInfo', {
        workspaceId: WORKSPACE_A_ID,
        keys: ['email_compose_smtp_ok:44'],
      }],
      ['setSyncInfo', {
        workspaceId: WORKSPACE_A_ID,
        values: { 'compose_mark_parent_done:44': '1' },
      }],
      ['markMessageDone', {
        workspaceId: WORKSPACE_A_ID,
        messageId: 11,
        done: true,
      }],
      ['releaseSendingLock', {
        workspaceId: WORKSPACE_A_ID,
        messageId: 44,
      }],
    ]);

    smtpSends.length = 0;
    updates.length = 0;
    await expect(sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 44,
        subject: 'Antwort',
        bodyText: 'Hallo',
        to: 'customer@example.com',
        inReplyToMessageId: 11,
        attachmentPaths: ['invoice.pdf'],
      },
    })).resolves.toMatchObject({
      ok: true,
      messageId: 44,
      accountId: 7,
    });
    const attachmentRfc822 = (smtpSends[0] as { rfc822: string }).rfc822;
    expect(attachmentRfc822).toContain('Content-Type: multipart/mixed;');
    expect(attachmentRfc822).toContain('Content-Disposition: attachment');
    expect(attachmentRfc822).toContain('invoice.pdf');
    expect(attachmentRfc822).toContain('aW52b2ljZSBieXRlcw==');

    smtpSends.length = 0;
    updates.length = 0;
    pgpPrepareCalls.length = 0;
    pgpPrepareAttachmentCalls.length = 0;
    await expect(sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 44,
        subject: 'PGP Attachment',
        bodyText: 'Secret text',
        bodyHtml: null,
        to: 'customer@example.com',
        inReplyToMessageId: 11,
        attachmentPaths: ['invoice.pdf'],
        pgpEncrypt: true,
      },
    })).resolves.toMatchObject({
      ok: true,
      messageId: 44,
      accountId: 7,
    });
    expect(pgpPrepareAttachmentCalls).toEqual([expect.objectContaining({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      recipientEmails: ['customer@example.com'],
      encrypt: true,
      attachments: [expect.objectContaining({
        filename: 'invoice.pdf',
        bytes: expect.any(Buffer),
      })],
    })]);
    expect(pgpPrepareCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      bodyText: 'Secret text',
      recipientEmails: ['customer@example.com'],
      encrypt: true,
      sign: undefined,
    }]);
    const pgpAttachmentRfc822 = (smtpSends[0] as { rfc822: string }).rfc822;
    expect(pgpAttachmentRfc822).toContain('invoice.pdf.pgp');
    expect(pgpAttachmentRfc822).toContain('application/pgp-encrypted');
    expect(pgpAttachmentRfc822).toContain('ZW5jcnlwdGVkIGludm9pY2UucGRm');
    expect(pgpAttachmentRfc822).not.toContain('aW52b2ljZSBieXRlcw==');

    smtpSends.length = 0;
    updates.length = 0;
    await expect(sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 44,
        subject: 'Antwort',
        bodyText: 'Hallo',
        to: 'customer@example.com',
        attachmentPaths: ['../outside.pdf'],
      },
    })).resolves.toEqual({
      ok: false,
      error: 'Anhang liegt ausserhalb des Server-Anhangspeichers',
    });
    rmSync(attachmentRoot, { recursive: true, force: true });

    smtpSends.length = 0;
    updates.length = 0;
    pgpPrepareCalls.length = 0;
    await expect(sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 44,
        subject: 'PGP',
        bodyText: 'Secret text',
        bodyHtml: null,
        to: 'Kunde <customer@example.com>',
        cc: 'cc@example.com',
        inReplyToMessageId: 11,
        pgpEncrypt: true,
        pgpSign: true,
        pgpPassphrase: ' passphrase with spaces ',
      },
    })).resolves.toMatchObject({
      ok: true,
      messageId: 44,
      accountId: 7,
    });
    expect(pgpPrepareCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      bodyText: 'Secret text',
      recipientEmails: ['customer@example.com', 'cc@example.com'],
      encrypt: true,
      sign: true,
      passphrase: ' passphrase with spaces ',
    }]);
    expect(updates[0]).toEqual(['updateDraftForSend', expect.objectContaining({
      bodyText: '-----BEGIN PGP MESSAGE-----\nprepared\n-----END PGP MESSAGE-----',
      bodyHtml: null,
    })]);
    const pgpRfc822 = (smtpSends[0] as { rfc822: string }).rfc822;
    expect(pgpRfc822).toContain('-----BEGIN PGP MESSAGE-----');
    expect(pgpRfc822).not.toContain('Content-Type: multipart/alternative;');

    smtpSends.length = 0;
    updates.length = 0;
    pgpPrepareCalls.length = 0;
    await expect(sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 44,
        subject: 'PGP HTML',
        bodyText: '',
        bodyHtml: '<p>Secret <strong>text</strong><br>Line&nbsp;2 &amp; more</p>',
        to: 'customer@example.com',
        inReplyToMessageId: 11,
        pgpEncrypt: true,
      },
    })).resolves.toMatchObject({
      ok: true,
      messageId: 44,
      accountId: 7,
    });
    expect(pgpPrepareCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      bodyText: 'Secret text\nLine 2 & more',
      recipientEmails: ['customer@example.com'],
      encrypt: true,
      sign: undefined,
    }]);
    expect(updates[0]).toEqual(['updateDraftForSend', expect.objectContaining({
      bodyText: '-----BEGIN PGP MESSAGE-----\nprepared\n-----END PGP MESSAGE-----',
      bodyHtml: null,
    })]);
    const pgpHtmlRfc822 = (smtpSends[0] as { rfc822: string }).rfc822;
    expect(pgpHtmlRfc822).toContain('-----BEGIN PGP MESSAGE-----');
    expect(pgpHtmlRfc822).not.toContain('Content-Type: multipart/alternative;');
    expect(pgpHtmlRfc822).not.toContain('text/html');
    expect(pgpHtmlRfc822).not.toContain('<strong>');
  });

  test('server compose sender blocks before SMTP when outbound review is pending', async () => {
    const smtpSend = jest.fn();
    const reviews: unknown[] = [];
    const updates: unknown[] = [];
    let locked = false;
    const sender = createEmailComposeSenderPort({
      now: () => new Date('2026-07-03T08:05:00.000Z'),
      smtpSend,
      outboundReview: {
        async review(input) {
          reviews.push(input);
          return {
            allowed: false,
            error: 'Ausgangspruefung wird serverseitig ausgefuehrt',
            workflowRunId: 901,
          };
        },
      },
      store: {
        async getDraft(input) {
          return input.messageId === 46
            ? {
              id: 46,
              accountId: 7,
              uid: -46,
              folderKind: 'draft',
              subject: 'Pruefung',
              bodyText: 'Bitte pruefen',
              bodyHtml: '<p>Bitte pruefen</p>',
              messageIdHeader: null,
              inReplyToHeader: null,
              referencesHeader: null,
              ticketCode: null,
              threadId: null,
              draftAttachmentPathsJson: null,
              outboundHold: true,
              outboundBlockReason: 'alter Hold',
            }
            : null;
        },
        async getAccount(input) {
          return input.accountId === 7
            ? {
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
              protocol: 'imap',
              requestReadReceipt: false,
            }
            : null;
        },
        async getParentMessage() {
          return null;
        },
        async getOrCreateThreadForTicket() {
          return 'th-review';
        },
        async readSecret() {
          throw new Error('SMTP auth must not be resolved when outbound review blocks');
        },
        async getSyncInfo(input) {
          return new Map(input.keys.map((key) => [key, null]));
        },
        async setSyncInfo(input) {
          updates.push(['setSyncInfo', input]);
        },
        async deleteSyncInfo(input) {
          updates.push(['deleteSyncInfo', input]);
        },
        async claimSmtpOutbox(input) {
          updates.push(['claimSmtpOutbox', input]);
          return 'claimed';
        },
        async tryAcquireSendingLock() {
          if (locked) return false;
          locked = true;
          return true;
        },
        async releaseSendingLock(input) {
          updates.push(['releaseSendingLock', input]);
          locked = false;
        },
        async updateDraftForSend(input) {
          updates.push(['updateDraftForSend', input]);
        },
        async markDraftAsSent(input) {
          updates.push(['markDraftAsSent', input]);
        },
        async markMessageDone(input) {
          updates.push(['markMessageDone', input]);
        },
      },
    });

    await expect(sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 46,
        subject: 'Pruefung',
        bodyText: 'Bitte pruefen',
        bodyHtml: '<p>Bitte pruefen</p>',
        to: 'kunde@example.com',
      },
    })).resolves.toEqual({
      ok: false,
      error: 'Ausgangspruefung wird serverseitig ausgefuehrt',
      workflowRunId: 901,
    });

    expect(smtpSend).not.toHaveBeenCalled();
    expect(reviews).toEqual([
      expect.objectContaining({
        workspaceId: WORKSPACE_A_ID,
        actorUserId: USER_A_ID,
        draftMessageId: 46,
        subject: expect.stringMatching(/Pruefung$/),
        bodyText: 'Bitte pruefen',
        bodyHtml: '<p>Bitte pruefen</p>',
        to: 'kunde@example.com',
        attachmentCount: 0,
      }),
    ]);
    expect(updates).toContainEqual(['updateDraftForSend', expect.objectContaining({
      workspaceId: WORKSPACE_A_ID,
      messageId: 46,
      bodyText: 'Bitte pruefen',
      bodyHtml: '<p>Bitte pruefen</p>',
    })]);
    expect(updates).toContainEqual(['releaseSendingLock', {
      workspaceId: WORKSPACE_A_ID,
      messageId: 46,
    }]);
  });

  test('server compose sender clears sent-copy failure after successful IMAP APPEND', async () => {
    const smtpSends: unknown[] = [];
    const sentCopies: unknown[] = [];
    const updates: unknown[] = [];
    let locked = false;
    const sender = createEmailComposeSenderPort({
      now: () => new Date('2026-07-03T08:05:00.000Z'),
      smtpSend: async (input) => {
        smtpSends.push(input);
      },
      sentCopyAppend: async (input) => {
        sentCopies.push(input);
        return { ok: true, mailbox: 'INBOX/Gesendet' };
      },
      store: {
        async getDraft(input) {
          return input.messageId === 45
            ? {
              id: 45,
              accountId: 7,
              uid: -45,
              folderKind: 'draft',
              subject: 'Neue Frage',
              bodyText: 'Hallo',
              bodyHtml: null,
              messageIdHeader: '<draft@example.com>',
              inReplyToHeader: null,
              referencesHeader: null,
              ticketCode: null,
              threadId: null,
              draftAttachmentPathsJson: null,
              outboundHold: false,
              outboundBlockReason: null,
            }
            : null;
        },
        async getAccount(input) {
          return input.accountId === 7
            ? {
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
              protocol: 'imap',
              requestReadReceipt: false,
            }
            : null;
        },
        async getParentMessage() {
          return null;
        },
        async getOrCreateThreadForTicket() {
          return 'th-new';
        },
        async readSecret(input) {
          return input.kind === 'email.account.smtp_password' ? Buffer.from('smtp-secret') : null;
        },
        async getSyncInfo(input) {
          return new Map(input.keys.map((key) => [key, null]));
        },
        async setSyncInfo(input) {
          updates.push(['setSyncInfo', input]);
        },
        async deleteSyncInfo(input) {
          updates.push(['deleteSyncInfo', input]);
        },
        async claimSmtpOutbox(input) {
          updates.push(['claimSmtpOutbox', input]);
          return 'claimed';
        },
        async tryAcquireSendingLock() {
          if (locked) return false;
          locked = true;
          return true;
        },
        async releaseSendingLock(input) {
          updates.push(['releaseSendingLock', input]);
          locked = false;
        },
        async updateDraftForSend(input) {
          updates.push(['updateDraftForSend', input]);
        },
        async markDraftAsSent(input) {
          updates.push(['markDraftAsSent', input]);
        },
        async markMessageDone(input) {
          updates.push(['markMessageDone', input]);
        },
      },
    });

    const result = await sender.send({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      values: {
        accountId: 7,
        draftMessageId: 45,
        subject: 'Neue Frage',
        bodyText: 'Hallo',
        to: 'kunde@example.com',
      },
    });

    expect(result).toMatchObject({
      ok: true,
      messageId: 45,
      accountId: 7,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.warning).toBeUndefined();
    expect(smtpSends).toHaveLength(1);
    expect(sentCopies).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        accountId: 7,
        rfc822: (smtpSends[0] as { rfc822: string }).rfc822,
        estimatedBytes: Buffer.byteLength((smtpSends[0] as { rfc822: string }).rfc822, 'utf8'),
      },
    ]);
    expect(updates).toContainEqual(['markDraftAsSent', {
      workspaceId: WORKSPACE_A_ID,
      messageId: 45,
      sentImapSyncFailed: false,
    }]);
  });

});
