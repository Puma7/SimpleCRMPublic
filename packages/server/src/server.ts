import type { FastifyInstance } from 'fastify';
import type { Kysely } from 'kysely';

import {
  createFastifyServer,
  type ServerApiPorts,
} from './api';
import {
  parseAuthInvitationMailConfig,
  parsePort,
  parseServerJobWorkerConfig,
  type AuthInvitationMailConfig,
  type ServerEditionEnv,
  type ServerJobWorkerConfig,
} from './config';
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
  createPostgresDashboardPort,
  createPostgresDealProductPort,
  createPostgresDealReadPort,
  createPostgresDatabase,
  createPostgresEmailAccountReadPort,
  createPostgresEmailAccountSignatureReadPort,
  createPostgresEmailAttachmentContentPort,
  createPostgresEmailAttachmentReadPort,
  createPostgresEmailCannedResponseReadPort,
  createPostgresEmailCategoryReadPort,
  createPostgresEmailReportingPort,
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
  createPostgresSyncInfoPort,
  createPostgresWorkflowDelayedJobReadPort,
  createPostgresWorkflowForwardDedupReadPort,
  createPostgresWorkflowKnowledgeBaseReadPort,
  createPostgresWorkflowKnowledgeChunkReadPort,
  createPostgresWorkflowMessageAppliedReadPort,
  createPostgresWorkflowReadPort,
  createPostgresWorkflowRunReadPort,
  createPostgresWorkflowRunStepReadPort,
  createPostgresWorkflowVersionReadPort,
  createPostgresTaskReadPort,
  type PostgresServerEventNotificationChannel,
  type PostgresSecretPort,
  type ServerDatabase,
} from './db';
import {
  createGraphileQueuePort,
  createJsonlAuditRetentionArchivePort,
  createFetchWebhookDispatchPort,
  createMaintenanceJobHandlers,
  createProductionJobHandlers,
  createSpamScoringJobHandlers,
  createWebhookJobHandlers,
  mergeJobHandlerRegistries,
  startGraphileWorkerRuntime,
  type GraphileQueuePort,
  type GraphileWorkerRuntime,
  type JobHandlerRegistry,
  type ProductionJobHandlersOptions,
} from './jobs';
import {
  accessTokenSignerFromBase64,
  parseBase64MasterKey,
  type AccessTokenSigner,
} from './security';
import { createAuthInvitationMailerPort } from './auth-invitation-mailer';
import { createPostgresAiReplySuggestionPort } from './ai-reply-suggestion';
import {
  createPostgresAiAgentPort,
  createPostgresAiClassificationPort,
  createPostgresAiReviewPort,
  createPostgresAiTextTransformApiPort,
  createPostgresAiTransformTextPort,
} from './ai-classification';
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
import { createPostgresServerImapSentCopyAppenderPort } from './mail-imap-append';
import { createPostgresEmailReadReceiptResponderPort } from './mail-read-receipt-responder';
import { createPostgresScheduledSendJobPort } from './mail-scheduled-send';
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
import { createPostgresWorkflowForwardCopyPort } from './workflow-forward-copy';
import { createPostgresWorkflowHttpRequestPort } from './workflow-http-request';
import { createPostgresWorkflowImapActionPort } from './workflow-imap-actions';
import { createStaticWorkflowNodeCatalogPort } from './workflow-node-catalog';
import { createStaticWorkflowTemplatePort } from './workflow-templates';

export type PostgresServerApiPortsOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  accessTokenSigner: AccessTokenSigner;
  attachmentsRoot?: string;
  events?: ServerApiPorts['events'];
  jobQueue?: ServerApiPorts['jobQueue'];
  secrets?: PostgresSecretPort;
  authInvitationMail?: AuthInvitationMailConfig;
  rspamdFetch?: typeof fetch;
}>;

export type ServerListenOptions = Readonly<{
  host?: string;
  port?: number;
  ports?: ServerApiPorts;
  env?: ServerEditionEnv;
  databaseUrl?: string;
  createDatabase?: (options: { databaseUrl: string }) => Promise<Kysely<ServerDatabase>>;
  logger?: boolean;
  accessTokenSigner?: AccessTokenSigner;
  jobWorker?: Partial<ServerJobWorkerConfig>;
  jobHandlers?: JobHandlerRegistry;
  jobServices?: ProductionJobHandlersOptions;
  createGraphileQueue?: (options: { connectionString: string; migrateOnStart?: boolean }) => Promise<GraphileQueuePort>;
  createJobWorker?: typeof startGraphileWorkerRuntime;
  createEventNotifications?: (options: { databaseUrl: string }) => Promise<PostgresServerEventNotificationChannel>;
}>;

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
  const attachmentsRoot = env.ATTACHMENTS_DIR?.trim() || '/app/data/attachments';
  const auditArchiveRoot = env.AUDIT_ARCHIVE_DIR?.trim();
  const authInvitationMail = parseAuthInvitationMailConfig(env);
  const webhookAllowlist = env.JOB_WEBHOOK_ALLOWLIST?.trim();
  let db: Kysely<ServerDatabase> | undefined;
  let secrets: PostgresSecretPort | undefined;
  let apiJobQueue: GraphileQueuePort | undefined;
  let jobWorker: GraphileWorkerRuntime | undefined;
  let eventNotifications: PostgresServerEventNotificationChannel | undefined;
  const ports = options.ports ?? await createDefaultServerPorts({
    databaseUrl,
    accessTokenSigner,
    attachmentsRoot,
    createDatabase: options.createDatabase,
    createEventNotifications: options.createEventNotifications,
    masterKey: env.SIMPLECRM_MASTER_KEY,
    authInvitationMail,
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
      }
    } catch (error) {
      await closeServerResources(jobWorker, db, eventNotifications, apiJobQueue);
      throw error;
    }
  }

  const app = createFastifyServer({
    ports,
    accessTokenSigner,
    logger: options.logger ?? true,
  });

  app.addHook('onClose', async () => {
    await closeServerResources(jobWorker, db, eventNotifications, apiJobQueue);
  });

  try {
    jobWorker = await startConfiguredJobWorker({
      env,
      databaseUrl,
      options: options.jobWorker,
      handlers: mergeJobHandlerRegistries(
        mergeJobHandlerRegistries(
          mergeJobHandlerRegistries(
            mergeJobHandlerRegistries(
              db ? createMaintenanceJobHandlers({
                db,
                ...(auditArchiveRoot ? {
                  auditArchive: createJsonlAuditRetentionArchivePort({ rootDir: auditArchiveRoot }),
                } : {}),
              }) : {},
              createSpamScoringJobHandlers({ emailMessages: ports.emailMessages }),
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
              }),
              workflowForwardCopy: createPostgresWorkflowForwardCopyPort({ db, secrets }),
              workflowHttpRequest: createPostgresWorkflowHttpRequestPort({ db }),
            } : {}),
            ...(ports.aiReplySuggestions ? {
              aiReplySuggestion: ports.aiReplySuggestions,
            } : {}),
            ...(db ? {
              aiAgent: createPostgresAiAgentPort({ db, secrets }),
              aiClassification: createPostgresAiClassificationPort({ db, secrets }),
              aiReview: createPostgresAiReviewPort({ db, secrets }),
              aiTransformText: createPostgresAiTransformTextPort({ db, secrets }),
            } : {}),
            ...(db && ports.jobQueue ? {
              mailSync: createPostgresMailSyncJobPort({
                db,
                secrets,
                attachmentsRoot,
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
            ...(options.jobServices ?? {}),
          }),
        ),
        options.jobHandlers ?? {},
      ),
      createGraphileQueue: options.createGraphileQueue,
      createJobWorker: options.createJobWorker,
    });
    await app.listen({ host, port });
  } catch (error) {
    await closeServerResources(jobWorker, db, eventNotifications, apiJobQueue);
    throw error;
  }

  return app;
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
  const workflowExecution = createPostgresWorkflowExecutionJobPort({
    db: options.db,
    mssql: createPostgresMssqlSettingsPort({ db: options.db, secrets: options.secrets }),
    workflowImapActions,
  });
  return {
    activityLog: createPostgresActivityLogReadPort({ db: options.db }),
    aiReplySuggestions: createPostgresAiReplySuggestionPort({ db: options.db, secrets: options.secrets }),
    aiProfiles: createPostgresAiProfileReadPort({ db: options.db, secrets: options.secrets }),
    aiPrompts: createPostgresAiPromptReadPort({ db: options.db }),
    aiTextTransform: createPostgresAiTextTransformApiPort({ db: options.db, secrets: options.secrets }),
    automationApiKeys: createPostgresAutomationApiKeyReadPort({ db: options.db, secrets: options.secrets }),
    calendarEvents: createPostgresCalendarEventReadPort({ db: options.db }),
    auth: createPostgresAuthPort({
      db: options.db,
      accessTokenSigner: options.accessTokenSigner,
    }),
    ...(options.authInvitationMail ? {
      authInvitationMailer: createAuthInvitationMailerPort(options.authInvitationMail),
    } : {}),
    locks: createPostgresConversationLockPort({ db: options.db }),
    audit: createPostgresAuditPort({ db: options.db }),
    mssqlSettings: createPostgresMssqlSettingsPort({ db: options.db, secrets: options.secrets }),
    customerCustomFields: createPostgresCustomerCustomFieldReadPort({ db: options.db }),
    customerCustomFieldValues: createPostgresCustomerCustomFieldValueReadPort({ db: options.db }),
    customers: createPostgresCustomerReadPort({ db: options.db }),
    dashboard: createPostgresDashboardPort({ db: options.db }),
    deals: createPostgresDealReadPort({ db: options.db }),
    dealProducts: createPostgresDealProductPort({ db: options.db }),
    emailAccounts: createPostgresEmailAccountReadPort({ db: options.db, secrets: options.secrets }),
    emailAccountSignatures: createPostgresEmailAccountSignatureReadPort({ db: options.db }),
    emailAttachmentContent: createPostgresEmailAttachmentContentPort({ db: options.db, attachmentsRoot }),
    emailAttachments: createPostgresEmailAttachmentReadPort({ db: options.db }),
    emailCannedResponses: createPostgresEmailCannedResponseReadPort({ db: options.db }),
    emailCategories: createPostgresEmailCategoryReadPort({ db: options.db }),
    emailComposeAttachments: createPostgresEmailComposeAttachmentUploadPort({ db: options.db, attachmentsRoot }),
    emailComposeSender: createPostgresEmailComposeSenderPort({
      db: options.db,
      attachmentsRoot,
      secrets: options.secrets,
      sentCopyAppend: sentCopyAppender.append,
      pgpMessages,
    }),
    emailOutboundValidation: createPostgresEmailOutboundValidationPort({ db: options.db }),
    emailDiagnostics: createPostgresMailDiagnosticsPort({ db: options.db, attachmentsRoot }),
    emailReporting: createPostgresEmailReportingPort({ db: options.db }),
    emailFolders: createPostgresEmailFolderReadPort({ db: options.db }),
    emailGdprExport: createPostgresEmailGdprExportPort({ db: options.db, attachmentsRoot }),
    emailInternalNotes: createPostgresEmailInternalNoteReadPort({ db: options.db }),
    emailMessageCategories: createPostgresEmailMessageCategoryReadPort({ db: options.db }),
    emailMessages: createPostgresEmailMessageReadPort({
      db: options.db,
      rspamdFetch: options.rspamdFetch,
      seenFlagSync: workflowImapActions,
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
    events: options.events ?? createPostgresServerEventPort({ db: options.db }),
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
    syncInfo: createPostgresSyncInfoPort({ db: options.db }),
    tasks: createPostgresTaskReadPort({ db: options.db }),
    workflowDelayedJobs: createPostgresWorkflowDelayedJobReadPort({ db: options.db }),
    workflowExecution: {
      dryRun: (input) => workflowExecution.dryRun!(input),
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

function accessTokenSignerFromEnv(env: ServerEditionEnv): AccessTokenSigner | undefined {
  const secret = env.ACCESS_TOKEN_SECRET;
  if (!secret) return undefined;
  return accessTokenSignerFromBase64(secret, env.ACCESS_TOKEN_KEY_ID ?? 'default');
}

async function createDefaultServerPorts(input: {
  databaseUrl?: string;
  accessTokenSigner?: AccessTokenSigner;
  attachmentsRoot?: string;
  createDatabase?: (options: { databaseUrl: string }) => Promise<Kysely<ServerDatabase>>;
  createEventNotifications?: (options: { databaseUrl: string }) => Promise<PostgresServerEventNotificationChannel>;
  masterKey?: string;
  authInvitationMail?: AuthInvitationMailConfig;
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
  const db = await (input.createDatabase ?? createPostgresDatabase)({
    databaseUrl: input.databaseUrl,
  });
  const eventNotifications = await (
    input.createEventNotifications ?? createPostgresServerEventNotificationChannel
  )({
    databaseUrl: input.databaseUrl,
  });
  const secrets = input.masterKey?.trim()
    ? createPostgresSecretPort({
      db,
      key: parseBase64MasterKey(input.masterKey),
    })
    : undefined;
  input.onDatabaseCreated(db);
  input.onSecretsCreated(secrets);
  input.onEventNotificationsCreated(eventNotifications);
  return createPostgresServerApiPorts({
    db,
    accessTokenSigner: input.accessTokenSigner,
    attachmentsRoot: input.attachmentsRoot,
    authInvitationMail: input.authInvitationMail,
    events: createPostgresServerEventPort({ db, notifications: eventNotifications }),
    secrets,
  });
}

async function startConfiguredJobWorker(input: {
  env: ServerEditionEnv;
  databaseUrl?: string;
  options?: Partial<ServerJobWorkerConfig>;
  handlers: JobHandlerRegistry;
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
  });
}

async function closeServerResources(
  jobWorker: GraphileWorkerRuntime | undefined,
  db: Kysely<ServerDatabase> | undefined,
  eventNotifications: PostgresServerEventNotificationChannel | undefined,
  apiJobQueue?: GraphileQueuePort,
): Promise<void> {
  try {
    try {
      try {
        await jobWorker?.stop();
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

if (require.main === module) {
  void startServer().catch((error) => {
    process.stderr.write(`SimpleCRM server failed to start: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
