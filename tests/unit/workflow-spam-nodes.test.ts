import { ensureBuiltinWorkflowNodes, getWorkflowNode } from '../../electron/workflow/registry';

jest.mock('../../electron/email/email-openai', () => ({
  runChatCompletion: jest.fn(async () => '88'),
}));

jest.mock('../../electron/email/email-store', () => ({
  addMessageTag: jest.fn(),
  setMessageArchived: jest.fn(),
  setMessageSeenLocal: jest.fn(),
  setMessageSpam: jest.fn(),
  setMessageSpamStatus: jest.fn(),
  setMessageAssignedTo: jest.fn(),
  setOutboundHold: jest.fn(),
  getEmailAccountById: jest.fn(() => null),
}));

jest.mock('../../electron/email/email-crm-store', () => ({
  assignCategoryPathToMessage: jest.fn(),
}));

jest.mock('../../electron/email/email-forward-copy', () => ({
  sendWorkflowForwardCopy: jest.fn(),
}));

jest.mock('../../electron/email/email-imap-flags', () => ({
  syncSeenFlagToServer: jest.fn(),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(() => null),
  getCustomerById: jest.fn(() => null),
}));

describe('workflow spam routing nodes', () => {
  beforeAll(() => {
    ensureBuiltinWorkflowNodes();
  });

  test('registers new node types', () => {
    expect(getWorkflowNode('ai.spam_score')?.label).toMatch(/Spam/i);
    expect(getWorkflowNode('logic.threshold')).toBeDefined();
    expect(getWorkflowNode('email.sender_filter')).toBeDefined();
    expect(getWorkflowNode('email.set_spam_status')).toBeDefined();
    expect(getWorkflowNode('email.mark_spam')).toBeDefined();
    expect(getWorkflowNode('email.assign')).toBeDefined();
  });

  test('sender_filter returns whitelist port for paypal', async () => {
    const def = getWorkflowNode('email.sender_filter')!;
    const ctx = {
      strings: { from_address: 'PayPal <service@paypal.com>' },
      variables: {},
      dryRun: true,
      messageId: 1,
      message: null,
      direction: 'inbound' as const,
      trigger: 'inbound' as const,
      workflowId: 1,
      runId: 1,
      ai: {},
    };
    const r = await def.execute(ctx as never, { useGlobalLists: false, useBuiltinTrusted: true });
    expect(r.port).toBe('whitelist');
  });

  test('logic.threshold yes when score high', async () => {
    const def = getWorkflowNode('logic.threshold')!;
    const ctx = {
      variables: { 'ai.spam_score': 85 },
      strings: {},
      dryRun: true,
      messageId: null,
      message: null,
      direction: 'inbound' as const,
      trigger: 'inbound' as const,
      workflowId: 1,
      runId: 1,
      ai: {},
    };
    const r = await def.execute(ctx as never, { variable: 'ai.spam_score', operator: 'gte', value: 70 });
    expect(r.port).toBe('yes');
  });

  test('email.set_spam_status exposes the selected spam state', async () => {
    const def = getWorkflowNode('email.set_spam_status')!;
    const ctx = {
      variables: {},
      strings: {},
      dryRun: true,
      messageId: 1,
      message: { id: 1 },
      direction: 'inbound' as const,
      trigger: 'inbound' as const,
      workflowId: 1,
      runId: 1,
      ai: {},
    };
    const r = await def.execute(ctx as never, { status: 'review' });
    expect(r.variables).toMatchObject({ 'email.is_spam': false, 'spam.status': 'review' });
  });
});
