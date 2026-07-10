/**
 * Erzwingt die "eine Quelle der Wahrheit" des Workflow-Katalogs:
 * Core-Katalog ↔ Electron-Executors ↔ Schema (fields/ports/outputs).
 * Schlägt fehl, wenn ein Node ohne Schema/Executor dazukommt oder
 * defaultConfig-Keys nicht mehr im Formular auftauchen.
 */
import type { RegisteredWorkflowNode } from '../../electron/workflow/types';

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getSyncInfo: jest.fn(() => null),
}));

import {
  BUILTIN_WORKFLOW_NODE_CATALOG,
  listBuiltinWorkflowNodeCatalog,
} from '../../packages/core/src/workflow/node-catalog';
import { registerEmailNodes } from '../../electron/workflow/nodes/email-nodes';
import { registerCrmNodes } from '../../electron/workflow/nodes/crm-nodes';
import { registerAiNodes } from '../../electron/workflow/nodes/ai-nodes';
import { registerLogicNodes } from '../../electron/workflow/nodes/logic-nodes';
import { registerCodeNodes } from '../../electron/workflow/nodes/code-nodes';
import { registerIntegrationNodes } from '../../electron/workflow/nodes/integration-nodes';
import { registerWorkflowMetaNodes } from '../../electron/workflow/nodes/workflow-nodes';

function collectDesktopExecutors(): Map<string, RegisteredWorkflowNode> {
  const registered = new Map<string, RegisteredWorkflowNode>();
  const reg = (def: RegisteredWorkflowNode) => {
    if (registered.has(def.type)) throw new Error(`doppelt registriert: ${def.type}`);
    registered.set(def.type, def);
  };
  registerEmailNodes(reg);
  registerCrmNodes(reg);
  registerAiNodes(reg);
  registerLogicNodes(reg);
  registerCodeNodes(reg);
  registerIntegrationNodes(reg);
  registerWorkflowMetaNodes(reg);
  return registered;
}

describe('Workflow-Katalog-Synchronität', () => {
  const catalog = listBuiltinWorkflowNodeCatalog();
  const executors = collectDesktopExecutors();

  test('jeder Nicht-Server-Katalogeintrag hat einen Desktop-Executor und umgekehrt', () => {
    const catalogTypes = new Set(catalog.map((e) => e.type));
    for (const entry of catalog) {
      if (entry.runtime === 'server') {
        expect(executors.has(entry.type)).toBe(false);
      } else {
        expect({ type: entry.type, hasExecutor: executors.has(entry.type) }).toEqual({
          type: entry.type,
          hasExecutor: true,
        });
      }
    }
    for (const type of executors.keys()) {
      expect({ type, inCatalog: catalogTypes.has(type) }).toEqual({ type, inCatalog: true });
    }
  });

  test('jeder Katalogeintrag mit defaultConfig hat ein Schema-Formular für alle Keys', () => {
    for (const entry of catalog) {
      const defaults = Object.keys(entry.defaultConfig ?? {});
      if (defaults.length === 0) continue;
      const fieldKeys = new Set((entry.fields ?? []).map((f) => f.key));
      // Interner Companion-Key des categoryPath-Widgets, kein eigenes Feld.
      const exempt = new Set(['categorySourceSqliteId']);
      for (const key of defaults) {
        if (exempt.has(key)) continue;
        expect({ type: entry.type, key, hasField: fieldKeys.has(key) }).toEqual({
          type: entry.type,
          key,
          hasField: true,
        });
      }
    }
  });

  test('Feld-Keys sind pro Node eindeutig; select-Felder haben Optionen', () => {
    for (const entry of catalog) {
      const keys = (entry.fields ?? []).map((f) => f.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const field of entry.fields ?? []) {
        if (field.type === 'select') {
          expect({ type: entry.type, key: field.key, opts: (field.options ?? []).length > 0 }).toEqual(
            { type: entry.type, key: field.key, opts: true },
          );
        }
      }
    }
  });

  test('interpolate nur auf freien Textfeldern (nie code/select/boolean/number/variableName/variableRef)', () => {
    const forbidden = new Set([
      'code',
      'select',
      'boolean',
      'number',
      'duration',
      'variableName',
      'variableRef',
      'cron',
      'aiProfile',
      'promptId',
      'knowledgeBase',
      'teamMember',
      'account',
      'workflowRef',
    ]);
    for (const entry of catalog) {
      for (const field of entry.fields ?? []) {
        if (field.interpolate === true) {
          expect({ type: entry.type, key: field.key, fieldType: field.type, ok: !forbidden.has(field.type) }).toEqual({
            type: entry.type,
            key: field.key,
            fieldType: field.type,
            ok: true,
          });
        }
      }
    }
  });

  test('deklarierte Ports decken die bekannten Verzweigungs-Nodes ab', () => {
    const portsOf = (type: string) =>
      (catalog.find((e) => e.type === type)?.ports ?? []).map((p) => p.id).sort();
    expect(portsOf('email.auto_reply')).toEqual(['approved', 'blocked']);
    expect(portsOf('email.auth_check')).toEqual(['default', 'fail', 'none', 'pass']);
    expect(portsOf('email.sender_filter')).toEqual(['blacklist', 'default', 'whitelist']);
    expect(portsOf('logic.threshold')).toEqual(['no', 'yes']);
    expect(portsOf('logic.loop')).toEqual(['done', 'each']);
    // logic.switch hat dynamische Cases — bewusst KEINE statischen Ports.
    expect(portsOf('logic.switch')).toEqual([]);
  });

  test('Kompat-Wache: Node-Typen und defaultConfig-Keys bleiben stabil', () => {
    // Gespeicherte graph_json-Dokumente referenzieren diese Typen/Keys.
    // Ein Eintrag darf hier nur nach bewusster Migrations-Entscheidung
    // geändert werden (CHANGELOG + Graph-Migration).
    const snapshot = Object.fromEntries(
      BUILTIN_WORKFLOW_NODE_CATALOG.map((e) => [
        e.type,
        Object.keys(e.defaultConfig ?? {}).sort(),
      ]),
    );
    expect(snapshot).toMatchSnapshot();
  });

  test('jeder Katalogeintrag hat eine deutschsprachige Beschreibung', () => {
    for (const entry of catalog) {
      expect({ type: entry.type, hasDescription: Boolean(entry.description?.trim()) }).toEqual({
        type: entry.type,
        hasDescription: true,
      });
    }
  });
});
