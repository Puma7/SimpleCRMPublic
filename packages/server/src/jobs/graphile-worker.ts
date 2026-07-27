import {
  assertServerJobType,
  buildTrustedServiceJobPayload,
  calculateMailSyncPoolSize,
  normalizeAiJobConcurrency,
  normalizeMaxAttempts,
  SERVER_JOB_TYPES,
  type ServerJobType,
} from './policy';
import type { EnqueueJobInput, JobPayload, QueuedJob } from './types';
import { scheduledSendDraftIdFromPayload, scheduledSendJobKey } from './scheduled-send-job-key';
import type { JobHandlerRegistry } from './worker';
import {
  enforceMailJobPolicy,
  type MailAsyncPolicyPorts,
} from '../mail-access/async-policy-enforcer';

export type GraphileTaskSpec = Readonly<{
  queueName?: string;
  runAt?: Date;
  maxAttempts?: number;
  jobKey?: string;
  jobKeyMode?: 'replace' | 'preserve_run_at' | 'unsafe_dedupe';
  priority?: number;
  flags?: string[];
}>;

export type GraphileWorkerUtilsPort = Readonly<{
  addJob(identifier: string, payload: JobPayload, spec?: GraphileTaskSpec): Promise<unknown>;
  release(): Promise<void> | void;
  migrate?(): Promise<void>;
}>;

export type GraphileWorkerRuntime = Readonly<{
  stop(): Promise<void>;
  promise: Promise<void>;
}>;

export type GraphileWorkerFactory = (options: {
  connectionString: string;
  concurrentJobs: number;
  taskList: Record<string, (payload: unknown, helpers?: GraphileJobHelpers) => Promise<void>>;
}) => Promise<GraphileWorkerRuntime>;

export type GraphileJobHelpers = Readonly<{
  job?: Readonly<{
    id?: string | number;
    attempts?: number;
    max_attempts?: number;
  }>;
  withPgClient?: (callback: (client: {
    query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
  }) => Promise<unknown>) => Promise<unknown>;
  addJob?: (
    identifier: string,
    payload: JobPayload,
    spec?: GraphileTaskSpec,
  ) => Promise<unknown>;
}>;

export type GraphileWorkerUtilsFactory = (options: {
  connectionString: string;
}) => Promise<GraphileWorkerUtilsPort>;

export type GraphileQueuePort = Readonly<{
  enqueue(input: EnqueueJobInput): Promise<void>;
  clearScheduledSendJob?(input: {
    workspaceId: string;
    draftId: number;
  }): Promise<void>;
  release(): Promise<void>;
  migrate(): Promise<void>;
}>;

export type GraphileWorkerPlan = Readonly<{
  connectionString: string;
  concurrentJobs: number;
  taskTypes: readonly ServerJobType[];
}>;

export type GraphileWorkerConcurrencyInput = Readonly<{
  mailAccountCount: number;
  aiConcurrency?: number;
}>;

export async function createGraphileQueuePort(input: {
  connectionString: string;
  createUtils?: GraphileWorkerUtilsFactory;
  migrateOnStart?: boolean;
}): Promise<GraphileQueuePort> {
  if (!input.connectionString.trim()) {
    throw new Error('connectionString is required for Graphile Worker queue');
  }
  const utils = await (input.createUtils ?? createDefaultGraphileWorkerUtils)({
    connectionString: input.connectionString,
  });
  if (input.migrateOnStart) {
    await utils.migrate?.();
  }

  return {
    async enqueue(job) {
      const type = assertServerJobType(job.type);
      await utils.addJob(type, job.payload, graphileSpecFromJob(job));
    },
    async clearScheduledSendJob(input) {
      const jobKey = scheduledSendJobKey(input.workspaceId, input.draftId);
      if (!jobKey) return;
      const withPgClient = (utils as { withPgClient?: (callback: (client: {
        query: (sql: string, values?: readonly unknown[]) => Promise<unknown>;
      }) => Promise<void>) => Promise<void> }).withPgClient;
      if (!withPgClient) return;
      await withPgClient(async (client) => {
        await client.query('select graphile_worker.remove_job($1)', [jobKey]);
      });
    },
    async migrate() {
      await utils.migrate?.();
    },
    async release() {
      await utils.release();
    },
  };
}

export async function startGraphileWorkerRuntime(input: {
  connectionString: string;
  handlers: JobHandlerRegistry;
  concurrency: GraphileWorkerConcurrencyInput;
  createWorker?: GraphileWorkerFactory;
  mailAccess?: MailAsyncPolicyPorts['mailAccess'];
  mailResourceLookup?: MailAsyncPolicyPorts['mailResourceLookup'];
  auth?: MailAsyncPolicyPorts['auth'];
}): Promise<GraphileWorkerRuntime> {
  const plan = buildGraphileWorkerPlan({
    connectionString: input.connectionString,
    concurrency: input.concurrency,
  });
  const taskList = buildGraphileTaskList(input.handlers, {
    mailAccess: input.mailAccess,
    mailResourceLookup: input.mailResourceLookup,
    auth: input.auth,
  });
  return (input.createWorker ?? createDefaultGraphileWorkerRuntime)({
    connectionString: plan.connectionString,
    concurrentJobs: plan.concurrentJobs,
    taskList,
  });
}

export function buildGraphileWorkerPlan(input: {
  connectionString: string;
  concurrency: GraphileWorkerConcurrencyInput;
}): GraphileWorkerPlan {
  if (!input.connectionString.trim()) {
    throw new Error('connectionString is required for Graphile Worker runtime');
  }
  const mailConcurrency = calculateMailSyncPoolSize(input.concurrency.mailAccountCount);
  const aiConcurrency = normalizeAiJobConcurrency(input.concurrency.aiConcurrency);

  return {
    connectionString: input.connectionString,
    concurrentJobs: Math.max(1, mailConcurrency + aiConcurrency),
    taskTypes: SERVER_JOB_TYPES,
  };
}

export function buildGraphileTaskList(
  handlers: JobHandlerRegistry,
  mailPolicyPorts: MailAsyncPolicyPorts = {},
): Record<string, (payload: unknown, helpers?: GraphileJobHelpers) => Promise<void>> {
  return Object.fromEntries(SERVER_JOB_TYPES.map((type) => [
    type,
    async (payload: unknown, helpers?: GraphileJobHelpers) => {
      const handler = handlers[type];
      if (!handler) {
        throw new Error(`No handler registered for job type ${type}`);
      }
      const normalizedPayload = normalizePayload(payload);
      const job: QueuedJob = {
        id: 0,
        type,
        payload: normalizedPayload,
        runAfter: new Date(0).toISOString(),
        attempts: 0,
        maxAttempts: 1,
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        workspaceId: workspaceIdFromPayload(payload),
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      };
      let mailAuthorization;
      try {
        mailAuthorization = await enforceMailJobPolicy(job, mailPolicyPorts);
      } catch (error) {
        // Do NOT swallow an authorization denial. For graphile-worker a resolved
        // task means "success", so `return` here deletes the job row with no
        // last_error and drops the side-effect (mail send, webhook, auto-reply)
        // without a trace. Rethrow so the failure is visible: graphile retries
        // and, after maxAttempts, keeps the row as permanently failed — mirroring
        // the legacy worker's failTerminal handling of MailAsyncAuthorizationError.
        await maybeAdvanceInboundChainAfterGraphileTerminalFailure(normalizedPayload, helpers);
        throw error;
      }
      try {
        await handler(mailAuthorization ? { ...job, mailAuthorization } : job);
      } catch (error) {
        await maybeAdvanceInboundChainAfterGraphileTerminalFailure(normalizedPayload, helpers);
        throw error;
      }
    },
  ]));
}

/**
 * When a Graphile job exhausts retries, advance the inbound priority chain the
 * same way postgres-job-queue-port failTerminal does. Without this, a failed
 * AI/HTTP child (or workflow.execute) strands later workflows forever.
 */
async function maybeAdvanceInboundChainAfterGraphileTerminalFailure(
  payload: JobPayload,
  helpers: GraphileJobHelpers | undefined,
): Promise<void> {
  // Graphile bumps `attempts` when claiming the job (before the handler runs).
  // Terminal = same predicate Graphile uses for job:failed (`attempts >= max_attempts`).
  const attempts = Number(helpers?.job?.attempts ?? 0);
  const maxAttempts = Number(helpers?.job?.max_attempts ?? 1);
  if (!(attempts >= maxAttempts)) return;

  const {
    completeInboundDeferredJoinSiblingOnPgClient,
    inboundChainFromJobPayload,
    inboundChainHopClaimKey,
    terminalChildCompletionKey,
    terminalInboundChildContext,
  } = await import('../workflow-inbound-chain-advance.js');
  // Auch ohne Kette (Inbound-Backfill/Reapply) muss die Join-Barriere abgebaut
  // werden — sonst haengt sie nach einem endgueltig gescheiterten Kindjob.
  // Weiterzuschalten gibt es dort nichts, deshalb bleibt `parsed` die Grundlage
  // fuer den Folge-Workflow.
  const target = terminalInboundChildContext(payload as Record<string, unknown>);
  if (!target) return;
  const parsed = inboundChainFromJobPayload(payload as Record<string, unknown>);
  const currentWorkflowId = target.workflowId;
  const nextIndex = parsed ? parsed.chain.index + 1 : 0;
  // Kein vorzeitiges return am letzten Kettenplatz: die Deferred-Join-Barriere
  // muss auch dann abgebaut werden, wenn es keinen Folge-Workflow zu enqueuen
  // gibt — sonst wartet ein erfolgreicher Geschwisterzweig dauerhaft an ihr.
  const nextWorkflowId = parsed && nextIndex < parsed.chain.workflowIds.length
    ? parsed.chain.workflowIds[nextIndex]
    : undefined;

  const nextPayload: JobPayload | null = nextWorkflowId == null || parsed === null
    ? null
    : parsed.actorUserId
      ? {
        workspaceId: parsed.workspaceId,
        actorUserId: parsed.actorUserId,
        workflowId: nextWorkflowId,
        messageId: parsed.messageId,
        triggerName: 'inbound',
        context: {
          inboundWorkflowChain: { workflowIds: parsed.chain.workflowIds, index: nextIndex },
        },
      }
      : buildTrustedServiceJobPayload({
        workspaceId: parsed.workspaceId,
        workflowId: nextWorkflowId,
        messageId: parsed.messageId,
        triggerName: 'inbound',
        context: {
          inboundWorkflowChain: { workflowIds: parsed.chain.workflowIds, index: nextIndex },
        },
      });

  const claimKey = nextPayload === null || parsed === null
    ? null
    : inboundChainHopClaimKey(parsed.messageId, parsed.chain, nextIndex);

  const graphileJobId = helpers?.job?.id;
  const advanceGuardKey = graphileJobId === undefined || graphileJobId === null
    ? null
    : `inbound_chain_terminal_advance:${String(graphileJobId)}`;

  try {
    // Prefer a single PG client so the hop claim + enqueue share one connection
    // (sibling terminal failures must not double-enqueue the next workflow).
    // FORCE RLS on sync_info requires app.workspace_id / app.role; set_config(..., true)
    // is transaction-local so wrap BEGIN/COMMIT (autocommit would discard settings).
    if (helpers?.withPgClient) {
      await helpers.withPgClient(async (client) => {
        await client.query('BEGIN');
        try {
          await client.query(
            `SELECT set_config('app.workspace_id', $1, true),
                    set_config('app.user_id', '', true),
                    set_config('app.role', 'system', true),
                    set_config('app.cross_workspace_access', 'off', true)`,
            [target.workspaceId],
          );
          // Idempotenz pro Graphile-Job. Anders als beim Legacy-Queue-Port
          // (postgres-job-queue-port failJob/failTerminal) läuft die
          // Kettenfortschaltung hier NICHT in derselben Transaktion, in der
          // Graphile den Job als failed festschreibt: dieser Block committet
          // zuerst, das throw danach. Stirbt der Prozess dazwischen, wird der
          // Job erneut geclaimt und der Block liefe ein zweites Mal — der
          // Join-Zähler würde doppelt dekrementiert und die Barriere zu früh
          // öffnen. Der Marker macht das Ganze einmalig. Ohne Job-ID (ältere
          // Helper/Tests) bleibt das Verhalten wie bisher.
          // Dieselbe Ausfuehrungsidentitaet wie der Erfolgsabschluss des
          // Kindjobs: hat der seinen Abschluss bereits committet und der Worker
          // starb vor der Graphile-Bestaetigung, darf der spaetere endgueltige
          // Fehlschlag die Join-Barriere NICHT ein zweites Mal dekrementieren.
          // Die Schranke pro Graphile-Job allein deckt das nicht ab.
          const completionKey = terminalChildCompletionKey(payload as Record<string, unknown>);
          if (completionKey) {
            const firstCompletion = asPgResult(await client.query(
              `INSERT INTO sync_info (
                 workspace_id, key, value, last_updated, source_row, imported_in_run_id, updated_at
               ) VALUES ($1, $2, '1', now(), $3::jsonb, null, now())
               ON CONFLICT (workspace_id, key) DO NOTHING
               RETURNING key`,
              [
                target.workspaceId,
                completionKey,
                JSON.stringify({ origin: 'inbound_terminal_child' }),
              ],
            ));
            if (!firstCompletion.rowCount) {
              await client.query('COMMIT');
              return;
            }
          }
          if (advanceGuardKey) {
            const firstRun = asPgResult(await client.query(
              `INSERT INTO sync_info (
                 workspace_id, key, value, last_updated, source_row, imported_in_run_id, updated_at
               ) VALUES ($1, $2, '1', now(), $3::jsonb, null, now())
               ON CONFLICT (workspace_id, key) DO NOTHING
               RETURNING key`,
              [
                target.workspaceId,
                advanceGuardKey,
                JSON.stringify({ origin: 'inbound_chain_terminal_advance' }),
              ],
            ));
            if (!firstRun.rowCount) {
              await client.query('COMMIT');
              return;
            }
          }
          const join = await completeInboundDeferredJoinSiblingOnPgClient(client, {
            workspaceId: target.workspaceId,
            messageId: target.messageId,
            workflowId: currentWorkflowId,
            chain: target.chain,
            fanOutRunId: target.fanOutRunId,
            chainStop: false,
            // Endgueltiger Fehlschlag: ueber die Barriere sichtbar halten, sonst
            // markiert ein spaeter fertiger Geschwisterzweig den unvollstaendig
            // gelaufenen Workflow als angewendet.
            error: true,
            now: new Date(),
          });
          // 'ready_error' zaehlt hier ebenfalls als fortschaltbar: der Job ist
          // endgueltig gescheitert, die Kette darf nicht stehen bleiben.
          if (join !== 'ready' && join !== 'ready_error') {
            await client.query('COMMIT');
            return;
          }
          if (nextPayload === null || claimKey === null) {
            // Letzter Kettenplatz: Barriere ist abgebaut, nichts mehr zu enqueuen.
            await client.query('COMMIT');
            return;
          }
          const claimed = asPgResult(await client.query(
            `INSERT INTO sync_info (
               workspace_id, key, value, last_updated, source_row, imported_in_run_id, updated_at
             ) VALUES ($1, $2, '1', now(), $3::jsonb, null, now())
             ON CONFLICT (workspace_id, key) DO NOTHING
             RETURNING key`,
            [
              target.workspaceId,
              claimKey,
              JSON.stringify({ origin: 'inbound_chain_hop' }),
            ],
          ));
          if (!claimed.rowCount) {
            await client.query('COMMIT');
            return;
          }
          await client.query(
            `SELECT graphile_worker.add_job(
               $1::text,
               $2::json,
               'workflow',
               now(),
               3
             )`,
            ['workflow.execute', JSON.stringify(nextPayload)],
          );
          await client.query('COMMIT');
        } catch (inner) {
          try {
            await client.query('ROLLBACK');
          } catch {
            // ignore rollback errors
          }
          throw inner;
        }
      });
      return;
    }
    // Test helpers without withPgClient: best-effort enqueue (no claim available).
    if (helpers?.addJob && nextPayload) {
      await helpers.addJob('workflow.execute', nextPayload, {
        maxAttempts: 3,
        queueName: 'workflow',
      });
    }
  } catch (advanceErr) {
    // Never mask the original job failure if chain advance itself fails.
    console.error('[graphile-worker] inbound chain advance after terminal failure failed', advanceErr);
  }
}

function asPgResult(value: unknown): { rowCount?: number | null } {
  if (!value || typeof value !== 'object') return {};
  return value as { rowCount?: number | null };
}

export function graphileSpecFromJob(input: EnqueueJobInput): GraphileTaskSpec {
  const type = assertServerJobType(input.type);
  return {
    queueName: graphileQueueNameForJob(type, input.payload),
    runAt: input.runAfter,
    maxAttempts: normalizeMaxAttempts(input.maxAttempts),
    jobKey: graphileJobKeyForJob(type, input.payload, input.workspaceId),
    jobKeyMode: 'replace',
  };
}

export function graphileQueueNameForJob(type: ServerJobType, payload: JobPayload): string | undefined {
  const accountId = graphileKeyScalar(payload.accountId);
  if ((type === 'mail.sync.imap' || type === 'mail.sync.pop3') && accountId) {
    return `account-${accountId}`;
  }
  if (
    type === 'ai.reply_suggestion'
    || type === 'ai.agent'
    || type === 'ai.classify'
    || type === 'ai.review'
    || type === 'ai.draft_reply'
    || type === 'ai.review_draft'
    || type === 'ai.transform_text'
  ) {
    return 'ai';
  }
  if (type === 'mail.spam.score') {
    return 'spam';
  }
  if (type === 'mail.vacation.auto_reply') {
    return 'mail';
  }
  if (type === 'webhook.fire') {
    return 'webhook';
  }
  if (
    type === 'workflow.execute'
    || type === 'workflow.http_request'
    || type === 'workflow.forward_copy'
    || type === 'workflow.dmarc_ingest'
  ) {
    return 'workflow';
  }
  return undefined;
}

/**
 * Knoten-Diskriminante fuer den Job-Key eines KI-Kindjobs.
 *
 * Ein TERMINALER Knoten hat keine `resumeNodeId`. Ohne eigene Diskriminante
 * fielen zwei terminale Zweige derselben Nachricht auf denselben Key und
 * jobKeyMode 'replace' verschluckte einen davon — der Elternlauf bliebe
 * dauerhaft deferred, weil nur der ueberlebende Kindjob den Kettenabschluss
 * ausfuehrt.
 */
function graphileChildNodeKeyPart(payload: JobPayload): string | undefined {
  return graphileKeyScalar(payload.resumeNodeId)
    ?? (payload.terminalWorkflowCompletion === true
      ? graphileKeyScalar(payload.terminalNodeId)
      : undefined);
}

export function graphileJobKeyForJob(
  type: ServerJobType,
  payload: JobPayload,
  workspaceId?: string,
): string | undefined {
  const accountId = graphileKeyScalar(payload.accountId);
  const workspaceKey = graphileKeyScalar(workspaceId) ?? graphileKeyScalar(payload.workspaceId);
  if ((type === 'mail.sync.imap' || type === 'mail.sync.pop3') && accountId && workspaceKey) {
    return `${type}:${workspaceKey}:${accountId}`;
  }
  if (type === 'mail.spam.score') {
    const messageId = graphileKeyScalar(payload.messageId);
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'mail.vacation.auto_reply') {
    const messageId = graphileKeyScalar(payload.messageId);
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'mail.send.scheduled') {
    const draftId = graphileKeyScalar(payload.draftId);
    if (workspaceKey && draftId) return scheduledSendJobKey(workspaceKey, draftId);
  }
  if (type === 'ai.reply_suggestion') {
    const messageId = graphileKeyScalar(payload.messageId);
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'ai.agent') {
    const messageId = graphileKeyScalar(payload.messageId);
    const workflowId = graphileKeyScalar(payload.workflowId);
    const nodeKey = graphileChildNodeKeyPart(payload);
    const runId = graphileKeyScalar(payload.runId);
    if (workspaceKey && workflowId && nodeKey) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId ?? 'none'}:${nodeKey}:${runId ?? 'none'}`;
    }
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'ai.pick_canned') {
    // Nur Workflow-Kindjobs bekommen einen Key. Compose-initiierte Aufrufe
    // bleiben bewusst ohne, sonst verschluckt jobKeyMode 'replace' die zweite
    // manuelle Bausteinauswahl auf derselben Nachricht.
    const messageId = graphileKeyScalar(payload.messageId);
    const workflowId = graphileKeyScalar(payload.workflowId);
    const nodeKey = graphileChildNodeKeyPart(payload);
    const runId = graphileKeyScalar(payload.runId);
    // Zweig-Identitaet: terminale Knoten tragen sie bereits in nodeKey, fuer
    // nicht-terminale liefert sie payload.branchKey. Fehlt sie ganz, gibt es
    // bewusst KEINEN Key — zwei konvergierende Trigger-Zweige teilten sich sonst
    // Workflow, Nachricht, runId UND resumeNodeId, 'replace' verschluckte einen
    // und die mit zwei Zweigen initialisierte Barriere bliebe bei pending = 1.
    // Ohne Key kann nichts verschluckt werden (Verhalten vor diesem PR).
    const branchKey = graphileKeyScalar(payload.branchKey);
    const branchIdentified = payload.terminalWorkflowCompletion === true || Boolean(branchKey);
    if (workspaceKey && workflowId && nodeKey && branchIdentified) {
      const base = `${type}:${workspaceKey}:${workflowId}:${messageId ?? 'none'}:${nodeKey}:${runId ?? 'none'}`;
      return branchKey ? `${base}:${branchKey}` : base;
    }
  }
  if (type === 'ai.classify') {
    const messageId = graphileKeyScalar(payload.messageId);
    const workflowId = graphileKeyScalar(payload.workflowId);
    const resumeNodeId = graphileKeyScalar(payload.resumeNodeId);
    if (workspaceKey && messageId && workflowId && resumeNodeId) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId}:${resumeNodeId}`;
    }
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'ai.review') {
    const messageId = graphileKeyScalar(payload.messageId);
    const workflowId = graphileKeyScalar(payload.workflowId);
    const resumeNodeId = graphileKeyScalar(payload.resumeNodeId);
    if (workspaceKey && workflowId && resumeNodeId) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId ?? 'none'}:${resumeNodeId}`;
    }
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}`;
  }
  if (type === 'ai.draft_reply') {
    const messageId = graphileKeyScalar(payload.messageId);
    const workflowId = graphileKeyScalar(payload.workflowId);
    const resumeNodeId = graphileChildNodeKeyPart(payload);
    // runId gehört in den Key: wird derselbe Workflow erneut auf dieselbe
    // Nachricht angewandt, während der erste KI-Job noch wartet, würde
    // jobKeyMode 'replace' sonst die erste Fortsetzung verschlucken (der erste
    // Lauf bliebe dauerhaft deferred). Die Entwurfs-Dedupe ist ebenfalls
    // run-skopiert (aiDraftReplyDedupeKey).
    const runId = graphileKeyScalar(payload.runId);
    if (workspaceKey && workflowId && resumeNodeId) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId ?? 'none'}:${resumeNodeId}:${runId ?? 'none'}`;
    }
    if (workspaceKey && messageId) return `${type}:${workspaceKey}:${messageId}:${runId ?? 'none'}`;
  }
  if (type === 'ai.review_draft') {
    const messageId = graphileKeyScalar(payload.messageId);
    const workflowId = graphileKeyScalar(payload.workflowId);
    const resumeNodeId = graphileChildNodeKeyPart(payload);
    // Analog zu ai.draft_reply: der konkrete Entwurf gehört in den Key, sonst
    // ersetzt eine zweite Gegenprüfung die erste und ein Entwurf bleibt ungeprüft.
    const draftId = graphileKeyScalar(payload.draftId);
    const runId = graphileKeyScalar(payload.runId);
    if (workspaceKey && workflowId && resumeNodeId) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId ?? 'none'}:${resumeNodeId}:${draftId ?? 'none'}:${runId ?? 'none'}`;
    }
    if (workspaceKey && messageId) {
      return `${type}:${workspaceKey}:${messageId}:${draftId ?? 'none'}:${runId ?? 'none'}`;
    }
  }
  if (type === 'ai.transform_text') {
    const messageId = graphileKeyScalar(payload.messageId);
    const workflowId = graphileKeyScalar(payload.workflowId);
    const resumeNodeId = graphileKeyScalar(payload.resumeNodeId);
    const targetVariable = graphileKeyScalar(payload.targetVariable);
    if (workspaceKey && workflowId && resumeNodeId && targetVariable) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId ?? 'none'}:${resumeNodeId}:${targetVariable}`;
    }
    if (workspaceKey && messageId && targetVariable) return `${type}:${workspaceKey}:${messageId}:${targetVariable}`;
  }
  if (type === 'webhook.fire') {
    const dedupeKey = graphileKeyScalar(payload.dedupeKey);
    if (workspaceKey && dedupeKey) return `${type}:${workspaceKey}:${dedupeKey}`;
  }
  if (type === 'workflow.http_request') {
    const workflowId = graphileKeyScalar(payload.workflowId);
    const resumeNodeId = graphileKeyScalar(payload.resumeNodeId)
      ?? graphileKeyScalar(payload.errorResumeNodeId);
    const messageId = graphileKeyScalar(payload.messageId);
    // Terminale HTTP-Knoten (nur Fehlerkante) teilen sich errorResumeNodeId.
    // Ohne die Knoten-/Lauf-Identitaet fielen zwei konvergierende Zweige oder
    // zwei parallele Knoten an derselben Fehlerkante auf denselben Key;
    // jobKeyMode 'replace' verschluckte einen, die mit zwei Zweigen
    // initialisierte Join-Barriere faellt dann nie auf null.
    const terminalNodeId = graphileKeyScalar(payload.terminalNodeId);
    if (workspaceKey && workflowId && resumeNodeId) {
      const base = `${type}:${workspaceKey}:${workflowId}:${messageId ?? 'none'}:${resumeNodeId}`;
      return terminalNodeId ? `${base}:${terminalNodeId}` : base;
    }
  }
  if (type === 'workflow.forward_copy') {
    const workflowId = graphileKeyScalar(payload.workflowId);
    const messageId = graphileKeyScalar(payload.messageId);
    const to = graphileKeyScalar(payload.to);
    if (workspaceKey && workflowId && messageId && to) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId}:${to}`;
    }
  }
  if (type === 'workflow.dmarc_ingest') {
    const workflowId = graphileKeyScalar(payload.workflowId);
    const messageId = graphileKeyScalar(payload.messageId);
    if (workspaceKey && workflowId && messageId) {
      return `${type}:${workspaceKey}:${workflowId}:${messageId}`;
    }
  }
  if (type === 'workflow.execute') {
    const workflowId = graphileKeyScalar(payload.workflowId);
    const delayedJobId = graphileKeyScalar(payload.delayedJobId);
    const runId = graphileKeyScalar(payload.runId);
    const messageId = graphileKeyScalar(payload.messageId);
    // Terminaler HTTP-Abschluss: die Knoten-/Lauf-Identitaet trennt zwei
    // Fan-out-Zweige, die beide ueber eine reine Fehlerkante zurueckkommen.
    // Ohne sie verschluckt 'replace' einen der beiden Abschlussjobs und die
    // mit zwei Zweigen initialisierte Join-Barriere faellt nie auf null.
    const terminalNodeId = graphileKeyScalar(payload.terminalNodeId);
    if (workspaceKey && workflowId && delayedJobId) return `${type}:${workspaceKey}:delayed:${delayedJobId}`;
    if (workspaceKey && workflowId && runId) return `${type}:${workspaceKey}:run:${runId}`;
    if (workspaceKey && workflowId && messageId && terminalNodeId) {
      return `${type}:${workspaceKey}:${workflowId}:message:${messageId}:${terminalNodeId}`;
    }
    if (workspaceKey && workflowId && messageId) return `${type}:${workspaceKey}:${workflowId}:message:${messageId}`;
  }
  if (type === 'lock.cleanup' && workspaceKey) {
    return `${type}:${workspaceKey}`;
  }
  return undefined;
}

async function createDefaultGraphileWorkerUtils(options: {
  connectionString: string;
}): Promise<GraphileWorkerUtilsPort> {
  const { makeWorkerUtils } = require('graphile-worker') as typeof import('graphile-worker');
  const utils = await makeWorkerUtils({ connectionString: options.connectionString });
  return {
    async addJob(identifier, payload, spec) {
      return utils.addJob(identifier, payload, spec);
    },
    async migrate() {
      await utils.migrate();
    },
    async release() {
      await utils.release();
    },
  };
}

async function createDefaultGraphileWorkerRuntime(options: {
  connectionString: string;
  concurrentJobs: number;
  taskList: Record<string, (payload: unknown, helpers?: GraphileJobHelpers) => Promise<void>>;
}): Promise<GraphileWorkerRuntime> {
  const { run } = require('graphile-worker') as typeof import('graphile-worker');
  const runner = await run({
    connectionString: options.connectionString,
    concurrency: options.concurrentJobs,
    taskList: options.taskList,
  });
  return {
    async stop() {
      await runner.stop();
    },
    promise: runner.promise,
  };
}

function normalizePayload(payload: unknown): JobPayload {
  return payload && typeof payload === 'object' && !Array.isArray(payload)
    ? payload as JobPayload
    : {};
}

function workspaceIdFromPayload(payload: unknown): string {
  const normalized = normalizePayload(payload);
  return typeof normalized.workspaceId === 'string' ? normalized.workspaceId : '';
}

function graphileKeyScalar(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return undefined;
}
