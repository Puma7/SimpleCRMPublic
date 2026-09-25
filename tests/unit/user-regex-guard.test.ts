import { spawnSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';
import { createServerApi } from '../../packages/server/src/api/server-api';
import type { AuthenticatedPrincipal, ServerApiPorts } from '../../packages/server/src/api/types';
import {
  compileUserRegex,
  describeUnsupportedUserRegex,
  describeUnsupportedWorkflowRegex,
  findUnsupportedUserRegexConstruct,
} from '../../packages/core/src/user-regex';

const ROOT = path.resolve(__dirname, '../..');
const V8_FLAG = '--enable-experimental-regexp-engine-on-excessive-backtracks';

const editor: AuthenticatedPrincipal = {
  userId: 'user-1',
  workspaceId: 'workspace-1',
  role: 'user',
  capabilities: ['workflows.view', 'workflows.edit', 'workflows.manage'],
};

function regexGraph(value: string) {
  return {
    version: 1,
    nodes: [
      { id: 't1', type: 'trigger', data: { kind: 'inbound' } },
      { id: 'c1', type: 'condition', data: { field: 'subject', op: 'regex', value, caseInsensitive: true } },
    ],
    edges: [{ id: 'e1', source: 't1', target: 'c1' }],
  };
}

function workflowPorts() {
  const create = jest.fn(async ({ values }: { values: Record<string, unknown> }) => ({
    ok: true as const,
    workflow: { id: 5, name: String(values.name ?? 'W'), triggerName: 'email.inbound', enabled: true, priority: 100 },
  }));
  const update = jest.fn(async () => ({
    ok: true as const,
    workflow: { id: 5, name: 'W', triggerName: 'email.inbound', enabled: true, priority: 100 },
  }));
  const get = jest.fn(async () => ({
    id: 5,
    name: 'W',
    triggerName: 'email.inbound',
    enabled: true,
    priority: 100,
    graph: null,
    executionMode: 'graph',
    overrideKey: null,
  }));
  const ports = { workflows: { create, update, get } } as unknown as ServerApiPorts;
  return { ports, create, update };
}

describe('Nutzer-Regex: lineare Engine als ReDoS-Schutz (F-A13A14-04, E1)', () => {
  // F-A13A14-04: Lookarounds und Rueckverweise wurden beim Speichern angenommen, obwohl V8 solche Muster nicht auf die lineare Engine umstellen kann.
  test.each([
    ['(?=a)(a|a)*b', 'lookaround'],
    ['x(?!y)', 'lookaround'],
    ['(?<=Rechnung )\\d+', 'lookaround'],
    ['(?<!Re: )Angebot', 'lookaround'],
    ['(a|a)*\\1b', 'backreference'],
    ['(?<w>\\w+) \\k<w>', 'backreference'],
  ])('erkennt %s als %s', (pattern, construct) => {
    expect(findUnsupportedUserRegexConstruct(pattern)).toBe(construct);
    expect(describeUnsupportedUserRegex(pattern)).toMatch(/nicht erlaubt/);
  });

  test.each([
    'IBAN|Passwort|Kontostand',
    '\\bIBAN\\b|\\bDE\\d{20}\\b|Kontostand|Passwort\\s*[:\\s]',
    '(?<nummer>\\d+)',
    '(?:Re|AW): ',
    '\\(?=\\)',
    '[(?=]',
    '\\\\1',
    '[\\1]',
    '(a|a)*b',
  ])('laesst %s zu', (pattern) => {
    expect(findUnsupportedUserRegexConstruct(pattern)).toBeNull();
    expect(describeUnsupportedUserRegex(pattern)).toBeNull();
  });

  test('prueft Graph-Bedingungen und Definitionsregeln (auch als JSON-Text)', () => {
    expect(describeUnsupportedWorkflowRegex({ graph: regexGraph('(?=x)y') })).toMatch(/Lookaround/);
    expect(describeUnsupportedWorkflowRegex({ graph: JSON.stringify(regexGraph('(a)\\1')) })).toMatch(/Rückverweis/);
    expect(describeUnsupportedWorkflowRegex({
      definition: {
        version: 1,
        rules: [{ when: { any: [{ not: { field: 'subject', op: 'regex', value: '(?<!a)b' } }] }, then: [] }],
      },
    })).toMatch(/Lookaround/);
    expect(describeUnsupportedWorkflowRegex({ graph: regexGraph('rechnung|invoice') })).toBeNull();
    expect(describeUnsupportedWorkflowRegex({ graph: null, definition: 'kein json' })).toBeNull();
  });

  test('Server lehnt Workflow-Regex mit Lookaround oder Rueckverweis beim Anlegen und Aendern ab', async () => {
    const { ports, create, update } = workflowPorts();
    const api = createServerApi(ports);

    const created = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows',
      principal: editor,
      body: { name: 'W', triggerName: 'email.inbound', definition: { version: 1, rules: [] }, graph: regexGraph('(?=a)(a|a)*b') },
    });
    expect(created.status).toBe(400);
    expect(JSON.stringify(created.body)).toContain('Lookaround');
    expect(create).not.toHaveBeenCalled();

    const patched = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/5',
      principal: editor,
      body: { graph: regexGraph('(a|a)*\\1') },
    });
    expect(patched.status).toBe(400);
    expect(JSON.stringify(patched.body)).toContain('Rückverweis');
    expect(update).not.toHaveBeenCalled();

    const definitionOnly = await api.handle({
      method: 'PATCH',
      path: '/api/v1/workflows/5',
      principal: editor,
      body: { definition: { version: 1, rules: [{ when: { field: 'subject', op: 'regex', value: '(?<=x)y' }, then: [] }] } },
    });
    expect(definitionOnly.status).toBe(400);
    expect(update).not.toHaveBeenCalled();

    const ok = await api.handle({
      method: 'POST',
      path: '/api/v1/workflows',
      principal: editor,
      body: { name: 'W', triggerName: 'email.inbound', definition: { version: 1, rules: [] }, graph: regexGraph('rechnung|invoice') },
    });
    expect(ok.status).toBe(201);
    expect(create).toHaveBeenCalledTimes(1);
  });

  test('Server-Image startet die API mit dem V8-Flag (NODE_OPTIONS nimmt es nicht an)', () => {
    const dockerfile = readFileSync(path.join(ROOT, 'docker/api.Dockerfile'), 'utf8');
    const cmd = dockerfile.split('\n').filter((line) => line.startsWith('CMD '));
    expect(cmd).toEqual([`CMD ["node", "${V8_FLAG}", "packages/server/dist/server.js"]`]);
  });

  test('Desktop-Main setzt das V8-Flag fuer den eigenen Prozess und die Renderer vor app.whenReady', () => {
    const main = readFileSync(path.join(ROOT, 'electron/main.js'), 'utf8');
    const ownProcess = main.indexOf(`setFlagsFromString('${V8_FLAG}')`);
    const renderers = main.indexOf(`appendSwitch('js-flags', '${V8_FLAG}')`);
    const ready = main.indexOf('app.whenReady(');
    expect(ownProcess).toBeGreaterThan(-1);
    expect(renderers).toBeGreaterThan(-1);
    expect(ownProcess).toBeLessThan(ready);
    expect(renderers).toBeLessThan(ready);
  });

  // Codex-Review (PR #193): Mit u oder v stellt V8 nicht auf die lineare Engine um.
  test.each(['u', 'v', 'iu', 'gv'])('compileUserRegex lehnt das Flag %s ab', (flags) => {
    expect(() => compileUserRegex('^(a|aa)+$', flags)).toThrow(/Flag/);
  });

  test('compileUserRegex nimmt die geschuetzten Flags weiter an', () => {
    for (const flags of ['', 'i', 'm', 's', 'g', 'y', 'd', 'gims']) {
      expect(compileUserRegex('^rechnung', flags)('Rechnung 42'.toLowerCase())).toBe(true);
    }
  });

  test('mit dem Flag bleibt ein u-Regex exponentiell, deshalb wird er abgelehnt', () => {
    const script = "const t=Date.now();new RegExp('^(a|aa)+$','u').test('a'.repeat(30)+'b');process.stdout.write(String(Date.now()-t));";
    const result = spawnSync(process.execPath, [V8_FLAG, '-e', script], { encoding: 'utf8', timeout: 20_000 });
    expect(result.status).toBe(0);
    // Referenz fuer die Ablehnung oben: ohne lineare Engine waechst die Laufzeit exponentiell.
    expect(Number(result.stdout)).toBeGreaterThan(20);
  });

  test('mit dem Flag laeuft (a|a)*b auf 40 Zeichen linear statt exponentiell', () => {
    const script = "const t=Date.now();new RegExp('(a|a)*b').test('a'.repeat(40)+'!');process.stdout.write(String(Date.now()-t));";
    const result = spawnSync(process.execPath, [V8_FLAG, '-e', script], { encoding: 'utf8', timeout: 20_000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(Number(result.stdout)).toBeLessThan(1000);
  });
});
