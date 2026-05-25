jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getCustomerById: jest.fn(() => null),
}));

jest.mock('../../electron/workflow/run-steps', () => ({
  startWorkflowRun: () => 1,
  finishWorkflowRun: jest.fn(),
  insertWorkflowRunStep: jest.fn(),
}));

jest.mock('../../electron/email/email-store', () => ({
  setMessageArchived: jest.fn(),
  addMessageTag: jest.fn(),
  setMessageSeenLocal: jest.fn(),
  setMessageSpam: jest.fn(),
  getEmailAccountById: jest.fn(),
}));

import { buildDefaultInboundGraph } from '../../electron/workflow/graph-presets';
import { compileGraphToDefinition } from '../../electron/email/email-workflow-graph-compile';
import { evaluateWorkflowWhen } from '../../electron/email/email-workflow-types';
import { runWorkflowGraph } from '../../electron/workflow/runtime';
import { runCompiledInboundRules } from '../../electron/email/email-workflow-engine';
import {
  addMessageTag,
  setMessageArchived,
  setMessageSeenLocal,
} from '../../electron/email/email-store';
import type { EmailMessageRow } from '../../electron/email/email-store';

const neutralCtx = {
  subject: 'Rechnung Mai',
  body_text: 'Guten Tag, anbei die Rechnung.',
  snippet: 'Guten Tag',
  from_address: 'kunde@firma.de',
  to_address: 'support@shop.de',
  cc_address: '',
  combined_text:
    'Rechnung Mai Guten Tag, anbei die Rechnung. Guten Tag kunde@firma.de support@shop.de',
};

function neutralMessage(): EmailMessageRow {
  return {
    id: 42,
    account_id: 1,
    folder_id: 1,
    uid: 100,
    message_id: '<test@example.com>',
    in_reply_to: null,
    references_header: null,
    subject: 'Rechnung Mai',
    from_json: JSON.stringify({ value: [{ address: 'kunde@firma.de', name: 'Kunde' }] }),
    to_json: JSON.stringify({ value: [{ address: 'support@shop.de' }] }),
    cc_json: null,
    date_received: new Date().toISOString(),
    snippet: 'Guten Tag',
    body_text: 'Guten Tag, anbei die Rechnung.',
    body_html: null,
    seen_local: 0,
    archived: 0,
    soft_deleted: 0,
    outbound_hold: 0,
    outbound_block_reason: null,
    thread_id: null,
    ticket_code: null,
    customer_id: null,
    folder_kind: 'inbox',
    imap_thread_id: null,
    has_attachments: 0,
    attachments_json: null,
    assigned_to: null,
    is_spam: 0,
    pop3_uidl: null,
    raw_headers: null,
    created_at: new Date().toISOString(),
  };
}

describe('inbound workflow conditions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('compiled rules for default graph do not match neutral mail', () => {
    const def = compileGraphToDefinition(buildDefaultInboundGraph());
    expect(def.rules.length).toBeGreaterThanOrEqual(2);
    for (const rule of def.rules) {
      expect(rule.when).not.toBeNull();
      expect(evaluateWorkflowWhen(rule.when, neutralCtx)).toBe(false);
    }
  });

  test('graph runtime does not run amazon/newsletter actions on neutral mail', async () => {
    const graph = buildDefaultInboundGraph();
    const r = await runWorkflowGraph({
      workflow: {
        id: 1,
        name: 'test',
        trigger: 'inbound',
        enabled: 1,
        priority: 10,
        definition_json: '{}',
        graph_json: JSON.stringify(graph),
        cron_expr: null,
        schedule_account_id: null,
        execution_mode: 'graph',
        engine_version: 1,
        created_at: '',
        updated_at: '',
      },
      trigger: 'inbound',
      direction: 'inbound',
      runId: 1,
      message: neutralMessage(),
      dryRun: false,
    });

    const log = r.log.join(' ');
    expect(log).toContain('condition:combined_text:no');
    expect(log).not.toContain('condition:combined_text:yes');
    expect(addMessageTag).not.toHaveBeenCalled();
    expect(setMessageArchived).not.toHaveBeenCalled();
    expect(setMessageSeenLocal).not.toHaveBeenCalled();
  });

  test('graph runtime runs amazon branch when combined_text contains amazon', async () => {
    const graph = buildDefaultInboundGraph();
    const msg = neutralMessage();
    msg.subject = 'Ihre Amazon Bestellung';
    msg.body_text = 'Paket von Amazon';
    msg.snippet = 'Amazon';
    const r = await runWorkflowGraph({
      workflow: {
        id: 1,
        name: 'test',
        trigger: 'inbound',
        enabled: 1,
        priority: 10,
        definition_json: '{}',
        graph_json: JSON.stringify(graph),
        cron_expr: null,
        schedule_account_id: null,
        execution_mode: 'graph',
        engine_version: 1,
        created_at: '',
        updated_at: '',
      },
      trigger: 'inbound',
      direction: 'inbound',
      runId: 1,
      message: msg,
      dryRun: false,
    });

    const log = r.log.join(' ');
    expect(log).toContain('condition:combined_text:yes');
    expect(addMessageTag).toHaveBeenCalledWith(42, 'Amazon');
    expect(setMessageArchived).toHaveBeenCalledWith(42, true);
  });

  test('linear graph without Bedingungen does not tag neutral mail', async () => {
    const bad = {
      version: 1 as const,
      nodes: [
        { id: 't1', type: 'trigger' as const, data: { kind: 'inbound' as const } },
        { id: 'a1', type: 'action' as const, data: { actionType: 'tag', tag: 'Amazon' } },
        { id: 'a2', type: 'action' as const, data: { actionType: 'tag', tag: 'Newsletter' } },
        { id: 'a3', type: 'action' as const, data: { actionType: 'mark_seen' } },
        { id: 'a4', type: 'action' as const, data: { actionType: 'archive' } },
      ],
      edges: [
        { id: 'e0', source: 't1', target: 'a1' },
        { id: 'e1', source: 'a1', target: 'a2' },
        { id: 'e2', source: 'a2', target: 'a3' },
        { id: 'e3', source: 'a3', target: 'a4' },
      ],
    };
    await runWorkflowGraph({
      workflow: {
        id: 1,
        name: 'linear',
        trigger: 'inbound',
        enabled: 1,
        priority: 10,
        definition_json: '{}',
        graph_json: JSON.stringify(bad),
        cron_expr: null,
        schedule_account_id: null,
        execution_mode: 'graph',
        engine_version: 1,
        created_at: '',
        updated_at: '',
      },
      trigger: 'inbound',
      direction: 'inbound',
      runId: 1,
      message: neutralMessage(),
      dryRun: false,
    });
    expect(addMessageTag).not.toHaveBeenCalled();
    expect(setMessageArchived).not.toHaveBeenCalled();
    expect(setMessageSeenLocal).not.toHaveBeenCalled();
  });

  test('compiled inbound rules do not tag neutral mail', async () => {
    const def = compileGraphToDefinition(buildDefaultInboundGraph());
    const msg = neutralMessage();
    const log = await runCompiledInboundRules(def, msg.id, msg, 1);
    expect(log.some((l) => l.startsWith('tag:'))).toBe(false);
    expect(addMessageTag).not.toHaveBeenCalled();
  });
});
