/**
 * Server ai.draft_reply / ai.agent: große Firmen- und Eingangs-Wissensbasen
 * schneiden die Learnings (immer zuletzt) nicht mehr aus dem Prompt.
 */
jest.mock('../../packages/server/src/workflow-ai-chat', () => ({
  runWorkflowTrackedChatCompletion: jest.fn(async () => 'Ihre Bestellung ist unterwegs.'),
}));
jest.mock('../../packages/server/src/knowledge-workflow-search', () => ({
  searchKnowledgeForWorkflow: jest.fn(async () => []),
}));
jest.mock('../../packages/server/src/db/postgres-mail-read-ports', () => ({
  createPostgresComposeDraftInTransaction: jest.fn(async () => ({ ok: true, message: { id: 42 } })),
}));

import { searchKnowledgeForWorkflow } from '../../packages/server/src/knowledge-workflow-search';
import { runWorkflowTrackedChatCompletion } from '../../packages/server/src/workflow-ai-chat';
import { executeWorkflowAiDraftReply } from '../../packages/server/src/workflow-ai-draft-nodes';
import { buildAgentUserPrompt } from '../../packages/server/src/ai-classification';

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000c8';
const MARKER = 'LEARNING-MARKER Retoure 30 Tage';

function fakeTrx(rowsByTable: Record<string, unknown>) {
  const builder = (table: string): unknown => {
    const chain: Record<string, unknown> = new Proxy({}, {
      get: (_target, prop) => {
        if (prop === 'executeTakeFirst') return async () => rowsByTable[table];
        if (prop === 'execute') return async () => [];
        return () => chain;
      },
    });
    return chain;
  };
  return { selectFrom: builder, updateTable: builder };
}

const chunks = [
  { id: 1, knowledgeBaseId: 1, title: 'Dokument', content: 'G'.repeat(10_000) },
  { id: 2, knowledgeBaseId: 2, title: 'Dokument', content: 'I'.repeat(5_000) },
  { id: 3, knowledgeBaseId: 3, title: 'Dokument', content: MARKER },
];

describe('KI-Wissensbudget: Learnings bleiben im Prompt', () => {
  test('ai.draft_reply', async () => {
    (searchKnowledgeForWorkflow as jest.Mock).mockResolvedValueOnce(chunks);
    const trx = fakeTrx({
      email_messages: {
        id: 7,
        account_id: 1,
        subject: 'Frage',
        from_json: JSON.stringify({ value: [{ address: 'kunde@firma.de', name: 'Max Meier' }] }),
        raw_headers: 'From: kunde@firma.de',
        body_text: 'Wo bleibt meine Bestellung?',
        snippet: null,
        is_spam: false,
        spam_status: 'clean',
        spam_score_label: null,
      },
      email_accounts: { display_name: 'Service', email_address: 'service@firma.de' },
      email_account_signatures: null,
    });

    const result = await executeWorkflowAiDraftReply(trx as never, {} as never, {
      workspaceId: WORKSPACE_ID,
      messageId: 7,
      config: {},
      strings: { combined_text: 'Wo bleibt meine Bestellung?' },
      variables: {},
    });

    expect(result.status).toBe('ok');
    const prompt = (runWorkflowTrackedChatCompletion as jest.Mock).mock.calls[0]![1] as { user: string };
    expect(prompt.user).toContain(MARKER);
  });

  test('ai.agent', () => {
    const prompt = buildAgentUserPrompt({ combined_text: 'Frage' } as never, chunks, {});
    expect(prompt).toContain(MARKER);
  });
});
