/** Context for workflow knowledge bases (per account or global). */
export const KNOWLEDGE_CONTEXTS = ['inbound', 'outbound', 'general'] as const;

export type KnowledgeContext = (typeof KNOWLEDGE_CONTEXTS)[number];

export const KNOWLEDGE_CONTEXT_LABELS: Record<KnowledgeContext, string> = {
  inbound: 'Eingehend',
  outbound: 'Ausgehend',
  general: 'Allgemein (Firma)',
};

export function isKnowledgeContext(value: unknown): value is KnowledgeContext {
  return typeof value === 'string' && (KNOWLEDGE_CONTEXTS as readonly string[]).includes(value);
}

/** Map workflow trigger direction to knowledge contexts to include. */
export function knowledgeContextsForDirection(
  direction: 'inbound' | 'outbound' | 'draft_created' | 'manual' | string | undefined,
): KnowledgeContext[] {
  if (direction === 'outbound' || direction === 'draft_created') {
    return ['general', 'outbound'];
  }
  if (direction === 'inbound') {
    return ['general', 'inbound'];
  }
  return ['general'];
}
