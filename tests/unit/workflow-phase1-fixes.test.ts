import fs from 'fs';
import os from 'os';
import path from 'path';
import type { RegisteredWorkflowNode, WorkflowContext } from '../../electron/workflow/types';

const tmpUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'wf-phase1-'));

jest.mock('electron', () => ({
  app: { getPath: jest.fn(() => tmpUserData) },
}));

jest.mock('../../electron/email/email-store', () => ({
  addMessageTag: jest.fn(),
  clearMessageSeenSyncPending: jest.fn(),
  setMessageArchived: jest.fn(),
  setMessageSeenLocal: jest.fn(),
  setMessageSpam: jest.fn(),
  setMessageSpamStatus: jest.fn(),
  setMessageAssignedTo: jest.fn(),
  setOutboundHold: jest.fn(),
  getEmailAccountById: jest.fn(),
  listEmailAccounts: jest.fn(() => []),
}));

jest.mock('../../electron/workflow/draft-send-prep', () => ({
  prepareDraftForWorkflowSend: jest.fn(),
  releaseOutboundHoldForDraft: jest.fn(() => ({ ok: true, autoSendScheduled: true })),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  assignCategoryPathToMessage: jest.fn(),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(() => null),
}));

jest.mock('../../electron/email/email-imap-sync', () => ({
  syncInboxImap: jest.fn().mockResolvedValue({ fetched: 3 }),
}));

jest.mock('../../electron/email/email-pop3-sync', () => ({
  syncInboxPop3: jest.fn().mockResolvedValue({ fetched: 1 }),
}));

import {
  getEmailAccountById,
  listEmailAccounts,
  setOutboundHold,
} from '../../electron/email/email-store';
import { releaseOutboundHoldForDraft } from '../../electron/workflow/draft-send-prep';
import { syncInboxImap } from '../../electron/email/email-imap-sync';
import { interpolateTemplate } from '../../electron/workflow/context';
import { registerEmailNodes } from '../../electron/workflow/nodes/email-nodes';
import { registerIntegrationNodes } from '../../electron/workflow/nodes/integration-nodes';

function collect(registerNodes: (register: (def: RegisteredWorkflowNode) => void) => void) {
  const defs = new Map<string, RegisteredWorkflowNode>();
  registerNodes((def) => defs.set(def.type, def));
  return defs;
}

function ctx(overrides: Partial<WorkflowContext> = {}): WorkflowContext {
  return {
    trigger: 'manual',
    direction: 'manual',
    messageId: null,
    message: null,
    outbound: null,
    workflowId: 1,
    runId: 1,
    dryRun: false,
    variables: {},
    strings: {},
    ai: {},
    ...overrides,
  } as WorkflowContext;
}

describe('interpolateTemplate (Single-Pass-Rewrite)', () => {
  const baseCtx = ctx({
    strings: { subject: 'Rechnung 42', combined_text: 'Hallo Welt' } as never,
    variables: {
      'ai.agent.response': 'Antworttext',
      'ai.class_confidence': 85,
      'customer.name': 'Meier GmbH',
      nullish: null,
    },
  });

  test('löst Keys mit mehreren Punkten exakt auf (alter Regex-Bug)', () => {
    expect(interpolateTemplate('X {{ai.agent.response}} Y', baseCtx)).toBe('X Antworttext Y');
  });

  test('strings, variables, {{text}} und Whitespace-Toleranz', () => {
    expect(interpolateTemplate('{{subject}} | {{ text }} | {{ customer.name }}', baseCtx)).toBe(
      'Rechnung 42 | Hallo Welt | Meier GmbH',
    );
    expect(interpolateTemplate('{{ai.class_confidence}}', baseCtx)).toBe('85');
    expect(interpolateTemplate('{{nullish}}', baseCtx)).toBe('');
  });

  test('unbekannte Platzhalter bleiben unverändert stehen', () => {
    expect(interpolateTemplate('Hi {{gibt.es.nicht}}!', baseCtx)).toBe('Hi {{gibt.es.nicht}}!');
  });

  test('eingesetzte Werte werden nicht erneut interpoliert', () => {
    const c = ctx({
      strings: { combined_text: '{{secret}}' } as never,
      variables: { secret: 'geheim' },
    });
    expect(interpolateTemplate('{{text}}', c)).toBe('{{secret}}');
  });
});

describe('email.release_outbound (eine Registrierung, beide Richtungen)', () => {
  const defs = collect(registerEmailNodes);

  test('ist genau einmal registriert (Duplikat entfernt)', () => {
    const seen: string[] = [];
    registerEmailNodes((def) => seen.push(def.type));
    expect(seen.filter((t) => t === 'email.release_outbound')).toHaveLength(1);
  });

  test('nicht-outbound: hebt Sperre auf und läuft weiter', async () => {
    const def = defs.get('email.release_outbound')!;
    const r = await def.execute(ctx({ direction: 'inbound', messageId: 7 }), {}, 'n1');
    expect(r).toMatchObject({ status: 'ok', message: 'outbound_hold_cleared' });
    expect(setOutboundHold).toHaveBeenCalledWith(7, false, null);
    expect(releaseOutboundHoldForDraft).not.toHaveBeenCalled();
  });

  test('outbound + autoSend: plant Versand über draft-send-prep', async () => {
    const def = defs.get('email.release_outbound')!;
    const r = await def.execute(
      ctx({ direction: 'outbound', messageId: 9 }),
      { autoSend: true },
      'n1',
    );
    expect(r).toMatchObject({ status: 'ok', message: 'outbound_hold_released_auto_send' });
    expect(releaseOutboundHoldForDraft).toHaveBeenCalledWith(9, true, false);
  });

  test('ohne Nachricht im Kontext: nicht-outbound überspringt, outbound meldet Fehler', async () => {
    const def = defs.get('email.release_outbound')!;
    // z. B. Schedule-Trigger: gutmütig überspringen statt den Lauf abzubrechen
    await expect(def.execute(ctx(), {}, 'n1')).resolves.toMatchObject({ status: 'skipped' });
    await expect(
      def.execute(ctx({ direction: 'outbound' }), {}, 'n1'),
    ).resolves.toMatchObject({ status: 'error' });
  });
});

describe('sync.run (Konto aus Config)', () => {
  const defs = collect(registerIntegrationNodes);

  beforeEach(() => {
    jest.clearAllMocks();
    (getEmailAccountById as jest.Mock).mockImplementation((id: number) =>
      id > 0 ? { id, protocol: 'imap' } : null,
    );
  });

  test('config.accountId > 0 gewinnt über Nachricht', async () => {
    const def = defs.get('sync.run')!;
    const r = await def.execute(
      ctx({ message: { account_id: 1 } as never }),
      { accountId: 5 },
      'n1',
    );
    expect(r).toMatchObject({ status: 'ok', variables: { 'sync.fetched': 3 } });
    expect(syncInboxImap).toHaveBeenCalledWith(5);
  });

  test('accountId=0 synct alle Konten', async () => {
    (listEmailAccounts as jest.Mock).mockReturnValue([
      { id: 1, protocol: 'imap' },
      { id: 2, protocol: 'imap' },
    ]);
    const def = defs.get('sync.run')!;
    const r = await def.execute(ctx(), { accountId: 0 }, 'n1');
    expect(r).toMatchObject({ status: 'ok', variables: { 'sync.fetched': 6, 'sync.failed_accounts': 0 } });
    expect(syncInboxImap).toHaveBeenCalledTimes(2);
  });

  test('ohne Config: Fallback auf Konto der Nachricht; ohne beides: skipped', async () => {
    const def = defs.get('sync.run')!;
    await expect(
      def.execute(ctx({ message: { account_id: 2 } as never }), {}, 'n1'),
    ).resolves.toMatchObject({ status: 'ok' });
    expect(syncInboxImap).toHaveBeenCalledWith(2);
    await expect(def.execute(ctx(), {}, 'n1')).resolves.toMatchObject({ status: 'skipped' });
  });
});

describe('Plugin-Knoten: run()-Variablen und Timeout-Schutz', () => {
  test('run() darf { variables } zurückgeben — landet im Ergebnis', async () => {
    const pluginsDir = path.join(tmpUserData, 'workflow-plugins');
    fs.mkdirSync(path.join(pluginsDir, 'demo'), { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'demo.json'),
      JSON.stringify({
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        handlers: [{ id: 'hello', label: 'Hello' }],
      }),
    );
    fs.writeFileSync(
      path.join(pluginsDir, 'demo', 'hello.js'),
      `module.exports.run = async (ctx, config) => ({
        variables: { 'plugin.greeting': 'hallo ' + (config.name || ''), 'plugin.obj': { a: 1 } },
      });`,
    );

    const { loadWorkflowPlugins, runPluginNode } = await import(
      '../../electron/workflow/plugins'
    );
    loadWorkflowPlugins();
    const r = await runPluginNode('demo', 'hello', ctx(), { name: 'welt' });
    expect(r.status).toBe('ok');
    expect(r.variables).toMatchObject({
      'plugin.greeting': 'hallo welt',
      'plugin.obj': JSON.stringify({ a: 1 }),
    });
  });

  test('werfendes run() wird zum Fehler-Ergebnis (kein Crash)', async () => {
    const pluginsDir = path.join(tmpUserData, 'workflow-plugins');
    fs.mkdirSync(path.join(pluginsDir, 'boom'), { recursive: true });
    fs.writeFileSync(
      path.join(pluginsDir, 'boom.json'),
      JSON.stringify({
        id: 'boom',
        name: 'Boom',
        version: '1.0.0',
        handlers: [{ id: 'go', label: 'Go' }],
      }),
    );
    fs.writeFileSync(
      path.join(pluginsDir, 'boom', 'go.js'),
      `module.exports.run = async () => { throw new Error('kaputt'); };`,
    );

    const { loadWorkflowPlugins, runPluginNode } = await import(
      '../../electron/workflow/plugins'
    );
    loadWorkflowPlugins();
    const r = await runPluginNode('boom', 'go', ctx(), {});
    expect(r).toMatchObject({ status: 'error', message: 'kaputt' });
  });
});

describe('Katalog-Parität v1 (Core-Katalog ↔ Electron-Registry)', () => {
  test('jeder Desktop-Registry-Typ hat einen Core-Katalogeintrag und umgekehrt (runtime≠server)', async () => {
    const { listBuiltinWorkflowNodeCatalog } = await import(
      '../../packages/core/src/workflow/node-catalog'
    );
    const { registerEmailNodes } = await import('../../electron/workflow/nodes/email-nodes');
    const { registerCrmNodes } = await import('../../electron/workflow/nodes/crm-nodes');
    const { registerAiNodes } = await import('../../electron/workflow/nodes/ai-nodes');
    const { registerLogicNodes } = await import('../../electron/workflow/nodes/logic-nodes');
    const { registerCodeNodes } = await import('../../electron/workflow/nodes/code-nodes');
    const { registerIntegrationNodes } = await import(
      '../../electron/workflow/nodes/integration-nodes'
    );
    const { registerWorkflowMetaNodes } = await import(
      '../../electron/workflow/nodes/workflow-nodes'
    );

    const registered = new Map<string, RegisteredWorkflowNode>();
    const reg = (def: RegisteredWorkflowNode) => {
      expect(registered.has(def.type)).toBe(false);
      registered.set(def.type, def);
    };
    registerEmailNodes(reg);
    registerCrmNodes(reg);
    registerAiNodes(reg);
    registerLogicNodes(reg);
    registerCodeNodes(reg);
    registerIntegrationNodes(reg);
    registerWorkflowMetaNodes(reg);

    const catalog = listBuiltinWorkflowNodeCatalog();
    const catalogByType = new Map(catalog.map((e) => [e.type, e]));

    // Jeder registrierte Knoten steht im Core-Katalog …
    for (const type of registered.keys()) {
      expect(catalogByType.has(type)).toBe(true);
    }
    // … und jeder Nicht-Server-Katalogeintrag hat einen Desktop-Executor.
    for (const entry of catalog) {
      if (entry.runtime === 'server') {
        expect(registered.has(entry.type)).toBe(false);
        continue;
      }
      expect(registered.has(entry.type)).toBe(true);
    }
  });

  test('Label und defaultConfig-Keys stimmen zwischen Registry und Core-Katalog überein', async () => {
    const { listBuiltinWorkflowNodeCatalog } = await import(
      '../../packages/core/src/workflow/node-catalog'
    );
    const { registerEmailNodes } = await import('../../electron/workflow/nodes/email-nodes');
    const { registerAiNodes } = await import('../../electron/workflow/nodes/ai-nodes');

    const registered = new Map<string, RegisteredWorkflowNode>();
    registerEmailNodes((d) => registered.set(d.type, d));
    registerAiNodes((d) => registered.set(d.type, d));

    const catalogByType = new Map(listBuiltinWorkflowNodeCatalog().map((e) => [e.type, e]));
    for (const [type, def] of registered) {
      const core = catalogByType.get(type);
      expect(core).toBeDefined();
      expect(def.label).toBe(core!.label);
      const regKeys = Object.keys(def.defaultConfig ?? {}).sort();
      const coreKeys = Object.keys(core!.defaultConfig ?? {}).sort();
      expect(regKeys).toEqual(coreKeys);
    }
  });
});
