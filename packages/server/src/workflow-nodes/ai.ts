/**
 * Plan 043: KI-Knoten (Entscheidung, Prüfung, Klassifizierung, Agent, Entwurf, …).
 * Reine Verschiebung aus workflow-execution.ts; Verhalten unverändert.
 */
import {
  AI_DECIDE_CRITERIA_MAX_CHARS,
  AI_DECIDE_QUESTION_MAX_CHARS,
  type AiDecideOutcome,
  type WorkflowGraphDocument,
  type WorkflowGraphNode,
  addressesFromRecipientJson,
  aiDecideDryRunOutcome,
  aiDecideErrorOutcome,
  aiDecideOutboundBlockReason,
  aiDecideVariables,
  normalizeAiDecideContextMode,
  normalizeAiDecideThreshold,
  normalizeAiDecisionFeedbackSignal,
  outgoing,
  pickEdge,
} from '@simplecrm/core';
import { executeServerLearningsDigestNode } from '../ai-learnings';
import type { WorkspaceTransaction } from '../db/workspace-context';
import { searchKnowledgeSections } from '../knowledge-workflow-search';
import { interpolateAiDecideField, runServerAiDecision } from '../workflow-ai-decide';
import { executeWorkflowAiDraftReply, executeWorkflowAiReviewDraft } from '../workflow-ai-draft-nodes';
import {
  PreviewAiPendingSignal,
  booleanConfig,
  boundedContinuationStrings,
  inboundChainFieldsFromContext,
  messageIsSpamOrReview,
  objectRecord,
  optionalPositiveIntegerConfig,
  resolveResumeNodeAfter,
  stampBranchKey,
  terminalNodeExecutionId,
  workflowContinuationContextError,
  workflowJobProvenance,
} from './shared';
import type {
  NodeResult,
  ServerNodeHandler,
  ServerNodeHandlerArgs,
  ServerWorkflowContext,
  ServerWorkflowRuntimePorts,
} from './types';

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
  // Plan 050: Rückmeldungsart für die Treffsicherheit (Ereignis im Job).
  const feedbackSignal = normalizeAiDecisionFeedbackSignal(config.feedbackSignal);
  if (feedbackSignal !== 'none') payload.feedbackSignal = feedbackSignal;
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

function resolveResumeNodeAfterPort(doc: WorkflowGraphDocument, nodeId: string, port: string): string {
  const outs = outgoing(doc.edges, nodeId);
  return pickEdge(outs, port)?.target ?? '';
}

/** Knoten dieser Kategorie vor dem Dry-Run-Schutz. */
export const AI_PRE_GUARD_HANDLERS: Readonly<Record<string, ServerNodeHandler>> = {
  'ai.decide': handleAiDecide,
  'ai.outbound_review': handlePreviewAiOutboundReview,
  'ai.review': handlePreviewAiReview,
  ai_review: handlePreviewAiReview,
  'ai.learnings_digest': handleAiLearningsDigest,
};

/** Knoten dieser Kategorie nach dem Dry-Run-Schutz. */
export const AI_NODE_HANDLERS: Readonly<Record<string, ServerNodeHandler>> = {
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
};
