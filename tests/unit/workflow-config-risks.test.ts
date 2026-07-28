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

  test('Versand ohne Freigabe wird benannt', () => {
    const risks = findWorkflowConfigRisks(graph([
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
