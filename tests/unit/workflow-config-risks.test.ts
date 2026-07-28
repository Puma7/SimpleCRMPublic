import {
  findWorkflowConfigRisks as findCoreRisks,
} from '../../packages/core/src/workflow/graph-validate';
import {
  findWorkflowConfigRisks as findSharedRisks,
} from '../../shared/email-workflow-graph-validate';

/**
 * Der Absender einer eingegangenen Mail fuellt {{from_address}}, {{subject}},
 * {{body_text}} und Verwandte. In einem Textbaustein ist das unschoen; in einem
 * Empfaenger- oder URL-Feld entscheidet es mit, WOHIN etwas geht. Das ist kein
 * Fehler und wird deshalb nicht blockiert — aber man sieht es dem Feld beim
 * Ausfuellen nicht an, also muss es beim Speichern einmal ausgesprochen werden.
 */
function graph(nodes: Array<{ id: string; type: string; data: Record<string, unknown> }>) {
  return { version: 1 as const, nodes, edges: [] };
}

// Beide Kopien muessen dasselbe tun — shared ist der Spiegel fuer den Renderer.
describe.each([
  ['core', findCoreRisks],
  ['shared', findSharedRisks],
] as const)('findWorkflowConfigRisks (%s)', (_name, findWorkflowConfigRisks) => {
  test('meldet einen mail-abgeleiteten Platzhalter im Empfaengerfeld', () => {
    const risks = findWorkflowConfigRisks(graph([
      {
        id: 'n1',
        type: 'registry',
        data: { nodeType: 'email.forward_copy', config: { to: '{{from_address}}' } },
      },
    ]) as never);
    expect(risks).toEqual([
      {
        code: 'mail_derived_target',
        nodeId: 'n1',
        nodeType: 'email.forward_copy',
        field: 'to',
        placeholder: 'from_address',
      },
    ]);
  });

  test('auch in der URL eines HTTP-Aufrufs', () => {
    const risks = findWorkflowConfigRisks(graph([
      {
        id: 'n2',
        type: 'registry',
        data: { nodeType: 'workflow.http_request', config: { url: 'https://ok.example/{{subject}}' } },
      },
    ]) as never);
    expect(risks).toHaveLength(1);
    expect(risks[0]).toMatchObject({ field: 'url', placeholder: 'subject' });
  });

  test('Versand ohne Freigabe wird benannt, wenn KI im Spiel ist', () => {
    const risks = findWorkflowConfigRisks(graph([
      { id: 'ai', type: 'registry', data: { nodeType: 'ai.draft_reply', config: {} } },
      {
        id: 'n3',
        type: 'registry',
        data: { nodeType: 'email.release_outbound', config: { autoSend: true } },
      },
    ]) as never);
    expect(risks).toEqual([
      { code: 'auto_send_without_review', nodeId: 'n3', nodeType: 'email.release_outbound' },
    ]);
  });

  // send_draft ist der zweite ausdruecklich unterstuetzte Weg ohne Pruefung —
  // runOutboundReview: false ist dort der Katalog-Standard ("sendet ohne
  // weitere Pruefung"). ai.draft_reply → email.send_draft verschickt damit
  // vollautomatisch, was die KI aus fremdem Text formuliert hat.
  test('auch send_draft ohne Ausgangspruefung', () => {
    const risks = findWorkflowConfigRisks(graph([
      { id: 'ai', type: 'registry', data: { nodeType: 'ai.draft_reply', config: {} } },
      { id: 's', type: 'registry', data: { nodeType: 'email.send_draft', config: { draftIdVariable: 'draft.id' } } },
    ]) as never);
    expect(risks).toEqual([
      { code: 'auto_send_without_review', nodeId: 's', nodeType: 'email.send_draft' },
    ]);
  });

  test('mit erzwungener Ausgangspruefung schweigt sie', () => {
    const risks = findWorkflowConfigRisks(graph([
      { id: 'ai', type: 'registry', data: { nodeType: 'ai.draft_reply', config: {} } },
      { id: 's', type: 'registry', data: { nodeType: 'email.send_draft', config: { runOutboundReview: true } } },
    ]) as never);
    expect(risks).toEqual([]);
  });

  // Ohne KI-Knoten ist automatischer Versand eine gewoehnliche Automatisierung.
  // Dort zu warnen hiesse, an jedem zweiten Workflow zu warnen — und eine
  // Warnung, die immer erscheint, liest niemand mehr.
  test('ohne KI-Knoten bleibt automatischer Versand unkommentiert', () => {
    const risks = findWorkflowConfigRisks(graph([
      { id: 's', type: 'registry', data: { nodeType: 'email.send_draft', config: {} } },
      { id: 'r', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: true } } },
    ]) as never);
    expect(risks).toEqual([]);
  });

  test('harmlose Konfigurationen warnen nicht', () => {
    const risks = findWorkflowConfigRisks(graph([
      // Feste Adresse — kein Platzhalter.
      { id: 'a', type: 'registry', data: { nodeType: 'email.forward_copy', config: { to: 'chef@firma.de' } } },
      // Platzhalter, aber aus der CRM-Datenbank, nicht aus der Mail.
      { id: 'b', type: 'registry', data: { nodeType: 'email.forward_copy', config: { to: '{{customer.email}}' } } },
      // Mail-Platzhalter im Textfeld: faerbt den Inhalt, verschiebt kein Ziel.
      { id: 'c', type: 'registry', data: { nodeType: 'email.forward_copy', config: { body: '{{body_text}}' } } },
      // autoSend aus.
      { id: 'd', type: 'registry', data: { nodeType: 'email.release_outbound', config: { autoSend: false } } },
      // Gleichnamiges Feld an einem Knoten, der gar nicht freigibt.
      { id: 'e', type: 'registry', data: { nodeType: 'workflow.http_request', config: { autoSend: true } } },
    ]) as never);
    expect(risks).toEqual([]);
  });

  test('leerer oder kaputter Graph wirft nicht', () => {
    expect(findWorkflowConfigRisks(graph([]) as never)).toEqual([]);
    expect(findWorkflowConfigRisks({ version: 1, nodes: undefined, edges: [] } as never)).toEqual([]);
  });
});
