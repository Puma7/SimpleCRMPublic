// SPIKE (plan 023): proves the desktop jtl.order_context resolver's decision
// logic (placeholder binding, SELECT-only guard, mapping, 0/1/many ambiguity,
// dry-run) and that interpolateTemplate picks up jtl.* variables. The MSSQL
// round-trip is mocked; no live JTL/MSSQL server is needed.
import type { RegisteredWorkflowNode, WorkflowContext } from '../../electron/workflow/types';

jest.mock('../../electron/mssql-keytar-service', () => ({
  executeReadOnlyMssqlQuery: jest.fn(),
}));

// integration-nodes.ts imports getSyncInfo from ../../sqlite-service at module
// top level; mock it so importing registerIntegrationNodes does not load the
// native better-sqlite3 / electron deps in this Node unit test.
jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(() => ''),
}));

import { executeReadOnlyMssqlQuery } from '../../electron/mssql-keytar-service';
import { registerIntegrationNodes } from '../../electron/workflow/nodes/integration-nodes';
import { interpolateTemplate } from '../../electron/workflow/context';

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
  };
}

const mockMssql = executeReadOnlyMssqlQuery as jest.MockedFunction<typeof executeReadOnlyMssqlQuery>;

function jtlNode() {
  return collect(registerIntegrationNodes).get('jtl.order_context')!;
}

describe('spike: jtl.order_context resolver (desktop port)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // The node is off-by-default (see FIX 3 / SIMPLECRM_JTL_CONTEXT_NODE gate).
    // Opt in so the existing tests still exercise the resolver logic.
    process.env.SIMPLECRM_JTL_CONTEXT_NODE = '1';
  });

  afterEach(() => {
    delete process.env.SIMPLECRM_JTL_CONTEXT_NODE;
  });

  test('registration exists on desktop', () => {
    const def = jtlNode();
    expect(def).toBeDefined();
    expect(def.type).toBe('jtl.order_context');
    expect(def.category).toBe('integration');
    expect(def.canvasType).toBe('registry');
  });

  test('happy path binds sender email and maps columns', async () => {
    mockMssql.mockResolvedValue({
      success: true,
      rows: [{ cStatus: 'versendet', cTracking: '00340' }],
    });

    const result = await jtlNode().execute(
      ctx({ strings: { from_address: 'kunde@example.com' }, dryRun: false }),
      {
        query: 'SELECT TOP 1 cStatus, cTracking FROM tBestellung WHERE cEmail = {{email}}',
        mapping: 'cstatus:jtl.status',
      },
      'jtl',
    );

    expect(result).toMatchObject({ status: 'ok', port: 'default' });
    expect(result.variables).toMatchObject({
      'jtl.context_found': true,
      'jtl.status': 'versendet',
      'jtl.ctracking': '00340',
      'jtl.match_count': 1,
    });
    // The raw email must reach SQL only as an escaped literal.
    expect(mockMssql).toHaveBeenCalledTimes(1);
    expect(mockMssql).toHaveBeenCalledWith(
      "SELECT TOP 1 cStatus, cTracking FROM tBestellung WHERE cEmail = 'kunde@example.com'",
    );
  });

  test('no match (0 rows) -> no_match port, context_found false', async () => {
    mockMssql.mockResolvedValue({ success: true, rows: [] });

    const result = await jtlNode().execute(
      ctx({ strings: { from_address: 'kunde@example.com' }, dryRun: false }),
      { query: 'SELECT TOP 1 cStatus FROM tBestellung WHERE cEmail = {{email}}' },
      'jtl',
    );

    expect(result).toMatchObject({ status: 'ok', port: 'no_match' });
    expect(result.variables).toMatchObject({ 'jtl.context_found': false });
  });

  test('many rows -> first row wins and match_count reports ambiguity', async () => {
    mockMssql.mockResolvedValue({
      success: true,
      rows: [{ cStatus: 'a' }, { cStatus: 'b' }],
    });

    const result = await jtlNode().execute(
      ctx({ strings: { from_address: 'kunde@example.com' }, dryRun: false }),
      { query: 'SELECT cStatus FROM tBestellung WHERE cEmail = {{email}}', mapping: 'cstatus:jtl.status' },
      'jtl',
    );

    expect(result).toMatchObject({ status: 'ok', port: 'default' });
    expect(result.variables).toMatchObject({
      'jtl.status': 'a',
      'jtl.match_count': 2,
    });
  });

  test('invalid sender for {{email}} -> no_match, query not run', async () => {
    const result = await jtlNode().execute(
      ctx({ strings: { from_address: 'not-an-email' }, dryRun: false }),
      { query: 'SELECT TOP 1 cStatus FROM tBestellung WHERE cEmail = {{email}}' },
      'jtl',
    );

    expect(result).toMatchObject({ status: 'skipped', port: 'no_match' });
    expect(result.variables).toMatchObject({ 'jtl.context_found': false });
    expect(mockMssql).not.toHaveBeenCalled();
  });

  test('SELECT-only guard rejects mutating query without running it', async () => {
    const result = await jtlNode().execute(
      ctx({ strings: { from_address: 'kunde@example.com' }, dryRun: false }),
      { query: 'DELETE FROM tBestellung' },
      'jtl',
    );

    expect(result.status).toBe('error');
    expect(result.message).toContain('Nur SELECT erlaubt');
    expect(mockMssql).not.toHaveBeenCalled();
  });

  test('SELECT-only guard rejects SELECT ... INTO ... (writes a table) without running it', async () => {
    const result = await jtlNode().execute(
      ctx({ strings: { from_address: 'kunde@example.com' }, dryRun: false }),
      // Begins with SELECT and clears the mutating-keyword blacklist, yet writes
      // a new table — must be rejected by the INTO guard.
      { query: 'SELECT * INTO tShadow FROM tBestellung' },
      'jtl',
    );

    expect(result.status).toBe('error');
    expect(result.message).toContain('Nur SELECT erlaubt');
    expect(mockMssql).not.toHaveBeenCalled();
  });

  test('disabled without SIMPLECRM_JTL_CONTEXT_NODE: returns error and runs no query', async () => {
    delete process.env.SIMPLECRM_JTL_CONTEXT_NODE;

    const result = await jtlNode().execute(
      ctx({ strings: { from_address: 'kunde@example.com' }, dryRun: false }),
      { query: 'SELECT TOP 1 cStatus FROM tBestellung WHERE cEmail = {{email}}' },
      'jtl',
    );

    expect(result).toMatchObject({ status: 'error', port: 'error' });
    expect(result.message).toContain('SIMPLECRM_JTL_CONTEXT_NODE');
    expect(mockMssql).not.toHaveBeenCalled();
  });

  test('dry-run does not hit MSSQL', async () => {
    const result = await jtlNode().execute(
      ctx({ strings: { from_address: 'kunde@example.com' }, dryRun: true }),
      { query: 'SELECT TOP 1 cStatus FROM tBestellung WHERE cEmail = {{email}}' },
      'jtl',
    );

    expect(result.status).toBe('ok');
    expect(mockMssql).not.toHaveBeenCalled();
  });

  test('interpolateTemplate substitutes {{jtl.*}} (proves the injection seam)', () => {
    const rendered = interpolateTemplate(
      'Status: {{jtl.status}}',
      ctx({ variables: { 'jtl.status': 'versendet' } }),
    );
    expect(rendered).toBe('Status: versendet');
  });
});
