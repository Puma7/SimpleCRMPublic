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
