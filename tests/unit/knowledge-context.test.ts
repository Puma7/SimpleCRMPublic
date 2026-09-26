import {
  ACCOUNT_KNOWLEDGE_SLOT_CONTEXTS,
  KNOWLEDGE_CONTEXTS,
  KNOWLEDGE_CONTEXT_LABELS,
  knowledgeContextsForDirection,
  isKnowledgeContext,
} from '../../shared/knowledge-context';
import { IPCChannels } from '../../shared/ipc/channels';
import { getPayloadSchema } from '../../shared/ipc/schemas';
import {
  KNOWLEDGE_CONTEXTS as SERVER_KNOWLEDGE_CONTEXTS,
  isKnowledgeContext as isServerKnowledgeContext,
  knowledgeContextsForDirection as serverKnowledgeContextsForDirection,
} from '../../packages/server/src/knowledge-workflow-search';
import { LEARNINGS_DEFAULT_KB_CONTEXT } from '../../packages/core/src/learnings';

describe('knowledge-context', () => {
  it('labels all contexts', () => {
    expect(KNOWLEDGE_CONTEXT_LABELS.inbound).toBe('Eingehend');
    expect(KNOWLEDGE_CONTEXT_LABELS.outbound).toBe('Ausgehend');
    expect(KNOWLEDGE_CONTEXT_LABELS.general).toBe('Allgemein (Firma)');
    expect(KNOWLEDGE_CONTEXT_LABELS.learnings).toBe('Learnings');
  });

  it('knowledgeContextsForDirection maps inbound/outbound and always adds learnings (TA-P5)', () => {
    expect(knowledgeContextsForDirection('inbound')).toEqual(['general', 'inbound', 'learnings']);
    expect(knowledgeContextsForDirection('outbound')).toEqual(['general', 'outbound', 'learnings']);
    expect(knowledgeContextsForDirection('draft_created')).toEqual(['general', 'outbound', 'learnings']);
    expect(knowledgeContextsForDirection('manual')).toEqual(['general', 'learnings']);
    expect(knowledgeContextsForDirection(undefined)).toEqual(['general', 'learnings']);
  });

  it('isKnowledgeContext validates', () => {
    expect(isKnowledgeContext('inbound')).toBe(true);
    expect(isKnowledgeContext('learnings')).toBe(true);
    expect(isKnowledgeContext('invalid')).toBe(false);
  });

  it('server copy stays in sync with shared (Docker build has no /shared)', () => {
    expect([...SERVER_KNOWLEDGE_CONTEXTS]).toEqual([...KNOWLEDGE_CONTEXTS]);
    for (const direction of ['inbound', 'outbound', 'draft_created', 'manual', undefined]) {
      expect(serverKnowledgeContextsForDirection(direction)).toEqual(knowledgeContextsForDirection(direction));
    }
    expect(isServerKnowledgeContext('learnings')).toBe(true);
    expect(isServerKnowledgeContext('foo')).toBe(false);
  });

  it('auto-created Learnings knowledge base uses its own context; account slots stay without it', () => {
    expect(LEARNINGS_DEFAULT_KB_CONTEXT).toBe('learnings');
    expect(isKnowledgeContext(LEARNINGS_DEFAULT_KB_CONTEXT)).toBe(true);
    expect([...ACCOUNT_KNOWLEDGE_SLOT_CONTEXTS]).toEqual(['inbound', 'outbound', 'general']);
  });

  it('IPC create/update schemas accept learnings and reject unknown contexts', () => {
    const create = getPayloadSchema(IPCChannels.Email.CreateKnowledgeBase);
    const update = getPayloadSchema(IPCChannels.Email.UpdateKnowledgeBase);
    expect(create.safeParse({ name: 'Learnings', knowledgeContext: 'learnings' }).success).toBe(true);
    expect(update.safeParse({ id: 3, knowledgeContext: 'learnings' }).success).toBe(true);
    expect(create.safeParse({ name: 'X', knowledgeContext: 'foo' }).success).toBe(false);
    expect(update.safeParse({ id: 3, knowledgeContext: 'foo' }).success).toBe(false);
  });
});
