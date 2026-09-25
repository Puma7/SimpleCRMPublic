/**
 * Server ai.draft_reply: Kontosignatur als Klartext im KI-Entwurf.
 * Nur Modulgrenzen gemockt (KI-Aufruf, Wissenssuche, Entwurfsanlage); die
 * Transaktion ist ein minimaler Kysely-Ersatz, der pro Tabelle eine Zeile liefert.
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

import { createPostgresComposeDraftInTransaction } from '../../packages/server/src/db/postgres-mail-read-ports';
import { executeWorkflowAiDraftReply } from '../../packages/server/src/workflow-ai-draft-nodes';

const WORKSPACE_ID = '10000000-0000-4000-8000-0000000000c7';

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

describe('server ai.draft_reply signature text', () => {
  // F-A11a-07: Mit escapten Platzhalterwerten darf die Text-Signatur keine Entities zeigen.
  test('Signatur-Platzhalter landen als Klartext ohne Entities im Entwurf', async () => {
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
      email_account_signatures: { signature_html: '<p>Grüße an {{customer.name}}<br/>{{user.name}}</p>' },
    });

    const result = await executeWorkflowAiDraftReply(trx as never, {} as never, {
      workspaceId: WORKSPACE_ID,
      messageId: 7,
      config: {},
      strings: { combined_text: 'Wo bleibt meine Bestellung?' },
      variables: { 'customer.name': `O'Brien & "Söhne" <GmbH>` },
    });

    expect(result.status).toBe('ok');
    const draftInput = (createPostgresComposeDraftInTransaction as jest.Mock).mock.calls[0]![1];
    expect(draftInput.values.bodyText).toContain(`Grüße an O'Brien & "Söhne" <GmbH>\nService`);
    expect(draftInput.values.bodyText).not.toMatch(/&(amp|lt|gt|quot|#39);/);
  });
});
