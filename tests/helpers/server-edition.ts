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

export const EXPECTED_SERVER_MIGRATION_IDS = [
  '0001_server_foundation',
  '0002_security_foundation',
  '0003_sqlite_import_foundation',
  '0004_sqlite_import_staging',
  '0005_core_crm_schema',
  '0006_extended_crm_schema',
  '0007_core_mail_schema',
  '0008_workflow_security_schema',
  '0009_sqlite_import_validation',
  '0010_email_message_list_semantics',
  '0011_email_message_restore_snapshots',
  '0012_email_account_server_settings',
  '0013_email_compose_draft_fields',
  '0014_email_reply_suggestion_fields',
  '0015_task_customer_optional',
  '0016_task_assignment_and_user_groups',
  '0017_ai_usage_events',
  '0018_ai_reply_feedback',
  '0019_task_assignment_scope_reset',
  '0020_auth_login_security',
  '0021_returns_schema',
  '0022_returns_portal_settings',
  '0023_account_scope_overrides',
  '0024_settings_kb_context_imap',
  '0025_email_message_thread_lookup',
];

export const WORKSPACE_A_ID = '11111111-1111-4111-8111-111111111111';
export const USER_A_ID = '22222222-2222-4222-8222-222222222222';
export const WORKSPACE_B_ID = '33333333-3333-4333-8333-333333333333';
export const USER_B_ID = '44444444-4444-4444-8444-444444444444';

export type CapturedAuditEvent = {
  workspaceId: string;
  actorUserId?: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
};

export function makeServerApiPorts(input: {
  activityLog?: ServerApiPorts['activityLog'];
  audit?: ServerApiPorts['audit'];
  auditEvents?: CapturedAuditEvent[];
  authInvitationMailer?: ServerApiPorts['authInvitationMailer'];
  authUsers?: AuthUserAdminRecord[];
  initialSetupNeeded?: boolean;
  mssqlSettings?: ServerApiPorts['mssqlSettings'];
  aiReplySuggestions?: ServerApiPorts['aiReplySuggestions'];
  aiProfiles?: ServerApiPorts['aiProfiles'];
  aiPrompts?: ServerApiPorts['aiPrompts'];
  aiTextTransform?: ServerApiPorts['aiTextTransform'];
  automationApiKeys?: ServerApiPorts['automationApiKeys'];
  calendarEvents?: ServerApiPorts['calendarEvents'];
  customerCustomFields?: ServerApiPorts['customerCustomFields'];
  customerCustomFieldValues?: ServerApiPorts['customerCustomFieldValues'];
  customers?: ServerApiPorts['customers'];
  deals?: ServerApiPorts['deals'];
  emailAccountSignatures?: ServerApiPorts['emailAccountSignatures'];
  emailAccounts?: ServerApiPorts['emailAccounts'];
  emailAttachmentContent?: ServerApiPorts['emailAttachmentContent'];
  emailAttachments?: ServerApiPorts['emailAttachments'];
  emailCannedResponses?: ServerApiPorts['emailCannedResponses'];
  emailCategories?: ServerApiPorts['emailCategories'];
  emailComposeSender?: ServerApiPorts['emailComposeSender'];
  emailOutboundValidation?: ServerApiPorts['emailOutboundValidation'];
  emailDiagnostics?: ServerApiPorts['emailDiagnostics'];
  emailFolders?: ServerApiPorts['emailFolders'];
  emailGdprExport?: ServerApiPorts['emailGdprExport'];
  emailInternalNotes?: ServerApiPorts['emailInternalNotes'];
  emailMessageCategories?: ServerApiPorts['emailMessageCategories'];
  emailMessages?: ServerApiPorts['emailMessages'];
  emailMessageTags?: ServerApiPorts['emailMessageTags'];
  emailVacationTests?: ServerApiPorts['emailVacationTests'];
  mailConnectionTests?: ServerApiPorts['mailConnectionTests'];
  emailReadReceipts?: ServerApiPorts['emailReadReceipts'];
  emailReadReceiptResponder?: ServerApiPorts['emailReadReceiptResponder'];
  emailRemoteContentAllowlist?: ServerApiPorts['emailRemoteContentAllowlist'];
  emailOAuth?: ServerApiPorts['emailOAuth'];
  emailTeamMembers?: ServerApiPorts['emailTeamMembers'];
  emailThreadAliases?: ServerApiPorts['emailThreadAliases'];
  emailThreadEdges?: ServerApiPorts['emailThreadEdges'];
  emailThreads?: ServerApiPorts['emailThreads'];
  events?: ServerEvent[];
  jobQueue?: ServerApiPorts['jobQueue'];
  jtlFirmen?: ServerApiPorts['jtlFirmen'];
  jtlOrders?: ServerApiPorts['jtlOrders'];
  jtlSync?: ServerApiPorts['jtlSync'];
  jtlVersandarten?: ServerApiPorts['jtlVersandarten'];
  jtlWarenlager?: ServerApiPorts['jtlWarenlager'];
  jtlZahlungsarten?: ServerApiPorts['jtlZahlungsarten'];
  pgpIdentities?: ServerApiPorts['pgpIdentities'];
  pgpKeyMaterial?: ServerApiPorts['pgpKeyMaterial'];
  pgpMessages?: ServerApiPorts['pgpMessages'];
  pgpPeerKeys?: ServerApiPorts['pgpPeerKeys'];
  products?: ServerApiPorts['products'];
  savedViews?: ServerApiPorts['savedViews'];
  spamDecisions?: ServerApiPorts['spamDecisions'];
  spamFeatureStats?: ServerApiPorts['spamFeatureStats'];
  spamLearningEvents?: ServerApiPorts['spamLearningEvents'];
  spamListEntries?: ServerApiPorts['spamListEntries'];
  syncInfo?: ServerApiPorts['syncInfo'];
  tasks?: ServerApiPorts['tasks'];
  workflowDelayedJobs?: ServerApiPorts['workflowDelayedJobs'];
  workflowExecution?: ServerApiPorts['workflowExecution'];
  workflowForwardDedup?: ServerApiPorts['workflowForwardDedup'];
  workflowKnowledgeBases?: ServerApiPorts['workflowKnowledgeBases'];
  workflowKnowledgeChunks?: ServerApiPorts['workflowKnowledgeChunks'];
  workflowMessageApplied?: ServerApiPorts['workflowMessageApplied'];
  workflowInboundBackfill?: ServerApiPorts['workflowInboundBackfill'];
  workflowRuns?: ServerApiPorts['workflowRuns'];
  workflowRunSteps?: ServerApiPorts['workflowRunSteps'];
  workflowNodeCatalog?: ServerApiPorts['workflowNodeCatalog'];
  workflowTemplates?: ServerApiPorts['workflowTemplates'];
  workflowVersions?: ServerApiPorts['workflowVersions'];
  workflows?: ServerApiPorts['workflows'];
} = {}): ServerApiPorts {
  const user: AuthUserRecord = {
    id: 'user-a',
    workspaceId: 'workspace-a',
    email: 'owner@example.com',
    displayName: 'Owner',
    role: 'owner',
    passwordHash: 'hash',
  };

  let failedAttempts = 0;
  let initialSetupNeeded = input.initialSetupNeeded ?? false;
  let userSequence = 1;
  let invitationSequence = 1;
  let authUsers: AuthUserAdminRecord[] = input.authUsers ? [...input.authUsers] : [{
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    disabledAt: null,
    createdAt: '2026-06-01T00:00:00.000Z',
    updatedAt: '2026-06-01T00:00:00.000Z',
  }];
  let authInvitations: Array<AuthInvitationRecord & { token: string }> = [];
  let lock: ConversationLockRecord | null = null;

  return {
    auth: {
      async getInitialSetupState() {
        return { needsInitialSetup: initialSetupNeeded };
      },
      async createInitialOwner(input) {
        if (!initialSetupNeeded) return { ok: false, code: 'already_configured' };
        initialSetupNeeded = false;
        authUsers = [{
          id: user.id,
          email: input.email,
          displayName: input.displayName,
          role: 'owner',
          disabledAt: null,
          createdAt: '2026-06-01T00:00:00.000Z',
          updatedAt: '2026-06-01T00:00:00.000Z',
        }];
        return {
          ok: true,
          user: {
            ...user,
            email: input.email,
            displayName: input.displayName,
          },
          tokens: {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            expiresInSeconds: 900,
          },
        };
      },
      async listUsers() {
        return authUsers;
      },
      async saveUser(input) {
        const duplicate = authUsers.find((candidate) =>
          candidate.email.toLowerCase() === input.email.toLowerCase() && candidate.id !== input.id);
        if (duplicate) return { ok: false, code: 'duplicate_email' };
        const now = '2026-06-04T12:00:00.000Z';

        if (!input.id) {
          if (!input.password) return { ok: false, code: 'password_required' };
          const created: AuthUserAdminRecord = {
            id: `auth-user-${userSequence++}`,
            email: input.email,
            displayName: input.displayName,
            role: input.role,
            disabledAt: input.isActive === false ? now : null,
            createdAt: now,
            updatedAt: now,
          };
          authUsers = [...authUsers, created];
          return { ok: true, user: created };
        }

        const existing = authUsers.find((candidate) => candidate.id === input.id);
        if (!existing) return { ok: false, code: 'not_found' };

        const nextDisabledAt = input.isActive === undefined
          ? existing.disabledAt
          : input.isActive
            ? null
            : now;
        if (existing.role === 'owner' && (input.role !== 'owner' || nextDisabledAt !== null)) {
          const otherActiveOwners = authUsers.filter((candidate) =>
            candidate.id !== existing.id && candidate.role === 'owner' && candidate.disabledAt === null).length;
          if (otherActiveOwners < 1) return { ok: false, code: 'last_owner_required' };
        }

        const updated: AuthUserAdminRecord = {
          ...existing,
          email: input.email,
          displayName: input.displayName,
          role: input.role,
          disabledAt: nextDisabledAt,
          updatedAt: now,
        };
        authUsers = authUsers.map((candidate) => candidate.id === updated.id ? updated : candidate);
        return { ok: true, user: updated };
      },
      async createInvitation(input) {
        if (authUsers.some((candidate) => candidate.email.toLowerCase() === input.email.toLowerCase())) {
          return { ok: false, code: 'duplicate_email' };
        }
        if (authInvitations.some((candidate) =>
          candidate.email.toLowerCase() === input.email.toLowerCase()
          && candidate.acceptedAt === null
          && candidate.revokedAt === null
          && candidate.expiresAt > '2026-06-04T12:00:00.000Z')) {
          return { ok: false, code: 'duplicate_invitation' };
        }
        const invitation: AuthInvitationRecord & { token: string } = {
          id: `auth-invite-${invitationSequence}`,
          token: `invite-token-${invitationSequence}`,
          email: input.email,
          displayName: input.displayName,
          role: input.role,
          invitedByUserId: input.actorUserId,
          acceptedAt: null,
          acceptedUserId: null,
          revokedAt: null,
          expiresAt: '2026-06-11T12:00:00.000Z',
          createdAt: '2026-06-04T12:00:00.000Z',
        };
        invitationSequence += 1;
        authInvitations = [...authInvitations, invitation];
        return { ok: true, invitation, token: invitation.token };
      },
      async getInvitationByToken(input) {
        const invitation = authInvitations.find((candidate) => candidate.token === input.token);
        if (!invitation) return { ok: false, code: 'invalid_token' };
        if (invitation.revokedAt) return { ok: false, code: 'revoked' };
        if (invitation.acceptedAt) return { ok: false, code: 'accepted' };
        if (invitation.expiresAt <= '2026-06-04T12:00:00.000Z') return { ok: false, code: 'expired' };
        return { ok: true, invitation };
      },
      async acceptInvitation(input) {
        const invitation = authInvitations.find((candidate) => candidate.token === input.token);
        if (!invitation) return { ok: false, code: 'invalid_token' };
        if (invitation.revokedAt) return { ok: false, code: 'revoked' };
        if (invitation.acceptedAt) return { ok: false, code: 'accepted' };
        if (invitation.expiresAt <= '2026-06-04T12:00:00.000Z') return { ok: false, code: 'expired' };
        if (authUsers.some((candidate) => candidate.email.toLowerCase() === invitation.email.toLowerCase())) {
          return { ok: false, code: 'duplicate_email' };
        }
        const userId = `auth-user-${userSequence++}`;
        const createdAdmin: AuthUserAdminRecord = {
          id: userId,
          email: invitation.email,
          displayName: invitation.displayName,
          role: invitation.role,
          disabledAt: null,
          createdAt: '2026-06-04T12:00:00.000Z',
          updatedAt: '2026-06-04T12:00:00.000Z',
        };
        authUsers = [...authUsers, createdAdmin];
        authInvitations = authInvitations.map((candidate) => candidate.id === invitation.id
          ? {
            ...candidate,
            acceptedAt: '2026-06-04T12:00:00.000Z',
            acceptedUserId: userId,
          }
          : candidate);
        return {
          ok: true,
          user: {
            id: userId,
            workspaceId: WORKSPACE_A_ID,
            email: invitation.email,
            displayName: invitation.displayName,
            role: invitation.role,
            passwordHash: 'hash',
          },
          tokens: {
            accessToken: 'access-token',
            refreshToken: 'refresh-token',
            expiresInSeconds: 900,
          },
        };
      },
      async findUserByEmail(email) {
        return email === user.email ? user : null;
      },
      async verifyPassword(password) {
        return password === 'correct';
      },
      async recordFailedLogin() {
        failedAttempts += 1;
        return failedAttempts;
      },
      async recordSuccessfulLogin() {
        failedAttempts = 0;
      },
      async issueTokenPair() {
        return {
          accessToken: 'access-token',
          refreshToken: 'refresh-token',
          expiresInSeconds: 900,
        };
      },
      async rotateRefreshToken({ refreshToken }) {
        if (refreshToken !== 'refresh-token') return null;
        return {
          user,
          tokens: {
            accessToken: 'access-token-rotated',
            refreshToken: 'refresh-token-rotated',
            expiresInSeconds: 900,
          },
        };
      },
      async revokeRefreshToken() {
        return true;
      },
    },
    locks: {
      async list(input) {
        return lock && input.messageIds.includes(lock.messageId) && lock.workspaceId === input.workspaceId
          ? [lock]
          : [];
      },
      async acquire(input) {
        if (lock) return { ok: false, existing: lock };
        lock = makeLock(input.messageId, input.userId, input.workspaceId, input.reason, 0);
        return { ok: true, lock };
      },
      async get(input) {
        return lock?.messageId === input.messageId && lock.workspaceId === input.workspaceId ? lock : null;
      },
      async heartbeat(input) {
        if (!lock || lock.messageId !== input.messageId || lock.userId !== input.userId) return null;
        lock = { ...lock, lastHeartbeatAt: '2026-06-02T12:01:00.000Z' };
        return lock;
      },
      async release(input) {
        if (!lock || lock.messageId !== input.messageId) return null;
        if (lock.userId !== input.userId && !input.allowAdminOverride) return null;
        const released = lock;
        lock = null;
        return released;
      },
      async forceTakeover(input) {
        const takeoverCount = lock ? lock.takeoverCount + 1 : 1;
        lock = makeLock(input.messageId, input.newUserId, input.workspaceId, input.reason, takeoverCount);
        return lock;
      },
    },
    ...(input.authInvitationMailer ? { authInvitationMailer: input.authInvitationMailer } : {}),
    ...(input.mssqlSettings ? { mssqlSettings: input.mssqlSettings } : {}),
    ...(input.activityLog ? { activityLog: input.activityLog } : {}),
    ...(input.aiReplySuggestions ? { aiReplySuggestions: input.aiReplySuggestions } : {}),
    ...(input.aiProfiles ? { aiProfiles: input.aiProfiles } : {}),
    ...(input.aiPrompts ? { aiPrompts: input.aiPrompts } : {}),
    ...(input.aiTextTransform ? { aiTextTransform: input.aiTextTransform } : {}),
    ...(input.automationApiKeys ? { automationApiKeys: input.automationApiKeys } : {}),
    ...(input.calendarEvents ? { calendarEvents: input.calendarEvents } : {}),
    ...(input.customerCustomFields ? { customerCustomFields: input.customerCustomFields } : {}),
    ...(input.customerCustomFieldValues ? { customerCustomFieldValues: input.customerCustomFieldValues } : {}),
    ...(input.customers ? { customers: input.customers } : {}),
    ...(input.deals ? { deals: input.deals } : {}),
    ...(input.emailAccountSignatures ? { emailAccountSignatures: input.emailAccountSignatures } : {}),
    ...(input.emailAccounts ? { emailAccounts: input.emailAccounts } : {}),
    ...(input.emailAttachmentContent ? { emailAttachmentContent: input.emailAttachmentContent } : {}),
    ...(input.emailAttachments ? { emailAttachments: input.emailAttachments } : {}),
    ...(input.emailCannedResponses ? { emailCannedResponses: input.emailCannedResponses } : {}),
    ...(input.emailCategories ? { emailCategories: input.emailCategories } : {}),
    ...(input.emailComposeSender ? { emailComposeSender: input.emailComposeSender } : {}),
    ...(input.emailOutboundValidation ? { emailOutboundValidation: input.emailOutboundValidation } : {}),
    ...(input.emailDiagnostics ? { emailDiagnostics: input.emailDiagnostics } : {}),
    ...(input.emailFolders ? { emailFolders: input.emailFolders } : {}),
    ...(input.emailGdprExport ? { emailGdprExport: input.emailGdprExport } : {}),
    ...(input.emailInternalNotes ? { emailInternalNotes: input.emailInternalNotes } : {}),
    ...(input.emailMessageCategories ? { emailMessageCategories: input.emailMessageCategories } : {}),
    ...(input.emailMessages ? { emailMessages: input.emailMessages } : {}),
    ...(input.emailMessageTags ? { emailMessageTags: input.emailMessageTags } : {}),
    ...(input.emailVacationTests ? { emailVacationTests: input.emailVacationTests } : {}),
    ...(input.mailConnectionTests ? { mailConnectionTests: input.mailConnectionTests } : {}),
    ...(input.emailReadReceipts ? { emailReadReceipts: input.emailReadReceipts } : {}),
    ...(input.emailReadReceiptResponder ? { emailReadReceiptResponder: input.emailReadReceiptResponder } : {}),
    ...(input.emailRemoteContentAllowlist ? { emailRemoteContentAllowlist: input.emailRemoteContentAllowlist } : {}),
    ...(input.emailOAuth ? { emailOAuth: input.emailOAuth } : {}),
    ...(input.emailTeamMembers ? { emailTeamMembers: input.emailTeamMembers } : {}),
    ...(input.emailThreadAliases ? { emailThreadAliases: input.emailThreadAliases } : {}),
    ...(input.emailThreadEdges ? { emailThreadEdges: input.emailThreadEdges } : {}),
    ...(input.emailThreads ? { emailThreads: input.emailThreads } : {}),
    ...(input.jtlFirmen ? { jtlFirmen: input.jtlFirmen } : {}),
    ...(input.jtlOrders ? { jtlOrders: input.jtlOrders } : {}),
    ...(input.jtlSync ? { jtlSync: input.jtlSync } : {}),
    ...(input.jtlVersandarten ? { jtlVersandarten: input.jtlVersandarten } : {}),
    ...(input.jtlWarenlager ? { jtlWarenlager: input.jtlWarenlager } : {}),
    ...(input.jtlZahlungsarten ? { jtlZahlungsarten: input.jtlZahlungsarten } : {}),
    ...(input.audit ? { audit: input.audit } : input.auditEvents ? {
      audit: {
        async record(event) {
          input.auditEvents?.push(event);
        },
      },
    } : {}),
    ...(input.events ? {
      events: {
        async publish(event) {
          input.events?.push(event);
        },
      },
    } : {}),
    ...(input.jobQueue ? { jobQueue: input.jobQueue } : {}),
    ...(input.pgpIdentities ? { pgpIdentities: input.pgpIdentities } : {}),
    ...(input.pgpKeyMaterial ? { pgpKeyMaterial: input.pgpKeyMaterial } : {}),
    ...(input.pgpMessages ? { pgpMessages: input.pgpMessages } : {}),
    ...(input.pgpPeerKeys ? { pgpPeerKeys: input.pgpPeerKeys } : {}),
    ...(input.products ? { products: input.products } : {}),
    ...(input.savedViews ? { savedViews: input.savedViews } : {}),
    ...(input.spamDecisions ? { spamDecisions: input.spamDecisions } : {}),
    ...(input.spamFeatureStats ? { spamFeatureStats: input.spamFeatureStats } : {}),
    ...(input.spamLearningEvents ? { spamLearningEvents: input.spamLearningEvents } : {}),
    ...(input.spamListEntries ? { spamListEntries: input.spamListEntries } : {}),
    ...(input.syncInfo ? { syncInfo: input.syncInfo } : {}),
    ...(input.tasks ? { tasks: input.tasks } : {}),
    ...(input.workflowDelayedJobs ? { workflowDelayedJobs: input.workflowDelayedJobs } : {}),
    ...(input.workflowExecution ? { workflowExecution: input.workflowExecution } : {}),
    ...(input.workflowForwardDedup ? { workflowForwardDedup: input.workflowForwardDedup } : {}),
    ...(input.workflowKnowledgeBases ? { workflowKnowledgeBases: input.workflowKnowledgeBases } : {}),
    ...(input.workflowKnowledgeChunks ? { workflowKnowledgeChunks: input.workflowKnowledgeChunks } : {}),
    ...(input.workflowMessageApplied ? { workflowMessageApplied: input.workflowMessageApplied } : {}),
    ...(input.workflowInboundBackfill ? { workflowInboundBackfill: input.workflowInboundBackfill } : {}),
    ...(input.workflowRuns ? { workflowRuns: input.workflowRuns } : {}),
    ...(input.workflowRunSteps ? { workflowRunSteps: input.workflowRunSteps } : {}),
    ...(input.workflowNodeCatalog ? { workflowNodeCatalog: input.workflowNodeCatalog } : {}),
    ...(input.workflowTemplates ? { workflowTemplates: input.workflowTemplates } : {}),
    ...(input.workflowVersions ? { workflowVersions: input.workflowVersions } : {}),
    ...(input.workflows ? { workflows: input.workflows } : {}),
  };
}

export function makeCustomerRecord(id: number): CustomerRecord {
  return {
    id,
    sourceSqliteId: id,
    customerNumber: `C-${id}`,
    name: `Customer ${id}`,
    firstName: null,
    company: `Company ${id}`,
    email: `customer${id}@example.com`,
    phone: null,
    mobile: null,
    city: 'Berlin',
    country: 'DE',
    status: 'Active',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeProductRecord(id: number): ProductRecord {
  return {
    id,
    sourceSqliteId: id,
    jtlKartikel: 1000 + id,
    name: `Product ${id}`,
    sku: `SKU-${id}`,
    description: `Product ${id} description`,
    price: `${id}.00`,
    isActive: true,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeDealRecord(id: number): DealRecord {
  return {
    id,
    sourceSqliteId: id,
    customerSourceSqliteId: 7,
    customerId: 7,
    name: `Deal ${id}`,
    value: `${id}00.00`,
    valueCalculationMethod: 'static',
    stage: 'Won',
    notes: null,
    createdDate: '2026-06-01T12:00:00.000Z',
    expectedCloseDate: null,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeTaskRecord(id: number): TaskRecord {
  return {
    id,
    sourceSqliteId: id,
    customerSourceSqliteId: 7,
    customerId: 7,
    title: `Task ${id}`,
    description: null,
    dueDate: '2026-06-04T12:00:00.000Z',
    priority: 'Medium',
    completed: false,
    snoozedUntil: null,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeCalendarEventRecord(id: number): CalendarEventRecord {
  return {
    id,
    sourceSqliteId: id,
    title: `Demo event ${id}`,
    description: 'Customer call',
    startDate: '2026-06-03T09:00:00.000Z',
    endDate: '2026-06-03T09:30:00.000Z',
    allDay: false,
    colorCode: '#336699',
    eventType: 'call',
    recurrenceRule: null,
    taskSourceSqliteId: 10,
    taskId: 10,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeCustomerCustomFieldRecord(id: number): CustomerCustomFieldRecord {
  return {
    id,
    sourceSqliteId: id,
    name: `vat_id_${id}`,
    label: 'VAT ID',
    type: 'text',
    required: false,
    options: null,
    defaultValue: null,
    placeholder: 'DE...',
    description: null,
    displayOrder: id,
    active: true,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeCustomerCustomFieldValueRecord(id: number): CustomerCustomFieldValueRecord {
  return {
    id,
    sourceSqliteId: id,
    customerSourceSqliteId: 7,
    fieldSourceSqliteId: 61,
    customerId: 7,
    fieldId: 61,
    value: 'DE123456789',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeActivityLogRecord(id: number, includeMetadata = false): ActivityLogRecord {
  return {
    id,
    sourceSqliteId: id,
    customerSourceSqliteId: 7,
    dealSourceSqliteId: 4,
    taskSourceSqliteId: 10,
    customerId: 7,
    dealId: 4,
    taskId: 10,
    activityType: 'email',
    title: `Activity ${id}`,
    description: 'Imported email activity',
    ...(includeMetadata ? { metadata: { imported: true } } : {}),
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeSavedViewRecord(id: number): SavedViewRecord {
  return {
    id,
    sourceSqliteId: id,
    name: `Open view ${id}`,
    filters: { status: 'Open' },
    displayOrder: id,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeJtlReferenceRecord(sourceSqliteId: number): JtlReferenceRecord {
  return {
    sourceSqliteId,
    name: `JTL Reference ${sourceSqliteId}`,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailAccountRecord(id: number): EmailAccountRecord {
  return {
    id,
    sourceSqliteId: id,
    displayName: `Mailbox ${id}`,
    emailAddress: `mail${id}@example.com`,
    protocol: 'imap',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapTls: true,
    imapUsername: `mail${id}@example.com`,
    smtpHost: 'smtp.example.com',
    smtpPort: 465,
    smtpTls: true,
    smtpUsername: `mail${id}@example.com`,
    smtpUseImapAuth: false,
    pop3Host: null,
    pop3Port: null,
    pop3Tls: false,
    oauthProvider: null,
    sentFolderPath: 'Sent',
    syncSpamFolderPath: 'Spam',
    syncArchiveFolderPath: 'Archive',
    imapSyncSent: true,
    imapSyncArchive: true,
    imapSyncSpam: false,
    imapSyncSeenOnOpen: true,
    vacationEnabled: false,
    vacationSubject: null,
    vacationBodyText: null,
    requestReadReceipt: false,
    defaultRemoteContentPolicy: 'ask',
    respondToReadReceipts: 'ask',
    imapPasswordConfigured: true,
    smtpPasswordConfigured: true,
    oauthRefreshConfigured: false,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeAutomationApiKeyRecord(id: string): AutomationApiKeyRecord {
  return {
    id,
    label: 'Import webhook',
    scopes: ['webhook:fire', 'mail:read'],
    lastUsedAt: null,
    revokedAt: null,
    createdByUserId: USER_A_ID,
    secretConfigured: true,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailMessageRecord(id: number, includeBody = false): EmailMessageRecord {
  return {
    id,
    sourceSqliteId: id,
    accountId: 1,
    folderId: 2,
    uid: 1000 + id,
    messageId: `<message-${id}@example.com>`,
    subject: `Message ${id}`,
    from: [{ address: 'sender@example.com', name: 'Sender' }],
    to: [{ address: 'mail1@example.com', name: 'Mailbox' }],
    cc: [],
    bcc: [],
    dateReceived: '2026-06-02T12:00:00.000Z',
    snippet: `Snippet ${id}`,
    seenLocal: false,
    doneLocal: false,
    archived: false,
    softDeleted: false,
    folderKind: 'inbox',
    threadId: `thread-${id}`,
    imapThreadId: `imap-thread-${id}`,
    ticketCode: `T-${id}`,
    customerId: 7,
    hasAttachments: false,
    assignedTo: null,
    assignedToUserId: null,
    isSpam: false,
    spamStatus: 'unknown',
    pgpStatus: null,
    remoteContentPolicy: 'ask',
    readReceiptRequested: false,
    snoozedUntil: null,
    ...(includeBody ? {
      bodyText: `Body text ${id}`,
      bodyHtml: `<p>Body html ${id}</p>`,
    } : {}),
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makePostgresEmailMessageRow(input: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  const id = Number(input.id ?? 11);
  return {
    workspace_id: WORKSPACE_A_ID,
    id,
    source_sqlite_id: id,
    account_id: 1,
    account_source_sqlite_id: 1,
    folder_id: 2,
    uid: 1000 + id,
    pop3_uidl: null,
    message_id: `<message-${id}@example.com>`,
    subject: `Message ${id}`,
    from_json: [{ address: 'sender@example.com', name: 'Sender' }],
    to_json: [{ address: 'mail1@example.com', name: 'Mailbox' }],
    cc_json: [],
    bcc_json: [],
    date_received: new Date('2026-06-02T12:00:00.000Z'),
    snippet: `Snippet ${id}`,
    seen_local: false,
    done_local: false,
    archived: false,
    soft_deleted: false,
    folder_kind: 'inbox',
    thread_id: `thread-${id}`,
    imap_thread_id: `imap-thread-${id}`,
    ticket_code: `T-${id}`,
    customer_id: 7,
    has_attachments: false,
    assigned_to: null,
    assigned_to_user_id: null,
    is_spam: false,
    spam_status: 'clean',
    pgp_status: null,
    remote_content_policy: 'ask',
    read_receipt_requested: false,
    snoozed_until: null,
    draft_attachment_paths_json: null,
    reply_parent_message_id: null,
    body_text: `Body text ${id}`,
    body_html: null,
    auth_spf: 'pass',
    auth_dkim: 'none',
    auth_dmarc: 'none',
    auth_arc: 'none',
    attachments_json: null,
    rspamd_score: null,
    rspamd_action: null,
    raw_headers: [
      `From: Sender <sender@example.com>`,
      `To: Mailbox <mail1@example.com>`,
      `Subject: Message ${id}`,
      `Message-ID: <message-${id}@example.com>`,
      'Date: Tue, 2 Jun 2026 12:00:00 +0000',
    ].join('\r\n'),
    raw_rfc822_b64: null,
    updated_at: new Date('2026-06-02T12:00:00.000Z'),
    ...input,
  };
}

export function makeFetchResponse(input: {
  status?: number;
  text?: string;
  json?: unknown;
} = {}): Response {
  const status = input.status ?? 200;
  const text = input.text ?? '';
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
    json: async () => input.json ?? {},
  } as Response;
}

export function makeEmailAttachmentRecord(id: number): EmailAttachmentRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    messageId: 11,
    filename: `attachment-${id}.pdf`,
    contentType: 'application/pdf',
    sizeBytes: id * 100,
    contentSha256: `sha256-${id}`,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailFolderRecord(id: number): EmailFolderRecord {
  return {
    id,
    sourceSqliteId: id,
    accountSourceSqliteId: 1,
    accountId: 1,
    path: id === 2 ? 'INBOX' : `Folder ${id}`,
    delimiter: '/',
    uidValidity: 12345,
    uidValidityText: '12345',
    lastUid: 998,
    lastSyncedAt: '2026-06-02T11:00:00.000Z',
    pop3Uidl: null,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailTeamMemberRecord(id: string): EmailTeamMemberRecord {
  return {
    id,
    displayName: `Agent ${id}`,
    role: 'agent',
    signatureHtml: '<p>Agent signature</p>',
    sortOrder: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailThreadRecord(id: string): EmailThreadRecord {
  return {
    id,
    ticketCode: 'T-2026-1',
    rootMessageSourceSqliteId: 11,
    rootMessageId: 11,
    lastMessageAt: '2026-06-02T12:00:00.000Z',
    messageCount: 3,
    hasUnread: true,
    hasAttachments: true,
    subjectNormalized: 'customer question',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailMessageTagRecord(id: number): EmailMessageTagRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    messageId: 11,
    tag: 'priority',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailCategoryRecord(id: number): EmailCategoryRecord {
  return {
    id,
    sourceSqliteId: id,
    parentSourceSqliteId: null,
    parentId: null,
    name: 'Support',
    sortOrder: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailMessageCategoryRecord(id: number): EmailMessageCategoryRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    categorySourceSqliteId: 61,
    messageId: 11,
    categoryId: 61,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailInternalNoteRecord(id: number): EmailInternalNoteRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    messageId: 11,
    body: 'Internal follow-up note',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailCannedResponseRecord(id: number): EmailCannedResponseRecord {
  return {
    id,
    sourceSqliteId: id,
    title: 'Shipping update',
    body: 'Your order is on the way.',
    sortOrder: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailAccountSignatureRecord(sourceSqliteId: number): EmailAccountSignatureRecord {
  return {
    sourceSqliteId,
    accountSourceSqliteId: 1,
    accountId: 1,
    signatureHtml: '<p>Mailbox signature</p>',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailRemoteContentAllowlistRecord(id: number): EmailRemoteContentAllowlistRecord {
  return {
    id,
    sourceSqliteId: id,
    scope: 'domain',
    value: 'example.com',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailReadReceiptRecord(id: number): EmailReadReceiptRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    messageId: 11,
    direction: 'outbound',
    recipient: 'customer@example.com',
    at: '2026-06-02T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailThreadEdgeRecord(id: number): EmailThreadEdgeRecord {
  return {
    id,
    sourceSqliteId: id,
    parentMessageSourceSqliteId: 10,
    childMessageSourceSqliteId: 11,
    parentMessageId: 10,
    childMessageId: 11,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeEmailThreadAliasRecord(id: number): EmailThreadAliasRecord {
  return {
    id,
    sourceSqliteId: id,
    aliasThreadId: 'thread-alias',
    canonicalThreadId: 'thread-canonical',
    confidence: 'high',
    source: 'import',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function withRuntimeLeaks<T extends object>(record: T): T {
  return {
    ...record,
    keytar_account_key: 'keytar-account-key',
    legacyKeytarAccount: 'keytar-ai-key',
    context: { secret: 'context-leak' },
    detail: { secret: 'detail-leak' },
    embedding: [1, 2, 3],
    imap_password_secret_id: 'imap-secret-id',
    imported_in_run_id: 'sqlite-import-run-id',
    secretId: 'ai-secret-id',
    smtp_password_secret_id: 'smtp-secret-id',
    key_hash: 'hashed-api-key',
    secret_id: 'automation-secret-id',
    importedInRunId: 'sqlite-import-run-id',
    log: { secret: 'log-leak' },
    rawBody: 'raw-body-leak',
    sourceRow: { secret: 'source-row-leak' },
    source_row: { secret: 'source-row-leak' },
    storagePath: '/data/attachments/workspace-a/file.pdf',
    legacyKeytarPrivateKeyHandle: 'keytar-private-key',
    privateKeySecretId: 'pgp-private-key-secret-id',
  } as T;
}

export function makeAiProfileRecord(id: number): AiProfileRecord {
  return {
    id,
    sourceSqliteId: id,
    label: `AI profile ${id}`,
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4.1',
    embeddingModel: 'text-embedding-3-small',
    isDefault: id === 21,
    sortOrder: id,
    apiKeyConfigured: true,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeAiPromptRecord(id: number): AiPromptRecord {
  return {
    id,
    sourceSqliteId: id,
    label: `AI prompt ${id}`,
    userTemplate: `Prompt template ${id}`,
    target: 'reply',
    profileSourceSqliteId: 21,
    profileId: 21,
    sortOrder: id,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeWorkflowRecord(id: number): WorkflowRecord {
  return {
    id,
    sourceSqliteId: id,
    name: `Workflow ${id}`,
    triggerName: 'mail.received',
    enabled: true,
    priority: 100,
    definition: { nodes: [{ id: 'start', type: 'trigger' }] },
    graph: { edges: [] },
    cronExpr: null,
    scheduleAccountSourceSqliteId: null,
    scheduleAccountId: null,
    executionMode: 'graph',
    engineVersion: 1,
    legacyCreatedByUserId: 'legacy-user',
    createdByUserId: null,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeWorkflowVersionRecord(id: number): WorkflowVersionRecord {
  return {
    id,
    sourceSqliteId: id,
    workflowSourceSqliteId: 23,
    workflowId: 23,
    label: `Version ${id}`,
    graph: { nodes: [{ id: 'start' }] },
    definition: { trigger: 'mail.received' },
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeWorkflowRunRecord(id: number, includeLog = false): WorkflowRunRecord {
  return {
    id,
    sourceSqliteId: id,
    workflowSourceSqliteId: 23,
    messageSourceSqliteId: 11,
    workflowId: 23,
    messageId: 11,
    direction: 'inbound',
    status: 'succeeded',
    ...(includeLog ? { log: { entries: ['run-log-entry'] } } : {}),
    startedAt: '2026-06-02T12:00:00.000Z',
    finishedAt: '2026-06-02T12:00:02.000Z',
    updatedAt: '2026-06-02T12:00:02.000Z',
  };
}

export function makeWorkflowRunStepRecord(id: number, includeDetail = false): WorkflowRunStepRecord {
  return {
    id,
    sourceSqliteId: id,
    runSourceSqliteId: 80,
    runId: 80,
    nodeId: 'reply',
    nodeType: 'ai.reply',
    status: 'succeeded',
    port: 'out',
    durationMs: 123,
    message: 'Generated reply',
    ...(includeDetail ? { detail: { tokens: 42 } } : {}),
    createdAt: '2026-06-02T12:00:01.000Z',
    updatedAt: '2026-06-02T12:00:02.000Z',
  };
}

export function makeWorkflowMessageAppliedRecord(id: number): WorkflowMessageAppliedRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    workflowSourceSqliteId: 23,
    messageId: 11,
    workflowId: 23,
    appliedAt: '2026-06-02T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeWorkflowForwardDedupRecord(id: number): WorkflowForwardDedupRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    workflowSourceSqliteId: 23,
    messageId: 11,
    workflowId: 23,
    dest: 'ops@example.com',
    createdAt: '2026-06-02T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeWorkflowKnowledgeBaseRecord(id: number): WorkflowKnowledgeBaseRecord {
  return {
    id,
    sourceSqliteId: id,
    name: 'Returns policy',
    description: 'Support knowledge base',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeWorkflowKnowledgeChunkRecord(id: number, includeContent = false): WorkflowKnowledgeChunkRecord {
  return {
    id,
    sourceSqliteId: id,
    knowledgeBaseSourceSqliteId: 90,
    knowledgeBaseId: 90,
    title: 'Return window',
    ...(includeContent ? { content: 'Customers can return items within 30 days.' } : {}),
    sourcePath: 'returns.md',
    embeddingConfigured: true,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeWorkflowDelayedJobRecord(id: number, includeContext = false): WorkflowDelayedJobRecord {
  return {
    id,
    sourceSqliteId: id,
    workflowSourceSqliteId: 23,
    messageSourceSqliteId: 11,
    workflowId: 23,
    messageId: 11,
    resumeNodeId: 'wait-1',
    executeAt: '2026-06-03T12:00:00.000Z',
    ...(includeContext ? { context: { retry: true } } : {}),
    status: 'pending',
    createdAt: '2026-06-02T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makePgpIdentityRecord(id: number): PgpIdentityRecord {
  return {
    id,
    sourceSqliteId: id,
    userId: USER_A_ID,
    legacyUserId: 'legacy-user',
    email: 'identity@example.com',
    fingerprint: `PGP-FINGERPRINT-${id}`,
    publicKeyArmor: `-----BEGIN PGP PUBLIC KEY BLOCK-----\nidentity-${id}\n-----END PGP PUBLIC KEY BLOCK-----`,
    hasPrivateKey: true,
    privateKeyConfigured: true,
    expiresAt: '2027-06-02T12:00:00.000Z',
    isPrimary: true,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makePgpPeerKeyRecord(id: number): PgpPeerKeyRecord {
  return {
    id,
    sourceSqliteId: id,
    email: 'peer@example.com',
    fingerprint: `PGP-PEER-FINGERPRINT-${id}`,
    publicKeyArmor: `-----BEGIN PGP PUBLIC KEY BLOCK-----\npeer-${id}\n-----END PGP PUBLIC KEY BLOCK-----`,
    source: 'import',
    verifiedAt: '2026-06-01T12:00:00.000Z',
    verifiedByUserId: USER_A_ID,
    legacyVerifiedByUserId: 'legacy-verifier',
    trustLevel: 'verified',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeSpamListEntryRecord(id: number): SpamListEntryRecord {
  return {
    id,
    sourceSqliteId: id,
    listType: 'block',
    patternType: 'domain',
    pattern: 'example.com',
    accountSourceSqliteId: 1,
    accountId: 1,
    note: 'Imported block rule',
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeSpamLearningEventRecord(id: number): SpamLearningEventRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    accountSourceSqliteId: 1,
    messageId: 11,
    accountId: 1,
    label: 'spam',
    source: 'user',
    featureKeys: ['sender:example.com'],
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeSpamDecisionRecord(id: number): SpamDecisionRecord {
  return {
    id,
    sourceSqliteId: id,
    messageSourceSqliteId: 11,
    accountSourceSqliteId: 1,
    messageId: 11,
    accountId: 1,
    score: 73,
    status: 'review',
    source: 'bayes',
    breakdown: { sender: 42 },
    modelVersion: 1,
    createdAt: '2026-06-01T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeSpamFeatureStatRecord(featureKey: string): SpamFeatureStatRecord {
  return {
    featureKey,
    spamCount: 5,
    hamCount: 2,
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export function makeServerEventForTest(input: {
  workspaceId: string;
  entityId: string;
  actorUserId: string;
  type?: ServerEvent['type'];
  entityType?: ServerEvent['entityType'];
  payload?: Record<string, unknown>;
}): ServerEvent {
  return {
    type: input.type ?? 'conversation_lock.acquired',
    workspaceId: input.workspaceId,
    entityType: input.entityType ?? 'email_message',
    entityId: input.entityId,
    actorUserId: input.actorUserId,
    occurredAt: '2026-06-03T00:00:00.000Z',
    payload: input.payload ?? { messageId: Number(input.entityId) },
  };
}

export type PostgresEventFakeRow = {
  sequence: number;
  workspace_id: string;
  type: string;
  entity_type: string;
  entity_id: string;
  actor_user_id: string;
  occurred_at: string;
  payload: Record<string, unknown>;
};

export function makePostgresEventDb(): {
  db: Kysely<ServerDatabase>;
  rows: PostgresEventFakeRow[];
  sessionCommands: ReturnType<typeof buildWorkspaceSessionCommand>[];
} {
  const rows: PostgresEventFakeRow[] = [];
  const sessionCommands: ReturnType<typeof buildWorkspaceSessionCommand>[] = [];
  const db = {
    insertInto(table: string) {
      if (table !== 'server_events') throw new Error(`unexpected insert table: ${table}`);
      return new FakePostgresEventInsert(rows);
    },
    selectFrom(table: string) {
      if (table !== 'server_events') throw new Error(`unexpected select table: ${table}`);
      return new FakePostgresEventSelect(rows);
    },
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
      };
    },
  } as unknown as Kysely<ServerDatabase>;

  return { db, rows, sessionCommands };
}

export function makeFakePostgresEventNotifications() {
  const subscribers = new Set<(notification: { workspaceId: string; sequence: number }) => void | Promise<void>>();
  const sent: Array<{ workspaceId: string; sequence: number }> = [];

  return {
    sent,
    async notify(notification: { workspaceId: string; sequence: number }) {
      sent.push(notification);
      for (const subscriber of [...subscribers]) {
        await subscriber(notification);
      }
    },
    subscribe(subscriber: (notification: { workspaceId: string; sequence: number }) => void | Promise<void>) {
      subscribers.add(subscriber);
      return {
        unsubscribe() {
          subscribers.delete(subscriber);
        },
      };
    },
  };
}

export function makeFakeNotificationClient() {
  let notificationListener: ((message: { payload?: string }) => void) | null = null;
  let connected = false;
  let ended = false;
  const queries: Array<{ sql: string; params?: readonly unknown[] }> = [];

  return {
    get connected() {
      return connected;
    },
    get ended() {
      return ended;
    },
    queries,
    async connect() {
      connected = true;
    },
    async query(sql: string, params?: readonly unknown[]) {
      queries.push({ sql, params });
      return {};
    },
    async end() {
      ended = true;
    },
    on(event: 'notification', listener: (message: { payload?: string }) => void) {
      if (event === 'notification') {
        notificationListener = listener;
      }
    },
    emitNotification(payload: string) {
      notificationListener?.({ payload });
    },
  };
}

export function sha256Text(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export type FakePostgresJobQueueRow = {
  id: number;
  type: string;
  payload: Record<string, unknown>;
  run_after: Date;
  attempts: number;
  max_attempts: number;
  locked_at: Date | null;
  locked_by: string | null;
  last_error: string | null;
  workspace_id: string;
  created_at: Date;
  updated_at: Date;
};

export function makeFakePostgresJobQueueDb(): {
  db: Kysely<ServerDatabase>;
  rows: FakePostgresJobQueueRow[];
  sessionCommands: ReturnType<typeof buildWorkspaceSessionCommand>[];
} {
  const rows: FakePostgresJobQueueRow[] = [];
  const sessionCommands: ReturnType<typeof buildWorkspaceSessionCommand>[] = [];
  const db = {
    selectFrom(table: string) {
      if (table !== 'job_queue') throw new Error(`unexpected job queue select table: ${table}`);
      return new FakePostgresJobQueueSelect(rows);
    },
    updateTable(table: string) {
      if (table !== 'job_queue') throw new Error(`unexpected job queue update table: ${table}`);
      return new FakePostgresJobQueueUpdate(rows);
    },
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
      };
    },
  } as unknown as Kysely<ServerDatabase>;

  return { db, rows, sessionCommands };
}

export function makeFakePostgresJobQueueRow(input: Partial<FakePostgresJobQueueRow> = {}): FakePostgresJobQueueRow {
  const createdAt = new Date('2026-06-05T08:00:00.000Z');
  return {
    id: input.id ?? 1,
    type: input.type ?? 'mail.sync.imap',
    payload: input.payload ?? {},
    run_after: input.run_after ?? createdAt,
    attempts: input.attempts ?? 0,
    max_attempts: input.max_attempts ?? 5,
    locked_at: input.locked_at ?? null,
    locked_by: input.locked_by ?? null,
    last_error: input.last_error ?? null,
    workspace_id: input.workspace_id ?? WORKSPACE_A_ID,
    created_at: input.created_at ?? createdAt,
    updated_at: input.updated_at ?? createdAt,
  };
}

export class FakePostgresJobQueueSelect {
  private requireUnlocked = false;

  private requireLocked = false;

  private requireAttemptsRemaining = false;

  private readyAt: Date | null = null;

  private staleBefore: Date | null = null;

  private rowLimit = Number.POSITIVE_INFINITY;

  constructor(private readonly rows: FakePostgresJobQueueRow[]) {}

  selectAll(): this {
    return this;
  }

  select(): this {
    return this;
  }

  where(column: string, operator: string, value: unknown): this {
    if (column === 'locked_at' && operator === 'is') this.requireUnlocked = true;
    if (column === 'locked_at' && operator === 'is not') this.requireLocked = true;
    if (column === 'locked_at' && operator === '<') this.staleBefore = value as Date;
    if (column === 'run_after' && operator === '<=') this.readyAt = value as Date;
    return this;
  }

  whereRef(leftColumn: string, operator: string, rightColumn: string): this {
    if (leftColumn === 'attempts' && operator === '<' && rightColumn === 'max_attempts') {
      this.requireAttemptsRemaining = true;
    }
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(value: number): this {
    this.rowLimit = value;
    return this;
  }

  async execute(): Promise<readonly FakePostgresJobQueueRow[]> {
    return this.filteredRows().slice(0, this.rowLimit);
  }

  async executeTakeFirst(): Promise<FakePostgresJobQueueRow | undefined> {
    return this.filteredRows()[0];
  }

  private filteredRows(): FakePostgresJobQueueRow[] {
    return this.rows
      .filter((row) => {
        if (this.requireUnlocked && row.locked_at !== null) return false;
        if (this.requireLocked && row.locked_at === null) return false;
        if (this.requireAttemptsRemaining && row.attempts >= row.max_attempts) return false;
        if (this.readyAt && row.run_after > this.readyAt) return false;
        if (this.staleBefore && (!row.locked_at || row.locked_at >= this.staleBefore)) return false;
        return true;
      })
      .sort((left, right) => (
        left.run_after.getTime() - right.run_after.getTime()
        || left.id - right.id
      ));
  }
}

export class FakePostgresJobQueueUpdate {
  private values: Partial<Pick<FakePostgresJobQueueRow, 'locked_at' | 'locked_by' | 'updated_at'>> = {};

  private idEquals: number | null = null;

  private idsIn: readonly number[] | null = null;

  private requireUnlocked = false;

  constructor(private readonly rows: FakePostgresJobQueueRow[]) {}

  set(values: Partial<Pick<FakePostgresJobQueueRow, 'locked_at' | 'locked_by' | 'updated_at'>>): this {
    this.values = values;
    return this;
  }

  where(column: string, operator: string, value: unknown): this {
    if (column === 'id' && operator === '=') this.idEquals = Number(value);
    if (column === 'id' && operator === 'in') this.idsIn = value as readonly number[];
    if (column === 'locked_at' && operator === 'is') this.requireUnlocked = true;
    return this;
  }

  returningAll(): this {
    return this;
  }

  async execute(): Promise<readonly FakePostgresJobQueueRow[]> {
    const rows = this.matchingRows();
    for (const row of rows) Object.assign(row, this.values);
    return rows;
  }

  async executeTakeFirst(): Promise<FakePostgresJobQueueRow | undefined> {
    return (await this.execute())[0];
  }

  private matchingRows(): FakePostgresJobQueueRow[] {
    return this.rows.filter((row) => {
      if (this.idEquals !== null && row.id !== this.idEquals) return false;
      if (this.idsIn !== null && !this.idsIn.includes(row.id)) return false;
      if (this.requireUnlocked && row.locked_at !== null) return false;
      return true;
    });
  }
}

export type PostgresAuthSessionFakeRow = {
  token_id: string;
  user_id: string;
  workspace_id: string;
  role: 'owner' | 'admin' | 'user';
  expires_at: string;
  revoked_at: string | null;
  disabled_at: string | null;
};

export class FakePostgresAuthSessionSelect {
  private readonly filters = new Map<string, unknown>();

  constructor(private readonly rows: PostgresAuthSessionFakeRow[]) {}

  innerJoin() {
    return this;
  }

  select() {
    return this;
  }

  where(column: string, operator: string, value: unknown) {
    if (operator !== '=') throw new Error(`unexpected auth-session operator: ${operator}`);
    this.filters.set(column, value);
    return this;
  }

  async executeTakeFirst(): Promise<PostgresAuthSessionFakeRow | undefined> {
    return this.rows.find((row) => (
      this.matches('refresh_tokens.id', row.token_id)
      && this.matches('refresh_tokens.user_id', row.user_id)
      && this.matches('refresh_tokens.workspace_id', row.workspace_id)
    ));
  }

  private matches(column: string, value: unknown): boolean {
    return !this.filters.has(column) || this.filters.get(column) === value;
  }
}

export class FakePostgresEventInsert {
  private row: Omit<PostgresEventFakeRow, 'sequence'> | null = null;

  constructor(private readonly rows: PostgresEventFakeRow[]) {}

  values(input: {
    workspace_id: string;
    type: string;
    entity_type: string;
    entity_id: string;
    actor_user_id: string;
    occurred_at: string | Date;
    payload: unknown;
  }): this {
    this.row = {
      workspace_id: input.workspace_id,
      type: input.type,
      entity_type: input.entity_type,
      entity_id: input.entity_id,
      actor_user_id: input.actor_user_id,
      occurred_at: input.occurred_at instanceof Date ? input.occurred_at.toISOString() : input.occurred_at,
      payload: isTestRecord(input.payload) ? input.payload : {},
    };
    return this;
  }

  returning(): this {
    return this;
  }

  async executeTakeFirstOrThrow(): Promise<PostgresEventFakeRow> {
    if (!this.row) throw new Error('missing event row');
    const stored = {
      ...this.row,
      sequence: this.rows.length + 1,
    };
    this.rows.push(stored);
    return stored;
  }
}

export class FakePostgresEventSelect {
  private workspaceId = '';

  private afterSequence = 0;

  private sequenceEquals: number | null = null;

  private rowLimit = 1000;

  constructor(private readonly rows: PostgresEventFakeRow[]) {}

  select(): this {
    return this;
  }

  where(column: string, operator: string, value: unknown): this {
    if (column === 'workspace_id' && operator === '=') {
      this.workspaceId = String(value);
    }
    if (column === 'sequence' && operator === '>') {
      this.afterSequence = Number(value);
    }
    if (column === 'sequence' && operator === '=') {
      this.sequenceEquals = Number(value);
    }
    return this;
  }

  orderBy(): this {
    return this;
  }

  limit(value: number): this {
    this.rowLimit = value;
    return this;
  }

  async execute(): Promise<readonly PostgresEventFakeRow[]> {
    return this.rows
      .filter((row) => row.workspace_id === this.workspaceId && row.sequence > this.afterSequence)
      .sort((left, right) => left.sequence - right.sequence)
      .slice(0, this.rowLimit);
  }

  async executeTakeFirst(): Promise<PostgresEventFakeRow | undefined> {
    return this.rows.find((row) => (
      row.workspace_id === this.workspaceId
      && row.sequence === this.sequenceEquals
    ));
  }
}

export function isTestRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function makeMigrationDatabase(): MigrationDatabase & {
  readonly metadataRows: MigrationMetadataRow[];
  readonly executedSql: string[];
  readonly transactionCount: number;
} {
  const metadataRows: MigrationMetadataRow[] = [];
  const executedSql: string[] = [];
  let transactionCount = 0;

  const database: MigrationDatabase & {
    readonly metadataRows: MigrationMetadataRow[];
    readonly executedSql: string[];
    readonly transactionCount: number;
  } = {
    metadataRows,
    executedSql,
    get transactionCount() {
      return transactionCount;
    },
    async execute(sql, params) {
      executedSql.push(sql);
      if (!sql.includes('INSERT INTO simplecrm_schema_migrations')) return;

      const [id, description, checksum] = params ?? [];
      if (typeof id !== 'string' || typeof description !== 'string' || typeof checksum !== 'string') {
        throw new Error('Invalid migration metadata insert parameters');
      }
      metadataRows.push({
        id,
        description,
        checksum,
        appliedAt: '2026-06-02T12:00:00.000Z',
      });
    },
    async query<T extends Record<string, unknown> = Record<string, unknown>>(sql: string): Promise<readonly T[]> {
      if (sql.includes('FROM simplecrm_schema_migrations')) {
        return metadataRows as unknown as readonly T[];
      }
      return [];
    },
    async transaction<T>(callback: (transaction: MigrationDatabase) => Promise<T>): Promise<T> {
      transactionCount += 1;
      return callback(database);
    },
  };

  return database;
}

export function makeJobQueuePort(initialJobs: QueuedJob[]): JobQueuePort & {
  readonly completedIds: number[];
  readonly failures: string[];
} {
  const jobs = [...initialJobs];
  const completedIds: number[] = [];
  const failures: string[] = [];

  return {
    completedIds,
    failures,
    async enqueue() {
      throw new Error('not used in this test');
    },
    async claimNext({ workerId }) {
      const job = jobs.shift();
      return job ? { ...job, lockedBy: workerId, lockedAt: '2026-06-02T12:00:00.000Z' } : null;
    },
    async complete(job) {
      completedIds.push(job.id);
      return true;
    },
    async fail(input) {
      failures.push(input.error instanceof Error ? input.error.message : String(input.error));
      return {
        ...input.job,
        attempts: input.job.attempts + 1,
        lockedAt: null,
        lockedBy: null,
        lastError: failures[failures.length - 1],
      };
    },
    async releaseStaleLocks() {
      return [];
    },
  };
}

export function makeQueuedJob(input: {
  id: number;
  type: string;
  payload?: Record<string, unknown>;
  workspaceId?: string;
  attempts?: number;
  maxAttempts?: number;
}): QueuedJob {
  return {
    id: input.id,
    type: input.type,
    payload: input.payload ?? { id: input.id },
    runAfter: '2026-06-02T12:00:00.000Z',
    attempts: input.attempts ?? 0,
    maxAttempts: input.maxAttempts ?? 5,
    lockedAt: null,
    lockedBy: null,
    lastError: null,
    workspaceId: input.workspaceId ?? 'workspace-a',
    createdAt: '2026-06-02T12:00:00.000Z',
    updatedAt: '2026-06-02T12:00:00.000Z',
  };
}

export type MaintenanceDbCall = Readonly<
  | {
    kind: 'select';
    table: string;
    selected: string | readonly string[];
    wheres: readonly MaintenanceWhere[];
    orderBy: readonly [string, string] | null;
    limit: number | null;
  }
  | {
    kind: 'delete';
    table: string;
    wheres: readonly MaintenanceWhere[];
  }
>;

export type MaintenanceWhere = readonly [string, string, unknown];

export function makeMaintenanceDb(rows: Record<string, readonly Record<string, unknown>[]>) {
  const calls: MaintenanceDbCall[] = [];
  const db = {
    selectFrom(table: string) {
      return new FakeMaintenanceSelect(table, rows[table] ?? [], calls);
    },
    deleteFrom(table: string) {
      return new FakeMaintenanceDelete(table, calls);
    },
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
      };
    },
  } as unknown as Kysely<ServerDatabase>;

  return { db, calls };
}

export class FakeMaintenanceSelect {
  private selected: string | readonly string[] = '';

  private readonly wheres: MaintenanceWhere[] = [];

  private order: readonly [string, string] | null = null;

  private rowLimit: number | null = null;

  constructor(
    private readonly table: string,
    private readonly rows: readonly Record<string, unknown>[],
    private readonly calls: MaintenanceDbCall[],
  ) {}

  select(columns: string | readonly string[]): this {
    this.selected = columns;
    return this;
  }

  where(column: string, operator: string, value: unknown): this {
    this.wheres.push([column, operator, value]);
    return this;
  }

  orderBy(column: string, direction: string): this {
    this.order = [column, direction];
    return this;
  }

  limit(value: number): this {
    this.rowLimit = value;
    return this;
  }

  async execute(): Promise<readonly Record<string, unknown>[]> {
    this.calls.push({
      kind: 'select',
      table: this.table,
      selected: this.selected,
      wheres: this.wheres,
      orderBy: this.order,
      limit: this.rowLimit,
    });
    return this.rows;
  }
}

export class FakeMaintenanceDelete {
  private readonly wheres: MaintenanceWhere[] = [];

  constructor(
    private readonly table: string,
    private readonly calls: MaintenanceDbCall[],
  ) {}

  where(column: string, operator: string, value: unknown): this {
    this.wheres.push([column, operator, value]);
    return this;
  }

  async executeTakeFirst(): Promise<{ numDeletedRows: bigint }> {
    this.calls.push({
      kind: 'delete',
      table: this.table,
      wheres: this.wheres,
    });
    return { numDeletedRows: BigInt(1) };
  }
}

export type AuditPortRawCall = Readonly<{
  kind: 'raw';
  sql: string;
  parameters: readonly unknown[];
}>;

export type AuditPortSelectCall = Readonly<{
  kind: 'select';
  table: string;
  selected: string | readonly string[];
  wheres: readonly MaintenanceWhere[];
  orderBy: readonly [string, string] | null;
}>;

export type AuditPortInsertCall = Readonly<{
  kind: 'insert';
  table: string;
  values: Record<string, unknown>;
}>;

export type AuditPortDbCall = AuditPortRawCall | AuditPortSelectCall | AuditPortInsertCall;

export type KyselyRawOperationNode = Readonly<{
  kind: string;
  sqlFragments?: readonly string[];
  parameters?: readonly KyselyRawOperationNode[];
  value?: unknown;
}>;

export function makeAuditPortDb(initialRows: readonly AuditHashChainRow[]): {
  db: Kysely<ServerDatabase>;
  rows: Array<Record<string, unknown>>;
  calls: AuditPortDbCall[];
};
export function makeAuditPortDb(
  initialRows: readonly AuditHashChainRow[],
  options: { serializeAdvisoryLocks?: boolean } = {},
): {
  db: Kysely<ServerDatabase>;
  rows: Array<Record<string, unknown>>;
  calls: AuditPortDbCall[];
} {
  const rows: Array<Record<string, unknown>> = initialRows.map((row) => ({ ...row }));
  const calls: AuditPortDbCall[] = [];
  const locks = makeAuditPortLockManager();
  const makeDbHandle = (releases: Array<() => void>) => ({
    getExecutor() {
      return {
        transformQuery(node: KyselyRawOperationNode) {
          return node;
        },
        compileQuery(node: KyselyRawOperationNode) {
          return compileAuditRawNode(node);
        },
        async executeQuery(compiled: { sql: string; parameters: readonly unknown[] }) {
          const sql = normalizeSqlForTest(compiled.sql);
          if (options.serializeAdvisoryLocks === true && sql.includes('pg_advisory_xact_lock')) {
            releases.push(await locks.acquire(String(compiled.parameters[0])));
          }
          calls.push({
            kind: 'raw',
            sql,
            parameters: compiled.parameters,
          });
          return { rows: [] };
        },
      };
    },
    selectFrom(table: string) {
      if (table !== 'audit_events') throw new Error(`unexpected audit select table: ${table}`);
      return new FakeAuditPortSelect(table, rows, calls);
    },
    insertInto(table: string) {
      if (table !== 'audit_events') throw new Error(`unexpected audit insert table: ${table}`);
      return new FakeAuditPortInsert(table, rows, calls);
    },
  });
  const db = {
    ...makeDbHandle([]),
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => {
          const releases: Array<() => void> = [];
          try {
            return await operation(makeDbHandle(releases));
          } finally {
            for (const release of releases.reverse()) release();
          }
        },
      };
    },
  } as unknown as Kysely<ServerDatabase>;

  return { db, rows, calls };
}

export class FakeAuditPortSelect {
  private selected: string | readonly string[] = '';

  private readonly wheres: MaintenanceWhere[] = [];

  private order: readonly [string, string] | null = null;

  constructor(
    private readonly table: string,
    private readonly rows: readonly Record<string, unknown>[],
    private readonly calls: AuditPortDbCall[],
  ) {}

  select(columns: string | readonly string[]): this {
    this.selected = columns;
    return this;
  }

  where(column: string, operator: string, value: unknown): this {
    this.wheres.push([column, operator, value]);
    return this;
  }

  orderBy(column: string, direction: string): this {
    this.order = [column, direction];
    return this;
  }

  async executeTakeFirst(): Promise<Record<string, unknown> | undefined> {
    this.calls.push({
      kind: 'select',
      table: this.table,
      selected: this.selected,
      wheres: [...this.wheres],
      orderBy: this.order,
    });
    return this.filteredRows()[0];
  }

  private filteredRows(): Record<string, unknown>[] {
    const filtered = this.rows.filter((row) => this.wheres.every(([column, operator, value]) => {
      if (operator !== '=') throw new Error(`unexpected audit select operator: ${operator}`);
      return row[column] === value;
    }));
    const sorted = [...filtered];
    if (this.order) {
      const [column, direction] = this.order;
      sorted.sort((left, right) => {
        const leftValue = Number(left[column] ?? 0);
        const rightValue = Number(right[column] ?? 0);
        return direction === 'desc' ? rightValue - leftValue : leftValue - rightValue;
      });
    }
    return sorted.map((row) => projectAuditRow(row, this.selected));
  }
}

export class FakeAuditPortInsert {
  private pendingValues: Record<string, unknown> | null = null;

  constructor(
    private readonly table: string,
    private readonly rows: Array<Record<string, unknown>>,
    private readonly calls: AuditPortDbCall[],
  ) {}

  values(values: Record<string, unknown>): this {
    this.pendingValues = { ...values };
    return this;
  }

  async execute(): Promise<void> {
    if (!this.pendingValues) throw new Error('missing audit insert values');
    const nextId = Math.max(0, ...this.rows.map((row) => Number(row.id ?? 0))) + 1;
    const row = { id: nextId, ...this.pendingValues };
    this.calls.push({
      kind: 'insert',
      table: this.table,
      values: row,
    });
    this.rows.push(row);
  }
}

export function compileAuditRawNode(node: KyselyRawOperationNode): {
  sql: string;
  parameters: readonly unknown[];
} {
  if (node.kind !== 'RawNode' || !node.sqlFragments) {
    throw new Error(`unexpected audit raw node: ${node.kind}`);
  }
  const parameters = (node.parameters ?? []).map((parameter) => {
    if (parameter.kind !== 'ValueNode') throw new Error(`unexpected audit raw parameter: ${parameter.kind}`);
    return parameter.value;
  });
  const sql = node.sqlFragments
    .map((fragment, index) => `${fragment}${index < parameters.length ? `$${index + 1}` : ''}`)
    .join('');
  return { sql, parameters };
}

export function makeAuditPortLockManager(): {
  acquire(key: string): Promise<() => void>;
} {
  const tails = new Map<string, Promise<void>>();
  return {
    async acquire(key: string): Promise<() => void> {
      const previous = tails.get(key) ?? Promise.resolve();
      let release = () => {};
      const current = new Promise<void>((resolve) => {
        release = resolve;
      });
      tails.set(key, previous.then(() => current));
      await previous;
      return release;
    },
  };
}

export function projectAuditRow(
  row: Record<string, unknown>,
  selected: string | readonly string[],
): Record<string, unknown> {
  if (!selected) return row;
  const columns = typeof selected === 'string' ? [selected] : selected;
  return Object.fromEntries(columns.map((column) => [column, row[column]]));
}

export function normalizeSqlForTest(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

export function makeSqlitePlan(tableNames: readonly string[]): SqliteMigrationPlan {
  return {
    id: 'test-sqlite-plan',
    description: 'Focused SQLite migration test plan',
    tables: tableNames.map((name) => {
      const table = sqliteServerEditionMigrationPlan.tables.find((candidate) => candidate.name === name);
      if (!table) {
        throw new Error(`Unknown SQLite migration test table: ${name}`);
      }
      return table;
    }),
  };
}

export function makeSqliteSource(tables: Record<string, readonly SqliteMigrationRow[]>): SqliteMigrationSourcePort & {
  readonly reads: SqliteMigrationReadRowsInput[];
} {
  const reads: SqliteMigrationReadRowsInput[] = [];

  return {
    reads,
    async tableExists(tableName) {
      return Object.prototype.hasOwnProperty.call(tables, tableName);
    },
    async countRows(tableName) {
      return tables[tableName]?.length ?? 0;
    },
    async readRows(input) {
      reads.push(input);
      const rows = [...(tables[input.tableName] ?? [])].sort((left, right) => (
        compareSqlitePrimaryKey(left[input.primaryKey], right[input.primaryKey])
      ));
      return rows
        .filter((row) => input.afterPrimaryKey === null
          || compareSqlitePrimaryKey(row[input.primaryKey], input.afterPrimaryKey) > 0)
        .slice(0, input.limit);
    },
  };
}

export function makeSqliteDatabaseLike(): SqliteDatabaseLike & { readonly statements: string[] } {
  const statements: string[] = [];

  return {
    statements,
    prepare(sql) {
      statements.push(sql);
      return {
        get(...params: readonly unknown[]) {
          if (sql.includes('sqlite_master')) {
            return params[0] === 'customers' ? { present: 1 } : undefined;
          }
          if (sql.includes('COUNT(*)') && sql.includes('"customers"')) {
            return { count: 2 };
          }
          throw new Error(`unexpected sqlite get: ${sql}`);
        },
        all(...params: readonly unknown[]) {
          if (sql.includes('FROM "customers"') && sql.includes('ORDER BY "id"')) {
            expect(params).toEqual(['1', 10]);
            return [{ id: 2, name: 'Bob', avatar: Buffer.from('avatar') }];
          }
          if (sql.includes('FROM "email_message_categories"') && sql.includes('ORDER BY rowid')) {
            expect(params).toEqual([5]);
            return [{ rowid: 7, message_id: 12, category_id: 3 }];
          }
          throw new Error(`unexpected sqlite all: ${sql}`);
        },
      };
    },
  };
}

export function makeSqliteImportTarget(input: {
  checkpoints?: readonly SqliteImportTableCheckpoint[];
  validateStagedTables?: boolean;
  forceValidationMismatch?: boolean;
} = {}): SqliteMigrationTargetPort & {
  readonly beginRuns: BeginSqliteImportRunInput[];
  readonly beginTables: BeginSqliteImportTableInput[];
  readonly checkpoints: Map<string, SqliteImportTableCheckpoint>;
  readonly completedRuns: CompleteSqliteImportRunInput[];
  readonly failedRuns: FailSqliteImportRunInput[];
  readonly upserts: UpsertSqliteMigrationRowsInput[];
  readonly validations: Array<{ tableName: string; ok: boolean }>;
} {
  const beginRuns: BeginSqliteImportRunInput[] = [];
  const beginTables: BeginSqliteImportTableInput[] = [];
  const checkpoints = new Map<string, SqliteImportTableCheckpoint>();
  const completedRuns: CompleteSqliteImportRunInput[] = [];
  const failedRuns: FailSqliteImportRunInput[] = [];
  const upserts: UpsertSqliteMigrationRowsInput[] = [];
  const validations: Array<{ tableName: string; ok: boolean }> = [];

  for (const checkpoint of input.checkpoints ?? []) {
    checkpoints.set(checkpoint.tableName, checkpoint);
  }

  return {
    beginRuns,
    beginTables,
    checkpoints,
    completedRuns,
    failedRuns,
    upserts,
    validations,
    async beginRun(runInput) {
      beginRuns.push(runInput);
      return { runId: 'run-1' };
    },
    async getTableCheckpoint(_runId, tableName) {
      return checkpoints.get(tableName) ?? null;
    },
    async beginTable(tableInput) {
      beginTables.push(tableInput);
      if (!checkpoints.has(tableInput.table.name) || tableInput.status === 'dry_run') {
        checkpoints.set(tableInput.table.name, {
          runId: tableInput.runId,
          tableName: tableInput.table.name,
          status: tableInput.status,
          sourceRowCount: tableInput.sourceRowCount,
          copiedRowCount: 0,
          lastSourcePrimaryKey: null,
        });
      }
    },
    async upsertRows(upsertInput) {
      upserts.push(upsertInput);
    },
    ...(input.validateStagedTables ? {
      async validateStagedTable(validationInput) {
        const rows = upserts
          .filter((upsert) => upsert.runId === validationInput.runId
            && upsert.workspaceId === validationInput.workspaceId
            && upsert.table.name === validationInput.table.name)
          .flatMap((upsert) => [...upsert.rows]);
        const stagedRowCount = input.forceValidationMismatch ? Math.max(0, rows.length - 1) : rows.length;
        const stagedTableHash = input.forceValidationMismatch
          ? 'sha256:mismatch'
          : hashSqliteMigrationRowSet(rows.map((row) => ({
            sourcePk: String(row[validationInput.table.primaryKey]),
            rowHash: hashSqliteMigrationRow(row),
          })));
        const ok = stagedRowCount === validationInput.sourceRowCount
          && stagedTableHash === validationInput.sourceTableHash;
        validations.push({ tableName: validationInput.table.name, ok });
        return {
          ok,
          stagedRowCount,
          sourceRowCount: validationInput.sourceRowCount,
          sourceTableHash: validationInput.sourceTableHash,
          stagedTableHash,
          ...(ok ? {} : { error: `forced validation mismatch for ${validationInput.table.name}` }),
        };
      },
    } : {}),
    async updateTableCheckpoint(checkpointInput) {
      checkpoints.set(checkpointInput.tableName, checkpointFromUpdate(checkpointInput));
    },
    async skipTable(checkpointInput) {
      checkpoints.set(checkpointInput.tableName, checkpointFromUpdate(checkpointInput));
    },
    async completeRun(completeInput) {
      completedRuns.push(completeInput);
    },
    async failRun(failInput) {
      failedRuns.push(failInput);
    },
  };
}

export function checkpointFromUpdate(input: UpdateSqliteImportTableCheckpointInput): SqliteImportTableCheckpoint {
  return {
    runId: input.runId,
    tableName: input.tableName,
    status: input.status,
    sourceRowCount: input.sourceRowCount,
    copiedRowCount: input.copiedRowCount,
    lastSourcePrimaryKey: input.lastSourcePrimaryKey,
    error: input.error ?? null,
  };
}

export function compareSqlitePrimaryKey(left: unknown, right: unknown): number {
  if (typeof left === 'number' && Number.isFinite(left)) {
    const rightNumber = typeof right === 'number' ? right : Number(right);
    return left - rightNumber;
  }
  if (typeof right === 'number' && Number.isFinite(right)) {
    const leftNumber = typeof left === 'number' ? left : Number(left);
    return leftNumber - right;
  }
  return String(left).localeCompare(String(right));
}

export function makeCliIo(): {
  stdout: { write(chunk: string): void };
  stderr: { write(chunk: string): void };
  stdoutOutput(): string;
  stderrOutput(): string;
} {
  let stdout = '';
  let stderr = '';

  return {
    stdout: {
      write(chunk) {
        stdout += chunk;
      },
    },
    stderr: {
      write(chunk) {
        stderr += chunk;
      },
    },
    stdoutOutput() {
      return stdout;
    },
    stderrOutput() {
      return stderr;
    },
  };
}

export type RlsFakeRow = Record<string, unknown>;

export function makeRlsCheckClient(): RlsCheckPgClient & {
  readonly connected: boolean;
  readonly ended: boolean;
  readonly queries: Array<{ sql: string; params?: readonly unknown[] }>;
} {
  let connected = false;
  let ended = false;
  let currentWorkspaceId = '';
  let currentRole = 'system';
  let crossWorkspaceAccess = false;
  let nextCustomerId = 1;
  const queries: Array<{ sql: string; params?: readonly unknown[] }> = [];
  const workspaces = new Set<string>();
  const users = new Set<string>();
  const customers: Array<{ id: number; workspaceId: string; sourceSqliteId: number }> = [];
  const secrets: Array<{ workspaceId: string; kind: string; name: string }> = [];

  function canAccessWorkspace(workspaceId: string): boolean {
    return workspaceId === currentWorkspaceId
      || (crossWorkspaceAccess && ['owner', 'admin', 'system'].includes(currentRole));
  }

  function assertRlsWorkspace(workspaceId: unknown): string {
    const normalized = String(workspaceId);
    if (!canAccessWorkspace(normalized)) {
      throw new Error('new row violates row-level security policy for table');
    }
    return normalized;
  }

  return {
    get connected() {
      return connected;
    },
    get ended() {
      return ended;
    },
    queries,
    async connect() {
      connected = true;
    },
    async end() {
      ended = true;
    },
    async query<T extends RlsFakeRow = RlsFakeRow>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ rows: readonly T[] }> {
      queries.push({ sql, params });
      const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

      if (
        normalized === 'begin'
        || normalized === 'rollback'
        || normalized.startsWith('savepoint ')
        || normalized.startsWith('rollback to savepoint ')
        || normalized.startsWith('release savepoint ')
      ) {
        return { rows: [] };
      }

      if (normalized.startsWith('select set_config')) {
        currentWorkspaceId = String(params?.[0] ?? '');
        currentRole = String(params?.[2] ?? '');
        crossWorkspaceAccess = String(params?.[3] ?? 'off') === 'on';
        return { rows: [] };
      }

      if (normalized.startsWith('select c.relrowsecurity as row_security_enabled')) {
        const tableName = String(params?.[0] ?? '');
        const policyName = String(params?.[1] ?? '');
        const table = RLS_POLICY_COVERAGE_TABLES.find((item) => item.tableName === tableName);
        if (!table) return { rows: [] };
        return {
          rows: [{
            row_security_enabled: true,
            row_security_forced: true,
            policy_name: policyName,
            using_expression: table.usingFragments.join(' AND '),
            with_check_expression: table.withCheckFragments.join(' AND '),
          }] as readonly T[],
        };
      }

      if (normalized.startsWith('insert into workspaces')) {
        workspaces.add(assertRlsWorkspace(params?.[0]));
        return { rows: [] };
      }

      if (normalized.startsWith('insert into users')) {
        const userId = String(params?.[0]);
        assertRlsWorkspace(params?.[1]);
        users.add(userId);
        return { rows: [] };
      }

      if (normalized.startsWith('insert into customers')) {
        const workspaceId = assertRlsWorkspace(params?.[0]);
        const sourceSqliteId = Number(params?.[1]);
        const existing = customers.find((row) => (
          row.workspaceId === workspaceId && row.sourceSqliteId === sourceSqliteId
        ));
        if (!existing) {
          customers.push({ id: nextCustomerId, workspaceId, sourceSqliteId });
          nextCustomerId += 1;
        }
        return { rows: [] };
      }

      if (normalized.startsWith('insert into secrets')) {
        const workspaceId = assertRlsWorkspace(params?.[0]);
        const name = String(params?.[1]);
        if (!secrets.some((row) => row.workspaceId === workspaceId && row.kind === 'rls_probe' && row.name === name)) {
          secrets.push({ workspaceId, kind: 'rls_probe', name });
        }
        return { rows: [] };
      }

      if (normalized.startsWith('select count(*)::int as count from customers')) {
        const workspaceId = String(params?.[0]);
        const sourceSqliteId = Number(params?.[1]);
        const count = customers.filter((row) => (
          canAccessWorkspace(row.workspaceId)
          && row.workspaceId === workspaceId
          && row.sourceSqliteId === sourceSqliteId
        )).length;
        return { rows: [{ count }] as readonly T[] };
      }

      if (normalized.startsWith('select count(*)::int as count from secrets')) {
        const workspaceId = String(params?.[0]);
        const count = secrets.filter((row) => (
          canAccessWorkspace(row.workspaceId)
          && row.workspaceId === workspaceId
          && row.kind === 'rls_probe'
        )).length;
        return { rows: [{ count }] as readonly T[] };
      }

      if (normalized.startsWith('update customers set workspace_id')) {
        assertRlsWorkspace(params?.[0]);
        return { rows: [] };
      }

      if (normalized.startsWith('delete from customers')) {
        const workspaceId = String(params?.[0]);
        const sourceSqliteId = Number(params?.[1]);
        if (!canAccessWorkspace(workspaceId)) {
          return { rows: [] };
        }
        const deleted = customers.filter((row) => (
          row.workspaceId === workspaceId && row.sourceSqliteId === sourceSqliteId
        ));
        return { rows: deleted.map((row) => ({ id: row.id })) as readonly T[] };
      }

      throw new Error(`Unhandled RLS fake SQL: ${sql}`);
    },
  };
}

export function makeMigrationPgClient(): MigrationPgClient & {
  readonly connectCount: number;
  readonly endCount: number;
  readonly metadataRows: MigrationMetadataRow[];
  readonly queries: Array<{ sql: string; params?: readonly unknown[] }>;
} {
  let connectCount = 0;
  let endCount = 0;
  const metadataRows: MigrationMetadataRow[] = [];
  const queries: Array<{ sql: string; params?: readonly unknown[] }> = [];

  return {
    get connectCount() {
      return connectCount;
    },
    get endCount() {
      return endCount;
    },
    metadataRows,
    queries,
    async connect() {
      connectCount += 1;
    },
    async end() {
      endCount += 1;
    },
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ rows: readonly T[] }> {
      queries.push({ sql, params });
      if (sql.includes('FROM simplecrm_schema_migrations')) {
        return { rows: metadataRows as unknown as readonly T[] };
      }
      if (sql.includes('INSERT INTO simplecrm_schema_migrations')) {
        const [id, description, checksum] = params ?? [];
        if (typeof id !== 'string' || typeof description !== 'string' || typeof checksum !== 'string') {
          throw new Error('Invalid migration metadata insert parameters');
        }
        metadataRows.push({
          id,
          description,
          checksum,
          appliedAt: '2026-06-02T12:00:00.000Z',
        });
      }
      return { rows: [] };
    },
  };
}

export function makeDoctorPgClient(input: {
  failJobQueue?: boolean;
} = {}): DoctorPgClient & {
  readonly connectCount: number;
  readonly endCount: number;
  readonly queries: Array<{ sql: string; params?: readonly unknown[] }>;
} {
  let connectCount = 0;
  let endCount = 0;
  const queries: Array<{ sql: string; params?: readonly unknown[] }> = [];

  return {
    get connectCount() {
      return connectCount;
    },
    get endCount() {
      return endCount;
    },
    queries,
    async connect() {
      connectCount += 1;
    },
    async end() {
      endCount += 1;
    },
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ rows: readonly T[] }> {
      queries.push({ sql, params });
      if (sql.includes('current_database()')) {
        return { rows: [{ database_name: 'simplecrm', database_size: '42 MB' } as T] };
      }
      if (sql.includes('FROM simplecrm_schema_migrations')) {
        return {
          rows: serverMigrations.map((migration) => ({
            id: migration.id,
            description: migration.description,
            checksum: checksumMigration(migration),
            appliedAt: '2026-06-03T00:00:00.000Z',
          })) as unknown as readonly T[],
        };
      }
      if (sql.includes('FROM job_queue')) {
        if (input.failJobQueue) {
          throw new Error('job_queue missing');
        }
        return { rows: [{ ready_jobs: 2, locked_jobs: 0, queue_lag_seconds: 30, oldest_locked_seconds: null } as T] };
      }
      if (sql.includes('FROM conversation_locks')) {
        return { rows: [{ stale_locks: 0 } as T] };
      }
      return { rows: [] };
    },
  };
}

export function makeSqliteImportPgClient(input: {
  checkpoint?: Record<string, unknown>;
  stagedRows?: readonly Record<string, unknown>[];
} = {}): SqliteImportPgClient & {
  readonly queries: Array<{ sql: string; params?: readonly unknown[] }>;
} {
  const queries: Array<{ sql: string; params?: readonly unknown[] }> = [];
  const stagedRows: Record<string, unknown>[] = [];

  return {
    queries,
    async query<T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params?: readonly unknown[],
    ): Promise<{ rows: readonly T[] }> {
      queries.push({ sql, params });
      if (sql.includes('INSERT INTO sqlite_import_rows') && params) {
        stagedRows.push({
          source_pk: String(params[2]),
          source_row_sha256: params[4],
        });
      }
      if (sql.includes('RETURNING id')) {
        return { rows: [{ id: 'run-1' } as T] };
      }
      if (sql.includes('FROM sqlite_import_table_checkpoints')) {
        return { rows: input.checkpoint ? [input.checkpoint as T] : [] };
      }
      if (sql.includes('FROM sqlite_import_rows') && sql.includes('source_row_sha256')) {
        return { rows: (input.stagedRows ?? stagedRows) as readonly T[] };
      }
      return { rows: [] };
    },
  };
}

export function makeMigrateFromSqlitePgClient(): MigrateFromSqlitePgClient & {
  readonly connected: boolean;
  readonly ended: boolean;
  readonly queries: Array<{ sql: string; params?: readonly unknown[] }>;
} {
  const base = makeSqliteImportPgClient();
  let connected = false;
  let ended = false;

  return {
    get connected() {
      return connected;
    },
    get ended() {
      return ended;
    },
    queries: base.queries,
    async connect() {
      connected = true;
    },
    async end() {
      ended = true;
    },
    async query(sql, params) {
      return base.query(sql, params);
    },
  };
}

export function makeCoreCrmImportPgClient(): {
  readonly queries: Array<{ sql: string; params?: readonly unknown[] }>;
  query(sql: string, params?: readonly unknown[]): Promise<unknown>;
} {
  const queries: Array<{ sql: string; params?: readonly unknown[] }> = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [] };
    },
  };
}

export type AiReplySuggestionFakeRows = {
  messages: Array<Record<string, unknown>>;
  prompts: Array<Record<string, unknown>>;
  profiles: Array<Record<string, unknown>>;
  customers: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
  folders: Array<Record<string, unknown>>;
  syncInfo: Array<Record<string, unknown>>;
  messageCategories: Array<Record<string, unknown>>;
  tags: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  knowledgeChunks: Array<Record<string, unknown>>;
  knowledgeBases: Array<Record<string, unknown>>;
  activityLog: Array<Record<string, unknown>>;
  cannedResponses: Array<Record<string, unknown>>;
};

export function makeAiReplySuggestionDb(input: Partial<AiReplySuggestionFakeRows>): {
  db: Kysely<ServerDatabase>;
  rows: AiReplySuggestionFakeRows;
} {
  const rows: AiReplySuggestionFakeRows = {
    messages: input.messages ?? [],
    prompts: input.prompts ?? [],
    profiles: input.profiles ?? [],
    customers: input.customers ?? [],
    accounts: input.accounts ?? [],
    folders: input.folders ?? [],
    syncInfo: input.syncInfo ?? [],
    messageCategories: input.messageCategories ?? [],
    tags: input.tags ?? [],
    jobs: input.jobs ?? [],
    knowledgeChunks: input.knowledgeChunks ?? [],
    knowledgeBases: input.knowledgeBases ?? [],
    activityLog: input.activityLog ?? [],
    cannedResponses: input.cannedResponses ?? [],
  };
  const tableRows = (table: string): Array<Record<string, unknown>> => {
    switch (table) {
      case 'email_messages':
        return rows.messages;
      case 'email_ai_prompts':
        return rows.prompts;
      case 'email_ai_profiles':
        return rows.profiles;
      case 'customers':
        return rows.customers;
      case 'email_accounts':
        return rows.accounts;
      case 'email_folders':
        return rows.folders;
      case 'sync_info':
        return rows.syncInfo;
      case 'email_message_categories':
        return rows.messageCategories;
      case 'email_message_tags':
        return rows.tags;
      case 'job_queue':
        return rows.jobs;
      case 'workflow_knowledge_chunks':
        return rows.knowledgeChunks;
      case 'workflow_knowledge_bases':
        return rows.knowledgeBases;
      case 'activity_log':
        return rows.activityLog;
      case 'email_canned_responses':
        return rows.cannedResponses;
      default:
        throw new Error(`unexpected AI reply suggestion table: ${table}`);
    }
  };
  const db = {
    selectFrom(table: string) {
      return new FakeAiReplySuggestionSelect(tableRows(table));
    },
    updateTable(table: string) {
      return new FakeAiReplySuggestionUpdate(tableRows(table));
    },
    insertInto(table: string) {
      return new FakeAiReplySuggestionInsert(tableRows(table));
    },
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
      };
    },
  } as unknown as Kysely<ServerDatabase>;
  return { db, rows };
}

export class FakeAiReplySuggestionInsert {
  private row: Record<string, unknown> | null = null;

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  values(value: Record<string, unknown>) {
    this.row = { ...value };
    return this;
  }

  returning() {
    return this;
  }

  async execute() {
    this.insertRow();
  }

  async executeTakeFirstOrThrow() {
    return this.insertRow();
  }

  private insertRow() {
    if (!this.row) throw new Error('missing AI reply suggestion insert row');
    const nextId = Math.max(0, ...this.rows.map((row) => Number(row.id ?? 0))) + 1;
    const stored = { ...this.row, id: this.row.id ?? nextId };
    this.rows.push(stored);
    return stored;
  }
}

export class FakeAiReplySuggestionSelect {
  private readonly wheres: Array<readonly [string, string, unknown]> = [];

  private readonly order: Array<readonly [string, string]> = [];

  private rowLimit: number | null = null;

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  select() {
    return this;
  }

  where(column: string | ((eb: unknown) => unknown), operator?: string, value?: unknown) {
    if (typeof column === 'function') return this;
    if (!operator) throw new Error('missing AI reply suggestion where operator');
    this.wheres.push([column, operator, value]);
    return this;
  }

  orderBy(column: string, direction: string) {
    this.order.push([column, direction]);
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  async execute() {
    const rows = this.filteredRows();
    return this.rowLimit === null ? rows : rows.slice(0, this.rowLimit);
  }

  async executeTakeFirst() {
    return this.filteredRows()[0];
  }

  private filteredRows() {
    const result = this.rows.filter((row) => this.wheres.every(([column, operator, value]) => {
      if (operator === '=') return row[column] === value;
      if (operator === 'in' && Array.isArray(value)) return value.includes(row[column]);
      if (operator === '<') return Number(row[column]) < Number(value);
      if (operator === '>') return Number(row[column]) > Number(value);
      throw new Error(`unexpected AI reply suggestion where operator: ${operator}`);
    }));
    return [...result].sort((left, right) => {
      for (const [column, direction] of this.order) {
        const leftValue = Number(left[column] ?? 0);
        const rightValue = Number(right[column] ?? 0);
        if (leftValue === rightValue) continue;
        return direction === 'desc' ? rightValue - leftValue : leftValue - rightValue;
      }
      return 0;
    });
  }
}

export class FakeAiReplySuggestionUpdate {
  private readonly wheres: Array<readonly [string, string, unknown]> = [];

  private patch: Record<string, unknown> = {};

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  set(values: Record<string, unknown>) {
    this.patch = values;
    return this;
  }

  where(column: string | ((eb: unknown) => unknown), operator?: string, value?: unknown) {
    if (typeof column !== 'string') return this;
    if (typeof column === 'function') return this;
    if (!operator) throw new Error('missing workflow execution select operator');
    this.wheres.push([column, operator, value]);
    return this;
  }

  async executeTakeFirst() {
    const row = this.rows.find((candidate) => this.wheres.every(([column, operator, value]) => {
      if (operator !== '=') throw new Error(`unexpected AI reply suggestion update operator: ${operator}`);
      return candidate[column] === value;
    }));
    if (row) Object.assign(row, this.patch);
    return row;
  }

  async execute() {
    for (const row of this.rows) {
      const match = this.wheres.every(([column, operator, value]) => {
        if (operator !== '=') throw new Error(`unexpected AI reply suggestion update operator: ${operator}`);
        return row[column] === value;
      });
      if (match) Object.assign(row, this.patch);
    }
  }
}

export function makeMailSyncPostProcessDb(input: {
  messages: Array<Record<string, unknown>>;
  workflows?: Array<Record<string, unknown>>;
}): {
  db: Kysely<ServerDatabase>;
  rows: {
    messages: Array<Record<string, unknown>>;
    workflows: Array<Record<string, unknown>>;
  };
} {
  const rows = {
    messages: input.messages,
    workflows: input.workflows ?? [],
  };
  const db = {
    selectFrom(table: string) {
      if (table === 'email_messages') return new FakeMailSyncPostProcessSelect(rows.messages);
      if (table === 'email_workflows') return new FakeMailSyncPostProcessSelect(rows.workflows);
      throw new Error(`unexpected mail sync post-process table: ${table}`);
    },
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
      };
    },
  } as unknown as Kysely<ServerDatabase>;
  return { db, rows };
}

export class FakeMailSyncPostProcessSelect {
  private readonly wheres: Array<readonly [string, string, unknown]> = [];

  private readonly order: Array<readonly [string, string]> = [];

  private rowLimit: number | null = null;

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  select() {
    return this;
  }

  where(column: string | ((eb: unknown) => unknown), operator?: string, value?: unknown) {
    if (typeof column === 'function') return this;
    if (!operator) throw new Error('missing workflow execution select operator');
    this.wheres.push([column, operator, value]);
    return this;
  }

  orderBy(column: string, direction: string) {
    this.order.push([column, direction]);
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  async execute() {
    const rows = this.filteredRows();
    return this.rowLimit === null ? rows : rows.slice(0, this.rowLimit);
  }

  private filteredRows() {
    const result = this.rows.filter((row) => this.wheres.every(([column, operator, value]) => {
      if (operator === '=') return row[column] === value;
      if (operator === '>=') return timestampMillis(row[column]) >= timestampMillis(value);
      throw new Error(`unexpected mail sync post-process where operator: ${operator}`);
    }));
    return [...result].sort((left, right) => {
      for (const [column, direction] of this.order) {
        const leftValue = timestampMillis(left[column]);
        const rightValue = timestampMillis(right[column]);
        if (leftValue === rightValue) continue;
        return direction === 'desc' ? rightValue - leftValue : leftValue - rightValue;
      }
      return 0;
    });
  }
}

export function timestampMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value).getTime();
    return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
  }
  return Number.NEGATIVE_INFINITY;
}

export type WorkflowExecutionFakeRows = {
  workflows: Array<Record<string, unknown>>;
  messages: Array<Record<string, unknown>>;
  accounts: Array<Record<string, unknown>>;
  folders: Array<Record<string, unknown>>;
  customers: Array<Record<string, unknown>>;
  deals: Array<Record<string, unknown>>;
  tasks: Array<Record<string, unknown>>;
  activityLog: Array<Record<string, unknown>>;
  syncInfo: Array<Record<string, unknown>>;
  spamListEntries: Array<Record<string, unknown>>;
  spamLearningEvents: Array<Record<string, unknown>>;
  spamFeatureStats: Array<Record<string, unknown>>;
  appliedWorkflows: Array<Record<string, unknown>>;
  forwardDedup: Array<Record<string, unknown>>;
  runs: Array<Record<string, unknown>>;
  steps: Array<Record<string, unknown>>;
  tags: Array<Record<string, unknown>>;
  categories: Array<Record<string, unknown>>;
  messageCategories: Array<Record<string, unknown>>;
  cannedResponses: Array<Record<string, unknown>>;
  knowledgeChunks: Array<Record<string, unknown>>;
  jtlFirmen: Array<Record<string, unknown>>;
  jtlWarenlager: Array<Record<string, unknown>>;
  jtlZahlungsarten: Array<Record<string, unknown>>;
  jtlVersandarten: Array<Record<string, unknown>>;
  delayedJobs: Array<Record<string, unknown>>;
  jobs: Array<Record<string, unknown>>;
  messageAttachments: Array<Record<string, unknown>>;
  accountMailSettings: Array<Record<string, unknown>>;
};

export function makeWorkflowExecutionDb(input: Partial<WorkflowExecutionFakeRows>): {
  db: Kysely<ServerDatabase>;
  rows: WorkflowExecutionFakeRows;
} {
  const rows: WorkflowExecutionFakeRows = {
    workflows: input.workflows ?? [],
    messages: input.messages ?? [],
    accounts: input.accounts ?? [],
    folders: input.folders ?? [],
    customers: input.customers ?? [],
    deals: input.deals ?? [],
    tasks: input.tasks ?? [],
    activityLog: input.activityLog ?? [],
    syncInfo: input.syncInfo ?? [],
    spamListEntries: input.spamListEntries ?? [],
    spamLearningEvents: input.spamLearningEvents ?? [],
    spamFeatureStats: input.spamFeatureStats ?? [],
    appliedWorkflows: input.appliedWorkflows ?? [],
    forwardDedup: input.forwardDedup ?? [],
    runs: input.runs ?? [],
    steps: input.steps ?? [],
    tags: input.tags ?? [],
    categories: input.categories ?? [],
    messageCategories: input.messageCategories ?? [],
    cannedResponses: input.cannedResponses ?? [],
    knowledgeChunks: input.knowledgeChunks ?? [],
    jtlFirmen: input.jtlFirmen ?? [],
    jtlWarenlager: input.jtlWarenlager ?? [],
    jtlZahlungsarten: input.jtlZahlungsarten ?? [],
    jtlVersandarten: input.jtlVersandarten ?? [],
    delayedJobs: input.delayedJobs ?? [],
    jobs: input.jobs ?? [],
    messageAttachments: input.messageAttachments ?? [],
    accountMailSettings: input.accountMailSettings ?? [],
  };
  const tableRows = (table: string): Array<Record<string, unknown>> => {
    switch (table) {
      case 'email_message_attachments':
        return rows.messageAttachments;
      case 'email_workflows':
        return rows.workflows;
      case 'email_messages':
        return rows.messages;
      case 'email_accounts':
        return rows.accounts;
      case 'email_folders':
        return rows.folders;
      case 'customers':
        return rows.customers;
      case 'deals':
        return rows.deals;
      case 'tasks':
        return rows.tasks;
      case 'activity_log':
        return rows.activityLog;
      case 'sync_info':
        return rows.syncInfo;
      case 'email_spam_list_entries':
        return rows.spamListEntries;
      case 'email_spam_learning_events':
        return rows.spamLearningEvents;
      case 'email_spam_feature_stats':
        return rows.spamFeatureStats;
      case 'email_message_workflow_applied':
        return rows.appliedWorkflows;
      case 'email_workflow_forward_dedup':
        return rows.forwardDedup;
      case 'email_workflow_runs':
        return rows.runs;
      case 'email_workflow_run_steps':
        return rows.steps;
      case 'email_message_tags':
        return rows.tags;
      case 'email_categories':
        return rows.categories;
      case 'email_message_categories':
        return rows.messageCategories;
      case 'email_canned_responses':
        return rows.cannedResponses;
      case 'workflow_knowledge_chunks':
        return rows.knowledgeChunks;
      case 'jtl_firmen':
        return rows.jtlFirmen;
      case 'jtl_warenlager':
        return rows.jtlWarenlager;
      case 'jtl_zahlungsarten':
        return rows.jtlZahlungsarten;
      case 'jtl_versandarten':
        return rows.jtlVersandarten;
      case 'workflow_delayed_jobs':
        return rows.delayedJobs;
      case 'job_queue':
        return rows.jobs;
      case 'email_account_mail_settings':
        return rows.accountMailSettings;
      default:
        throw new Error(`unexpected workflow execution table: ${table}`);
    }
  };
  const db = {
    selectFrom(table: string) {
      return new FakeWorkflowExecutionSelect(tableRows(table));
    },
    insertInto(table: string) {
      return new FakeWorkflowExecutionInsert(table, tableRows(table));
    },
    updateTable(table: string) {
      return new FakeWorkflowExecutionUpdate(tableRows(table));
    },
    deleteFrom(table: string) {
      return new FakeWorkflowExecutionDelete(tableRows(table));
    },
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
      };
    },
  } as unknown as Kysely<ServerDatabase>;
  return { db, rows };
}

export class FakeWorkflowExecutionSelect {
  private readonly wheres: Array<readonly [string, string, unknown]> = [];

  private readonly order: Array<readonly [string, string]> = [];

  private rowLimit: number | null = null;

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  select() {
    return this;
  }

  where(column: string | ((eb: unknown) => unknown), operator?: string, value?: unknown) {
    if (typeof column === 'function') return this;
    if (!operator) throw new Error('missing workflow execution select operator');
    this.wheres.push([column, operator, value]);
    return this;
  }

  orderBy(column: string, direction: string) {
    this.order.push([column, direction]);
    return this;
  }

  limit(value: number) {
    this.rowLimit = value;
    return this;
  }

  async executeTakeFirst(): Promise<Record<string, unknown> | undefined> {
    const row = this.matchingRows()[0];
    return row ? { ...row } : undefined;
  }

  async execute(): Promise<Array<Record<string, unknown>>> {
    const rows = this.matchingRows();
    return (this.rowLimit === null ? rows : rows.slice(0, this.rowLimit))
      .map((row) => ({ ...row }));
  }

  private matchingRows(): Array<Record<string, unknown>> {
    const result = this.rows.filter((row) => this.wheres.every(([column, operator, value]) => {
      if (operator === '=') return row[column] === value;
      if (operator === '!=') return row[column] !== value;
      if (operator === 'is') return value === null ? row[column] === null || row[column] === undefined : row[column] === value;
      if (operator === 'in' && Array.isArray(value)) return value.includes(row[column]);
      if (operator === 'ilike') return ilikeMatch(row[column], value);
      if (operator === '<') return Number(row[column]) < Number(value);
      if (operator === '>') return Number(row[column]) > Number(value);
      throw new Error(`unexpected workflow execution select operator: ${operator}`);
    }));
    return [...result].sort((left, right) => {
      for (const [column, direction] of this.order) {
        const leftValue = Number(left[column] ?? 0);
        const rightValue = Number(right[column] ?? 0);
        if (leftValue === rightValue) continue;
        return direction === 'desc' ? rightValue - leftValue : leftValue - rightValue;
      }
      return 0;
    });
  }
}

export function ilikeMatch(actual: unknown, pattern: unknown): boolean {
  const haystack = String(actual ?? '').toLowerCase();
  const needle = String(pattern ?? '').toLowerCase().replace(/^%+|%+$/g, '');
  return haystack.includes(needle);
}

// Emulates the Postgres jsonb round-trip. Production passes a JSON *string* for
// these columns so node-postgres sends valid JSON instead of a Postgres array
// literal ({...}); on read node-postgres returns the parsed value. The fake
// store keeps the parsed value so reads (and assertions) match production.
export const JSONB_STRING_COLUMNS = ['log_json', 'feature_keys_json'] as const;
export function decodeJsonbStringColumns(value: Record<string, unknown>): Record<string, unknown> {
  const decoded: Record<string, unknown> = { ...value };
  for (const column of JSONB_STRING_COLUMNS) {
    if (typeof decoded[column] === 'string') {
      try {
        decoded[column] = JSON.parse(decoded[column] as string);
      } catch {
        // Leave as-is: Postgres would reject invalid jsonb, which the dedicated
        // workflow-execution-jsonb test guards against at the binding layer.
      }
    }
  }
  return decoded;
}

export class FakeWorkflowExecutionInsert {
  private row: Record<string, unknown> | null = null;

  private conflictColumns: readonly string[] | null = null;

  constructor(
    private readonly table: string,
    private readonly rows: Array<Record<string, unknown>>,
  ) {}

  values(value: Record<string, unknown>) {
    this.row = decodeJsonbStringColumns(value);
    return this;
  }

  onConflict(builder: (oc: {
    columns: (columns: readonly string[]) => {
      doUpdateSet: (setter: unknown) => unknown;
    };
  }) => unknown) {
    builder({
      columns: (columns) => {
        this.conflictColumns = columns;
        return {
          doUpdateSet: () => undefined,
        };
      },
    });
    return this;
  }

  returning() {
    return this;
  }

  async execute(): Promise<void> {
    this.insertRow();
  }

  async executeTakeFirstOrThrow(): Promise<Record<string, unknown>> {
    return this.insertRow();
  }

  private insertRow(): Record<string, unknown> {
    if (!this.row) throw new Error('missing workflow execution insert row');
    if (this.conflictColumns) {
      const existing = this.rows.find((row) => this.conflictColumns?.every((column) => row[column] === this.row?.[column]));
      if (existing) {
        if (this.table !== 'email_spam_feature_stats') {
          Object.assign(existing, this.row);
          return existing;
        }
        existing.spam_count = Number(existing.spam_count ?? 0) + Number(this.row.spam_count ?? 0);
        existing.ham_count = Number(existing.ham_count ?? 0) + Number(this.row.ham_count ?? 0);
        existing.source_row = this.row.source_row;
        existing.imported_in_run_id = this.row.imported_in_run_id;
        existing.updated_at = this.row.updated_at;
        return existing;
      }
    }
    const nextId = Math.max(0, ...this.rows.map((row) => Number(row.id ?? 0))) + 1;
    const stored = {
      ...this.row,
      id: this.row.id ?? nextId,
    };
    this.rows.push(stored);
    if (this.table === 'email_workflow_run_steps' && stored.run_id === undefined) {
      throw new Error('workflow run step missing run_id');
    }
    return stored;
  }
}

export class FakeWorkflowExecutionUpdate {
  private readonly wheres: Array<readonly [string, string, unknown]> = [];

  private patch: Record<string, unknown> = {};

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  set(value: Record<string, unknown>) {
    this.patch = decodeJsonbStringColumns(value);
    return this;
  }

  returning() {
    return this;
  }

  where(column: string, operator: string, value: unknown) {
    this.wheres.push([column, operator, value]);
    return this;
  }

  async execute(): Promise<void> {
    this.applyUpdate();
  }

  async executeTakeFirst(): Promise<Record<string, unknown> | undefined> {
    return this.applyUpdate()[0];
  }

  async executeTakeFirstOrThrow(): Promise<Record<string, unknown>> {
    const row = await this.executeTakeFirst();
    if (!row) throw new Error('missing workflow execution update row');
    return row;
  }

  private applyUpdate(): Array<Record<string, unknown>> {
    const updated: Array<Record<string, unknown>> = [];
    for (const row of this.rows) {
      const match = this.wheres.every(([column, operator, value]) => {
        if (operator !== '=') throw new Error(`unexpected workflow execution update operator: ${operator}`);
        return row[column] === value;
      });
      if (match) {
        Object.assign(row, this.patch);
        updated.push(row);
      }
    }
    return updated;
  }
}

export class FakeWorkflowExecutionDelete {
  private readonly wheres: Array<readonly [string, string, unknown]> = [];

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  where(column: string, operator: string, value: unknown) {
    this.wheres.push([column, operator, value]);
    return this;
  }

  async execute(): Promise<{ numDeletedRows: bigint }[]> {
    let deleted = 0;
    for (let index = this.rows.length - 1; index >= 0; index -= 1) {
      const row = this.rows[index];
      const match = this.wheres.every(([column, operator, value]) => {
        if (operator === '=') return row[column] === value;
        if (operator === 'is') return value === null ? row[column] === null || row[column] === undefined : row[column] === value;
        if (operator === 'in' && Array.isArray(value)) return value.includes(row[column]);
        throw new Error(`unexpected workflow execution delete operator: ${operator}`);
      });
      if (match) {
        this.rows.splice(index, 1);
        deleted += 1;
      }
    }
    return [{ numDeletedRows: BigInt(deleted) }];
  }

  async executeTakeFirst(): Promise<{ numDeletedRows: bigint }> {
    return (await this.execute())[0] ?? { numDeletedRows: 0n };
  }
}

export function makeLegacyCredentialImportDb(rows: Record<string, Array<Record<string, unknown>>>): Kysely<ServerDatabase> {
  const db = {
    selectFrom(table: string) {
      return new FakeLegacyCredentialSelect(rows[table] ?? []);
    },
    updateTable(table: string) {
      return new FakeLegacyCredentialUpdate(rows[table] ?? []);
    },
    transaction() {
      return {
        execute: async <T>(operation: (trx: unknown) => Promise<T>) => operation(db),
      };
    },
  } as unknown as Kysely<ServerDatabase>;
  return db;
}

export class FakeLegacyCredentialSelect {
  private readonly wheres: Array<readonly [string, unknown]> = [];

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  select() {
    return this;
  }

  where(column: string, operator: string, value: unknown) {
    if (operator !== '=') throw new Error(`unexpected legacy credential select operator: ${operator}`);
    this.wheres.push([column, value]);
    return this;
  }

  async execute(): Promise<Array<Record<string, unknown>>> {
    return this.rows.filter((row) => this.wheres.every(([column, value]) => row[column] === value));
  }
}

export class FakeLegacyCredentialUpdate {
  private readonly wheres: Array<readonly [string, unknown]> = [];

  private patch: Record<string, unknown> = {};

  constructor(private readonly rows: Array<Record<string, unknown>>) {}

  set(value: Record<string, unknown>) {
    this.patch = value;
    return this;
  }

  where(column: string, operator: string, value: unknown) {
    if (operator !== '=') throw new Error(`unexpected legacy credential update operator: ${operator}`);
    this.wheres.push([column, value]);
    return this;
  }

  async executeTakeFirst(): Promise<{ numUpdatedRows: bigint }> {
    let updated = 0;
    for (const row of this.rows) {
      if (this.wheres.every(([column, value]) => row[column] === value)) {
        Object.assign(row, this.patch);
        updated += 1;
      }
    }
    return { numUpdatedRows: BigInt(updated) };
  }
}

export function makeLock(
  messageId: number,
  userId: string,
  workspaceId: string,
  reason: 'reply' | 'forward' | 'edit',
  takeoverCount: number,
): ConversationLockRecord {
  return {
    messageId,
    userId,
    workspaceId,
    acquiredAt: '2026-06-02T12:00:00.000Z',
    lastHeartbeatAt: '2026-06-02T12:00:00.000Z',
    reason,
    takeoverCount,
  };
}

export function makeAuditChainRows(input: Array<{
  id: number;
  createdAt: string;
  metadata?: Record<string, unknown>;
}>): AuditHashChainRow[] {
  let previousHash: string | null = null;
  return input.map((item) => {
    const metadata = item.metadata ?? { id: item.id };
    const eventHash = hashAuditEvent({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
      action: 'audit.retention.probe',
      entityType: 'email_message',
      entityId: String(item.id),
      metadata,
      previousHash,
      createdAt: new Date(item.createdAt),
    });
    const row: AuditHashChainRow = {
      id: item.id,
      workspace_id: WORKSPACE_A_ID,
      actor_user_id: USER_A_ID,
      action: 'audit.retention.probe',
      entity_type: 'email_message',
      entity_id: String(item.id),
      metadata,
      previous_hash: previousHash,
      event_hash: eventHash,
      created_at: item.createdAt,
    };
    previousHash = eventHash;
    return row;
  });
}

export function makeServerMailSyncAccount(overrides: Record<string, unknown> = {}): any {
  return {
    id: 7,
    sourceSqliteId: -700,
    protocol: 'imap',
    imapHost: 'imap.example.com',
    imapPort: 993,
    imapTls: true,
    imapUsername: 'sync@example.com',
    oauthProvider: null,
    pop3Host: null,
    pop3Port: null,
    pop3Tls: true,
    sentFolderPath: 'Sent',
    syncSpamFolderPath: null,
    syncArchiveFolderPath: null,
    imapSyncSent: false,
    imapSyncArchive: false,
    imapSyncSpam: false,
    ...overrides,
  };
}

export function makeServerMailSyncFolder(overrides: Record<string, unknown> = {}): any {
  return {
    id: 71,
    sourceSqliteId: -710,
    accountSourceSqliteId: -700,
    path: 'INBOX',
    delimiter: '/',
    uidvalidity: null,
    uidvalidityStr: null,
    lastUid: 0,
    pop3UidlStr: null,
    ...overrides,
  };
}

export function makeParsedServerMailSyncMessage(seed: string): any {
  const normalized = seed.replace(/\s+/g, ' ').trim();
  return {
    messageId: `<${createHash('sha256').update(seed).digest('hex').slice(0, 12)}@example.com>`,
    inReplyTo: null,
    referencesHeader: null,
    subject: normalized.slice(0, 80) || 'Message',
    fromJson: { value: [{ address: 'sender@example.com' }] },
    toJson: { value: [{ address: 'sync@example.com' }] },
    ccJson: null,
    bccJson: null,
    dateReceived: '2026-07-05T09:00:00.000Z',
    snippet: normalized.slice(0, 220) || null,
    bodyText: normalized || null,
    bodyHtml: null,
    hasAttachments: false,
    attachmentsJson: null,
    rawHeaders: 'Subject: Test',
    rawRfc822B64: Buffer.from(seed).toString('base64'),
  };
}

export function makeServerMailSyncStore(options: {
  account?: any;
  folders?: Map<string, any>;
  upserts?: any[];
  attachmentWrites?: any[];
  folderUpdates?: any[];
  uidValidityResets?: any[];
  uidValidityRestores?: any[];
  pop3Known?: Map<string, number>;
  messageIds?: number[];
} = {}): any {
  const account = options.account ?? makeServerMailSyncAccount();
  const folders = options.folders ?? new Map<string, any>([
    ['INBOX', makeServerMailSyncFolder()],
  ]);
  const upserts = options.upserts ?? [];
  const attachmentWrites = options.attachmentWrites ?? [];
  const folderUpdates = options.folderUpdates ?? [];
  const uidValidityResets = options.uidValidityResets ?? [];
  const uidValidityRestores = options.uidValidityRestores ?? [];
  const pop3Known = options.pop3Known ?? new Map<string, number>();
  const messageIds = [...(options.messageIds ?? [9001, 9002, 9003])];
  return {
    async getAccount(input: { accountId: number }) {
      return input.accountId === account.id ? account : null;
    },
    async readSecret(input: { kind: string }) {
      return input.kind === 'email.account.imap_password' ? Buffer.from('imap-secret') : null;
    },
    async writeSecret() {
      return undefined;
    },
    async getSyncInfo(input: { keys: readonly string[] }) {
      return new Map(input.keys.map((key) => [key, null]));
    },
    async getOrCreateFolder(input: { path: string }) {
      const existing = folders.get(input.path);
      if (existing) return existing;
      const created = makeServerMailSyncFolder({
        id: 100 + folders.size,
        sourceSqliteId: -1000 - folders.size,
        path: input.path,
      });
      folders.set(input.path, created);
      return created;
    },
    async resetFolderForUidValidityChange(input: any) {
      uidValidityResets.push(input);
      const folder = [...folders.values()].find((item) => item.id === input.folderId);
      if (folder) {
        folder.lastUid = 0;
        folder.uidvalidity = null;
        folder.uidvalidityStr = null;
      }
      return { messageCount: 1, backedUpCount: 1 };
    },
    async loadImapUidToId() {
      return new Map();
    },
    async loadPop3UidlToId() {
      return pop3Known;
    },
    async allocateNextPop3Uid() {
      return -1_000_000;
    },
    async upsertMessage(input: any) {
      upserts.push(input);
      const id = messageIds.shift() ?? 9999;
      return { id, isNew: true };
    },
    async replaceMessageAttachments(input: any) {
      attachmentWrites.push(input);
    },
    async restoreUidValidityLocalMetadata(input: any) {
      uidValidityRestores.push(input);
      return true;
    },
    async updateFolderSyncState(input: any) {
      folderUpdates.push(input);
      const folder = [...folders.values()].find((item) => item.id === input.folderId);
      if (folder) {
        folder.lastUid = input.lastUid;
        if ('uidvalidity' in input) folder.uidvalidity = input.uidvalidity;
        if ('uidvalidityStr' in input) folder.uidvalidityStr = input.uidvalidityStr;
        if ('pop3UidlStr' in input) folder.pop3UidlStr = input.pop3UidlStr;
      }
    },
  };
}

export async function startLineServer(
  onLine: (line: string, socket: net.Socket) => void,
  greeting: string,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((socket) => {
    socket.setEncoding('utf8');
    socket.on('error', () => undefined);
    socket.write(greeting);
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += String(chunk);
      for (;;) {
        const index = buffer.indexOf('\n');
        if (index < 0) return;
        const line = buffer.slice(0, index).replace(/\r$/, '');
        buffer = buffer.slice(index + 1);
        onLine(line, socket);
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('line test server did not bind to a TCP port');
  }
  return {
    port: address.port,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) reject(error);
        else resolve();
      });
    }),
  };
}
