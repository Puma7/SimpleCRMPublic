import { listBuiltinWorkflowNodeCatalog } from '../../packages/core/src/workflow/node-catalog';
import {
  PRE_DRY_RUN_GUARD_HANDLERS,
  SERVER_NODE_HANDLERS,
} from '../../packages/server/src/workflow-nodes';
import { listServerWorkflowNodeCatalog } from '../../packages/server/src/workflow-node-catalog';

/**
 * Plan 043: Die Server-Knoten laufen über zwei Handler-Tabellen (vor und nach
 * dem Dry-Run-Schutz). Katalog und Tabellen müssen übereinstimmen, sonst endet
 * ein Knoten stillschweigend als „nicht unterstützt“.
 */
const LEGACY_ALIASES: Record<string, string> = {
  stop: 'logic.stop',
  ai_review: 'ai.review',
  hold_outbound: 'email.hold_outbound',
  tag: 'email.tag',
  set_category: 'email.set_category',
  tag_attachment_meta: 'email.tag_attachment_meta',
  mark_seen: 'email.mark_seen',
  archive: 'email.archive',
  link_customer: 'crm.link_customer',
  forward_copy: 'email.forward_copy',
};

const preKeys = Object.keys(PRE_DRY_RUN_GUARD_HANDLERS);
const postKeys = Object.keys(SERVER_NODE_HANDLERS);
const allKeys = new Set([...preKeys, ...postKeys]);

describe('Server-Knoten-Handler (Plan 043)', () => {
  test('jeder Typ des Server-Katalogs hat einen Handler', () => {
    const missing = listServerWorkflowNodeCatalog()
      .map((entry) => entry.type)
      .filter((type) => !allKeys.has(type));
    expect(missing).toEqual([]);
  });

  test('jeder Handler gehört zu einem Katalog-Typ oder einem Alt-Namen', () => {
    const catalog = new Set(listServerWorkflowNodeCatalog().map((entry) => entry.type));
    const unknown = [...allKeys].filter((key) => !catalog.has(key) && !Object.prototype.hasOwnProperty.call(LEGACY_ALIASES, key));
    expect(unknown).toEqual([]);
  });

  test('kein Handler für Code-, Plugin- oder Desktop-Knoten', () => {
    const desktopOnly = listBuiltinWorkflowNodeCatalog()
      .filter((entry) => entry.runtime === 'desktop')
      .map((entry) => entry.type);
    for (const type of ['code.javascript', 'code.python', 'plugin.custom', ...desktopOnly]) {
      expect(allKeys.has(type)).toBe(false);
    }
  });

  test('nur die Versandvorschau-Prüfungen stehen in beiden Tabellen', () => {
    expect(preKeys.filter((key) => postKeys.includes(key)).sort()).toEqual(['ai.outbound_review', 'ai.review', 'ai_review']);
  });

  test('Alt-Namen zeigen auf denselben Handler wie der Typ', () => {
    for (const [alias, canonical] of Object.entries(LEGACY_ALIASES)) {
      for (const map of [PRE_DRY_RUN_GUARD_HANDLERS, SERVER_NODE_HANDLERS]) {
        if (alias in map || canonical in map) {
          expect({ alias, handler: map[alias] }).toEqual({ alias, handler: map[canonical] });
        }
      }
    }
  });

  test('Tabellen ohne Prototyp: `constructor` oder `__proto__` ist kein Handler', () => {
    for (const map of [PRE_DRY_RUN_GUARD_HANDLERS, SERVER_NODE_HANDLERS]) {
      expect(Object.getPrototypeOf(map)).toBeNull();
      expect(Object.isFrozen(map)).toBe(true);
      expect(map.constructor).toBeUndefined();
      expect(map.toString).toBeUndefined();
    }
  });
});
