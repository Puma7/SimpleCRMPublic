/**
 * Renderer-/Desktop-Zugang zur Learnings-Kernlogik (TA-P5) aus
 * packages/core/src/learnings — gleiche Implementierung wie auf dem Server —
 * plus die Datenformen, die Desktop-IPC und Server-HTTP gleich liefern.
 */
import type {
  LearningCandidateKind,
  LearningDigestStatus,
  LearningDigestTrigger,
  LearningsDigestPeriod,
  LearningsDigestResultStatus,
} from '../packages/core/src/learnings';

export * from '../packages/core/src/learnings';

export type AiLearningsSettingsDto = {
  collectEnabled: boolean;
  targetKnowledgeBaseId: number | null;
  profileId: number | null;
};

export type AiLearningsOverviewDto = {
  settings: AiLearningsSettingsDto;
  counts: Record<LearningCandidateKind, number> & { total: number };
  pendingDigestId: number | null;
  running: boolean;
  lastDigestAt: string | null;
  effectiveKnowledgeBaseId: number | null;
  generalKnowledgeBaseCount: number;
};

export type AiLearningCandidateDto = {
  id: number;
  kind: LearningCandidateKind;
  accountId: number | null;
  sourceMessageId: number | null;
  sentMessageId: number | null;
  questionText: string | null;
  aiText: string | null;
  humanText: string | null;
  noteText: string | null;
  createdByUserId: string | null;
  createdAt: string;
  digestId: number | null;
  processedAt: string | null;
};

export type AiLearningDigestDto = {
  id: number;
  knowledgeBaseId: number;
  knowledgeBaseName: string | null;
  status: LearningDigestStatus;
  trigger: LearningDigestTrigger;
  requestedByUserId: string | null;
  requestedByName: string | null;
  workflowId: number | null;
  periodFrom: string | null;
  periodTo: string;
  candidateCount: number;
  summary: string;
  operations: unknown;
  error: string | null;
  createdAt: string;
  decidedByUserId: string | null;
  decidedByName: string | null;
  decidedAt: string | null;
};

export type AiLearningDigestDetailDto = AiLearningDigestDto & {
  baseContent: string;
  proposedContent: string;
  currentContent: string | null;
  knowledgeBaseChanged: boolean;
};

export type AiLearningsRunDigestPayload = {
  period?: LearningsDigestPeriod;
  knowledgeBaseId?: number | null;
  profileId?: number | null;
  minCandidates?: number;
};

export type AiLearningsRunDigestResultDto = {
  status: LearningsDigestResultStatus;
  digestId: number | null;
  candidateCount: number;
  error?: string;
};

export type AiLearningDecisionCode =
  | 'not_found'
  | 'not_pending'
  | 'knowledge_base_missing'
  | 'knowledge_base_changed'
  | 'content_invalid';

export type AiLearningDecisionResultDto =
  | { success: true; digest: AiLearningDigestDto }
  | { success: false; code: AiLearningDecisionCode; error: string; currentContent?: string };

export const AI_LEARNING_DECISION_MESSAGES: Record<AiLearningDecisionCode, string> = {
  not_found: 'Vorschlag nicht gefunden',
  not_pending: 'Über diesen Vorschlag wurde schon entschieden',
  knowledge_base_missing: 'Die Wissensbasis gibt es nicht mehr',
  knowledge_base_changed:
    'Die Wissensbasis wurde seit dem Vorschlag geändert. Beim Übernehmen werden diese Änderungen überschrieben.',
  content_invalid: 'Inhalt fehlt oder ist zu lang (höchstens 100 000 Zeichen)',
};
