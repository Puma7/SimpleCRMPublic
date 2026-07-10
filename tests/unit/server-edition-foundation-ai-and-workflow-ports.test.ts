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

describe('server edition foundation — ai-and-workflow-ports', () => {
  test('postgres AI agent port uses knowledge context and resumes workflows', async () => {
    const now = new Date('2026-06-03T12:30:00.000Z');
    const { db, rows } = makeAiReplySuggestionDb({
      messages: [{
        id: 14,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 140,
        account_id: 7,
        subject: 'Retoure',
        from_json: { value: [{ address: 'max@example.com' }] },
        to_json: { value: [{ address: 'support@example.com' }] },
        cc_json: null,
        snippet: 'Wie funktioniert die Retoure?',
        body_text: 'Bitte erklaere die Retoure.',
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
      accounts: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 7,
      }],
      folders: [{
        id: 70,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 700,
        account_id: 7,
        path: 'INBOX',
      }],
      knowledgeChunks: [
        {
          id: 1,
          workspace_id: WORKSPACE_A_ID,
          knowledge_base_id: 5,
          title: 'Retoure',
          content: 'Retoure innerhalb von 30 Tagen moeglich.',
        },
        {
          id: 2,
          workspace_id: WORKSPACE_A_ID,
          knowledge_base_id: 5,
          title: 'Versand',
          content: 'Standardversand dauert zwei Tage.',
        },
      ],
    });
    const chatInputs: unknown[] = [];
    const secrets = {
      async readSecret() {
        return Buffer.from('sk-test');
      },
    } as any;
    const port = createPostgresAiAgentPort({
      db,
      secrets,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      async chatCompletion(input) {
        chatInputs.push(input);
        return 'Antwort aus Agent';
      },
    });

    await port.runAgent({
      workspaceId: WORKSPACE_A_ID,
      messageId: 14,
      profileId: 21,
      systemPrompt: 'Agent fuer {{subject}}',
      knowledgeBaseId: 5,
      createDraft: false,
      continuation: {
        workflowId: 26,
        triggerName: 'inbound',
        resumeNodeId: 'tag-1',
        eventVariables: { 'message.id': 14 },
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
      workflowId: 26,
      messageId: 14,
      triggerName: 'inbound',
      context: {
        resumeNodeId: 'tag-1',
        eventStrings: {},
        eventVariables: {
          'message.id': 14,
          'ai.agent.response': 'Antwort aus Agent',
          'ai.agent.sources': 'Retoure',
          'ai.agent.source_count': 1,
        },
      },
    });
    expect((chatInputs[0] as any).system).toBe('Agent fuer Retoure');
    expect((chatInputs[0] as any).user).toContain('Bitte erklaere die Retoure.');
    expect((chatInputs[0] as any).user).toContain('Retoure innerhalb von 30 Tagen moeglich.');

    await port.runAgent({
      workspaceId: WORKSPACE_A_ID,
      messageId: 14,
      systemPrompt: 'Agent',
      createDraft: true,
      continuation: {
        workflowId: 26,
        triggerName: 'inbound',
        resumeNodeId: 'tag-2',
      },
    });

    expect(rows.messages).toContainEqual(expect.objectContaining({
      account_id: 7,
      folder_id: 70,
      uid: -1,
      folder_kind: 'draft',
      subject: 'Re: Retoure',
      body_text: 'Antwort aus Agent',
    }));
    expect((rows.jobs[1]?.payload as any).context.eventVariables).toMatchObject({
      'ai.agent.response': 'Antwort aus Agent',
      'draft.id': 15,
    });
  });

  test('postgres AI pick-canned port chooses a canned response and resumes the workflow', async () => {
    const now = new Date('2026-06-03T12:40:00.000Z');
    const { db, rows } = makeAiReplySuggestionDb({
      messages: [{
        id: 60,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 600,
        account_id: 7,
        subject: 'Wo bleibt mein Paket',
        from_json: { value: [{ address: 'kunde@example.com' }] },
        to_json: { value: [{ address: 'support@example.com' }] },
        cc_json: null,
        snippet: 'Wo bleibt mein Paket?',
        body_text: 'Wo bleibt mein Paket?',
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
      cannedResponses: [
        { id: 101, workspace_id: WORKSPACE_A_ID, source_sqlite_id: 1010, title: 'Versandstatus', body: 'Status zu {{subject}}: unterwegs.', sort_order: 0 },
        { id: 102, workspace_id: WORKSPACE_A_ID, source_sqlite_id: 1020, title: 'Retoure', body: 'Retoure-Infos.', sort_order: 1 },
      ],
    });
    const chatInputs: any[] = [];
    const secrets = { async readSecret() { return Buffer.from('sk-test'); } } as any;
    const port = createPostgresAiPickCannedPort({
      db,
      secrets,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      async chatCompletion(input) {
        chatInputs.push(input);
        return '1';
      },
    });

    await port.pickCanned({
      workspaceId: WORKSPACE_A_ID,
      messageId: 60,
      profileId: 21,
      createDraft: false,
      continuation: { workflowId: 30, triggerName: 'inbound', resumeNodeId: 'next-1', eventVariables: { 'message.id': 60 } },
    });

    // The numbered canned list is shown to the model.
    expect(chatInputs[0].user).toContain('1. Versandstatus');
    expect(chatInputs[0].user).toContain('2. Retoure');
    // Pick "1" -> chosen canned, placeholder filled, exposed in the resumed workflow.
    expect((rows.jobs[0]?.payload as any).context.eventVariables).toMatchObject({
      'message.id': 60,
      'ai.canned.pick': 1,
      'ai.canned.id': 101,
      'ai.canned.title': 'Versandstatus',
      'ai.canned.text': 'Status zu Wo bleibt mein Paket: unterwegs.',
    });
  });

  test('postgres AI review port resumes on OK and blocks outbound on BLOCK', async () => {
    const now = new Date('2026-06-03T12:35:00.000Z');
    const { db, rows } = makeAiReplySuggestionDb({
      messages: [{
        id: 13,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 130,
        subject: 'Review',
        from_json: { value: [{ address: 'agent@example.com' }] },
        to_json: { value: [{ address: 'customer@example.com' }] },
        cc_json: null,
        snippet: 'Bitte pruefen.',
        body_text: 'Bitte pruefen.',
        has_attachments: false,
        attachments_json: null,
        outbound_hold: false,
        outbound_block_reason: null,
      }],
      prompts: [{
        id: 22,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 22,
        label: 'Review',
        user_template: 'Pruefe {{text}}',
        target: 'review',
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
    const responses = ['OK', 'BLOCK'];
    const secrets = {
      async readSecret() {
        return Buffer.from('sk-test');
      },
    } as any;
    const port = createPostgresAiReviewPort({
      db,
      secrets,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      async chatCompletion() {
        return responses.shift() ?? 'OK';
      },
    });

    await port.review({
      workspaceId: WORKSPACE_A_ID,
      messageId: 13,
      promptId: 22,
      blockKeyword: 'BLOCK',
      direction: 'outbound',
      continuation: {
        workflowId: 25,
        triggerName: 'outbound',
        resumeNodeId: 'send-1',
        eventVariables: { 'message.id': 13 },
      },
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'workflow.execute',
        workspace_id: WORKSPACE_A_ID,
        run_after: now,
      }),
    ]);
    expect((rows.jobs[0]?.payload as any).context.eventVariables).toMatchObject({
      'message.id': 13,
      'ai.review.status': 'ok',
    });

    await port.review({
      workspaceId: WORKSPACE_A_ID,
      messageId: 13,
      promptId: 22,
      blockKeyword: 'BLOCK',
      direction: 'outbound',
      continuation: {
        workflowId: 25,
        triggerName: 'outbound',
        resumeNodeId: 'send-1',
      },
    });

    expect(rows.jobs).toHaveLength(1);
    expect(rows.messages[0]).toMatchObject({
      outbound_hold: true,
      outbound_block_reason: 'KI-Pruefung: Versand blockiert',
      updated_at: now,
    });
  });

  test('postgres workflow HTTP request port validates allowlist, fetches, and resumes workflows', async () => {
    const now = new Date('2026-06-03T12:40:00.000Z');
    const { db, rows } = makeAiReplySuggestionDb({
      syncInfo: [{
        workspace_id: WORKSPACE_A_ID,
        key: 'workflow_http_allowlist',
        value: 'api.example.com',
      }],
    });
    const fetchCalls: unknown[] = [];
    const port = createPostgresWorkflowHttpRequestPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      lookup: async (hostname) => {
        expect(hostname).toBe('api.example.com');
        return [{ address: '93.184.216.34' }];
      },
      fetchImpl: async (url, init) => {
        fetchCalls.push({ url, init });
        return {
          ok: true,
          status: 201,
          async text() {
            return 'created';
          },
        };
      },
    });

    await port.request({
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
        eventVariables: { 'message.id': 11 },
      },
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]).toMatchObject({
      url: 'https://api.example.com/hook',
      init: {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{"ok":true}',
      },
    });
    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'workflow.execute',
        workspace_id: WORKSPACE_A_ID,
        run_after: now,
        max_attempts: 3,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toEqual({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      messageId: 11,
      triggerName: 'inbound',
      context: {
        resumeNodeId: 'tag-1',
        eventStrings: {},
        eventVariables: {
          'message.id': 11,
          'http.status': 201,
          'http.body': 'created',
        },
      },
    });

    await expect(port.request({
      workspaceId: WORKSPACE_A_ID,
      method: 'GET',
      url: 'https://evil.example.net/hook',
      timeoutMs: 5000,
    })).rejects.toThrow('allowlist');
  });

  test('postgres mail sync post-processor enqueues inbound reply suggestion jobs', async () => {
    const syncStartedAt = new Date('2026-07-04T09:00:00.000Z');
    const syncFinishedAt = new Date('2026-07-04T09:01:00.000Z');
    const { db } = makeMailSyncPostProcessDb({
      messages: [
        {
          id: 31,
          workspace_id: WORKSPACE_A_ID,
          account_id: 7,
          folder_kind: 'inbox',
          soft_deleted: false,
          is_spam: false,
          updated_at: new Date('2026-07-04T09:00:30.000Z'),
        },
        {
          id: 32,
          workspace_id: WORKSPACE_A_ID,
          account_id: 7,
          folder_kind: 'sent',
          soft_deleted: false,
          is_spam: false,
          updated_at: new Date('2026-07-04T09:00:30.000Z'),
        },
        {
          id: 33,
          workspace_id: WORKSPACE_A_ID,
          account_id: 8,
          folder_kind: 'inbox',
          soft_deleted: false,
          is_spam: false,
          updated_at: new Date('2026-07-04T09:00:30.000Z'),
        },
        {
          id: 34,
          workspace_id: WORKSPACE_A_ID,
          account_id: 7,
          folder_kind: 'inbox',
          soft_deleted: false,
          is_spam: false,
          updated_at: new Date('2026-07-04T08:59:59.000Z'),
        },
        {
          id: 35,
          workspace_id: WORKSPACE_A_ID,
          account_id: 7,
          folder_kind: 'inbox',
          soft_deleted: true,
          is_spam: false,
          updated_at: new Date('2026-07-04T09:00:30.000Z'),
        },
        {
          id: 36,
          workspace_id: WORKSPACE_A_ID,
          account_id: 7,
          folder_kind: 'inbox',
          soft_deleted: false,
          is_spam: true,
          updated_at: new Date('2026-07-04T09:00:30.000Z'),
        },
        {
          id: 37,
          workspace_id: WORKSPACE_B_ID,
          account_id: 7,
          folder_kind: 'inbox',
          soft_deleted: false,
          is_spam: false,
          updated_at: new Date('2026-07-04T09:00:30.000Z'),
        },
      ],
      workflows: [
        {
          id: 23,
          workspace_id: WORKSPACE_A_ID,
          trigger_name: 'inbound',
          enabled: true,
          priority: 10,
        },
        {
          id: 24,
          workspace_id: WORKSPACE_A_ID,
          trigger_name: 'inbound',
          enabled: false,
          priority: 5,
        },
        {
          id: 25,
          workspace_id: WORKSPACE_A_ID,
          trigger_name: 'outbound',
          enabled: true,
          priority: 1,
        },
      ],
    });
    const enqueued: unknown[] = [];
    const postProcess = createPostgresMailSyncPostProcessor({
      db,
      applyWorkspaceSession: async () => undefined,
      jobQueue: {
        async enqueue(input) {
          enqueued.push(input);
          return undefined;
        },
      },
    });

    await postProcess.afterSync({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      protocol: 'imap',
      actorUserId: USER_A_ID,
      syncStartedAt,
      syncFinishedAt,
      result: null,
    });

    expect(enqueued).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        type: 'ai.reply_suggestion',
        payload: {
          workspaceId: WORKSPACE_A_ID,
          messageId: 31,
          actorUserId: USER_A_ID,
          trigger: 'inbound',
          force: false,
        },
        runAfter: new Date('2026-07-04T09:02:00.000Z'),
        maxAttempts: 3,
      },
      {
        workspaceId: WORKSPACE_A_ID,
        type: 'mail.vacation.auto_reply',
        payload: {
          workspaceId: WORKSPACE_A_ID,
          messageId: 31,
          actorUserId: USER_A_ID,
        },
        runAfter: new Date('2026-07-04T09:03:00.000Z'),
        maxAttempts: 3,
      },
    ]);

    enqueued.length = 0;
    await postProcess.afterSync({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      protocol: 'pop3',
      syncStartedAt,
      syncFinishedAt,
      result: {
        replySuggestionMessageIds: [42, 42, 0],
        inboundMessageIds: [43, 44],
      },
    });

    expect(enqueued.filter((item) => (item as any).type === 'mail.spam.score')
      .map((item) => (item as any).payload.messageId)).toEqual([43, 44]);
    expect(enqueued.filter((item) => (item as any).type === 'workflow.execute')).toHaveLength(0);
    expect(enqueued.filter((item) => (item as any).type === 'ai.reply_suggestion')
      .map((item) => (item as any).payload.messageId)).toEqual([42, 43, 44]);
    expect(enqueued.filter((item) => (item as any).type === 'mail.vacation.auto_reply')
      .map((item) => (item as any).payload.messageId)).toEqual([42, 43, 44]);
  });

  test('postgres workflow inbound backfill port clears applied markers and enqueues workflow jobs', async () => {
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [
        {
          id: 23,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 230,
          trigger_name: 'inbound',
          enabled: true,
        },
        {
          id: 24,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 240,
          trigger_name: 'inbound',
          enabled: false,
        },
        {
          id: 25,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 250,
          trigger_name: 'outbound',
          enabled: true,
        },
      ],
      messages: [
        {
          id: 11,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 110,
          uid: 5,
          pop3_uidl: null,
          soft_deleted: false,
        },
        {
          id: 12,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 120,
          uid: -12,
          pop3_uidl: null,
          soft_deleted: false,
        },
        {
          id: 13,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 130,
          uid: -13,
          pop3_uidl: 'pop3-13',
          soft_deleted: false,
        },
        {
          id: 14,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 140,
          uid: 8,
          pop3_uidl: null,
          soft_deleted: true,
        },
      ],
      appliedWorkflows: [{
        id: 1,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: -1,
        message_source_sqlite_id: 110,
        workflow_source_sqlite_id: 230,
        message_id: 11,
        workflow_id: 23,
      }],
    });
    const enqueued: unknown[] = [];
    const port = createPostgresWorkflowInboundBackfillPort({
      db,
      jobQueue: {
        async enqueue(input) {
          enqueued.push(input);
        },
      },
      applyWorkspaceSession: async () => undefined,
    });

    await expect(port.backfill({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      limit: 10,
    })).resolves.toEqual({
      success: true,
      messages: 2,
      workflows: 1,
      queued: 2,
      clearedApplied: 1,
    });

    expect(rows.appliedWorkflows).toEqual([]);
    expect(enqueued).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        type: 'workflow.execute',
        payload: {
          workspaceId: WORKSPACE_A_ID,
          workflowId: 23,
          messageId: 11,
          triggerName: 'inbound',
          actorUserId: USER_A_ID,
          context: {
            workflowBackfill: true,
            forceWorkflowReapply: true,
          },
        },
        maxAttempts: 3,
      },
      {
        workspaceId: WORKSPACE_A_ID,
        type: 'workflow.execute',
        payload: {
          workspaceId: WORKSPACE_A_ID,
          workflowId: 23,
          messageId: 13,
          triggerName: 'inbound',
          actorUserId: USER_A_ID,
          context: {
            workflowBackfill: true,
            forceWorkflowReapply: true,
          },
        },
        maxAttempts: 3,
      },
    ]);
  });

  test('postgres workflow execution job port persists server-safe condition and stop runs', async () => {
    const now = new Date('2026-07-04T10:00:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 23,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 230,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            {
              id: 'cond-1',
              type: 'condition',
              data: { field: 'subject', op: 'contains', value: 'support' },
            },
            {
              id: 'stop-1',
              type: 'registry',
              data: { nodeType: 'logic.stop', config: {} },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'cond-1' },
            { id: 'edge-2', source: 'cond-1', target: 'stop-1', label: 'yes' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 11,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 110,
        subject: 'Support bitte',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Support bitte',
        body_text: 'Ich brauche Support',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      messageId: 11,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.runs).toHaveLength(1);
    expect(rows.runs[0]).toMatchObject({
      workspace_id: WORKSPACE_A_ID,
      workflow_id: 23,
      workflow_source_sqlite_id: 230,
      message_id: 11,
      message_source_sqlite_id: 110,
      direction: 'manual',
      status: 'ok',
      log_json: ['condition:subject:yes', 'stop'],
      started_at: now,
      finished_at: now,
      updated_at: now,
    });
    expect(rows.steps.map((step) => ({
      run_id: step.run_id,
      run_source_sqlite_id: step.run_source_sqlite_id,
      node_id: step.node_id,
      node_type: step.node_type,
      status: step.status,
      port: step.port,
      message: step.message,
    }))).toEqual([
      {
        run_id: 1,
        run_source_sqlite_id: -1,
        node_id: 'cond-1',
        node_type: 'condition',
        status: 'ok',
        port: 'yes',
        message: null,
      },
      {
        run_id: 1,
        run_source_sqlite_id: -1,
        node_id: 'stop-1',
        node_type: 'logic.stop',
        status: 'ok',
        port: 'default',
        message: null,
      },
    ]);
  });

  test('postgres workflow execution job port requires inbound condition gate for side-effect nodes', async () => {
    const now = new Date('2026-07-04T10:03:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [
        {
          id: 40,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 400,
          trigger_name: 'inbound',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
              { id: 'tag-direct', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'unsafe-direct' } } },
            ],
            edges: [{ id: 'edge-1', source: 'trigger-1', target: 'tag-direct' }],
          },
          execution_mode: 'graph',
        },
        {
          id: 41,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 410,
          trigger_name: 'inbound',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
              { id: 'cond-1', type: 'condition', data: { field: 'subject', op: 'contains', value: 'VIP' } },
              { id: 'tag-safe', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'vip-safe' } } },
            ],
            edges: [
              { id: 'edge-1', source: 'trigger-1', target: 'cond-1' },
              { id: 'edge-2', source: 'cond-1', target: 'tag-safe', label: 'yes' },
            ],
          },
          execution_mode: 'graph',
        },
        {
          id: 42,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 420,
          trigger_name: 'inbound',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
              {
                id: 'tag-explicit',
                type: 'registry',
                data: {
                  nodeType: 'email.tag',
                  config: { tag: 'explicit-inbound', runOnEveryInbound: true },
                },
              },
            ],
            edges: [{ id: 'edge-1', source: 'trigger-1', target: 'tag-explicit' }],
          },
          execution_mode: 'graph',
        },
      ],
      messages: [{
        id: 20,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 200,
        subject: 'VIP inbound',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'VIP inbound',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 40,
      messageId: 20,
      triggerName: 'inbound',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 41,
      messageId: 20,
      triggerName: 'inbound',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 42,
      messageId: 20,
      triggerName: 'inbound',
      context: {},
    });

    expect(rows.runs.map((run) => run.log_json)).toEqual([
      ['skip:tag-direct:no_prior_condition'],
      ['condition:subject:yes'],
      [],
    ]);
    expect(rows.tags.map((tag) => tag.tag)).toEqual(['vip-safe', 'explicit-inbound']);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      // Workflow 40: side-effect node gated off (no prior condition) — now recorded
      // as a visible "skipped" step instead of vanishing into an empty OK run.
      ['tag-direct', 'email.tag', 'skipped', 'blocked'],
      ['cond-1', 'condition', 'ok', 'yes'],
      ['tag-safe', 'email.tag', 'ok', 'default'],
      ['tag-explicit', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port skips post-sync inbound workflows for spam messages', async () => {
    const now = new Date('2026-07-04T10:05:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 44,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 440,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            { id: 'tag-1', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'should-not-run' } } },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'tag-1' }],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 22,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 220,
        subject: 'Spam',
        from_json: { value: [{ address: 'bad@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Spam',
        body_text: 'Spam',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
        is_spam: true,
        spam_status: 'spam',
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 44,
      messageId: 22,
      triggerName: 'inbound',
      context: { skipIfMessageSpamOrReview: true },
    });

    expect(rows.runs).toHaveLength(1);
    expect(rows.runs[0]).toMatchObject({
      workflow_id: 44,
      message_id: 22,
      direction: 'inbound',
      status: 'ok',
      log_json: ['skip:message_spam_or_review'],
    });
    expect(rows.steps).toEqual([]);
    expect(rows.tags).toEqual([]);
    expect(rows.appliedWorkflows).toEqual([]);
  });

  test('postgres workflow execution job port isolates trigger branch variable contexts', async () => {
    const now = new Date('2026-07-04T10:04:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 43,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 430,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            { id: 'cond-1', type: 'condition', data: { field: 'subject', op: 'contains', value: 'VIP' } },
            {
              id: 'set-flag',
              type: 'registry',
              data: { nodeType: 'logic.set_variable', config: { name: 'branch.flag', value: 'yes' } },
            },
            {
              id: 'switch-1',
              type: 'registry',
              data: { nodeType: 'logic.switch', config: { field: 'branch.flag', cases: 'yes' } },
            },
            { id: 'stop-default', type: 'registry', data: { nodeType: 'logic.stop', config: {} } },
            { id: 'tag-leak', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'leaked' } } },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'cond-1' },
            { id: 'edge-2', source: 'cond-1', target: 'set-flag', label: 'yes' },
            { id: 'edge-3', source: 'trigger-1', target: 'switch-1' },
            { id: 'edge-4', source: 'switch-1', target: 'stop-default', label: 'default' },
            { id: 'edge-5', source: 'switch-1', target: 'tag-leak', label: 'yes' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 21,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 210,
        subject: 'VIP branch',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'VIP branch',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 43,
      messageId: 21,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.tags).toEqual([]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['cond-1', 'condition', 'ok', 'yes'],
      ['set-flag', 'logic.set_variable', 'ok', 'default'],
      ['switch-1', 'logic.switch', 'ok', 'default'],
      ['stop-default', 'logic.stop', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port marks and skips already applied inbound workflows', async () => {
    const now = new Date('2026-07-04T10:05:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 23,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 230,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
          ],
          edges: [],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 11,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 110,
        account_id: 7,
        subject: 'Inbound',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Inbound',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      messageId: 11,
      triggerName: 'inbound',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      messageId: 11,
      triggerName: 'inbound',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 23,
      messageId: 11,
      triggerName: 'inbound',
      context: { forceWorkflowReapply: true },
    });

    expect(rows.appliedWorkflows).toHaveLength(1);
    expect(rows.appliedWorkflows[0]).toMatchObject({
      workspace_id: WORKSPACE_A_ID,
      message_source_sqlite_id: 110,
      workflow_source_sqlite_id: 230,
      message_id: 11,
      workflow_id: 23,
      applied_at: now,
      updated_at: now,
    });
    expect(rows.runs.map((run) => run.log_json)).toEqual([
      ['trigger_no_edges'],
      ['skip:workflow_already_applied'],
      ['trigger_no_edges'],
    ]);
  });

  test('postgres workflow execution job port branches on stored mail auth results', async () => {
    const now = new Date('2026-07-04T10:15:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 30,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 300,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            {
              id: 'auth-1',
              type: 'registry',
              data: { nodeType: 'email.auth_check', config: { protocol: 'dmarc' } },
            },
            { id: 'tag-fail', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'auth-fail' } } },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'auth-1' },
            { id: 'edge-2', source: 'auth-1', target: 'tag-fail', label: 'fail' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 18,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 180,
        subject: 'Auth',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Auth',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
        auth_spf: 'pass',
        auth_dkim: 'pass',
        auth_dmarc: 'softfail',
        auth_arc: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 30,
      messageId: 18,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.tags.map((tag) => tag.tag)).toEqual(['auth-fail']);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['auth-1', 'email.auth_check', 'ok', 'fail'],
      ['tag-fail', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port branches on sender filters from global settings and spam lists', async () => {
    const now = new Date('2026-07-04T10:20:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 31,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 310,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            {
              id: 'sender-1',
              type: 'registry',
              data: {
                nodeType: 'email.sender_filter',
                config: { useGlobalLists: true, useBuiltinTrusted: false },
              },
            },
            {
              id: 'tag-whitelist',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'sender-whitelist' } },
            },
            {
              id: 'tag-blacklist',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'sender-blacklist' } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'sender-1' },
            { id: 'edge-2', source: 'sender-1', target: 'tag-whitelist', label: 'whitelist' },
            { id: 'edge-3', source: 'sender-1', target: 'tag-blacklist', label: 'blacklist' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [
        {
          id: 19,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 190,
          subject: 'Trusted',
          from_json: { value: [{ address: 'customer@vip.trusted.example' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Trusted',
          body_text: 'Hallo',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
        },
        {
          id: 20,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 200,
          subject: 'Blocked',
          from_json: { value: [{ address: 'mailer@bad.example' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Blocked',
          body_text: 'Hallo',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
        },
      ],
      syncInfo: [{
        workspace_id: WORKSPACE_A_ID,
        key: 'workflow_sender_whitelist',
        value: 'trusted.example',
      }],
      spamListEntries: [
        {
          workspace_id: WORKSPACE_A_ID,
          list_type: 'block',
          pattern_type: 'domain',
          pattern: 'bad.example',
          account_id: null,
        },
        {
          workspace_id: WORKSPACE_A_ID,
          list_type: 'allow',
          pattern_type: 'domain',
          pattern: 'ignored-account.example',
          account_id: 77,
        },
      ],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 31,
      messageId: 19,
      triggerName: 'manual',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 31,
      messageId: 20,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.tags.map((tag) => [tag.message_id, tag.tag])).toEqual([
      [19, 'sender-whitelist'],
      [20, 'sender-blacklist'],
    ]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['sender-1', 'email.sender_filter', 'ok', 'whitelist'],
      ['tag-whitelist', 'email.tag', 'ok', 'default'],
      ['sender-1', 'email.sender_filter', 'ok', 'blacklist'],
      ['tag-blacklist', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port exposes stored spam score workflow variables', async () => {
    const now = new Date('2026-07-04T10:25:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [
        {
          id: 32,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 320,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
              {
                id: 'spam-threshold',
                type: 'registry',
                data: {
                  nodeType: 'logic.threshold',
                  config: { variable: 'spam.score', operator: 'gte', value: 99, useGlobalThreshold: true },
                },
              },
              {
                id: 'tag-stored',
                type: 'registry',
                data: { nodeType: 'email.tag', config: { tag: 'stored-spam-score' } },
              },
            ],
            edges: [
              { id: 'edge-1', source: 'trigger-1', target: 'spam-threshold' },
              { id: 'edge-2', source: 'spam-threshold', target: 'tag-stored', label: 'yes' },
            ],
          },
          execution_mode: 'graph',
        },
        {
          id: 33,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 330,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
              {
                id: 'ai-score',
                type: 'registry',
                data: { nodeType: 'ai.spam_score', config: { contextMode: 'metadata' } },
              },
              {
                id: 'ai-threshold',
                type: 'registry',
                data: { nodeType: 'logic.threshold', config: { variable: 'ai.spam_score', operator: 'gte', value: 75 } },
              },
              {
                id: 'tag-ai',
                type: 'registry',
                data: { nodeType: 'email.tag', config: { tag: 'ai-stored-spam-score' } },
              },
            ],
            edges: [
              { id: 'edge-1', source: 'trigger-1', target: 'ai-score' },
              { id: 'edge-2', source: 'ai-score', target: 'ai-threshold' },
              { id: 'edge-3', source: 'ai-threshold', target: 'tag-ai', label: 'yes' },
            ],
          },
          execution_mode: 'graph',
        },
        {
          id: 331,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 3310,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
              {
                id: 'ai-score-computed',
                type: 'registry',
                data: { nodeType: 'ai.spam_score', config: { contextMode: 'metadata' } },
              },
              {
                id: 'ai-threshold-computed',
                type: 'registry',
                data: { nodeType: 'logic.threshold', config: { variable: 'ai.spam_score', operator: 'gte', value: 75 } },
              },
              {
                id: 'tag-ai-computed',
                type: 'registry',
                data: { nodeType: 'email.tag', config: { tag: 'ai-computed-spam-score' } },
              },
            ],
            edges: [
              { id: 'edge-1', source: 'trigger-1', target: 'ai-score-computed' },
              { id: 'edge-2', source: 'ai-score-computed', target: 'ai-threshold-computed' },
              { id: 'edge-3', source: 'ai-threshold-computed', target: 'tag-ai-computed', label: 'yes' },
            ],
          },
          execution_mode: 'graph',
        },
      ],
      messages: [
        {
          id: 21,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 210,
          subject: 'Score',
          from_json: { value: [{ address: 'customer@example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Score',
          body_text: 'Hallo',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          rspamd_score: 3,
          rspamd_action: 'add header',
          spam_status: 'review',
          spam_score: 82,
          spam_score_label: 'review',
          spam_decision_source: 'local_engine',
          spam_score_breakdown_json: {
            listMatch: { listType: 'block', pattern: 'example.com' },
            reasons: [{ label: 'Domain blocklist' }],
          },
        },
        {
          id: 22,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 220,
          account_id: 7,
          subject: 'Action required',
          from_json: { value: [{ address: 'sender@bad.example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Please verify your account',
          body_text: 'Verify your account now',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          rspamd_score: null,
          rspamd_action: null,
          spam_status: null,
          spam_score: null,
          spam_score_label: null,
          spam_decision_source: null,
          spam_score_breakdown_json: null,
        },
      ],
      syncInfo: [{
        workspace_id: WORKSPACE_A_ID,
        key: 'workflow_spam_score_threshold',
        value: '80',
      }],
      spamListEntries: [{
        workspace_id: WORKSPACE_A_ID,
        list_type: 'block',
        pattern_type: 'domain',
        pattern: 'bad.example.com',
        account_id: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 32,
      messageId: 21,
      triggerName: 'manual',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 33,
      messageId: 21,
      triggerName: 'manual',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 331,
      messageId: 22,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.tags.map((tag) => tag.tag)).toEqual([
      'stored-spam-score',
      'ai-stored-spam-score',
      'ai-computed-spam-score',
    ]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['spam-threshold', 'logic.threshold', 'ok', 'yes'],
      ['tag-stored', 'email.tag', 'ok', 'default'],
      ['ai-score', 'ai.spam_score', 'ok', 'default'],
      ['ai-threshold', 'logic.threshold', 'ok', 'yes'],
      ['tag-ai', 'email.tag', 'ok', 'default'],
      ['ai-score-computed', 'ai.spam_score', 'ok', 'default'],
      ['ai-threshold-computed', 'logic.threshold', 'ok', 'yes'],
      ['tag-ai-computed', 'email.tag', 'ok', 'default'],
    ]);
    expect(rows.messages.find((message) => message.id === 22)?.spam_score).toBeNull();
    expect(rows.messages.find((message) => message.id === 22)?.spam_status).toBeNull();
  });

  test('postgres workflow execution job port creates CRM tasks for linked customers', async () => {
    const now = new Date('2026-07-04T10:28:00.000Z');
    const due = new Date('2026-07-06T10:28:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 34,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 340,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            {
              id: 'task-1',
              type: 'registry',
              data: {
                nodeType: 'crm.create_task',
                config: {
                  title: 'Rueckfrage pruefen',
                  priority: 'high',
                  daysUntilDue: 2,
                },
              },
            },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'task-1' }],
        },
        execution_mode: 'graph',
      }],
      customers: [{
        id: 501,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 9501,
      }],
      messages: [
        {
          id: 22,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 220,
          subject: 'Task',
          from_json: { value: [{ address: 'customer@example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Bitte pruefen',
          body_text: 'Hallo',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          customer_id: 501,
          customer_source_sqlite_id: 9501,
        },
        {
          id: 23,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 230,
          subject: 'No customer',
          from_json: { value: [{ address: 'unknown@example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Kein Kunde',
          body_text: 'Hallo',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          customer_id: null,
          customer_source_sqlite_id: null,
        },
      ],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 34,
      messageId: 22,
      triggerName: 'manual',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 34,
      messageId: 23,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.tasks).toEqual([
      expect.objectContaining({
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: expect.any(Number),
        customer_source_sqlite_id: 9501,
        customer_id: 501,
        title: 'Rueckfrage pruefen',
        description: 'Bitte pruefen',
        due_date: due,
        priority: 'high',
        completed: false,
        source_row: { origin: 'server_worker' },
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      }),
    ]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['task-1', 'crm.create_task', 'ok', 'default', null],
      ['task-1', 'crm.create_task', 'skipped', 'default', 'Kein Kunde verknuepft'],
    ]);
  });

  test('postgres workflow execution job port links messages to customers before CRM actions', async () => {
    const now = new Date('2026-07-04T10:28:30.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 39,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 390,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            { id: 'link-1', type: 'action', data: { actionType: 'link_customer' } },
            {
              id: 'task-1',
              type: 'registry',
              data: {
                nodeType: 'crm.create_task',
                config: {
                  title: 'Nach Link bearbeiten',
                  daysUntilDue: 1,
                },
              },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'link-1' },
            { id: 'edge-2', source: 'link-1', target: 'task-1' },
          ],
        },
        execution_mode: 'graph',
      }],
      customers: [{
        id: 601,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 9601,
        email: 'kunde@example.com',
      }],
      messages: [{
        id: 28,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 280,
        subject: 'Link',
        from_json: { value: [{ address: 'kunde+shop@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Bitte verknuepfen',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
        customer_id: null,
        customer_source_sqlite_id: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 39,
      messageId: 28,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.messages[0]).toMatchObject({
      customer_id: 601,
      customer_source_sqlite_id: 9601,
      updated_at: now,
    });
    expect(rows.tasks).toEqual([
      expect.objectContaining({
        customer_source_sqlite_id: 9601,
        customer_id: 601,
        title: 'Nach Link bearbeiten',
        description: 'Bitte verknuepfen',
        due_date: new Date('2026-07-05T10:28:30.000Z'),
        source_row: { origin: 'server_worker' },
      }),
    ]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['link-1', 'link_customer', 'ok', 'default', null],
      ['task-1', 'crm.create_task', 'ok', 'default', null],
    ]);
  });

  test('postgres workflow execution job port logs CRM activities for linked customers', async () => {
    const now = new Date('2026-07-04T10:29:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 35,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 350,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            {
              id: 'activity-1',
              type: 'registry',
              data: {
                nodeType: 'crm.log_activity',
                config: {
                  activityType: 'email',
                  title: 'Workflow log',
                },
              },
            },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'activity-1' }],
        },
        execution_mode: 'graph',
      }],
      customers: [{
        id: 501,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 9501,
      }],
      messages: [
        {
          id: 24,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 240,
          subject: 'Aktivitaet',
          from_json: { value: [{ address: 'customer@example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Log',
          body_text: 'Hallo',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          customer_id: 501,
          customer_source_sqlite_id: 9501,
        },
        {
          id: 25,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 250,
          subject: 'Ohne Kunde',
          from_json: { value: [{ address: 'unknown@example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Skip',
          body_text: 'Hallo',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          customer_id: null,
          customer_source_sqlite_id: null,
        },
      ],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 35,
      messageId: 24,
      triggerName: 'manual',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 35,
      messageId: 25,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.activityLog).toEqual([
      expect.objectContaining({
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: expect.any(Number),
        customer_source_sqlite_id: 9501,
        deal_source_sqlite_id: null,
        task_source_sqlite_id: null,
        customer_id: 501,
        deal_id: null,
        task_id: null,
        activity_type: 'email',
        title: 'Workflow log',
        description: 'Aktivitaet',
        metadata: { messageId: 24, workflowId: 35 },
        source_row: { origin: 'server_worker' },
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      }),
    ]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['activity-1', 'crm.log_activity', 'ok', 'default', null],
      ['activity-1', 'crm.log_activity', 'skipped', 'default', 'Kein Kunde verknuepft'],
    ]);
  });

  test('postgres workflow execution job port updates CRM deals and logs stage changes', async () => {
    const now = new Date('2026-07-04T10:29:30.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 36,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 360,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            {
              id: 'deal-stage',
              type: 'registry',
              data: {
                nodeType: 'crm.update_deal',
                config: {
                  dealId: 701,
                  stage: 'Qualifiziert',
                  title: 'Ignoriert bei Stage',
                },
              },
            },
            {
              id: 'deal-title',
              type: 'registry',
              data: {
                nodeType: 'crm.update_deal',
                config: {
                  dealId: 702,
                  title: 'Neuer Dealname',
                },
              },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'deal-stage' },
            { id: 'edge-2', source: 'deal-stage', target: 'deal-title' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 26,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 260,
        subject: 'Deal',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Deal',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
        customer_id: 501,
        customer_source_sqlite_id: 9501,
      }],
      deals: [
        {
          id: 701,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 9701,
          customer_id: 501,
          customer_source_sqlite_id: 9501,
          name: 'Stage Deal',
          stage: 'Interessent',
          last_modified: new Date('2026-07-01T00:00:00.000Z'),
          updated_at: new Date('2026-07-01T00:00:00.000Z'),
        },
        {
          id: 702,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 9702,
          customer_id: 501,
          customer_source_sqlite_id: 9501,
          name: 'Alter Dealname',
          stage: 'Neu',
          last_modified: new Date('2026-07-01T00:00:00.000Z'),
          updated_at: new Date('2026-07-01T00:00:00.000Z'),
        },
      ],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 36,
      messageId: 26,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.deals).toEqual([
      expect.objectContaining({
        id: 701,
        name: 'Stage Deal',
        stage: 'Qualifiziert',
        last_modified: now,
        updated_at: now,
      }),
      expect.objectContaining({
        id: 702,
        name: 'Neuer Dealname',
        stage: 'Neu',
        last_modified: now,
        updated_at: now,
      }),
    ]);
    expect(rows.activityLog).toEqual([
      expect.objectContaining({
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: expect.any(Number),
        customer_source_sqlite_id: 9501,
        deal_source_sqlite_id: 9701,
        task_source_sqlite_id: null,
        customer_id: 501,
        deal_id: 701,
        task_id: null,
        activity_type: 'stage_change',
        title: 'Deal-Phase geaendert: Interessent -> Qualifiziert',
        description: null,
        metadata: { old_stage: 'Interessent', new_stage: 'Qualifiziert' },
        source_row: { origin: 'server_worker' },
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      }),
    ]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['deal-stage', 'crm.update_deal', 'ok', 'default', null],
      ['deal-title', 'crm.update_deal', 'ok', 'default', null],
    ]);
  });

  test('postgres workflow execution job port applies server-safe email metadata nodes', async () => {
    const now = new Date('2026-07-04T10:30:00.000Z');
    const imapSeenUpdates: unknown[] = [];
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 25,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 250,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            { id: 'tag-1', type: 'action', data: { actionType: 'tag', tag: 'vip' } },
            {
              id: 'priority-1',
              type: 'registry',
              data: { nodeType: 'email.set_priority', config: { level: 'low' } },
            },
            {
              id: 'seen-1',
              type: 'registry',
              data: { nodeType: 'email.mark_seen', config: {} },
            },
            {
              id: 'archive-1',
              type: 'registry',
              data: { nodeType: 'email.archive', config: {} },
            },
            {
              id: 'assign-1',
              type: 'registry',
              data: { nodeType: 'email.assign', config: { teamMemberId: 'agent-1' } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'tag-1' },
            { id: 'edge-2', source: 'tag-1', target: 'priority-1' },
            { id: 'edge-3', source: 'priority-1', target: 'seen-1' },
            { id: 'edge-4', source: 'seen-1', target: 'archive-1' },
            { id: 'edge-5', source: 'archive-1', target: 'assign-1' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 13,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 130,
        subject: 'Bitte bearbeiten',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Bitte bearbeiten',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
        seen_local: false,
        archived: false,
        done_local: false,
        is_spam: true,
        spam_status: 'spam',
        assigned_to: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      workflowImapActions: {
        async move() {
          throw new Error('move should not be called');
        },
        async delete() {
          throw new Error('delete should not be called');
        },
        async setSeen(input) {
          imapSeenUpdates.push(input);
          return {
            ok: true as const,
            sourceFolderPath: 'INBOX',
          };
        },
      },
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 25,
      messageId: 13,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.messages[0]).toMatchObject({
      seen_local: true,
      archived: true,
      done_local: true,
      is_spam: false,
      spam_status: 'clean',
      assigned_to: 'agent-1',
      updated_at: now,
    });
    expect(imapSeenUpdates).toEqual([
      { workspaceId: WORKSPACE_A_ID, messageId: 13, seen: true },
    ]);
    expect(rows.tags.map((tag) => ({
      workspace_id: tag.workspace_id,
      message_source_sqlite_id: tag.message_source_sqlite_id,
      message_id: tag.message_id,
      tag: tag.tag,
      source_row: tag.source_row,
      created_at: tag.created_at,
      updated_at: tag.updated_at,
    }))).toEqual([
      {
        workspace_id: WORKSPACE_A_ID,
        message_source_sqlite_id: 130,
        message_id: 13,
        tag: 'vip',
        source_row: { origin: 'server_worker' },
        created_at: now,
        updated_at: now,
      },
      {
        workspace_id: WORKSPACE_A_ID,
        message_source_sqlite_id: 130,
        message_id: 13,
        tag: 'priority:niedrig',
        source_row: { origin: 'server_worker' },
        created_at: now,
        updated_at: now,
      },
    ]);
    expect(rows.runs[0]).toMatchObject({
      status: 'ok',
      log_json: [],
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['tag-1', 'tag', 'ok', 'default'],
      ['priority-1', 'email.set_priority', 'ok', 'default'],
      ['seen-1', 'email.mark_seen', 'ok', 'default'],
      ['archive-1', 'email.archive', 'ok', 'default'],
      ['assign-1', 'email.assign', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port dry-runs mutating nodes without persisted side effects', async () => {
    const now = new Date('2026-07-04T10:30:30.000Z');
    const imapSeenUpdates: unknown[] = [];
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 26,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 260,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            { id: 'tag-1', type: 'action', data: { actionType: 'tag', tag: 'vip' } },
            {
              id: 'seen-1',
              type: 'registry',
              data: { nodeType: 'email.mark_seen', config: {} },
            },
            {
              id: 'archive-1',
              type: 'registry',
              data: { nodeType: 'email.archive', config: {} },
            },
            {
              id: 'assign-1',
              type: 'registry',
              data: { nodeType: 'email.assign', config: { teamMemberId: 'agent-1' } },
            },
            {
              id: 'http-1',
              type: 'registry',
              data: {
                nodeType: 'http.request',
                config: {
                  method: 'POST',
                  url: 'https://api.example.com/hook',
                  body: '{"message":"ok"}',
                },
              },
            },
            {
              id: 'delay-1',
              type: 'registry',
              data: { nodeType: 'logic.delay', config: { minutes: 5 } },
            },
            {
              id: 'stop-1',
              type: 'registry',
              data: { nodeType: 'logic.stop', config: {} },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'tag-1' },
            { id: 'edge-2', source: 'tag-1', target: 'seen-1' },
            { id: 'edge-3', source: 'seen-1', target: 'archive-1' },
            { id: 'edge-4', source: 'archive-1', target: 'assign-1' },
            { id: 'edge-5', source: 'assign-1', target: 'http-1' },
            { id: 'edge-6', source: 'http-1', target: 'delay-1' },
            { id: 'edge-7', source: 'delay-1', target: 'stop-1' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 14,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 140,
        subject: 'Dry run',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Bitte simulieren',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
        seen_local: false,
        archived: false,
        done_local: false,
        is_spam: true,
        spam_status: 'spam',
        assigned_to: null,
      }],
    });
    const originalMessage = { ...rows.messages[0] };
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      workflowImapActions: {
        async move() {
          throw new Error('move should not be called');
        },
        async delete() {
          throw new Error('delete should not be called');
        },
        async setSeen(input) {
          imapSeenUpdates.push(input);
          return {
            ok: true as const,
            sourceFolderPath: 'INBOX',
          };
        },
      },
    });

    const result = await port.dryRun!({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 26,
      messageId: 14,
      triggerName: 'manual',
      context: {},
    });

    expect(result).toMatchObject({
      success: true,
      dryRun: true,
      workflowId: 260,
      messageId: 14,
      status: 'ok',
      blocked: false,
      blockReason: null,
    });
    expect(result.log).toEqual([
      'dry_run:server',
      'dry_run:tag',
      'dry_run:email.mark_seen',
      'dry_run:email.archive',
      'dry_run:email.assign',
      'dry_run:http.request',
      'delayed_until:2026-07-04T10:35:30.000Z',
      'stop',
    ]);
    expect(rows.messages[0]).toEqual(originalMessage);
    expect(imapSeenUpdates).toEqual([]);
    expect(rows.runs).toEqual([]);
    expect(rows.steps).toEqual([]);
    expect(rows.tags).toEqual([]);
    expect(rows.delayedJobs).toEqual([]);
    expect(rows.jobs).toEqual([]);
  });

  test('postgres workflow execution job port assigns email category paths', async () => {
    const now = new Date('2026-07-04T10:31:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 38,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 380,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            {
              id: 'category-1',
              type: 'registry',
              data: {
                nodeType: 'email.set_category',
                config: { path: 'Support / VIP' },
              },
            },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'category-1' }],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 27,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 270,
        subject: 'Kategorie',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Kategorie',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
      categories: [
        {
          id: 800,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 9800,
          parent_source_sqlite_id: null,
          parent_id: null,
          name: 'Alt',
          sort_order: 0,
        },
        {
          id: 801,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 9801,
          parent_source_sqlite_id: null,
          parent_id: null,
          name: 'Support',
          sort_order: 1,
        },
      ],
      messageCategories: [{
        id: 900,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 9900,
        message_source_sqlite_id: 270,
        category_source_sqlite_id: 9800,
        message_id: 27,
        category_id: 800,
        source_row: { origin: 'import' },
        imported_in_run_id: null,
        updated_at: new Date('2026-07-01T00:00:00.000Z'),
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 38,
      messageId: 27,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.categories).toEqual([
      expect.objectContaining({ id: 800, name: 'Alt', parent_id: null }),
      expect.objectContaining({ id: 801, name: 'Support', parent_id: null }),
      expect.objectContaining({
        id: 802,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: expect.any(Number),
        parent_source_sqlite_id: 9801,
        parent_id: 801,
        name: 'VIP',
        sort_order: 0,
        source_row: { origin: 'server_worker' },
        imported_in_run_id: null,
        created_at: now,
        updated_at: now,
      }),
    ]);
    expect(rows.messageCategories).toEqual([
      expect.objectContaining({
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: expect.any(Number),
        message_source_sqlite_id: 270,
        category_source_sqlite_id: rows.categories[2].source_sqlite_id,
        message_id: 27,
        category_id: 802,
        source_row: { origin: 'server_worker' },
        imported_in_run_id: null,
        updated_at: now,
      }),
    ]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['category-1', 'email.set_category', 'ok', 'default', null],
    ]);
  });

  test('postgres workflow execution job port runs action-type set_category nodes (short-name alias)', async () => {
    const now = new Date('2026-07-04T10:31:30.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 39,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 390,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            // Palette "Kategorie setzen" emits a short-name action node; the server
            // must treat 'set_category' like 'email.set_category' instead of blocking it.
            { id: 'set-cat', type: 'action', data: { actionType: 'set_category', path: 'Support' } },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'set-cat' }],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 28,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 280,
        subject: 'Kat',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Kat',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
      categories: [{
        id: 801,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 9801,
        parent_source_sqlite_id: null,
        parent_id: null,
        name: 'Support',
        sort_order: 0,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 39,
      messageId: 28,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.runs.map((run) => run.status)).toEqual(['ok']);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['set-cat', 'set_category', 'ok', 'default'],
    ]);
    expect(rows.messageCategories.map((mc) => [mc.message_id, mc.category_id])).toEqual([[28, 801]]);
  });

  test('postgres workflow execution job port resolves set_category by stable id (rename-safe)', async () => {
    const now = new Date('2026-07-04T10:31:45.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 43,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 430,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            {
              id: 'set-cat',
              type: 'registry',
              data: {
                nodeType: 'email.set_category',
                // Stable id wins over the (now stale) configured path.
                config: { categorySourceSqliteId: 9801, path: 'Stale Old Path' },
              },
            },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'set-cat' }],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 29,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 290,
        subject: 'Kat',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Kat',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
      categories: [{
        id: 801,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 9801,
        parent_source_sqlite_id: null,
        parent_id: null,
        name: 'Renamed',
        sort_order: 0,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 43,
      messageId: 29,
      triggerName: 'manual',
      context: {},
    });

    // Resolved by stable id 9801 -> category 801 ('Renamed'), ignoring the stale path,
    // and without creating a new category from that path.
    expect(rows.messageCategories.map((mc) => [mc.message_id, mc.category_id, mc.category_source_sqlite_id]))
      .toEqual([[29, 801, 9801]]);
    expect(rows.categories.map((c) => c.id)).toEqual([801]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status])).toEqual([
      ['set-cat', 'email.set_category', 'ok'],
    ]);
  });

  test('postgres workflow execution job port queues account sync runs', async () => {
    const now = new Date('2026-07-04T10:32:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 40,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 400,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            {
              id: 'sync-1',
              type: 'registry',
              data: { nodeType: 'sync.run', config: {} },
            },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'sync-1' }],
        },
        execution_mode: 'graph',
      }],
      accounts: [{
        id: 77,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 770,
        protocol: 'pop3',
      }],
      messages: [{
        id: 29,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 290,
        account_id: 77,
        subject: 'Sync',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Sync',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 40,
      messageId: 29,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'mail.sync.pop3',
        payload: { workspaceId: WORKSPACE_A_ID, accountId: 77 },
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['sync-1', 'sync.run', 'ok', 'default', 'queued_sync:1'],
    ]);
  });

  test('postgres workflow execution job port queues workflow subflows', async () => {
    const now = new Date('2026-07-04T10:33:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [
        {
          id: 41,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 410,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
              {
                id: 'subflow-1',
                type: 'registry',
                data: { nodeType: 'workflow.subflow', config: { workflowId: 42 } },
              },
            ],
            edges: [{ id: 'edge-1', source: 'trigger-1', target: 'subflow-1' }],
          },
          execution_mode: 'graph',
        },
        {
          id: 42,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 420,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: { version: 1, nodes: [], edges: [] },
          execution_mode: 'graph',
        },
      ],
      messages: [{
        id: 30,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 300,
        subject: 'Subflow',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Subflow',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 41,
      messageId: 30,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'workflow.execute',
        payload: expect.objectContaining({
          workspaceId: WORKSPACE_A_ID,
          workflowId: 42,
          messageId: 30,
          triggerName: 'manual',
          context: expect.objectContaining({
            eventStrings: expect.objectContaining({ subject: 'Subflow' }),
            eventVariables: expect.objectContaining({ 'message.id': 30 }),
            subflowParent: { workflowId: 41, runId: 1, nodeId: 'subflow-1' },
          }),
        }),
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['subflow-1', 'workflow.subflow', 'ok', 'default', 'queued_subflow:1'],
    ]);
  });

  test('postgres workflow execution job port applies DB-only spam status nodes', async () => {
    const now = new Date('2026-07-04T10:40:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [
        {
          id: 28,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 280,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
              {
                id: 'review-1',
                type: 'registry',
                data: {
                  nodeType: 'email.set_spam_status',
                  config: { status: 'review', tag: 'needs-review' },
                },
              },
            ],
            edges: [{ id: 'edge-1', source: 'trigger-1', target: 'review-1' }],
          },
          execution_mode: 'graph',
        },
        {
          id: 29,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 290,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
              {
                id: 'spam-1',
                type: 'registry',
                data: {
                  nodeType: 'email.mark_spam',
                  config: { spam: true, tag: 'auto-spam', moveImap: false },
                },
              },
            ],
            edges: [{ id: 'edge-1', source: 'trigger-1', target: 'spam-1' }],
          },
          execution_mode: 'graph',
        },
      ],
      messages: [
        {
          id: 16,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 160,
          subject: 'Review',
          from_json: { value: [{ address: 'customer@example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Review',
          body_text: 'Hallo',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          folder_kind: 'sent',
          soft_deleted: true,
          archived: true,
          done_local: true,
          seen_local: true,
          is_spam: true,
          spam_status: 'spam',
        },
        {
          id: 17,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 170,
          subject: 'Spam',
          from_json: { value: [{ address: 'customer@example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Spam',
          body_text: 'Hallo',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          folder_kind: 'inbox',
          soft_deleted: true,
          archived: true,
          done_local: false,
          seen_local: false,
          is_spam: false,
          spam_status: 'clean',
        },
      ],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 28,
      messageId: 16,
      triggerName: 'manual',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 29,
      messageId: 17,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.messages[0]).toMatchObject({
      is_spam: false,
      spam_status: 'review',
      soft_deleted: false,
      archived: false,
      done_local: false,
      seen_local: false,
      folder_kind: 'inbox',
      spam_decided_at: now,
      updated_at: now,
    });
    expect(rows.messages[1]).toMatchObject({
      is_spam: true,
      spam_status: 'spam',
      soft_deleted: false,
      archived: false,
      done_local: true,
      spam_decided_at: now,
      updated_at: now,
    });
    expect(rows.tags.map((tag) => [tag.message_id, tag.tag])).toEqual([
      [16, 'needs-review'],
      [17, 'auto-spam'],
    ]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['review-1', 'email.set_spam_status', 'ok', 'default'],
      ['spam-1', 'email.mark_spam', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port trains spam status nodes when requested', async () => {
    const now = new Date('2026-07-04T10:42:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [
        {
          id: 61,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 610,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
              {
                id: 'spam-train-1',
                type: 'registry',
                data: {
                  nodeType: 'email.mark_spam',
                  config: { spam: true, train: true, tag: '', moveImap: false },
                },
              },
            ],
            edges: [{ id: 'edge-1', source: 'trigger-1', target: 'spam-train-1' }],
          },
          execution_mode: 'graph',
        },
        {
          id: 62,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 620,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
              {
                id: 'ham-train-1',
                type: 'registry',
                data: {
                  nodeType: 'email.set_spam_status',
                  config: { status: 'clean', train: true, tag: '' },
                },
              },
            ],
            edges: [{ id: 'edge-1', source: 'trigger-1', target: 'ham-train-1' }],
          },
          execution_mode: 'graph',
        },
      ],
      messages: [
        {
          id: 18,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 180,
          account_source_sqlite_id: 700,
          account_id: 7,
          subject: 'Urgent bitcoin account',
          from_json: { value: [{ address: 'bad@spam.test' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'sofort handeln',
          body_text: 'Sofort crypto Zahlung pruefen',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          folder_kind: 'inbox',
          soft_deleted: false,
          archived: false,
          done_local: false,
          is_spam: false,
          spam_status: 'clean',
        },
        {
          id: 19,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 190,
          account_source_sqlite_id: 701,
          account_id: 7,
          subject: 'Invoice order',
          from_json: { value: [{ address: 'kunde@example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Bestellung',
          body_text: 'rechnung und order Details',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          folder_kind: 'inbox',
          soft_deleted: false,
          archived: false,
          done_local: true,
          is_spam: true,
          spam_status: 'spam',
        },
      ],
      spamFeatureStats: [{
        workspace_id: WORKSPACE_A_ID,
        feature_key: 'sender:domain:spam.test',
        spam_count: 2,
        ham_count: 1,
        source_row: { origin: 'fixture' },
        imported_in_run_id: null,
        updated_at: new Date('2026-07-01T00:00:00.000Z'),
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 61,
      messageId: 18,
      triggerName: 'manual',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 62,
      messageId: 19,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.spamLearningEvents.map((event) => ({
      label: event.label,
      source: event.source,
      messageId: event.message_id,
      accountId: event.account_id,
      featureKeys: event.feature_keys_json,
    }))).toEqual([
      expect.objectContaining({
        label: 'spam',
        source: 'workflow',
        messageId: 18,
        accountId: 7,
        featureKeys: expect.arrayContaining(['sender:domain:spam.test', 'content:suspicious_terms']),
      }),
      expect.objectContaining({
        label: 'ham',
        source: 'workflow',
        messageId: 19,
        accountId: 7,
        featureKeys: expect.arrayContaining(['sender:domain:example.com', 'content:business_terms']),
      }),
    ]);
    const stats = new Map(rows.spamFeatureStats.map((row) => [row.feature_key, row]));
    expect(stats.get('sender:domain:spam.test')).toMatchObject({
      spam_count: 3,
      ham_count: 1,
      updated_at: now,
    });
    expect(stats.get('content:business_terms')).toMatchObject({
      spam_count: 0,
      ham_count: 1,
      updated_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['spam-train-1', 'email.mark_spam', 'ok', 'default'],
      ['ham-train-1', 'email.set_spam_status', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port iterates logic loop each/done branches', async () => {
    const now = new Date('2026-07-04T10:40:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 49,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 490,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            {
              id: 'loop-1',
              type: 'registry',
              data: {
                nodeType: 'logic.loop',
                config: { items: 'alpha\nbeta', maxItems: 10 },
              },
            },
            { id: 'tag-each', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'loop-item' } } },
            { id: 'tag-done', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'loop-done' } } },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'loop-1' },
            { id: 'edge-2', source: 'loop-1', target: 'tag-each', label: 'each' },
            { id: 'edge-3', source: 'tag-each', target: 'loop-1' },
            { id: 'edge-4', source: 'loop-1', target: 'tag-done', label: 'done' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 31,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 310,
        subject: 'Loop test',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Loop test',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await expect(port.dryRun!({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 49,
      messageId: 31,
      triggerName: 'manual',
      context: {},
    })).resolves.toMatchObject({
      success: true,
      dryRun: true,
      status: 'ok',
      log: [
        'dry_run:server',
        'loop:0:alpha',
        'dry_run:email.tag',
        'loop:1:beta',
        'dry_run:email.tag',
        'dry_run:email.tag',
      ],
    });
    expect(rows.runs).toEqual([]);
    expect(rows.steps).toEqual([]);
    expect(rows.tags).toEqual([]);

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 49,
      messageId: 31,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.runs[0]).toMatchObject({
      status: 'ok',
      log_json: ['loop:0:alpha', 'loop:1:beta'],
      finished_at: now,
    });
    expect(rows.tags.map((tag) => tag.tag)).toEqual(['loop-item', 'loop-done']);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['loop-1', 'logic.loop', 'ok', 'each', 'loop_items:2'],
      ['tag-each', 'email.tag', 'ok', 'default', null],
      ['tag-each', 'email.tag', 'ok', 'default', null],
      ['tag-done', 'email.tag', 'ok', 'default', null],
    ]);
  });

  test('postgres workflow execution job port schedules and resumes delay nodes', async () => {
    const now = new Date('2026-07-04T10:45:00.000Z');
    const executeAt = new Date('2026-07-04T10:47:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 26,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 260,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
            {
              id: 'delay-1',
              type: 'registry',
              data: { nodeType: 'logic.delay', config: { minutes: 2 } },
            },
            { id: 'tag-1', type: 'registry', data: { nodeType: 'email.tag', config: { tag: 'resumed' } } },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'delay-1' },
            { id: 'edge-2', source: 'delay-1', target: 'tag-1' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 14,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 140,
        subject: 'Delay test',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Delay test',
        body_text: 'Hallo',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 26,
      messageId: 14,
      triggerName: 'manual',
      context: {},
    });

    expect(rows.delayedJobs).toHaveLength(1);
    expect(rows.delayedJobs[0]).toMatchObject({
      workspace_id: WORKSPACE_A_ID,
      workflow_source_sqlite_id: 260,
      message_source_sqlite_id: 140,
      workflow_id: 26,
      message_id: 14,
      resume_node_id: 'tag-1',
      execute_at: executeAt,
      status: 'pending',
      created_at: now,
      updated_at: now,
    });
    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'workflow.execute',
        run_after: executeAt,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    const payload = rows.jobs[0]!.payload as Record<string, unknown>;
    expect(payload).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 26,
      messageId: 14,
      delayedJobId: 1,
      triggerName: 'manual',
    });
    expect(payload.context).toMatchObject({ resumeNodeId: 'tag-1' });
    expect(rows.runs[0]).toMatchObject({
      status: 'ok',
      log_json: ['stop'],
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.message])).toEqual([
      ['delay-1', 'logic.delay', 'ok', `delayed_until:${executeAt.toISOString()}`],
    ]);

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 26,
      messageId: 14,
      delayedJobId: 1,
      triggerName: 'manual',
      context: payload.context as Record<string, unknown>,
    });

    expect(rows.delayedJobs[0]).toMatchObject({ status: 'done', updated_at: now });
    expect(rows.tags.map((tag) => tag.tag)).toEqual(['resumed']);
    expect(rows.runs[1]).toMatchObject({
      status: 'ok',
      log_json: ['graph_resume:tag-1'],
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['delay-1', 'logic.delay', 'ok', 'default'],
      ['tag-1', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port enqueues AI reply suggestion nodes', async () => {
    const now = new Date('2026-07-04T10:55:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 27,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 270,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            {
              id: 'reply-1',
              type: 'registry',
              data: {
                nodeType: 'ai.reply_suggestion',
                config: {
                  promptId: 22,
                  profileId: '33',
                  skipIfReady: true,
                  runOnEveryInbound: true,
                },
              },
            },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'reply-1' }],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 15,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 150,
        subject: 'Antwortvorschlag',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Bitte antworten',
        body_text: 'Hallo, bitte antworten.',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 27,
      messageId: 15,
      triggerName: 'inbound',
      context: {},
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'ai.reply_suggestion',
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toEqual({
      workspaceId: WORKSPACE_A_ID,
      messageId: 15,
      force: true,
      skipIfReady: true,
      trigger: 'inbound',
      promptId: 22,
      profileId: 33,
    });
    expect(rows.runs[0]).toMatchObject({
      status: 'ok',
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['reply-1', 'ai.reply_suggestion', 'ok', 'default', 'queued_ai_reply_suggestion:1'],
    ]);
  });

  test('postgres workflow execution job port queues AI classification continuations', async () => {
    const now = new Date('2026-07-04T10:58:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 28,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 280,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            {
              id: 'classify-1',
              type: 'registry',
              data: {
                nodeType: 'ai.classify',
                config: {
                  labels: 'Rechnung,Support,Spam',
                  contextMode: 'metadata',
                  profileId: '33',
                },
              },
            },
            {
              id: 'switch-1',
              type: 'registry',
              data: { nodeType: 'logic.switch', config: { field: 'ai.class', cases: 'rechnung,support' } },
            },
            {
              id: 'tag-support',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'support', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'classify-1' },
            { id: 'edge-2', source: 'classify-1', target: 'switch-1' },
            { id: 'edge-3', source: 'switch-1', target: 'tag-support', label: 'support' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 16,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 160,
        subject: 'Support',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Bitte helfen',
        body_text: 'Hallo, bitte helfen.',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 28,
      messageId: 16,
      triggerName: 'inbound',
      context: {},
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'ai.classify',
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      messageId: 16,
      labels: ['Rechnung', 'Support', 'Spam'],
      contextMode: 'metadata',
      profileId: 33,
      workflowId: 28,
      resumeNodeId: 'switch-1',
      continuation: {
        workflowId: 28,
        triggerName: 'inbound',
        resumeNodeId: 'switch-1',
      },
    });
    expect((rows.jobs[0]?.payload as any).continuation.eventVariables).toMatchObject({
      'message.id': 16,
    });
    expect(rows.runs[0]).toMatchObject({
      status: 'ok',
      log_json: ['stop'],
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['classify-1', 'ai.classify', 'ok', 'default', 'queued_ai_classify:1'],
    ]);

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 28,
      messageId: 16,
      triggerName: 'inbound',
      context: {
        resumeNodeId: 'switch-1',
        eventStrings: (rows.jobs[0]?.payload as any).continuation.eventStrings,
        eventVariables: {
          ...(rows.jobs[0]?.payload as any).continuation.eventVariables,
          'ai.class': 'Support',
        },
      },
    });

    expect(rows.tags.map((tag) => tag.tag)).toEqual(['support']);
    expect(rows.runs[1]).toMatchObject({
      status: 'ok',
      log_json: ['graph_resume:switch-1'],
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['classify-1', 'ai.classify', 'ok', 'default'],
      ['switch-1', 'logic.switch', 'ok', 'support'],
      ['tag-support', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port queues AI transform text continuations', async () => {
    const now = new Date('2026-07-04T10:59:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 29,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 290,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            {
              id: 'transform-1',
              type: 'registry',
              data: {
                nodeType: 'ai.transform_text',
                config: {
                  promptId: 22,
                  profileId: '33',
                  targetVariable: 'ai.summary',
                  runOnEveryInbound: true,
                },
              },
            },
            {
              id: 'switch-1',
              type: 'registry',
              data: { nodeType: 'logic.switch', config: { field: 'ai.summary', cases: 'done' } },
            },
            {
              id: 'tag-done',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'summary-ready', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'transform-1' },
            { id: 'edge-2', source: 'transform-1', target: 'switch-1' },
            { id: 'edge-3', source: 'switch-1', target: 'tag-done', label: 'done' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 17,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 170,
        subject: 'Transform',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Bitte zusammenfassen',
        body_text: 'Hallo, bitte zusammenfassen.',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 29,
      messageId: 17,
      triggerName: 'inbound',
      context: {},
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'ai.transform_text',
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      messageId: 17,
      promptId: 22,
      profileId: 33,
      targetVariable: 'ai.summary',
      workflowId: 29,
      resumeNodeId: 'switch-1',
      continuation: {
        workflowId: 29,
        triggerName: 'inbound',
        resumeNodeId: 'switch-1',
      },
    });
    expect(rows.runs[0]).toMatchObject({
      status: 'ok',
      log_json: ['stop'],
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['transform-1', 'ai.transform_text', 'ok', 'default', 'queued_ai_transform_text:1'],
    ]);

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 29,
      messageId: 17,
      triggerName: 'inbound',
      context: {
        resumeNodeId: 'switch-1',
        eventStrings: (rows.jobs[0]?.payload as any).continuation.eventStrings,
        eventVariables: {
          ...(rows.jobs[0]?.payload as any).continuation.eventVariables,
          'ai.summary': 'done',
        },
      },
    });

    expect(rows.tags.map((tag) => tag.tag)).toEqual(['summary-ready']);
    expect(rows.runs[1]).toMatchObject({
      status: 'ok',
      log_json: ['graph_resume:switch-1'],
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['transform-1', 'ai.transform_text', 'ok', 'default'],
      ['switch-1', 'logic.switch', 'ok', 'done'],
      ['tag-done', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port runs AI agent tool knowledge search', async () => {
    const now = new Date('2026-07-04T11:01:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 30,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 300,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            {
              id: 'tool-1',
              type: 'registry',
              data: {
                nodeType: 'ai.agent_tool',
                config: { tool: 'search_knowledge', knowledgeBaseId: 5, runOnEveryInbound: true },
              },
            },
            {
              id: 'switch-1',
              type: 'registry',
              data: { nodeType: 'logic.switch', config: { field: 'tool.result', cases: 'refund policy' } },
            },
            {
              id: 'tag-refund',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'refund-info', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'tool-1' },
            { id: 'edge-2', source: 'tool-1', target: 'switch-1' },
            { id: 'edge-3', source: 'switch-1', target: 'tag-refund', label: 'refund policy' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 18,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 180,
        subject: 'Refund',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'refund',
        body_text: 'refund',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
      knowledgeChunks: [
        {
          id: 2,
          workspace_id: WORKSPACE_A_ID,
          knowledge_base_id: 5,
          title: 'Other',
          content: 'Shipping',
        },
        {
          id: 1,
          workspace_id: WORKSPACE_A_ID,
          knowledge_base_id: 5,
          title: 'Refund',
          content: 'Refund policy',
        },
      ],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 30,
      messageId: 18,
      triggerName: 'inbound',
      context: {},
    });

    expect(rows.tags.map((tag) => tag.tag)).toEqual(['refund-info']);
    expect(rows.runs[0]).toMatchObject({
      status: 'ok',
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['tool-1', 'ai.agent_tool', 'ok', 'default'],
      ['switch-1', 'logic.switch', 'ok', 'refund policy'],
      ['tag-refund', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port runs JTL lookups from workspace reference tables', async () => {
    const now = new Date('2026-07-04T11:01:15.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 31,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 310,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            {
              id: 'jtl-1',
              type: 'registry',
              data: {
                nodeType: 'jtl.lookup',
                config: { entity: 'jtl_firmen', search: 'shop', limit: 5, runOnEveryInbound: true },
              },
            },
            {
              id: 'switch-1',
              type: 'registry',
              data: { nodeType: 'logic.switch', config: { field: 'jtl.row_count', cases: '2' } },
            },
            {
              id: 'tag-jtl',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'jtl-found', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'jtl-1' },
            { id: 'edge-2', source: 'jtl-1', target: 'switch-1' },
            { id: 'edge-3', source: 'switch-1', target: 'tag-jtl', label: '2' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 19,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 190,
        subject: 'JTL',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'jtl',
        body_text: 'jtl',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
      jtlFirmen: [
        {
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 100,
          name: 'Shop GmbH',
          source_row: { internal: 'hidden' },
        },
        {
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 101,
          name: 'Andere Firma',
          source_row: { internal: 'hidden' },
        },
        {
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 102,
          name: 'Shop AG',
          source_row: { internal: 'hidden' },
        },
        {
          workspace_id: WORKSPACE_B_ID,
          source_sqlite_id: 103,
          name: 'Shop Fremd',
          source_row: { internal: 'hidden' },
        },
      ],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 31,
      messageId: 19,
      triggerName: 'inbound',
      context: {},
    });

    expect(rows.tags.map((tag) => tag.tag)).toEqual(['jtl-found']);
    expect(rows.runs[0]).toMatchObject({
      status: 'ok',
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['jtl-1', 'jtl.lookup', 'ok', 'default'],
      ['switch-1', 'logic.switch', 'ok', '2'],
      ['tag-jtl', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port runs read-only MSSQL queries through configured port', async () => {
    const now = new Date('2026-07-04T11:01:20.000Z');
    const mssqlCalls: unknown[] = [];
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 34,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 340,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            {
              id: 'mssql-1',
              type: 'registry',
              data: {
                nodeType: 'mssql.query',
                config: { sql: ' SELECT TOP 1 1 AS ok ', runOnEveryInbound: true },
              },
            },
            {
              id: 'switch-1',
              type: 'registry',
              data: { nodeType: 'logic.switch', config: { field: 'mssql.row_count', cases: '1' } },
            },
            {
              id: 'tag-mssql',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'mssql-found', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'mssql-1' },
            { id: 'edge-2', source: 'mssql-1', target: 'switch-1' },
            { id: 'edge-3', source: 'switch-1', target: 'tag-mssql', label: '1' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 22,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 220,
        subject: 'MSSQL',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'mssql',
        body_text: 'mssql',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      mssql: {
        async executeReadOnlyQuery(input) {
          mssqlCalls.push(input);
          return { success: true, rows: [{ ok: 1 }], rowCount: 1 };
        },
      },
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 34,
      messageId: 22,
      triggerName: 'inbound',
      context: {},
    });

    expect(mssqlCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      query: 'SELECT TOP 1 1 AS ok',
    }]);
    expect(rows.tags.map((tag) => tag.tag)).toEqual(['mssql-found']);
    expect(rows.runs[0]).toMatchObject({
      status: 'ok',
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['mssql-1', 'mssql.query', 'ok', 'default'],
      ['switch-1', 'logic.switch', 'ok', '1'],
      ['tag-mssql', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port binds sender email into jtl.order_context and maps columns', async () => {
    const now = new Date('2026-07-04T11:00:45.000Z');
    const mssqlCalls: Array<{ workspaceId: string; query: string }> = [];
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 36,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 360,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            {
              id: 'jtl-1',
              type: 'registry',
              data: {
                nodeType: 'jtl.order_context',
                config: {
                  query: 'SELECT TOP 1 cStatus FROM tBestellung WHERE cEmail = {{email}}',
                  mapping: 'cStatus:jtl.status',
                  runOnEveryInbound: true,
                },
              },
            },
            {
              id: 'switch-1',
              type: 'registry',
              data: { nodeType: 'logic.switch', config: { field: 'jtl.status', cases: 'versendet' } },
            },
            {
              id: 'tag-jtl',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'jtl-versendet', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'jtl-1' },
            { id: 'edge-2', source: 'jtl-1', target: 'switch-1' },
            { id: 'edge-3', source: 'switch-1', target: 'tag-jtl', label: 'versendet' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 23,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 230,
        subject: 'JTL',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'jtl',
        body_text: 'jtl',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      mssql: {
        async executeReadOnlyQuery(input) {
          mssqlCalls.push(input);
          return { success: true, rows: [{ cStatus: 'versendet' }], rowCount: 1 };
        },
      },
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 36,
      messageId: 23,
      triggerName: 'inbound',
      context: {},
    });

    // The sender address is strictly validated, SQL-escaped, and injected for {{email}}.
    expect(mssqlCalls).toEqual([{
      workspaceId: WORKSPACE_A_ID,
      query: "SELECT TOP 1 cStatus FROM tBestellung WHERE cEmail = 'customer@example.com'",
    }]);
    // The mapped jtl.status variable drove the switch → tag.
    expect(rows.tags.map((tag) => tag.tag)).toEqual(['jtl-versendet']);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['jtl-1', 'jtl.order_context', 'ok', 'default'],
      ['switch-1', 'logic.switch', 'ok', 'versendet'],
      ['tag-jtl', 'email.tag', 'ok', 'default'],
    ]);
    // The worker run persists its synthetic source id, and the steps carry the
    // same run_source_sqlite_id — so the run-history "by source" step lookup
    // resolves (previously the run kept source_sqlite_id=null while steps used
    // -id, so the step protocol was always empty).
    expect(rows.runs).toHaveLength(1);
    expect(rows.runs[0].source_sqlite_id).toBeLessThan(0);
    expect(rows.steps.every((step) => step.run_source_sqlite_id === rows.runs[0].source_sqlite_id)).toBe(true);
  });

  test('postgres workflow execution job port gates email.auto_reply on enable flag, confidence, and anti-loop', async () => {
    const now = new Date('2026-07-04T11:02:10.000Z');
    const autoReplyGraph = {
      version: 1,
      nodes: [
        { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 'auto-1',
          type: 'registry',
          data: { nodeType: 'email.auto_reply', config: { confidenceVar: 'ai.class_confidence', minConfidence: 70, runOnEveryInbound: true } },
        },
      ],
      edges: [{ id: 'edge-1', source: 'trigger-1', target: 'auto-1' }],
    };
    const makeMessage = (id: number, sourceSqliteId: number, address: string) => ({
      id,
      workspace_id: WORKSPACE_A_ID,
      source_sqlite_id: sourceSqliteId,
      subject: 'Frage',
      from_json: { value: [{ address }] },
      to_json: { value: [{ address: 'agent@example.com' }] },
      cc_json: null,
      snippet: 'Frage',
      body_text: 'Frage',
      body_html: null,
      has_attachments: false,
      attachments_json: null,
    });
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 37,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 370,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: autoReplyGraph,
        execution_mode: 'graph',
      }],
      messages: [
        makeMessage(51, 510, 'customer@example.com'),
        makeMessage(52, 520, 'customer@example.com'),
        makeMessage(53, 530, 'no-reply@shop.example.com'),
      ],
      syncInfo: [{ workspace_id: WORKSPACE_A_ID, key: 'auto_reply_enabled', value: '1' }],
    });
    const port = createPostgresWorkflowExecutionJobPort({ db, now: () => now, applyWorkspaceSession: async () => undefined });

    // Enabled + high confidence + human sender -> approved.
    await port.execute({ workspaceId: WORKSPACE_A_ID, workflowId: 37, messageId: 51, triggerName: 'inbound', context: { eventVariables: { 'ai.class_confidence': 90 } } });
    // Enabled + low confidence -> blocked.
    await port.execute({ workspaceId: WORKSPACE_A_ID, workflowId: 37, messageId: 52, triggerName: 'inbound', context: { eventVariables: { 'ai.class_confidence': 50 } } });
    // Enabled + no-reply sender (anti-loop) -> blocked regardless of confidence.
    await port.execute({ workspaceId: WORKSPACE_A_ID, workflowId: 37, messageId: 53, triggerName: 'inbound', context: { eventVariables: { 'ai.class_confidence': 95 } } });

    expect(rows.steps.map((step) => [step.node_type, step.status, step.port, step.message])).toEqual([
      ['email.auto_reply', 'ok', 'approved', 'auto_reply:approved'],
      ['email.auto_reply', 'ok', 'blocked', 'auto_reply:blocked:low_confidence'],
      ['email.auto_reply', 'ok', 'blocked', 'auto_reply:blocked:noreply_sender'],
    ]);
  });

  test('postgres workflow execution job port defaults email.auto_reply to blocked when disabled', async () => {
    const now = new Date('2026-07-04T11:02:30.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 38,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 380,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            { id: 'auto-1', type: 'registry', data: { nodeType: 'email.auto_reply', config: { runOnEveryInbound: true } } },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'auto-1' }],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 54,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 540,
        subject: 'Frage',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Frage',
        body_text: 'Frage',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({ db, now: () => now, applyWorkspaceSession: async () => undefined });

    await port.execute({ workspaceId: WORKSPACE_A_ID, workflowId: 38, messageId: 54, triggerName: 'inbound', context: { eventVariables: { 'ai.class_confidence': 99 } } });

    expect(rows.steps.map((step) => [step.node_type, step.port, step.message])).toEqual([
      ['email.auto_reply', 'blocked', 'auto_reply:blocked:disabled'],
    ]);
  });

  test('postgres workflow execution job port prepares a JTL action proposal without executing it', async () => {
    const now = new Date('2026-07-04T11:02:50.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 39,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 390,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            {
              id: 'act-1',
              type: 'registry',
              data: { nodeType: 'jtl.prepare_action', config: { kind: 'send_tracking', requireApproval: false, runOnEveryInbound: true } },
            },
            {
              id: 'switch-1',
              type: 'registry',
              data: { nodeType: 'logic.switch', config: { field: 'jtl.action.kind', cases: 'send_tracking' } },
            },
            {
              id: 'tag-act',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'aktion-vorbereitet', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'act-1' },
            { id: 'edge-2', source: 'act-1', target: 'switch-1' },
            { id: 'edge-3', source: 'switch-1', target: 'tag-act', label: 'send_tracking' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 55,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 550,
        subject: 'Tracking?',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'tracking',
        body_text: 'tracking',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({ db, now: () => now, applyWorkspaceSession: async () => undefined });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 39,
      messageId: 55,
      triggerName: 'inbound',
      context: { eventVariables: { 'jtl.order_no': 'B-1001', 'jtl.tracking': '00340' } },
    });

    // The action descriptor is exposed as variables (read-only proposal, no execution).
    expect(rows.tags.map((tag) => tag.tag)).toEqual(['aktion-vorbereitet']);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['act-1', 'jtl.prepare_action', 'ok', 'approved', 'jtl_action:prepared:send_tracking'],
      ['switch-1', 'logic.switch', 'ok', 'send_tracking', null],
      ['tag-act', 'email.tag', 'ok', 'default', null],
    ]);
  });

  test('postgres workflow execution job port rejects unsafe MSSQL queries before runtime port', async () => {
    const now = new Date('2026-07-04T11:01:25.000Z');
    const mssqlCalls: unknown[] = [];
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 35,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 350,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            {
              id: 'mssql-unsafe',
              type: 'registry',
              data: {
                nodeType: 'mssql.query',
                config: { sql: 'SELECT 1; DROP TABLE Kunden', runOnEveryInbound: true },
              },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'mssql-unsafe' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 23,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 230,
        subject: 'MSSQL unsafe',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'mssql',
        body_text: 'mssql',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      mssql: {
        async executeReadOnlyQuery(input) {
          mssqlCalls.push(input);
          return { success: true, rows: [{ ok: 1 }], rowCount: 1 };
        },
      },
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 35,
      messageId: 23,
      triggerName: 'inbound',
      context: {},
    });

    expect(mssqlCalls).toEqual([]);
    expect(rows.runs[0]).toMatchObject({
      status: 'error',
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['mssql-unsafe', 'mssql.query', 'error', 'error', 'Nur lesende SELECT-Abfragen sind erlaubt'],
    ]);
  });

});
