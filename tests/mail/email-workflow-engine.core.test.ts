import type { EmailMessageRow } from '../../electron/email/email-store';
import type { WorkflowDefinitionV1 } from '../../electron/email/email-workflow-types';

const mockGetEmailMessageById = jest.fn();
const mockAddMessageTag = jest.fn();
const mockSetMessageArchived = jest.fn();
const mockSetMessageSeenLocal = jest.fn();
const mockSetOutboundHold = jest.fn();
const mockGetEmailAccountById = jest.fn();
const mockListEmailAccounts = jest.fn(() => []);

const mockAssignCategoryPathToMessage = jest.fn();
const mockTryLinkMessageToCustomer = jest.fn();
const mockListAiPrompts = jest.fn(() => [] as { id: number; label: string; user_template: string; target: string; profile_id: number | null; sort_order: number }[]);

const mockListWorkflowsByTrigger = jest.fn(() => [] as { id: number; name: string; trigger: string; enabled: number }[]);
const mockWasWorkflowAppliedToMessage = jest.fn(() => false);
const mockMarkWorkflowAppliedToMessage = jest.fn();
const mockTryClaimInboundWorkflowForMessage = jest.fn(() => true);
const mockReleaseInboundWorkflowClaim = jest.fn();
const mockInsertWorkflowRun = jest.fn();
const mockGetWorkflowById = jest.fn();

const mockRunChatCompletion = jest.fn();
const mockSendWorkflowForwardCopy = jest.fn();
const mockExecuteWorkflowForTrigger = jest.fn();
const mockRunMailSecurityPipeline = jest.fn();
const mockEnsureReplySuggestion = jest.fn();
const mockMaybeSendVacationAutoReply = jest.fn();
const mockReturnOutboundDraftToInbox = jest.fn();
const mockSyncInboxPop3 = jest.fn();
const mockSyncInboxImap = jest.fn();
const mockTryOutboundApprovalBypass = jest.fn(() => false);

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (...args: unknown[]) => mockGetEmailMessageById(...args),
  addMessageTag: (...args: unknown[]) => mockAddMessageTag(...args),
  setMessageArchived: (...args: unknown[]) => mockSetMessageArchived(...args),
  setMessageSeenLocal: (...args: unknown[]) => mockSetMessageSeenLocal(...args),
  setOutboundHold: (...args: unknown[]) => mockSetOutboundHold(...args),
  getEmailAccountById: (...args: unknown[]) => mockGetEmailAccountById(...args),
  listEmailAccounts: (...args: unknown[]) => mockListEmailAccounts(...args),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  assignCategoryPathToMessage: (...args: unknown[]) => mockAssignCategoryPathToMessage(...args),
  tryLinkMessageToCustomer: (...args: unknown[]) => mockTryLinkMessageToCustomer(...args),
  listAiPrompts: (...args: unknown[]) => mockListAiPrompts(...args),
}));

jest.mock('../../electron/email/email-workflow-store', () => ({
  listWorkflowsByTrigger: (...args: unknown[]) => mockListWorkflowsByTrigger(...args),
  wasWorkflowAppliedToMessage: (...args: unknown[]) => mockWasWorkflowAppliedToMessage(...args),
  markWorkflowAppliedToMessage: (...args: unknown[]) => mockMarkWorkflowAppliedToMessage(...args),
  tryClaimInboundWorkflowForMessage: (...args: unknown[]) => mockTryClaimInboundWorkflowForMessage(...args),
  releaseInboundWorkflowClaim: (...args: unknown[]) => mockReleaseInboundWorkflowClaim(...args),
  insertWorkflowRun: (...args: unknown[]) => mockInsertWorkflowRun(...args),
  getWorkflowById: (...args: unknown[]) => mockGetWorkflowById(...args),
}));

jest.mock('../../electron/email/email-openai', () => ({
  runChatCompletion: (...args: unknown[]) => mockRunChatCompletion(...args),
}));

jest.mock('../../electron/email/email-forward-copy', () => ({
  sendWorkflowForwardCopy: (...args: unknown[]) => mockSendWorkflowForwardCopy(...args),
}));

jest.mock('../../electron/workflow/workflow-executor', () => ({
  executeWorkflowForTrigger: (...args: unknown[]) => mockExecuteWorkflowForTrigger(...args),
}));

jest.mock('../../electron/email/mail-security-pipeline', () => ({
  runMailSecurityPipeline: (...args: unknown[]) => mockRunMailSecurityPipeline(...args),
}));

jest.mock('../../electron/email/email-reply-ai', () => ({
  ensureReplySuggestion: (...args: unknown[]) => mockEnsureReplySuggestion(...args),
}));

jest.mock('../../electron/email/email-vacation', () => ({
  maybeSendVacationAutoReply: (...args: unknown[]) => mockMaybeSendVacationAutoReply(...args),
}));

jest.mock('../../electron/email/email-outbound-review', () => ({
  returnOutboundDraftToInbox: (...args: unknown[]) => mockReturnOutboundDraftToInbox(...args),
}));

jest.mock('../../electron/email/outbound-approval', () => ({
  tryOutboundApprovalBypass: (...args: unknown[]) => mockTryOutboundApprovalBypass(...args),
  stampOutboundApprovalMarker: jest.fn(),
  clearOutboundApprovalMarker: jest.fn(),
  outboundReviewApprovedKey: (draftId: number) => `outbound_review_approved:${draftId}`,
}));

jest.mock('../../electron/email/email-pop3-sync', () => ({
  syncInboxPop3: (...args: unknown[]) => mockSyncInboxPop3(...args),
}));

jest.mock('../../electron/email/email-imap-sync', () => ({
  syncInboxImap: (...args: unknown[]) => mockSyncInboxImap(...args),
}));

jest.mock('../../electron/workflow/run-steps', () => ({
  getLatestWorkflowRunForMessage: jest.fn(() => undefined),
}));

import {
  evaluateOutboundWorkflows,
  outboundPayloadFromMessage,
  runCompiledInboundRules,
  runCompiledOutboundRules,
  runDraftCreatedWorkflowsForMessage,
  runInboundWorkflowsForMessage,
  runScheduledWorkflowFire,
} from '../../electron/email/email-workflow-engine';

function draftRow(overrides: Partial<EmailMessageRow> = {}): EmailMessageRow {
  return {
    id: 10,
    account_id: 1,
    folder_id: 1,
    uid: -5,
    message_id: null,
    in_reply_to: null,
    references_header: null,
    subject: 'Subject',
    from_json: JSON.stringify({ value: [{ address: 'me@test.de' }] }),
    to_json: JSON.stringify({ value: [{ address: 'to@test.de' }] }),
    cc_json: JSON.stringify({ value: [{ address: 'cc@test.de' }] }),
    bcc_json: null,
    date_received: null,
    snippet: 'snip',
    body_text: 'Hello body',
    body_html: '<p>Hello</p>',
    seen_local: 0,
    archived: 0,
    soft_deleted: 0,
    outbound_hold: 0,
    outbound_block_reason: null,
    thread_id: null,
    ticket_code: null,
    customer_id: null,
    folder_kind: 'draft',
    imap_thread_id: null,
    has_attachments: 0,
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
  };
}

function inboundRow(overrides: Partial<EmailMessageRow> = {}): EmailMessageRow {
  return draftRow({
    id: 42,
    uid: 100,
    folder_kind: 'inbox',
    from_json: JSON.stringify({ value: [{ address: 'from@test.de' }] }),
    ...overrides,
  });
}

describe('email-workflow-engine core', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockRunMailSecurityPipeline.mockResolvedValue({ preWorkflow: { skippedWorkflows: false } });
    mockExecuteWorkflowForTrigger.mockResolvedValue({
      status: 'ok',
      blocked: false,
      blockReason: null,
      log: [],
    });
    mockSendWorkflowForwardCopy.mockResolvedValue({ ok: true });
    mockRunChatCompletion.mockResolvedValue('OK');
    mockSyncInboxPop3.mockResolvedValue({ fetched: 2 });
    mockSyncInboxImap.mockResolvedValue({ fetched: 3 });
    mockTryOutboundApprovalBypass.mockReturnValue(false);
  });

  describe('outboundPayloadFromMessage', () => {
    test('maps row fields and attachment count', () => {
      const row = draftRow();
      expect(outboundPayloadFromMessage(row, { attachmentCount: 2 })).toEqual({
        messageId: 10,
        subject: 'Subject',
        bodyText: 'Hello body',
        bodyHtml: '<p>Hello</p>',
        to: 'to@test.de',
        cc: 'cc@test.de',
        attachmentCount: 2,
      });
    });

    test('handles null json and defaults', () => {
      const row = draftRow({
        subject: null,
        body_text: null,
        body_html: null,
        to_json: null,
        cc_json: null,
      });
      expect(outboundPayloadFromMessage(row)).toMatchObject({
        subject: '',
        bodyText: '',
        to: '',
        attachmentCount: 0,
      });
    });
  });

  describe('runCompiledInboundRules', () => {
    test('executes matched inbound steps and stops on stop', async () => {
      const msg = inboundRow({ subject: 'Amazon order', has_attachments: 1 });
      const def: WorkflowDefinitionV1 = {
        version: 1,
        rules: [
          {
            when: { field: 'combined_text', op: 'contains', value: 'Amazon' },
            then: [
              { type: 'tag', tag: 'Amazon' },
              { type: 'mark_seen' },
              { type: 'archive' },
              { type: 'set_category', path: 'Shop/Amazon' },
              { type: 'link_customer' },
              { type: 'stop' },
              { type: 'tag', tag: 'never' },
            ],
          },
        ],
      };
      const log = await runCompiledInboundRules(def, msg.id, msg, 1);
      expect(log).toContain('rule_matched');
      expect(mockAddMessageTag).toHaveBeenCalledWith(42, 'Amazon');
      expect(mockSetMessageSeenLocal).toHaveBeenCalledWith(42, true);
      expect(mockSetMessageArchived).toHaveBeenCalledWith(42, true);
      expect(mockAssignCategoryPathToMessage).toHaveBeenCalledWith(42, 'Shop/Amazon');
      expect(mockTryLinkMessageToCustomer).toHaveBeenCalledWith(42);
      expect(log).toContain('stop');
    });

    test('executes unconditional compiled inbound rules like outbound rules', async () => {
      const msg = inboundRow();
      const def: WorkflowDefinitionV1 = {
        version: 1,
        rules: [{ when: null, then: [{ type: 'tag', tag: 'X' }] }],
      };
      const log = await runCompiledInboundRules(def, msg.id, msg, 1);
      expect(log).toContain('rule_matched');
      expect(mockAddMessageTag).toHaveBeenCalledWith(42, 'X');
    });

    test('hold_outbound inbound and unknown step default', async () => {
      const msg = inboundRow({ subject: 'Hold me' });
      const def: WorkflowDefinitionV1 = {
        version: 1,
        rules: [
          {
            when: { field: 'subject', op: 'contains', value: 'Hold' },
            then: [
              { type: 'hold_outbound', reason: 'review' },
              { type: 'unknown' as 'stop' },
            ],
          },
        ],
      };
      const log = await runCompiledInboundRules(def, msg.id, msg, 1);
      expect(mockSetOutboundHold).toHaveBeenCalledWith(42, true, 'review');
      expect(log.some((l) => l.startsWith('hold_outbound:'))).toBe(true);
    });

    test('forward_copy, attachment meta, ai_review branches', async () => {
      const msg = inboundRow({ subject: 'Fwd test', has_attachments: 0 });
      mockListAiPrompts.mockReturnValue([
        { id: 5, label: 'P', user_template: '{{text}}', target: 'full_body', profile_id: null, sort_order: 0 },
      ]);
      mockRunChatCompletion.mockResolvedValueOnce('BLOCK spam');
      const def: WorkflowDefinitionV1 = {
        version: 1,
        rules: [
          {
            when: { field: 'subject', op: 'contains', value: 'Fwd' },
            then: [
              { type: 'forward_copy', to: 'audit@test.de' },
              { type: 'tag_attachment_meta', tag: 'has-file' },
              { type: 'ai_review', promptId: 5, blockKeyword: 'BLOCK' },
              { type: 'ai_review', promptId: 99 },
            ],
          },
        ],
      };
      const log = await runCompiledInboundRules(def, msg.id, msg, 7);
      expect(log.some((l) => l.startsWith('forward_copy:'))).toBe(true);
      expect(log).toContain('tag_attachment_meta:skip');
      expect(log).toContain('ai_review:block:BLOCK');
      expect(log).toContain('ai_review:prompt_not_found');
      expect(mockAddMessageTag).toHaveBeenCalledWith(42, 'ki-review-block');
    });

    test('ai_review error and forward_copy blocked', async () => {
      const msg = inboundRow({ subject: 'Err', has_attachments: 1 });
      mockSendWorkflowForwardCopy.mockResolvedValueOnce({ ok: false, reason: 'rate' });
      mockListAiPrompts.mockReturnValue([
        { id: 1, label: 'P', user_template: '{{text}}', target: 'full_body', profile_id: null, sort_order: 0 },
      ]);
      mockRunChatCompletion.mockRejectedValueOnce(new Error('openai down'));
      const def: WorkflowDefinitionV1 = {
        version: 1,
        rules: [
          {
            when: { field: 'subject', op: 'contains', value: 'Err' },
            then: [
              { type: 'forward_copy', to: 'x@test.de' },
              { type: 'tag_attachment_meta', tag: 'att' },
              { type: 'ai_review', promptId: 1 },
            ],
          },
        ],
      };
      const log = await runCompiledInboundRules(def, msg.id, msg, 1);
      expect(log).toContain('forward_copy_blocked:rate');
      expect(log).toContain('tag_attachment_meta:att');
      expect(log.some((l) => l.startsWith('ai_review_error:'))).toBe(true);
    });
  });

  describe('runCompiledOutboundRules', () => {
    test('hold_outbound and ai_review block outbound', async () => {
      mockListAiPrompts.mockReturnValue([
        { id: 2, label: 'P', user_template: '{{text}}', target: 'full_body', profile_id: null, sort_order: 0 },
      ]);
      mockRunChatCompletion.mockResolvedValue('BLOCK');
      const payload = outboundPayloadFromMessage(draftRow());
      const def: WorkflowDefinitionV1 = {
        version: 1,
        rules: [
          {
            when: { field: 'subject', op: 'contains', value: 'Subject' },
            then: [{ type: 'ai_review', promptId: 2 }],
          },
        ],
      };
      const r = await runCompiledOutboundRules(def, payload);
      expect(r.blocked).toBe(true);
      expect(mockSetOutboundHold).toHaveBeenCalledWith(10, true, 'KI-Prüfung: Versand blockiert');
    });

    test('ai_review ok continues outbound', async () => {
      mockListAiPrompts.mockReturnValue([
        { id: 2, label: 'P', user_template: '{{text}}', target: 'full_body', profile_id: null, sort_order: 0 },
      ]);
      mockRunChatCompletion.mockResolvedValue('OK');
      const payload = outboundPayloadFromMessage(draftRow());
      const def: WorkflowDefinitionV1 = {
        version: 1,
        rules: [
          {
            when: { field: 'subject', op: 'contains', value: 'Subject' },
            then: [{ type: 'ai_review', promptId: 2 }],
          },
        ],
      };
      const r = await runCompiledOutboundRules(def, payload);
      expect(r.blocked).toBe(false);
      expect(r.log).toContain('ai_review:ok');
    });

    test('stop and unknown step types', async () => {
      const payload = outboundPayloadFromMessage(draftRow());
      const holdDef: WorkflowDefinitionV1 = {
        version: 1,
        rules: [
          {
            when: { field: 'subject', op: 'contains', value: 'Subject' },
            then: [{ type: 'hold_outbound', reason: 'manual' }],
          },
        ],
      };
      const hold = await runCompiledOutboundRules(holdDef, payload);
      expect(hold.blocked).toBe(true);

      const stopDef: WorkflowDefinitionV1 = {
        version: 1,
        rules: [
          {
            when: { field: 'subject', op: 'contains', value: 'Subject' },
            then: [{ type: 'stop' }],
          },
        ],
      };
      const stop = await runCompiledOutboundRules(stopDef, payload);
      expect(stop.blocked).toBe(false);
      expect(stop.log).toContain('stop');

      const skipDef: WorkflowDefinitionV1 = {
        version: 1,
        rules: [
          {
            when: { field: 'subject', op: 'contains', value: 'Subject' },
            then: [{ type: 'tag', tag: 'ignored' }],
          },
        ],
      };
      const skip = await runCompiledOutboundRules(skipDef, payload);
      expect(skip.log.some((l) => l.startsWith('skip:'))).toBe(true);
    });
  });

  describe('evaluateOutboundWorkflows', () => {
    test('rejects invalid or missing draft', async () => {
      expect(await evaluateOutboundWorkflows({ ...outboundPayloadFromMessage(draftRow()), messageId: 0 })).toEqual({
        allowed: false,
        reason: 'Kein gültiger Entwurf für die Ausgangsprüfung',
      });
      mockGetEmailMessageById.mockReturnValue(undefined);
      expect(await evaluateOutboundWorkflows(outboundPayloadFromMessage(draftRow()))).toEqual({
        allowed: false,
        reason: 'Entwurf nicht gefunden',
      });
    });

    test('allows when workflows pass', async () => {
      const row = draftRow();
      mockGetEmailMessageById.mockReturnValue(row);
      mockListWorkflowsByTrigger.mockReturnValue([{ id: 1, name: 'W', trigger: 'outbound', enabled: 1 }]);
      const r = await evaluateOutboundWorkflows(outboundPayloadFromMessage(row));
      expect(r).toEqual({ allowed: true, reason: null, workflowRunId: null });
      expect(mockSetOutboundHold).toHaveBeenCalledWith(10, false, null);
    });

    test('blocks when workflow returns blocked', async () => {
      const row = draftRow();
      mockGetEmailMessageById.mockReturnValue(row);
      mockListWorkflowsByTrigger.mockReturnValue([{ id: 1, name: 'W', trigger: 'outbound', enabled: 1 }]);
      mockExecuteWorkflowForTrigger.mockResolvedValueOnce({
        status: 'ok',
        blocked: true,
        blockReason: 'Bad content',
        log: [],
      });
      const r = await evaluateOutboundWorkflows(outboundPayloadFromMessage(row));
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe('Bad content');
      expect(mockReturnOutboundDraftToInbox).toHaveBeenCalled();
    });

    test('dryRun and sideEffects none skip hold side effects', async () => {
      const row = draftRow();
      mockGetEmailMessageById.mockReturnValue(row);
      mockListWorkflowsByTrigger.mockReturnValue([]);
      await evaluateOutboundWorkflows(outboundPayloadFromMessage(row), { dryRun: true });
      await evaluateOutboundWorkflows(outboundPayloadFromMessage(row), { sideEffects: 'none' });
      expect(mockSetOutboundHold).not.toHaveBeenCalled();
    });

    test('handles workflow error status and thrown errors', async () => {
      const row = draftRow();
      mockGetEmailMessageById.mockReturnValue(row);
      mockListWorkflowsByTrigger.mockReturnValue([
        { id: 1, name: 'W1', trigger: 'outbound', enabled: 1 },
        { id: 2, name: 'W2', trigger: 'outbound', enabled: 1 },
      ]);
      mockExecuteWorkflowForTrigger
        .mockResolvedValueOnce({ status: 'error', blocked: false, blockReason: null, log: ['parse fail'] })
        .mockRejectedValueOnce(new Error('boom'));
      const r = await evaluateOutboundWorkflows(outboundPayloadFromMessage(row));
      expect(r.allowed).toBe(false);
      expect(mockInsertWorkflowRun).toHaveBeenCalled();
      expect(mockReturnOutboundDraftToInbox).toHaveBeenCalled();
    });

    test('blocks when outbound_hold remains after workflows', async () => {
      const row = draftRow();
      mockGetEmailMessageById
        .mockReturnValueOnce(row)
        .mockReturnValueOnce({ ...row, outbound_hold: 1, outbound_block_reason: 'held' });
      mockListWorkflowsByTrigger.mockReturnValue([{ id: 1, name: 'W', trigger: 'outbound', enabled: 1 }]);
      const r = await evaluateOutboundWorkflows(outboundPayloadFromMessage(row));
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe('held');
    });

    test('blocks when outbound_hold set after all workflows complete', async () => {
      const row = draftRow();
      mockGetEmailMessageById.mockReturnValueOnce(row).mockReturnValueOnce({ ...row, outbound_hold: 1, outbound_block_reason: 'late hold' });
      mockListWorkflowsByTrigger.mockReturnValue([]);
      const r = await evaluateOutboundWorkflows(outboundPayloadFromMessage(row));
      expect(r.allowed).toBe(false);
      expect(r.reason).toBe('late hold');
    });
  });

  describe('runInboundWorkflowsForMessage', () => {
    test('returns early for missing row or local draft uid', async () => {
      mockGetEmailMessageById.mockReturnValue(undefined);
      await runInboundWorkflowsForMessage(1);
      expect(mockRunMailSecurityPipeline).not.toHaveBeenCalled();

      await runInboundWorkflowsForMessage(2, { row: draftRow({ uid: -1, pop3_uidl: null }) });
      expect(mockRunMailSecurityPipeline).not.toHaveBeenCalled();
    });

    test('skips when security pipeline skips workflows', async () => {
      const row = inboundRow();
      mockRunMailSecurityPipeline.mockResolvedValueOnce({ preWorkflow: { skippedWorkflows: true } });
      await runInboundWorkflowsForMessage(row.id, { row });
      expect(mockExecuteWorkflowForTrigger).not.toHaveBeenCalled();
    });

    test('runs workflows and claims applied slot', async () => {
      const row = inboundRow();
      const wf = { id: 3, name: 'In', trigger: 'inbound', enabled: 1 };
      mockListWorkflowsByTrigger.mockReturnValue([wf]);
      mockGetEmailMessageById.mockReturnValue(row);
      await runInboundWorkflowsForMessage(row.id, {
        row,
        inboundWorkflows: [wf],
        appliedWorkflowIds: new Set(),
      });
      expect(mockExecuteWorkflowForTrigger).toHaveBeenCalled();
      expect(mockTryClaimInboundWorkflowForMessage).toHaveBeenCalledWith(row.id, 3);
      expect(mockMarkWorkflowAppliedToMessage).not.toHaveBeenCalled();
      expect(mockEnsureReplySuggestion).toHaveBeenCalled();
      expect(mockMaybeSendVacationAutoReply).toHaveBeenCalled();
    });

    test('skips post-steps when an inbound workflow defers on delay', async () => {
      const row = inboundRow();
      const wf = { id: 3, name: 'In', trigger: 'inbound', enabled: 1 };
      mockListWorkflowsByTrigger.mockReturnValue([wf]);
      mockGetEmailMessageById.mockReturnValue(row);
      mockExecuteWorkflowForTrigger.mockResolvedValueOnce({
        runId: 1,
        status: 'ok',
        log: ['delayed'],
        blocked: false,
        blockReason: null,
        deferred: true,
      });
      await runInboundWorkflowsForMessage(row.id, {
        row,
        inboundWorkflows: [wf],
        appliedWorkflowIds: new Set(),
      });
      expect(mockExecuteWorkflowForTrigger).toHaveBeenCalled();
      expect(mockEnsureReplySuggestion).not.toHaveBeenCalled();
      expect(mockMaybeSendVacationAutoReply).not.toHaveBeenCalled();
    });

    test('skips applied workflows and records executor errors', async () => {
      const row = inboundRow();
      mockWasWorkflowAppliedToMessage.mockReturnValueOnce(true);
      mockExecuteWorkflowForTrigger.mockRejectedValueOnce(new Error('exec fail'));
      mockListWorkflowsByTrigger.mockReturnValue([
        { id: 1, name: 'A', trigger: 'inbound', enabled: 1 },
        { id: 2, name: 'B', trigger: 'inbound', enabled: 1 },
      ]);
      mockGetEmailMessageById.mockReturnValue(row);
      await runInboundWorkflowsForMessage(row.id);
      expect(mockInsertWorkflowRun).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'error', direction: 'inbound' }),
      );
    });
  });

  describe('runDraftCreatedWorkflowsForMessage', () => {
    test('returns early for missing row or non-draft uid', async () => {
      mockGetEmailMessageById.mockReturnValue(undefined);
      await runDraftCreatedWorkflowsForMessage(1);
      mockGetEmailMessageById.mockReturnValue(inboundRow());
      await runDraftCreatedWorkflowsForMessage(42);
      expect(mockExecuteWorkflowForTrigger).not.toHaveBeenCalled();
    });

    test('runs draft_created workflows', async () => {
      const row = draftRow();
      mockGetEmailMessageById.mockReturnValue(row);
      mockListWorkflowsByTrigger.mockReturnValue([{ id: 4, name: 'D', trigger: 'draft_created', enabled: 1 }]);
      await runDraftCreatedWorkflowsForMessage(row.id);
      expect(mockExecuteWorkflowForTrigger).toHaveBeenCalledWith(
        expect.objectContaining({ trigger: 'draft_created', direction: 'draft_created' }),
      );
      expect(mockTryClaimInboundWorkflowForMessage).toHaveBeenCalledWith(row.id, 4);
    });

    test('records errors from draft_created executor', async () => {
      const row = draftRow();
      mockGetEmailMessageById.mockReturnValue(row);
      mockWasWorkflowAppliedToMessage.mockReturnValue(false);
      mockListWorkflowsByTrigger.mockReturnValue([{ id: 5, name: 'D', trigger: 'draft_created', enabled: 1 }]);
      mockExecuteWorkflowForTrigger.mockRejectedValueOnce('fail');
      await runDraftCreatedWorkflowsForMessage(row.id);
      expect(mockInsertWorkflowRun).toHaveBeenCalledWith(
        expect.objectContaining({ direction: 'draft_created', status: 'error' }),
      );
    });
  });

  describe('runScheduledWorkflowFire', () => {
    test('returns when workflow missing or disabled', async () => {
      mockGetWorkflowById.mockReturnValue(undefined);
      await runScheduledWorkflowFire(1);
      mockGetWorkflowById.mockReturnValue({ id: 1, enabled: 0, trigger: 'schedule' });
      await runScheduledWorkflowFire(1);
      expect(mockExecuteWorkflowForTrigger).not.toHaveBeenCalled();
    });

    test('syncs inbox for imap and pop3 accounts', async () => {
      mockGetWorkflowById.mockReturnValue({
        id: 7,
        enabled: 1,
        trigger: 'schedule',
        schedule_account_id: 2,
      });
      mockGetEmailAccountById.mockReturnValueOnce(undefined);
      await runScheduledWorkflowFire(7);

      mockGetEmailAccountById.mockReturnValueOnce({ id: 2, protocol: 'pop3' });
      await runScheduledWorkflowFire(7);

      mockGetEmailAccountById.mockReturnValueOnce({ id: 2, protocol: 'imap' });
      await runScheduledWorkflowFire(7);

      mockGetEmailAccountById.mockReturnValueOnce({ id: 2, protocol: 'imap' });
      mockSyncInboxImap.mockRejectedValueOnce(new Error('sync fail'));
      await runScheduledWorkflowFire(7);

      expect(mockExecuteWorkflowForTrigger).toHaveBeenCalled();
      expect(mockSyncInboxPop3).toHaveBeenCalledWith(2);
      expect(mockSyncInboxImap).toHaveBeenCalledWith(2);
      const imapSuccessCall = mockExecuteWorkflowForTrigger.mock.calls.find((call) =>
        (call[0] as { eventStrings?: { snippet?: string } }).eventStrings?.snippet?.includes('imap_fetched:3'),
      );
      expect(imapSuccessCall).toBeDefined();
    });

    test('runs scheduled executor without sync account', async () => {
      mockGetWorkflowById.mockReturnValue({
        id: 9,
        enabled: 1,
        trigger: 'inbound',
        schedule_account_id: null,
      });
      await runScheduledWorkflowFire(9);
      expect(mockExecuteWorkflowForTrigger).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'inbound',
          direction: 'schedule',
          initialVariables: expect.objectContaining({ 'schedule.sync_log': 'ok' }),
        }),
      );
    });
  });
});
