/**
 * „Was ist mit dieser Mail passiert?“ – alle Automatik-Läufe einer Mail für
 * das Lesefenster (Details → Automatik). Beide Editionen liefern die Schritte
 * im selben Format; hier wird je Lauf der letzte echte Schritt, die
 * KI-Entscheidung und die Herkunft einer Fortsetzung (nur Server) bestimmt.
 */
import { parseWorkflowStepDetail } from '../packages/core/src/workflow/run-step-detail';
import { isDeferredWorkflowStepMessage } from './workflow-run-humanize';

/**
 * Höchstzahl der angezeigten Läufe je Mail. Der Server-Weg lädt je Lauf die
 * Schritte und je Workflow den Namen: 1 + 12 + 12 = höchstens 25 Anfragen.
 * Werden es mehr, gehört die Zusammenfassung in einen eigenen Server-Endpunkt.
 */
export const MESSAGE_WORKFLOW_RUNS_LIMIT = 12;

export type MessageWorkflowRunSummary = {
  /** Id für ListWorkflowRunSteps und den Schritt-Dialog. */
  id: number;
  /** Rohe Server-Id (Desktop: = id); Fortsetzungen verweisen darauf. */
  server_id: number;
  workflow_id: number | null;
  workflow_name: string;
  direction: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
  last_step: { node_type: string; status: string; port: string | null } | null;
  decision: { answer: string | null; probability: number | null; summary: string | null } | null;
  /** server_id des Ursprungslaufs. */
  continued_from_run_id: number | null;
};

export type MessageWorkflowRunStepInput = {
  node_type: string;
  status: string;
  port: string | null;
  message: string | null;
  detail?: unknown;
};

function textValue(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() ? value : null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

function numberValue(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function summarizeRunSteps(
  steps: ReadonlyArray<MessageWorkflowRunStepInput>,
): Pick<MessageWorkflowRunSummary, 'last_step' | 'decision' | 'continued_from_run_id'> {
  const real = steps.filter((step) => !isDeferredWorkflowStepMessage(step.message));
  const last = real[real.length - 1];
  const decisionStep = [...real].reverse().find((step) => step.node_type === 'ai.decide');
  let decision: MessageWorkflowRunSummary['decision'] = null;
  if (decisionStep) {
    const detail = parseWorkflowStepDetail(decisionStep.detail);
    const result = detail?.output?.result ?? {};
    const variables = detail?.output?.variables ?? {};
    decision = {
      answer: textValue(result.answer) ?? textValue(variables['ai.decide.answer']) ?? decisionStep.port,
      probability: numberValue(result.probability) ?? numberValue(variables['ai.decide.probability']),
      summary: textValue(result.summary) ?? textValue(variables['ai.decide.summary']) ?? textValue(decisionStep.message),
    };
  }
  const first = steps[0];
  const continuedFrom = first ? parseWorkflowStepDetail(first.detail)?.continuedFrom?.runId : undefined;
  return {
    last_step: last ? { node_type: last.node_type, status: last.status, port: last.port } : null,
    decision,
    continued_from_run_id: typeof continuedFrom === 'number' && Number.isFinite(continuedFrom) ? continuedFrom : null,
  };
}

/**
 * Fortsetzungen unter ihren Ursprungslauf (auch über mehrere Stufen, älteste
 * zuerst); Gruppen neueste zuerst. Eine Fortsetzung ohne gelisteten Ursprung
 * ist eine eigene Gruppe.
 */
export function groupRunsWithContinuations(
  runs: readonly MessageWorkflowRunSummary[],
): Array<{ run: MessageWorkflowRunSummary; continuations: MessageWorkflowRunSummary[] }> {
  const byServerId = new Map(runs.map((run) => [run.server_id, run]));
  const rootOf = (run: MessageWorkflowRunSummary): MessageWorkflowRunSummary => {
    const seen = new Set<number>();
    let current = run;
    while (current.continued_from_run_id !== null && !seen.has(current.server_id)) {
      seen.add(current.server_id);
      const parent = byServerId.get(current.continued_from_run_id);
      if (!parent) break;
      current = parent;
    }
    return current;
  };
  const groups = new Map<number, { run: MessageWorkflowRunSummary; continuations: MessageWorkflowRunSummary[] }>();
  for (const run of runs) {
    const root = rootOf(run);
    const group = groups.get(root.server_id) ?? { run: root, continuations: [] };
    groups.set(root.server_id, group);
    if (root !== run) group.continuations.push(run);
  }
  const ordered = [...groups.values()];
  for (const group of ordered) group.continuations.sort((a, b) => a.server_id - b.server_id);
  return ordered.sort((a, b) => b.run.server_id - a.run.server_id);
}
