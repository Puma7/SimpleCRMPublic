import { readFileSync } from 'node:fs';

import type { FastifyInstance } from 'fastify';
import { sql } from 'kysely';
import type { Kysely } from 'kysely';

import {
  createFastifyServer,
  type ServerApiPorts,
} from './api';
import {
  assertNoKnownWeakProductionSecrets,
  MASTER_KEY_LOOKS_GUESSABLE_MESSAGE,
  parseCorsAllowedOrigins,
  parseAuthInvitationMailConfig,
  parseEmailTrackingIpIntelligenceConfig,
  parsePort,
  parseServerJobWorkerConfig,
  parseSmtpRelayServerConfig,
  type AuthInvitationMailConfig,
  type ServerEditionEnv,
  type ServerJobWorkerConfig,
} from './config';
import {
  createPostgresApiRateLimitPort,
} from './security/postgres-api-rate-limit';
import {
  createPostgresAuditPort,
  createPostgresAiProfileReadPort,
  createPostgresAiPromptReadPort,
  createPostgresActivityLogReadPort,
  createPostgresAutomationApiKeyReadPort,
  createPostgresCalendarEventReadPort,
  createPostgresAuthPort,
  createPostgresConversationLockPort,
  createPostgresCustomerCustomFieldReadPort,
  createPostgresCustomerCustomFieldValueReadPort,
  createPostgresCustomerReadPort,
  createPostgresUserGroupPort,
  createPostgresUserSignaturePort,
  createPostgresDashboardPort,
  createPostgresDealProductPort,
  createPostgresDealReadPort,
  createPostgresDatabase,
  createPostgresJobQueuePort,
  createPostgresEmailAccountReadPort,
  createPostgresEmailAccountMailSettingsPort,
  createPostgresEmailAccountSignatureReadPort,
  createPostgresEmailAttachmentContentPort,
  createPostgresEmailAttachmentReadPort,
  createPostgresEmailCannedResponseReadPort,
  createPostgresEmailCategoryReadPort,
  createPostgresEmailReportingPort,
  createPostgresDmarcReportingPort,
  createPostgresMailDiagnosticsPort,
  createPostgresEmailFolderReadPort,
  createPostgresEmailInternalNoteReadPort,
  createPostgresEmailMessageCategoryReadPort,
  createPostgresEmailMessageReadPort,
  createPostgresEmailMessageTagReadPort,
  createPostgresEmailReadReceiptReadPort,
  createPostgresEmailRemoteContentAllowlistReadPort,
  createPostgresEmailTeamMemberReadPort,
  createPostgresEmailThreadAliasReadPort,
  createPostgresEmailThreadEdgeReadPort,
  createPostgresEmailThreadReadPort,
  createPostgresFollowUpPort,
  createPostgresJtlReferenceReadPort,
  createPostgresPgpIdentityReadPort,
  createPostgresPgpPeerKeyReadPort,
  createPostgresProductReadPort,
  createPostgresServerEventPort,
  createPostgresServerEventNotificationChannel,
  createPostgresSpamDecisionReadPort,
  createPostgresSpamFeatureStatReadPort,
  createPostgresSpamLearningEventReadPort,
  createPostgresSpamListEntryReadPort,
  createPostgresSavedViewReadPort,
  createPostgresSecretPort,
  createPostgresSmtpRelayAdminPort,
  createPostgresSmtpRelayPort,
  createPostgresSyncInfoPort,
  createPostgresPublicAuthSecuritySettingsReader,
  createPostgresWorkflowDelayedJobReadPort,
  createPostgresWorkflowForwardDedupReadPort,
  createPostgresWorkflowKnowledgeBaseReadPort,
  createPostgresWorkflowKnowledgeChunkReadPort,
  createPostgresWorkflowMessageAppliedReadPort,
  createPostgresWorkflowReadPort,
  createPostgresWorkflowRunReadPort,
  createPostgresWorkflowRunStepReadPort,
  createPostgresWorkflowVersionReadPort,
  createPostgresCalendarEntryPort,
  createPostgresTaskReadPort,
  type PostgresServerEventNotificationChannel,
  type PostgresSecretPort,
  type ServerDatabase,
} from './db';
import {
  createGraphileQueuePort,
  createJobWorkerLogger,
  createJsonlAuditRetentionArchivePort,
  createFetchWebhookDispatchPort,
  createMaintenanceJobHandlers,
  createProductionJobHandlers,
  createSpamScoringJobHandlers,
  createWebhookJobHandlers,
  mergeJobHandlerRegistries,
  startGraphileWorkerRuntime,
  startMaintenanceJobTicker,
  startPostgresJobQueueWorker,
  type GraphileQueuePort,
  type GraphileWorkerRuntime,
  type JobHandlerRegistry,
  type PostgresJobQueueWorkerRuntime,
  type ProductionJobHandlersOptions,
  type WorkflowExecutionDryRunResult,
  type WorkflowExecutionJobPort,
} from './jobs';
import {
  createServerLogStore,
  type ServerLogStore,
} from './diagnostics/server-log-store';
import {
  createPinoLogCaptureStream,
  installConsoleLogCapture,
} from './diagnostics/server-log-capture';
import {
  accessTokenSignerFromBase64,
  decryptSecretValue,
  masterKeyFingerprint,
  masterKeyFingerprintMatches,
  masterKeyLooksGuessable,
  newMasterKeyFingerprintSalt,
  parseBase64MasterKey,
  SECRET_ENVELOPE_ALGORITHM,
  type MasterKeyMaterial,
  type AccessTokenSigner,
} from './security';
import { createAuthInvitationMailerPort } from './auth-invitation-mailer';
import { ACCOUNT_WIDE_FAILURE_WINDOW_SECONDS } from './auth';
import { createLoginSecurityService } from './auth/login-security-service';
import { createPostgresAiReplySuggestionPort } from './ai-reply-suggestion';
import {
  createPostgresAiAgentPort,
  createPostgresAiPickCannedPort,
  createPostgresAiClassificationPort,
  createPostgresAiReviewPort,
  createPostgresAiTextTransformApiPort,
  createPostgresAiTransformTextPort,
} from './ai-classification';
import {
  createPostgresAiDraftReplyPort,
  createPostgresAiReviewDraftPort,
} from './workflow-ai-draft-nodes';
import { createServerEmailOAuthPort } from './email-oauth';
import { createPostgresJtlOrderPort } from './jtl-order';
import { createPostgresJtlSyncPort } from './jtl-sync';
import { createPostgresEmailComposeAttachmentUploadPort } from './mail-compose-attachments';
import {
  createPostgresEmailComposeSenderPort,
  createPostgresEmailOutboundValidationPort,
} from './mail-compose-send';
import { createServerMailConnectionTestPort } from './mail-connection-test';
import { createPostgresEmailGdprExportPort } from './mail-gdpr-export';
import { createPostgresMailAccessPort } from './mail-access/postgres-mail-access-port';
import {
  createPostgresMailAclRolloutLegacyPort,
  createPostgresMailAclRolloutStatePort,
} from './mail-access/postgres-mail-acl-rollout-state-port';
import { createPostgresMailDelegationPort } from './mail-access/postgres-mail-delegation-port';
import { createPostgresMailResourceLookupPort } from './mail-access/postgres-mail-resource-lookup';
import {
  MailAccessRolloutService,
  type MailAclRolloutDiagnosticReporter,
} from './mail-access/rollout-service';
import {
  createEmailTrackingCrypto,
  createPostgresEmailTrackingService,
  emailTrackingEventAssociatedData,
  emailTrackingLinkAssociatedData,
  startEmailTrackingRetentionTicker,
  type EmailTrackingService,
} from './email-tracking';
import {
  createEmailTrackingIpIntelligence,
  type EmailTrackingIpIntelligencePort,
} from './email-tracking-ip-intelligence';
import {
  startInboundSmtpService,
  type InboundSmtpService,
} from './inbound-smtp-service';
import { createRelaySubmissionPipeline } from './relay-submission';
import { createPostgresServerImapSentCopyAppenderPort } from './mail-imap-append';
import { createPostgresEmailReadReceiptResponderPort } from './mail-read-receipt-responder';
import { createPostgresScheduledSendJobPort, startScheduledSendTicker } from './mail-scheduled-send';
import { startAttachmentTextBackfillTicker } from './mail-attachment-text';
import { startBodyTextBackfillRun } from './mail-body-text-backfill';
import { createPostgresMailSyncJobPort } from './mail-sync';
import { createPostgresMailSyncPostProcessor } from './mail-sync-post-process';
import {
  createPostgresEmailVacationAutoReplyPort,
  createPostgresEmailVacationTestPort,
} from './mail-vacation-test';
import { createPostgresMssqlSettingsPort } from './mssql-settings';
import {
  createOpenPgpKeyMaterialPort,
  createPostgresPgpMessageCryptoPort,
} from './pgp';
import { createSmokePorts } from './server-smoke';
import { createPostgresWorkflowExecutionJobPort } from './workflow-execution';
import { createPostgresWorkflowInboundBackfillPort } from './workflow-backfill';
import { createPostgresMailThreadBackfillPort } from './mail-thread-backfill';
import { createPostgresWorkflowForwardCopyPort } from './workflow-forward-copy';
import { createPostgresWorkflowDmarcIngestPort } from './dmarc-ingest';
import { createPostgresWorkflowHttpRequestPort } from './workflow-http-request';
import { createPostgresWorkflowImapActionPort } from './workflow-imap-actions';
import { createStaticWorkflowNodeCatalogPort } from './workflow-node-catalog';
import { createStaticWorkflowTemplatePort } from './workflow-templates';
import { createServerMaintenancePort } from './maintenance/service';

export type PostgresServerApiPortsOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  accessTokenSigner: AccessTokenSigner;
  attachmentsRoot?: string;
  auditArchiveRoot?: string;
  databaseUrl?: string;
  backupDir?: string;
  appVersion?: string;
  events?: ServerApiPorts['events'];
  jobQueue?: ServerApiPorts['jobQueue'];
  secrets?: PostgresSecretPort;
  authInvitationMail?: AuthInvitationMailConfig;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
  rspamdFetch?: typeof fetch;
  publicBaseUrl?: string;
  masterKey?: Buffer;
  emailTrackingIpIntelligence?: EmailTrackingIpIntelligencePort;
  mailAclRolloutDiagnostic?: MailAclRolloutDiagnosticReporter;
}>;

export type ServerListenOptions = Readonly<{
  host?: string;
  port?: number;
  ports?: ServerApiPorts;
  env?: ServerEditionEnv;
  databaseUrl?: string;
  createDatabase?: (options: { databaseUrl: string }) => Promise<Kysely<ServerDatabase>>;
  logger?: boolean;
  serverLogStore?: ServerLogStore;
  accessTokenSigner?: AccessTokenSigner;
  jobWorker?: Partial<ServerJobWorkerConfig>;
  jobHandlers?: JobHandlerRegistry;
  jobServices?: ProductionJobHandlersOptions;
  createGraphileQueue?: (options: { connectionString: string; migrateOnStart?: boolean }) => Promise<GraphileQueuePort>;
  createJobWorker?: typeof startGraphileWorkerRuntime;
  createEventNotifications?: (options: { databaseUrl: string }) => Promise<PostgresServerEventNotificationChannel>;
  emailTrackingIpIntelligence?: EmailTrackingIpIntelligencePort;
}>;

/**
 * Parse TRUST_PROXY into a Fastify `trustProxy` value. Unset → undefined (the
 * adapter default = trust nobody). `true`/`false` → boolean; a bare integer → a
 * hop count (e.g. `1` trusts only the Caddy hop); anything else → a proxy-addr
 * subnet/preset string passed through verbatim.
 */
function parseTrustProxyEnv(raw: string | undefined): boolean | number | string | undefined {
  const value = raw?.trim();
  if (!value) return undefined;
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^\d+$/.test(value)) return Number(value);
  return value;
}

export function createAppServer(
  ports: ServerApiPorts = createSmokePorts(),
  accessTokenSigner?: AccessTokenSigner,
): FastifyInstance {
  return createFastifyServer({
    ports,
    accessTokenSigner,
    logger: false,
  });
}

export async function startServer(options: ServerListenOptions = {}): Promise<FastifyInstance> {
  const env = options.env ?? process.env;
  const port = options.port ?? parsePort(env.PORT ?? '3000');
  const host = options.host ?? env.HOST ?? '0.0.0.0';
  const accessTokenSigner = options.accessTokenSigner ?? accessTokenSignerFromEnv(env);
  const databaseUrl = options.databaseUrl ?? env.DATABASE_URL;
  const corsAllowedOrigins = parseCorsAllowedOrigins(env);
  const attachmentsRoot = env.ATTACHMENTS_DIR?.trim() || '/app/data/attachments';
  const auditArchiveRoot = env.AUDIT_ARCHIVE_DIR?.trim();
  const authInvitationMail = parseAuthInvitationMailConfig(env);
  const initialSetupToken = env.INITIAL_SETUP_TOKEN?.trim();
  const webhookAllowlist = env.JOB_WEBHOOK_ALLOWLIST?.trim();
  // Central server log: capture every warning/error (pino + console) into a
  // bounded, file-persisted store exposed via the diagnostics API.
  const serverLogStore = options.serverLogStore ?? createServerLogStore({
    filePath: env.SERVER_LOG_FILE?.trim() || undefined,
  });
  const captureLogs = options.logger !== false;
  if (captureLogs) installConsoleLogCapture(serverLogStore);

  // ERST JETZT die Startwarnungen. Vorher standen sie weiter oben und liefen
  // ins Leere: die Erfassung war noch nicht installiert, also landeten sie auf
  // dem momentanen stderr und weder im SERVER_LOG_FILE noch in der
  // Diagnose-API. Bei einer bestehenden Installation mit textartigem
  // Master-Key ist diese Warnung das EINZIGE Signal — die Datenbankpruefung
  // darf den weiterhin benoetigten alten Schluessel ja nicht ablehnen. Ein
  // Signal, das nirgends nachlesbar ist, ist keines.
  assertNoKnownWeakProductionSecrets(env, env.SIMPLECRM_MASTER_KEY, env.ACCESS_TOKEN_SECRET);
  warnAboutNullCorsOrigin(corsAllowedOrigins);

  let db: Kysely<ServerDatabase> | undefined;
  let secrets: PostgresSecretPort | undefined;
  let apiJobQueue: GraphileQueuePort | undefined;
  let jobWorker: GraphileWorkerRuntime | undefined;
  let postgresJobQueueWorker: PostgresJobQueueWorkerRuntime | undefined;
  let eventNotifications: PostgresServerEventNotificationChannel | undefined;
  let scheduledSendTicker: ReturnType<typeof startScheduledSendTicker> | undefined;
  let attachmentTextTicker: ReturnType<typeof startAttachmentTextBackfillTicker> | undefined;
  let bodyTextBackfillRun: ReturnType<typeof startBodyTextBackfillRun> | undefined;
  let emailTrackingRetentionTicker: ReturnType<typeof startEmailTrackingRetentionTicker> | undefined;
  const maintenanceTickers: Array<{ stop(): void }> = [];
  let inboundSmtpService: InboundSmtpService | undefined;
  const ports = options.ports ?? await createDefaultServerPorts({
    databaseUrl,
    accessTokenSigner,
    attachmentsRoot,
    auditArchiveRoot: auditArchiveRoot,
    backupDir: env.BACKUP_DIR?.trim(),
    appVersion: env.VERSION?.trim() || '0.0.0',
    createDatabase: options.createDatabase,
    createEventNotifications: options.createEventNotifications,
    masterKey: env.SIMPLECRM_MASTER_KEY,
    publicBaseUrl: env.PUBLIC_BASE_URL?.trim(),
    authInvitationMail,
    turnstileSiteKey: env.TURNSTILE_SITE_KEY?.trim(),
    turnstileSecretKey: env.TURNSTILE_SECRET_KEY?.trim(),
    emailTrackingIpIntelligence: options.emailTrackingIpIntelligence
      ?? createEmailTrackingIpIntelligence(parseEmailTrackingIpIntelligenceConfig(env)),
    onDatabaseCreated(database) {
      db = database;
    },
    onSecretsCreated(createdSecrets) {
      secrets = createdSecrets;
    },
    onEventNotificationsCreated(notifications) {
      eventNotifications = notifications;
    },
  });

  if (!options.ports && databaseUrl?.trim()) {
    try {
      apiJobQueue = await (options.createGraphileQueue ?? createGraphileQueuePort)({
        connectionString: databaseUrl,
        migrateOnStart: true,
      });
      ports.jobQueue = apiJobQueue;
      if (db) {
        ports.workflowInboundBackfill = createPostgresWorkflowInboundBackfillPort({
          db,
          jobQueue: apiJobQueue,
        });
        ports.mailThreadBackfill = createPostgresMailThreadBackfillPort({ db });
      }
    } catch (error) {
      await closeServerResources(jobWorker, postgresJobQueueWorker, db, eventNotifications, apiJobQueue);
      throw error;
    }
  }

  ports.serverLogs = serverLogStore;
  if (initialSetupToken) {
    ports.initialSetupToken = initialSetupToken;
  }

  const app = createFastifyServer({
    ports,
    accessTokenSigner,
    ...(db ? { apiRateLimit: createPostgresApiRateLimitPort(db) } : {}),
    logger: captureLogs
      ? { level: env.LOG_LEVEL?.trim() || 'info', stream: createPinoLogCaptureStream(serverLogStore) }
      : (options.logger ?? false),
    corsAllowedOrigins,
    // Unset → the adapter's safe default (trust nobody). TRUST_PROXY accepts
    // true/false, a hop count (e.g. 1 = trust only the Caddy hop), or a
    // proxy-addr subnet/preset string.
    ...(() => {
      const trustProxy = parseTrustProxyEnv(env.TRUST_PROXY);
      return trustProxy === undefined ? {} : { trustProxy };
    })(),
  });

  app.addHook('onClose', async () => {
    scheduledSendTicker?.stop();
    attachmentTextTicker?.stop();
    bodyTextBackfillRun?.stop();
    emailTrackingRetentionTicker?.stop();
    for (const ticker of maintenanceTickers) ticker.stop();
    await inboundSmtpService?.stop().catch(() => undefined);
    await closeServerResources(jobWorker, postgresJobQueueWorker, db, eventNotifications, apiJobQueue);
  });

  const jobHandlers = buildServerJobHandlers({
    db,
    secrets,
    ports,
    attachmentsRoot,
    auditArchiveRoot,
    webhookAllowlist,
    jobServices: options.jobServices,
    extraHandlers: options.jobHandlers,
  });

  try {
    const jobWorkerConfig = parseServerJobWorkerConfig(env);
    const workerEnabled = options.jobWorker?.enabled ?? jobWorkerConfig.enabled;
    if (workerEnabled && db) {
      postgresJobQueueWorker = startPostgresJobQueueWorker({
        queue: createPostgresJobQueuePort({ db }),
        handlers: jobHandlers,
        log: createJobWorkerLogger(serverLogStore),
        mailAccess: ports.mailAccess,
        mailResourceLookup: ports.mailResourceLookup,
        auth: ports.auth,
      });
    }

    jobWorker = await startConfiguredJobWorker({
      env,
      databaseUrl,
      options: options.jobWorker,
      handlers: jobHandlers,
      mailAccess: ports.mailAccess,
      mailResourceLookup: ports.mailResourceLookup,
      auth: ports.auth,
      createGraphileQueue: options.createGraphileQueue,
      createJobWorker: options.createJobWorker,
    });
    if (db && ports.emailComposeSender) {
      scheduledSendTicker = startScheduledSendTicker({
        db,
        composeSender: ports.emailComposeSender,
        mailAccess: ports.mailAccess,
        mailResourceLookup: ports.mailResourceLookup,
        auth: ports.auth,
      });
    }
    if (db) {
      attachmentTextTicker = startAttachmentTextBackfillTicker({
        db,
        attachmentsRoot,
      });
      bodyTextBackfillRun = startBodyTextBackfillRun({ db });
      if (ports.emailTracking?.pruneWorkspace) {
        emailTrackingRetentionTicker = startEmailTrackingRetentionTicker({
          db,
          service: { pruneWorkspace: ports.emailTracking.pruneWorkspace },
        });
      }
      maintenanceTickers.push(startProvisionalLoginAttemptCleanup(ports));
      // Wartungsjobs takten. Ohne diese Ticker wurden lock.cleanup und
      // audit.retention nie eingereiht — Handler und Policy gab es, nur keinen
      // Ausloeser. Begruendung der Bauform in jobs/maintenance-ticker.
      if (apiJobQueue) {
        const maintenanceQueue = apiJobQueue;
        const maintenanceLog = createJobWorkerLogger(serverLogStore);
        for (const jobType of ['lock.cleanup', 'audit.retention'] as const) {
          maintenanceTickers.push(startMaintenanceJobTicker({
            db,
            queue: maintenanceQueue,
            jobType,
            log: (message) => maintenanceLog({ level: 'warn', message }),
          }));
        }
      }
      // After the email-tracking construction so the relay reuses its instance;
      // tracking stays optional — without PUBLIC_BASE_URL + master key the
      // relay still runs, it just sends untracked.
      inboundSmtpService = await startConfiguredInboundSmtpService({
        env,
        db,
        secrets,
        emailTracking: ports.emailTracking,
      });
    }
    await app.listen({ host, port });
  } catch (error) {
    scheduledSendTicker?.stop();
    attachmentTextTicker?.stop();
    bodyTextBackfillRun?.stop();
    emailTrackingRetentionTicker?.stop();
    for (const ticker of maintenanceTickers) ticker.stop();
    await inboundSmtpService?.stop().catch(() => undefined);
    await closeServerResources(jobWorker, postgresJobQueueWorker, db, eventNotifications, apiJobQueue);
    throw error;
  }

  return app;
}

function resolveWorkflowDryRun(
  workflowExecution: WorkflowExecutionJobPort,
): (input: Parameters<NonNullable<WorkflowExecutionJobPort['dryRun']>>[0]) => Promise<WorkflowExecutionDryRunResult> {
  return (input) => {
    if (!workflowExecution.dryRun) {
      return Promise.resolve({
        success: false,
        dryRun: true,
        status: 'error',
        blocked: false,
        blockReason: null,
        log: ['error:dry_run_unavailable'],
        error: 'Dry-run nicht verfuegbar',
      });
    }
    return workflowExecution.dryRun(input);
  };
}

export function createPostgresServerApiPorts(options: PostgresServerApiPortsOptions): ServerApiPorts {
  const attachmentsRoot = options.attachmentsRoot ?? '/app/data/attachments';
  const sentCopyAppender = createPostgresServerImapSentCopyAppenderPort({
    db: options.db,
    secrets: options.secrets,
  });
  const workflowImapActions = createPostgresWorkflowImapActionPort({
    db: options.db,
    secrets: options.secrets,
  });
  const pgpMessages = options.secrets
    ? createPostgresPgpMessageCryptoPort({
      db: options.db,
      secrets: options.secrets,
    })
    : undefined;
  // Vorgezogen, weil der Workflow-Worker beides braucht: nach einer Tag-/
  // Kategorie-Schreibung muss er aufloesen koennen, WEN der Wert betrifft, und
  // die Invalidierung zustellen. Weiter unten werden dieselben Instanzen als
  // ports.mailAccess bzw. ports.events zurueckgegeben — kein zweiter Zustand.
  const events = options.events ?? createPostgresServerEventPort({ db: options.db });
  const mailAccessPort = createPostgresMailAccessPort({ db: options.db });
  const mailAclRolloutState = createPostgresMailAclRolloutStatePort({ db: options.db });
  const mailAccess = new MailAccessRolloutService({
    state: mailAclRolloutState,
    legacy: createPostgresMailAclRolloutLegacyPort({ db: options.db }),
    newAcl: mailAccessPort,
    onTelemetryDiagnostic: options.mailAclRolloutDiagnostic ?? reportMailAclRolloutDiagnostic,
  });
  const workflowExecution = createPostgresWorkflowExecutionJobPort({
    db: options.db,
    mssql: createPostgresMssqlSettingsPort({ db: options.db, secrets: options.secrets }),
    workflowImapActions,
    secrets: options.secrets,
    mailAccess,
    events,
  });
  const workflowDryRun = resolveWorkflowDryRun(workflowExecution);
  const emailOutboundValidation = createPostgresEmailOutboundValidationPort({
    db: options.db,
    workflowDryRun,
  });
  const auth = createPostgresAuthPort({
    db: options.db,
    accessTokenSigner: options.accessTokenSigner,
  });
  const syncInfo = createPostgresSyncInfoPort({ db: options.db });
  const loginSecurity = options.secrets
    ? createLoginSecurityService({
      db: options.db,
      syncInfo,
      listPublicWorkspaceSettings: createPostgresPublicAuthSecuritySettingsReader({ db: options.db }),
      secrets: options.secrets,
      auth,
      accessTokenSigner: options.accessTokenSigner,
      config: {
        turnstileSiteKey: options.turnstileSiteKey,
        turnstileSecretKey: options.turnstileSecretKey,
      },
      ...(options.authInvitationMail ? { authInvitationSmtp: options.authInvitationMail } : {}),
    })
    : undefined;
  const maintenance = options.databaseUrl?.trim()
    ? createServerMaintenancePort({
      db: options.db,
      databaseUrl: options.databaseUrl.trim(),
      appVersion: options.appVersion ?? '0.0.0',
      backupDir: options.backupDir,
      attachmentsRoot: options.attachmentsRoot,
      auditArchiveRoot: options.auditArchiveRoot,
      getNeedsInitialSetup: async () => {
        const state = await auth.getInitialSetupState?.();
        return state?.needsInitialSetup ?? false;
      },
    })
    : undefined;
  const audit = createPostgresAuditPort({ db: options.db });
  const emailTracking = options.publicBaseUrl?.trim() && options.masterKey
    ? createPostgresEmailTrackingService({
      db: options.db,
      publicBaseUrl: options.publicBaseUrl,
      masterKey: options.masterKey,
      audit,
      events,
      emailTrackingIpIntelligence: options.emailTrackingIpIntelligence,
    })
    : undefined;
  return {
    mailAccess,
    mailAclRollout: mailAclRolloutState,
    mailDelegation: createPostgresMailDelegationPort({ db: options.db }),
    mailResourceLookup: createPostgresMailResourceLookupPort({ db: options.db }),
    activityLog: createPostgresActivityLogReadPort({ db: options.db }),
    health: {
      async pingDatabase() {
        await sql`select 1`.execute(options.db);
      },
    },
    aiReplySuggestions: createPostgresAiReplySuggestionPort({ db: options.db, secrets: options.secrets }),
    aiProfiles: createPostgresAiProfileReadPort({ db: options.db, secrets: options.secrets }),
    aiPrompts: createPostgresAiPromptReadPort({ db: options.db }),
    aiTextTransform: createPostgresAiTextTransformApiPort({ db: options.db, secrets: options.secrets }),
    automationApiKeys: createPostgresAutomationApiKeyReadPort({ db: options.db, secrets: options.secrets }),
    calendarEntries: createPostgresCalendarEntryPort({ db: options.db }),
    calendarEvents: createPostgresCalendarEventReadPort({ db: options.db }),
    auth,
    ...(loginSecurity ? { loginSecurity } : {}),
    ...(maintenance ? { maintenance } : {}),
    ...(options.authInvitationMail ? {
      authInvitationMailer: createAuthInvitationMailerPort(options.authInvitationMail),
    } : {}),
    locks: createPostgresConversationLockPort({ db: options.db }),
    audit,
    mssqlSettings: createPostgresMssqlSettingsPort({ db: options.db, secrets: options.secrets }),
    customerCustomFields: createPostgresCustomerCustomFieldReadPort({ db: options.db }),
    customerCustomFieldValues: createPostgresCustomerCustomFieldValueReadPort({ db: options.db }),
    customers: createPostgresCustomerReadPort({ db: options.db }),
    userGroups: createPostgresUserGroupPort({ db: options.db }),
    dashboard: createPostgresDashboardPort({ db: options.db }),
    deals: createPostgresDealReadPort({ db: options.db }),
    dealProducts: createPostgresDealProductPort({ db: options.db }),
    emailAccounts: createPostgresEmailAccountReadPort({ db: options.db, secrets: options.secrets }),
    emailAccountMailSettings: createPostgresEmailAccountMailSettingsPort({ db: options.db }),
    ...(emailTracking ? { emailTracking } : {}),
    emailAccountSignatures: createPostgresEmailAccountSignatureReadPort({ db: options.db }),
    emailUserSignatures: createPostgresUserSignaturePort({ db: options.db }),
    emailAttachmentContent: createPostgresEmailAttachmentContentPort({ db: options.db, attachmentsRoot }),
    emailAttachments: createPostgresEmailAttachmentReadPort({ db: options.db }),
    emailCannedResponses: createPostgresEmailCannedResponseReadPort({ db: options.db }),
    emailCategories: createPostgresEmailCategoryReadPort({ db: options.db }),
    emailComposeAttachments: createPostgresEmailComposeAttachmentUploadPort({ db: options.db, attachmentsRoot }),
    emailComposeSender: createPostgresEmailComposeSenderPort({
      db: options.db,
      attachmentsRoot,
      secrets: options.secrets,
      tracking: emailTracking,
      sentCopyAppend: sentCopyAppender.append,
      pgpMessages,
      workflowDryRun,
    }),
    emailOutboundValidation,
    emailDiagnostics: createPostgresMailDiagnosticsPort({ db: options.db, attachmentsRoot }),
    emailReporting: createPostgresEmailReportingPort({ db: options.db }),
    dmarcReporting: createPostgresDmarcReportingPort({ db: options.db }),
    emailFolders: createPostgresEmailFolderReadPort({ db: options.db }),
    emailGdprExport: createPostgresEmailGdprExportPort({
      db: options.db,
      attachmentsRoot,
      trackingMasterKey: options.masterKey,
    }),
    emailInternalNotes: createPostgresEmailInternalNoteReadPort({ db: options.db }),
    emailMessageCategories: createPostgresEmailMessageCategoryReadPort({ db: options.db }),
    emailMessages: createPostgresEmailMessageReadPort({
      db: options.db,
      rspamdFetch: options.rspamdFetch,
      seenFlagSync: workflowImapActions,
      outboundValidation: emailOutboundValidation,
    }),
    emailMessageTags: createPostgresEmailMessageTagReadPort({ db: options.db }),
    mailConnectionTests: createServerMailConnectionTestPort({ db: options.db, secrets: options.secrets }),
    emailVacationTests: createPostgresEmailVacationTestPort({ db: options.db, secrets: options.secrets }),
    emailOAuth: createServerEmailOAuthPort(),
    emailReadReceipts: createPostgresEmailReadReceiptReadPort({ db: options.db }),
    emailReadReceiptResponder: createPostgresEmailReadReceiptResponderPort({ db: options.db, secrets: options.secrets }),
    emailRemoteContentAllowlist: createPostgresEmailRemoteContentAllowlistReadPort({ db: options.db }),
    emailTeamMembers: createPostgresEmailTeamMemberReadPort({ db: options.db }),
    emailThreadAliases: createPostgresEmailThreadAliasReadPort({ db: options.db }),
    emailThreadEdges: createPostgresEmailThreadEdgeReadPort({ db: options.db }),
    emailThreads: createPostgresEmailThreadReadPort({ db: options.db }),
    followUp: createPostgresFollowUpPort({ db: options.db }),
    events,
    mailThreadBackfill: createPostgresMailThreadBackfillPort({ db: options.db }),
    ...(options.jobQueue ? {
      jobQueue: options.jobQueue,
      workflowInboundBackfill: createPostgresWorkflowInboundBackfillPort({
        db: options.db,
        jobQueue: options.jobQueue,
      }),
    } : {}),
    jtlFirmen: createPostgresJtlReferenceReadPort({ db: options.db, tableName: 'jtl_firmen' }),
    jtlOrders: createPostgresJtlOrderPort({ db: options.db, secrets: options.secrets }),
    jtlSync: createPostgresJtlSyncPort({ db: options.db, secrets: options.secrets }),
    jtlVersandarten: createPostgresJtlReferenceReadPort({ db: options.db, tableName: 'jtl_versandarten' }),
    jtlWarenlager: createPostgresJtlReferenceReadPort({ db: options.db, tableName: 'jtl_warenlager' }),
    jtlZahlungsarten: createPostgresJtlReferenceReadPort({ db: options.db, tableName: 'jtl_zahlungsarten' }),
    pgpIdentities: createPostgresPgpIdentityReadPort({ db: options.db, secrets: options.secrets }),
    pgpKeyMaterial: createOpenPgpKeyMaterialPort(),
    ...(pgpMessages ? { pgpMessages } : {}),
    pgpPeerKeys: createPostgresPgpPeerKeyReadPort({ db: options.db }),
    products: createPostgresProductReadPort({ db: options.db }),
    spamDecisions: createPostgresSpamDecisionReadPort({ db: options.db }),
    spamFeatureStats: createPostgresSpamFeatureStatReadPort({ db: options.db }),
    spamLearningEvents: createPostgresSpamLearningEventReadPort({ db: options.db }),
    spamListEntries: createPostgresSpamListEntryReadPort({ db: options.db }),
    savedViews: createPostgresSavedViewReadPort({ db: options.db }),
    smtpRelay: createPostgresSmtpRelayAdminPort({ db: options.db, secrets: options.secrets }),
    syncInfo,
    tasks: createPostgresTaskReadPort({ db: options.db }),
    workflowDelayedJobs: createPostgresWorkflowDelayedJobReadPort({ db: options.db }),
    workflowExecution: {
      dryRun: workflowDryRun,
    },
    workflowForwardDedup: createPostgresWorkflowForwardDedupReadPort({ db: options.db }),
    workflowKnowledgeBases: createPostgresWorkflowKnowledgeBaseReadPort({ db: options.db }),
    workflowKnowledgeChunks: createPostgresWorkflowKnowledgeChunkReadPort({ db: options.db }),
    workflowMessageApplied: createPostgresWorkflowMessageAppliedReadPort({ db: options.db }),
    workflowRuns: createPostgresWorkflowRunReadPort({ db: options.db }),
    workflowRunSteps: createPostgresWorkflowRunStepReadPort({ db: options.db }),
    workflowNodeCatalog: createStaticWorkflowNodeCatalogPort(),
    workflowTemplates: createStaticWorkflowTemplatePort(),
    workflowVersions: createPostgresWorkflowVersionReadPort({ db: options.db }),
    workflows: createPostgresWorkflowReadPort({ db: options.db }),
  };
}

function reportMailAclRolloutDiagnostic(event: Parameters<MailAclRolloutDiagnosticReporter>[0]): void {
  console.warn(`[mail-acl-rollout] telemetry diagnostic: ${event.code}`);
}

/**
 * `Origin: null` ist keine Herkunft, sondern deren Abwesenheit. Sandboxed
 * iframes, `file://`-Dokumente und einige Weiterleitungen senden es — jede
 * beliebige fremde Website kann diesen Wert also erzeugen. In der Allowlist
 * steht er damit nicht fuer "unser Desktop-Client", sondern fuer "alle".
 * Zusammen mit `Access-Control-Allow-Credentials: true` duerfte fremdes
 * JavaScript dann angemeldete Anfragen stellen UND die Antworten lesen.
 *
 * Kein Abbruch: es gibt gepackte Clients, die ohne das nicht laufen, und diese
 * Entscheidung gehoert dem Betreiber. Aber sie darf nicht unbemerkt bleiben.
 */
function warnAboutNullCorsOrigin(origins: readonly string[]): void {
  if (!origins.includes('null')) return;
  console.warn(
    'SECURITY: CORS_ALLOWED_ORIGINS enthaelt "null". Dieser Wert ist keinem Absender zuzuordnen — '
    + 'jede fremde Website kann ihn ueber ein sandboxed iframe erzeugen und damit angemeldete '
    + 'Anfragen stellen und deren Antworten lesen. Nur setzen, wenn ein gepackter Client es '
    + 'zwingend braucht; sonst die echte Origin des Clients eintragen.',
  );
}

/**
 * Reservierungen wegraeumen, aus denen nie ein Fehlversuch wurde.
 *
 * Der Login reserviert seinen Versuch VOR der CAPTCHA-Pruefung, weil die
 * kontoweite Schwelle sonst zu spaet zaehlt. Eine dort abgewiesene Anfrage
 * laesst damit eine Zeile zurueck — und wer unangemeldet mit wechselnden
 * Adressen anklopft, erzeugt beliebig viele. Geloescht wurden sie sonst nur
 * durch eine erfolgreiche Anmeldung genau dieses Paares, die es in dem Fall nie
 * gibt.
 *
 * Geraeumt wird nur, was aelter ist als das Zaehlfenster: eine noch zaehlende
 * Reservierung darf nicht verschwinden, sonst waere die Schwelle wieder blind.
 */
const PROVISIONAL_LOGIN_CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

function startProvisionalLoginAttemptCleanup(ports: ServerApiPorts): { stop(): void } {
  const prune = ports.auth.pruneProvisionalLoginAttempts;
  if (!prune) return { stop() { /* nichts zu takten */ } };
  const timer = setInterval(() => {
    void prune({ olderThanSeconds: ACCOUNT_WIDE_FAILURE_WINDOW_SECONDS }).catch((error: unknown) => {
      console.warn(`[auth] provisional login attempt cleanup failed: ${
        error instanceof Error ? error.message : String(error)
      }`);
    });
  }, PROVISIONAL_LOGIN_CLEANUP_INTERVAL_MS);
  timer.unref?.();
  return { stop() { clearInterval(timer); } };
}

/** PostgreSQL: undefined_table. Der einzige Fehler, den die Pruefung unten aushaelt. */
const PG_UNDEFINED_TABLE = '42P01';

function isMissingTableError(error: unknown): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === PG_UNDEFINED_TABLE;
}

/**
 * Der Weg zurueck, und zwar einer, der auch funktioniert.
 *
 * Nur die Fingerabdruck-Zeile zu loeschen genuegt nicht: die alten Secrets
 * liegen weiter da und weisen den naechsten Start erneut ab. Ein Umschluesseln
 * im Betrieb gibt es nicht — dafuer braeuchte man den alten Schluessel, und wenn
 * man den haette, waere das hier kein Problem.
 */
const MASTER_KEY_RECOVERY_HINT =
  'Restore the original docker/.env and the server starts again. If the old key is gone '
  + 'for good, the encrypted rows are lost with it and have to go, together with the row '
  + 'in master_key_fingerprints. Mind that row level security is FORCED on secrets: a '
  + 'plain "DELETE FROM secrets" over the application connection matches nothing and says '
  + 'so with "DELETE 0", which would leave exactly the state that refuses the next start. '
  + 'Run it with a session context instead — BEGIN; SELECT '
  + "set_config('app.role','system',true), set_config('app.cross_workspace_access','on',true); "
  + 'DELETE FROM secrets; DELETE FROM email_tracking_token_resolver; DELETE FROM '
  + 'email_tracking_links; UPDATE email_tracking_events SET raw_metadata_ciphertext = NULL, '
  + 'raw_metadata_nonce = NULL, raw_metadata_auth_tag = NULL; DELETE FROM '
  + 'master_key_fingerprints; COMMIT; — or connect as the admin role, which bypasses RLS. The '
  + 'tracking rows belong in there: their tokens and sealed target URLs hang on the same key '
  + 'and would refuse the next start just like the secrets. The resolver needs its own DELETE — '
  + 'open-tracking rows carry no link_id, so removing the links does not cascade to them. Then '
  + 'start with the new key and enter every credential again.';

const MASTER_KEY_MISMATCH_MESSAGE =
  'SIMPLECRM_MASTER_KEY does not match this database. Every secret stored here was '
  + 'encrypted with a different key and cannot be decrypted with this one. This usually '
  + `means a dump was restored without its matching docker/.env. ${MASTER_KEY_RECOVERY_HINT}`;

const MASTER_KEY_MISSING_MESSAGE =
  'SIMPLECRM_MASTER_KEY is not set, but this database already holds secrets encrypted '
  + 'with a master key. Starting without it would leave every stored credential '
  + 'unreadable while new ones are written unencrypted-by-omission. Restore the '
  + 'matching docker/.env — the fingerprints of the keys this database was used with '
  + 'are in master_key_fingerprints.';

/**
 * Gehoert dieser Master-Key zu dieser Datenbank?
 *
 * Alle Secrets darin sind mit ihm verschluesselt, er selbst steht nur in der
 * .env. Wird ein Dump mit der falschen .env eingespielt, ist die Datenbank
 * vollstaendig und trotzdem unbrauchbar — und das fiel bisher erst auf, wenn
 * das erste Postfach nicht mehr synchronisierte, also mitten im Betrieb und
 * ohne erkennbaren Zusammenhang zur Wiederherstellung.
 *
 * Beim ersten Start mit einem Schluessel wird sein Fingerabdruck hinterlegt,
 * danach verglichen. Abbruch bei Abweichung, nicht Warnung: weiterzulaufen
 * hiesse, mit unlesbaren Secrets zu arbeiten und dabei neue mit dem falschen
 * Schluessel zu schreiben — aus einem behebbaren Konfigurationsfehler wuerde
 * ein Datenschaden.
 *
 * Ein FEHLENDER Schluessel ist derselbe Fehler, nur andersherum: wurde diese
 * Datenbank schon mit einem Schluessel betrieben, hiesse ohne ihn
 * weiterzulaufen wieder, auf unlesbaren Secrets zu arbeiten.
 *
 * Eine LEERE Tabelle beweist dabei gar nichts. Migration 0049 legt sie ohne
 * Backfill an, und ein Dump von vorher bringt sie leer mit — also genau in dem
 * Fall, um den es hier geht: pre-0049-Dump mit der falschen .env eingespielt.
 * Ohne weitere Pruefung wuerde der falsche Schluessel dann als Wahrheit
 * hinterlegt und der richtige spaeter abgewiesen. Sind Secrets vorhanden, wird
 * der Schluessel deshalb an einem davon geprobt: das Envelope ist AEAD-versiegelt
 * (XChaCha20-Poly1305 ueber workspace/kind/name), ein fremder Schluessel scheitert
 * an der Authentifizierung. Erst wenn er sich bewaehrt hat, wird sein
 * Fingerabdruck angelegt.
 *
 * Fehlt die TABELLE (Migration 0049 noch nicht gelaufen), passiert nichts: die
 * Migrationen sind ein eigener Dienst, der Start darf nicht daran haengen, dass
 * ein Schema schon aktuell ist. Toleriert wird dafuer ausschliesslich der
 * Postgres-Code 42P01. Jeder andere Fehler — Verbindungsabbruch, rotiertes
 * PG_PASSWORD, `too many clients` — wird durchgereicht, sonst saehe ein
 * gescheiterter Start aus wie eine bestandene Pruefung.
 */
export async function assertMasterKeyMatchesDatabase(
  db: Kysely<ServerDatabase>,
  masterKey: MasterKeyMaterial | undefined,
): Promise<void> {
  // Alles unter EINER Sperre, nicht nur der Einfuegevorgang.
  //
  // Ohne sie ist die Pruefung ein klassisches Pruefen-dann-Handeln: starten auf
  // einer frischen Datenbank gleichzeitig eine Replik mit Schluessel und eine
  // ohne, sehen beide eine leere Tabelle. Die schlusselose laeuft dauerhaft
  // weiter — ohne Secret- und Tracking-Krypto und ohne jede Meldung —, waehrend
  // die andere unmittelbar danach den Fingerabdruck eintraegt. Der
  // konfliktfeste Insert half dort nicht: die schluessellose Replik schreibt ja
  // gar nichts.
  //
  // Die Kennung ist eine feste Zahl; sie steht fuer "Master-Key dieser
  // Datenbank" und sonst nichts. pg_advisory_xact_lock endet mit der
  // Transaktion, auch wenn der Start scheitert.
  await db.transaction().execute(async (trx) => {
    await sql`SELECT pg_advisory_xact_lock(${MASTER_KEY_ADVISORY_LOCK})`.execute(trx);
    await assertMasterKeyMatchesDatabaseLocked(trx, masterKey);
  });
}

/** Ein Wert, der nur hier vorkommt — er benennt die Sperre, nicht mehr. */
const MASTER_KEY_ADVISORY_LOCK = 4_915_231_049n;

async function assertMasterKeyMatchesDatabaseLocked(
  db: Kysely<ServerDatabase>,
  masterKey: MasterKeyMaterial | undefined,
): Promise<void> {
  // Fehlt die Tabelle, ist Migration 0049 noch nicht gelaufen. Frueher hiess
  // das: Pruefung beendet, Start frei. Das ist zu viel — im Compose-Ablauf
  // wartet die API zwar auf `migrate`, aber ein Rolling Deployment oder ein
  // anderer Orchestrator startet sie auch mal davor, und dann liefe eine
  // falsche .env genau in dem Fenster durch und schriebe Daten unter einem
  // zweiten Schluessel. Uebersprungen wird deshalb nur das SPEICHERN; geprobt
  // wird trotzdem.
  //
  // Der SAVEPOINT ist nicht Zierde: alles laeuft in einer Transaktion, und ein
  // Fehler reisst sie ab. Ohne ihn scheiterte jede weitere Anweisung mit
  // "current transaction is aborted" — aus der Toleranz waere eine Startsperre
  // geworden.
  let stored: Array<{ key_id: string; fingerprint: string; salt: string }> | undefined;
  await sql`SAVEPOINT master_key_fingerprints_read`.execute(db);
  try {
    stored = await db
      .selectFrom('master_key_fingerprints')
      .select(['key_id', 'fingerprint', 'salt'])
      .execute();
    await sql`RELEASE SAVEPOINT master_key_fingerprints_read`.execute(db);
  } catch (error) {
    await sql`ROLLBACK TO SAVEPOINT master_key_fingerprints_read`.execute(db);
    if (!isMissingTableError(error)) throw error;
    stored = undefined;
  }

  const existing = masterKey
    ? stored?.find((row) => row.key_id === masterKey.keyId)
    : undefined;
  if (masterKey && existing) {
    const fingerprintOfConfiguredKey = masterKeyFingerprint(masterKey, existing.salt);
    if (!masterKeyFingerprintMatches(existing.fingerprint, fingerprintOfConfiguredKey)) {
      throw new Error(MASTER_KEY_MISMATCH_MESSAGE);
    }
    return;
  }

  // Kein passender Eintrag. Bevor das als "frische Installation" durchgeht:
  // gibt es ueberhaupt Secrets? Nach einem Upgrade oder einem eingespielten
  // pre-0049-Dump ist die Tabelle leer und die Datenbank trotzdem voll.
  const probe = await findSecretProbe(db, masterKey?.keyId);

  if (!masterKey) {
    if ((stored?.length ?? 0) === 0 && probe.kind === 'none') return;
    throw new Error(MASTER_KEY_MISSING_MESSAGE);
  }

  if (probe.kind === 'unusable') {
    // Es liegen Secrets unter einer anderen key_id oder einem anderen
    // Algorithmus. Die kann der konfigurierte Schluessel definitiv nicht lesen —
    // die Entschluesselung prueft die key_id, bevor sie ueberhaupt anfaengt.
    // Auch wenn DANEBEN lesbare liegen, ist das kein Grund weiterzulaufen: der
    // Fingerabdruck wuerde hinterlegt, kuenftige Starts verglichen nur noch ihn,
    // und die unlesbaren Zeilen saehe nie wieder jemand an — waehrend readSecret
    // im Betrieb ueber sie stolpert.
    throw new Error(
      `This database holds secrets that were not written with key id "${masterKey.keyId}" `
      + `and algorithm ${SECRET_ENVELOPE_ALGORITHM}, namely: ${describeSecretKinds(probe.found)}. `
      + `SIMPLECRM_MASTER_KEY cannot decrypt those. ${MASTER_KEY_RECOVERY_HINT}`,
    );
  }
  if (probe.kind === 'material') {
    // JEDES Secret, nicht eines. Ein frueherer Start mit der falschen .env kann
    // neue Secrets neben die alten geschrieben haben — alle unter key_id
    // 'default', alle mit demselben Algorithmus, aber mit verschiedenem
    // Schluesselmaterial. Eine Stichprobe von einer Zeile wuerde je nach
    // Zufallstreffer den einen oder den anderen Schluessel segnen und den Rest
    // unlesbar zuruecklassen. Es ist ein einmaliger Vorgang: sobald ein
    // Fingerabdruck steht, kommt der Code hier nicht mehr vorbei.
    for (const row of probe.secrets) {
      if (!await secretIsReadableWith(row, masterKey)) throw new Error(MASTER_KEY_MISMATCH_MESSAGE);
    }
    for (const row of probe.tracking) {
      if (!trackingLinkIsReadableWith(row, masterKey)) throw new Error(MASTER_KEY_MISMATCH_MESSAGE);
    }
    for (const row of probe.trackingEvents) {
      if (!trackingEventIsReadableWith(row, masterKey)) throw new Error(MASTER_KEY_MISMATCH_MESSAGE);
    }
    for (const row of probe.trackingTokens) {
      if (!trackingTokenIsReadableWith(row, masterKey)) throw new Error(MASTER_KEY_MISMATCH_MESSAGE);
    }
  }

  if (stored === undefined) {
    // Geprobt wurde; hinterlegen geht ohne die Tabelle nicht. Solange etwas da
    // war, das der Schluessel lesen konnte, ist das in Ordnung: die
    // Festlegung holt der naechste Start nach der Migration nach.
    if (probe.kind !== 'none') return;

    // Ist die Datenbank aber LEER, ist dieser Zustand nicht abzusichern. Zwei
    // Replikate mit verschiedenen Schluesseln kaemen hier nacheinander durch —
    // es gibt weder etwas zu proben noch etwas zu hinterlegen, und die Sperre
    // endet mit der Transaktion. Danach schrieben beide Secrets unter derselben
    // key_id mit verschiedenem Schluesselmaterial; auffallen wuerde es erst beim
    // naechsten Start, und dann waere die Haelfte unlesbar.
    //
    // Der Abbruch kostet hier fast nichts: ohne Migrationen gibt es kein
    // Schema, die API koennte ohnehin nichts ausliefern. Im Compose-Ablauf
    // wartet sie auf `migrate` und sieht diesen Zweig nie.
    throw new Error(
      'This database has no master_key_fingerprints table yet, so migration 0049 has not run. '
      + 'The database is also empty, which means the key this server starts with cannot be '
      + 'recorded — two servers with different keys would both come through here and write '
      + 'secrets under the same key id with different key material. Run the migrations first, '
      + 'then start the API (the Compose flow does this via the `migrate` service).',
    );
  }

  // Ab hier legt sich diese Installation auf den Schluessel fest. Der letzte
  // Moment, in dem ein ratbarer Schluessel noch folgenlos ersetzt werden kann:
  // es gibt weder einen Eintrag noch ein Secret, das dabei unlesbar wuerde.
  // Nur DESHALB steht die Weigerung hier und nicht in der Konfiguration —
  // dort traefe sie auch eine bestehende Installation, die mit ihrem alten
  // Schluessel nirgendwo mehr hinkaeme.
  if (stored.length === 0 && probe.kind === 'none' && masterKeyLooksGuessable(masterKey.bytes)) {
    throw new Error(
      `${MASTER_KEY_LOOKS_GUESSABLE_MESSAGE} This database is still empty of secrets, so `
      + 'replacing the key now costs nothing — later it would cost every stored credential.',
    );
  }

  // Ein eigener Zufallssalt je Installation. Mit einem festen Etikett als Salt
  // ergaebe derselbe Schluessel ueberall denselben veroeffentlichten Wert:
  // einmal rechnen, gegen beliebig viele fremde Backup-Metadaten halten — und
  // nebenbei sieht man, wo derselbe Schluessel zweimal benutzt wurde. Genau die
  // Tabellen-Wiederverwendung, die weiter oben fuer einen blossen Hash
  // ausgeschlossen wird.
  const salt = newMasterKeyFingerprintSalt();
  const fingerprint = masterKeyFingerprint(masterKey, salt);
  await db
    .insertInto('master_key_fingerprints')
    .values({ key_id: masterKey.keyId, fingerprint, salt })
    .onConflict((oc) => oc.column('key_id').doNothing())
    .execute();

  // Der Konflikt-Zweig schreibt nichts — und genau dann ist der hinterlegte
  // Wert ein fremder: zwei Instanzen starten gleichzeitig, die andere war
  // zuerst da. Ohne dieses Nachlesen waere ausgerechnet der Fall ungeprueft
  // durchgegangen, fuer den die Pruefung da ist. Verglichen wird mit DEM Salt,
  // der in der Datenbank steht, nicht mit dem eigenen.
  const after = await db
    .selectFrom('master_key_fingerprints')
    .select(['fingerprint', 'salt'])
    .where('key_id', '=', masterKey.keyId)
    .executeTakeFirst();
  if (after && !masterKeyFingerprintMatches(
    after.fingerprint,
    masterKeyFingerprint(masterKey, after.salt),
  )) {
    throw new Error(MASTER_KEY_MISMATCH_MESSAGE);
  }
}

type SecretProbeRow = Readonly<{
  workspace_id: string;
  kind: string;
  name: string;
  nonce: Buffer | Uint8Array;
  ciphertext: Buffer | Uint8Array;
}>;

type SecretKind = Readonly<{ key_id: string; algorithm: string }>;

type TrackingProbeRow = Readonly<{
  workspace_id: string;
  tracking_message_id: string;
  id: string;
  target_ciphertext: Buffer | Uint8Array;
  target_nonce: Buffer | Uint8Array;
  target_auth_tag: Buffer | Uint8Array;
}>;

type TrackingEventProbeRow = Readonly<{
  workspace_id: string;
  tracking_message_id: string;
  dedupe_key: string;
  raw_metadata_ciphertext: Buffer | Uint8Array;
  raw_metadata_nonce: Buffer | Uint8Array;
  raw_metadata_auth_tag: Buffer | Uint8Array;
}>;

type TrackingTokenProbeRow = Readonly<{
  token_hash: string;
  tracking_message_id: string;
  link_id: string | null;
  token_kind: string;
}>;

type SecretProbe =
  | { kind: 'none' }
  | { kind: 'unusable'; found: readonly SecretKind[] }
  | {
    kind: 'material';
    secrets: readonly SecretProbeRow[];
    tracking: readonly TrackingProbeRow[];
    trackingEvents: readonly TrackingEventProbeRow[];
    trackingTokens: readonly TrackingTokenProbeRow[];
  };

/**
 * Wie viele Zeilen die einmalige Probe anfasst.
 *
 * `secrets` sind Postfach-Passwoerter, OAuth-Token, Provider-Schluessel —
 * Groessenordnung Dutzende. Die werden VOLLSTAENDIG geprueft, seitenweise und
 * ohne Obergrenze: eine einzelne Zeile zu proben genuegt nicht, weil ein
 * frueherer Start mit der falschen .env neue Secrets neben die alten
 * geschrieben haben kann, alle unter derselben key_id. Eine Obergrenze waere
 * dasselbe Versehen eine Ebene hoeher — was jenseits davon liegt, bliebe
 * ungeprueft und trotzdem fuer immer festgeschrieben.
 *
 * Tracking-Zeilen koennen dagegen sechsstellig werden; die zu jedem Erststart
 * durchzurechnen waere nicht vertretbar. Dort eine Stichprobe von den aeltesten
 * UND den juengsten Zeilen: ein Schluesselwechsel faellt zeitlich, und die
 * Raender zeigen ihn. Das ist ausdruecklich eine Stichprobe, keine Garantie.
 */
const SECRET_PROBE_PAGE = 500;
const TRACKING_PROBE_SAMPLE = 3;

/** Fuer die Fehlermeldung: was liegt statt des Erwarteten in der Tabelle? */
function describeSecretKinds(found: readonly SecretKind[]): string {
  if (found.length === 0) return 'unknown';
  return found.map((entry) => `key id "${entry.key_id}" (${entry.algorithm})`).join(', ');
}

/**
 * Alles, woran sich der Schluessel proben laesst — und die Auskunft, ob etwas
 * daliegt, das er ohnehin nicht lesen kann.
 *
 * Zuerst ALLE vorkommenden Schluessel-/Algorithmus-Kombinationen, dann erst die
 * Probezeilen. Andersherum (erste passende Zeile gewinnt) wuerde eine gemischte
 * Datenbank durchgehen: der Fingerabdruck wird hinterlegt, kuenftige Starts
 * vergleichen nur noch ihn und sehen die uebrigen Zeilen nie wieder an —
 * waehrend readSecret sie nach wie vor nicht entschluesseln kann.
 *
 * Und nicht nur `secrets`: aus demselben Master-Key leitet
 * createEmailTrackingCrypto Token-, Verschluesselungs- und Link-Hash-Schluessel
 * ab. Eine Datenbank ohne Secrets, aber mit Tracking-Daten ist deshalb nicht
 * frisch — ein fremder Schluessel entwertet dort bestehende Tokens, macht
 * `email_tracking_links.target_ciphertext` unlesbar und ebenso die
 * Rohmetadaten in `email_tracking_events`, die danach nur noch als
 * `rawUnavailable` erscheinen. Beide Tabellen gehoeren also in die Probe: eine
 * Installation, die nur Oeffnungen mit Rohdatenerfassung sammelt, hat gar keine
 * Links.
 *
 * Alle drei Tabellen haben FORCE ROW LEVEL SECURITY, eine gewoehnliche Abfrage
 * saehe also null Zeilen und die Datenbank faelschlich als leer. Deshalb
 * dieselbe transaktionslokale Freigabe, die auch die Migrationen benutzen:
 * Rolle `system` plus `cross_workspace_access`. Gelesen werden nur Envelopes,
 * nie ein Klartext.
 *
 * Laeuft in der Transaktion des Aufrufers — die haelt die Sperre, unter der
 * Pruefen und Festlegen ein Vorgang sind.
 */
async function findSecretProbe(
  trx: Kysely<ServerDatabase>,
  keyId: string | undefined,
): Promise<SecretProbe> {
  await sql`
    SELECT set_config('app.role', 'system', true),
           set_config('app.cross_workspace_access', 'on', true)
  `.execute(trx);

  // Fehlt eine der Tabellen, ist die Datenbank aelter als die Migration, die
  // sie anlegt — dann gibt es dort auch nichts zu schuetzen. Nur 42P01, alles
  // andere fliegt weiter.
  //
  // Und zwar mit SAVEPOINT: seit alles unter einer Sperre in EINER Transaktion
  // laeuft, reisst ein Fehler die ganze Transaktion ab. Ein blosses try/catch
  // faengt zwar den Fehler, aber jede weitere Anweisung scheitert danach mit
  // "current transaction is aborted" — die Toleranz waere zur Startsperre
  // geworden. Aufgefallen ist das erst gegen eine echte Datenbank; ein Stub
  // haette nichts davon gemerkt.
  let savepoint = 0;
  const tolerateMissing = async <T>(query: () => Promise<T[]>): Promise<T[]> => {
    savepoint += 1;
    const name = `master_key_probe_${savepoint}`;
    await sql.raw(`SAVEPOINT ${name}`).execute(trx);
    try {
      const rows = await query();
      await sql.raw(`RELEASE SAVEPOINT ${name}`).execute(trx);
      return rows;
    } catch (error) {
      await sql.raw(`ROLLBACK TO SAVEPOINT ${name}`).execute(trx);
      if (isMissingTableError(error)) return [];
      throw error;
    }
  };

  const kinds = await tolerateMissing(() => trx
    .selectFrom('secrets')
    .select(['key_id', 'algorithm'])
    .distinct()
    .limit(6)
    .execute());

  const foreign = kinds.filter(
    (entry) => entry.key_id !== keyId || entry.algorithm !== SECRET_ENVELOPE_ALGORITHM,
  );
  if (foreign.length > 0) return { kind: 'unusable', found: foreign };

  // Seitenweise durch ALLE Secrets — die Festlegung gilt fuer immer, eine
  // abgeschnittene Grundlage waere keine.
  const secrets: SecretProbeRow[] = [];
  if (kinds.length > 0) {
    let after: string | undefined;
    for (;;) {
      const page = await tolerateMissing(() => {
        const base = trx
          .selectFrom('secrets')
          .select(['id', 'workspace_id', 'kind', 'name', 'nonce', 'ciphertext'])
          .where('key_id', '=', keyId as string)
          .where('algorithm', '=', SECRET_ENVELOPE_ALGORITHM);
        // Der Cursor kommt erst ab der zweiten Seite dazu: `id > ''` ist fuer
        // eine uuid-Spalte kein leerer Anfang, sondern ein Syntaxfehler.
        return (after === undefined ? base : base.where('id', '>', after))
          .orderBy('id', 'asc')
          .limit(SECRET_PROBE_PAGE)
          .execute();
      });
      if (page.length === 0) break;
      secrets.push(...(page as unknown as SecretProbeRow[]));
      after = String((page[page.length - 1] as { id: string }).id);
      if (page.length < SECRET_PROBE_PAGE) break;
    }
  }

  const linkColumns = [
    'workspace_id', 'tracking_message_id', 'id',
    'target_ciphertext', 'target_nonce', 'target_auth_tag',
  ] as const;
  const eventColumns = [
    'workspace_id', 'tracking_message_id', 'dedupe_key',
    'raw_metadata_ciphertext', 'raw_metadata_nonce', 'raw_metadata_auth_tag',
  ] as const;
  // Nacheinander, nicht mit Promise.all: die beiden Abfragen laufen auf
  // derselben Verbindung und setzen je einen SAVEPOINT. Verschraenkt gaebe das
  // SAVEPOINT a, SAVEPOINT b, RELEASE a — und mit a verschwindet b, weil ein
  // aeusserer Savepoint die inneren mitnimmt. Nebenlaeufigkeit gaebe es hier
  // ohnehin keine: eine Verbindung fuehrt eine Anweisung nach der anderen aus.
  const edges = async <T extends { }>(
    query: (direction: 'asc' | 'desc') => Promise<T[]>,
  ): Promise<T[]> => {
    const oldest = await query('asc');
    const newest = await query('desc');
    return [...oldest, ...newest];
  };

  const tracking = dedupeBy(
    await edges((direction) => tolerateMissing(() => trx
      .selectFrom('email_tracking_links').select(linkColumns)
      .orderBy('created_at', direction).limit(TRACKING_PROBE_SAMPLE).execute())),
    (row) => String(row.id),
  ) as unknown as TrackingProbeRow[];

  const trackingEvents = dedupeBy(
    await edges((direction) => tolerateMissing(() => trx
      .selectFrom('email_tracking_events').select(eventColumns)
      .where('raw_metadata_ciphertext', 'is not', null)
      .orderBy('created_at', direction).limit(TRACKING_PROBE_SAMPLE).execute())),
    (row) => `${String(row.workspace_id)}:${String(row.dedupe_key)}`,
  ) as unknown as TrackingEventProbeRow[];

  // Der Resolver ist die letzte Stelle, an der ein Master-Key Spuren
  // hinterlaesst: `token_hash` ist der SHA-256 eines HMAC ueber den
  // Tracking-Schluessel. Eine Installation, die nur Oeffnungen zaehlt und keine
  // Rohdaten sammelt, hat weder Links noch versiegelte Ereignisse — aber fuer
  // jede getrackte Nachricht eine Resolver-Zeile. Ohne sie saehe diese
  // Datenbank leer aus, und ein falscher Schluessel machte jedes ausgestellte
  // Zaehlpixel unaufloesbar.
  const trackingTokens = dedupeBy(
    await edges((direction) => tolerateMissing(() => trx
      .selectFrom('email_tracking_token_resolver')
      .select(['token_hash', 'tracking_message_id', 'link_id', 'token_kind'])
      .orderBy('created_at', direction).limit(TRACKING_PROBE_SAMPLE).execute())),
    (row) => String(row.token_hash),
  ) as unknown as TrackingTokenProbeRow[];

  if (secrets.length === 0
    && tracking.length === 0
    && trackingEvents.length === 0
    && trackingTokens.length === 0) {
    return { kind: 'none' };
  }
  return { kind: 'material', secrets, tracking, trackingEvents, trackingTokens };
}

function dedupeBy<T>(rows: readonly T[], key: (row: T) => string): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const id = key(row);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Probeentschluesselung. Das Envelope ist AEAD-versiegelt und bindet
 * workspace/kind/name mit ein — ein fremder Schluessel scheitert an der
 * Authentifizierung, er liefert keinen Muell, sondern einen Fehler.
 */
/**
 * Dasselbe fuer das E-Mail-Tracking. Auch dessen Schluessel haengen am
 * Master-Key (createEmailTrackingCrypto), und `target_ciphertext` ist
 * AES-256-GCM mit workspace/tracking/link als assoziierten Daten — ein fremder
 * Schluessel scheitert am Auth-Tag.
 */
function trackingLinkIsReadableWith(
  row: TrackingProbeRow,
  masterKey: MasterKeyMaterial,
): boolean {
  try {
    createEmailTrackingCrypto(masterKey.bytes).openJson({
      ciphertext: Buffer.from(row.target_ciphertext),
      nonce: Buffer.from(row.target_nonce),
      authTag: Buffer.from(row.target_auth_tag),
    }, emailTrackingLinkAssociatedData(row.workspace_id, row.tracking_message_id, row.id));
    return true;
  } catch {
    return false;
  }
}

/**
 * Und fuer die Rohmetadaten der Tracking-Ereignisse. Eine Installation, die nur
 * Oeffnungen mit Rohdatenerfassung sammelt, hat keine Links — dort haengt alles
 * Verschluesselte an dieser Tabelle.
 */
function trackingEventIsReadableWith(
  row: TrackingEventProbeRow,
  masterKey: MasterKeyMaterial,
): boolean {
  try {
    createEmailTrackingCrypto(masterKey.bytes).openJson({
      ciphertext: Buffer.from(row.raw_metadata_ciphertext),
      nonce: Buffer.from(row.raw_metadata_nonce),
      authTag: Buffer.from(row.raw_metadata_auth_tag),
    }, emailTrackingEventAssociatedData(row.workspace_id, row.tracking_message_id, row.dedupe_key));
    return true;
  } catch {
    return false;
  }
}

/**
 * Und fuer die ausgestellten Tokens. Hier gibt es nichts zu entschluesseln —
 * der Hash wird nachgerechnet: token(kind, id) haengt am Tracking-Schluessel,
 * und der haengt am Master-Key. Stimmt er ueberein, war es derselbe Schluessel.
 */
function trackingTokenIsReadableWith(
  row: TrackingTokenProbeRow,
  masterKey: MasterKeyMaterial,
): boolean {
  const purpose = row.token_kind === 'open' ? 'open' : 'click';
  const id = purpose === 'open' ? row.tracking_message_id : row.link_id;
  // Eine Zeile ohne die Kennung, aus der ihr Token entstanden ist, laesst sich
  // nicht nachrechnen. Sie darf den Start nicht aufhalten — die anderen Proben
  // greifen weiterhin.
  if (!id) return true;
  try {
    const crypto = createEmailTrackingCrypto(masterKey.bytes);
    return crypto.tokenHash(crypto.token(purpose, id)) === row.token_hash;
  } catch {
    return false;
  }
}

async function secretIsReadableWith(
  row: SecretProbeRow,
  masterKey: MasterKeyMaterial,
): Promise<boolean> {
  try {
    await decryptSecretValue({
      key: masterKey,
      envelope: {
        algorithm: SECRET_ENVELOPE_ALGORITHM,
        keyId: masterKey.keyId,
        nonce: Buffer.from(row.nonce),
        ciphertext: Buffer.from(row.ciphertext),
      },
      associatedData: { workspaceId: row.workspace_id, kind: row.kind, name: row.name },
    });
    return true;
  } catch {
    return false;
  }
}

function accessTokenSignerFromEnv(env: ServerEditionEnv): AccessTokenSigner | undefined {
  const secret = env.ACCESS_TOKEN_SECRET;
  if (!secret) return undefined;
  return accessTokenSignerFromBase64(secret, env.ACCESS_TOKEN_KEY_ID ?? 'default');
}

async function createDefaultServerPorts(input: {
  databaseUrl?: string;
  accessTokenSigner?: AccessTokenSigner;
  attachmentsRoot?: string;
  auditArchiveRoot?: string;
  backupDir?: string;
  appVersion?: string;
  createDatabase?: (options: { databaseUrl: string }) => Promise<Kysely<ServerDatabase>>;
  createEventNotifications?: (options: { databaseUrl: string }) => Promise<PostgresServerEventNotificationChannel>;
  masterKey?: string;
  publicBaseUrl?: string;
  authInvitationMail?: AuthInvitationMailConfig;
  turnstileSiteKey?: string;
  turnstileSecretKey?: string;
  emailTrackingIpIntelligence?: EmailTrackingIpIntelligencePort;
  onDatabaseCreated(db: Kysely<ServerDatabase>): void;
  onSecretsCreated(secrets: PostgresSecretPort | undefined): void;
  onEventNotificationsCreated(notifications: PostgresServerEventNotificationChannel): void;
}): Promise<ServerApiPorts> {
  if (!input.databaseUrl?.trim()) {
    return createSmokePorts();
  }
  if (!input.accessTokenSigner) {
    throw new Error('ACCESS_TOKEN_SECRET is required when DATABASE_URL is configured');
  }
  // Vor der Datenbank: ein unbrauchbarer Schluessel soll scheitern, bevor
  // irgendeine Verbindung offen ist.
  const masterKey = input.masterKey?.trim()
    ? parseBase64MasterKey(input.masterKey)
    : undefined;
  const db = await (input.createDatabase ?? createPostgresDatabase)({
    databaseUrl: input.databaseUrl,
  });
  // Und vor dem Benachrichtigungskanal: der haelt eine dauerhafte
  // LISTEN-Verbindung offen. Bricht die Pruefung danach ab, kaeme startServer
  // nie bis zum Aufraeumen, der Einstiegspunkt setzt nur process.exitCode — und
  // das offene Socket haelt Node am Leben. Der Container haenge dann, statt zu
  // beenden und von `restart: unless-stopped` neu gestartet zu werden.
  try {
    await assertMasterKeyMatchesDatabase(db, masterKey);
  } catch (error) {
    await db.destroy().catch(() => undefined);
    throw error;
  }
  const eventNotifications = await (
    input.createEventNotifications ?? createPostgresServerEventNotificationChannel
  )({
    databaseUrl: input.databaseUrl,
  });
  const secrets = masterKey
    ? createPostgresSecretPort({
      db,
      key: masterKey,
    })
    : undefined;
  input.onDatabaseCreated(db);
  input.onSecretsCreated(secrets);
  input.onEventNotificationsCreated(eventNotifications);
  return createPostgresServerApiPorts({
    db,
    accessTokenSigner: input.accessTokenSigner,
    attachmentsRoot: input.attachmentsRoot,
    auditArchiveRoot: input.auditArchiveRoot,
    databaseUrl: input.databaseUrl,
    backupDir: input.backupDir,
    appVersion: input.appVersion,
    authInvitationMail: input.authInvitationMail,
    turnstileSiteKey: input.turnstileSiteKey,
    turnstileSecretKey: input.turnstileSecretKey,
    emailTrackingIpIntelligence: input.emailTrackingIpIntelligence,
    publicBaseUrl: input.publicBaseUrl,
    masterKey: masterKey?.bytes,
    events: createPostgresServerEventPort({ db, notifications: eventNotifications }),
    secrets,
  });
}

async function startConfiguredJobWorker(input: {
  env: ServerEditionEnv;
  databaseUrl?: string;
  options?: Partial<ServerJobWorkerConfig>;
  handlers: JobHandlerRegistry;
  mailAccess: ServerApiPorts['mailAccess'];
  mailResourceLookup: ServerApiPorts['mailResourceLookup'];
  auth: ServerApiPorts['auth'];
  createGraphileQueue?: (options: { connectionString: string; migrateOnStart?: boolean }) => Promise<GraphileQueuePort>;
  createJobWorker?: typeof startGraphileWorkerRuntime;
}): Promise<GraphileWorkerRuntime | undefined> {
  const envConfig = parseServerJobWorkerConfig(input.env);
  const config: ServerJobWorkerConfig = {
    enabled: input.options?.enabled ?? envConfig.enabled,
    mailAccountCount: input.options?.mailAccountCount ?? envConfig.mailAccountCount,
    aiConcurrency: input.options?.aiConcurrency ?? envConfig.aiConcurrency,
    migrateOnStart: input.options?.migrateOnStart ?? envConfig.migrateOnStart,
  };

  if (!config.enabled) return undefined;
  if (!input.databaseUrl?.trim()) {
    throw new Error('DATABASE_URL is required when JOB_WORKER_ENABLED is true');
  }

  if (config.migrateOnStart) {
    const queue = await (input.createGraphileQueue ?? createGraphileQueuePort)({
      connectionString: input.databaseUrl,
    });
    try {
      await queue.migrate();
    } finally {
      await queue.release();
    }
  }

  return (input.createJobWorker ?? startGraphileWorkerRuntime)({
    connectionString: input.databaseUrl,
    handlers: input.handlers,
    concurrency: {
      mailAccountCount: config.mailAccountCount,
      aiConcurrency: config.aiConcurrency,
    },
    mailAccess: input.mailAccess,
    mailResourceLookup: input.mailResourceLookup,
    auth: input.auth,
  });
}

type RelayEmailTrackingPipeline = Pick<
  EmailTrackingService,
  'prepareOutbound' | 'recordSending' | 'recordSmtpAccepted' | 'recordSmtpFailed'
>;

/**
 * `ports.emailTracking` is typed as the narrower API port; the instance built
 * by createPostgresServerApiPorts is the full tracking service. Narrow at
 * runtime so injected fakes without the outbound hooks simply mean "untracked".
 */
function relayEmailTrackingFromPort(
  port: ServerApiPorts['emailTracking'],
): RelayEmailTrackingPipeline | null {
  if (!port) return null;
  const candidate = port as Partial<EmailTrackingService>;
  return typeof candidate.prepareOutbound === 'function'
    && typeof candidate.recordSending === 'function'
    && typeof candidate.recordSmtpAccepted === 'function'
    && typeof candidate.recordSmtpFailed === 'function'
    ? candidate as RelayEmailTrackingPipeline
    : null;
}

/**
 * Start the inbound SMTP relay listeners when SMTP_RELAY_ENABLED is set. Any
 * configuration problem (missing/unreadable TLS material, occupied port) is
 * logged and skips the relay WITHOUT crashing the API server. Tracking is not
 * required: without the email tracking service (PUBLIC_BASE_URL + master key)
 * relayed mail simply goes out untracked.
 */
async function startConfiguredInboundSmtpService(input: {
  env: ServerEditionEnv;
  db: Kysely<ServerDatabase>;
  secrets: PostgresSecretPort | undefined;
  emailTracking: ServerApiPorts['emailTracking'];
}): Promise<InboundSmtpService | undefined> {
  const config = parseSmtpRelayServerConfig(input.env);
  if (!config.enabled) return undefined;
  if (!config.tlsCertFile || !config.tlsKeyFile) {
    console.error('[smtp-relay] SMTP_RELAY_ENABLED is set but SMTP_RELAY_TLS_CERT_FILE/SMTP_RELAY_TLS_KEY_FILE are not configured; relay not started');
    return undefined;
  }
  let tlsCert: Buffer;
  let tlsKey: Buffer;
  try {
    tlsCert = readFileSync(config.tlsCertFile);
    tlsKey = readFileSync(config.tlsKeyFile);
  } catch (error) {
    console.error(`[smtp-relay] TLS key/cert could not be read (${error instanceof Error ? error.message : String(error)}); relay not started`);
    return undefined;
  }
  if (!input.secrets) {
    // Without the secret store the pipeline cannot resolve a routing account's
    // SMTP credentials, so EVERY accepted message would fail the send with a
    // retryable 451 and external systems would retry forever. Refuse to start
    // AUTH-capable listeners at all in that state rather than accept mail we
    // can never deliver.
    console.error('[smtp-relay] SMTP_RELAY_ENABLED is set but the secret store is not configured (SIMPLECRM_MASTER_KEY); relay not started — routing accounts need their SMTP credentials from the secret store');
    return undefined;
  }
  const secrets = input.secrets;

  const relayPort = createPostgresSmtpRelayPort({ db: input.db });
  const emailTracking = relayEmailTrackingFromPort(input.emailTracking);
  if (!emailTracking) {
    console.warn('[smtp-relay] email tracking service is not configured (PUBLIC_BASE_URL + SIMPLECRM_MASTER_KEY); relayed messages are sent untracked');
  }
  const pipeline = createRelaySubmissionPipeline({
    db: input.db,
    relayPort,
    emailTracking,
    sentCopyAppender: createPostgresServerImapSentCopyAppenderPort({
      db: input.db,
      secrets,
    }),
    readSecret: secrets.readSecret.bind(secrets),
    writeSecret: secrets.writeSecret.bind(secrets),
  });

  try {
    return await startInboundSmtpService({
      relayPort,
      submitRelay: pipeline.submitRelay,
      ...(config.hostname ? { hostname: config.hostname } : {}),
      portSubmission: config.portSubmission,
      portSmtps: config.portSmtps,
      bindHost: config.bindHost,
      tlsKey,
      tlsCert,
      maxMessageBytes: config.maxMessageBytes,
      maxConnections: config.maxConnections,
      socketTimeoutMs: config.socketTimeoutMs,
    });
  } catch (error) {
    console.error(`[smtp-relay] inbound SMTP listeners could not be started (${error instanceof Error ? error.message : String(error)}); relay not started`);
    return undefined;
  }
}

async function closeServerResources(
  jobWorker: GraphileWorkerRuntime | undefined,
  postgresJobQueueWorker: PostgresJobQueueWorkerRuntime | undefined,
  db: Kysely<ServerDatabase> | undefined,
  eventNotifications: PostgresServerEventNotificationChannel | undefined,
  apiJobQueue?: GraphileQueuePort,
): Promise<void> {
  try {
    try {
      try {
        try {
          await postgresJobQueueWorker?.stop();
        } finally {
          await jobWorker?.stop();
        }
      } finally {
        await apiJobQueue?.release();
      }
    } finally {
      await eventNotifications?.close?.();
    }
  } finally {
    await db?.destroy();
  }
}

function buildServerJobHandlers(input: {
  db: Kysely<ServerDatabase> | undefined;
  secrets: PostgresSecretPort | undefined;
  ports: ServerApiPorts;
  attachmentsRoot: string;
  auditArchiveRoot: string | undefined;
  webhookAllowlist: string | undefined;
  jobServices?: ProductionJobHandlersOptions;
  extraHandlers?: JobHandlerRegistry;
}): JobHandlerRegistry {
  const { db, secrets, ports, attachmentsRoot, auditArchiveRoot, webhookAllowlist, jobServices, extraHandlers } = input;
  return mergeJobHandlerRegistries(
    mergeJobHandlerRegistries(
      mergeJobHandlerRegistries(
        mergeJobHandlerRegistries(
          db ? createMaintenanceJobHandlers({
            db,
            // Volle Charge => naechste nachschieben, sonst deckelt der Takt den
            // Durchsatz auf `limit` Zeilen je Intervall (Begruendung dort).
            ...(ports.jobQueue ? { requeue: ports.jobQueue } : {}),
            ...(auditArchiveRoot ? {
              auditArchive: createJsonlAuditRetentionArchivePort({ rootDir: auditArchiveRoot }),
            } : {}),
          }) : {},
          createSpamScoringJobHandlers({
            emailMessages: ports.emailMessages,
            ...(db && ports.jobQueue ? { db, jobQueue: ports.jobQueue } : {}),
          }),
        ),
        createWebhookJobHandlers({
          ...(webhookAllowlist ? {
            dispatcher: createFetchWebhookDispatchPort({ allowlist: webhookAllowlist }),
          } : {}),
        }),
      ),
      createProductionJobHandlers({
        ...(db && ports.emailComposeSender ? {
          scheduledSend: createPostgresScheduledSendJobPort({
            db,
            composeSender: ports.emailComposeSender,
          }),
        } : {}),
        ...(db ? {
          workflowExecution: createPostgresWorkflowExecutionJobPort({
            db,
            mssql: createPostgresMssqlSettingsPort({ db, secrets }),
            workflowImapActions: createPostgresWorkflowImapActionPort({ db, secrets }),
            secrets,
            // Auch der Job-Worker invalidiert nach Tag-/Kategorie-Schreibungen.
            // Beides stammt aus denselben ports wie im API-Pfad.
            ...(ports.mailAccess ? { mailAccess: ports.mailAccess } : {}),
            ...(ports.events ? { events: ports.events } : {}),
          }),
          workflowForwardCopy: createPostgresWorkflowForwardCopyPort({
            db,
            secrets,
            attachmentsRoot,
            ...(ports.emailComposeSender ? { composeSender: ports.emailComposeSender } : {}),
          }),
          workflowDmarcIngest: createPostgresWorkflowDmarcIngestPort({
            db,
            attachmentsRoot,
          }),
          workflowHttpRequest: createPostgresWorkflowHttpRequestPort({ db }),
        } : {}),
        ...(ports.aiReplySuggestions ? {
          aiReplySuggestion: ports.aiReplySuggestions,
        } : {}),
        ...(db ? {
          aiAgent: createPostgresAiAgentPort({ db, secrets }),
          aiPickCanned: createPostgresAiPickCannedPort({ db, secrets }),
          aiClassification: createPostgresAiClassificationPort({
            db,
            secrets,
            // Die Klassifizierung schreibt ki:<label>-Tags — dieselbe
            // Sichtbarkeitsfrage wie im Workflow-Worker.
            ...(ports.mailAccess ? { mailAccess: ports.mailAccess } : {}),
            ...(ports.events ? { events: ports.events } : {}),
          }),
          aiReview: createPostgresAiReviewPort({ db, secrets }),
          aiTransformText: createPostgresAiTransformTextPort({ db, secrets }),
          ...(secrets ? {
            aiDraftReply: createPostgresAiDraftReplyPort({ db, secrets }),
            aiReviewDraft: createPostgresAiReviewDraftPort({ db, secrets }),
          } : {}),
        } : {}),
        ...(db && ports.jobQueue ? {
          mailSync: createPostgresMailSyncJobPort({
            db,
            secrets,
            attachmentsRoot,
            ...(ports.emailTracking?.recordInboundEvidence ? {
              inboundEvidence: { recordInboundEvidence: ports.emailTracking.recordInboundEvidence },
            } : {}),
          }),
          mailSyncPostProcess: createPostgresMailSyncPostProcessor({
            db,
            jobQueue: ports.jobQueue,
          }),
          mailVacationAutoReply: createPostgresEmailVacationAutoReplyPort({
            db,
            secrets,
          }),
        } : {}),
        ...(jobServices ?? {}),
      }),
    ),
    extraHandlers ?? {},
  );
}

if (require.main === module) {
  void startServer().catch((error) => {
    process.stderr.write(`SimpleCRM server failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
