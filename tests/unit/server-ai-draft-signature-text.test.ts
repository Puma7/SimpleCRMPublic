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

  async function draftSignatureText(signatureHtml: string): Promise<string> {
    (createPostgresComposeDraftInTransaction as jest.Mock).mockClear();
    const trx = fakeTrx({
      email_messages: {
        id: 7,
        account_id: 1,
        subject: 'Frage',
        from_json: JSON.stringify({ value: [{ address: 'kunde@firma.de' }] }),
        raw_headers: 'From: kunde@firma.de',
        body_text: 'Wo bleibt meine Bestellung?',
        snippet: null,
        is_spam: false,
        spam_status: 'clean',
        spam_score_label: null,
      },
      email_accounts: { display_name: 'Service', email_address: 'service@firma.de' },
      email_account_signatures: { signature_html: signatureHtml },
    });
    const result = await executeWorkflowAiDraftReply(trx as never, {} as never, {
      workspaceId: WORKSPACE_ID,
      messageId: 7,
      config: {},
      strings: { combined_text: 'Wo bleibt meine Bestellung?' },
      variables: {},
    });
    expect(result.status).toBe('ok');
    const bodyText: string = (createPostgresComposeDraftInTransaction as jest.Mock).mock.calls[0]![1].values.bodyText;
    const marker = 'Ihre Bestellung ist unterwegs.\n\n';
    return bodyText.slice(bodyText.indexOf(marker) + marker.length);
  }

  // F-N-redos-02: signatureHtmlToText strippte per /<[^>]+>/g; eine Signatur mit vielen unverschlossenen '<' (API: bis 20k Zeichen, Import: ungekappt) blockierte jeden KI-Entwurf quadratisch.
  test('Signatur-HTML mit unverschlossenen Tags wird linear zu Text', async () => {
    const started = Date.now();
    const text = await draftSignatureText(`<p>Gruss</p>${'<'.repeat(60_000)}`);
    expect(Date.now() - started).toBeLessThan(1_000);
    expect(text).toBe(`Gruss\n${'<'.repeat(60_000)}`);
  });

  // F-N-redos-02: Der lineare Strip muss exakt den bisherigen Signaturtext liefern.
  test('Signaturtext entspricht der bisherigen Regex-Kette', async () => {
    const legacy = (html: string): string => html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&amp;/g, '&')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    const samples = [
      'Nur Text',
      '<p>Hallo <b>Welt</b></p><p>Zeile 2</p>',
      'Max<br>Muster<br/>mann<BR />GmbH',
      'a <> b <<c>> d > e < f',
      '<div>x</div><h2>Titel</h2><li>Punkt</li>&amp;lt;',
    ];
    const tokens = ['<', '>', '<>', 'a', ' ', '\n', '<p>', '</p>', '<br>', '<br/>', '</div>', '<b', 'x>', '&amp;', '&lt;', 'ü'];
    let seed = 0x5eed;
    const random = () => {
      seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
      return seed / 0x80000000;
    };
    for (let n = 0; n < 1500; n++) {
      const count = 1 + Math.floor(random() * 14);
      let html = '';
      for (let i = 0; i < count; i++) html += tokens[Math.floor(random() * tokens.length)];
      samples.push(html);
    }
    for (const html of samples) {
      const expected = html.trim() ? legacy(html.trim()) : '';
      expect(await draftSignatureText(html)).toBe(expected || 'Mit freundlichen Grüßen');
    }
  });
});
