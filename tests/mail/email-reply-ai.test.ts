import type { EmailMessageRow } from '../../electron/email/email-store';

const mockGetMessage = jest.fn();
const mockListPrompts = jest.fn();
const mockHasKey = jest.fn();
const mockResolveProfile = jest.fn();
const mockRunChat = jest.fn();
const mockGetCustomer = jest.fn();
const mockDbRun = jest.fn();
const mockGetSyncInfo = jest.fn(() => null);

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (...args: unknown[]) => mockGetMessage(...args),
}));
jest.mock('../../electron/email/email-crm-store', () => ({
  listAiPrompts: (...args: unknown[]) => mockListPrompts(...args),
}));
jest.mock('../../electron/email/email-ai-profiles', () => ({
  hasAnyAiProfileWithKey: (...args: unknown[]) => mockHasKey(...args),
  resolvePromptProfileId: (...args: unknown[]) => mockResolveProfile(...args),
}));
jest.mock('../../electron/email/email-openai', () => ({
  runChatCompletion: (...args: unknown[]) => mockRunChat(...args),
}));
jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({ prepare: () => ({ run: (...args: unknown[]) => mockDbRun(...args) }) }),
  getCustomerById: (...args: unknown[]) => mockGetCustomer(...args),
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...args),
}));

import {
  canSuggestReplyForMessage,
  ensureReplySuggestion,
  generateAndStoreReplySuggestion,
  generateReplyDraftText,
  getReplySuggestion,
  recoverStaleReplySuggestions,
} from '../../electron/email/email-reply-ai';

function inboxRow(overrides: Partial<EmailMessageRow> = {}): EmailMessageRow {
  return {
    id: 42,
    account_id: 1,
    folder_id: 1,
    uid: 100,
    message_id: '<m@x>',
    in_reply_to: null,
    references_header: null,
    subject: 'Question',
    from_json: JSON.stringify({ value: [{ address: 'user@test.de', name: 'User' }] }),
    to_json: JSON.stringify({ value: [{ address: 'me@test.de' }] }),
    cc_json: null,
    bcc_json: null,
    date_received: 't',
    snippet: 'Need help please',
    body_text: 'Need help please with order',
    body_html: null,
    seen_local: 0,
    archived: 0,
    soft_deleted: 0,
    outbound_hold: 0,
    outbound_block_reason: null,
    thread_id: null,
    ticket_code: null,
    customer_id: 7,
    folder_kind: 'inbox',
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

describe('email-reply-ai', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    mockGetSyncInfo.mockReturnValue(null);
    mockHasKey.mockResolvedValue(true);
    mockRunChat.mockResolvedValue('Guten Tag,\n\nAntwort.\n\nGrüße');
    mockListPrompts.mockReturnValue([
      { id: 1, label: 'Reply', user_template: 'From {{from}} Subj {{subject}} Body {{body}}', target: 'reply', profile_id: null, sort_order: 0 },
    ]);
    mockResolveProfile.mockReturnValue(null);
    mockGetCustomer.mockReturnValue({
      name: 'Acme GmbH',
      firstName: 'Max',
      email: 'user@test.de',
    });
  });

  test('canSuggestReplyForMessage filters automated and invalid rows', () => {
    expect(canSuggestReplyForMessage(inboxRow())).toBe(true);
    expect(canSuggestReplyForMessage(inboxRow({ soft_deleted: 1 }))).toBe(false);
    expect(canSuggestReplyForMessage(inboxRow({ is_spam: 1 }))).toBe(false);
    expect(canSuggestReplyForMessage(inboxRow({ folder_kind: 'sent' }))).toBe(false);
    expect(canSuggestReplyForMessage(inboxRow({ uid: -1, pop3_uidl: null }))).toBe(false);
    expect(canSuggestReplyForMessage(inboxRow({ pop3_uidl: 'uidl-1' }))).toBe(true);
    expect(
      canSuggestReplyForMessage(
        inboxRow({
          from_json: JSON.stringify({ value: [{ address: 'noreply@shop.de' }] }),
        }),
      ),
    ).toBe(false);
    expect(canSuggestReplyForMessage(inboxRow({ subject: 'Out of office reply' }))).toBe(false);
    expect(
      canSuggestReplyForMessage(
        inboxRow({ raw_headers: 'Auto-Submitted: auto-replied', body_text: 'long enough body' }),
      ),
    ).toBe(false);
    expect(canSuggestReplyForMessage(inboxRow({ body_text: 'short' }))).toBe(false);
  });

  test('getReplySuggestion status branches', () => {
    mockGetMessage.mockReturnValue(undefined);
    expect(getReplySuggestion(1)).toEqual({ status: 'none', text: null, error: null, updatedAt: null });

    mockGetMessage.mockReturnValue({
      ...inboxRow(),
      reply_suggestion_status: 'ready',
      reply_suggestion_text: '  Done  ',
      reply_suggestion_updated_at: new Date().toISOString(),
    });
    expect(getReplySuggestion(42).status).toBe('ready');

    mockGetMessage.mockReturnValue({
      ...inboxRow(),
      reply_suggestion_status: 'pending',
      reply_suggestion_updated_at: new Date().toISOString(),
    });
    expect(getReplySuggestion(42).status).toBe('pending');

    mockGetMessage.mockReturnValue({
      ...inboxRow(),
      reply_suggestion_status: 'failed',
      reply_suggestion_error: null,
    });
    expect(getReplySuggestion(42).status).toBe('failed');

    mockGetMessage.mockReturnValue({
      ...inboxRow(),
      reply_suggestion_status: 'skipped',
      reply_suggestion_error: 'skip',
    });
    expect(getReplySuggestion(42).status).toBe('skipped');
  });

  test('recoverStaleReplySuggestions updates db', () => {
    recoverStaleReplySuggestions();
    expect(mockDbRun).toHaveBeenCalled();
  });

  test('generateReplyDraftText success and failures', async () => {
    mockGetMessage.mockReturnValue(inboxRow());
    const ok = await generateReplyDraftText(42);
    expect(ok).toEqual({ success: true, text: expect.stringContaining('Antwort') });

    mockGetMessage.mockReturnValue(undefined);
    expect(await generateReplyDraftText(1)).toEqual({ success: false, error: 'Nachricht nicht gefunden' });

    mockGetMessage.mockReturnValue(inboxRow({ folder_kind: 'sent' }));
    expect(await generateReplyDraftText(42)).toEqual({
      success: false,
      error: 'Für diese Nachricht ist keine KI-Antwort vorgesehen',
    });

    mockGetMessage.mockReturnValue(inboxRow());
    mockHasKey.mockResolvedValue(false);
    expect(await generateReplyDraftText(42)).toEqual({
      success: false,
      error: 'Kein KI-API-Schlüssel konfiguriert',
    });

    mockHasKey.mockResolvedValue(true);
    mockRunChat.mockResolvedValue('   ');
    expect(await generateReplyDraftText(42)).toEqual({ success: false, error: 'KI-Antwort leer' });

    mockRunChat.mockRejectedValue(new Error('openai fail'));
    expect(await generateReplyDraftText(42)).toEqual({ success: false, error: 'openai fail' });

    mockRunChat.mockResolvedValue('Antwort');
    mockListPrompts.mockReturnValue([]);
    await generateReplyDraftText(42, { promptId: 99, customerId: 7 });
    expect(mockRunChat).toHaveBeenCalled();
  });

  test('generateAndStoreReplySuggestion persists result', async () => {
    mockGetMessage.mockReturnValue(inboxRow());
    const ok = await generateAndStoreReplySuggestion(42);
    expect(ok.success).toBe(true);
    expect(mockDbRun).toHaveBeenCalled();

    mockRunChat.mockRejectedValue(new Error('fail'));
    const bad = await generateAndStoreReplySuggestion(42);
    expect(bad.success).toBe(false);
  });

  test('ensureReplySuggestion queues background job', async () => {
    jest.useFakeTimers();
    mockGetMessage.mockReturnValue({
      ...inboxRow(),
      reply_suggestion_status: null,
    });
    ensureReplySuggestion(42);
    await jest.runAllTimersAsync();
    expect(mockDbRun).toHaveBeenCalled();
  });
});
