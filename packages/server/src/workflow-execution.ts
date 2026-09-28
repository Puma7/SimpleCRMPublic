import {
  AI_DECIDE_CRITERIA_MAX_CHARS,
  AI_DECIDE_QUESTION_MAX_CHARS,
  type AiDecideOutcome,
  type BuildWorkflowStepDetailInput,
  NODE_CHAIN_STOP_MESSAGE,
  WORKFLOW_CONTINUED_FROM_VARIABLE,
  type WorkflowDirection,
  type WorkflowGraphDocument,
  type WorkflowGraphNode,
  type WorkflowStepDetail,
  type WorkflowTriggerKind,
  addressesFromRecipientJson,
  aiDecideAnswerHoldsOutbound,
  aiDecideDryRunOutcome,
  aiDecideErrorOutcome,
  aiDecideOutboundBlockReason,
  aiDecidePortTripsInboundGate,
  aiDecideVariables,
  buildWorkflowStepDetail,
  buildWorkflowStepMailSnapshot,
  compileUserRegex,
  createWorkflowRunDetailState,
  decodeWorkflowContinuedFrom,
  inboundChainStopReachableAfter,
  interpolateWorkflowPlaceholders,
  listBuiltinWorkflowNodeCatalog,
  nodeRequestsChainStop,
  normalizeAiDecideContextMode,
  normalizeAiDecideThreshold,
  outboundHoldReasonOrFallback,
  outgoing,
  parseGraphDocument,
  pickEdge,
  serializeWorkflowStepDetailWithinBudget,
  stripHtmlTagsToText,
  workflowDirectionForTrigger,
  workflowNodeDefersRun,
  workflowNodeRuntimeType,
  workflowStepPortLabel,
  workflowTriggerNeedsMessage,
  workflowUnwiredPortNote,
} from '@simplecrm/core';
import type { Kysely, Selectable } from 'kysely';
import { type AiReviewPreviewRunner, createAiReviewPreviewRunner } from './ai-classification';
import { executeServerLearningsDigestNode } from './ai-learnings';
import type { ServerEventPort } from './api/types';
import type { EmailWorkflowRunsTable, ServerDatabase, WorkflowDelayedJobsTable } from './db';
import type { PostgresSecretPort } from './db/postgres-secret-port';
import {
  type WorkspaceSessionApplier,
  type WorkspaceTransaction,
  withWorkspaceTransaction,
} from './db/workspace-context';
import type {
  WorkflowExecutionDryRunResult,
  WorkflowExecutionJobPlan,
  WorkflowExecutionJobPort,
} from './jobs';
import { buildTrustedServiceJobPayload } from './jobs/policy';
import { searchKnowledgeSections } from './knowledge-workflow-search';
import type { MailAccessService } from './mail-access/types';
import { publishMailVisibilityInvalidation } from './mail-access/visibility-invalidation';
import { persistOutboundBlockOnDraft } from './mail-outbound-hold';
import {
  READ_RECEIPT_REVIEW_ROUND_VARIABLE,
  readReceiptReviewRoundFromJobContext,
} from './mail-read-receipt-responder';
import type { MssqlSettingsPort } from './mssql-settings';
import { interpolateAiDecideField, runServerAiDecision } from './workflow-ai-decide';
import {
  type WorkflowAiDraftNodeDeps,
  executeWorkflowAiDraftReply,
  executeWorkflowAiReviewDraft,
} from './workflow-ai-draft-nodes';
import type { ServerWorkflowImapActionPort } from './workflow-imap-actions';
import {
  DELAYED_JOB_CHAIN_SETTLED_FIELD,
  cancelPendingWorkflowDelayedJobsForMessage,
  completeInboundDeferredJoinSibling,
  inboundJoinAllowsAdvance,
  initInboundDeferredJoin,
  isInboundSiblingAborted,
  markInboundSiblingAbort,
  terminalChildCompletionKeyFor,
  tryClaimInboundChainHop,
} from './workflow-inbound-chain-advance';
import {
  type InboundWorkflowChainContext,
  inboundChainFieldsFromRecord,
  parseInboundWorkflowChain,
} from './workflow-inbound-chain-context';
import { CRM_NODE_HANDLERS } from './workflow-nodes/crm';
import {
  DRY_RUN_LIVE_NODE_TYPES,
  dryRunFailClosedResult,
  dryRunMutatingNodeResult,
} from './workflow-nodes/dry-run';
import { ERP_NODE_HANDLERS } from './workflow-nodes/erp';
import { IMAP_NODE_HANDLERS } from './workflow-nodes/imap';
import { INTEGRATION_NODE_HANDLERS } from './workflow-nodes/integration';
import { LOGIC_NODE_HANDLERS, LOGIC_PRE_GUARD_HANDLERS } from './workflow-nodes/logic';
import { MESSAGE_NODE_HANDLERS } from './workflow-nodes/message';
import { OUTBOUND_NODE_HANDLERS } from './workflow-nodes/outbound';
import {
  CONTINUATION_HOPS_VARIABLE,
  PreviewAiPendingSignal,
  RESERVED_WORKFLOW_VARIABLES,
  applyWorkflowImapMoveLocalState,
  booleanConfig,
  boundedContinuationStrings,
  finiteNumber,
  inboundChainFieldsFromContext,
  loadWorkflow,
  messageIsSpamOrReview,
  normalizeWorkflowTrigger,
  objectRecord,
  optionalPositiveIntegerConfig,
  parseJson,
  resolveResumeNodeAfter,
  serverCreatedSourceSqliteId,
  serverNodeHandlerFor,
  serverNodeHandlerMap,
  serverWorkerSourceRow,
  softDeleteWorkflowMessage,
  stampBranchKey,
  terminalNodeExecutionId,
  unsupportedWorkflowNodeResult,
  workflowContinuationContextError,
  workflowJobProvenance,
} from './workflow-nodes/shared';
import { SPAM_NODE_HANDLERS } from './workflow-nodes/spam';
import type {
  DeferredWorkflowImapEffect,
  MessageRow,
  NodeResult,
  PreviewAiMemo,
  ServerNodeHandlerArgs,
  ServerNodeHandlerMap,
  ServerWorkflowContext,
  ServerWorkflowRuntimePorts,
  WorkflowRow,
  WorkflowStepStatus,
  WorkflowStringContext,
  WorkflowVariableContext,
  WorkflowVisibilityInvalidation,
} from './workflow-nodes/types';

export { applyWorkflowReturnOutcome, decideWorkflowReturnOutcomePort, evaluateWorkflowReturn } from './workflow-nodes/erp';

const MAX_REGEX_PATTERN_LEN = 240;
const MAX_GRAPH_STEPS = 500;
/**
 * Node executions per run across all loop iterations. MAX_GRAPH_STEPS counts per
 * path and each loop iteration starts its own path, so 500 items times a long
 * body reached 250,000 executions (with run-step inserts and side effects).
 * 10,000 still covers 500 items with a body of up to ~19 nodes.
 */
const MAX_GRAPH_TOTAL_STEPS = 10_000;
const MAX_WORKFLOW_LOOP_ITEMS = 500;
/**
 * Global cap on continuations (resumed runs) per workflow lineage. MAX_GRAPH_STEPS
 * only bounds a single job; a cycle through an async node (HTTP/AI/delay back to
 * an earlier node) otherwise re-queues itself forever. Each resume counts one hop.
 * 100 leaves room for real graphs (a path rarely has more than a dozen async
 * nodes; a delay-based reminder cycle still gets 100 rounds) while a runaway
 * chain stops after 100 external calls instead of never.
 */
const MAX_WORKFLOW_CONTINUATION_HOPS = 100;
const safeRegex = require('safe-regex') as (pattern: string) => boolean;

type RunRow = Pick<Selectable<EmailWorkflowRunsTable>, 'id' | 'source_sqlite_id'>;
type DelayedJobRow = Pick<
  Selectable<WorkflowDelayedJobsTable>,
  | 'id'
  | 'workflow_id'
  | 'message_id'
  | 'message_source_sqlite_id'
  | 'resume_node_id'
  | 'context_json'
  | 'status'
>;

type WorkflowRunStatus = 'ok' | 'error' | 'blocked';

type PreparedWorkflowRun =
  | {
    ok: true;
  workflow: WorkflowRow;
  trigger: WorkflowTriggerKind;
  direction: WorkflowDirection;
  message: MessageRow | null;
  jobContext: Record<string, unknown>;
  resumeNodeId: string | null;
  delayedJob: DelayedJobRow | null;
}
  | {
    ok: false;
    workflow: WorkflowRow | null;
    message: MessageRow | null;
    error: string;
    log: string[];
  };

type GraphRunResult = {
  status: WorkflowRunStatus;
  blocked: boolean;
  deferred: boolean;
  /** When true, do not enqueue the next inbound workflow in the priority chain. */
  inboundChainStop?: boolean;
  /**
   * Trigger fan-out only: how many sibling branches returned deferred.
   * Used to init a join barrier so chain advance waits for every sibling.
   */
  deferredBranchCount?: number;
  /** Knoten, an denen der Lauf deferiert hat (logic.delay, KI-, HTTP-Kindjobs …). */
  deferredNodeIds?: string[];
  blockReason: string | null;
  log: string[];
};

/** Höchstzahl verschiedener KI-Aufrufe je Versandvorschau (danach fail-closed). */
const MAX_PREVIEW_AI_CALLS_PER_DRY_RUN = 25;

async function callPreviewAi<T>(
  ports: ServerWorkflowRuntimePorts,
  kind: string,
  request: unknown,
  run: () => Promise<T>,
): Promise<T> {
  const memo = ports.previewAiMemo;
  if (!memo) return run();
  const key = `${kind}\u0000${JSON.stringify(request)}`;
  if (memo.results.has(key)) return structuredClone(memo.results.get(key)) as T;
  memo.pending = { key, run };
  throw new PreviewAiPendingSignal('preview_ai_pending');
}

type ServerInboundBranchGate = {
  conditionOk: boolean;
};

export type PostgresWorkflowExecutionJobPortOptions = Readonly<{
  db: Kysely<ServerDatabase>;
  now?: () => Date;
  applyWorkspaceSession?: WorkspaceSessionApplier;
  mssql?: Pick<MssqlSettingsPort, 'executeReadOnlyQuery'>;
  workflowImapActions?: ServerWorkflowImapActionPort;
  secrets?: PostgresSecretPort;
  aiReviewPreview?: AiReviewPreviewRunner;
  /**
   * Beide zusammen ergeben die Sichtbarkeits-Invalidierung nach Tag-/
   * Kategorie-Schreibungen: `mailAccess` loest auf, WEN ein Wert betrifft,
   * `events` stellt die Invalidierung zu. Fehlt einer von beiden, unterbleibt
   * sie stillschweigend — der Worker laeuft auch ohne Event-Backend.
   */
  mailAccess?: Pick<MailAccessService, 'resolveConstraintSubjectUserIds'>;
  events?: Pick<ServerEventPort, 'publish'>;
}>;

/**
 * Sichtbarkeits-Invalidierung NACH dem Commit — gebuendelt.
 *
 * Ein Tagging-Workflow laeuft auf jeder eingehenden Nachricht. Pro geschriebenem
 * Wert ein eigenes Ereignis zu senden waere teurer als der Zustand, den es
 * heilt: jedes email_acl.changed laesst den Client seine Rechte neu laden und
 * seine Liste neu ziehen. Deshalb genau EIN Lookup ueber alle gesammelten
 * Tags/Kategorien und danach hoechstens EIN Ereignis pro betroffenem Nutzer.
 *
 * Best effort: der Lauf ist committed: ein fehlgeschlagenes Publish darf ihn
 * nicht nachtraeglich scheitern lassen.
 */
async function flushWorkflowVisibilityInvalidation(input: Readonly<{
  workspaceId: string;
  actorUserId?: string;
  collected: WorkflowVisibilityInvalidation;
  mailAccess?: Pick<MailAccessService, 'resolveConstraintSubjectUserIds'>;
  events?: Pick<ServerEventPort, 'publish'>;
}>): Promise<void> {
  const { collected, mailAccess, events } = input;
  if (collected.tags.size === 0 && collected.categoryIds.size === 0 && !collected.assignmentChanged) return;
  const resolve = mailAccess?.resolveConstraintSubjectUserIds;
  if (!resolve || !events) return;

  let targets: readonly string[] = [];
  try {
    targets = await resolve.call(mailAccess, {
      workspaceId: input.workspaceId,
      ...(collected.categoryIds.size > 0 ? { categoryIds: [...collected.categoryIds] } : {}),
      ...(collected.tags.size > 0 ? { tags: [...collected.tags] } : {}),
      // Wie im manuellen Assign-Pfad: die Zuweisungsfilter haengen an keinem
      // Wert, den man mitgeben koennte — sie treffen jeden, der einen von
      // ihnen haelt.
      ...(collected.assignmentChanged ? { includeAssignmentModes: true } : {}),
    });
  } catch (error) {
    console.warn(
      `[workflow] visibility filter lookup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }

  await publishMailVisibilityInvalidation({
    workspaceId: input.workspaceId,
    // Der Workflow-Worker laeuft ohne menschlichen Akteur; 'system' ist die im
    // Projekt uebliche Kennzeichnung (siehe email-tracking).
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    targetUserIds: targets,
    events,
    logPrefix: '[workflow]',
  });
}

export function createPostgresWorkflowExecutionJobPort(
  options: PostgresWorkflowExecutionJobPortOptions,
): WorkflowExecutionJobPort {
  const aiReviewPreview = options.aiReviewPreview
    ?? (options.secrets
      ? createAiReviewPreviewRunner({
        db: options.db,
        secrets: options.secrets,
        applyWorkspaceSession: options.applyWorkspaceSession,
        now: options.now,
      })
      : undefined);
  const aiDraft: WorkflowAiDraftNodeDeps | undefined = options.secrets
    ? {
      db: options.db,
      secrets: options.secrets,
      applyWorkspaceSession: options.applyWorkspaceSession,
      now: options.now,
    }
    : undefined;
  const runtimePorts: ServerWorkflowRuntimePorts = {
    mssql: options.mssql,
    workflowImapActions: options.workflowImapActions,
    aiReviewPreview,
    aiDraft,
    // Gleiche Abhängigkeiten wie aiDraft (Profil, Secret, Nutzungserfassung).
    aiDecide: aiDraft,
  };
  return {
    async execute(input) {
      const deferredImapEffects: DeferredWorkflowImapEffect[] = [];
      const visibilityInvalidation: WorkflowVisibilityInvalidation = {
        tags: new Set<string>(),
        categoryIds: new Set<number>(),
        assignmentChanged: false,
      };
      await withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => {
          const now = options.now?.() ?? new Date();
          const workflow = await loadWorkflow(trx, input.workspaceId, input.workflowId);
          if (!workflow) {
            if (input.runId !== undefined) {
              await finishExistingRun(trx, input.workspaceId, input.runId, {
                status: 'error',
                log: ['error:workflow_not_found'],
                now,
              });
            }
            // Deleted mid-chain: still advance so later priority workflows run.
            const missingTrigger = normalizeWorkflowTrigger(input.triggerName ?? 'inbound');
            if (missingTrigger === 'inbound' && input.messageId !== undefined) {
              await maybeEnqueueNextInboundWorkflow(trx, {
                workspaceId: input.workspaceId,
                messageId: input.messageId,
                actorUserId: input.actorUserId,
                jobContext: input.context ?? {},
                now,
              });
            }
            return;
          }

          const trigger = normalizeWorkflowTrigger(input.triggerName ?? workflow.trigger_name);
          const direction = workflowDirectionForTrigger(trigger);
          const delayedJob = input.delayedJobId === undefined
            ? null
            : await loadDelayedJob(trx, input.workspaceId, input.delayedJobId, Number(workflow.id));
          if (input.delayedJobId !== undefined && !delayedJob) {
            const run = await startOrReuseRun(trx, {
              workspaceId: input.workspaceId,
              workflow,
              message: null,
              direction,
              requestedRunId: input.runId,
              now,
            });
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:delayed_job_not_found'],
              now,
            });
            return;
          }

          if (delayedJob && delayedJobAuthorizationMismatch(input, delayedJob.message_id)) {
            const run = await startOrReuseRun(trx, {
              workspaceId: input.workspaceId,
              workflow,
              message: null,
              direction,
              requestedRunId: input.runId,
              now,
            });
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:delayed_job_authorization_mismatch'],
              now,
            });
            return;
          }

          const messageId = input.messageId ?? delayedJob?.message_id ?? undefined;
          if (
            input.messageId !== undefined
            && delayedJob !== null
            && normalizeDelayedJobMessageId(delayedJob.message_id) !== input.messageId
          ) {
            const run = await startOrReuseRun(trx, {
              workspaceId: input.workspaceId,
              workflow,
              message: null,
              direction,
              requestedRunId: input.runId,
              now,
            });
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:delayed_job_message_mismatch'],
              now,
            });
            return;
          }

          const message = messageId === undefined || messageId === null
            ? null
            : await loadMessage(trx, input.workspaceId, Number(messageId));
          if (messageId !== undefined && messageId !== null && !message) {
            const run = await startOrReuseRun(trx, {
              workspaceId: input.workspaceId,
              workflow,
              message: null,
              direction,
              requestedRunId: input.runId,
              now,
            });
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:message_not_found'],
              now,
            });
            return;
          }

          const jobContext = mergeJobContexts(delayedJob?.context_json, input.context);
          const resumeNodeId = delayedJob?.resume_node_id
            ?? stringFromContext(jobContext.resumeNodeId)
            ?? null;

          if (
            trigger === 'inbound'
            && message
            && input.delayedJobId === undefined
            && !contextForcesWorkflowReapply(jobContext)
            && await wasInboundWorkflowApplied(trx, input.workspaceId, workflow, message)
          ) {
            const run = await startOrReuseRun(trx, {
              workspaceId: input.workspaceId,
              workflow,
              message,
              direction,
              requestedRunId: input.runId,
              now,
            });
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['skip:workflow_already_applied'],
              now,
            });
            await maybeEnqueueNextInboundWorkflow(trx, {
              workspaceId: input.workspaceId,
              messageId: Number(message.id),
              actorUserId: input.actorUserId,
              jobContext,
              now,
            });
            return;
          }

          const run = await startOrReuseRun(trx, {
            workspaceId: input.workspaceId,
            workflow,
            message,
            direction,
            requestedRunId: input.runId,
            now,
          });

          if (contextCompletesWorkflow(jobContext) && !resumeNodeId) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['continuation:terminal_success'],
              now,
            });
            if (trigger === 'inbound' && message) {
              // Ein HTTP-Knoten mit Fehlerkante, aber ohne Erfolgskante meldet
              // sich hier als „fertig" — er hat den Elternlauf aber wie jeder
              // andere Zweig deferiert und zaehlt in der Join-Barriere. Ohne
              // dieses Dekrement bliebe die Barriere fuer immer pending, und
              // der Marker faende ihn angewendet, obwohl ein Geschwisterzweig
              // noch laeuft oder gescheitert ist. Gleiche Reihenfolge wie im
              // regulaeren Abschluss weiter unten: erst Join, dann Marker.
              //
              // Einmal-Schranke wie beim terminalen KI-Kindjob: wird dieser
              // Fortsetzungsjob nach dem Commit, aber vor der Bestaetigung
              // erneut zugestellt, zaehlte er die Barriere sonst ein zweites
              // Mal herunter. Beim ersten Durchlauf mit `wait` gibt es noch
              // keinen Applied-Marker, der den Retry abfangen koennte — der
              // zweite Lauf bekaeme verfrueht `ready`, markierte angewendet
              // und startete die naechste Prioritaetsstufe mitten im Fan-out.
              const claimed = await claimTerminalHttpCompletion(trx, {
                workspaceId: input.workspaceId,
                messageId: Number(message.id),
                workflowId: Number(workflow.id),
                jobContext,
                now,
              });
              if (!claimed) return;
              const join = await completeInboundDeferredJoinSibling(trx, {
                workspaceId: input.workspaceId,
                messageId: Number(message.id),
                workflowId: Number(workflow.id),
                chain: parseInboundWorkflowChain(jobContext.inboundWorkflowChain),
                fanOutRunId: jobContextFanOutRunId(jobContext, run.id),
                chainStop: false,
                now,
              });
              if (inboundJoinAllowsAdvance(join)) {
                if (join === 'ready') {
                  await markInboundWorkflowApplied(trx, input.workspaceId, workflow, message, now);
                }
                await maybeEnqueueNextInboundWorkflow(trx, {
                  workspaceId: input.workspaceId,
                  messageId: Number(message.id),
                  actorUserId: input.actorUserId,
                  jobContext,
                  now,
                });
              }
            }
            return;
          }

          if (!workflow.enabled) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['skip:workflow_disabled'],
              now,
            });
            if (trigger === 'inbound' && message) {
              await maybeEnqueueNextInboundWorkflow(trx, {
                workspaceId: input.workspaceId,
                messageId: Number(message.id),
                actorUserId: input.actorUserId,
                jobContext,
                now,
              });
            }
            return;
          }

          // Ein Zeitplan-Lauf wurde fuer den damals gespeicherten Ausloeser
          // eingereiht (jobs/workflow-schedule-tick). Wurde der Workflow bis zum
          // Start auf einen anderen Ausloeser umgestellt, ist er fuer den
          // Zeitplan nicht mehr zustaendig — wie deaktiviert behandeln.
          if (trigger === 'schedule' && !resumeNodeId && workflow.trigger_name !== 'schedule') {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['skip:workflow_scope_changed'],
              now,
            });
            return;
          }

          // Genau einmal je Zeitpunkt, auch wenn der Taktgeber denselben
          // Zeitpunkt zweimal einreiht (Einreihung gespeichert, Bestaetigung
          // verloren ⇒ Anspruch zurueckgenommen ⇒ naechster Takt reiht erneut
          // ein). Der Anspruch liegt in derselben Transaktion wie der Lauf:
          // Scheitert der Lauf, faellt er mit zurueck und der Retry desselben
          // Jobs darf erneut.
          if (
            trigger === 'schedule'
            && !resumeNodeId
            && input.scheduleSlot !== undefined
            && !await claimScheduleSlotRun(trx, {
              workspaceId: input.workspaceId,
              workflowId: Number(workflow.id),
              slot: input.scheduleSlot,
              now,
            })
          ) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['skip:schedule_slot_already_ran'],
              now,
            });
            return;
          }

          // Die Kette wurde beim Eingang der Mail mit den damals zustaendigen
          // Workflows festgelegt. Wurde dieser Workflow seitdem auf ein anderes
          // Postfach umgehaengt oder vom Inbound-Trigger genommen, ist er fuer
          // die Mail nicht mehr zustaendig — wie deaktiviert behandeln.
          if (
            trigger === 'inbound'
            && message
            && !resumeNodeId
            && parseInboundWorkflowChain(jobContext.inboundWorkflowChain)
            && (
              workflow.trigger_name !== 'inbound'
              || (workflow.account_id != null && Number(workflow.account_id) !== Number(message.account_id))
            )
          ) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['skip:workflow_scope_changed'],
              now,
            });
            await maybeEnqueueNextInboundWorkflow(trx, {
              workspaceId: input.workspaceId,
              messageId: Number(message.id),
              actorUserId: input.actorUserId,
              jobContext,
              now,
            });
            return;
          }

          if (
            trigger === 'inbound'
            && message
            && contextSkipsSpamOrReview(jobContext)
            && messageIsSpamOrReview(message)
          ) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['skip:message_spam_or_review'],
              now,
            });
            return;
          }

          if (delayedJob && (delayedJob.status === 'done' || delayedJob.status === 'cancelled')) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: [delayedJob.status === 'cancelled' ? 'skip:delayed_job_cancelled' : 'skip:delayed_job_done'],
              now,
            });
            // Storniertes Delay-Geschwister: siehe unten — die Join-Barriere
            // zaehlt es weiterhin als pending und bliebe sonst fuer immer offen.
            // Ausnahme: ein manueller Abbruch hat Barriere und Kette bereits
            // selbst abgeschlossen (settleInboundChainForCancelledDelayedJob);
            // eine vorher schon gesperrte Fortsetzung darf das nicht wiederholen.
            const settledByCancel = delayedJob.status === 'cancelled'
              && Boolean(objectRecord(delayedJob.context_json)?.[DELAYED_JOB_CHAIN_SETTLED_FIELD]);
            if (trigger === 'inbound' && message && !settledByCancel) {
              await completeInboundDeferredJoinSibling(trx, {
                workspaceId: input.workspaceId,
                messageId: Number(message.id),
                workflowId: Number(workflow.id),
                chain: parseInboundWorkflowChain(jobContext.inboundWorkflowChain),
                fanOutRunId: jobContextFanOutRunId(jobContext, run.id),
                chainStop: true,
                now,
              });
            }
            return;
          }
          if (delayedJob && !resumeNodeId) {
            await markDelayedJobStatus(trx, input.workspaceId, Number(delayedJob.id), 'failed', now);
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:delayed_job_resume_node_missing'],
              now,
            });
            return;
          }

          if (delayedJob) {
            const claimed = await markDelayedJobStatus(
              trx,
              input.workspaceId,
              Number(delayedJob.id),
              'running',
              now,
            );
            if (!claimed) {
              await finishRun(trx, input.workspaceId, run.id, {
                status: 'ok',
                log: ['skip:delayed_job_cancelled'],
                now,
              });
              // Der Delay-Zweig wurde als Geschwister eines Kettenstopps
              // storniert, zaehlt in der Join-Barriere aber weiterhin als
              // pending. Ohne diesen Abschluss erreichte der Zaehler nie null —
              // die Barriere und der Sibling-Abort-Marker blieben fuer immer
              // liegen und vergifteten jede spaetere Wiederholung.
              if (trigger === 'inbound' && message) {
                await completeInboundDeferredJoinSibling(trx, {
                  workspaceId: input.workspaceId,
                  messageId: Number(message.id),
                  workflowId: Number(workflow.id),
                  chain: parseInboundWorkflowChain(jobContext.inboundWorkflowChain),
                  fanOutRunId: jobContextFanOutRunId(jobContext, run.id),
                  chainStop: true,
                  now,
                });
              }
              return;
            }
          }

          if (workflowTriggerNeedsMessage(trigger) && !message && !contextHasOutbound(jobContext)) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'error',
              log: ['error:message_required'],
              now,
            });
            return;
          }

          const context = await buildWorkflowContext(trx, {
            workspaceId: input.workspaceId,
            workflowId: Number(workflow.id),
            workflowSourceSqliteId: workflowSourceSqliteId(workflow),
            runId: run.id,
            runSourceSqliteId: run.sourceSqliteId,
            messageId: message?.id === undefined ? outboundMessageIdFromContext(jobContext) : Number(message.id),
            trigger,
            direction,
            message,
            actorUserId: input.actorUserId,
            trustedService: input.trustedService,
            manualAdminExecute: input.manualAdminExecute,
            jobContext,
          });
          if (
            resumeNodeId
            && trigger === 'inbound'
            && message
            && await isInboundSiblingAborted(trx, {
              workspaceId: input.workspaceId,
              messageId: Number(message.id),
              workflowId: Number(workflow.id),
              chain: parseInboundWorkflowChain(jobContext.inboundWorkflowChain),
              fanOutRunId: jobContextFanOutRunId(jobContext, run.id),
            })
          ) {
            await finishRun(trx, input.workspaceId, run.id, {
              status: 'ok',
              log: ['skip:sibling_terminal_abort'],
              now,
            });
            await completeInboundDeferredJoinSibling(trx, {
              workspaceId: input.workspaceId,
              messageId: Number(message.id),
              workflowId: Number(workflow.id),
              chain: parseInboundWorkflowChain(jobContext.inboundWorkflowChain),
              fanOutRunId: jobContextFanOutRunId(jobContext, run.id),
              chainStop: true,
              now,
            });
            if (delayedJob) {
              await markDelayedJobStatus(
                trx,
                input.workspaceId,
                Number(delayedJob.id),
                'failed',
                now,
              );
            }
            return;
          }
          const result = await runServerWorkflowGraph(trx, {
            workspaceId: input.workspaceId,
            workflow,
            context,
            startNodeId: resumeNodeId,
            now,
            ports: {
              ...runtimePorts,
              deferredImapEffects,
              visibilityInvalidation,
            },
          });
          await finishRun(trx, input.workspaceId, run.id, {
            status: result.status,
            log: result.log,
            now,
          });
          if (trigger === 'inbound' && message && result.deferred) {
            // Multi-deferred trigger fan-out: wait for every sibling before
            // mark-applied / priority-chain advance (Codex Round-10 join).
            // If a later sibling blocked/stopped the fan-out, seed chainStop and
            // cancel already-queued delay jobs so they cannot release holds later.
            const siblingTerminal = result.blocked
              || result.status === 'blocked'
              || result.inboundChainStop === true;
            const chain = parseInboundWorkflowChain(jobContext.inboundWorkflowChain);
            await initInboundDeferredJoin(trx, {
              workspaceId: input.workspaceId,
              messageId: Number(message.id),
              workflowId: Number(workflow.id),
              chain,
              fanOutRunId: jobContextFanOutRunId(jobContext, run.id),
              pendingCount: result.deferredBranchCount ?? 1,
              chainStop: siblingTerminal,
              // Ein synchron mit Fehler beendeter Geschwisterzweig muss über
              // die Barriere sichtbar bleiben — sonst markiert der später
              // abschliessende Kindjob den Workflow als angewendet, obwohl
              // derselbe Fehler ohne deferiertes Geschwister das verhindert haette.
              error: result.status === 'error',
              now,
            });
            if (siblingTerminal) {
              await abortRemainingInboundSiblings(trx, {
                workspaceId: input.workspaceId,
                messageId: Number(message.id),
                workflowId: Number(workflow.id),
                chain,
                fanOutRunId: jobContextFanOutRunId(jobContext, run.id),
                reason: result.inboundChainStop
                  ? 'sibling_inbound_chain_stop'
                  : 'sibling_blocked',
                now,
              });
            } else if (chain && !resumeNodeId && deferredOnlyByChainNeutralDelays(workflow, result)) {
              // Nur Wartezeit, keine Entscheidung mehr: hinter keinem der
              // Delays kann noch ein Knoten die Kette stoppen. Die naechste
              // Prioritaetsstufe startet sofort statt erst nach Tagen; die
              // Fortsetzung schliesst spaeter nur Join und Applied-Marker ab,
              // ihr eigener Weiterschalt-Versuch scheitert am Hop-Claim.
              await maybeEnqueueNextInboundWorkflow(trx, {
                workspaceId: input.workspaceId,
                messageId: Number(message.id),
                actorUserId: input.actorUserId,
                jobContext,
                now,
              });
            }
          } else if (
            trigger === 'inbound'
            && message
            && !result.deferred
            // 'blocked' gehört dazu: ein Workflow im compiled-Modus, ohne
            // Trigger oder mit nicht unterstütztem Knoten liefert synchron
            // blocked. Fiele er hier heraus, würde die serialisierte Kette nie
            // weitergeschaltet und ein einziger veralteter Workflow legte alle
            // nachrangigen dauerhaft still. Wie ein Fehler behandeln: nicht als
            // angewendet markieren, aber weiterschalten.
            && (
              result.status === 'ok'
              || result.status === 'error'
              || result.status === 'blocked'
              || result.inboundChainStop === true
            )
          ) {
            const join = await completeInboundDeferredJoinSibling(trx, {
              workspaceId: input.workspaceId,
              messageId: Number(message.id),
              workflowId: Number(workflow.id),
              chain: parseInboundWorkflowChain(jobContext.inboundWorkflowChain),
              fanOutRunId: jobContextFanOutRunId(jobContext, run.id),
              chainStop: result.inboundChainStop === true,
              error: result.status === 'error' || result.status === 'blocked',
              now,
            });
            // Der Kettenstopp kann auch erst in einer Continuation entstehen
            // (wiederaufgenommener Zweig). Dann muessen die uebrigen deferierten
            // Geschwister genauso abgebrochen werden wie beim urspruenglichen
            // Fan-out — sonst laufen sie weiter und koennen noch senden.
            if (result.inboundChainStop === true) {
              await abortRemainingInboundSiblings(trx, {
                workspaceId: input.workspaceId,
                messageId: Number(message.id),
                workflowId: Number(workflow.id),
                chain: parseInboundWorkflowChain(jobContext.inboundWorkflowChain),
                fanOutRunId: jobContextFanOutRunId(jobContext, run.id),
                reason: 'sibling_inbound_chain_stop',
                now,
              });
            }
            if (
              inboundJoinAllowsAdvance(join)
              && !result.inboundChainStop
              && (result.status === 'ok' || result.status === 'error' || result.status === 'blocked')
            ) {
              // 'ready_error': ein Geschwisterzweig dieser Fan-out-Runde ist
              // gescheitert — weiterschalten ja, als angewendet markieren nein.
              if (result.status === 'ok' && join === 'ready') {
                await markInboundWorkflowApplied(trx, input.workspaceId, workflow, message, now);
              }
              await maybeEnqueueNextInboundWorkflow(trx, {
                workspaceId: input.workspaceId,
                messageId: Number(message.id),
                actorUserId: input.actorUserId,
                jobContext,
                now,
              });
            }
          }
          if (delayedJob) {
            await markDelayedJobStatus(
              trx,
              input.workspaceId,
              Number(delayedJob.id),
              result.status === 'ok' ? 'done' : 'failed',
              now,
            );
          }
        },
        { applySession: options.applyWorkspaceSession },
      );
      // ZUERST invalidieren, DANN die IMAP-Effekte.
      //
      // Die Metadaten sind bereits committed. Wirft der IMAP-Flush (setSeen,
      // move, delete oder die nachgelagerte Lokalzustands-Transaktion), waere
      // die Invalidierung sonst verloren — und bei einem Worker-Retry wird ein
      // bereits geschriebener Tag als „existiert schon" erkannt und gar nicht
      // mehr eingesammelt. Ein Nutzer, dessen Ausschlussfilter die Nachricht
      // entziehen muesste, behielte sie dann bis zu einem unabhaengigen Reload.
      // Die Invalidierung selbst ist best effort und wirft nie.
      await flushWorkflowVisibilityInvalidation({
        workspaceId: input.workspaceId,
        actorUserId: input.actorUserId,
        collected: visibilityInvalidation,
        mailAccess: options.mailAccess,
        events: options.events,
      });
      await flushDeferredWorkflowImapEffects({
        effects: deferredImapEffects,
        db: options.db,
        workflowImapActions: options.workflowImapActions,
        applyWorkspaceSession: options.applyWorkspaceSession,
      });
    },

    async dryRun(input) {
      const now = options.now?.() ?? new Date();
      const memo: PreviewAiMemo = { results: new Map(), pending: null };
      const ports: ServerWorkflowRuntimePorts = { ...runtimePorts, previewAiMemo: memo };
      for (;;) {
        try {
          return await dryRunPass(now, ports);
        } catch (error) {
          if (!(error instanceof PreviewAiPendingSignal) || !memo.pending) throw error;
        }
        const pending = memo.pending;
        memo.pending = null;
        if (memo.results.size >= MAX_PREVIEW_AI_CALLS_PER_DRY_RUN) {
          return dryRunFailure('Versandvorschau: zu viele KI-Aufrufe in einem Workflow', ['error:preview_ai_call_limit']);
        }
        // Keine Transaktion offen: der Modellaufruf darf dauern.
        memo.results.set(pending.key, await pending.run());
      }

      function dryRunPass(now: Date, ports: ServerWorkflowRuntimePorts): Promise<WorkflowExecutionDryRunResult> {
        return withWorkspaceTransaction(
          options.db,
          { workspaceId: input.workspaceId, role: 'system' },
          async (trx): Promise<WorkflowExecutionDryRunResult> => {
            const prepared = await prepareWorkflowRun(trx, input);
            if (!prepared.ok) {
              return dryRunFailure(prepared.error, prepared.log, {
                ...(prepared.workflow ? { workflowId: workflowSourceSqliteId(prepared.workflow) } : {}),
                ...(prepared.message ? { messageId: Number(prepared.message.id) } : {}),
              });
            }
            // Testlauf (Plan 047): gespeichert und gekennzeichnet, auch für einen
            // deaktivierten Workflow – nie in der Versandvorschau und nie für
            // einen fortgesetzten Lauf.
            const testRun = input.testRun === true
              && prepared.jobContext.previewOutbound !== true
              && input.runId === undefined;
            if (!prepared.workflow.enabled && !testRun) {
              return {
                success: true,
                dryRun: true,
                workflowId: workflowSourceSqliteId(prepared.workflow),
                ...(prepared.message === null ? {} : { messageId: Number(prepared.message.id) }),
                status: 'ok',
                blocked: false,
                blockReason: null,
                log: ['skip:workflow_disabled'],
              };
            }

            const storedRun = testRun
              ? await startOrReuseRun(trx, {
                workspaceId: input.workspaceId,
                workflow: prepared.workflow,
                message: prepared.message,
                direction: prepared.direction,
                now,
                dryRun: true,
              })
              : null;
            const context = await buildWorkflowContext(trx, {
              workspaceId: input.workspaceId,
              workflowId: Number(prepared.workflow.id),
              workflowSourceSqliteId: workflowSourceSqliteId(prepared.workflow),
              runId: storedRun?.id ?? 0,
              runSourceSqliteId: storedRun?.sourceSqliteId ?? 0,
              messageId: prepared.message?.id === undefined
                ? outboundMessageIdFromContext(prepared.jobContext)
                : Number(prepared.message.id),
              trigger: prepared.trigger,
              direction: prepared.direction,
              message: prepared.message,
              actorUserId: input.actorUserId,
              trustedService: input.trustedService,
              testRealAi: testRun && input.realAi === true,
              jobContext: prepared.jobContext,
            });
            const result = await runServerWorkflowGraph(trx, {
              workspaceId: input.workspaceId,
              workflow: prepared.workflow,
              context,
              startNodeId: prepared.resumeNodeId,
              now,
              dryRun: true,
              recordSteps: storedRun !== null,
              ports,
            });
            const log = ['dry_run:server', ...result.log];
            if (storedRun) {
              await finishExistingRun(trx, input.workspaceId, storedRun.id, {
                status: result.status,
                log,
                now,
              });
            }
            return {
              success: true,
              dryRun: true,
              workflowId: workflowSourceSqliteId(prepared.workflow),
              ...(prepared.message === null ? {} : { messageId: Number(prepared.message.id) }),
              status: result.status,
              blocked: result.blocked,
              blockReason: result.blockReason,
              log,
              ...(storedRun ? { runId: storedRun.sourceSqliteId } : {}),
            };
          },
          { applySession: options.applyWorkspaceSession },
        );
      }
    },
  };
}

async function prepareWorkflowRun(
  trx: WorkspaceTransaction,
  input: WorkflowExecutionJobPlan,
): Promise<PreparedWorkflowRun> {
  const workflow = await loadWorkflow(trx, input.workspaceId, input.workflowId);
  if (!workflow) {
    return {
      ok: false,
      workflow: null,
      message: null,
      error: 'Workflow nicht gefunden',
      log: ['error:workflow_not_found'],
    };
  }

  const trigger = normalizeWorkflowTrigger(input.triggerName ?? workflow.trigger_name);
  const direction = workflowDirectionForTrigger(trigger);
  const delayedJob = input.delayedJobId === undefined
    ? null
    : await loadDelayedJob(trx, input.workspaceId, input.delayedJobId, Number(workflow.id));
  if (input.delayedJobId !== undefined && !delayedJob) {
    return {
      ok: false,
      workflow,
      message: null,
      error: 'delayed_job_not_found',
      log: ['error:delayed_job_not_found'],
    };
  }

  if (delayedJob && delayedJobAuthorizationMismatch(input, delayedJob.message_id)) {
    return {
      ok: false,
      workflow,
      message: null,
      error: 'delayed_job_authorization_mismatch',
      log: ['error:delayed_job_authorization_mismatch'],
    };
  }

  const messageId = input.messageId ?? delayedJob?.message_id ?? undefined;
  if (
    input.messageId !== undefined
    && delayedJob !== null
    && normalizeDelayedJobMessageId(delayedJob.message_id) !== input.messageId
  ) {
    return {
      ok: false,
      workflow,
      message: null,
      error: 'delayed_job_message_mismatch',
      log: ['error:delayed_job_message_mismatch'],
    };
  }

  const message = messageId === undefined || messageId === null
    ? null
    : await loadMessage(trx, input.workspaceId, Number(messageId));
  if (messageId !== undefined && messageId !== null && !message) {
    return {
      ok: false,
      workflow,
      message: null,
      error: 'Nachricht nicht gefunden',
      log: ['error:message_not_found'],
    };
  }

  const jobContext = mergeJobContexts(delayedJob?.context_json, input.context);
  const resumeNodeId = delayedJob?.resume_node_id
    ?? stringFromContext(jobContext.resumeNodeId)
    ?? null;
  if (delayedJob && (delayedJob.status === 'done' || delayedJob.status === 'cancelled')) {
    return {
      ok: false,
      workflow,
      message,
      error: delayedJob.status === 'cancelled' ? 'delayed_job_cancelled' : 'delayed_job_done',
      log: [delayedJob.status === 'cancelled' ? 'skip:delayed_job_cancelled' : 'skip:delayed_job_done'],
    };
  }
  if (delayedJob && !resumeNodeId) {
    return {
      ok: false,
      workflow,
      message,
      error: 'delayed_job_resume_node_missing',
      log: ['error:delayed_job_resume_node_missing'],
    };
  }
  if (workflowTriggerNeedsMessage(trigger) && !message && !contextHasOutbound(jobContext)) {
    return {
      ok: false,
      workflow,
      message,
      error: 'Fuer diesen Trigger ist eine Nachricht-ID erforderlich',
      log: ['error:message_required'],
    };
  }

  return {
    ok: true,
    workflow,
    trigger,
    direction,
    message,
    jobContext,
    resumeNodeId,
    delayedJob,
  };
}

function delayedJobAuthorizationMismatch(
  input: WorkflowExecutionJobPlan,
  actualMessageId: unknown,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(input, 'authorizedDelayedJobMessageId')) return true;
  return input.authorizedDelayedJobMessageId !== normalizeDelayedJobMessageId(actualMessageId);
}

function normalizeDelayedJobMessageId(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : Number.NaN;
}

function dryRunFailure(
  errorMessage: string,
  log: readonly string[],
  ids: { workflowId?: number; messageId?: number } = {},
): WorkflowExecutionDryRunResult {
  return {
    success: false,
    dryRun: true,
    ...ids,
    status: 'error',
    blocked: false,
    blockReason: null,
    log,
    error: errorMessage,
  };
}

async function loadDelayedJob(
  trx: WorkspaceTransaction,
  workspaceId: string,
  delayedJobId: number,
  workflowId: number,
): Promise<DelayedJobRow | null> {
  const row = await trx
    .selectFrom('workflow_delayed_jobs')
    .select([
      'id',
      'workflow_id',
      'message_id',
      'message_source_sqlite_id',
      'resume_node_id',
      'context_json',
      'status',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', delayedJobId)
    .where('workflow_id', '=', workflowId)
    .forUpdate()
    .executeTakeFirst();
  return row ?? null;
}

async function loadMessage(
  trx: WorkspaceTransaction,
  workspaceId: string,
  messageId: number,
): Promise<MessageRow | null> {
  const row = await trx
    .selectFrom('email_messages')
    .select([
      'id',
      'source_sqlite_id',
      'account_id',
      'subject',
      'from_json',
      'to_json',
      'cc_json',
      'snippet',
      'body_text',
      'body_html',
      'has_attachments',
      'attachments_json',
      'customer_id',
      'customer_source_sqlite_id',
      'auth_spf',
      'auth_dkim',
      'auth_dmarc',
      'auth_arc',
      'rspamd_score',
      'rspamd_action',
      'is_spam',
      'spam_status',
      'spam_score',
      'spam_score_label',
      'spam_decision_source',
      'spam_score_breakdown_json',
      // Anti-Loop-Guards (email.auto_reply / email.send_draft) prüfen
      // Auto-Submitted/X-Auto-Response-Suppress/Precedence/List-Header.
      'raw_headers',
      'reply_parent_message_id',
    ])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', messageId)
    .executeTakeFirst();
  return row ?? null;
}

async function wasInboundWorkflowApplied(
  trx: WorkspaceTransaction,
  workspaceId: string,
  workflow: WorkflowRow,
  message: MessageRow,
): Promise<boolean> {
  const row = await trx
    .selectFrom('email_message_workflow_applied')
    .select(['id'])
    .where('workspace_id', '=', workspaceId)
    .where('message_source_sqlite_id', '=', Number(message.source_sqlite_id))
    .where('workflow_source_sqlite_id', '=', workflowSourceSqliteId(workflow))
    .executeTakeFirst();
  return Boolean(row);
}

async function markInboundWorkflowApplied(
  trx: WorkspaceTransaction,
  workspaceId: string,
  workflow: WorkflowRow,
  message: MessageRow,
  now: Date,
): Promise<void> {
  const messageSourceSqliteId = Number(message.source_sqlite_id);
  const workflowSource = workflowSourceSqliteId(workflow);
  await trx
    .insertInto('email_message_workflow_applied')
    .values({
      workspace_id: workspaceId,
      source_sqlite_id: serverCreatedSourceSqliteId(
        'email_message_workflow_applied',
        workspaceId,
        String(messageSourceSqliteId),
        String(workflowSource),
      ),
      message_source_sqlite_id: messageSourceSqliteId,
      workflow_source_sqlite_id: workflowSource,
      message_id: Number(message.id),
      workflow_id: Number(workflow.id),
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      applied_at: now,
      updated_at: now,
    })
    .onConflict((oc) => oc
      .columns(['workspace_id', 'message_source_sqlite_id', 'workflow_source_sqlite_id'])
      .doUpdateSet({
        message_id: Number(message.id),
        workflow_id: Number(workflow.id),
        applied_at: now,
        updated_at: now,
        source_row: serverWorkerSourceRow(),
      }))
    .execute();
}

async function markDelayedJobStatus(
  trx: WorkspaceTransaction,
  workspaceId: string,
  delayedJobId: number,
  status: 'pending' | 'running' | 'done' | 'failed',
  now: Date,
): Promise<boolean> {
  let query = trx
    .updateTable('workflow_delayed_jobs')
    .set({
      status,
      updated_at: now,
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', delayedJobId);
  // Do not revive/overwrite a job that ops cancelled (claim race or finish race).
  if (status === 'running') {
    query = query.where('status', 'in', ['pending', 'running']);
  } else if (status === 'done' || status === 'failed') {
    query = query.where('status', 'in', ['pending', 'running']);
  }
  const row = await query.returning('id').executeTakeFirst();
  return row !== undefined;
}

async function startOrReuseRun(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    workflow: WorkflowRow;
    message: MessageRow | null;
    direction: WorkflowDirection;
    requestedRunId?: number;
    now: Date;
    /** Testlauf (Plan 047); nie zusammen mit requestedRunId. */
    dryRun?: boolean;
  },
): Promise<{ id: number; sourceSqliteId: number }> {
  if (input.requestedRunId !== undefined) {
    const existing = await trx
      .selectFrom('email_workflow_runs')
      .select(['id', 'source_sqlite_id'])
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', input.requestedRunId)
      .executeTakeFirst();
    if (existing) {
      const id = Number(existing.id);
      const sourceSqliteId = nullableSourceSqliteId(existing.source_sqlite_id, id);
      await trx
        .updateTable('email_workflow_runs')
        .set({
          workflow_id: Number(input.workflow.id),
          workflow_source_sqlite_id: workflowSourceSqliteId(input.workflow),
          message_id: input.message === null ? null : Number(input.message.id),
          message_source_sqlite_id: input.message === null ? null : Number(input.message.source_sqlite_id),
          direction: input.direction,
          status: 'running',
          // Persist the (synthetic) source id so run-step lookups by source match
          // the run_source_sqlite_id written onto the steps.
          source_sqlite_id: sourceSqliteId,
          started_at: input.now,
          finished_at: null,
          updated_at: input.now,
        })
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', id)
        .execute();
      return { id, sourceSqliteId };
    }
  }

  const inserted = await trx
    .insertInto('email_workflow_runs')
    .values({
      workspace_id: input.workspaceId,
      source_sqlite_id: null,
      workflow_source_sqlite_id: workflowSourceSqliteId(input.workflow),
      message_source_sqlite_id: input.message === null ? null : Number(input.message.source_sqlite_id),
      workflow_id: Number(input.workflow.id),
      message_id: input.message === null ? null : Number(input.message.id),
      direction: input.direction,
      status: 'running',
      // jsonb column: node-postgres serializes a JS array as a Postgres array
      // literal ({...}), which is invalid JSON. Pass a JSON string instead.
      log_json: JSON.stringify([] as string[]),
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      started_at: input.now,
      finished_at: null,
      updated_at: input.now,
      ...(input.dryRun === true ? { dry_run: true } : {}),
    })
    .returning(['id', 'source_sqlite_id'])
    .executeTakeFirstOrThrow();
  const id = Number(inserted.id);
  const sourceSqliteId = nullableSourceSqliteId(inserted.source_sqlite_id, id);
  if (inserted.source_sqlite_id === null || inserted.source_sqlite_id === undefined) {
    // Worker-created run: persist the synthetic source id (-id) so run-step
    // lookups by source resolve (the steps carry run_source_sqlite_id = -id).
    await trx
      .updateTable('email_workflow_runs')
      .set({ source_sqlite_id: sourceSqliteId })
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', id)
      .execute();
  }
  return { id, sourceSqliteId };
}

async function finishExistingRun(
  trx: WorkspaceTransaction,
  workspaceId: string,
  runId: number,
  input: { status: WorkflowRunStatus; log: string[]; now: Date },
): Promise<void> {
  await trx
    .updateTable('email_workflow_runs')
    .set({
      status: input.status,
      // jsonb column: stringify the array so node-postgres sends valid JSON
      // instead of a Postgres array literal ({...}) -> 22P02 invalid input.
      log_json: JSON.stringify(input.log),
      finished_at: input.now,
      updated_at: input.now,
    })
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', runId)
    .execute();
}

async function finishRun(
  trx: WorkspaceTransaction,
  workspaceId: string,
  runId: number,
  input: { status: WorkflowRunStatus; log: string[]; now: Date },
): Promise<void> {
  await finishExistingRun(trx, workspaceId, runId, input);
}

async function runServerWorkflowGraph(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    workflow: WorkflowRow;
    context: ServerWorkflowContext;
    startNodeId?: string | null;
    now: Date;
    dryRun?: boolean;
    /** Testlauf (Plan 047): Schritte trotz Probelauf speichern, sonst keine Seiteneffekte. */
    recordSteps?: boolean;
    ports: ServerWorkflowRuntimePorts;
  },
): Promise<GraphRunResult> {
  if (input.workflow.execution_mode === 'compiled') {
    return blockedResult('compiled_unsupported:server_workflow_execution');
  }

  const doc = parseWorkflowGraph(input.workflow.graph_json);
  if (!doc) {
    return definitionHasRules(input.workflow.definition_json)
      ? blockedResult('legacy_definition_unsupported:server_workflow_execution')
      : { status: 'ok', blocked: false, deferred: false, blockReason: null, log: ['graph_empty:keine ausführbaren Knoten'] };
  }

  if (input.startNodeId) {
    if (!doc.nodes.some((node) => node.id === input.startNodeId)) {
      return blockedResult(`resume_node_missing:${input.startNodeId}`);
    }
    const rawHops = input.context.variables[CONTINUATION_HOPS_VARIABLE];
    const hops = (typeof rawHops === 'number' && Number.isInteger(rawHops) && rawHops >= 0 ? rawHops : 0) + 1;
    input.context.variables[CONTINUATION_HOPS_VARIABLE] = hops;
    if (hops > MAX_WORKFLOW_CONTINUATION_HOPS) {
      const message = `Fortsetzungs-Limit ${MAX_WORKFLOW_CONTINUATION_HOPS} ueberschritten (moeglicher Kreis ueber einen asynchronen Knoten) — Lauf abgebrochen`;
      return {
        status: 'error',
        blocked: false,
        deferred: false,
        blockReason: message,
        log: [`graph_resume:${input.startNodeId}`, `error:continuation_hop_limit:${MAX_WORKFLOW_CONTINUATION_HOPS}`],
      };
    }
    return walkGraph(trx, {
      doc,
      context: input.context,
      startNodeId: input.startNodeId,
      log: [`graph_resume:${input.startNodeId}`],
      now: input.now,
      dryRun: input.dryRun === true,
      recordSteps: input.recordSteps === true,
      ports: input.ports,
      inboundGate: inboundGateFromContext(input.context),
    });
  }

  const triggerNode = doc.nodes.find((node) => {
    if (node.type !== 'trigger') return false;
    const kind = String((node.data as Record<string, unknown>).kind ?? '');
    return kind === input.context.trigger || !kind;
  }) ?? doc.nodes.find((node) => node.type === 'trigger');
  if (!triggerNode) {
    return blockedResult('trigger_missing:server_workflow_execution');
  }

  const triggerEdges = outgoing(doc.edges, triggerNode.id);
  if (triggerEdges.length === 0) {
    if (input.dryRun !== true || input.recordSteps === true) {
      await insertRunStep(trx, input.context, triggerNode, {
        status: 'ok',
        port: 'default',
        message: null,
        durationMs: 0,
        now: input.now,
        detail: serverStepDetail(input.context, {
          variablesBefore: input.context.variables,
          port: 'default',
          note: 'Der Auslöser ist mit keinem Knoten verbunden – es wurde nichts ausgeführt.',
        }),
      });
    }
    return { status: 'ok', blocked: false, deferred: false, blockReason: null, log: ['trigger_no_edges'] };
  }

  const log: string[] = [];
  let result: GraphRunResult = { status: 'ok', blocked: false, deferred: false, blockReason: null, log };
  let deferredBranchCount = 0;
  // One node budget for the whole run, shared by every trigger branch.
  const totalSteps = { count: 0 };
  for (const [branchIndex, edge] of triggerEdges.entries()) {
    const branchContext = cloneServerWorkflowContext(input.context);
    branchContext.branchKey = edge.id || String(branchIndex);
    const branch = await walkGraph(trx, {
      doc,
      context: branchContext,
      startNodeId: edge.target,
      log,
      now: input.now,
      dryRun: input.dryRun === true,
      recordSteps: input.recordSteps === true,
      ports: input.ports,
      inboundGate: branchContext.direction === 'inbound' ? { conditionOk: false } : undefined,
      totalSteps,
    });
    if (branch.deferred) deferredBranchCount += 1;
    result = {
      ...branch,
      deferred: result.deferred === true || branch.deferred === true,
      deferredBranchCount,
      deferredNodeIds: [...(result.deferredNodeIds ?? []), ...(branch.deferredNodeIds ?? [])],
      // Preserve an earlier sibling error — a later ok branch must not flip the
      // run back to success (would mark inbound applied and advance the chain).
      status: result.status === 'error' || branch.status === 'error' ? 'error' : branch.status,
      log,
    };
    if (branch.blocked) return { ...result, deferredBranchCount };
    if (branch.inboundChainStop) return { ...result, deferredBranchCount };
    // Keep walking sibling trigger branches after a deferred async/delay node.
    // Chain advance waits for all deferred siblings via inboundDeferredJoin.
  }
  return { ...result, deferredBranchCount };
}

function cloneServerWorkflowContext(context: ServerWorkflowContext): ServerWorkflowContext {
  return {
    ...context,
    strings: { ...context.strings },
    variables: { ...context.variables },
  };
}

async function walkGraph(
  trx: WorkspaceTransaction,
  input: {
    doc: WorkflowGraphDocument;
    context: ServerWorkflowContext;
    startNodeId: string;
    log: string[];
    now: Date;
    dryRun: boolean;
    /** Testlauf: Schritte trotz Probelauf speichern (siehe runServerWorkflowGraph). */
    recordSteps?: boolean;
    ports: ServerWorkflowRuntimePorts;
    seen?: Set<string>;
    allowRevisit?: boolean;
    stopBeforeNodeIds?: ReadonlySet<string>;
    inboundGate?: ServerInboundBranchGate;
    /** Step counter of this walk; the block-port branch keeps counting (desktop parity). */
    steps?: { count: number };
    /** Node executions of the whole run, shared by every loop iteration. */
    totalSteps?: { count: number };
    /** Walk of a loop's each branch: deferring nodes are rejected there (F-A9-04). */
    insideLoopBody?: boolean;
  },
): Promise<GraphRunResult> {
  const nodesById = new Map(input.doc.nodes.map((node) => [node.id, node]));
  const seen = input.seen ?? new Set<string>();
  let currentId: string | undefined = input.startNodeId;
  const steps = input.steps ?? { count: 0 };
  const totalSteps = input.totalSteps ?? { count: 0 };

  while (currentId) {
    if (input.stopBeforeNodeIds?.has(currentId)) break;
    if (steps.count++ >= MAX_GRAPH_STEPS || totalSteps.count++ >= MAX_GRAPH_TOTAL_STEPS) {
      return blockedResult('graph_step_limit:server_workflow_execution', input.log);
    }
    if (input.allowRevisit !== true && seen.has(currentId)) {
      input.log.push(`cycle:${currentId}`);
      break;
    }
    seen.add(currentId);

    const node = nodesById.get(currentId);
    if (!node) break;

    if (
      input.context.direction === 'inbound'
      && input.inboundGate
      && inboundNodeRequiresConditionGate(node)
      && !input.inboundGate.conditionOk
    ) {
      input.log.push(`skip:${node.id}:no_prior_condition`);
      // Record the skip as a run step so the run history shows *why* nothing
      // happened (otherwise an inbound side-effect node is silently dropped and
      // the run looks like an empty "OK").
      if (!input.dryRun || input.recordSteps) {
        await insertRunStep(trx, input.context, node, {
          status: 'skipped',
          port: 'blocked',
          message: 'übersprungen: keine vorausgehende erfüllte Bedingung (Inbound-Schutz)',
          durationMs: 0,
          now: input.now,
          detail: serverStepDetail(input.context, {
            config: nodeConfig(node),
            variablesBefore: input.context.variables,
            port: 'blocked',
            note: 'Nicht ausgeführt: Aktionen auf eingehende Mails laufen nur hinter einer erfüllten Bedingung (z. B. Ausgang „Ja“ einer Bedingung oder KI-Entscheidung).',
          }),
        });
      }
      break;
    }

    if (nodeRuntimeType(node) === 'logic.loop') {
      const loopEdges = outgoing(input.doc.edges, currentId);
      const eachEdge = pickEdge(loopEdges, 'each');
      const doneEdge = pickEdge(loopEdges, 'done');
      if (eachEdge || doneEdge) {
        const started = Date.now();
        const items = workflowLoopItems(nodeConfig(node), input.context, input.log);
        const activeItems = eachEdge ? items : [];
        if (!input.dryRun || input.recordSteps) {
          await insertRunStep(trx, input.context, node, {
            status: 'ok',
            port: activeItems.length > 0 ? 'each' : 'done',
            message: activeItems.length > 0
              ? `loop_items:${activeItems.length}`
              : eachEdge
                ? 'loop_empty'
                : 'loop_each_missing',
            durationMs: Math.max(0, Date.now() - started),
            now: input.now,
            detail: serverStepDetail(input.context, {
              config: nodeConfig(node),
              variablesBefore: input.context.variables,
              port: activeItems.length > 0 ? 'each' : 'done',
              result: { items: activeItems },
            }),
          });
        }

        if (!eachEdge || activeItems.length === 0) {
          input.log.push(eachEdge ? 'loop:empty' : 'loop:each_missing');
          currentId = doneEdge?.target;
          continue;
        }

        // Stop points of enclosing loops stay active, otherwise nested loops
        // restart each other (L1 -> L2 -> L1) without bound.
        const stopBeforeNodeIds = new Set<string>(input.stopBeforeNodeIds);
        stopBeforeNodeIds.add(currentId);
        if (doneEdge?.target) stopBeforeNodeIds.add(doneEdge.target);
        for (let index = 0; index < activeItems.length; index += 1) {
          const item = activeItems[index]!;
          input.context.variables['loop.item'] = item;
          input.context.variables['loop.index'] = index;
          input.log.push(`loop:${index}:${item}`);
          const branchResult = await walkGraph(trx, {
            doc: input.doc,
            context: input.context,
            startNodeId: eachEdge.target,
            log: input.log,
            now: input.now,
            dryRun: input.dryRun,
            recordSteps: input.recordSteps,
            ports: input.ports,
            seen: new Set<string>(),
            allowRevisit: true,
            stopBeforeNodeIds,
            inboundGate: input.inboundGate,
            insideLoopBody: true,
            totalSteps,
          });
          if (branchResult.status !== 'ok' || branchResult.blocked || branchResult.deferred) {
            return branchResult;
          }
        }

        currentId = doneEdge?.target;
        continue;
      }
    }

    const started = Date.now();
    const variablesBefore = { ...input.context.variables };
    // Eine Fortsetzung kennt den Schleifenzustand nicht: die uebrigen Eintraege
    // gingen verloren, eine Rueckkante startete die Schleife endlos neu. Deshalb
    // vor dem Einreihen abbrechen statt still nur den ersten Eintrag zu bearbeiten.
    // Die Ausgangs-Vorschau fuehrt KI-Pruefungen synchron aus; dort deferieren sie nicht.
    const previewRunsReviewSynchronously = input.dryRun && (
      (input.context.previewOutbound
        && ['ai.outbound_review', 'ai.review', 'ai_review', 'ai.decide'].includes(nodeRuntimeType(node)))
      || (input.context.testRealAi === true && nodeRuntimeType(node) === 'ai.decide')
    );
    const loopBodyDeferral = input.insideLoopBody === true
      && !previewRunsReviewSynchronously
      && workflowNodeDefersRun(input.doc, node, 'server');
    const result = withNodeChainStop(node, loopBodyDeferral
      ? {
        status: 'error',
        port: 'error',
        message: `„${node.id}“ läuft asynchron weiter und ist im Je-Eintrag-Zweig einer Schleife nicht erlaubt — Knoten hinter den Fertig-Ausgang der Schleife verschieben`,
      }
      : await executeServerNode(
        trx,
        input.doc,
        input.context,
        node,
        input.log,
        input.now,
        input.ports,
        input.dryRun,
      ));
    const durationMs = Math.max(0, Date.now() - started);
    if (!input.dryRun || input.recordSteps) {
      await insertRunStep(trx, input.context, node, {
        status: result.status,
        port: result.port ?? null,
        message: result.message ?? null,
        durationMs,
        now: input.now,
        detail: serverStepDetail(input.context, {
          config: nodeConfig(node),
          variablesBefore,
          variablesOut: result.variables ?? null,
          port: result.port ?? null,
          ...(result.blocked && result.blockReason ? { result: { blockReason: result.blockReason } } : {}),
          note: result.deferred
            ? deferredStepNote(node)
            : unwiredPortNoteForResult(input.doc, node, result),
        }),
      });
    }

    if (result.variables) {
      const reserved = RESERVED_WORKFLOW_VARIABLES.map((name) => [name, input.context.variables[name]] as const);
      Object.assign(input.context.variables, result.variables);
      for (const [name, value] of reserved) {
        if (value === undefined) {
          delete input.context.variables[name];
        } else {
          input.context.variables[name] = value;
        }
      }
    }
    // Inbound gate: condition.yes, auto_reply.approved, threshold.yes oder
    // ein getroffener switch-Fall autorisieren nachgelagerte Side-Effect-
    // Knoten — gleiche harte (nodeType, port)-Liste wie die Desktop-Runtime
    // (electron/workflow/runtime.ts), bewusst KEINE Schema-Ableitung: welcher
    // Ausgang als "bestandene Bedingung" zählt, ist ein Sicherheitsmechanismus.
    // Ohne den switch-Fall bliebe z. B. der blocked→switch(low_confidence)→tag-
    // Pfad der Auto-Antwort-Vorlagen im Server-Modus als no_prior_condition
    // hängen.
    const gateRegistryType = node.type === 'registry' ? nodeRuntimeType(node) : null;
    const trippedInboundGate =
      (node.type === 'condition' && result.port === 'yes')
      || (gateRegistryType === 'email.auto_reply' && result.port === 'approved')
      || (gateRegistryType === 'logic.threshold' && result.port === 'yes')
      || (gateRegistryType === 'logic.switch'
        && typeof result.port === 'string'
        && result.port !== 'default')
      // KI-Entscheidung: alle vier Ausgänge (ja, nein, unsicher, KI-Fehler) sind
      // bewusst verdrahtete Zweige wie ein switch-Fall (Desktop-Parität).
      || (gateRegistryType === 'ai.decide' && aiDecidePortTripsInboundGate(result.port));
    if (trippedInboundGate && input.inboundGate) {
      input.inboundGate.conditionOk = true;
      input.context.variables.__inbound_condition_ok = true;
    }
    // Hold as side effect, but still follow an *explicit* block/error port so
    // template branches (tags, notifications) run before finishing blocked.
    // Do NOT follow ports for ordinary status:'error' (e.g. Continuation-Kontext
    // overflow) or port:'blocked' unsupported-node results — those must stop.
    // Leere Gründe zählen als fehlend (`??` behielt ''): einheitlicher Fallback.
    const pendingBlockReason = result.blocked
      ? outboundHoldReasonOrFallback(result.blockReason?.trim() || result.message)
      : null;
    if (result.blocked && !input.dryRun && input.context.direction === 'outbound' && input.context.messageId !== null) {
      // Endgültiger Block: echter Grund im Banner, Planung eines Workflow-
      // Versands gelöscht, damit der Entwurf im Posteingang erscheint.
      await persistOutboundBlockOnDraft(trx, {
        workspaceId: input.context.workspaceId,
        messageId: input.context.messageId,
        reason: pendingBlockReason,
        now: input.now,
      });
    }
    if (result.status === 'error') {
      return {
        status: 'error',
        blocked: false,
        deferred: false,
        blockReason: result.message ?? null,
        log: input.log,
      };
    }
    if (result.blocked) {
      const blockPort = typeof result.port === 'string' ? result.port : '';
      // ai.decide hält den Versand auch über „nein“/„unsicher“ an; diese
      // Ausgänge laufen wie block/error nur noch für Zusatzschritte.
      const followBlockPort = blockPort === 'block' || blockPort === 'error'
        || (nodeRuntimeType(node) === 'ai.decide' && aiDecideAnswerHoldsOutbound(blockPort));
      const outs = outgoing(input.doc.edges, currentId);
      const blockEdge = followBlockPort ? pickEdge(outs, blockPort) : undefined;
      if (blockEdge) {
        const branch = await walkGraph(trx, {
          ...input,
          startNodeId: blockEdge.target,
          seen,
          steps,
          totalSteps,
        });
        if (branch.blocked || branch.status === 'blocked') return branch;
        if (branch.deferred) {
          return {
            ...branch,
            status: 'blocked',
            blocked: true,
            blockReason: pendingBlockReason,
          };
        }
        if (branch.status === 'error') return branch;
        return {
          status: 'blocked',
          blocked: true,
          deferred: false,
          blockReason: pendingBlockReason,
          log: branch.log,
        };
      }
      return {
        status: 'blocked',
        blocked: true,
        deferred: false,
        blockReason: pendingBlockReason,
        log: input.log,
      };
    }
    if (result.stop) {
      input.log.push('stop');
      return {
        status: 'ok',
        blocked: false,
        deferred: result.deferred === true,
        // Ordinary logic.stop ends only this workflow; only spam short-circuit
        // (stop_after_spam / stopFurtherWorkflows) terminates the priority chain.
        inboundChainStop: result.inboundChainStop === true && result.deferred !== true,
        ...(result.deferred === true ? { deferredNodeIds: [node.id] } : {}),
        blockReason: null,
        log: input.log,
      };
    }

    const next = pickEdge(outgoing(input.doc.edges, currentId), result.port ?? 'default');
    currentId = next?.target;
  }

  return { status: 'ok', blocked: false, deferred: false, blockReason: null, log: input.log };
}

function workflowLoopItems(
  config: Record<string, unknown>,
  context: ServerWorkflowContext,
  log: string[],
): string[] {
  const sourceKey = String(config.sourceVariable ?? 'attachment_names').trim() || 'attachment_names';
  const raw = String(context.strings[sourceKey] ?? '')
    || String(context.variables[sourceKey] ?? '')
    || String(config.items ?? '');
  const allItems = raw
    .split(/[,;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const maxItems = boundedWorkflowLoopItems(config.maxItems);
  if (allItems.length > maxItems) log.push(`loop:limit:${maxItems}`);
  return allItems.slice(0, maxItems);
}

function boundedWorkflowLoopItems(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(String(value ?? 50).trim());
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(MAX_WORKFLOW_LOOP_ITEMS, Math.trunc(parsed)));
}

/**
 * Knotenergebnis einer KI-Entscheidung. Im Ausgang hält alles außer „ja“ den
 * Versand an (blocked + Grund); der Ausgang läuft dann nur für Zusatzschritte.
 */
function aiDecideNodeResult(context: ServerWorkflowContext, outcome: AiDecideOutcome): NodeResult {
  const variables = aiDecideVariables(outcome);
  const blockReason = context.direction === 'outbound' ? aiDecideOutboundBlockReason(outcome) : null;
  return blockReason
    ? { status: 'ok', port: outcome.answer, blocked: true, blockReason, message: outcome.summary, variables }
    : { status: 'ok', port: outcome.answer, message: outcome.summary, variables };
}

/** Rohe Konfigfelder von ai.decide, gekürzt auf die Grenzen des Job-Plans. */
function aiDecideConfigText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

async function executePreviewAiDecide(
  ports: ServerWorkflowRuntimePorts,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  if (!ports.aiDecide) {
    return aiDecideNodeResult(context, aiDecideErrorOutcome({ message: 'Server-KI nicht konfiguriert' }));
  }
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return aiDecideNodeResult(context, aiDecideErrorOutcome({ message: profileId.message }));
  const scope = { strings: context.strings, variables: context.variables };
  const deps = ports.aiDecide;
  const request = {
    workspaceId: context.workspaceId,
    messageId: context.messageId,
    actorUserId: context.actorUserId ?? null,
    ...(profileId.value === undefined ? {} : { profileId: profileId.value }),
    direction: context.direction,
    question: interpolateAiDecideField(
      aiDecideConfigText(config.question, AI_DECIDE_QUESTION_MAX_CHARS),
      scope,
      AI_DECIDE_QUESTION_MAX_CHARS,
    ),
    yesCriteria: interpolateAiDecideField(
      aiDecideConfigText(config.yesCriteria, AI_DECIDE_CRITERIA_MAX_CHARS),
      scope,
      AI_DECIDE_CRITERIA_MAX_CHARS,
    ),
    noCriteria: interpolateAiDecideField(
      aiDecideConfigText(config.noCriteria, AI_DECIDE_CRITERIA_MAX_CHARS),
      scope,
      AI_DECIDE_CRITERIA_MAX_CHARS,
    ),
    contextMode: normalizeAiDecideContextMode(config.contextMode),
    threshold: normalizeAiDecideThreshold(config.threshold),
    strings: context.strings,
  };
  const outcome = await callPreviewAi(ports, 'ai.decide', request, () => runServerAiDecision(deps, request));
  return aiDecideNodeResult(context, outcome);
}

async function executePreviewOutboundAiReview(
  trx: WorkspaceTransaction,
  ports: ServerWorkflowRuntimePorts,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  type: 'ai.outbound_review' | 'ai.review' | 'ai_review',
): Promise<NodeResult> {
  if (!ports.aiReviewPreview) {
    const message = 'KI-Vorschau nicht verfuegbar';
    return {
      status: 'error',
      port: 'error',
      blocked: true,
      blockReason: message,
      message,
    };
  }
  const promptId = optionalPositiveIntegerConfig(config.promptId, 'promptId');
  if (!promptId.ok) return { status: 'error', port: 'error', message: promptId.message };
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const blockKeyword = workflowAiBlockKeyword(config.blockKeyword);
  if (!blockKeyword.ok) return { status: 'error', port: 'error', message: blockKeyword.message };

  const runner = ports.aiReviewPreview;
  const request = {
    workspaceId: context.workspaceId,
    direction: context.direction === 'inbound' ? 'inbound' as const : 'outbound' as const,
    ...(promptId.value === undefined ? {} : { promptId: promptId.value }),
    ...(profileId.value === undefined ? {} : { profileId: profileId.value }),
    blockKeyword: blockKeyword.value,
    ...(type === 'ai.outbound_review'
      ? {
        parseMode: 'outbound_structured' as const,
        systemPrompt: typeof config.systemPrompt === 'string' && config.systemPrompt.trim()
          ? config.systemPrompt.trim()
          : workflowOutboundReviewSystemPrompt(),
        fallbackUserTemplate: typeof config.fallbackUserTemplate === 'string' && config.fallbackUserTemplate.trim()
          ? config.fallbackUserTemplate.trim()
          : await buildOutboundReviewUserTemplate(trx, context, config),
      }
      : { parseMode: 'block_keyword' as const }),
    eventStrings: context.strings,
    eventVariables: context.variables,
  };
  const preview = await callPreviewAi(ports, 'ai.review.preview', request, () => runner(request));

  if (!preview.ok) {
    return {
      status: 'ok',
      port: 'block',
      blocked: true,
      blockReason: preview.reason,
      message: preview.reason,
      variables: {
        'ai.outbound_review.verdict': 'block',
        'ai.outbound_review.reason': preview.reason,
      },
    };
  }
  return {
    status: 'ok',
    port: 'ok',
    message: 'preview_ai:ok',
    variables: { 'ai.outbound_review.verdict': 'ok', 'ai.outbound_review.reason': '' },
  };
}

/** Knoten ai.decide (vor dem Dry-Run-Schutz). */
async function handleAiDecide({ trx, doc, context, node, config, log, now, ports, dryRun }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  if (dryRun && (context.previewOutbound || context.testRealAi)) {
    // Versandvorschau: echte Entscheidung, sonst übersprange eine dort
    // erteilte Freigabe die KI-Entscheidung beim eigentlichen Versand.
    // Testlauf mit „KI wirklich fragen“ (Plan 047): ebenso synchron, ohne Job.
    return await executePreviewAiDecide(ports, context, config);
  }
  if (dryRun) {
    // Testlauf: keine KI-Anfrage, Ergebnis „unsicher“.
    log.push('dry_run:ai.decide');
    return aiDecideNodeResult(context, aiDecideDryRunOutcome());
  }
  return await scheduleAiDecideJob(trx, doc, context, node, config, now);
}

/** Knoten ai.outbound_review (vor dem Dry-Run-Schutz). */
async function handlePreviewAiOutboundReview({ trx, context, config, type, ports, dryRun }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  if (!(dryRun && context.previewOutbound)) return null;
  if (type === 'ai.outbound_review') {
    if (context.direction !== 'outbound') {
      return { status: 'skipped', port: 'default', message: 'Nur fuer ausgehende Nachrichten' };
    }
    return executePreviewOutboundAiReview(trx, ports, context, config, type);
  }
  return null;
}

/** Knoten ai.review, ai_review (vor dem Dry-Run-Schutz). */
async function handlePreviewAiReview({ trx, context, config, type, ports, dryRun }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  if (!(dryRun && context.previewOutbound)) return null;
  if (type === 'ai.review' || type === 'ai_review') {
    return executePreviewOutboundAiReview(trx, ports, context, config, type);
  }
  return null;
}

/** Knoten ai.learnings_digest (vor dem Dry-Run-Schutz). */
async function handleAiLearningsDigest({ trx, context, config, now, dryRun }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  // TA-P5: prüft vorab und reiht den Auswertungs-Job ein; im Probelauf nur die Vorabprüfung.
  return await executeServerLearningsDigestNode(trx, {
    workspaceId: context.workspaceId,
    workflowId: context.workflowId,
    direction: context.direction,
    config,
    provenance: workflowJobProvenance(context),
    dryRun: Boolean(dryRun),
    now,
  });
}

/** Knoten ai.reply_suggestion. */
async function handleAiReplySuggestion({ trx, context, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const result = await scheduleAiReplySuggestionJob(trx, context, config, now);
  return result ?? { status: 'ok', port: 'default' };
}

/** Knoten ai.outbound_review. */
async function handleAiOutboundReview({ trx, doc, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  if (context.direction !== 'outbound') {
    return { status: 'skipped', port: 'default', message: 'Nur fuer ausgehende Nachrichten' };
  }
  const portResumeTargets = {
    ok: resolveResumeNodeAfterPort(doc, node.id, 'ok'),
    block: resolveResumeNodeAfterPort(doc, node.id, 'block'),
    error: resolveResumeNodeAfterPort(doc, node.id, 'error'),
  };
  const replyParentMessageId = config.checkReplyContext === false
    ? undefined
    : resolveOutboundReplyParentId(context);
  return await scheduleAiReviewJob(trx, doc, context, node, {
    ...config,
    blockKeyword: 'BLOCK',
    systemPrompt: workflowOutboundReviewSystemPrompt(),
    // Parent body is loaded in the ai.review job AFTER content.read ACL —
    // do not bake it into the template under the system role here.
    fallbackUserTemplate: workflowOutboundReviewUserTemplate(),
    parseMode: 'outbound_structured',
    portResumeTargets,
    ...(replyParentMessageId !== undefined ? { replyParentMessageId } : {}),
  }, now);
}

/** Knoten ai.review, ai_review. */
async function handleAiReview({ trx, doc, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await scheduleAiReviewJob(trx, doc, context, node, config, now);
}

/** Knoten ai.classify. */
async function handleAiClassify({ trx, doc, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await scheduleAiClassificationJob(trx, doc, context, node, config, now);
}

/** Knoten ai.transform_text. */
async function handleAiTransformText({ trx, doc, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await scheduleAiTransformTextJob(trx, doc, context, node, config, now);
}

/** Knoten ai.agent. */
async function handleAiAgent({ trx, doc, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const createDraft = booleanConfig(config.createDraft, 'createDraft', true);
  if (!createDraft.ok) return { status: 'error', port: 'error', message: createDraft.message };
  if (context.messageId !== null) {
    const currentMessage = await trx
      .selectFrom('email_messages')
      .select(['id', 'is_spam', 'spam_status', 'spam_score_label'])
      .where('workspace_id', '=', context.workspaceId)
      .where('id', '=', context.messageId)
      .executeTakeFirst();
    if (currentMessage && messageIsSpamOrReview(currentMessage)) {
      return { status: 'skipped', port: 'default', message: 'skip:agent_message_spam_or_review' };
    }
  }
  return await scheduleAiAgentJob(trx, doc, context, node, config, createDraft.value, now);
}

/** Knoten ai.pick_canned. */
async function handleAiPickCanned({ trx, doc, context, node, config, now }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  const createDraft = booleanConfig(config.createDraft, 'createDraft', true);
  if (!createDraft.ok) return { status: 'error', port: 'error', message: createDraft.message };
  return await scheduleAiPickCannedJob(trx, doc, context, node, config, createDraft.value, now);
}

/** Knoten ai.agent_tool. */
async function handleAiAgentTool({ trx, context, config }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  return await executeWorkflowAgentTool(trx, context, config);
}

/** Knoten ai.draft_reply. */
async function handleAiDraftReply({ trx, doc, context, node, config, now, ports, dryRun }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  if (context.direction !== 'inbound' || context.messageId === null) {
    return { status: 'skipped', port: 'default', message: 'Nur fuer eingehende Nachrichten' };
  }
  if (dryRun) {
    if (!ports.aiDraft) {
      return { status: 'error', port: 'error', message: 'KI-Entwurf: Server-KI nicht konfiguriert' };
    }
    return await executeWorkflowAiDraftReply(trx, ports.aiDraft, {
      workspaceId: context.workspaceId,
      messageId: context.messageId,
      config,
      strings: context.strings,
      variables: context.variables,
      actorUserId: context.actorUserId,
      dryRun: true,
      workflowId: context.workflowId,
    });
  }
  return await scheduleAiDraftReplyJob(trx, doc, context, node, config, now);
}

/** Knoten ai.review_draft. */
async function handleAiReviewDraft({ trx, doc, context, node, config, now, ports, dryRun }: ServerNodeHandlerArgs): Promise<NodeResult | null> {
  if (dryRun) {
    if (!ports.aiDraft) {
      return { status: 'error', port: 'error', message: 'KI-Gegenpruefung: Server-KI nicht konfiguriert' };
    }
    return await executeWorkflowAiReviewDraft(trx, ports.aiDraft, {
      workspaceId: context.workspaceId,
      messageId: context.messageId,
      config,
      variables: context.variables,
      strings: context.strings,
      actorUserId: context.actorUserId,
      dryRun: true,
    });
  }
  return await scheduleAiReviewDraftJob(trx, doc, context, node, config, now);
}

/** Plan 043: Knoten vor dem Dry-Run-Schutz (Reihenfolge wie bisher). */
export const PRE_DRY_RUN_GUARD_HANDLERS: ServerNodeHandlerMap = serverNodeHandlerMap({
  ...LOGIC_PRE_GUARD_HANDLERS,
  'ai.decide': handleAiDecide,
  'ai.outbound_review': handlePreviewAiOutboundReview,
  'ai.review': handlePreviewAiReview,
  ai_review: handlePreviewAiReview,
  'ai.learnings_digest': handleAiLearningsDigest,
});

/** Plan 043: alle übrigen Knoten (nach dem Dry-Run-Schutz). */
export const SERVER_NODE_HANDLERS: ServerNodeHandlerMap = serverNodeHandlerMap({
  ...ERP_NODE_HANDLERS,
  ...CRM_NODE_HANDLERS,
  ...INTEGRATION_NODE_HANDLERS,
  ...IMAP_NODE_HANDLERS,
  ...MESSAGE_NODE_HANDLERS,
  ...SPAM_NODE_HANDLERS,
  ...OUTBOUND_NODE_HANDLERS,
  ...LOGIC_NODE_HANDLERS,
  'ai.reply_suggestion': handleAiReplySuggestion,
  'ai.outbound_review': handleAiOutboundReview,
  'ai.review': handleAiReview,
  ai_review: handleAiReview,
  'ai.classify': handleAiClassify,
  'ai.transform_text': handleAiTransformText,
  'ai.agent': handleAiAgent,
  'ai.pick_canned': handleAiPickCanned,
  'ai.agent_tool': handleAiAgentTool,
  'ai.draft_reply': handleAiDraftReply,
  'ai.review_draft': handleAiReviewDraft,
});

async function executeServerNode(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  log: string[],
  now: Date,
  ports: ServerWorkflowRuntimePorts,
  dryRun: boolean,
): Promise<NodeResult> {
  if (node.type === 'trigger') return { status: 'ok', port: 'default' };
  if (node.type === 'condition') {
    const match = matchCondition(conditionFromNodeData(node.data), context.strings);
    const field = String(node.data.field ?? 'unknown');
    log.push(match ? `condition:${field}:yes` : `condition:${field}:no`);
    return { status: 'ok', port: match ? 'yes' : 'no' };
  }

  const type = nodeRuntimeType(node);
  const config = interpolateServerSchemaFields(type, nodeConfig(node), context);
  const args: ServerNodeHandlerArgs = { trx, doc, context, node, config, type, log, now, ports, dryRun };
  const preGuardHandler = serverNodeHandlerFor(PRE_DRY_RUN_GUARD_HANDLERS, type);
  if (preGuardHandler) {
    const preGuardResult = await preGuardHandler(args);
    if (preGuardResult) return preGuardResult;
  }
  if (dryRun) {
    const dryRunResult = dryRunMutatingNodeResult(type, config, node, log);
    if (dryRunResult) return dryRunResult;
    if (!DRY_RUN_LIVE_NODE_TYPES.has(type)) return dryRunFailClosedResult(type, log);
  }
  const handler = serverNodeHandlerFor(SERVER_NODE_HANDLERS, type);
  if (handler) {
    const result = await handler(args);
    if (result) return result;
  }
  return unsupportedWorkflowNodeResult(type, log);
}

async function flushDeferredWorkflowImapEffects(input: {
  effects: readonly DeferredWorkflowImapEffect[];
  db: Kysely<ServerDatabase>;
  workflowImapActions?: ServerWorkflowImapActionPort;
  applyWorkspaceSession?: WorkspaceSessionApplier;
}): Promise<void> {
  if (!input.workflowImapActions || input.effects.length === 0) return;

  for (const effect of input.effects) {
    if (effect.kind === 'set_seen') {
      await input.workflowImapActions.setSeen({
        workspaceId: effect.workspaceId,
        messageId: effect.messageId,
        seen: true,
      });
      continue;
    }

    if (effect.kind === 'move') {
      const moved = await input.workflowImapActions.move({
        workspaceId: effect.workspaceId,
        messageId: effect.messageId,
        targetFolderPath: effect.targetFolderPath,
      });
      if (!moved.ok) continue;
      await withWorkspaceTransaction(
        input.db,
        { workspaceId: effect.workspaceId, role: 'system' },
        async (trx) => {
          await applyWorkflowImapMoveLocalState(trx, effect.context, effect.targetFolderPath, effect.now);
        },
        { applySession: input.applyWorkspaceSession },
      );
      continue;
    }

    const deleted = await input.workflowImapActions.delete({
      workspaceId: effect.workspaceId,
      messageId: effect.messageId,
    });
    if (!deleted.ok) continue;
    await withWorkspaceTransaction(
      input.db,
      { workspaceId: effect.workspaceId, role: 'system' },
      async (trx) => {
        await softDeleteWorkflowMessage(trx, effect.context, effect.now);
      },
      { applySession: input.applyWorkspaceSession },
    );
  }
}

async function scheduleAiReplySuggestionJob(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult | null> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }

  const currentMessage = await trx
    .selectFrom('email_messages')
    .select(['id', 'is_spam', 'spam_status', 'spam_score_label'])
    .where('workspace_id', '=', context.workspaceId)
    .where('id', '=', context.messageId)
    .executeTakeFirst();
  if (currentMessage && messageIsSpamOrReview(currentMessage)) {
    return { status: 'skipped', port: 'default', message: 'skip:message_spam_or_review' };
  }

  const promptId = optionalPositiveIntegerConfig(config.promptId, 'promptId');
  if (!promptId.ok) return { status: 'error', port: 'error', message: promptId.message };
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const force = booleanConfig(config.force, 'force', true);
  if (!force.ok) return { status: 'error', port: 'error', message: force.message };
  const skipIfReady = booleanConfig(config.skipIfReady, 'skipIfReady', true);
  if (!skipIfReady.ok) return { status: 'error', port: 'error', message: skipIfReady.message };
  const trigger = replySuggestionTriggerConfig(config.trigger);
  if (!trigger.ok) return { status: 'error', port: 'error', message: trigger.message };

  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    messageId: context.messageId,
    ...workflowJobProvenance(context),
    force: force.value,
    skipIfReady: skipIfReady.value,
    trigger: trigger.value,
  };
  if (promptId.value !== undefined) payload.promptId = promptId.value;
  if (profileId.value !== undefined) payload.profileId = profileId.value;

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.reply_suggestion',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    message: `queued_ai_reply_suggestion:${jobId}`,
    variables: {
      'reply_suggestion.status': 'pending',
      'reply_suggestion.job_id': jobId,
    },
  };
}

async function scheduleAiClassificationJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }

  const labels = workflowAiClassificationLabels(config.labels);
  if (labels.length === 0) return { status: 'skipped', port: 'default', message: 'keine Labels' };

  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const contextMode = workflowAiClassificationContextMode(config.contextMode);
  if (!contextMode.ok) return { status: 'error', port: 'error', message: contextMode.message };

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  if (resumeNodeId) {
    const continuationContextError = workflowContinuationContextError(context);
    if (continuationContextError) {
      return { status: 'error', port: 'error', message: continuationContextError };
    }
  }
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    messageId: context.messageId,
    ...workflowJobProvenance(context),
    labels,
    contextMode: contextMode.value,
  };
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  if (resumeNodeId) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = resumeNodeId;
    stampBranchKey(payload, context);
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: context.variables,
      ...inboundChainFieldsFromContext(context),
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.classify',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_ai_classify:${jobId}`,
    variables: {
      'ai.classification.status': 'pending',
      'ai.classification.job_id': jobId,
    },
  };
}

async function scheduleAiReviewJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const promptId = optionalPositiveIntegerConfig(config.promptId, 'promptId');
  if (!promptId.ok) return { status: 'error', port: 'error', message: promptId.message };
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const blockKeyword = workflowAiBlockKeyword(config.blockKeyword);
  if (!blockKeyword.ok) return { status: 'error', port: 'error', message: blockKeyword.message };

  const parseMode = config.parseMode === 'outbound_structured' ? 'outbound_structured' as const : undefined;
  const rawPortTargets = objectRecord(config.portResumeTargets);
  const portResumeTargets = rawPortTargets
    ? Object.fromEntries(
      Object.entries(rawPortTargets)
        .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1].trim().length > 0)
        .map(([port, target]) => [port, target.trim()]),
    )
    : undefined;
  const resumeNodeId = parseMode === 'outbound_structured'
    ? (resolveResumeNodeAfterPort(doc, node.id, 'ok') || resolveResumeNodeAfter(doc, node.id))
    : resolveResumeNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    direction: context.direction,
    ...workflowJobProvenance(context),
    blockKeyword: blockKeyword.value,
    eventStrings: boundedContinuationStrings(context.strings),
    eventVariables: context.variables,
  };
  if (parseMode) payload.parseMode = parseMode;
  if (portResumeTargets && Object.keys(portResumeTargets).length > 0) {
    payload.portResumeTargets = portResumeTargets;
  }
  if (typeof config.systemPrompt === 'string' && config.systemPrompt.trim()) {
    payload.systemPrompt = config.systemPrompt.trim();
  }
  if (typeof config.fallbackUserTemplate === 'string' && config.fallbackUserTemplate.trim()) {
    payload.fallbackUserTemplate = config.fallbackUserTemplate.trim();
  }
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (promptId.value !== undefined) payload.promptId = promptId.value;
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  {
    const replyParent = optionalPositiveIntegerConfig(config.replyParentMessageId, 'replyParentMessageId');
    if (!replyParent.ok) {
      return { status: 'error', port: 'error', message: replyParent.message };
    }
    if (replyParent.value !== undefined) payload.replyParentMessageId = replyParent.value;
  }
  if (resumeNodeId) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = resumeNodeId;
    stampBranchKey(payload, context);
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: context.variables,
      ...inboundChainFieldsFromContext(context),
    };
    // BLOCK (und block/error ohne Kante) setzt den Graphen nicht fort.
    payload.terminalChainPayloadForUnwiredPort = unwiredPortChainPayload(
      context,
      terminalChainStamp(context, node),
    );
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.review',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_ai_review:${jobId}`,
    variables: {
      'ai.review.status': 'pending',
      'ai.review.job_id': jobId,
    },
  };
}

async function scheduleAiTransformTextJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const promptId = optionalPositiveIntegerConfig(config.promptId, 'promptId');
  if (!promptId.ok) return { status: 'error', port: 'error', message: promptId.message };
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const targetVariable = workflowAiTargetVariable(config.targetVariable);
  if (!targetVariable.ok) return { status: 'error', port: 'error', message: targetVariable.message };

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    targetVariable: targetVariable.value,
    ...workflowJobProvenance(context),
    eventStrings: boundedContinuationStrings(context.strings),
    eventVariables: context.variables,
  };
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (promptId.value !== undefined) payload.promptId = promptId.value;
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  if (resumeNodeId) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = resumeNodeId;
    stampBranchKey(payload, context);
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: context.variables,
      ...inboundChainFieldsFromContext(context),
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.transform_text',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: Boolean(resumeNodeId),
    deferred: Boolean(resumeNodeId),
    message: `queued_ai_transform_text:${jobId}`,
    variables: {
      'ai.transform_text.status': 'pending',
      'ai.transform_text.job_id': jobId,
      'ai.transform_text.target': targetVariable.value,
    },
  };
}

/**
 * Einmal-Schranke fuer den terminalen HTTP-Abschluss (`workflowTerminalSuccess`).
 *
 * Ohne `terminalNodeId` in der Fortsetzung — etwa aus einem Job der
 * Vorgaengerversion — gibt es keine stabile Identitaet ueber eine erneute
 * Zustellung hinweg; dann wird bewusst NICHT geblockt, sonst bliebe die
 * Barriere haengen. Der seltene Doppelabbau ist das kleinere Uebel als ein
 * garantierter Stillstand.
 */
async function claimTerminalHttpCompletion(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId: number;
    workflowId: number;
    jobContext: Record<string, unknown>;
    now: Date;
  },
): Promise<boolean> {
  const nodeId = typeof input.jobContext.terminalNodeId === 'string'
    ? input.jobContext.terminalNodeId.trim()
    : '';
  if (!nodeId) return true;
  const claimed = await trx
    .insertInto('sync_info')
    .values({
      workspace_id: input.workspaceId,
      // Derselbe Schluessel, den der Graphile-Fehlerpfad ueber
      // terminalChildCompletionKey beansprucht — Begruendung dort. Der
      // Fan-out-Lauf wird wie dort aufgeloest (kein Rueckfall auf diesen Lauf,
      // sonst zeigten Erfolgs- und Fehlerweg auf verschiedene Marker).
      key: terminalChildCompletionKeyFor({
        messageId: input.messageId,
        workflowId: input.workflowId,
        nodeId,
        fanOutRunId: inboundChainFieldsFromRecord(input.jobContext).inboundFanOutRunId ?? null,
      }),
      value: '1',
      last_updated: input.now,
      source_row: { origin: 'inbound_terminal_child' },
      imported_in_run_id: null,
      updated_at: input.now,
    })
    .onConflict((oc) => oc.columns(['workspace_id', 'key']).doNothing())
    .returning('key')
    .executeTakeFirst();
  return Boolean(claimed);
}

/** Workflow- und Kettenkontext eines terminalen Kindjobs; wozu jedes Feld dient, steht in workflow-inbound-terminal-child. */
function terminalChainStamp(context: ServerWorkflowContext, node: WorkflowGraphNode): Record<string, unknown> {
  return {
    workflowId: context.workflowId,
    context: { ...inboundChainFieldsFromContext(context) },
    terminalWorkflowCompletion: true,
    terminalNodeId: terminalNodeExecutionId(context, node),
    triggerName: context.trigger,
  };
}

/**
 * Terminal-Kontext fuer einen deferierten KI-Knoten, dessen Urteils-Port keine
 * Kante hat: dort endet der Zweig im Kindjob wie bei einem terminalen Knoten.
 * Verschachtelt in der Payload, damit failJob und terminalChildCompletionKey
 * den Job nicht selbst als terminal behandeln.
 */
function unwiredPortChainPayload(
  context: ServerWorkflowContext,
  terminalStamp: Record<string, unknown>,
): Record<string, unknown> {
  return {
    workspaceId: context.workspaceId,
    ...(context.messageId !== null ? { messageId: context.messageId } : {}),
    ...workflowJobProvenance(context),
    ...terminalStamp,
  };
}

async function scheduleAiAgentJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  createDraft: boolean,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const knowledgeBaseId = optionalPositiveIntegerConfig(config.knowledgeBaseId, 'knowledgeBaseId');
  if (!knowledgeBaseId.ok) return { status: 'error', port: 'error', message: knowledgeBaseId.message };
  const systemPrompt = workflowAiSystemPrompt(config.systemPrompt);
  if (!systemPrompt.ok) return { status: 'error', port: 'error', message: systemPrompt.message };

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    // runId wie bei ai.draft_reply: sonst teilen sich zwei Laeufe desselben
    // Workflows einen Job-Key und 'replace' verschluckt den ersten Kindjob.
    runId: context.runId,
    systemPrompt: systemPrompt.value,
    ...workflowJobProvenance(context),
    // Terminaler Knoten (keine ausgehende Kante): Kontext trotzdem stempeln, der
    // Kindjob schliesst Kette und Marker selbst ab. Wozu jedes Feld dient, steht
    // in workflow-inbound-terminal-child.
    ...(resumeNodeId ? {} : {
      workflowId: context.workflowId,
      context: { ...inboundChainFieldsFromContext(context) },
      terminalWorkflowCompletion: true,
      terminalNodeId: terminalNodeExecutionId(context, node),
      triggerName: context.trigger,
    }),
    createDraft,
    eventStrings: boundedContinuationStrings(context.strings),
    eventVariables: context.variables,
  };
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  if (knowledgeBaseId.value !== undefined) {
    payload.knowledgeBaseId = knowledgeBaseId.value;
  } else {
    // No explicit knowledge base selected → honor the "Automatisch (passend
    // zur Richtung)" contract: resolve the account/direction knowledge bases.
    payload.autoKnowledge = true;
    payload.direction = context.direction;
  }
  if (resumeNodeId) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = resumeNodeId;
    stampBranchKey(payload, context);
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: context.variables,
      ...inboundChainFieldsFromContext(context),
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.agent',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: true,
    deferred: true,
    message: `queued_ai_agent:${jobId}`,
    variables: {
      'ai.agent.status': 'pending',
      'ai.agent.job_id': jobId,
    },
  };
}

async function scheduleAiDraftReplyJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  if (context.messageId === null) {
    return { status: 'error', port: 'error', message: 'Keine Nachricht im Kontext' };
  }
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };
  const knowledgeBaseId = optionalPositiveIntegerConfig(config.knowledgeBaseId, 'knowledgeBaseId');
  if (!knowledgeBaseId.ok) return { status: 'error', port: 'error', message: knowledgeBaseId.message };

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    messageId: context.messageId,
    runId: context.runId,
    ...workflowJobProvenance(context),
    eventStrings: boundedContinuationStrings(context.strings),
    eventVariables: context.variables,
    // Terminaler Knoten (keine ausgehende Kante): Kontext trotzdem stempeln, der
    // Kindjob schliesst Kette und Marker selbst ab. Wozu jedes Feld dient, steht
    // in workflow-inbound-terminal-child.
    ...(resumeNodeId ? {} : {
      workflowId: context.workflowId,
      context: { ...inboundChainFieldsFromContext(context) },
      terminalWorkflowCompletion: true,
      terminalNodeId: terminalNodeExecutionId(context, node),
      triggerName: context.trigger,
    }),
  };
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  if (knowledgeBaseId.value !== undefined) payload.knowledgeBaseId = knowledgeBaseId.value;
  if (typeof config.systemPrompt === 'string' && config.systemPrompt.trim()) {
    payload.systemPrompt = config.systemPrompt.trim();
  }
  if (config.includeCanned === true) payload.includeCanned = true;
  if (typeof config.greeting === 'string' && config.greeting.trim()) {
    payload.greeting = config.greeting.trim();
  }
  if (typeof config.signature === 'string' && config.signature.trim()) {
    payload.signature = config.signature.trim();
  }
  if (resumeNodeId) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = resumeNodeId;
    stampBranchKey(payload, context);
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: context.variables,
      ...inboundChainFieldsFromContext(context),
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.draft_reply',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    // Auch ohne Resume-Kante deferred: der KI-Kindjob laeuft asynchron. Ohne
    // das Flag markierte der Elternlauf den Workflow sofort als angewendet und
    // startete die naechste Prioritaetsstufe, obwohl noch kein Entwurf
    // existiert — und ein endgueltig gescheiterter Kindjob liesse den
    // Applied-Marker stehen, sodass die Wiederverarbeitung ihn nicht nachholt.
    stop: true,
    deferred: true,
    message: `queued_ai_draft_reply:${jobId}`,
    variables: {
      'ai.draft.status': 'pending',
      'ai.draft.job_id': jobId,
    },
  };
}

async function scheduleAiReviewDraftJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };

  const portResumeTargets = {
    send: resolveResumeNodeAfterPort(doc, node.id, 'send'),
    hold: resolveResumeNodeAfterPort(doc, node.id, 'hold'),
  };
  const defaultResume = resolveResumeNodeAfter(doc, node.id);
  // Success-path resume only (explicit send or unlabeled default) — never HOLD.
  const successResumeNodeId = portResumeTargets.send || defaultResume || undefined;
  // Still defer when only a HOLD edge exists so the parent waits for the review.
  const deferAnchor = successResumeNodeId || portResumeTargets.hold || undefined;
  const terminalStamp = terminalChainStamp(context, node);

  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    // runId wie bei ai.draft_reply: sonst erzeugen zwei Laeufe desselben
    // Workflows fuer dieselbe Mail denselben Graphile-Job-Key und
    // jobKeyMode 'replace' verschluckt die erste Gegenpruefung samt ihrer
    // Continuation — der erste Elternlauf bliebe fuer immer deferred.
    runId: context.runId,
    ...workflowJobProvenance(context),
    // Terminaler Knoten (keine ausgehende Kante): Kontext trotzdem stempeln, der
    // Kindjob schliesst Kette und Marker selbst ab.
    ...(deferAnchor ? {} : terminalStamp),
    eventStrings: boundedContinuationStrings(context.strings),
    eventVariables: context.variables,
    portResumeTargets: Object.fromEntries(
      Object.entries(portResumeTargets).filter(([, target]) => Boolean(target)),
    ),
  };
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  const draftIdVar = typeof config.draftIdVariable === 'string' && config.draftIdVariable.trim()
    ? config.draftIdVariable.trim()
    : 'draft.id';
  payload.draftIdVariable = draftIdVar;
  const draftIdFromVars = Number(context.variables[draftIdVar]);
  if (Number.isFinite(draftIdFromVars) && draftIdFromVars > 0) {
    payload.draftId = draftIdFromVars;
  }
  if (typeof config.reviewPrompt === 'string' && config.reviewPrompt.trim()) {
    payload.reviewPrompt = config.reviewPrompt.trim();
  }
  if (deferAnchor) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = deferAnchor;
    stampBranchKey(payload, context);
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      // Prefer success path; hold-only graphs temporarily park the hold id here
      // as a deferral anchor — the job handler must not use it for SEND.
      resumeNodeId: deferAnchor,
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: context.variables,
      ...inboundChainFieldsFromContext(context),
    };
    // Hat der Port des Urteils keine Kante (etwa SEND bei nur einer HOLD-Kante),
    // endet der Zweig im Kindjob wie bei einem terminalen Review-Knoten.
    payload.terminalChainPayloadForUnwiredPort = unwiredPortChainPayload(context, terminalStamp);
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.review_draft',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: true,
    deferred: true,
    message: `queued_ai_review_draft:${jobId}`,
    variables: {
      'ai.review.status': 'pending',
      'ai.review.job_id': jobId,
    },
  };
}

/**
 * ai.decide als Kindjob (Muster ai.review_draft): jeder Ausgang hat sein
 * Fortsetzungsziel; der Elternlauf wartet auch, wenn nur ein Nicht-„ja“-Ausgang
 * verdrahtet ist, und ein Knoten ganz ohne Kante schließt die Kette im Job ab.
 */
async function scheduleAiDecideJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  now: Date,
): Promise<NodeResult> {
  const question = aiDecideConfigText(config.question, AI_DECIDE_QUESTION_MAX_CHARS);
  if (!question) {
    return aiDecideNodeResult(context, aiDecideErrorOutcome({ message: 'Keine Frage angegeben' }));
  }
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };

  const portResumeTargets = {
    ja: resolveResumeNodeAfterPort(doc, node.id, 'ja'),
    nein: resolveResumeNodeAfterPort(doc, node.id, 'nein'),
    unsicher: resolveResumeNodeAfterPort(doc, node.id, 'unsicher'),
    error: resolveResumeNodeAfterPort(doc, node.id, 'error'),
  };
  const deferAnchor = portResumeTargets.ja
    || portResumeTargets.nein
    || portResumeTargets.unsicher
    || portResumeTargets.error
    || undefined;
  const terminalStamp = terminalChainStamp(context, node);

  const yesCriteria = aiDecideConfigText(config.yesCriteria, AI_DECIDE_CRITERIA_MAX_CHARS);
  const noCriteria = aiDecideConfigText(config.noCriteria, AI_DECIDE_CRITERIA_MAX_CHARS);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    runId: context.runId,
    // Knoten-Identität für den Graphile-Key: resumeNodeId ist nur der erste
    // verdrahtete Ausgang.
    nodeId: node.id,
    ...workflowJobProvenance(context),
    ...(deferAnchor ? {} : terminalStamp),
    direction: context.direction,
    // Roh (mit Platzhaltern): der Job interpoliert zur Ausführungszeit.
    question,
    contextMode: normalizeAiDecideContextMode(config.contextMode),
    threshold: normalizeAiDecideThreshold(config.threshold),
    eventStrings: boundedContinuationStrings(context.strings),
    eventVariables: context.variables,
    portResumeTargets: Object.fromEntries(
      Object.entries(portResumeTargets).filter(([, target]) => Boolean(target)),
    ),
  };
  if (yesCriteria) payload.yesCriteria = yesCriteria;
  if (noCriteria) payload.noCriteria = noCriteria;
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  if (deferAnchor) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = deferAnchor;
    stampBranchKey(payload, context);
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      // Nur Verzögerungsanker — der Job nimmt das Ziel des gewählten Ausgangs.
      resumeNodeId: deferAnchor,
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: context.variables,
      ...inboundChainFieldsFromContext(context),
    };
    // Hat der gewählte Ausgang keine Kante, endet der Zweig im Kindjob.
    payload.terminalChainPayloadForUnwiredPort = unwiredPortChainPayload(context, terminalStamp);
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.decide',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: true,
    deferred: true,
    message: `queued_ai_decide:${jobId}`,
    variables: {
      'ai.decide.status': 'pending',
      'ai.decide.job_id': jobId,
    },
  };
}

async function scheduleAiPickCannedJob(
  trx: WorkspaceTransaction,
  doc: WorkflowGraphDocument,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  config: Record<string, unknown>,
  createDraft: boolean,
  now: Date,
): Promise<NodeResult> {
  const continuationContextError = workflowContinuationContextError(context);
  if (continuationContextError) {
    return { status: 'error', port: 'error', message: continuationContextError };
  }
  const profileId = optionalPositiveIntegerConfig(config.profileId, 'profileId');
  if (!profileId.ok) return { status: 'error', port: 'error', message: profileId.message };

  const resumeNodeId = resolveResumeNodeAfter(doc, node.id);
  const payload: Record<string, unknown> = {
    workspaceId: context.workspaceId,
    // runId wie bei ai.draft_reply: sonst teilen sich zwei Laeufe desselben
    // Workflows einen Job-Key und 'replace' verschluckt den ersten Kindjob.
    runId: context.runId,
    // Zweig-Identitaet fuer den Job-Key: zwei konvergierende Trigger-Zweige
    // teilen sich sonst alles (Workflow, Nachricht, runId, resumeNodeId).
    ...(context.branchKey ? { branchKey: context.branchKey } : {}),
    ...workflowJobProvenance(context),
    // Terminaler Knoten (keine ausgehende Kante): Kontext trotzdem stempeln, der
    // Kindjob schliesst Kette und Marker selbst ab. Wozu jedes Feld dient, steht
    // in workflow-inbound-terminal-child.
    ...(resumeNodeId ? {} : {
      workflowId: context.workflowId,
      context: { ...inboundChainFieldsFromContext(context) },
      terminalWorkflowCompletion: true,
      terminalNodeId: terminalNodeExecutionId(context, node),
      triggerName: context.trigger,
    }),
    createDraft,
    eventStrings: boundedContinuationStrings(context.strings),
    eventVariables: context.variables,
  };
  if (context.messageId !== null) payload.messageId = context.messageId;
  if (profileId.value !== undefined) payload.profileId = profileId.value;
  if (resumeNodeId) {
    payload.workflowId = context.workflowId;
    payload.resumeNodeId = resumeNodeId;
    payload.continuation = {
      workflowId: context.workflowId,
      triggerName: context.trigger,
      resumeNodeId,
      eventStrings: boundedContinuationStrings(context.strings),
      eventVariables: context.variables,
      ...inboundChainFieldsFromContext(context),
    };
  }

  const jobRow = await trx
    .insertInto('job_queue')
    .values({
      type: 'ai.pick_canned',
      payload,
      run_after: now,
      max_attempts: 3,
      workspace_id: context.workspaceId,
      updated_at: now,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const jobId = Number(jobRow.id);

  return {
    status: 'ok',
    port: 'default',
    stop: true,
    deferred: true,
    message: `queued_ai_pick_canned:${jobId}`,
    variables: {
      'ai.canned.status': 'pending',
      'ai.canned.job_id': jobId,
    },
  };
}

async function executeWorkflowAgentTool(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<NodeResult> {
  const tool = String(config.tool ?? 'echo');
  if (tool === 'search_knowledge') {
    const knowledgeBaseId = optionalPositiveIntegerConfig(config.knowledgeBaseId, 'knowledgeBaseId');
    if (!knowledgeBaseId.ok) return { status: 'error', port: 'error', message: knowledgeBaseId.message };
    if (!knowledgeBaseId.value) {
      return { status: 'skipped', port: 'default', message: 'Keine Wissensbasis' };
    }
    const chunks = await searchWorkflowKnowledgeChunks(
      trx,
      context.workspaceId,
      knowledgeBaseId.value,
      context.strings.combined_text ?? '',
      3,
    );
    return {
      status: 'ok',
      port: 'default',
      variables: { 'tool.result': chunks.map((chunk) => chunk.content).join('\n---\n').slice(0, 4000) },
    };
  }
  if (tool === 'get_canned') {
    const rows = await trx
      .selectFrom('email_canned_responses')
      .select(['title'])
      .where('workspace_id', '=', context.workspaceId)
      .orderBy('sort_order', 'asc')
      .orderBy('id', 'asc')
      .limit(5)
      .execute();
    return {
      status: 'ok',
      port: 'default',
      variables: { 'tool.result': rows.map((row) => String(row.title ?? '')).filter(Boolean).join(', ') },
    };
  }
  return {
    status: 'ok',
    port: 'default',
    variables: { 'tool.result': (context.strings.combined_text ?? '').slice(0, 500) },
  };
}

type WorkflowKnowledgeChunkMatch = {
  id: number;
  title: string | null;
  content: string;
};

/** Plan 048: Werkzeug search_knowledge nutzt die Abschnittssuche der Wissensbasis. */
async function searchWorkflowKnowledgeChunks(
  trx: WorkspaceTransaction,
  workspaceId: string,
  knowledgeBaseId: number,
  query: string,
  limit: number,
): Promise<WorkflowKnowledgeChunkMatch[]> {
  const matches = await searchKnowledgeSections(trx, workspaceId, [knowledgeBaseId], query, limit);
  return matches.map((match) => ({ id: match.id, title: match.title, content: match.content }));
}

type ReplySuggestionTriggerConfig =
  | { ok: true; value: 'inbound' | 'open' }
  | { ok: false; message: string };

function replySuggestionTriggerConfig(value: unknown): ReplySuggestionTriggerConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 'inbound' };
  if (value === 'inbound' || value === 'open') return { ok: true, value };
  return { ok: false, message: 'trigger muss inbound oder open sein' };
}

function workflowAiClassificationLabels(value: unknown): readonly string[] {
  const raw = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(',')
      : [];
  return raw
    .map((item) => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean)
    .slice(0, 20)
    .map((item) => item.slice(0, 80));
}

type AiClassificationContextModeConfig =
  | { ok: true; value: 'metadata' | 'full' }
  | { ok: false; message: string };

function workflowAiClassificationContextMode(value: unknown): AiClassificationContextModeConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 'metadata' };
  if (value === 'metadata' || value === 'full') return { ok: true, value };
  return { ok: false, message: 'contextMode muss metadata oder full sein' };
}

type WorkflowAiTargetVariableConfig =
  | { ok: true; value: string }
  | { ok: false; message: string };

function workflowAiTargetVariable(value: unknown): WorkflowAiTargetVariableConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 'ai.text' };
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: 'targetVariable muss Text sein' };
  }
  const trimmed = value.trim();
  if (trimmed.length > 120) return { ok: false, message: 'targetVariable zu lang' };
  return { ok: true, value: trimmed };
}

function workflowAiBlockKeyword(value: unknown): WorkflowAiTargetVariableConfig {
  if (value === undefined || value === null || value === '') return { ok: true, value: 'BLOCK' };
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: 'blockKeyword muss Text sein' };
  }
  const trimmed = value.trim();
  if (trimmed.length > 120) return { ok: false, message: 'blockKeyword zu lang' };
  return { ok: true, value: trimmed };
}

function workflowAiSystemPrompt(value: unknown): WorkflowAiTargetVariableConfig {
  if (value === undefined || value === null || value === '') {
    return { ok: true, value: 'Du bist ein CRM-Assistent. Nutze die Wissensbasis. Antworte kurz.' };
  }
  if (typeof value !== 'string' || !value.trim()) {
    return { ok: false, message: 'systemPrompt muss Text sein' };
  }
  const trimmed = value.trim();
  if (trimmed.length > 4000) return { ok: false, message: 'systemPrompt zu lang' };
  return { ok: true, value: trimmed };
}

function workflowOutboundReviewSystemPrompt(): string {
  return [
    'Du bist Qualitaetspruefer fuer ausgehende Kunden-E-Mails.',
    'Antworte NUR in diesem Format:',
    'STATUS: OK',
    'oder',
    'STATUS: BLOCK',
    'REASON: Kurze deutsche Begruendung fuer den Nutzer',
    'CODE: optionaler_code',
  ].join('\n');
}

function workflowOutboundReviewUserTemplate(): string {
  return [
    'Pruefe die folgende ausgehende E-Mail vor dem Versand an Kunden.',
    '',
    'Kriterien: professioneller Ton, korrekte Anrede/Namen, Rechtschreibung, vollstaendige Inhalte,',
    'fehlende Anhaenge wenn im Text versprochen, keine Antwort auf Phishing/Betrug.',
    '',
    'Anzahl Anhaenge beim Versand: {{outbound.attachment_count}}',
    '',
    'Ausgehende E-Mail:',
    '{{combined_text}}',
  ].join('\n');
}

async function buildOutboundReviewUserTemplate(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  config: Record<string, unknown>,
): Promise<string> {
  // Dry-run / preview only: live scheduling stamps replyParentMessageId and
  // loads the parent inside the ai.review job after ACL.
  let template = workflowOutboundReviewUserTemplate();
  if (config.checkReplyContext === false) return template;
  const parentId = resolveOutboundReplyParentId(context);
  if (parentId === undefined) return template;
  const parentBlock = await loadOutboundReplyParentBlock(trx, context.workspaceId, parentId);
  return parentBlock ? `${template}${parentBlock}` : template;
}

function resolveOutboundReplyParentId(context: ServerWorkflowContext): number | undefined {
  const fromVar = Number(context.variables['outbound.in_reply_to_message_id']);
  if (Number.isFinite(fromVar) && fromVar > 0) return fromVar;
  const fromMessage = context.message?.reply_parent_message_id == null
    ? 0
    : Number(context.message.reply_parent_message_id);
  return Number.isFinite(fromMessage) && fromMessage > 0 ? fromMessage : undefined;
}

export async function loadOutboundReplyParentBlock(
  trx: WorkspaceTransaction,
  workspaceId: string,
  parentId: number,
): Promise<string | null> {
  const parent = await trx
    .selectFrom('email_messages')
    .select(['subject', 'body_text', 'snippet', 'from_json', 'is_spam'])
    .where('workspace_id', '=', workspaceId)
    .where('id', '=', parentId)
    .executeTakeFirst();
  if (!parent) return null;

  let fromAddr = '';
  try {
    fromAddr = addressesFromRecipientJson(
      typeof parent.from_json === 'string'
        ? parent.from_json
        : parent.from_json == null
          ? null
          : JSON.stringify(parent.from_json),
    );
  } catch {
    fromAddr = '';
  }
  return [
    '',
    '--- Ursprüngliche Nachricht (Antwort-Kontext) ---',
    `Von: ${fromAddr}`,
    `Betreff: ${parent.subject ?? ''}`,
    `Textauszug: ${(parent.body_text ?? parent.snippet ?? '').slice(0, 4000)}`,
    `Spam markiert: ${parent.is_spam ? 'ja' : 'nein'}`,
  ].join('\n');
}

/**
 * Fan-out-Lauf aus dem Job-Kontext, sonst dieser Lauf (erste Ausfuehrung).
 * Eltern (Barriere anlegen) und Kinder (Barriere abbauen) muessen denselben
 * Wert benutzen, sonst zeigen sie auf verschiedene sync_info-Zeilen.
 */
function jobContextFanOutRunId(jobContext: Record<string, unknown>, runId: number): number {
  return inboundChainFieldsFromRecord(jobContext).inboundFanOutRunId ?? runId;
}

function resolveResumeNodeAfterPort(doc: WorkflowGraphDocument, nodeId: string, port: string): string {
  const outs = outgoing(doc.edges, nodeId);
  return pickEdge(outs, port)?.target ?? '';
}

async function insertRunStep(
  trx: WorkspaceTransaction,
  context: ServerWorkflowContext,
  node: WorkflowGraphNode,
  input: {
    status: WorkflowStepStatus;
    port: string | null;
    durationMs: number;
    message: string | null;
    now: Date;
    /** Eingang/Ausgang für die Lauf-Historie (siehe serverStepDetail). */
    detail?: WorkflowStepDetail | null;
  },
): Promise<void> {
  await trx
    .insertInto('email_workflow_run_steps')
    .values({
      workspace_id: context.workspaceId,
      source_sqlite_id: null,
      run_source_sqlite_id: context.runSourceSqliteId,
      run_id: context.runId,
      node_id: node.id,
      node_type: nodeRuntimeType(node),
      status: input.status,
      port: input.port,
      duration_ms: input.durationMs,
      message: input.message,
      detail_json: input.detail ? serializeWorkflowStepDetailWithinBudget(input.detail, context.stepDetail) : null,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      created_at: input.now,
      updated_at: input.now,
    })
    .execute();
}

/**
 * Eingang/Ausgang eines Schritts für die Lauf-Historie. Der erste Schritt
 * eines Laufs trägt die Mail (Kopf + Auszug) und, bei einer Fortsetzung, den
 * Ursprungslauf; danach nur Einstellungen, Variablen und Ergebnis.
 */
function serverStepDetail(
  context: ServerWorkflowContext,
  parts: Omit<BuildWorkflowStepDetailInput, 'mail' | 'continuedFrom'>,
): WorkflowStepDetail {
  let mail: BuildWorkflowStepDetailInput['mail'] = null;
  let continuedFrom: BuildWorkflowStepDetailInput['continuedFrom'] = null;
  const state = context.stepDetail;
  if (state && !state.mailRecorded) {
    state.mailRecorded = true;
    mail = buildWorkflowStepMailSnapshot({
      strings: context.strings,
      direction: context.direction,
      // CRM-, Aufgaben-, Termin- und Zeitplan-Läufe haben keine Nachricht.
      hasMessage: context.messageId !== null,
    });
    continuedFrom = decodeWorkflowContinuedFrom(context.variables[WORKFLOW_CONTINUED_FROM_VARIABLE]);
    // Nur dieser Lauf ist die direkte Fortsetzung; weiterreichen verfälschte spätere Läufe.
    delete context.variables[WORKFLOW_CONTINUED_FROM_VARIABLE];
  }
  return buildWorkflowStepDetail({ ...parts, mail, continuedFrom });
}

function deferredStepNote(node: WorkflowGraphNode): string {
  return nodeRuntimeType(node) === 'ai.decide'
    ? 'Läuft im Hintergrund weiter – das Ergebnis erscheint als eigener Schritt in diesem Lauf.'
    : 'Läuft im Hintergrund weiter – die folgenden Schritte erscheinen als eigener Lauf (Fortsetzung).';
}

/** Hinweis, wenn der gewählte Ausgang eines Knotens mit Kanten keinen Folgeknoten hat. */
function unwiredPortNoteForResult(
  doc: WorkflowGraphDocument,
  node: WorkflowGraphNode,
  result: NodeResult,
): string | null {
  if (result.status !== 'ok' || result.stop || result.blocked) return null;
  const outs = outgoing(doc.edges, node.id);
  if (outs.length === 0) return null;
  if (pickEdge(outs, result.port ?? 'default')) return null;
  return workflowUnwiredPortNote(workflowStepPortLabel(result.port, nodeRuntimeType(node)));
}

async function buildWorkflowContext(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    workflowId: number;
    workflowSourceSqliteId: number;
    runId: number;
    runSourceSqliteId: number;
    messageId: number | null;
    trigger: WorkflowTriggerKind;
    direction: WorkflowDirection;
    message: MessageRow | null;
    actorUserId?: string;
    trustedService?: boolean;
    manualAdminExecute?: boolean;
    testRealAi?: boolean;
    jobContext: Record<string, unknown>;
  },
): Promise<ServerWorkflowContext> {
  const eventStrings = stringRecord(input.jobContext.eventStrings);
  const eventVariables = variableRecord(input.jobContext.eventVariables);
  const strings = eventStrings ?? (
    input.message
      ? stringsFromMessage(input.message)
      : stringsFromOutbound(input.jobContext)
  );
  const variables: WorkflowVariableContext = {
    ...(eventVariables ?? {}),
  };
  if (input.messageId !== null) variables['message.id'] = input.messageId;
  if (input.message) {
    if (input.message.account_id !== null && input.message.account_id !== undefined) {
      variables['email.account_id'] = Number(input.message.account_id);
    }
    if (input.message.customer_id !== null && input.message.customer_id !== undefined) {
      variables['customer.id'] = Number(input.message.customer_id);
    }
    if (input.message.customer_source_sqlite_id !== null && input.message.customer_source_sqlite_id !== undefined) {
      variables['customer.source_sqlite_id'] = Number(input.message.customer_source_sqlite_id);
    }
    // Automated drafts have no later client interpolation — resolve customer
    // name/email here so signature {{customer.*}} placeholders are not sent literally.
    if (
      input.message.customer_id !== null
      && input.message.customer_id !== undefined
      && (typeof variables['customer.name'] !== 'string' || !variables['customer.name'])
    ) {
      const customer = await trx
        .selectFrom('customers')
        .select(['name', 'first_name', 'company', 'email'])
        .where('workspace_id', '=', input.workspaceId)
        .where('id', '=', Number(input.message.customer_id))
        .executeTakeFirst();
      if (customer) {
        const displayName = [customer.first_name, customer.name]
          .map((part) => String(part ?? '').trim())
          .filter(Boolean)
          .join(' ')
          || String(customer.company ?? '').trim()
          || String(customer.name ?? '').trim();
        if (displayName) variables['customer.name'] = displayName;
        const email = String(customer.email ?? '').trim();
        if (email) variables['customer.email'] = email;
      }
    }
    variables['auth.spf'] = authValue(input.message.auth_spf);
    variables['auth.dkim'] = authValue(input.message.auth_dkim);
    variables['auth.dmarc'] = authValue(input.message.auth_dmarc);
    variables['auth.arc'] = authValue(input.message.auth_arc);
    Object.assign(variables, securityVariablesFromMessage(input.message));
  }
  if (input.direction === 'outbound') {
    const outbound = objectRecord(input.jobContext.outbound);
    const count = Number(outbound?.attachmentCount ?? 0);
    variables['outbound.attachment_count'] = Number.isFinite(count) ? count : 0;
    const inReplyTo = Number(outbound?.inReplyToMessageId);
    if (Number.isFinite(inReplyTo) && inReplyTo > 0) {
      variables['outbound.in_reply_to_message_id'] = inReplyTo;
    }
    // Pruefrunde einer Lesebestaetigung: die Runde reist ab hier in allen
    // Job-Payloads und Fortsetzungen mit (siehe mail-read-receipt-responder).
    const readReceiptRound = readReceiptReviewRoundFromJobContext(input.jobContext);
    if (readReceiptRound) variables[READ_RECEIPT_REVIEW_ROUND_VARIABLE] = readReceiptRound;
  }
  return {
    workspaceId: input.workspaceId,
    workflowId: input.workflowId,
    workflowSourceSqliteId: input.workflowSourceSqliteId,
    runId: input.runId,
    runSourceSqliteId: input.runSourceSqliteId,
    messageId: input.messageId,
    messageSourceSqliteId: input.message?.source_sqlite_id === undefined
      ? null
      : Number(input.message.source_sqlite_id),
    trigger: input.trigger,
    direction: input.direction,
    message: input.message,
    strings,
    variables,
    ...(input.actorUserId ? { actorUserId: input.actorUserId } : {}),
    ...(input.trustedService ? { trustedService: true } : {}),
    ...(input.manualAdminExecute ? { manualAdminExecute: true } : {}),
    previewOutbound: input.jobContext.previewOutbound === true,
    ...(input.testRealAi ? { testRealAi: true } : {}),
    ...inboundChainFieldsFromRecord(input.jobContext),
    stepDetail: createWorkflowRunDetailState(),
  };
}

function authValue(value: string | null | undefined): string {
  return String(value ?? 'none').trim().toLowerCase() || 'none';
}

function securityVariablesFromMessage(message: MessageRow): WorkflowVariableContext {
  const variables: WorkflowVariableContext = {};
  const rspamdScore = finiteNumber(message.rspamd_score);
  if (rspamdScore !== null) variables['rspamd.score'] = rspamdScore;
  if (message.rspamd_action) variables['rspamd.action'] = message.rspamd_action;

  const spamScore = finiteNumber(message.spam_score);
  if (spamScore !== null) variables['spam.score'] = spamScore;
  if (message.spam_status) variables['spam.status'] = message.spam_status;
  if (message.spam_score_label) {
    variables['spam.label'] = message.spam_score_label;
    variables['spam.recommendation'] = message.spam_score_label;
  }
  if (message.spam_decision_source) variables['spam.source'] = message.spam_decision_source;

  const breakdown = spamScoreBreakdown(message.spam_score_breakdown_json);
  const listMatch = objectRecord(breakdown?.listMatch);
  if (typeof listMatch?.listType === 'string' && listMatch.listType.trim()) {
    variables['spam.list_match'] = listMatch.listType.trim();
  }
  const reasons = Array.isArray(breakdown?.reasons) ? breakdown.reasons : [];
  const firstReason = objectRecord(reasons[0]);
  if (typeof firstReason?.label === 'string' && firstReason.label.trim()) {
    variables['spam.top_reason'] = firstReason.label.trim();
  }

  return variables;
}

function spamScoreBreakdown(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return objectRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return objectRecord(value);
}

function stringsFromMessage(message: MessageRow): WorkflowStringContext {
  const from = addressesFromStoredJson(message.from_json);
  const to = addressesFromStoredJson(message.to_json);
  const cc = addressesFromStoredJson(message.cc_json);
  const subject = message.subject ?? '';
  const body = message.body_text ?? '';
  const snippet = message.snippet ?? '';
  const attachments = attachmentContextFromJsonValue(message.attachments_json, Boolean(message.has_attachments));
  return {
    subject,
    body_text: body,
    snippet,
    from_address: from,
    to_address: to,
    cc_address: cc,
    combined_text: [subject, body, snippet, from, to, cc].join('\n'),
    ...attachments,
  };
}

function stringsFromOutbound(context: Record<string, unknown>): WorkflowStringContext {
  const outbound = objectRecord(context.outbound);
  const subject = String(outbound?.subject ?? '');
  const bodyText = String(outbound?.bodyText ?? '');
  const bodyHtml = typeof outbound?.bodyHtml === 'string' ? outbound.bodyHtml : '';
  const htmlPlain = stripHtmlTagsToText(bodyHtml);
  const to = String(outbound?.to ?? '');
  const cc = String(outbound?.cc ?? '');
  const bcc = String(outbound?.bcc ?? '');
  const attachmentCount = Number(outbound?.attachmentCount ?? 0);
  const attachmentPaths = Array.isArray(outbound?.attachmentPaths) ? outbound.attachmentPaths : [];
  const attachmentNames = attachmentPaths
    .map((item) => String(item ?? '').split(/[\\/]/).pop() ?? '')
    .filter(Boolean)
    .join('\n');
  return {
    subject,
    body_text: bodyText,
    snippet: bodyText.slice(0, 500),
    from_address: '',
    to_address: to,
    cc_address: cc,
    combined_text: [subject, bodyText, htmlPlain, to, cc, bcc, attachmentNames].join('\n'),
    has_attachments: attachmentCount > 0 || attachmentNames ? 'true' : 'false',
    attachment_names: attachmentNames,
    attachment_types: '',
  };
}

function conditionFromNodeData(data: Record<string, unknown>): WorkflowCondition {
  return {
    field: String(data.field ?? 'combined_text'),
    op: String(data.op ?? 'contains'),
    value: String(data.value ?? ''),
    caseInsensitive: data.caseInsensitive !== false,
    negated: data.negated === true,
  };
}

type WorkflowCondition = {
  field: string;
  op: string;
  value: string;
  caseInsensitive: boolean;
  negated: boolean;
};

function matchCondition(condition: WorkflowCondition, context: WorkflowStringContext): boolean {
  const result = matchSingleCondition(condition, context);
  return condition.negated ? !result : result;
}

function matchSingleCondition(condition: WorkflowCondition, context: WorkflowStringContext): boolean {
  if (condition.field === 'has_attachments') {
    const has = context.has_attachments === 'true' || context.has_attachments === '1';
    if (condition.op === 'is_true') return has;
    if (condition.op === 'is_false') return !has;
    if (condition.op === 'equals') {
      const want = condition.value.toLowerCase() === 'true' || condition.value === '1';
      return has === want;
    }
    return false;
  }

  const haystack = conditionValue(condition.field, context);
  const needle = condition.value ?? '';
  const ci = condition.caseInsensitive;

  if (condition.op === 'equals') {
    if (isAddressField(condition.field)) return matchAddressListOp(condition.field, context, 'equals', needle, ci);
    return ci ? haystack.toLowerCase() === needle.toLowerCase() : haystack === needle;
  }
  if (condition.op === 'contains') {
    if (!needle.trim()) return false;
    if (isAddressField(condition.field)) return matchAddressListOp(condition.field, context, 'contains', needle, ci);
    return (ci ? haystack.toLowerCase() : haystack).includes(ci ? needle.toLowerCase() : needle);
  }
  if (condition.op === 'domain_ends_with') {
    return domainEndsWithForField(condition.field, context, needle, ci);
  }
  if (condition.op === 'regex') {
    if (isAddressField(condition.field)) return matchAddressListOp(condition.field, context, 'regex', needle, ci);
    return safeRegexTest(needle, haystack, ci);
  }
  return false;
}

function matchAddressListOp(
  field: string,
  context: WorkflowStringContext,
  op: 'contains' | 'equals' | 'regex',
  needle: string,
  ci: boolean,
): boolean {
  const parts = splitAddressList(conditionValue(field, context));
  if (parts.length === 0) return op === 'equals' ? needle === '' : false;
  for (const part of parts) {
    const haystack = ci ? part.toLowerCase() : part;
    const n = ci ? needle.toLowerCase() : needle;
    if (op === 'equals' && haystack === n) return true;
    if (op === 'contains' && haystack.includes(n)) return true;
    if (op === 'regex' && safeRegexTest(needle, part, ci)) return true;
  }
  return false;
}

function safeRegexTest(pattern: string, value: string, ci: boolean): boolean {
  if (pattern.length > MAX_REGEX_PATTERN_LEN) return false;
  try {
    if (!safeRegex(pattern)) return false;
    // Nicht new RegExp(pattern, 'i'): mit Flag i stellt V8 nie auf die lineare
    // Engine um (F-A13A14-04).
    return compileUserRegex(pattern, ci ? 'i' : '')(value);
  } catch {
    return false;
  }
}

function domainEndsWithForField(
  field: string,
  context: WorkflowStringContext,
  suffix: string,
  ci: boolean,
): boolean {
  const normalizedSuffix = ci ? suffix.toLowerCase() : suffix;
  for (const address of splitAddressList(conditionValue(field, context))) {
    const domain = domainFromAddress(address);
    const normalizedDomain = ci ? domain.toLowerCase() : domain;
    if (normalizedDomain.endsWith(normalizedSuffix)) return true;
  }
  return false;
}

function conditionValue(field: string, context: WorkflowStringContext): string {
  switch (field) {
    case 'subject':
    case 'body_text':
    case 'snippet':
    case 'from_address':
    case 'to_address':
    case 'cc_address':
    case 'combined_text':
    case 'attachment_names':
    case 'attachment_types':
      return context[field] ?? '';
    default:
      return context.combined_text ?? '';
  }
}

function splitAddressList(raw: string): string[] {
  return raw
    .split(/[,;]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function domainFromAddress(address: string): string {
  const at = address.lastIndexOf('@');
  return at >= 0 ? address.slice(at + 1).trim() : address.trim();
}

function isAddressField(field: string): boolean {
  return field === 'from_address' || field === 'to_address' || field === 'cc_address';
}

// Must resolve exactly like the side-effect/permission guards in
// @simplecrm/core: they only accept a string nodeType, and a looser coercion
// here (String(['email.forward_copy'])) let a graph pass the guard as
// logic.merge and run as the side-effecting node it names.
function nodeRuntimeType(node: WorkflowGraphNode): string {
  return workflowNodeRuntimeType(node);
}

function inboundGateFromContext(context: ServerWorkflowContext): ServerInboundBranchGate | undefined {
  if (context.direction !== 'inbound') return undefined;
  return { conditionOk: context.variables.__inbound_condition_ok === true || context.variables.__inbound_condition_ok === 1 };
}

const INBOUND_DIRECT_ALLOWED_WORKFLOW_TYPES = new Set([
  'email.sender_filter',
  'ai.classify',
  // KI-Entscheidung verzweigt nur; jeder ihrer vier Ausgänge öffnet das Gate.
  'ai.decide',
  // ai.reply_suggestion is the standard "generate draft" step for auto-reply
  // chains; without the allowance the inbound-gate would block it until a
  // condition fires explicitly. The auto_reply node still gates whether the
  // draft is actually sent.
  'ai.reply_suggestion',
  // email.auto_reply IS the gate (toggle + confidence + no-reply check). It
  // must be reachable without a prior condition, and its 'approved' port trips
  // the inbound gate so downstream nodes can run.
  'email.auto_reply',
]);

function inboundNodeRequiresConditionGate(node: WorkflowGraphNode): boolean {
  if (node.type === 'condition' || node.type === 'trigger') return false;
  if (node.type === 'action') return true;
  if (node.type !== 'registry') return false;
  const type = nodeRuntimeType(node);
  if (INBOUND_DIRECT_ALLOWED_WORKFLOW_TYPES.has(type)) return false;
  if (type.startsWith('logic.')) return false;
  const config = nodeConfig(node);
  return config.runOnEveryInbound !== true;
}

/**
 * Generischer „Weitere Workflows stoppen"-Schalter (siehe @simplecrm/core
 * node-chain-stop). Zentral hinter jedem Knoten ausgewertet, damit die Option
 * an JEDEM Knoten zur Verfügung steht statt nur an den Spam-Knoten — z. B.
 * „Absender auf Blocklist gesetzt ⇒ Kette beenden", während der Whitelist-/
 * Weiterleitungszweig ohne den Schalter normal weiterläuft.
 */
function withNodeChainStop(node: WorkflowGraphNode, result: NodeResult): NodeResult {
  if (!nodeRequestsChainStop({
    nodeType: nodeRuntimeType(node),
    config: nodeConfig(node),
    result,
  })) {
    return result;
  }
  return {
    ...result,
    stop: true,
    inboundChainStop: true,
    message: result.message ?? NODE_CHAIN_STOP_MESSAGE,
  };
}

/**
 * Hat der Lauf ausschliesslich an logic.delay-Knoten deferiert, hinter denen auf
 * keinem Pfad mehr ein kettenstoppender Knoten folgt? KI-, HTTP- und andere
 * Kindjobs zaehlen nicht dazu: sie bleiben seriell wie bisher.
 */
function deferredOnlyByChainNeutralDelays(workflow: WorkflowRow, result: GraphRunResult): boolean {
  const nodeIds = result.deferredNodeIds ?? [];
  if (nodeIds.length === 0) return false;
  const doc = parseWorkflowGraph(workflow.graph_json);
  if (!doc) return false;
  return nodeIds.every((nodeId) => {
    const node = doc.nodes.find((candidate) => candidate.id === nodeId);
    return node !== undefined
      && nodeRuntimeType(node) === 'logic.delay'
      && !inboundChainStopReachableAfter(doc, nodeId);
  });
}

/**
 * Ein Zweig hat die Inbound-Kette beendet: verbleibende deferierte Geschwister
 * (KI-Kindjobs, HTTP, Weiterleitung, logic.delay) duerfen keine Nebenwirkungen
 * mehr ausloesen. Marker setzen UND bereits eingeplante Delay-Jobs stornieren.
 */
async function abortRemainingInboundSiblings(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId: number;
    workflowId: number;
    chain: InboundWorkflowChainContext | null;
    /** Nur ohne Kette relevant: trennt ueberlappende Backfill-/Reapply-Laeufe. */
    fanOutRunId?: number | null;
    reason: string;
    now: Date;
  },
): Promise<void> {
  await markInboundSiblingAbort(trx, {
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    workflowId: input.workflowId,
    chain: input.chain,
    fanOutRunId: input.fanOutRunId,
    reason: input.reason,
    now: input.now,
  });
  await cancelPendingWorkflowDelayedJobsForMessage(trx, {
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    workflowId: input.workflowId,
    fanOutRunId: input.fanOutRunId,
    now: input.now,
  });
}

function nodeConfig(node: WorkflowGraphNode): Record<string, unknown> {
  if (node.data.config && typeof node.data.config === 'object' && !Array.isArray(node.data.config)) {
    return node.data.config as Record<string, unknown>;
  }
  return node.data;
}

/**
 * Zentraler Interpolations-Pre-Pass (Parität zur Desktop-Runtime,
 * electron/workflow/runtime.ts): Felder, die das Knoten-Schema mit
 * `interpolate: true` markiert, bekommen {{Platzhalter}} VOR der Ausführung
 * aufgelöst — auf einer Kopie, nie persistiert. Ohne den Pass würden
 * email.tag/crm.create_task/http.request die Platzhalter aus dem
 * Variablen-Picker wörtlich übernehmen.
 *
 * `ai.*`-Knoten werden bewusst ÜBERSPRUNGEN: deren Prompts interpoliert die
 * Job-Schicht (ai-classification.ts) zur Ausführungszeit mit frischeren
 * Variablen — ein Pre-Pass davor würde doppelt interpolieren und über
 * Mail-Inhalte eingeschleuste Platzhalter auflösbar machen.
 */
const serverInterpolateFieldKeysByType = new Map<string, readonly string[]>();

function serverInterpolateFieldKeysFor(type: string): readonly string[] {
  let keys = serverInterpolateFieldKeysByType.get(type);
  if (!keys) {
    if (type.startsWith('ai.')) {
      keys = [];
    } else {
      const entry = listBuiltinWorkflowNodeCatalog().find((e) => e.type === type);
      keys = (entry?.fields ?? [])
        .filter((f) => f.interpolate === true)
        .map((f) => f.key);
    }
    serverInterpolateFieldKeysByType.set(type, keys);
  }
  return keys;
}

function interpolateServerSchemaFields(
  type: string,
  config: Record<string, unknown>,
  context: ServerWorkflowContext,
): Record<string, unknown> {
  const keys = serverInterpolateFieldKeysFor(type);
  if (keys.length === 0) return config;
  let copy: Record<string, unknown> | null = null;
  for (const key of keys) {
    const value = config[key];
    if (typeof value !== 'string' || !value.includes('{{')) continue;
    if (!copy) copy = { ...config };
    copy[key] = interpolateWorkflowPlaceholders(value, {
      strings: context.strings,
      variables: context.variables,
    });
  }
  return copy ?? config;
}

function parseWorkflowGraph(value: unknown): WorkflowGraphDocument | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return parseGraphDocument(value);
  try {
    return parseGraphDocument(JSON.stringify(value));
  } catch {
    return null;
  }
}

function definitionHasRules(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  let parsed: unknown = value;
  if (typeof value === 'string') {
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return false;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;
  const rules = (parsed as { rules?: unknown }).rules;
  return Array.isArray(rules) && rules.length > 0;
}

function addressesFromStoredJson(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return addressesFromRecipientJson(value);
  try {
    return addressesFromRecipientJson(JSON.stringify(value));
  } catch {
    return '';
  }
}

function attachmentContextFromJsonValue(
  value: unknown,
  hasAttachments: boolean,
): Pick<WorkflowStringContext, 'has_attachments' | 'attachment_names' | 'attachment_types'> {
  const names: string[] = [];
  const types: string[] = [];
  const parsed = typeof value === 'string' ? parseJson(value) : value;
  if (Array.isArray(parsed)) {
    for (const item of parsed) collectAttachmentMeta(item, names, types);
  } else if (parsed && typeof parsed === 'object') {
    const record = parsed as {
      stored?: unknown[];
      omitted?: unknown[];
    };
    for (const item of record.stored ?? []) collectAttachmentMeta(item, names, types);
    for (const item of record.omitted ?? []) collectAttachmentMeta(item, names, types);
  }
  return {
    has_attachments: hasAttachments || names.length > 0 ? 'true' : 'false',
    attachment_names: names.join('\n'),
    attachment_types: types.join('\n'),
  };
}

function collectAttachmentMeta(item: unknown, names: string[], types: string[]): void {
  if (!item || typeof item !== 'object') return;
  const record = item as {
    filename?: unknown;
    name?: unknown;
    contentType?: unknown;
    content_type?: unknown;
  };
  const name = typeof record.name === 'string'
    ? record.name
    : typeof record.filename === 'string'
      ? record.filename
      : '';
  if (name) names.push(name);
  const contentType = typeof record.contentType === 'string'
    ? record.contentType
    : typeof record.content_type === 'string'
      ? record.content_type
      : '';
  if (contentType) types.push(contentType);
}

function mergeJobContexts(
  delayedContext: unknown,
  jobContext: Record<string, unknown>,
): Record<string, unknown> {
  const delayed = objectRecord(delayedContext) ?? {};
  const merged: Record<string, unknown> = {
    ...delayed,
    ...jobContext,
  };
  const delayedStrings = objectRecord(delayed.eventStrings);
  const jobStrings = objectRecord(jobContext.eventStrings);
  if (delayedStrings || jobStrings) {
    merged.eventStrings = {
      ...(objectRecord(delayed.eventStrings) ?? {}),
      ...(objectRecord(jobContext.eventStrings) ?? {}),
    };
  }
  const delayedVariables = objectRecord(delayed.eventVariables);
  const jobVariables = objectRecord(jobContext.eventVariables);
  if (delayedVariables || jobVariables) {
    merged.eventVariables = {
      ...(objectRecord(delayed.eventVariables) ?? {}),
      ...(objectRecord(jobContext.eventVariables) ?? {}),
    };
  }
  return merged;
}

function stringFromContext(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function stringRecord(value: unknown): WorkflowStringContext | null {
  const record = objectRecord(value);
  if (!record) return null;
  const result: WorkflowStringContext = {};
  for (const [key, item] of Object.entries(record)) {
    result[key] = String(item ?? '');
  }
  return result;
}

function variableRecord(value: unknown): WorkflowVariableContext | null {
  const record = objectRecord(value);
  if (!record) return null;
  const result: WorkflowVariableContext = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean' || item === null) {
      result[key] = item;
    }
  }
  return result;
}

function contextHasOutbound(value: Record<string, unknown>): boolean {
  return objectRecord(value.outbound) !== null;
}

function contextForcesWorkflowReapply(value: Record<string, unknown>): boolean {
  return value.forceWorkflowReapply === true || value.workflowBackfill === true;
}

function contextCompletesWorkflow(value: Record<string, unknown>): boolean {
  return value.workflowTerminalSuccess === true;
}

function contextSkipsSpamOrReview(value: Record<string, unknown>): boolean {
  return value.skipIfMessageSpamOrReview === true;
}

async function maybeEnqueueNextInboundWorkflow(
  trx: WorkspaceTransaction,
  input: {
    workspaceId: string;
    messageId: number;
    actorUserId?: string;
    jobContext: Record<string, unknown>;
    now: Date;
  },
): Promise<void> {
  const chain = parseInboundWorkflowChain(input.jobContext.inboundWorkflowChain);
  if (!chain) return;
  const nextIndex = chain.index + 1;
  if (nextIndex >= chain.workflowIds.length) return;

  const message = await trx
    .selectFrom('email_messages')
    .select(['id'])
    .where('workspace_id', '=', input.workspaceId)
    .where('id', '=', input.messageId)
    .executeTakeFirst();
  // Chain stop is decided exclusively via inboundChainStop on the finished run.
  // Do not re-bail on spam/review here — that would ignore stopFurtherWorkflows:false.
  if (!message) return;

  // Sibling deferred continuations share the same inboundWorkflowChain: the first
  // finisher marks applied + enqueues; later already_applied hops must not
  // re-enqueue the same next workflow. Claim is shared with terminal-child advance.
  const claimed = await tryClaimInboundChainHop(trx, {
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    chain,
    nextIndex,
    now: input.now,
  });
  if (!claimed) return;

  const payload = input.actorUserId
    ? {
      workspaceId: input.workspaceId,
      actorUserId: input.actorUserId,
      workflowId: chain.workflowIds[nextIndex]!,
      messageId: input.messageId,
      triggerName: 'inbound',
      context: {
        // Do not stamp skipIfMessageSpamOrReview on chain hops: after
        // mark_spam/set_spam_status with stopFurtherWorkflows:false the next
        // priority workflow must still run. Spam short-circuit is inboundChainStop.
        inboundWorkflowChain: { workflowIds: chain.workflowIds, index: nextIndex },
      },
    }
    : buildTrustedServiceJobPayload({
      workspaceId: input.workspaceId,
      workflowId: chain.workflowIds[nextIndex]!,
      messageId: input.messageId,
      triggerName: 'inbound',
      context: {
        inboundWorkflowChain: { workflowIds: chain.workflowIds, index: nextIndex },
      },
    });

  await trx
    .insertInto('job_queue')
    .values({
      type: 'workflow.execute',
      payload,
      run_after: input.now,
      max_attempts: 3,
      workspace_id: input.workspaceId,
      updated_at: input.now,
    })
    .execute();
}

function outboundMessageIdFromContext(value: Record<string, unknown>): number | null {
  const outbound = objectRecord(value.outbound);
  const raw = outbound?.messageId;
  const numeric = Number(raw);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
}

function workflowSourceSqliteId(workflow: WorkflowRow): number {
  const id = Number(workflow.id);
  return workflow.source_sqlite_id === null ? -id : Number(workflow.source_sqlite_id);
}

function nullableSourceSqliteId(value: unknown, fallbackId: number): number {
  return value === null || value === undefined ? -fallbackId : Number(value);
}

function blockedResult(reason: string, existingLog: string[] = []): GraphRunResult {
  existingLog.push(reason);
  return {
    status: 'blocked',
    blocked: true,
    deferred: false,
    blockReason: reason,
    log: existingLog,
  };
}

/** sync_info-Schluessel: zuletzt ausgefuehrter Zeitplan-Zeitpunkt je Workflow. */
export const WORKFLOW_SCHEDULE_RUN_KEY_PREFIX = 'workflow_schedule_run:';

/**
 * Beansprucht einen Zeitplan-Zeitpunkt fuer genau einen Lauf: monoton, nur ein
 * spaeterer Zeitpunkt als der gespeicherte gewinnt (ISO/UTC vergleicht als
 * Text wie als Zeit). Parallele Laeufe warten auf die Zeilensperre und sehen
 * danach den neuen Stand.
 */
async function claimScheduleSlotRun(
  trx: WorkspaceTransaction,
  input: { workspaceId: string; workflowId: number; slot: string; now: Date },
): Promise<boolean> {
  const claimed = await trx
    .insertInto('sync_info')
    .values({
      workspace_id: input.workspaceId,
      key: `${WORKFLOW_SCHEDULE_RUN_KEY_PREFIX}${input.workflowId}`,
      value: input.slot,
      last_updated: input.now,
      source_row: serverWorkerSourceRow(),
      imported_in_run_id: null,
      updated_at: input.now,
    })
    .onConflict((oc) => oc
      .columns(['workspace_id', 'key'])
      .doUpdateSet({ value: input.slot, last_updated: input.now, updated_at: input.now })
      .where((eb) => eb.or([
        eb('sync_info.value', 'is', null),
        eb('sync_info.value', '<', input.slot),
      ])))
    .returning('key')
    .executeTakeFirst();
  return claimed !== undefined;
}
