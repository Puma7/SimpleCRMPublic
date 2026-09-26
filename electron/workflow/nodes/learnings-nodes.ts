/**
 * TA-P5 „Learnings auswerten“ (ai.learnings_digest) — Desktop-Ausführung.
 * Wertet direkt im Main-Prozess aus (runChatCompletion) und legt einen
 * Vorschlag an; die Wissensbasis ändert der Knoten nie selbst.
 */
import type { NodeExecuteResult, RegisteredWorkflowNode } from '../types';
import { normalizeLearningsDigestPeriod, normalizeLearningsMinCandidates } from '../../../shared/ai-learnings';

type Reg = (def: RegisteredWorkflowNode) => void;

/** Mail-Ereignisse statt Zeitplan/manuell: hier ist eine Auswertung nicht sinnvoll. */
const SKIPPED_DIRECTIONS = new Set(['inbound', 'outbound', 'draft_created']);

function positiveIdOrNull(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

export function registerLearningsDigestNode(register: Reg): void {
  register({
    type: 'ai.learnings_digest',
    label: 'Learnings auswerten',
    category: 'ai',
    canvasType: 'registry',
    defaultConfig: { knowledgeBaseId: null, period: 'since_last', minCandidates: 3, profileId: null },
    execute: async (ctx, config): Promise<NodeExecuteResult> => {
      if (SKIPPED_DIRECTIONS.has(ctx.direction)) {
        return { status: 'skipped', message: 'Learnings auswerten läuft nur in Zeitplan- oder manuellen Workflows' };
      }
      const { preflightAiLearningsDigest, runAiLearningsDigest } = await import('../../email/email-ai-learnings.js');
      const request = {
        knowledgeBaseId: positiveIdOrNull(config.knowledgeBaseId),
        period: normalizeLearningsDigestPeriod(config.period),
        minCandidates: normalizeLearningsMinCandidates(config.minCandidates),
        profileId: positiveIdOrNull(config.profileId),
      };
      if (ctx.dryRun) {
        const preflight = preflightAiLearningsDigest(request);
        if (preflight.status === 'failed') return { status: 'error', message: preflight.error };
        return {
          status: 'ok',
          message: 'dry-run learnings digest',
          variables: {
            'learnings.status': preflight.status === 'ready' ? 'queued' : preflight.status,
            'learnings.digest_id': preflight.status === 'skipped_pending' ? preflight.digestId : '',
            'learnings.candidate_count': preflight.status === 'ready' ? preflight.candidates.length : preflight.candidateCount,
          },
        };
      }
      const result = await runAiLearningsDigest({
        ...request,
        trigger: 'workflow',
        workflowId: ctx.workflowId > 0 ? ctx.workflowId : null,
      });
      if (result.status === 'failed' && result.digestId === null) {
        return { status: 'error', message: result.error ?? 'Learnings-Auswertung fehlgeschlagen' };
      }
      const messages: Record<string, string> = {
        created: `Vorschlag angelegt (${result.candidateCount} Einträge) — Einstellungen → Learnings`,
        skipped_pending: 'Es gibt schon einen offenen Vorschlag für diese Wissensbasis',
        skipped_no_candidates: `Zu wenige gesammelte Einträge (${result.candidateCount} von mindestens ${request.minCandidates})`,
        failed: `KI-Auswertung fehlgeschlagen: ${result.error ?? 'unbekannt'}`,
      };
      return {
        status: 'ok',
        message: messages[result.status] ?? result.status,
        variables: {
          'learnings.status': result.status,
          'learnings.digest_id': result.digestId ?? '',
          'learnings.candidate_count': result.candidateCount,
        },
      };
    },
  });
}
