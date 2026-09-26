/**
 * Dry-Run eines Workflows im compiled-Modus über den echten Executor
 * (workflow-executor → compiled-fallback → email-workflow-engine).
 * Nur Persistenz, SMTP-Weiterleitung und KI sind gemockt.
 */
import type { EmailMessageRow } from '../../electron/email/email-store';
import type { WorkflowDefinitionV1 } from '../../electron/email/email-workflow-types';

const mockGetEmailMessageById = jest.fn();
const mockAddMessageTag = jest.fn();
const mockSetMessageArchived = jest.fn();
const mockSetMessageSeenLocal = jest.fn();
const mockSetOutboundHold = jest.fn();
const mockAssignCategoryPathToMessage = jest.fn();
const mockTryLinkMessageToCustomer = jest.fn();
const mockListAiPrompts = jest.fn();
const mockRunChatCompletion = jest.fn();
const mockSendWorkflowForwardCopy = jest.fn();
const mockGetWorkflowById = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (...args: unknown[]) => mockGetEmailMessageById(...args),
  addMessageTag: (...args: unknown[]) => mockAddMessageTag(...args),
  setMessageArchived: (...args: unknown[]) => mockSetMessageArchived(...args),
  setMessageSeenLocal: (...args: unknown[]) => mockSetMessageSeenLocal(...args),
  setOutboundHold: (...args: unknown[]) => mockSetOutboundHold(...args),
  getEmailAccountById: jest.fn(() => ({ id: 1, protocol: 'imap', imap_sync_seen_on_open: 1 })),
  listEmailAccounts: jest.fn(() => []),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  assignCategoryPathToMessage: (...args: unknown[]) => mockAssignCategoryPathToMessage(...args),
  tryLinkMessageToCustomer: (...args: unknown[]) => mockTryLinkMessageToCustomer(...args),
  listAiPrompts: (...args: unknown[]) => mockListAiPrompts(...args),
}));

jest.mock('../../electron/email/email-workflow-store', () => ({
  getWorkflowById: (...args: unknown[]) => mockGetWorkflowById(...args),
  listWorkflowsByTrigger: jest.fn(() => []),
  tryClaimInboundWorkflowForMessage: jest.fn(() => true),
  releaseInboundWorkflowClaim: jest.fn(),
  insertWorkflowRun: jest.fn(),
}));

jest.mock('../../electron/email/email-openai', () => ({
  runChatCompletion: (...args: unknown[]) => mockRunChatCompletion(...args),
}));

jest.mock('../../electron/email/email-forward-copy', () => ({
  sendWorkflowForwardCopy: (...args: unknown[]) => mockSendWorkflowForwardCopy(...args),
}));

jest.mock('../../electron/workflow/run-steps', () => ({
  startWorkflowRun: jest.fn(() => 501),
  finishWorkflowRun: jest.fn(),
  insertWorkflowRunStep: jest.fn(),
  getLatestWorkflowRunForMessage: jest.fn(() => undefined),
}));

jest.mock('../../electron/workflow/delayed-jobs-store', () => ({
  cancelPendingDelayedJobsForMessageSafe: jest.fn(),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
  getSyncInfo: jest.fn(() => null),
  getCustomerById: jest.fn(() => null),
}));

import {
  executeWorkflowForTrigger,
  executeWorkflowNow,
  testWorkflowOnMessage,
} from '../../electron/workflow/workflow-executor';

function inboundRow(overrides: Partial<EmailMessageRow> = {}): EmailMessageRow {
  return {
    id: 42,
    account_id: 1,
    folder_id: 1,
    uid: 100,
    message_id: null,
    in_reply_to: null,
    references_header: null,
    subject: 'Rechnung 2026',
    from_json: JSON.stringify({ value: [{ address: 'from@test.de' }] }),
    to_json: JSON.stringify({ value: [{ address: 'to@test.de' }] }),
    cc_json: null,
    bcc_json: null,
    date_received: null,
    snippet: 'snip',
    body_text: 'Hallo',
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
    has_attachments: 1,
    attachments_json: null,
    assigned_to: null,
    is_spam: 0,
    pop3_uidl: null,
    raw_headers: null,
    raw_rfc822_b64: null,
    created_at: 't',
    auth_spf: null,
    auth_dkim: null,
    auth_dmarc: null,
    auth_arc: null,
    auth_dkim_domains: null,
    ...overrides,
  } as EmailMessageRow;
}

function compiledWorkflow(trigger: 'inbound' | 'outbound', def: WorkflowDefinitionV1) {
  return {
    id: 1,
    name: 'Compiled',
    trigger,
    enabled: 1,
    priority: 0,
    definition_json: JSON.stringify(def),
    graph_json: JSON.stringify({
      version: 1,
      nodes: [{ id: 'trigger-1', type: 'trigger', data: { kind: trigger } }],
      edges: [],
    }),
    cron_expr: null,
    schedule_account_id: null,
    account_id: null,
    override_key: null,
    execution_mode: 'compiled',
    engine_version: 1,
    created_at: 't',
    updated_at: 't',
  };
}

const inboundDef: WorkflowDefinitionV1 = {
  version: 1,
  rules: [
    {
      when: { field: 'subject', op: 'contains', value: 'Rechnung' },
      then: [
        { type: 'tag', tag: 'Rechnung' },
        { type: 'mark_seen' },
        { type: 'archive' },
        { type: 'hold_outbound', reason: 'pruefen' },
        { type: 'set_category', path: 'Buchhaltung' },
        { type: 'link_customer' },
        { type: 'tag_attachment_meta', tag: 'mit-anhang' },
        { type: 'forward_copy', to: 'buchhaltung@test.de' },
        { type: 'ai_review', promptId: 5 },
      ],
    },
  ],
};

function expectNoMessageSideEffects() {
  expect(mockAddMessageTag).not.toHaveBeenCalled();
  expect(mockSetMessageSeenLocal).not.toHaveBeenCalled();
  expect(mockSetMessageArchived).not.toHaveBeenCalled();
  expect(mockSetOutboundHold).not.toHaveBeenCalled();
  expect(mockAssignCategoryPathToMessage).not.toHaveBeenCalled();
  expect(mockTryLinkMessageToCustomer).not.toHaveBeenCalled();
  expect(mockSendWorkflowForwardCopy).not.toHaveBeenCalled();
}

describe('compiled workflow dry-run (desktop executor)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetEmailMessageById.mockReturnValue(inboundRow());
    mockSendWorkflowForwardCopy.mockResolvedValue({ ok: true });
    mockListAiPrompts.mockReturnValue([
      { id: 5, label: 'P', user_template: '{{text}}', target: 'full_body', profile_id: null, sort_order: 0 },
    ]);
    mockRunChatCompletion.mockResolvedValue('BLOCK');
  });

  // C-A24: "Test auf Nachricht" erzwingt dryRun, der compiled-Zweig reichte ihn nicht durch und fuehrte Tag/Archiv/Hold/SMTP live aus.
  test('test-on-message only logs the inbound actions of a compiled workflow', async () => {
    mockGetWorkflowById.mockReturnValue(compiledWorkflow('inbound', inboundDef));

    const result = await testWorkflowOnMessage(1, 42);

    expect(result.success).toBe(true);
    expectNoMessageSideEffects();
    expect(mockRunChatCompletion).not.toHaveBeenCalled();
    expect(result.log).toEqual([
      'compiled_mode',
      'rule_matched',
      'dry_run:tag:Rechnung',
      'dry_run:mark_seen',
      'dry_run:archive',
      'dry_run:hold_outbound:pruefen',
      'dry_run:category:Buchhaltung',
      'dry_run:link_customer',
      'dry_run:tag_attachment_meta:mit-anhang',
      'dry_run:forward_copy:buchhaltung@test.de',
      'dry_run:ai_review',
    ]);
  });

  // C-A24: Auch die Ausgangs-Vorschau (dryRun) setzte bei compiled-Workflows die Versandsperre am Entwurf.
  test('outbound dry-run reports the block without holding the draft', async () => {
    const draft = inboundRow({ id: 10, uid: -5, folder_kind: 'draft', subject: 'Angebot' });
    const holdDef: WorkflowDefinitionV1 = {
      version: 1,
      rules: [
        {
          when: { field: 'subject', op: 'contains', value: 'Angebot' },
          then: [{ type: 'hold_outbound', reason: 'Freigabe' }],
        },
      ],
    };
    const aiDef: WorkflowDefinitionV1 = {
      version: 1,
      rules: [
        {
          when: { field: 'subject', op: 'contains', value: 'Angebot' },
          then: [{ type: 'ai_review', promptId: 5 }],
        },
      ],
    };
    const outbound = {
      messageId: 10,
      accountId: 1,
      subject: 'Angebot',
      bodyText: 'Text',
      to: 'kunde@test.de',
    };

    for (const def of [holdDef, aiDef]) {
      const r = await executeWorkflowForTrigger({
        workflow: compiledWorkflow('outbound', def),
        trigger: 'outbound',
        direction: 'outbound',
        message: draft,
        outbound,
        dryRun: true,
        previewOutbound: true,
      });
      expect(r.blocked).toBe(true);
      expect(r.status).toBe('blocked');
    }
    expect(mockSetOutboundHold).not.toHaveBeenCalled();
  });

  test('a live run of the same compiled workflow still performs the actions', async () => {
    mockGetWorkflowById.mockReturnValue(compiledWorkflow('inbound', inboundDef));

    const result = await executeWorkflowNow(1, { messageId: 42 });

    expect(result.success).toBe(true);
    expect(mockAddMessageTag).toHaveBeenCalledWith(42, 'Rechnung');
    expect(mockSetMessageArchived).toHaveBeenCalledWith(42, true);
    expect(mockSetOutboundHold).toHaveBeenCalledWith(42, true, 'pruefen');
    expect(mockAssignCategoryPathToMessage).toHaveBeenCalledWith(42, 'Buchhaltung');
    expect(mockSendWorkflowForwardCopy).toHaveBeenCalledWith(
      expect.objectContaining({ sourceMessageId: 42, to: 'buchhaltung@test.de' }),
    );
    expect(mockRunChatCompletion).toHaveBeenCalled();
    expect(result.log).toContain('tag:Rechnung');
    expect(result.log).toContain('forward_copy:buchhaltung@test.de');
  });
});
