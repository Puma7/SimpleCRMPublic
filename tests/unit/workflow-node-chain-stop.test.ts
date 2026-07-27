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
    ['bereits stoppend', { status: 'ok', stop: true }],
  ])('greift nicht bei Ergebnis: %s', (_label, result) => {
    expect(nodeRequestsChainStop({
      nodeType: 'email.tag',
      config: { [NODE_CHAIN_STOP_CONFIG_KEY]: true },
      result: result as { status: string },
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

  test('invalid graph input returns false', () => {
    expect(workflowGraphHasExplicitChainStopConfig(null)).toBe(false);
    expect(workflowGraphHasExplicitChainStopConfig('{bad json')).toBe(false);
    expect(workflowGraphHasExplicitChainStopConfig({ nodes: 'x' })).toBe(false);
  });
});
