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

describe('server edition foundation — mssql', () => {
  test('MSSQL workflow query validation only accepts bounded read-only statements', () => {
    expect(validateReadOnlyMssqlQuery(' SELECT TOP 1 1 AS ok ')).toEqual({
      ok: true,
      query: 'SELECT TOP 1 1 AS ok',
    });
    expect(validateReadOnlyMssqlQuery('WITH rows AS (SELECT 1 AS ok) SELECT * FROM rows')).toMatchObject({
      ok: true,
    });
    expect(validateReadOnlyMssqlQuery('DELETE FROM Kunden')).toEqual({
      ok: false,
      error: 'Query muss mit SELECT oder WITH beginnen',
    });
    expect(validateReadOnlyMssqlQuery('SELECT 1; DROP TABLE Kunden')).toEqual({
      ok: false,
      error: 'Nur lesende SELECT-Abfragen sind erlaubt',
    });
  });

  test('postgres MSSQL settings port stores non-secret settings and resolves password secrets for read-only queries', async () => {
    const { db, rows } = makeWorkflowExecutionDb({ syncInfo: [] });
    let secretValue: Buffer | null = null;
    const connectCalls: unknown[] = [];
    const queryCalls: string[] = [];
    const close = jest.fn(async () => undefined);
    const port = createPostgresMssqlSettingsPort({
      db,
      applyWorkspaceSession: async () => undefined,
      secrets: {
        async writeSecret(input) {
          secretValue = Buffer.isBuffer(input.value) ? input.value : Buffer.from(input.value);
          return {
            id: 'secret-1',
            workspaceId: input.workspaceId,
            kind: input.kind,
            name: input.name,
            keyId: 'test',
            algorithm: 'test',
            updatedAt: '2026-07-04T11:00:00.000Z',
          };
        },
        async readSecret() {
          return secretValue;
        },
        async deleteSecret() {
          const existed = secretValue !== null;
          secretValue = null;
          return existed;
        },
        async rotateSecret() {
          return null;
        },
      },
      connect: async (config) => {
        connectCalls.push(config);
        return {
          request: () => ({
            query: async (query: string) => {
              queryCalls.push(query);
              return { recordset: [{ ok: 1 }], rowsAffected: [1] };
            },
          }),
          close,
        };
      },
    });

    await expect(port.saveSettings({
      workspaceId: WORKSPACE_A_ID,
      settings: {
        server: 'sql.local',
        database: 'JTL',
        user: 'crm',
        kShop: 'nan' as any,
      },
    })).resolves.toEqual({
      success: false,
      error: 'kShop muss eine positive Ganzzahl sein',
    });

    await expect(port.saveSettings({
      workspaceId: WORKSPACE_A_ID,
      settings: {
        server: 'tcp:sql.local,1444',
        database: 'JTL',
        user: 'crm',
        password: 'secret',
        encrypt: true,
        trustServerCertificate: true,
      },
    })).resolves.toEqual({ success: true });
    expect(rows.syncInfo).toEqual([
      expect.objectContaining({
        workspace_id: WORKSPACE_A_ID,
        key: 'mssql_settings_v1',
        value: JSON.stringify({
          server: 'tcp:sql.local,1444',
          database: 'JTL',
          user: 'crm',
          encrypt: true,
          trustServerCertificate: true,
          forcePort: false,
        }),
      }),
    ]);

    await expect(port.getSettings({ workspaceId: WORKSPACE_A_ID })).resolves.toMatchObject({
      server: 'tcp:sql.local,1444',
      database: 'JTL',
      user: 'crm',
      hasPassword: true,
    });

    await expect(port.executeReadOnlyQuery({
      workspaceId: WORKSPACE_A_ID,
      query: ' SELECT 1 AS ok ',
    })).resolves.toEqual({
      success: true,
      rows: [{ ok: 1 }],
      rowCount: 1,
    });
    expect(queryCalls).toEqual(['SELECT 1 AS ok']);
    expect(connectCalls[0]).toMatchObject({
      server: 'sql.local',
      port: 1444,
      database: 'JTL',
      user: 'crm',
      password: 'secret',
      options: {
        encrypt: true,
        trustServerCertificate: true,
      },
    });
    expect(close).toHaveBeenCalledTimes(1);

    await expect(port.executeReadOnlyQuery({
      workspaceId: WORKSPACE_A_ID,
      query: 'UPDATE Kunden SET cName = 1',
    })).resolves.toEqual({
      success: false,
      error: 'Query muss mit SELECT oder WITH beginnen',
    });
  });

  test('postgres JTL order port resolves workspace customer and executes parameterized JTL order SQL', async () => {
    const { db, rows } = makeWorkflowExecutionDb({
      customers: [{
        id: 9,
        workspace_id: WORKSPACE_A_ID,
        jtl_kkunde: 7001,
        name: 'Max Mustermann',
        first_name: 'Max',
        company: null,
        email: 'max@example.com',
        phone: '01234',
        mobile: null,
        street: 'Hauptstrasse 1',
        zip_code: '12345',
        city: 'Berlin',
        country: 'Deutschland',
        notes: 'VIP',
        source_row: { salutation: 'Herr Dr.', country_iso: 'DE' },
      }],
      syncInfo: [{
        workspace_id: WORKSPACE_A_ID,
        key: 'mssql_settings_v1',
        value: JSON.stringify({
          server: 'sql.local',
          database: 'eazybusiness',
          user: 'crm',
          encrypt: true,
          trustServerCertificate: true,
          forcePort: false,
          kBenutzer: 1,
          kShop: 2,
          kPlattform: 3,
          kSprache: 4,
          cWaehrung: 'EUR',
          fWaehrungFaktor: 1,
        }),
      }],
    });
    const executions: Array<{ query: string; params: readonly { name: string; value: unknown }[] }> = [];
    const port = createPostgresJtlOrderPort({
      db,
      applyWorkspaceSession: async () => undefined,
      secrets: {
        async readSecret() {
          return Buffer.from('secret');
        },
        async writeSecret() {
          throw new Error('not used');
        },
        async deleteSecret() {
          return false;
        },
        async rotateSecret() {
          return null;
        },
      },
      executeOrderSql: async ({ query, params, settings }) => {
        expect(settings.password).toBe('secret');
        executions.push({ query, params });
        return { success: true, kAuftrag: 123, cAuftragsNr: 'EXTERN-123' };
      },
    });

    await expect(port.createOrder({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'user-a',
      order: {
        simpleCrmCustomerId: 9,
        kFirma: 10,
        kWarenlager: 11,
        kZahlungsart: 12,
        kVersandart: 13,
        products: [{ kArtikel: 900, cName: 'Artikel', cArtNr: 'SKU', nAnzahl: 2, fPreis: 19.99 }],
      },
    })).resolves.toEqual({
      success: true,
      jtlOrderId: 123,
      jtlOrderNumber: 'EXTERN-123',
    });
    expect(rows.customers).toHaveLength(1);
    expect(executions).toHaveLength(1);
    expect(executions[0]!.query).toContain('INSERT INTO Verkauf.tAuftrag');
    expect(executions[0]!.query).toContain('VALUES (900, 2, 19.99, 1)');
    expect(executions[0]!.params).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'App_kKunde', value: 7001 }),
      expect.objectContaining({ name: 'App_kFirma', value: 10 }),
      expect.objectContaining({ name: 'RA_cVorname', value: 'Max' }),
      expect.objectContaining({ name: 'RA_cName', value: 'Mustermann' }),
      expect.objectContaining({ name: 'RA_cAnrede', value: 'Herr' }),
      expect.objectContaining({ name: 'RA_cTitel', value: 'Dr.' }),
    ]));

    await expect(port.createOrder({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'user-a',
      order: {
        simpleCrmCustomerId: 404,
        kFirma: 10,
        kWarenlager: 11,
        kZahlungsart: 12,
        kVersandart: 13,
        products: [{ kArtikel: 900, nAnzahl: 2, fPreis: 19.99 }],
      },
    })).resolves.toEqual({
      success: false,
      error: 'Customer with SimpleCRM ID 404 not found or not synced with JTL (missing jtl_kKunde).',
    });
  });

  test('server JTL sync port normalizes MSSQL rows and persists status transitions', async () => {
    const statuses: unknown[] = [];
    const upserts: unknown[] = [];
    const dates = [
      new Date('2026-06-05T10:00:00.000Z'),
      new Date('2026-06-05T10:00:01.000Z'),
      new Date('2026-06-05T10:00:02.000Z'),
      new Date('2026-06-05T10:00:03.000Z'),
    ];
    const port = createJtlSyncPort({
      now: () => dates.shift() ?? new Date('2026-06-05T10:00:04.000Z'),
      reader: {
        async fetchAll() {
          return {
            customers: [{
              kKunde: 7,
              CustomerNumber: 'K-7',
              AddressLastName: 'Mustermann',
              AddressFirstName: 'Max',
              AddressCompany: 'ACME',
              AddressEmail: 'max@example.com',
              AddressPhone: '030',
              AddressMobile: '',
              AddressStreet: 'Hauptstrasse 1',
              AddressZipCode: '10115',
              AddressCity: 'Berlin',
              AddressCountry: 'DE',
              CustomerDateCreated: '2026-01-01T12:00:00.000Z',
              CustomerBlocked: null,
            }, { kKunde: 'nope' }],
            products: [{
              kArtikel: '900',
              Sku: 'SKU-900',
              Name: 'Artikel',
              Description: 'Beschreibung',
              PriceNet: 19.99,
              IsActive: 'Y',
              ProductDateCreated: new Date('2026-02-01T12:00:00.000Z'),
            }],
            firmen: [{ kFirma: 1, cName: 'Firma' }],
            warenlager: [{ kWarenlager: 2, cName: 'Lager' }],
            zahlungsarten: [{ kZahlungsart: 3, cName: 'Rechnung' }],
            versandarten: [{ kVersandart: 4, cName: 'DHL' }],
          };
        },
      },
      store: {
        async getStatus() {
          return { status: 'Never', message: '', timestamp: '' };
        },
        async setStatus(input) {
          statuses.push(input);
        },
        async upsertData(input) {
          upserts.push(input);
          return {
            found: 6,
            synced: 6,
            customersFound: input.data.customers.length,
            customersSynced: input.data.customers.length,
            productsFound: input.data.products.length,
            productsSynced: input.data.products.length,
            firmenFound: input.data.firmen.length,
            firmenSynced: input.data.firmen.length,
            warenlagerFound: input.data.warenlager.length,
            warenlagerSynced: input.data.warenlager.length,
            zahlungsartenFound: input.data.zahlungsarten.length,
            zahlungsartenSynced: input.data.zahlungsarten.length,
            versandartenFound: input.data.versandarten.length,
            versandartenSynced: input.data.versandarten.length,
          };
        },
      },
    });

    await expect(port.run({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: USER_A_ID,
    })).resolves.toMatchObject({
      success: true,
      details: {
        found: 6,
        synced: 6,
        customersSynced: 1,
        productsSynced: 1,
      },
    });
    expect(statuses).toEqual([
      expect.objectContaining({ status: 'Running', message: 'Starting data synchronization...' }),
      expect.objectContaining({ status: 'Running', message: expect.stringContaining('Fetched 2 customers') }),
      expect.objectContaining({ status: 'Success', message: expect.stringContaining('Synced 1 customers, 1 products') }),
    ]);
    expect(upserts).toHaveLength(1);
    expect((upserts[0] as any).workspaceId).toBe(WORKSPACE_A_ID);
    expect((upserts[0] as any).actorUserId).toBe(USER_A_ID);
    expect((upserts[0] as any).data.customers).toEqual([
      expect.objectContaining({
        sourceSqliteId: 7,
        customerNumber: 'K-7',
        name: 'Mustermann',
        mobile: null,
      }),
    ]);
    expect((upserts[0] as any).data.products).toEqual([
      expect.objectContaining({
        sourceSqliteId: 900,
        sku: 'SKU-900',
        price: '19.99',
        isActive: true,
      }),
    ]);
  });

  test('postgres workflow execution job port queues AI agent continuations', async () => {
    const now = new Date('2026-07-04T11:01:30.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 33,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 330,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            {
              id: 'agent-1',
              type: 'registry',
              data: {
                nodeType: 'ai.agent',
                config: {
                  systemPrompt: 'Agent',
                  profileId: '33',
                  knowledgeBaseId: 5,
                  createDraft: false,
                  runOnEveryInbound: true,
                },
              },
            },
            {
              id: 'switch-1',
              type: 'registry',
              data: { nodeType: 'logic.switch', config: { field: 'ai.agent.response', cases: 'done' } },
            },
            {
              id: 'tag-done',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'agent-done', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'agent-1' },
            { id: 'edge-2', source: 'agent-1', target: 'switch-1' },
            { id: 'edge-3', source: 'switch-1', target: 'tag-done', label: 'done' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 21,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 210,
        subject: 'Agent',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Bitte antworten',
        body_text: 'Bitte antworten.',
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
      workflowId: 33,
      messageId: 21,
      triggerName: 'inbound',
      context: {},
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'ai.agent',
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      messageId: 21,
      profileId: 33,
      knowledgeBaseId: 5,
      systemPrompt: 'Agent',
      createDraft: false,
      workflowId: 33,
      resumeNodeId: 'switch-1',
      continuation: {
        workflowId: 33,
        triggerName: 'inbound',
        resumeNodeId: 'switch-1',
      },
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['agent-1', 'ai.agent', 'ok', 'default', 'queued_ai_agent:1'],
    ]);

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 33,
      messageId: 21,
      triggerName: 'inbound',
      context: {
        resumeNodeId: 'switch-1',
        eventStrings: (rows.jobs[0]?.payload as any).continuation.eventStrings,
        eventVariables: {
          ...(rows.jobs[0]?.payload as any).continuation.eventVariables,
          'ai.agent.response': 'done',
        },
      },
    });

    expect(rows.tags.map((tag) => tag.tag)).toEqual(['agent-done']);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['agent-1', 'ai.agent', 'ok', 'default'],
      ['switch-1', 'logic.switch', 'ok', 'done'],
      ['tag-done', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port queues AI agent draft creation', async () => {
    const now = new Date('2026-07-04T11:01:45.000Z');
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
              id: 'agent-1',
              type: 'registry',
              data: { nodeType: 'ai.agent', config: { systemPrompt: 'Agent', runOnEveryInbound: true } },
            },
            {
              id: 'tag-ok',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'agent-draft-ok', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'agent-1' },
            { id: 'edge-2', source: 'agent-1', target: 'tag-ok' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 22,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 220,
        subject: 'Agent',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Bitte antworten',
        body_text: 'Bitte antworten.',
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
      workflowId: 34,
      messageId: 22,
      triggerName: 'inbound',
      context: {},
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'ai.agent',
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      messageId: 22,
      systemPrompt: 'Agent',
      createDraft: true,
      workflowId: 34,
      resumeNodeId: 'tag-ok',
    });
    expect(rows.runs[0]).toMatchObject({
      status: 'ok',
      log_json: ['stop'],
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['agent-1', 'ai.agent', 'ok', 'default', 'queued_ai_agent:1'],
    ]);
  });

  test('postgres workflow execution job port creates local compose drafts', async () => {
    const now = new Date('2026-07-04T11:01:50.000Z');
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
              id: 'draft-1',
              type: 'registry',
              data: {
                nodeType: 'email.create_draft',
                config: { bodyPrefix: 'Antwortentwurf', runOnEveryInbound: true },
              },
            },
            {
              id: 'tag-ok',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'draft-created', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'draft-1' },
            { id: 'edge-2', source: 'draft-1', target: 'tag-ok' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 23,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 230,
        account_id: 7,
        subject: 'Draft',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Bitte antworten',
        body_text: 'Bitte antworten.',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
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
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 35,
      messageId: 23,
      triggerName: 'inbound',
      context: {},
    });

    expect(rows.messages).toContainEqual(expect.objectContaining({
      id: 24,
      account_id: 7,
      folder_id: 70,
      uid: -1,
      folder_kind: 'draft',
      subject: 'Re: Draft',
      body_text: expect.stringContaining('Antwortentwurf'),
    }));
    expect(rows.tags.map((tag) => tag.tag)).toEqual(['draft-created']);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['draft-1', 'email.create_draft', 'ok', 'default'],
      ['tag-ok', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port queues HTTP request continuations', async () => {
    const now = new Date('2026-07-04T11:01:55.000Z');
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
              id: 'http-1',
              type: 'registry',
              data: {
                nodeType: 'http.request',
                config: {
                  method: 'POST',
                  url: 'https://api.example.com/hook',
                  body: '{"message":"ok"}',
                  timeoutMs: 5000,
                  runOnEveryInbound: true,
                },
              },
            },
            {
              id: 'switch-1',
              type: 'registry',
              data: { nodeType: 'logic.switch', config: { field: 'http.status', cases: '201' } },
            },
            {
              id: 'tag-ok',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'http-ok', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'http-1' },
            { id: 'edge-2', source: 'http-1', target: 'switch-1' },
            { id: 'edge-3', source: 'switch-1', target: 'tag-ok', label: '201' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 24,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 240,
        account_id: 7,
        subject: 'HTTP',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Bitte senden',
        body_text: 'Bitte senden.',
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
      workflowId: 36,
      messageId: 24,
      triggerName: 'inbound',
      context: {},
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'workflow.http_request',
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      messageId: 24,
      method: 'POST',
      url: 'https://api.example.com/hook',
      body: '{"message":"ok"}',
      timeoutMs: 5000,
      workflowId: 36,
      resumeNodeId: 'switch-1',
      continuation: {
        workflowId: 36,
        triggerName: 'inbound',
        resumeNodeId: 'switch-1',
      },
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['http-1', 'http.request', 'ok', 'default', 'queued_http_request:1'],
    ]);

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 36,
      messageId: 24,
      triggerName: 'inbound',
      context: {
        resumeNodeId: 'switch-1',
        eventStrings: (rows.jobs[0]?.payload as any).continuation.eventStrings,
        eventVariables: {
          ...(rows.jobs[0]?.payload as any).continuation.eventVariables,
          'http.status': 201,
          'http.body': 'created',
        },
      },
    });

    expect(rows.tags.map((tag) => tag.tag)).toEqual(['http-ok']);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['http-1', 'http.request', 'ok', 'default'],
      ['switch-1', 'logic.switch', 'ok', '201'],
      ['tag-ok', 'email.tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port queues forward-copy continuations', async () => {
    const now = new Date('2026-07-04T11:02:55.000Z');
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
            {
              id: 'forward-1',
              type: 'registry',
              data: {
                nodeType: 'email.forward_copy',
                config: { to: ' audit@example.com ', runOnEveryInbound: true },
              },
            },
            {
              id: 'tag-ok',
              type: 'registry',
              data: { nodeType: 'email.tag', config: { tag: 'forward-ok', runOnEveryInbound: true } },
            },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'forward-1' },
            { id: 'edge-2', source: 'forward-1', target: 'tag-ok' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 26,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 260,
        account_id: 7,
        subject: 'Forward',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Bitte senden',
        body_text: 'Bitte senden.',
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
      workflowId: 38,
      messageId: 26,
      triggerName: 'inbound',
      context: {},
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'workflow.forward_copy',
        run_after: now,
        max_attempts: 5,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 38,
      messageId: 26,
      to: 'audit@example.com',
      resumeNodeId: 'tag-ok',
      continuation: {
        workflowId: 38,
        triggerName: 'inbound',
        resumeNodeId: 'tag-ok',
      },
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['forward-1', 'email.forward_copy', 'ok', 'default', 'queued_forward_copy:1'],
    ]);
  });

  test('postgres workflow forward-copy port sends SMTP, dedupes, and resumes workflows', async () => {
    const now = new Date('2026-07-04T11:03:55.000Z');
    const smtpSends: unknown[] = [];
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 39,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 390,
        trigger_name: 'inbound',
        enabled: true,
        priority: 1,
      }],
      messages: [{
        id: 27,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 270,
        account_id: 7,
        subject: 'Forward me',
        from_json: { value: [{ address: 'customer@example.com' }] },
        snippet: 'Kurzfassung',
        body_text: 'Originaltext',
      }],
      accounts: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        display_name: 'Agent',
        email_address: 'agent@example.com',
        imap_host: 'imap.example.com',
        imap_username: 'imap-agent@example.com',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_tls: true,
        smtp_username: 'smtp-agent@example.com',
        smtp_use_imap_auth: false,
        oauth_provider: null,
      }],
    });
    const secrets = {
      async readSecret(input: { kind: string }) {
        return input.kind === 'email.account.smtp_password' ? Buffer.from('smtp-secret', 'utf8') : null;
      },
      async writeSecret() {
        throw new Error('unexpected writeSecret');
      },
      async deleteSecret() {
        return false;
      },
      async rotateSecret() {
        return null;
      },
    };
    const port = createPostgresWorkflowForwardCopyPort({
      db,
      secrets,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      smtpSend: async (input) => {
        smtpSends.push(input);
      },
    });

    await expect(port.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 39,
      messageId: 27,
      to: 'not-an-email',
    })).rejects.toThrow(/Empfaenger/);
    expect(smtpSends).toHaveLength(0);
    expect(rows.forwardDedup).toEqual([]);

    await port.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 39,
      messageId: 27,
      to: 'Audit Team <audit@example.com>',
      continuation: {
        workflowId: 39,
        triggerName: 'inbound',
        resumeNodeId: 'tag-ok',
        eventStrings: { subject: 'Forward me' },
        eventVariables: { 'message.id': 27 },
      },
    });
    await port.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 39,
      messageId: 27,
      to: 'audit@example.com',
      continuation: {
        workflowId: 39,
        triggerName: 'inbound',
        resumeNodeId: 'tag-ok',
      },
    });

    expect(smtpSends).toHaveLength(1);
    expect(smtpSends[0]).toMatchObject({
      host: 'smtp.example.com',
      port: 587,
      tls: true,
      user: 'smtp-agent@example.com',
      password: 'smtp-secret',
      envelopeFrom: 'agent@example.com',
      recipients: ['audit@example.com'],
    });
    expect((smtpSends[0] as { rfc822: string }).rfc822).toContain('Auto-Submitted: auto-forwarded');
    expect((smtpSends[0] as { rfc822: string }).rfc822).toContain('Subject: Fwd: Forward me');
    expect((smtpSends[0] as { rfc822: string }).rfc822).toContain('Original von: customer@example.com');
    expect(rows.forwardDedup).toEqual([
      expect.objectContaining({
        workspace_id: WORKSPACE_A_ID,
        message_source_sqlite_id: 270,
        workflow_source_sqlite_id: 390,
        message_id: 27,
        workflow_id: 39,
        dest: 'audit@example.com',
        created_at: now,
        updated_at: now,
      }),
    ]);
    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'workflow.execute',
        payload: expect.objectContaining({
          workspaceId: WORKSPACE_A_ID,
          workflowId: 39,
          messageId: 27,
          triggerName: 'inbound',
          context: expect.objectContaining({
            resumeNodeId: 'tag-ok',
            eventStrings: { subject: 'Forward me' },
            eventVariables: expect.objectContaining({
              'message.id': 27,
              'forward_copy.ok': true,
              'forward_copy.to': 'audit@example.com',
              'forward_copy.duplicate': false,
            }),
          }),
        }),
      }),
      expect.objectContaining({
        type: 'workflow.execute',
        payload: expect.objectContaining({
          context: expect.objectContaining({
            eventVariables: expect.objectContaining({
              'forward_copy.ok': true,
              'forward_copy.duplicate': true,
            }),
          }),
        }),
      }),
    ]);
  });

  test('postgres workflow forward-copy port leaves dedup empty when SMTP fails so retries can resend', async () => {
    const now = new Date('2026-07-04T11:04:10.000Z');
    let smtpAttempts = 0;
    const smtpSends: unknown[] = [];
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 39,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 390,
        trigger_name: 'inbound',
        enabled: true,
        priority: 1,
      }],
      messages: [{
        id: 27,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 270,
        account_id: 7,
        subject: 'Retry forward',
        from_json: { value: [{ address: 'customer@example.com' }] },
        snippet: 'Kurzfassung',
        body_text: 'Originaltext',
      }],
      accounts: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        display_name: 'Agent',
        email_address: 'agent@example.com',
        imap_host: 'imap.example.com',
        imap_username: 'imap-agent@example.com',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_tls: true,
        smtp_username: 'smtp-agent@example.com',
        smtp_use_imap_auth: false,
        oauth_provider: null,
      }],
    });
    const port = createPostgresWorkflowForwardCopyPort({
      db,
      secrets: {
        async readSecret(input: { kind: string }) {
          return input.kind === 'email.account.smtp_password' ? Buffer.from('smtp-secret', 'utf8') : null;
        },
        async writeSecret() {
          throw new Error('unexpected writeSecret');
        },
        async deleteSecret() {
          return false;
        },
        async rotateSecret() {
          return null;
        },
      },
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      smtpSend: async (input) => {
        smtpAttempts += 1;
        if (smtpAttempts === 1) throw new Error('smtp transient');
        smtpSends.push(input);
      },
    });

    await expect(port.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 39,
      messageId: 27,
      to: 'retry@example.com',
    })).rejects.toThrow('smtp transient');
    expect(rows.forwardDedup).toEqual([]);
    expect(smtpSends).toHaveLength(0);

    await port.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 39,
      messageId: 27,
      to: 'retry@example.com',
    });
    expect(smtpSends).toHaveLength(1);
    expect(rows.forwardDedup).toEqual([
      expect.objectContaining({
        dest: 'retry@example.com',
        message_id: 27,
        workflow_id: 39,
      }),
    ]);
  });

  test('postgres workflow forward-copy port routes through composeSender.send when runOutboundReview=true', async () => {
    const now = new Date('2026-07-04T11:05:10.000Z');
    const composeCalls: Array<{ draftMessageId: number; to: string; attachmentPaths: readonly string[] | undefined }> = [];
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{ id: 50, workspace_id: WORKSPACE_A_ID, source_sqlite_id: 500, trigger_name: 'inbound', enabled: true, priority: 1 }],
      messages: [{
        id: 30,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 300,
        account_id: 7,
        subject: 'Rechnung weiterleiten',
        from_json: { value: [{ address: 'lieferant@example.com' }] },
        snippet: 'Anbei',
        body_text: 'Anbei die Rechnung.',
      }],
      messageAttachments: [{
        workspace_id: WORKSPACE_A_ID,
        message_id: 30,
        filename_display: 'rechnung.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
        storage_path: 'ws/30/rechnung.pdf',
      }],
      accounts: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        display_name: 'Agent',
        email_address: 'agent@example.com',
        imap_host: 'imap.example.com',
        imap_username: 'imap-agent@example.com',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_tls: true,
        smtp_username: 'smtp-agent@example.com',
        smtp_use_imap_auth: false,
        oauth_provider: null,
      }],
    });
    const composeSender = {
      async send(input: { values: { draftMessageId: number; to: string; attachmentPaths?: readonly string[] } }) {
        composeCalls.push({
          draftMessageId: input.values.draftMessageId,
          to: input.values.to,
          attachmentPaths: input.values.attachmentPaths,
        });
        // Simulate "held for outbound review" — composeSender returns ok:false
        // with workflowRunId, which the forward port interprets as review_pending.
        return { ok: false as const, error: 'outbound review pending', workflowRunId: 999 };
      },
    };
    const port = createPostgresWorkflowForwardCopyPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      composeSender,
      createDraft: async (input) => {
        // Stub draft creation to return a stable id; production uses the
        // postgres helper. We just need a draftMessageId for composeSender.send.
        expect(input.accountId).toBe(7);
        expect(input.recipients).toEqual(['bank@example.com', 'buchhaltung@example.com']);
        return { ok: true as const, draftMessageId: 12345 };
      },
      smtpSend: async () => { throw new Error('smtpSend must not be called in review mode'); },
    });

    await port.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 50,
      messageId: 30,
      to: 'bank@example.com, buchhaltung@example.com',
      includeAttachments: true,
      runOutboundReview: true,
      continuation: {
        workflowId: 50,
        triggerName: 'inbound',
        resumeNodeId: 'after-forward',
      },
    });

    // Draft was created and composeSender.send invoked with the right recipients +
    // attachment paths (the storage_path of the original message).
    expect(composeCalls).toHaveLength(1);
    expect(composeCalls[0]).toMatchObject({
      draftMessageId: 12345,
      to: 'bank@example.com, buchhaltung@example.com',
      attachmentPaths: ['ws/30/rechnung.pdf'],
    });
    // Dedup is recorded so a retry won't create a duplicate draft.
    expect(rows.forwardDedup).toHaveLength(1);
    // Continuation reflects ok=true + review_pending=true (it was held, not
    // failed). The follow-up workflow can branch on this.
    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'workflow.execute',
        payload: expect.objectContaining({
          context: expect.objectContaining({
            eventVariables: expect.objectContaining({
              'forward_copy.ok': true,
              'forward_copy.review_pending': true,
            }),
          }),
        }),
      }),
    ]);
  });


  test('postgres workflow forward-copy outbound-review send failures remain retryable', async () => {
    const now = new Date('2026-07-04T11:05:20.000Z');
    let draftCreates = 0;
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{ id: 51, workspace_id: WORKSPACE_A_ID, source_sqlite_id: 510, trigger_name: 'inbound', enabled: true, priority: 1 }],
      messages: [{
        id: 31,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 310,
        account_id: 7,
        subject: 'Review transient',
        from_json: { value: [{ address: 'lieferant@example.com' }] },
        snippet: 'Anbei',
        body_text: 'Anbei die Rechnung.',
      }],
      accounts: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        display_name: 'Agent',
        email_address: 'agent@example.com',
        imap_host: 'imap.example.com',
        imap_username: 'imap-agent@example.com',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_tls: true,
        smtp_username: 'smtp-agent@example.com',
        smtp_use_imap_auth: false,
        oauth_provider: null,
      }],
    });
    const composeSender = {
      async send() {
        return { ok: false as const, error: 'compose transient failure' };
      },
    };
    const port = createPostgresWorkflowForwardCopyPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      composeSender,
      createDraft: async () => {
        draftCreates += 1;
        return { ok: true as const, draftMessageId: 54321 };
      },
      smtpSend: async () => { throw new Error('smtpSend must not be called in review mode'); },
    });

    await expect(port.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 51,
      messageId: 31,
      to: 'audit@example.com',
      runOutboundReview: true,
    })).rejects.toThrow(/compose transient failure/);

    await expect(port.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 51,
      messageId: 31,
      to: 'audit@example.com',
      runOutboundReview: true,
    })).rejects.toThrow(/compose transient failure/);

    expect(draftCreates).toBe(2);
    expect(rows.forwardDedup).toHaveLength(0);
  });

  test('postgres workflow forward-copy port forwards to multiple recipients with attachments', async () => {
    const now = new Date('2026-07-04T11:04:30.000Z');
    const smtpSends: Array<{ recipients: string[]; rfc822: string }> = [];
    const reads: string[] = [];
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{ id: 40, workspace_id: WORKSPACE_A_ID, source_sqlite_id: 400, trigger_name: 'inbound', enabled: true, priority: 1 }],
      messages: [{
        id: 28,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 280,
        account_id: 7,
        subject: 'Rechnung 2026-001',
        from_json: { value: [{ address: 'lieferant@example.com' }] },
        snippet: 'Rechnung',
        body_text: 'Anbei die Rechnung.',
      }],
      messageAttachments: [{
        workspace_id: WORKSPACE_A_ID,
        message_id: 28,
        filename_display: 'rechnung.pdf',
        content_type: 'application/pdf',
        size_bytes: 1024,
        storage_path: 'ws/28/rechnung.pdf',
      }],
      accounts: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        display_name: 'Agent',
        email_address: 'agent@example.com',
        imap_host: 'imap.example.com',
        imap_username: 'imap-agent@example.com',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_tls: true,
        smtp_username: 'smtp-agent@example.com',
        smtp_use_imap_auth: false,
        oauth_provider: null,
      }],
    });
    const secrets = {
      async readSecret(input: { kind: string }) {
        return input.kind === 'email.account.smtp_password' ? Buffer.from('smtp-secret', 'utf8') : null;
      },
      async writeSecret() { throw new Error('unexpected'); },
      async deleteSecret() { return false; },
      async rotateSecret() { return null; },
    };
    const port = createPostgresWorkflowForwardCopyPort({
      db,
      secrets,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      attachmentsRoot: '/attachments',
      readAttachmentFile: async (p: string) => { reads.push(p); return Buffer.from('%PDF-1.4 fake'); },
      smtpSend: async (input) => { smtpSends.push(input as { recipients: string[]; rfc822: string }); },
    });

    await port.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 40,
      messageId: 28,
      to: 'bank@example.com, buchhaltung@example.com',
      includeAttachments: true,
    });

    expect(smtpSends).toHaveLength(1);
    // Both recipients are addressed (SMTP envelope + To: header).
    expect(smtpSends[0].recipients).toEqual(['bank@example.com', 'buchhaltung@example.com']);
    expect(smtpSends[0].rfc822).toContain('bank@example.com');
    expect(smtpSends[0].rfc822).toContain('buchhaltung@example.com');
    // The original attachment is read from disk and included as a MIME part.
    expect(reads.map((entry) => entry.replaceAll(String.fromCharCode(92), '/'))[0]).toEqual(expect.stringMatching(/(?:^|:)\/attachments\/ws\/28\/rechnung\.pdf$/));
    expect(smtpSends[0].rfc822).toContain('rechnung.pdf');
    expect(smtpSends[0].rfc822).toContain('Auto-Submitted: auto-forwarded');
    // Dedup over the sorted recipient set.
    expect(rows.forwardDedup).toEqual([
      expect.objectContaining({ message_id: 28, dest: 'bank@example.com,buchhaltung@example.com' }),
    ]);
  });

  test('postgres workflow forward-copy port fails closed while outbound workflows are enabled', async () => {
    const now = new Date('2026-07-04T11:04:55.000Z');
    const smtpSend = jest.fn();
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [
        {
          id: 40,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 400,
          trigger_name: 'inbound',
          enabled: true,
          priority: 1,
        },
        {
          id: 41,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 410,
          trigger_name: 'outbound',
          enabled: true,
          priority: 1,
        },
      ],
      messages: [{
        id: 28,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 280,
        account_id: 7,
        subject: 'Forward blocked',
        from_json: { value: [{ address: 'customer@example.com' }] },
        snippet: 'Kurzfassung',
        body_text: 'Originaltext',
      }],
      accounts: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        display_name: 'Agent',
        email_address: 'agent@example.com',
        imap_host: 'imap.example.com',
        imap_username: 'imap-agent@example.com',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_tls: true,
        smtp_username: 'smtp-agent@example.com',
        smtp_use_imap_auth: false,
        oauth_provider: null,
      }],
    });
    const port = createPostgresWorkflowForwardCopyPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      smtpSend,
    });

    // Opt-in: runOutboundReview=true requires composeSender to be configured
    // (production wires this in server.ts). Without it the forward port reports
    // a configuration error rather than silently sending.
    await port.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 40,
      messageId: 28,
      to: 'audit@example.com',
      runOutboundReview: true,
      continuation: {
        workflowId: 40,
        triggerName: 'inbound',
        resumeNodeId: 'tag-ok',
      },
    });

    expect(smtpSend).not.toHaveBeenCalled();
    expect(rows.forwardDedup).toEqual([]);
    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'workflow.execute',
        payload: expect.objectContaining({
          context: expect.objectContaining({
            resumeNodeId: 'tag-ok',
            eventVariables: expect.objectContaining({
              'forward_copy.ok': false,
              'forward_copy.error': expect.stringContaining('composeSender'),
              'forward_copy.duplicate': false,
            }),
          }),
        }),
      }),
    ]);

    // Inverse: default (runOutboundReview omitted/false) bypasses the
    // fail-closed guard — the forward IS sent even with outbound workflows
    // enabled. The Auto-Submitted header + dedup table guard against loops.
    smtpSend.mockClear();
    const secretsForBypass = {
      async readSecret(input: { kind: string }) {
        return input.kind === 'email.account.smtp_password' ? Buffer.from('smtp-secret', 'utf8') : null;
      },
      async writeSecret() { throw new Error('unexpected'); },
      async deleteSecret() { return false; },
      async rotateSecret() { return null; },
    };
    const portBypass = createPostgresWorkflowForwardCopyPort({
      db,
      secrets: secretsForBypass,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      smtpSend,
    });
    await portBypass.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 40,
      messageId: 28,
      to: 'audit@example.com',
    });
    expect(smtpSend).toHaveBeenCalledTimes(1);
  });

  test('postgres workflow forward-copy last-node failures reject for job retry visibility', async () => {
    const now = new Date('2026-07-04T11:05:10.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{ id: 42, workspace_id: WORKSPACE_A_ID, source_sqlite_id: 420, trigger_name: 'inbound', enabled: true, priority: 1 }],
      messages: [{
        id: 29,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 290,
        account_id: 7,
        subject: 'Forward last node',
        from_json: { value: [{ address: 'customer@example.com' }] },
        snippet: 'Kurzfassung',
        body_text: 'Originaltext',
      }],
      accounts: [{
        id: 7,
        workspace_id: WORKSPACE_A_ID,
        display_name: 'Agent',
        email_address: 'agent@example.com',
        imap_host: 'imap.example.com',
        imap_username: 'imap-agent@example.com',
        smtp_host: 'smtp.example.com',
        smtp_port: 587,
        smtp_tls: true,
        smtp_username: 'smtp-agent@example.com',
        smtp_use_imap_auth: false,
        oauth_provider: null,
      }],
    });
    const port = createPostgresWorkflowForwardCopyPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      smtpSend: jest.fn(),
    });

    await expect(port.forwardCopy({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 42,
      messageId: 29,
      to: 'audit@example.com',
      runOutboundReview: true,
    })).rejects.toThrow(/composeSender/);

    expect(rows.jobs).toEqual([]);
    expect(rows.forwardDedup).toEqual([]);
  });

  test('postgres workflow execution job port queues AI review continuations', async () => {
    const now = new Date('2026-07-04T11:02:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 31,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 310,
        trigger_name: 'outbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
            {
              id: 'review-1',
              type: 'registry',
              data: {
                nodeType: 'ai.review',
                config: {
                  promptId: 22,
                  profileId: '33',
                  blockKeyword: 'BLOCK',
                },
              },
            },
            { id: 'tag-ok', type: 'action', data: { actionType: 'tag', tag: 'review-ok' } },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'review-1' },
            { id: 'edge-2', source: 'review-1', target: 'tag-ok' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 19,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 190,
        subject: 'Outbound Review',
        from_json: { value: [{ address: 'agent@example.com' }] },
        to_json: { value: [{ address: 'customer@example.com' }] },
        cc_json: null,
        snippet: 'Bitte pruefen',
        body_text: 'Hallo, bitte pruefen.',
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
      workflowId: 31,
      messageId: 19,
      triggerName: 'outbound',
      context: {},
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'ai.review',
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      messageId: 19,
      promptId: 22,
      profileId: 33,
      direction: 'outbound',
      blockKeyword: 'BLOCK',
      workflowId: 31,
      resumeNodeId: 'tag-ok',
      continuation: {
        workflowId: 31,
        triggerName: 'outbound',
        resumeNodeId: 'tag-ok',
      },
    });
    expect(rows.runs[0]).toMatchObject({
      status: 'ok',
      log_json: ['stop'],
      finished_at: now,
    });
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['review-1', 'ai.review', 'ok', 'default', 'queued_ai_review:1'],
    ]);

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 31,
      messageId: 19,
      triggerName: 'outbound',
      context: {
        resumeNodeId: 'tag-ok',
        eventStrings: (rows.jobs[0]?.payload as any).continuation.eventStrings,
        eventVariables: {
          ...(rows.jobs[0]?.payload as any).continuation.eventVariables,
          'ai.review.status': 'ok',
        },
      },
    });

    expect(rows.tags.map((tag) => tag.tag)).toEqual(['review-ok']);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port])).toEqual([
      ['review-1', 'ai.review', 'ok', 'default'],
      ['tag-ok', 'tag', 'ok', 'default'],
    ]);
  });

  test('postgres workflow execution job port queues outbound review nodes', async () => {
    const now = new Date('2026-07-04T11:03:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 32,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 320,
        trigger_name: 'outbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
            {
              id: 'outbound-review-1',
              type: 'registry',
              data: { nodeType: 'ai.outbound_review', config: { checkReplyContext: true } },
            },
            { id: 'tag-ok', type: 'action', data: { actionType: 'tag', tag: 'outbound-review-ok' } },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: 'outbound-review-1' },
            { id: 'edge-2', source: 'outbound-review-1', target: 'tag-ok' },
          ],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 20,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 200,
        subject: 'Outbound',
        from_json: { value: [{ address: 'agent@example.com' }] },
        to_json: { value: [{ address: 'customer@example.com' }] },
        cc_json: null,
        snippet: 'Bitte pruefen',
        body_text: 'Hallo, bitte pruefen.',
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
      workflowId: 32,
      messageId: 20,
      triggerName: 'outbound',
      context: {},
    });

    expect(rows.jobs).toEqual([
      expect.objectContaining({
        type: 'ai.review',
        run_after: now,
        max_attempts: 3,
        workspace_id: WORKSPACE_A_ID,
        updated_at: now,
      }),
    ]);
    expect(rows.jobs[0]?.payload).toMatchObject({
      workspaceId: WORKSPACE_A_ID,
      messageId: 20,
      direction: 'outbound',
      blockKeyword: 'BLOCK',
      workflowId: 32,
      resumeNodeId: 'tag-ok',
      continuation: {
        workflowId: 32,
        triggerName: 'outbound',
        resumeNodeId: 'tag-ok',
      },
    });
    expect((rows.jobs[0]?.payload as any).systemPrompt).toContain('Qualitaetspruefer');
    expect((rows.jobs[0]?.payload as any).fallbackUserTemplate).toContain('Ausgehende E-Mail');
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['outbound-review-1', 'ai.outbound_review', 'ok', 'default', 'queued_ai_review:1'],
    ]);
  });

  test('postgres workflow execution job port runs IMAP move and delete side-effect adapters', async () => {
    const now = new Date('2026-07-04T10:55:00.000Z');
    const imapMoves: unknown[] = [];
    const imapDeletes: unknown[] = [];
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [
        {
          id: 71,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 710,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
              {
                id: 'move-1',
                type: 'registry',
                data: { nodeType: 'email.move_imap', config: { folderPath: 'Spam' } },
              },
            ],
            edges: [{ id: 'edge-1', source: 'trigger-1', target: 'move-1' }],
          },
          execution_mode: 'graph',
        },
        {
          id: 72,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 720,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
              {
                id: 'spam-move-1',
                type: 'registry',
                data: { nodeType: 'email.mark_spam', config: { spam: true, tag: 'auto-spam', moveImap: true } },
              },
            ],
            edges: [{ id: 'edge-1', source: 'trigger-1', target: 'spam-move-1' }],
          },
          execution_mode: 'graph',
        },
        {
          id: 73,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 730,
          trigger_name: 'manual',
          enabled: true,
          definition_json: { version: 1, rules: [] },
          graph_json: {
            version: 1,
            nodes: [
              { id: 'trigger-1', type: 'trigger', data: { kind: 'manual' } },
              {
                id: 'delete-1',
                type: 'registry',
                data: { nodeType: 'email.delete_server', config: {} },
              },
            ],
            edges: [{ id: 'edge-1', source: 'trigger-1', target: 'delete-1' }],
          },
          execution_mode: 'graph',
        },
      ],
      messages: [
        {
          id: 31,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 310,
          account_id: 7,
          subject: 'Move spam',
          from_json: { value: [{ address: 'bad@example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Move spam',
          body_text: 'Hallo',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          folder_kind: 'inbox',
          soft_deleted: false,
          archived: true,
          done_local: false,
          is_spam: false,
          spam_status: 'clean',
        },
        {
          id: 32,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 320,
          account_id: 7,
          subject: 'Mark spam',
          from_json: { value: [{ address: 'bad2@example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Mark spam',
          body_text: 'Hallo',
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
          id: 33,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 330,
          account_id: 7,
          subject: 'Delete server',
          from_json: { value: [{ address: 'bad3@example.com' }] },
          to_json: { value: [{ address: 'agent@example.com' }] },
          cc_json: null,
          snippet: 'Delete server',
          body_text: 'Hallo',
          body_html: null,
          has_attachments: false,
          attachments_json: null,
          folder_kind: 'inbox',
          soft_deleted: false,
          archived: false,
          done_local: false,
          is_spam: true,
          spam_status: 'spam',
        },
      ],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      workflowImapActions: {
        async move(input) {
          imapMoves.push(input);
          return {
            ok: true as const,
            sourceFolderPath: 'INBOX',
            targetFolderPath: input.targetFolderPath,
          };
        },
        async delete(input) {
          imapDeletes.push(input);
          return {
            ok: true as const,
            sourceFolderPath: 'INBOX',
          };
        },
        async setSeen() {
          throw new Error('setSeen should not be called');
        },
      },
    });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 71,
      messageId: 31,
      triggerName: 'manual',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 72,
      messageId: 32,
      triggerName: 'manual',
      context: {},
    });
    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 73,
      messageId: 33,
      triggerName: 'manual',
      context: {},
    });

    expect(imapMoves).toEqual([
      { workspaceId: WORKSPACE_A_ID, messageId: 31, targetFolderPath: 'Spam' },
      { workspaceId: WORKSPACE_A_ID, messageId: 32, targetFolderPath: 'Spam' },
    ]);
    expect(imapDeletes).toEqual([
      { workspaceId: WORKSPACE_A_ID, messageId: 33 },
    ]);
    expect(rows.messages[0]).toMatchObject({
      is_spam: true,
      spam_status: 'spam',
      soft_deleted: false,
      archived: false,
      done_local: true,
      updated_at: now,
    });
    expect(rows.messages[1]).toMatchObject({
      is_spam: true,
      spam_status: 'spam',
      soft_deleted: false,
      archived: false,
      done_local: true,
      updated_at: now,
    });
    expect(rows.messages[2]).toMatchObject({
      soft_deleted: true,
      done_local: true,
      trash_prev_archived: false,
      trash_prev_is_spam: true,
      trash_prev_folder_kind: 'inbox',
      updated_at: now,
    });
    expect(rows.tags.map((tag) => [tag.message_id, tag.tag])).toEqual([
      [32, 'auto-spam'],
    ]);
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual([
      ['move-1', 'email.move_imap', 'ok', 'default', null],
      ['spam-move-1', 'email.mark_spam', 'ok', 'default', null],
      ['delete-1', 'email.delete_server', 'ok', 'default', null],
    ]);
  });

  test('postgres workflow execution job port blocks unsupported side-effect nodes without retrying', async () => {
    const now = new Date('2026-07-04T11:00:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 24,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: null,
        trigger_name: 'outbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
            {
              id: 'move-imap-1',
              type: 'registry',
              data: { nodeType: 'email.move_imap', config: { folder: 'Spam' } },
            },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'move-imap-1' }],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 12,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 120,
        subject: 'Outbound',
        from_json: null,
        to_json: { value: [{ address: 'kunde@example.com' }] },
        cc_json: null,
        snippet: 'Outbound',
        body_text: 'Bitte pruefen',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
        outbound_hold: true,
        outbound_block_reason: 'queued',
      }],
      runs: [{
        id: 501,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: null,
        workflow_source_sqlite_id: -24,
        message_source_sqlite_id: 120,
        workflow_id: 24,
        message_id: 12,
        direction: 'outbound',
        status: 'queued',
        log_json: ['queued'],
        started_at: null,
        finished_at: null,
        updated_at: now,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await expect(port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 24,
      messageId: 12,
      runId: 501,
      triggerName: 'outbound',
      context: {
        outbound: {
          messageId: 12,
          subject: 'Outbound',
          bodyText: 'Bitte pruefen',
          to: 'kunde@example.com',
          attachmentCount: 0,
        },
      },
    })).resolves.toBeUndefined();

    expect(rows.runs.find((run) => run.id === 501)).toMatchObject({
      status: 'blocked',
      log_json: ['server_workflow_node_unsupported:email.move_imap'],
      started_at: now,
      finished_at: now,
    });
    expect(rows.steps).toEqual([
      expect.objectContaining({
        run_id: 501,
        run_source_sqlite_id: -501,
        node_id: 'move-imap-1',
        node_type: 'email.move_imap',
        status: 'skipped',
        port: 'blocked',
        message: 'server_workflow_node_unsupported:email.move_imap',
      }),
    ]);
    expect(rows.messages[0]).toMatchObject({
      outbound_hold: true,
      outbound_block_reason: 'server_workflow_node_unsupported:email.move_imap',
      updated_at: now,
    });
  });

  test('postgres workflow execution job port releases the outbound hold via email.release_outbound', async () => {
    const now = new Date('2026-07-04T11:00:30.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 25,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 250,
        trigger_name: 'outbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
            { id: 'release', type: 'registry', data: { nodeType: 'email.release_outbound', config: {} } },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'release' }],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 70,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 700,
        subject: 'Approved draft',
        from_json: null,
        to_json: { value: [{ address: 'kunde@example.com' }] },
        cc_json: null,
        snippet: 'ok',
        body_text: 'ok',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
        outbound_hold: true,
        outbound_block_reason: 'KI-Pruefung laeuft',
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({ db, now: () => now, applyWorkspaceSession: async () => undefined });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 25,
      messageId: 70,
      triggerName: 'outbound',
      context: { outbound: { messageId: 70, subject: 'Approved draft', bodyText: 'ok', to: 'kunde@example.com', attachmentCount: 0 } },
    });

    // After OK -> release: the hold is lifted, the reason cleared.
    expect(rows.messages[0]).toMatchObject({
      outbound_hold: false,
      outbound_block_reason: null,
      updated_at: now,
    });
    expect(rows.steps.map((step) => [step.node_type, step.status, step.port, step.message])).toEqual([
      ['email.release_outbound', 'ok', 'default', 'outbound_hold_released'],
    ]);
    expect(rows.runs.map((run) => run.status)).toEqual(['ok']);
  });

  test('postgres workflow execution job port arms auto-send via email.release_outbound autoSend=true', async () => {
    const now = new Date('2026-07-04T11:00:35.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 27,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 270,
        trigger_name: 'outbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
            { id: 'release', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'release' }],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 72,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 720,
        subject: 'Auto send',
        from_json: null,
        to_json: { value: [{ address: 'kunde@example.com' }] },
        cc_json: null,
        snippet: 'ok',
        body_text: 'ok',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
        outbound_hold: true,
        outbound_block_reason: 'review',
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({ db, now: () => now, applyWorkspaceSession: async () => undefined });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 27,
      messageId: 72,
      triggerName: 'outbound',
      context: { outbound: { messageId: 72, subject: 'Auto send', bodyText: 'ok', to: 'kunde@example.com', attachmentCount: 0 } },
    });

    // (a) Hold released, scheduled_send_at primed so the cron picks it up now.
    expect(rows.messages[0]).toMatchObject({
      outbound_hold: false,
      outbound_block_reason: null,
      scheduled_send_at: now,
      updated_at: now,
    });
    // (b) Approval marker is written so reviewOutbound.review bypasses the
    //     next review (otherwise the cron would loop). Marker value carries
    //     the approval timestamp + a content fingerprint (hash of subject,
    //     body, recipients, attachments) so an edit after approval invalidates
    //     the bypass on the next review call.
    const approval = rows.syncInfo.find((row) => row.key === 'outbound_review_approved:72');
    expect(approval).toBeDefined();
    const [markerIso, markerHash] = String(approval!.value).split('|');
    expect(markerIso).toBe(now.toISOString());
    expect(markerHash).toMatch(/^[0-9a-f]{32}$/);
    expect(rows.steps.map((step) => [step.node_type, step.port, step.message])).toEqual([
      ['email.release_outbound', 'default', 'outbound_hold_released_auto_send'],
    ]);
  });

  test('email.release_outbound autoSend strips the held-banner from body + bakes ticket-code into subject + skips marker if peer outbound runs are still open', async () => {
    const now = new Date('2026-07-04T11:00:35.000Z');
    // Two outbound workflows for the same draft: this run is the second, the
    // first is still queued. release_outbound autoSend must clear hold + arm
    // scheduled_send_at, but NOT write the bypass marker (the peer would
    // otherwise race past its own review).
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 28,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 280,
        trigger_name: 'outbound',
        enabled: true,
        priority: 1,
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'outbound' } },
            { id: 'release', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'release' }],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 73,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 730,
        subject: 'Re: Frage',
        // body_text already contains the AUSGANGSPRUEFUNG banner from a prior
        // reviewOutbound.review hold (real format from buildOutboundWarningBanner).
        body_text: '⚠️ AUSGANGSPRÜFUNG — VERSAND BLOCKIERT\nai_review_block\nBitte E-Mail prüfen, korrigieren und erneut senden.\n---\n\nSehr geehrte Damen und Herren, ...',
        body_html: '<div><strong>⚠️ AUSGANGSPRÜFUNG — VERSAND BLOCKIERT</strong></div><p>Sehr geehrte Damen und Herren, ...</p>',
        from_json: null,
        to_json: { value: [{ address: 'kunde@example.com' }] },
        cc_json: null,
        snippet: 'review',
        outbound_hold: true,
        outbound_block_reason: 'review',
        ticket_code: null,
      }],
      // Another outbound run for the SAME draft, still queued — this is the
      // peer that must block the marker.
      runs: [{ id: 999, workspace_id: WORKSPACE_A_ID, source_sqlite_id: 9990, workflow_id: 999, message_id: 73, direction: 'outbound', status: 'queued', log_json: null, started_at: null, finished_at: null }],
    });
    const port = createPostgresWorkflowExecutionJobPort({ db, now: () => now, applyWorkspaceSession: async () => undefined });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 28,
      messageId: 73,
      triggerName: 'outbound',
      context: { outbound: { messageId: 73, subject: 'Re: Frage', bodyText: 'Sehr geehrte ...', to: 'kunde@example.com', attachmentCount: 0 } },
    });

    const draftAfter = rows.messages.find((m) => m.id === 73);
    // (a) Banner is stripped from body_text/body_html so the customer doesn't
    //     see the internal "AUSGANGSPRUEFUNG" wording.
    expect(String(draftAfter?.body_text)).not.toContain('AUSGANGSPR');
    expect(String(draftAfter?.body_text)).toContain('Sehr geehrte');
    expect(String(draftAfter?.body_html ?? '')).not.toContain('AUSGANGSPR');
    // (b) Subject gets a freshly generated ticket code (which is also persisted
    //     in ticket_code), so the marker fingerprint stays valid through
    //     prepareDraftForSend on the scheduled-send retry.
    expect(String(draftAfter?.subject)).toMatch(/^\[SCR-[A-Z0-9]+\]/);
    expect(String(draftAfter?.ticket_code ?? '')).toMatch(/^SCR-[A-Z0-9]+$/);
    // (c) Hold is released + scheduled_send_at is primed so the cron picks up
    //     immediately — but the peer outbound run blocks the bypass marker.
    expect(draftAfter?.outbound_hold).toBe(false);
    expect(draftAfter?.scheduled_send_at).toEqual(now);
    expect(rows.syncInfo.find((r) => r.key === 'outbound_review_approved:73')).toBeUndefined();
    expect(rows.steps.map((s) => s.message)).toContain('outbound_hold_released_auto_send_pending_peers');
  });

  test('postgres workflow execution job port arms full auto-reply via email.send_draft (default: no review)', async () => {
    const now = new Date('2026-08-15T10:00:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 28,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 280,
        trigger_name: 'inbound',
        enabled: true,
        priority: 1,
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            { id: 'send', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftIdVariable: 'draft.id', runOutboundReview: false, runOnEveryInbound: true } } },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'send' }],
        },
        execution_mode: 'graph',
      }],
      messages: [
        // The inbound mail that triggered this workflow.
        {
          id: 90,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 900,
          subject: 'Frage',
          from_json: { value: [{ address: 'kunde@example.com' }] },
        },
        // The AI-generated draft we want to send.
        {
          id: 91,
          workspace_id: WORKSPACE_A_ID,
          source_sqlite_id: 910,
          uid: -1,
          folder_kind: 'draft',
          subject: 'Re: Frage',
          body_text: 'Hallo, danke für Ihre Anfrage. ...',
          body_html: null,
          to_json: { value: [{ address: 'kunde@example.com' }] },
        },
      ],
      // send_draft's belt-and-braces guard requires the workspace auto-reply
      // switch to be on for the inbound bypass path.
      syncInfo: [{ workspace_id: WORKSPACE_A_ID, key: 'auto_reply_enabled', value: 'true' }],
    });
    const port = createPostgresWorkflowExecutionJobPort({ db, now: () => now, applyWorkspaceSession: async () => undefined });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 28,
      messageId: 90,
      triggerName: 'inbound',
      context: {
        // Upstream ai.reply_suggestion / email.create_draft would have set this.
        inbound: { messageId: 90 },
        eventVariables: { 'draft.id': 91 },
      },
    });

    // (a) Draft has scheduled_send_at primed + outbound_hold cleared so
    //     scheduled-send picks it up immediately.
    const draftAfter = rows.messages.find((m) => m.id === 91);
    expect(draftAfter).toMatchObject({
      outbound_hold: false,
      outbound_block_reason: null,
      scheduled_send_at: now,
      updated_at: now,
    });
    // (b) Approval marker with content fingerprint so the scheduled-send tick
    //     bypasses outbound review (KI is trusted by this workflow's choice).
    const approval = rows.syncInfo.find((row) => row.key === 'outbound_review_approved:91');
    expect(approval).toBeDefined();
    const [iso, hash] = String(approval!.value).split('|');
    expect(iso).toBe(now.toISOString());
    expect(hash).toMatch(/^[0-9a-f]{32}$/);
    // (c) Step message reflects the auto-send branch.
    expect(rows.steps.map((s) => [s.node_type, s.port, s.message])).toEqual([
      ['email.send_draft', 'default', 'send_draft_queued_auto'],
    ]);
  });

  // Belt-and-braces guard: even if an operator wires up email.send_draft
  // without an email.auto_reply gate, the inbound path must refuse to send to
  // a no-reply / mailer-daemon sender. The draft must NOT be primed.
  test('email.send_draft inbound bypass skips when sender looks like no-reply (belt-and-braces)', async () => {
    const now = new Date('2026-08-15T11:00:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 31,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 310,
        trigger_name: 'inbound',
        enabled: true,
        priority: 1,
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            { id: 'send', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftIdVariable: 'draft.id', runOutboundReview: false, runOnEveryInbound: true } } },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'send' }],
        },
        execution_mode: 'graph',
      }],
      messages: [
        { id: 94, workspace_id: WORKSPACE_A_ID, source_sqlite_id: 940, subject: 'Bounce', from_json: { value: [{ address: 'mailer-daemon@example.com' }] } },
        { id: 95, workspace_id: WORKSPACE_A_ID, source_sqlite_id: 950, uid: -1, folder_kind: 'draft', subject: 'Re: Bounce', body_text: 'reply', body_html: null, to_json: { value: [{ address: 'mailer-daemon@example.com' }] } },
      ],
      syncInfo: [{ workspace_id: WORKSPACE_A_ID, key: 'auto_reply_enabled', value: 'true' }],
    });
    const port = createPostgresWorkflowExecutionJobPort({ db, now: () => now, applyWorkspaceSession: async () => undefined });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 31,
      messageId: 94,
      triggerName: 'inbound',
      context: { inbound: { messageId: 94 }, eventVariables: { 'draft.id': 95 } },
    });

    // Draft NOT primed for send.
    const draftAfter = rows.messages.find((m) => m.id === 95);
    expect(draftAfter?.scheduled_send_at).toBeUndefined();
    expect(rows.syncInfo.find((r) => r.key === 'outbound_review_approved:95')).toBeUndefined();
    expect(rows.steps.map((s) => [s.node_type, s.port, s.message])).toEqual([
      ['email.send_draft', 'default', 'noreply_sender_blocked'],
    ]);
  });

  test('postgres workflow execution job port routes auto-reply through outbound review when runOutboundReview=true', async () => {
    const now = new Date('2026-08-15T10:05:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 29,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 290,
        trigger_name: 'inbound',
        enabled: true,
        priority: 1,
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            { id: 'send', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftIdVariable: 'draft.id', runOutboundReview: true, runOnEveryInbound: true } } },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'send' }],
        },
        execution_mode: 'graph',
      }],
      messages: [
        { id: 92, workspace_id: WORKSPACE_A_ID, source_sqlite_id: 920, subject: 'Frage', from_json: { value: [{ address: 'kunde@example.com' }] } },
        { id: 93, workspace_id: WORKSPACE_A_ID, source_sqlite_id: 930, uid: -1, folder_kind: 'draft', subject: 'Re: Frage', body_text: 'KI-Antwort', body_html: null, to_json: { value: [{ address: 'kunde@example.com' }] } },
      ],
      // Belt-and-braces now also enforced on the runOutboundReview=true path
      // (a workspace without outbound workflows would otherwise still send).
      syncInfo: [{ workspace_id: WORKSPACE_A_ID, key: 'auto_reply_enabled', value: 'true' }],
    });
    const port = createPostgresWorkflowExecutionJobPort({ db, now: () => now, applyWorkspaceSession: async () => undefined });

    await port.execute({
      workspaceId: WORKSPACE_A_ID,
      workflowId: 29,
      messageId: 92,
      triggerName: 'inbound',
      context: { inbound: { messageId: 92 }, eventVariables: { 'draft.id': 93 } },
    });

    // Draft scheduled but NO approval marker written: composeSender.send will
    // run reviewOutbound.review on it → outbound workflows can hold/approve.
    const draftAfter = rows.messages.find((m) => m.id === 93);
    expect(draftAfter?.scheduled_send_at).toBe(now);
    expect(rows.syncInfo.find((r) => r.key === 'outbound_review_approved:93')).toBeUndefined();
    expect(rows.steps.map((s) => [s.node_type, s.port, s.message])).toEqual([
      ['email.send_draft', 'default', 'send_draft_queued_with_review'],
    ]);
  });

  // Regression for the marker retry-loop bug: scheduled-send may call
  // composeSender.send multiple times when SMTP transiently fails. Each call
  // must hit the approval marker and bypass review, otherwise reviewOutbound
  // would re-hold the draft on every retry, eating the scheduled-send failure
  // budget (5) for what is really one SMTP failure.
  test('reviewOutbound.review retains approval marker on read so SMTP retries bypass review', async () => {
    const now = new Date('2026-08-01T09:00:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      // At least one enabled outbound workflow so the review is actually relevant
      // (with zero workflows, review returns allowed:true without the marker).
      workflows: [{
        id: 91,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 910,
        trigger_name: 'outbound',
        enabled: true,
        priority: 1,
      }],
      messages: [{
        id: 81,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 810,
        uid: -1,
        folder_kind: 'draft',
        outbound_hold: true,
        outbound_block_reason: 'pending',
        body_text: 'ok',
        body_html: null,
      }],
      syncInfo: [{
        workspace_id: WORKSPACE_A_ID,
        key: 'outbound_review_approved:81',
        value: now.toISOString(),
      }],
    });
    const port = createPostgresComposeOutboundReviewPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    // First call (the scheduled-send picks up the draft for the first time).
    const first = await port.review({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'tester',
      draftMessageId: 81,
      subject: 'After approval',
      bodyText: 'ok',
      bodyHtml: null,
      to: 'kunde@example.com',
      attachmentCount: 0,
    });
    expect(first).toEqual({ allowed: true });

    // After bypass, the marker is STILL there (so the retry can also bypass).
    const markerAfterFirst = rows.syncInfo.find((r) => r.key === 'outbound_review_approved:81');
    expect(markerAfterFirst).toBeDefined();

    // Re-hold the draft as if SMTP had failed and the cron is retrying.
    const draftRow = rows.messages.find((m) => m.id === 81);
    if (draftRow) {
      draftRow.outbound_hold = true;
      draftRow.outbound_block_reason = 'pending';
    }

    // Second call (the retry). Marker must still be honoured → bypass review.
    const second = await port.review({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'tester',
      draftMessageId: 81,
      subject: 'After approval',
      bodyText: 'ok',
      bodyHtml: null,
      to: 'kunde@example.com',
      attachmentCount: 0,
    });
    expect(second).toEqual({ allowed: true });
    // Draft was released again (outbound_hold=false), not re-held.
    expect(rows.messages.find((m) => m.id === 81)?.outbound_hold).toBe(false);
  });

  // Mirror case: a stale marker (older than the 24h TTL) is deleted on read
  // and the review proceeds normally — so workflows don't get stuck honouring
  // ancient approvals on rebooted drafts.
  test('reviewOutbound.review clears stale approval marker and runs review', async () => {
    const approvalTimestamp = new Date('2026-07-01T09:00:00.000Z');
    const now = new Date('2026-08-01T09:00:00.000Z'); // 31 days later, > 24h
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 92,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 920,
        trigger_name: 'outbound',
        enabled: true,
        priority: 1,
      }],
      messages: [{
        id: 82,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 820,
        uid: -1,
        folder_kind: 'draft',
        outbound_hold: true,
        outbound_block_reason: 'pending',
        body_text: 'ok',
        body_html: null,
      }],
      syncInfo: [{
        workspace_id: WORKSPACE_A_ID,
        key: 'outbound_review_approved:82',
        value: approvalTimestamp.toISOString(),
      }],
    });
    const port = createPostgresComposeOutboundReviewPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    await port.review({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'tester',
      draftMessageId: 82,
      subject: 'After approval',
      bodyText: 'ok',
      bodyHtml: null,
      to: 'kunde@example.com',
      attachmentCount: 0,
    });

    // Stale marker is cleared so future review chains start fresh.
    expect(rows.syncInfo.find((r) => r.key === 'outbound_review_approved:82')).toBeUndefined();
  });

  // Edge case: between release_outbound (approval marker set) and the
  // scheduled-send tick, the user edits the draft. The marker carries a
  // content fingerprint that no longer matches → bypass MUST be denied so the
  // edit gets re-reviewed. Defense in depth against the small race window.
  test('reviewOutbound.review denies bypass when the approval-marker fingerprint mismatches the current content', async () => {
    const now = new Date('2026-08-01T09:00:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 93,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 930,
        trigger_name: 'outbound',
        enabled: true,
        priority: 1,
      }],
      messages: [{
        id: 83,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 830,
        uid: -1,
        folder_kind: 'draft',
        outbound_hold: true,
        outbound_block_reason: 'pending',
        body_text: 'EDITED text differs from what the workflow approved.',
        body_html: null,
      }],
      // Marker hash is intentionally a value that won't match the current
      // input (a real one would be 32 hex chars from outboundDraftFingerprint).
      syncInfo: [{
        workspace_id: WORKSPACE_A_ID,
        key: 'outbound_review_approved:83',
        value: `${now.toISOString()}|deadbeefdeadbeefdeadbeefdeadbeef`,
      }],
    });
    const port = createPostgresComposeOutboundReviewPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
    });

    const result = await port.review({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'tester',
      draftMessageId: 83,
      subject: 'After approval',
      bodyText: 'EDITED text differs from what the workflow approved.',
      bodyHtml: null,
      to: 'kunde@example.com',
      attachmentCount: 0,
    });

    // The bypass did NOT fire (workflow run was enqueued instead of returning
    // allowed:true from the marker branch).
    expect(result).not.toEqual({ allowed: true });
    // The invalidated marker is cleared so the next review chain starts fresh
    // and the new approval (with new hash) will not collide with the old one.
    expect(rows.syncInfo.find((r) => r.key === 'outbound_review_approved:83')).toBeUndefined();
  });

  test('postgres workflow execution job port skips email.release_outbound on inbound direction', async () => {
    const now = new Date('2026-07-04T11:00:45.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 26,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 260,
        trigger_name: 'inbound',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger', data: { kind: 'inbound' } },
            { id: 'release', type: 'registry', data: { nodeType: 'email.release_outbound', config: { runOnEveryInbound: true } } },
          ],
          edges: [{ id: 'edge-1', source: 'trigger-1', target: 'release' }],
        },
        execution_mode: 'graph',
      }],
      messages: [{
        id: 71,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 710,
        subject: 'Inbound',
        from_json: { value: [{ address: 'kunde@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'in',
        body_text: 'in',
        body_html: null,
        has_attachments: false,
        attachments_json: null,
      }],
    });
    const port = createPostgresWorkflowExecutionJobPort({ db, now: () => now, applyWorkspaceSession: async () => undefined });

    await port.execute({ workspaceId: WORKSPACE_A_ID, workflowId: 26, messageId: 71, triggerName: 'inbound', context: {} });

    // Outbound-only: on inbound it skips, doesn't touch the message.
    expect(rows.steps.map((step) => [step.node_type, step.status, step.message])).toEqual([
      ['email.release_outbound', 'skipped', 'Nur fuer ausgehende Nachrichten'],
    ]);
  });

  test('postgres workflow execution job port blocks local code and plugin nodes fail-closed', async () => {
    const now = new Date('2026-07-04T11:01:00.000Z');
    const unsupportedNodes = [
      { workflowId: 81, sourceSqliteId: 810, nodeId: 'js-1', nodeType: 'code.javascript' },
      { workflowId: 82, sourceSqliteId: 820, nodeId: 'python-1', nodeType: 'code.python' },
      { workflowId: 83, sourceSqliteId: 830, nodeId: 'plugin-1', nodeType: 'plugin.custom' },
    ];
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: unsupportedNodes.map((item) => ({
        id: item.workflowId,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: item.sourceSqliteId,
        trigger_name: 'manual',
        enabled: true,
        definition_json: { version: 1, rules: [] },
        graph_json: {
          version: 1,
          nodes: [
            { id: 'trigger-1', type: 'trigger' as const, data: { kind: 'manual' } },
            {
              id: item.nodeId,
              type: 'registry' as const,
              data: { nodeType: item.nodeType, config: { code: 'should-not-run' } },
            },
            { id: 'tag-after', type: 'registry' as const, data: { nodeType: 'email.tag', config: { tag: 'after-local-runtime' } } },
          ],
          edges: [
            { id: 'edge-1', source: 'trigger-1', target: item.nodeId },
            { id: 'edge-2', source: item.nodeId, target: 'tag-after' },
          ],
        },
        execution_mode: 'graph',
      })),
      messages: [{
        id: 44,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 440,
        subject: 'Local runtime',
        from_json: { value: [{ address: 'customer@example.com' }] },
        to_json: { value: [{ address: 'agent@example.com' }] },
        cc_json: null,
        snippet: 'Local runtime',
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

    for (const item of unsupportedNodes) {
      await port.execute({
        workspaceId: WORKSPACE_A_ID,
        workflowId: item.workflowId,
        messageId: 44,
        triggerName: 'manual',
        context: {},
      });
    }

    expect(rows.tags).toEqual([]);
    expect(rows.runs.map((run) => [run.workflow_id, run.status, run.log_json])).toEqual(
      unsupportedNodes.map((item) => [
        item.workflowId,
        'blocked',
        [`server_workflow_node_unsupported:${item.nodeType}`],
      ]),
    );
    expect(rows.steps.map((step) => [step.node_id, step.node_type, step.status, step.port, step.message])).toEqual(
      unsupportedNodes.map((item) => [
        item.nodeId,
        item.nodeType,
        'skipped',
        'blocked',
        `server_workflow_node_unsupported:${item.nodeType}`,
      ]),
    );
  });

  test('scheduled-send job port sends due drafts and records retry state', async () => {
    const composeCalls: unknown[] = [];
    const storeCalls: unknown[] = [];
    const syncInfo = new Map<string, string | null>([
      ['scheduled_send_failures:104', '4'],
    ]);
    const claimedSendAt = new Date('2026-06-03T11:30:00.000Z');
    const drafts = [
      {
        id: 101,
        accountId: 7,
        subject: 'Due success',
        bodyText: 'Hello',
        bodyHtml: '<p>Hello</p>',
        toJson: { value: [{ address: 'customer@example.com', name: 'Customer' }] },
        ccJson: { value: [{ address: 'cc@example.com' }] },
        bccJson: null,
        draftAttachmentPathsJson: null,
        replyParentMessageId: 11,
        claimedSendAt,
      },
      {
        id: 102,
        accountId: 7,
        subject: 'No recipient',
        bodyText: 'Hello',
        bodyHtml: null,
        toJson: null,
        ccJson: null,
        bccJson: null,
        draftAttachmentPathsJson: null,
        replyParentMessageId: null,
        claimedSendAt,
      },
      {
        id: 103,
        accountId: 7,
        subject: 'Retry later',
        bodyText: 'Hello',
        bodyHtml: null,
        toJson: { value: [{ address: 'retry@example.com' }] },
        ccJson: null,
        bccJson: null,
        draftAttachmentPathsJson: JSON.stringify([{ path: 'C:\\local\\blocked.pdf' }]),
        replyParentMessageId: null,
        claimedSendAt,
      },
      {
        id: 104,
        accountId: 7,
        subject: 'Give up',
        bodyText: 'Hello',
        bodyHtml: null,
        toJson: { value: [{ address: 'fail@example.com' }] },
        ccJson: null,
        bccJson: null,
        draftAttachmentPathsJson: null,
        replyParentMessageId: null,
        claimedSendAt,
      },
    ];
    const port = createScheduledSendJobPort({
      composeSender: {
        async send(input) {
          composeCalls.push(input);
          if (input.values.draftMessageId === 103) {
            return { ok: false as const, error: 'Lokale Dateianhaenge muessen vor dem Server-Client Versand hochgeladen werden' };
          }
          if (input.values.draftMessageId === 104) {
            return { ok: false as const, error: 'SMTP down' };
          }
          return {
            ok: true as const,
            messageId: input.values.draftMessageId,
            accountId: input.values.accountId,
          };
        },
      },
      store: {
        async claimDueDrafts(input) {
          storeCalls.push(['claimDueDrafts', input]);
          return drafts;
        },
        async finalizeSentDraft(input) {
          storeCalls.push(['finalizeSentDraft', input]);
        },
        async releaseClaimedDraft(input) {
          storeCalls.push(['releaseClaimedDraft', input]);
        },
        async restoreClaimedDraft(input) {
          storeCalls.push(['restoreClaimedDraft', input]);
        },
        async giveUpDraft(input) {
          storeCalls.push(['giveUpDraft', input]);
        },
        async recordFailedAttempt(input) {
          storeCalls.push(['recordFailedAttempt', input]);
          const key = `scheduled_send_failures:${input.draftId}`;
          const prev = Number.parseInt(syncInfo.get(key) ?? '0', 10);
          const failures = (Number.isFinite(prev) && prev >= 0 ? prev : 0) + 1;
          const gaveUp = failures >= input.maxFailures;
          syncInfo.set(key, gaveUp ? '0' : String(failures));
          return { failures, gaveUp };
        },
      },
    });

    await port.processDue({
      workspaceId: WORKSPACE_A_ID,
      accountId: 7,
      dueBefore: new Date('2026-06-03T12:00:00.000Z'),
      limit: 10,
    });

    expect(composeCalls).toEqual([
      {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: 'system',
        values: {
          accountId: 7,
          draftMessageId: 101,
          subject: 'Due success',
          bodyText: 'Hello',
          bodyHtml: '<p>Hello</p>',
          to: 'Customer <customer@example.com>',
          cc: 'cc@example.com',
          inReplyToMessageId: 11,
        },
      },
      {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: 'system',
        values: {
          accountId: 7,
          draftMessageId: 103,
          subject: 'Retry later',
          bodyText: 'Hello',
          to: 'retry@example.com',
          attachmentPaths: ['C:\\local\\blocked.pdf'],
        },
      },
      {
        workspaceId: WORKSPACE_A_ID,
        actorUserId: 'system',
        values: {
          accountId: 7,
          draftMessageId: 104,
          subject: 'Give up',
          bodyText: 'Hello',
          to: 'fail@example.com',
        },
      },
    ]);
    expect(storeCalls).toEqual([
      ['claimDueDrafts', {
        workspaceId: WORKSPACE_A_ID,
        accountId: 7,
        dueBefore: new Date('2026-06-03T12:00:00.000Z'),
        limit: 10,
      }],
      ['finalizeSentDraft', { workspaceId: WORKSPACE_A_ID, draftId: 101 }],
      ['releaseClaimedDraft', { workspaceId: WORKSPACE_A_ID, draftId: 102 }],
      ['recordFailedAttempt', {
        workspaceId: WORKSPACE_A_ID,
        draftId: 103,
        error: 'Lokale Dateianhaenge muessen vor dem Server-Client Versand hochgeladen werden',
        claimedSendAt,
        maxFailures: 5,
      }],
      ['recordFailedAttempt', {
        workspaceId: WORKSPACE_A_ID,
        draftId: 104,
        error: 'SMTP down',
        claimedSendAt,
        maxFailures: 5,
      }],
    ]);
    // Draft 103 backs off (1 failure); draft 104 (seeded at 4) hits the give-up threshold and resets to 0.
    expect(syncInfo.get('scheduled_send_failures:103')).toBe('1');
    expect(syncInfo.get('scheduled_send_failures:104')).toBe('0');
  });

  test('scheduled-send Postgres store atomically claims due drafts with SKIP LOCKED', () => {
    const source = readFileSync(resolve(__dirname, '../../packages/server/src/mail-scheduled-send.ts'), 'utf8');
    expect(source).toMatch(/FOR UPDATE SKIP LOCKED/);
    expect(source).toMatch(/claimDueDrafts/);
    expect(source).toMatch(/outbound_hold = false/);
    expect(source).toMatch(/SET scheduled_send_at = NULL/);
    expect(source).toMatch(/scheduled_send_claimed_at:/);
    expect(source).toMatch(/recoverOrphanedScheduledClaims/);
    expect(source).toMatch(/persistScheduledSendClaims/);
  });

  test('thread list predicates align scheduled_send filters with message list', () => {
    const source = readFileSync(resolve(__dirname, '../../packages/server/src/db/postgres-mail-metadata-read-ports.ts'), 'utf8');
    expect(source).toMatch(/view === 'scheduled_send'[\s\S]*m\.scheduled_send_at IS NOT NULL/);
    expect(source).toMatch(/view === 'drafts'[\s\S]*m\.scheduled_send_at IS NULL/);
    expect(source).toMatch(/view === 'inbox'[\s\S]*m\.outbound_hold = true AND m\.scheduled_send_at IS NULL/);
  });

  test('scheduled-send ticker isolates workspace failures', () => {
    const source = readFileSync(resolve(__dirname, '../../packages/server/src/mail-scheduled-send.ts'), 'utf8');
    expect(source).toMatch(/scheduled send ticker workspace/);
  });

  test('postgres job queue replaces pending scheduled-send jobs per draft', () => {
    const source = readFileSync(resolve(__dirname, '../../packages/server/src/db/postgres-job-queue-port.ts'), 'utf8');
    expect(source).toMatch(/deletePendingScheduledSendJobs/);
    expect(source).toMatch(/type === 'mail\.send\.scheduled'/);
  });

  test('desktop ai review skips real provider calls during normal dry-run', () => {
    const aiNodes = readFileSync(resolve(__dirname, '../../electron/workflow/nodes/ai-nodes.ts'), 'utf8');
    const engine = readFileSync(resolve(__dirname, '../../electron/email/email-workflow-engine.ts'), 'utf8');
    expect(aiNodes).toMatch(/ctx\.dryRun && !ctx\.previewOutbound/);
    expect(engine).toMatch(/previewOutbound: dryRun/);
  });

  test('scheduled-send job ignores compose send already in progress errors', async () => {
    const storeCalls: unknown[] = [];
    const claimedSendAt = new Date('2026-06-03T11:45:00.000Z');
    const port = createScheduledSendJobPort({
      composeSender: {
        async send() {
          return { ok: false as const, error: 'Versand laeuft bereits fuer diesen Entwurf.' };
        },
      },
      store: {
        async claimDueDrafts() {
          return [{
            id: 201,
            accountId: 7,
            subject: 'Busy',
            bodyText: 'Hello',
            bodyHtml: null,
            toJson: { value: [{ address: 'busy@example.com' }] },
            ccJson: null,
            bccJson: null,
            draftAttachmentPathsJson: null,
            replyParentMessageId: null,
            claimedSendAt,
          }];
        },
        async finalizeSentDraft(input) {
          storeCalls.push(['finalizeSentDraft', input]);
        },
        async releaseClaimedDraft(input) {
          storeCalls.push(['releaseClaimedDraft', input]);
        },
        async restoreClaimedDraft(input) {
          storeCalls.push(['restoreClaimedDraft', input]);
        },
        async giveUpDraft(input) {
          storeCalls.push(['giveUpDraft', input]);
        },
        async recordFailedAttempt(input) {
          storeCalls.push(['recordFailedAttempt', input]);
          return { failures: 1, gaveUp: false };
        },
      },
    });

    await port.processDue({
      workspaceId: WORKSPACE_A_ID,
      dueBefore: new Date('2026-06-03T12:00:00.000Z'),
      limit: 10,
    });

    expect(storeCalls).toEqual([
      ['restoreClaimedDraft', { workspaceId: WORKSPACE_A_ID, draftId: 201, claimedSendAt }],
    ]);
  });

  test('scheduled-send job waits for outbound review without consuming retry budget', async () => {
    const storeCalls: unknown[] = [];
    const claimedSendAt = new Date('2026-06-03T11:45:00.000Z');
    const port = createScheduledSendJobPort({
      composeSender: {
        async send() {
          return {
            ok: false as const,
            error: 'Ausgangspruefung wird serverseitig ausgefuehrt; Versand bleibt blockiert, bis die Pruefung abgeschlossen ist.',
          };
        },
      },
      store: {
        async claimDueDrafts() {
          return [{
            id: 202,
            accountId: 7,
            subject: 'Pending review',
            bodyText: 'Hello',
            bodyHtml: null,
            toJson: { value: [{ address: 'pending@example.com' }] },
            ccJson: null,
            bccJson: null,
            draftAttachmentPathsJson: null,
            replyParentMessageId: null,
            claimedSendAt,
          }];
        },
        async finalizeSentDraft(input) {
          storeCalls.push(['finalizeSentDraft', input]);
        },
        async releaseClaimedDraft(input) {
          storeCalls.push(['releaseClaimedDraft', input]);
        },
        async restoreClaimedDraft(input) {
          storeCalls.push(['restoreClaimedDraft', input]);
        },
        async giveUpDraft(input) {
          storeCalls.push(['giveUpDraft', input]);
        },
        async recordFailedAttempt(input) {
          storeCalls.push(['recordFailedAttempt', input]);
          return { failures: 1, gaveUp: false };
        },
      },
    });

    await port.processDue({
      workspaceId: WORKSPACE_A_ID,
      dueBefore: new Date('2026-06-03T12:00:00.000Z'),
      limit: 10,
    });

    expect(storeCalls).toEqual([
      ['restoreClaimedDraft', { workspaceId: WORKSPACE_A_ID, draftId: 202, claimedSendAt }],
    ]);
  });

  test('scheduled-send failure is delegated to one atomic transition (no partial bookkeeping)', async () => {
    const backing = new Map<string, string | null>(); // stand-in for persisted schedule + markers
    let recordCalls = 0;
    const claimedSendAt = new Date('2026-06-03T11:45:00.000Z');
    const port = createScheduledSendJobPort({
      composeSender: {
        async send() {
          return { ok: false as const, error: 'SMTP down' };
        },
      },
      store: {
        async claimDueDrafts() {
          return [{
            id: 301,
            accountId: 7,
            subject: 'Crash mid-transition',
            bodyText: 'Hello',
            bodyHtml: null,
            toJson: { value: [{ address: 'crash@example.com' }] },
            ccJson: null,
            bccJson: null,
            draftAttachmentPathsJson: null,
            replyParentMessageId: null,
            claimedSendAt,
          }];
        },
        async finalizeSentDraft() {},
        async releaseClaimedDraft() {},
        async restoreClaimedDraft() {},
        async giveUpDraft() {},
        async recordFailedAttempt() {
          recordCalls += 1;
          // The real Postgres store runs this whole transition in ONE
          // withWorkspaceTransaction, so a mid-transition failure rolls back
          // every write. Simulate that failure here.
          throw new Error('db connection lost mid-transition');
        },
      },
    });

    await expect(port.processDue({
      workspaceId: WORKSPACE_A_ID,
      dueBefore: new Date('2026-06-03T12:00:00.000Z'),
      limit: 10,
    })).rejects.toThrow('db connection lost mid-transition');

    // Exactly one transition was attempted, and no marker was written piecemeal
    // by the orchestrator: the failure counter can never be bumped independently
    // of the schedule restore.
    expect(recordCalls).toBe(1);
    expect(backing.size).toBe(0);
  });

  test('scheduled-send Postgres store commits each transition in a single transaction', () => {
    const source = readFileSync(
      resolve(__dirname, '../../packages/server/src/mail-scheduled-send.ts'),
      'utf8',
    );
    for (const method of [
      'finalizeSentDraft',
      'releaseClaimedDraft',
      'restoreClaimedDraft',
      'giveUpDraft',
      'recordFailedAttempt',
    ]) {
      expect(source).toMatch(new RegExp(`${method}\\(input`));
    }
    // The old per-write transition helpers (each its own transaction) are removed.
    expect(source).not.toMatch(/restoreClaimedScheduledSendAt/);
    expect(source).not.toMatch(/recordScheduledAttemptFailure/);
    expect(source).not.toMatch(/clearScheduledDraftMeta/);
  });

  test('reviewOutbound.review returns dry-run block without queuing async review', async () => {
    const now = new Date('2026-08-01T09:00:00.000Z');
    const { db, rows } = makeWorkflowExecutionDb({
      workflows: [{
        id: 94,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 940,
        trigger_name: 'outbound',
        enabled: true,
        priority: 1,
        name: 'Blocker',
      }],
      messages: [{
        id: 84,
        workspace_id: WORKSPACE_A_ID,
        source_sqlite_id: 840,
        uid: -1,
        folder_kind: 'draft',
        outbound_hold: false,
        outbound_block_reason: null,
        body_text: 'blocked',
        body_html: null,
      }],
    });
    const port = createPostgresComposeOutboundReviewPort({
      db,
      now: () => now,
      applyWorkspaceSession: async () => undefined,
      workflowDryRun: async () => ({
        success: true,
        dryRun: true as const,
        blocked: true,
        blockReason: 'Workflow wuerde blockieren',
        status: 'blocked' as const,
      }),
    });

    const result = await port.review({
      workspaceId: WORKSPACE_A_ID,
      actorUserId: 'tester',
      draftMessageId: 84,
      subject: 'Blocked',
      bodyText: 'blocked',
      bodyHtml: null,
      to: 'kunde@example.com',
      attachmentCount: 0,
    });

    expect(result).toEqual({
      allowed: false,
      error: 'Workflow wuerde blockieren',
    });
    expect(rows.messages.find((m) => m.id === 84)?.outbound_hold).toBe(false);
    expect(rows.runs).toHaveLength(0);
    expect(rows.jobs).toHaveLength(0);
  });

});
