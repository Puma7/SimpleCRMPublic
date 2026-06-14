import {
  KNOWLEDGE_CONTEXT_LABELS,
  knowledgeContextsForDirection,
  isKnowledgeContext,
} from '../../shared/knowledge-context';

describe('knowledge-context', () => {
  it('labels all contexts', () => {
    expect(KNOWLEDGE_CONTEXT_LABELS.inbound).toBe('Eingehend');
    expect(KNOWLEDGE_CONTEXT_LABELS.outbound).toBe('Ausgehend');
    expect(KNOWLEDGE_CONTEXT_LABELS.general).toBe('Allgemein (Firma)');
  });

  it('knowledgeContextsForDirection maps inbound/outbound', () => {
    expect(knowledgeContextsForDirection('inbound')).toEqual(['general', 'inbound']);
    expect(knowledgeContextsForDirection('outbound')).toEqual(['general', 'outbound']);
    expect(knowledgeContextsForDirection('draft_created')).toEqual(['general', 'outbound']);
    expect(knowledgeContextsForDirection(undefined)).toEqual(['general']);
  });

  it('isKnowledgeContext validates', () => {
    expect(isKnowledgeContext('inbound')).toBe(true);
    expect(isKnowledgeContext('invalid')).toBe(false);
  });
});
