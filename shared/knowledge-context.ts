/** Context for workflow knowledge bases (per account or global). */
export const KNOWLEDGE_CONTEXTS = ['inbound', 'outbound', 'general', 'learnings'] as const;

export type KnowledgeContext = (typeof KNOWLEDGE_CONTEXTS)[number];

export const KNOWLEDGE_CONTEXT_LABELS: Record<KnowledgeContext, string> = {
  inbound: 'Eingehend',
  outbound: 'Ausgehend',
  general: 'Allgemein (Firma)',
  learnings: 'Learnings',
};

/**
 * Kontexte, die sich pro Postfach belegen lassen. „Learnings“ pflegt die
 * Learnings-Auswertung global (TA-P5) und wird deshalb nicht pro Konto angeboten.
 */
export const ACCOUNT_KNOWLEDGE_SLOT_CONTEXTS = ['inbound', 'outbound', 'general'] as const satisfies readonly KnowledgeContext[];

export function isKnowledgeContext(value: unknown): value is KnowledgeContext {
  return typeof value === 'string' && (KNOWLEDGE_CONTEXTS as readonly string[]).includes(value);
}

/**
 * Map workflow trigger direction to knowledge contexts to include. The
 * „Learnings“ context (TA-P5) is read in every direction, so released
 * learnings reach the AI even when another general knowledge base exists.
 */
export function knowledgeContextsForDirection(
  direction: 'inbound' | 'outbound' | 'draft_created' | 'manual' | string | undefined,
): KnowledgeContext[] {
  if (direction === 'outbound' || direction === 'draft_created') {
    return ['general', 'outbound', 'learnings'];
  }
  if (direction === 'inbound') {
    return ['general', 'inbound', 'learnings'];
  }
  return ['general', 'learnings'];
}
