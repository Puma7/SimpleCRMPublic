/**
 * Verhaltenstests (kein Quelltext-Matching) für den generischen
 * „Weitere Workflows stoppen"-Schalter.
 *
 * Kernzusage: Opt-in. Gespeicherte Graphen kennen das Feld nicht und dürfen
 * durch das Update NICHT rückwirkend ihre Folgeknoten und die Inbound-Kette
 * verlieren.
 */
import {
  NODE_CHAIN_STOP_CONFIG_KEY,
  SELF_HANDLED_CHAIN_STOP_NODE_TYPES,
  chainStopFlagEnabled,
  nodeRequestsChainStop,
  workflowGraphHasExplicitChainStopConfig,
} from '../../packages/core/src/workflow/node-chain-stop';

const okResult = { status: 'ok' } as const;

describe('generischer Ketten-Stopp am Knoten', () => {
  test('Bestandsgraph ohne das Feld stoppt nicht', () => {
    expect(nodeRequestsChainStop({
      nodeType: 'email.tag',
      config: { tag: 'auto-spam' },
      result: okResult,
    })).toBe(false);
  });

  test('explizit gesetztes Feld stoppt', () => {
    expect(nodeRequestsChainStop({
      nodeType: 'email.sender_filter',
      config: { [NODE_CHAIN_STOP_CONFIG_KEY]: true },
      result: okResult,
    })).toBe(true);
  });

  test('false stoppt nicht — Whitelist-/Weiterleitungszweig läuft weiter', () => {
    expect(nodeRequestsChainStop({
      nodeType: 'email.forward',
      config: { [NODE_CHAIN_STOP_CONFIG_KEY]: false },
      result: okResult,
    })).toBe(false);
  });

  test('als JSON-String gespeicherte Wahrheitswerte werden erkannt', () => {
    expect(chainStopFlagEnabled('true')).toBe(true);
    expect(chainStopFlagEnabled('1')).toBe(true);
    expect(chainStopFlagEnabled('false')).toBe(false);
    expect(chainStopFlagEnabled('0')).toBe(false);
    expect(chainStopFlagEnabled('vielleicht')).toBe(false);
    expect(chainStopFlagEnabled(undefined)).toBe(false);
    expect(chainStopFlagEnabled(1)).toBe(false);
  });

  test.each([
    ['error', { status: 'error' }],
    ['skipped', { status: 'skipped' }],
    ['blocked', { status: 'ok', blocked: true }],
    ['deferred', { status: 'ok', deferred: true }],
  ])('greift nicht bei Ergebnis: %s', (_label, result) => {
    expect(nodeRequestsChainStop({
      nodeType: 'email.tag',
      config: { [NODE_CHAIN_STOP_CONFIG_KEY]: true },
      result: result as { status: string },
    })).toBe(false);
  });

  test('greift auch auf logic.stop — der Editor verspricht dort das Kettenende', () => {
    // logic.stop liefert bereits stop:true (nur dieser Graph endet). Der
    // Schalter wird im Editor auch dort angeboten, muss also zusätzlich die
    // nachfolgenden Inbound-Workflows beenden.
    expect(nodeRequestsChainStop({
      nodeType: 'logic.stop',
      config: { [NODE_CHAIN_STOP_CONFIG_KEY]: true },
      result: { status: 'ok', stop: true },
    })).toBe(true);
    // Ohne Schalter bleibt es beim reinen Graph-Ende.
    expect(nodeRequestsChainStop({
      nodeType: 'logic.stop',
      config: {},
      result: { status: 'ok', stop: true },
    })).toBe(false);
  });

  test('Spam-Knoten werten das Feld selbst aus und sind ausgenommen', () => {
    for (const nodeType of SELF_HANDLED_CHAIN_STOP_NODE_TYPES) {
      expect(nodeRequestsChainStop({
        nodeType,
        config: { [NODE_CHAIN_STOP_CONFIG_KEY]: true },
        result: okResult,
      })).toBe(false);
    }
    expect(SELF_HANDLED_CHAIN_STOP_NODE_TYPES.has('email.mark_spam')).toBe(true);
    expect(SELF_HANDLED_CHAIN_STOP_NODE_TYPES.has('email.set_spam_status')).toBe(true);
  });
});

describe('workflowGraphHasExplicitChainStopConfig', () => {
  test('legacy graph without the field is not explicit', () => {
    const graph = {
      version: 1,
      nodes: [
        { id: 't', type: 'trigger', data: { kind: 'inbound' } },
        { id: 's', type: 'registry', data: { nodeType: 'email.mark_spam', config: { spam: true } } },
      ],
      edges: [],
    };
    expect(workflowGraphHasExplicitChainStopConfig(graph)).toBe(false);
    expect(workflowGraphHasExplicitChainStopConfig(JSON.stringify(graph))).toBe(false);
  });

  test('graph with explicit stopFurtherWorkflows on any node is explicit', () => {
    const graph = {
      version: 1,
      nodes: [
        { id: 't', type: 'trigger', data: { kind: 'inbound' } },
        {
          id: 's',
          type: 'registry',
          data: { nodeType: 'email.mark_spam', config: { spam: true, stopFurtherWorkflows: false } },
        },
      ],
      edges: [],
    };
    expect(workflowGraphHasExplicitChainStopConfig(graph)).toBe(true);
  });

  /**
   * Der Helfer MUSS dieselbe Stelle lesen wie die Laufzeit. `nodeConfigOf`
   * (electron/workflow/runtime.ts) verzweigt nicht ueber den Canvas-Typ, sondern
   * nimmt `data.config`, wenn das ein Objekt (kein Array) ist, sonst `data`
   * selbst. Eine Verzweigung ueber `node.type === 'registry'` las in beiden
   * folgenden Faellen an der falschen Stelle: der Graph galt faelschlich als
   * „ohne explizite Konfiguration" und bekam trotz bewusstem
   * `stopFurtherWorkflows: false` wieder den harten Legacy-Stopp — also genau
   * die Regression, die dieser Schalter verhindern soll, nur andersherum.
   */
  test('a registry node carries the flag directly on data when it has no config object', () => {
    const graph = {
      version: 1,
      nodes: [
        { id: 't', type: 'trigger', data: { kind: 'inbound' } },
        { id: 's', type: 'registry', data: { nodeType: 'email.mark_spam', stopFurtherWorkflows: false } },
      ],
      edges: [],
    };
    expect(workflowGraphHasExplicitChainStopConfig(graph)).toBe(true);
  });

  test('a non-registry node carries the flag inside data.config', () => {
    const graph = {
      version: 1,
      nodes: [
        { id: 't', type: 'trigger', data: { kind: 'inbound' } },
        { id: 'a', type: 'action', data: { actionType: 'tag', config: { tag: 'vip', stopFurtherWorkflows: false } } },
      ],
      edges: [],
    };
    expect(workflowGraphHasExplicitChainStopConfig(graph)).toBe(true);
  });

  test('an array config falls back to data, exactly like the runtime', () => {
    // nodeConfigOf verlangt ausdruecklich ein Objekt und KEIN Array.
    const graph = {
      version: 1,
      nodes: [
        { id: 'n', type: 'registry', data: { nodeType: 'logic.stop', config: [], stopFurtherWorkflows: true } },
      ],
      edges: [],
    };
    expect(workflowGraphHasExplicitChainStopConfig(graph)).toBe(true);
  });

  test('the decision is per GRAPH, not per node', () => {
    // Bewusst festgehalten: setzt der Autor das Feld irgendwo, gilt der ganze
    // Graph als „modern" und behaelt die Opt-in-Semantik — auch wenn der
    // Spam-Knoten selbst kein Feld traegt. Wer das je auf knotenweise
    // Auswertung umstellt, aendert damit das Verhalten von Bestandsgraphen.
    const graph = {
      version: 1,
      nodes: [
        { id: 's', type: 'registry', data: { nodeType: 'email.mark_spam', config: { spam: true } } },
        { id: 'b', type: 'registry', data: { nodeType: 'logic.stop', config: { stopFurtherWorkflows: true } } },
      ],
      edges: [],
    };
    expect(workflowGraphHasExplicitChainStopConfig(graph)).toBe(true);
  });

  test('a false value still counts as explicit — presence is what matters', () => {
    const graph = {
      version: 1,
      nodes: [{ id: 'n', type: 'registry', data: { nodeType: 'logic.stop', config: { stopFurtherWorkflows: false } } }],
      edges: [],
    };
    expect(workflowGraphHasExplicitChainStopConfig(graph)).toBe(true);
    // Der Schalter selbst bleibt davon unberuehrt: false stoppt nicht.
    expect(chainStopFlagEnabled(false)).toBe(false);
  });

  test('invalid graph input returns false', () => {
    expect(workflowGraphHasExplicitChainStopConfig(null)).toBe(false);
    expect(workflowGraphHasExplicitChainStopConfig('{bad json')).toBe(false);
    expect(workflowGraphHasExplicitChainStopConfig({ nodes: 'x' })).toBe(false);
  });
});
