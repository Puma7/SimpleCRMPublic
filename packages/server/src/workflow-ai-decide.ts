/**
 * Server-Ausführung für ai.decide („KI-Entscheidung“) und „Verbindung testen“
 * der KI-Profile.
 *
 * Der Knoten läuft als eigener Job-Typ `ai.decide` außerhalb der
 * workflow.execute-Transaktion (Muster ai.review_draft): Mehr-Port-Fortsetzung
 * über `portResumeTargets`, Abschluss der Inbound-Kette auch ohne Kante,
 * Abbruchprüfung vor und nach dem Modellaufruf, Interpolation im Job. Fehler
 * des Modellaufrufs fängt der Job selbst und nimmt den Ausgang „error“ —
 * ein endgültig gescheiterter Job setzte den Graphen sonst nie fort.
 */
import {
  AI_DECIDE_CRITERIA_MAX_CHARS,
  AI_DECIDE_QUESTION_MAX_CHARS,
  AI_DECISIONS_CONNECTION_TEST_QUESTION,
  AI_DECISIONS_CONNECTION_TEST_STATE,
  AI_DECISIONS_TIMEOUT_MS,
  aiDecideErrorOutcome,
  aiDecideOutboundBlockReason,
  aiDecidePortTripsInboundGate,
  aiDecideVariables,
  buildAiDecideChatPrompts,
  buildAiDecideMailContext,
  evaluateAiDecideOutcome,
  interpolateWorkflowPlaceholders,
  isAiDecisionsProvider,
  normalizeAiDecideContextMode,
  parseAiDecideChatResponse,
  type AiDecideContextMode,
  type AiDecideOutcome,
} from '@simplecrm/core';

import { callAiChat, callAiDecision, type AiDecisionResult } from './ai-providers';
import { recordAiUsageSafe, type AiTokenUsage } from './ai-usage';
import { enqueueContinuation, type AiClassificationContinuation } from './ai-classification';
import {
  withWorkspaceTransaction,
  type WorkspaceTransaction,
} from './db/workspace-context';
import type { AiProfileConnectionTestApiPort } from './api/types';
import { persistOutboundBlockOnDraft } from './mail-outbound-hold';
import type { JobPayload } from './jobs/types';
import {
  assertWorkflowAiBudget,
  resolveWorkflowAiProfileRuntime,
  runWorkflowTrackedChatCompletion,
  type WorkflowAiChatDeps,
} from './workflow-ai-chat';
import {
  enqueueNextInboundWorkflowAfterTerminalChildFailure,
  isInboundSiblingAborted,
  terminalInboundChildContext,
} from './workflow-inbound-chain-advance';
import {
  completeTerminalInboundChild,
  runTerminalInboundChild,
} from './workflow-inbound-terminal-child';

/** Profil, Secret und Nutzungserfassung; KI-Aufrufe laufen immer über guardedAiPost. */
export type WorkflowAiDecideDeps = WorkflowAiChatDeps;

export type AiDecideJobPlan = Readonly<{
  workspaceId: string;
  messageId?: number;
  runId?: number;
  actorUserId?: string;
  /** Richtung des Elternlaufs; `outbound` hält den Versand außer bei „ja“ an. */
  direction?: string;
  question: string;
  yesCriteria?: string;
  noCriteria?: string;
  contextMode: AiDecideContextMode;
  threshold: number;
  profileId?: number;
  portResumeTargets?: Readonly<Record<string, string>>;
  eventStrings?: JobPayload;
  eventVariables?: JobPayload;
  continuation?: AiClassificationContinuation;
  /** Terminaler Knoten (keine Kante): Kettenkontext für den Abschluss. */
  terminalChainPayload?: Record<string, unknown>;
  /** Knoten mit Continuation, dessen gewählter Ausgang keine Kante hat. */
  terminalChainPayloadForUnwiredPort?: Record<string, unknown>;
}>;

export type AiDecideJobPort = Readonly<{
  decide(input: AiDecideJobPlan): Promise<void>;
}>;

function jobStrings(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
}

function jobVariables(value: unknown): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === null || typeof entry === 'string' || typeof entry === 'number' || typeof entry === 'boolean') {
      out[key] = entry;
    }
  }
  return out;
}

/**
 * Platzhalter der Konfigfelder im Job auflösen (der Server-Pre-Pass überspringt
 * ai.*), Single-Pass wie überall — Mailinhalt kann keine Platzhalter nachladen.
 */
export function interpolateAiDecideField(
  value: string | undefined,
  scope: { strings: Record<string, string>; variables: Record<string, string | number | boolean | null> },
  max: number,
): string {
  const raw = String(value ?? '');
  const filled = raw.includes('{{') ? interpolateWorkflowPlaceholders(raw, scope) : raw;
  return filled.trim().slice(0, max);
}

export type ServerAiDecisionInput = Readonly<{
  workspaceId: string;
  messageId: number | null;
  actorUserId?: string | null;
  profileId?: number;
  direction: string;
  question: string;
  yesCriteria?: string;
  noCriteria?: string;
  contextMode: AiDecideContextMode;
  threshold: unknown;
  strings: Record<string, string>;
}>;

async function recordDecisionUsage(
  deps: WorkflowAiDecideDeps,
  input: {
    workspaceId: string;
    profileId: number;
    model: string;
    nodeType: string;
    messageId: number | null;
    actorUserId: string | null;
    usage: AiTokenUsage | null;
    costMicroUsd: number | null;
    started: number;
  },
): Promise<void> {
  await recordAiUsageSafe(
    { db: deps.db, applyWorkspaceSession: deps.applyWorkspaceSession, now: deps.now },
    {
      workspaceId: input.workspaceId,
      aiProfileId: input.profileId,
      model: input.model,
      nodeType: input.nodeType,
      messageId: input.messageId,
      actorUserId: input.actorUserId,
      usage: input.usage,
      costMicroUsd: input.costMicroUsd,
      latencyMs: Date.now() - input.started,
    },
  );
}

async function postDecision(
  runtime: { baseUrl: string; model: string; apiKey: string },
  input: { question: string; yesCriteria?: string; noCriteria?: string; state: unknown },
): Promise<AiDecisionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), AI_DECISIONS_TIMEOUT_MS);
  try {
    return await callAiDecision({
      baseUrl: runtime.baseUrl,
      model: runtime.model,
      apiKey: runtime.apiKey,
      question: input.question,
      yesCriteria: input.yesCriteria,
      noCriteria: input.noCriteria,
      state: input.state,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Eine KI-Entscheidung: Entscheidungsmodell (Decisions API) oder Chat-Modell.
 * Wirft nie — Profil-, Budget-, Aufruf- und Auswertungsfehler werden zum
 * Ergebnis „error“. Nutzung (inkl. vom Anbieter gemeldeter Kosten) wird erfasst.
 */
export async function runServerAiDecision(
  deps: WorkflowAiDecideDeps,
  input: ServerAiDecisionInput,
): Promise<AiDecideOutcome> {
  const question = input.question.trim().slice(0, AI_DECIDE_QUESTION_MAX_CHARS);
  if (!question) return aiDecideErrorOutcome({ message: 'Keine Frage angegeben' });
  const yesCriteria = String(input.yesCriteria ?? '').trim().slice(0, AI_DECIDE_CRITERIA_MAX_CHARS);
  const noCriteria = String(input.noCriteria ?? '').trim().slice(0, AI_DECIDE_CRITERIA_MAX_CHARS);
  const mail = buildAiDecideMailContext({
    direction: input.direction,
    mode: input.contextMode,
    strings: input.strings,
  });

  let model = '';
  try {
    const { profile, apiKey } = await resolveWorkflowAiProfileRuntime(deps, input.workspaceId, input.profileId);
    model = profile.model;
    await assertWorkflowAiBudget(deps, input.workspaceId);

    if (isAiDecisionsProvider(profile.provider)) {
      const started = Date.now();
      const result = await postDecision(
        { baseUrl: profile.base_url, model: profile.model, apiKey },
        { question, yesCriteria, noCriteria, state: mail.state },
      );
      await recordDecisionUsage(deps, {
        workspaceId: input.workspaceId,
        profileId: Number(profile.id),
        model: profile.model,
        nodeType: 'ai.decide',
        messageId: input.messageId,
        actorUserId: input.actorUserId ?? null,
        usage: result.usage,
        costMicroUsd: result.costMicroUsd,
        started,
      });
      if (!result.ok) return aiDecideErrorOutcome({ message: result.error, model });
      return evaluateAiDecideOutcome({
        probability: result.probability,
        threshold: input.threshold,
        source: 'decisions',
        model,
      });
    }

    const prompts = buildAiDecideChatPrompts({ question, yesCriteria, noCriteria, contextText: mail.text });
    const output = await runWorkflowTrackedChatCompletion(deps, {
      workspaceId: input.workspaceId,
      messageId: input.messageId,
      nodeType: 'ai.decide',
      profileId: Number(profile.id),
      actorUserId: input.actorUserId ?? null,
      system: prompts.system,
      user: prompts.user,
    });
    const parsed = parseAiDecideChatResponse(output);
    if (!parsed.ok) return aiDecideErrorOutcome({ message: parsed.error, model });
    return evaluateAiDecideOutcome({
      probability: parsed.probability,
      threshold: input.threshold,
      source: 'chat',
      model,
      modelAnswer: parsed.answer,
      reason: parsed.reason,
    });
  } catch (error) {
    return aiDecideErrorOutcome({ message: errorMessage(error), model });
  }
}

/**
 * Wurde die Inbound-Kette inzwischen von einem Geschwister gestoppt? Bewusst
 * OHNE die Spam-Prüfung anderer KI-Kindjobs: die Frage kann gerade „Ist das
 * Spam?“ lauten.
 */
async function inboundDecideChainAborted(trx: WorkspaceTransaction, input: AiDecideJobPlan): Promise<boolean> {
  if (input.messageId === undefined) return false;
  const continuation = input.continuation;
  const terminal = continuation ? null : terminalInboundChildContext(input.terminalChainPayload ?? {});
  if (!continuation && !terminal) return false;
  if (continuation?.triggerName !== undefined && continuation.triggerName !== 'inbound') return false;
  const workflowId = continuation?.workflowId ?? terminal?.workflowId;
  if (workflowId == null) return false;
  return isInboundSiblingAborted(trx, {
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    workflowId,
    chain: continuation?.inboundWorkflowChain ?? terminal?.chain ?? null,
    fanOutRunId: continuation?.inboundFanOutRunId ?? terminal?.fanOutRunId,
  });
}

/**
 * Der Zweig endet hier (kein Ausgang verdrahtet oder Kette gestoppt): wie ein
 * terminaler Knoten Join-Barriere abbauen und Kette weiterschalten.
 */
async function endDecideBranch(
  trx: WorkspaceTransaction,
  input: AiDecideJobPlan,
  applied: boolean,
  now: Date,
): Promise<void> {
  const continuation = input.continuation;
  if (!continuation) {
    if (input.terminalChainPayload) {
      await completeTerminalInboundChild(trx, input.terminalChainPayload, { applied, now });
    }
    return;
  }
  if (input.terminalChainPayloadForUnwiredPort) {
    await completeTerminalInboundChild(trx, input.terminalChainPayloadForUnwiredPort, { applied, now });
    return;
  }
  await enqueueNextInboundWorkflowAfterTerminalChildFailure(trx, {
    workspaceId: input.workspaceId,
    messageId: input.messageId,
    actorUserId: continuation.actorUserId,
    continuation,
  }, now);
}

export function createPostgresAiDecidePort(deps: WorkflowAiDecideDeps): AiDecideJobPort {
  const now = () => deps.now?.() ?? new Date();
  const system = (workspaceId: string) => ({ workspaceId, role: 'system' as const });
  return {
    async decide(input) {
      // Terminaler Knoten: der Elternlauf wartet auf diesen Job. Das
      // Sicherheitsnetz holt den Kettenabschluss auf jedem normalen Ausgang nach.
      await runTerminalInboundChild(deps, input, now, async () => {
        const aborted = await withWorkspaceTransaction(
          deps.db,
          system(input.workspaceId),
          async (trx) => {
            if (!(await inboundDecideChainAborted(trx, input))) return false;
            await endDecideBranch(trx, input, false, now());
            return true;
          },
          { applySession: deps.applyWorkspaceSession },
        );
        if (aborted) return;

        const strings = jobStrings(input.eventStrings);
        const variables = jobVariables(input.eventVariables);
        const scope = { strings, variables };
        const outcome = await runServerAiDecision(deps, {
          workspaceId: input.workspaceId,
          messageId: input.messageId ?? null,
          actorUserId: input.actorUserId ?? null,
          ...(input.profileId === undefined ? {} : { profileId: input.profileId }),
          direction: input.direction ?? 'inbound',
          question: interpolateAiDecideField(input.question, scope, AI_DECIDE_QUESTION_MAX_CHARS),
          yesCriteria: interpolateAiDecideField(input.yesCriteria, scope, AI_DECIDE_CRITERIA_MAX_CHARS),
          noCriteria: interpolateAiDecideField(input.noCriteria, scope, AI_DECIDE_CRITERIA_MAX_CHARS),
          contextMode: input.contextMode,
          threshold: input.threshold,
          strings,
        });

        await withWorkspaceTransaction(
          deps.db,
          system(input.workspaceId),
          async (trx) => {
            // Zweiter Abbruch-Check: der Modellaufruf lief außerhalb der
            // Transaktion, die Kette kann inzwischen gestoppt worden sein.
            if (await inboundDecideChainAborted(trx, input)) {
              await endDecideBranch(trx, input, false, now());
              return;
            }
            // Ausgang: alles außer „ja“ hält den Versand an (wie ai.outbound_review);
            // der Ausgang läuft dann nur noch für Zusatzschritte.
            const blockReason = input.direction === 'outbound' ? aiDecideOutboundBlockReason(outcome) : null;
            if (blockReason && input.messageId !== undefined) {
              // Endgültiger Block: echter Grund im Banner, Planung eines
              // Workflow-Versands gelöscht (Entwurf erscheint im Posteingang).
              await persistOutboundBlockOnDraft(trx, {
                workspaceId: input.workspaceId,
                messageId: input.messageId,
                reason: blockReason,
                now: now(),
              });
            }
            const port = outcome.answer;
            const applied = port !== 'error';
            const resumeNodeId = input.portResumeTargets?.[port];
            const continuation = input.continuation;
            if (!resumeNodeId || !continuation) {
              // Ausgang ohne Kante (nein/unsicher/error fail-closed, „ja“ ohne
              // jede Folgekante): der Zweig endet hier.
              await endDecideBranch(trx, input, applied, now());
              return;
            }
            await enqueueContinuation(trx, {
              workspaceId: input.workspaceId,
              messageId: input.messageId,
              continuation: { ...continuation, resumeNodeId },
              variables: {
                ...aiDecideVariables(outcome),
                // Inbound-Gate: jeder der vier Ausgänge ist ein bewusst
                // verdrahteter Zweig (wie ein switch-Fall) und öffnet die
                // nachgelagerten Knoten der Fortsetzung (wie der Desktop).
                ...(input.direction === 'inbound' && aiDecidePortTripsInboundGate(port)
                  ? { __inbound_condition_ok: true }
                  : {}),
              },
              now: now(),
            });
          },
          { applySession: deps.applyWorkspaceSession },
        );
      });
    },
  };
}

export type AiProfileConnectionTestResult = Awaited<ReturnType<AiProfileConnectionTestApiPort['test']>>;

/**
 * „Verbindung testen“ eines KI-Profils: Chat-Profil mit „Antworte nur mit OK.“,
 * Entscheidungsmodell mit einer noul-Testfrage. Die Meldung enthält nie den
 * Key; die Nutzung wird als `ai.profile_test` erfasst.
 */
export async function testServerAiProfileConnection(
  deps: WorkflowAiDecideDeps,
  input: { workspaceId: string; profileId: number; actorUserId?: string | null },
): Promise<AiProfileConnectionTestResult> {
  let runtime: Awaited<ReturnType<typeof resolveWorkflowAiProfileRuntime>>;
  try {
    runtime = await resolveWorkflowAiProfileRuntime(deps, input.workspaceId, input.profileId);
  } catch (error) {
    return { ok: false, message: errorMessage(error), model: '', latencyMs: 0 };
  }
  const { profile, apiKey } = runtime;
  const redact = (message: string): string => message.split(apiKey).join('***');
  const started = Date.now();
  const usageBase = {
    workspaceId: input.workspaceId,
    profileId: Number(profile.id),
    model: profile.model,
    nodeType: 'ai.profile_test',
    messageId: null,
    actorUserId: input.actorUserId ?? null,
    started,
  };
  try {
    if (isAiDecisionsProvider(profile.provider)) {
      const result = await postDecision(
        { baseUrl: profile.base_url, model: profile.model, apiKey },
        { question: AI_DECISIONS_CONNECTION_TEST_QUESTION, state: AI_DECISIONS_CONNECTION_TEST_STATE },
      );
      await recordDecisionUsage(deps, { ...usageBase, usage: result.usage, costMicroUsd: result.costMicroUsd });
      if (!result.ok) {
        return { ok: false, message: redact(result.error), model: profile.model, latencyMs: Date.now() - started };
      }
      return {
        ok: true,
        message: `Verbindung erfolgreich (Ja-Wahrscheinlichkeit ${result.probability} %)`,
        model: profile.model,
        latencyMs: Date.now() - started,
        probability: result.probability,
      };
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_DECISIONS_TIMEOUT_MS);
    let content: string;
    let usage: AiTokenUsage | null;
    try {
      const result = await callAiChat({
        provider: profile.provider,
        baseUrl: profile.base_url,
        model: profile.model,
        apiKey,
        system: 'Antworte nur mit OK.',
        user: 'Antworte nur mit OK.',
        temperature: 0,
        maxTokens: 16,
        signal: controller.signal,
      });
      content = result.content;
      usage = result.usage;
    } finally {
      clearTimeout(timeout);
    }
    await recordDecisionUsage(deps, { ...usageBase, usage, costMicroUsd: null });
    return {
      ok: true,
      message: `Verbindung erfolgreich – Antwort: ${redact(content.replace(/\s+/g, ' ').trim()).slice(0, 60)}`,
      model: profile.model,
      latencyMs: Date.now() - started,
    };
  } catch (error) {
    return {
      ok: false,
      message: redact(errorMessage(error)),
      model: profile.model,
      latencyMs: Date.now() - started,
    };
  }
}

/** API-Port für POST /api/v1/ai/profiles/:id/test-connection. */
export function createAiProfileConnectionTestPort(deps: WorkflowAiDecideDeps): AiProfileConnectionTestApiPort {
  return {
    test: (input) => testServerAiProfileConnection(deps, input),
  };
}
