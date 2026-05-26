import { ensureBuiltinWorkflowNodes, getWorkflowNode } from '../../electron/workflow/registry';

const mockGenerate = jest.fn();
const mockGetSuggestion = jest.fn();
const mockCanSuggest = jest.fn();

jest.mock('../../electron/email/email-reply-ai', () => ({
  canSuggestReplyForMessage: (...args: unknown[]) => mockCanSuggest(...args),
  getReplySuggestion: (...args: unknown[]) => mockGetSuggestion(...args),
  generateAndStoreReplySuggestion: (...args: unknown[]) => mockGenerate(...args),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(() => null),
  getCustomerById: jest.fn(() => null),
}));

describe('workflow ai.reply_suggestion node', () => {
  beforeAll(() => {
    ensureBuiltinWorkflowNodes();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockCanSuggest.mockReturnValue(true);
    mockGetSuggestion.mockReturnValue({ status: 'none', text: null, error: null });
  });

  test('registers in catalog', () => {
    const def = getWorkflowNode('ai.reply_suggestion');
    expect(def?.label).toMatch(/Antwortvorschlag/i);
    expect(def?.category).toBe('ai');
  });

  test('generates and exposes variables', async () => {
    mockGenerate.mockResolvedValue({ success: true, text: 'Guten Tag,\n\nvielen Dank.' });
    const def = getWorkflowNode('ai.reply_suggestion')!;
    const ctx = {
      messageId: 42,
      message: { id: 42, customer_id: 1, folder_kind: 'inbox' },
      direction: 'inbound' as const,
      trigger: 'inbound' as const,
      dryRun: false,
      variables: {},
      strings: {},
      workflowId: 1,
      runId: 1,
      ai: {},
    };
    const r = await def.execute(ctx as never, { promptId: 0 });
    expect(r.status).toBe('ok');
    expect(r.variables?.['reply_suggestion.text']).toContain('Guten Tag');
    expect(mockGenerate).toHaveBeenCalledWith(42, expect.objectContaining({ customerId: 1 }));
  });

  test('skips when already ready', async () => {
    mockGetSuggestion.mockReturnValue({
      status: 'ready',
      text: 'Bestehend',
      error: null,
    });
    const def = getWorkflowNode('ai.reply_suggestion')!;
    const ctx = {
      messageId: 5,
      message: { id: 5, folder_kind: 'inbox' },
      direction: 'inbound' as const,
      trigger: 'inbound' as const,
      dryRun: false,
      variables: {},
      strings: {},
      workflowId: 1,
      runId: 1,
      ai: {},
    };
    const r = await def.execute(ctx as never, { skipIfReady: true });
    expect(r.status).toBe('ok');
    expect(mockGenerate).not.toHaveBeenCalled();
    expect(r.variables?.['reply_suggestion.text']).toBe('Bestehend');
  });
});
