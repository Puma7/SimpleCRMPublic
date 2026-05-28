import { sendComposeDraft } from '../../electron/email/email-compose-send';

const mockGetMessage = jest.fn();
const mockUpdateDraft = jest.fn();
const mockMarkSent = jest.fn();
const mockSetMessageDone = jest.fn();
const mockGetAccount = jest.fn();
const mockSendSmtp = jest.fn();
const mockEvaluateOutbound = jest.fn();
const mockGetSyncInfo = jest.fn();
const mockSetSyncInfo = jest.fn();
const mockDbRun = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (...args: unknown[]) => mockGetMessage(...args),
  updateComposeDraft: (...args: unknown[]) => mockUpdateDraft(...args),
  markDraftAsSent: (...args: unknown[]) => mockMarkSent(...args),
  setMessageDoneLocal: (...args: unknown[]) => mockSetMessageDone(...args),
  getEmailAccountById: (...args: unknown[]) => mockGetAccount(...args),
}));

jest.mock('../../electron/email/email-workflow-engine', () => ({
  evaluateOutboundWorkflows: (...args: unknown[]) => mockEvaluateOutbound(...args),
}));

jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: (...args: unknown[]) => mockSendSmtp(...args),
}));

jest.mock('../../electron/email/email-imap-append', () => ({
  appendSentToImap: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../../electron/email/email-message-attachments-store', () => ({
  persistLocalComposeAttachments: jest.fn(),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    prepare: () => ({ run: (...args: unknown[]) => mockDbRun(...args) }),
  }),
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...args),
  setSyncInfo: (...args: unknown[]) => mockSetSyncInfo(...args),
}));

jest.mock('../../electron/email/email-ticket', () => ({
  ensureTicketInSubject: (s: string) => s,
  extractTicketFromSubject: () => null,
  generateTicketCode: () => 'T-1',
  getOrCreateThreadForTicket: () => 'thread-1',
}));

jest.mock('../../electron/email/email-outbound-threading', () => ({
  buildOutboundThreadingHeaders: () => ({ inReplyTo: undefined, references: undefined }),
  generateOutboundMessageId: () => '<new@local>',
}));

describe('sendComposeDraft', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEvaluateOutbound.mockResolvedValue({ allowed: true, reason: null });
    mockGetSyncInfo.mockReturnValue(null);
    mockDbRun.mockReturnValue({ changes: 1 });
    mockGetAccount.mockReturnValue({ id: 1, email_address: 'me@shop.test' });
    mockSendSmtp.mockResolvedValue(undefined);
  });

  it('rejects draft from another account', async () => {
    mockGetMessage.mockReturnValue({
      id: 10,
      uid: -1,
      account_id: 2,
      folder_kind: 'draft',
      body_html: null,
      message_id: null,
    });
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'Hi',
      bodyText: 'Body',
      to: 'a@b.de',
    });
    expect(r).toEqual({ ok: false, error: 'Entwurf gehört zu einem anderen Konto' });
    expect(mockSendSmtp).not.toHaveBeenCalled();
  });

  it('is idempotent when already sent', async () => {
    mockGetMessage.mockReturnValue({
      id: 10,
      uid: -1,
      account_id: 1,
      folder_kind: 'sent',
      body_html: null,
      message_id: '<x@y>',
    });
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'Hi',
      bodyText: 'Body',
      to: 'a@b.de',
    });
    expect(r).toEqual({ ok: true });
    expect(mockSendSmtp).not.toHaveBeenCalled();
  });

  it('skips second SMTP when commit flag is set', async () => {
    mockGetMessage.mockReturnValue({
      id: 10,
      uid: -1,
      account_id: 1,
      folder_kind: 'draft',
      body_html: null,
      message_id: '<committed@local>',
    });
    mockGetSyncInfo.mockImplementation((key: string) =>
      key === 'email_compose_smtp_ok:10' ? '1' : null,
    );
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'Hi',
      bodyText: 'Body',
      to: 'a@b.de',
    });
    expect(r).toEqual({ ok: true, recoveredSentAppend: true });
    expect(mockSendSmtp).not.toHaveBeenCalled();
    expect(mockMarkSent).toHaveBeenCalled();
  });

  it('marks reply parent as done after successful send by default', async () => {
    mockGetMessage.mockImplementation((id: number) => {
      if (id === 5) {
        return {
          id: 5,
          uid: 100,
          account_id: 1,
          ticket_code: 'T-1',
          thread_id: 'th',
          message_id: '<parent@x>',
          references_header: null,
        };
      }
      return {
        id: 10,
        uid: -1,
        account_id: 1,
        folder_kind: 'draft',
        body_html: null,
        message_id: null,
      };
    });
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'Re: Hi',
      bodyText: 'Body',
      to: 'a@b.de',
      inReplyToMessageId: 5,
    });
    expect(r).toEqual({ ok: true });
    expect(mockSetMessageDone).toHaveBeenCalledWith(5, true);
  });

  it('does not mark reply parent done when opted out', async () => {
    mockGetMessage.mockImplementation((id: number) => {
      if (id === 5) {
        return {
          id: 5,
          uid: 100,
          account_id: 1,
          ticket_code: 'T-1',
          thread_id: 'th',
          message_id: '<parent@x>',
          references_header: null,
        };
      }
      return {
        id: 10,
        uid: -1,
        account_id: 1,
        folder_kind: 'draft',
        body_html: null,
        message_id: null,
      };
    });
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'Re: Hi',
      bodyText: 'Body',
      to: 'a@b.de',
      inReplyToMessageId: 5,
      markReplyParentDone: false,
    });
    expect(r).toEqual({ ok: true });
    expect(mockSetMessageDone).not.toHaveBeenCalled();
  });

  it('rejects parallel send while lock is held', async () => {
    mockGetMessage.mockReturnValue({
      id: 10,
      uid: -1,
      account_id: 1,
      folder_kind: 'draft',
      body_html: null,
      message_id: null,
    });
    mockDbRun.mockReturnValue({ changes: 0 });
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'Hi',
      bodyText: 'Body',
      to: 'a@b.de',
    });
    expect(r).toEqual({ ok: false, error: 'Versand läuft bereits für diesen Entwurf.' });
    expect(mockSendSmtp).not.toHaveBeenCalled();
  });
});
