import { sendComposeDraft } from '../../electron/email/email-compose-send';
import { SmtpDeliveryAmbiguousError } from '../../electron/email/email-smtp-errors';

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
  setSentImapSyncFailed: jest.fn(),
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

const mockPreparePgp = jest.fn();
jest.mock('../../electron/pgp/pgp-service', () => ({
  prepareOutboundPgpBody: (...args: unknown[]) => mockPreparePgp(...args),
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

  it('skips outbound workflow when smtp already committed', async () => {
    mockGetMessage.mockReturnValue({
      id: 10,
      uid: -1,
      account_id: 1,
      folder_kind: 'draft',
      body_html: null,
      message_id: '<committed@local>',
      subject: 'Hi',
      in_reply_to: null,
      references_header: null,
      ticket_code: null,
    });
    mockGetSyncInfo.mockImplementation((key: string) =>
      key === 'email_compose_smtp_ok:10' ? '1' : null,
    );
    mockEvaluateOutbound.mockResolvedValue({
      allowed: false,
      reason: 'would block',
      workflowRunId: 99,
    });
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'Hi',
      bodyText: 'Body',
      to: 'a@b.de',
      attachmentPaths: ['/missing/file.pdf'],
    });
    expect(r).toEqual({ ok: true, recoveredSentAppend: true });
    expect(mockEvaluateOutbound).not.toHaveBeenCalled();
    expect(mockSendSmtp).not.toHaveBeenCalled();
  });

  // F-A7b-13: Nach SMTP-Commit uebernahm die Wiederaufnahme geaenderte Felder in Entwurf und Gesendet-Kopie, obwohl diese Fassung nie versendet wurde.
  it('finalizes a committed SMTP send from the stored draft and ignores edited fields', async () => {
    mockGetMessage.mockReturnValue({
      id: 10,
      uid: -1,
      account_id: 1,
      folder_kind: 'draft',
      subject: 'Hi',
      body_text: 'Original',
      body_html: null,
      message_id: '<committed@local>',
      to_json: JSON.stringify({ value: [{ address: 'orig@a.de' }] }),
      cc_json: null,
      bcc_json: null,
      draft_attachment_paths_json: null,
      in_reply_to: null,
      references_header: null,
      ticket_code: null,
    });
    mockGetSyncInfo.mockImplementation((key: string) =>
      key === 'email_compose_smtp_ok:10' ? '1' : null,
    );
    mockGetAccount.mockReturnValue({ id: 1, email_address: 'me@shop.test', protocol: 'imap' });

    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'Hi',
      bodyText: 'Geaendert',
      to: 'neu@b.de',
    });

    expect(r).toEqual({ ok: true, recoveredSentAppend: true });
    expect(mockSendSmtp).not.toHaveBeenCalled();
    expect(mockUpdateDraft).not.toHaveBeenCalled();
    const { appendSentToImap } = jest.requireMock('../../electron/email/email-imap-append') as {
      appendSentToImap: jest.Mock;
    };
    expect(appendSentToImap).toHaveBeenCalledTimes(1);
    expect(appendSentToImap.mock.calls[0][0]).toMatchObject({ to: 'orig@a.de', text: 'Original' });
  });

  describe('PGP send keeps the plaintext draft until SMTP accepted', () => {
    const draftRow = {
      id: 10,
      uid: -1,
      account_id: 1,
      folder_kind: 'draft',
      subject: 'Hi',
      body_text: 'Klartext',
      body_html: null,
      message_id: null,
      in_reply_to: null,
      references_header: null,
      ticket_code: null,
    };
    const pgpInput = {
      accountId: 1,
      draftMessageId: 10,
      subject: 'Hi',
      bodyText: 'Geheimer Klartext',
      to: 'a@b.de',
      inReplyToMessageId: 5,
      pgpEncrypt: true,
      pgpUserId: 'local-owner',
    };
    const writtenBodies = () => [
      ...mockUpdateDraft.mock.calls.map((args) => (args[1] as { bodyText?: string }).bodyText),
      ...mockDbRun.mock.calls.flat().filter((value) => typeof value === 'string'),
    ];

    beforeEach(() => {
      mockGetMessage.mockImplementation((id: number) =>
        id === 5 ? { id: 5, account_id: 1, ticket_code: 'T-1', thread_id: 'th-1', message_id: '<p@x>', references_header: null } : draftRow,
      );
      mockPreparePgp.mockResolvedValue({ bodyText: '-----BEGIN PGP MESSAGE-----ARMOR' });
    });

    // F-A5-10 (Desktop-Paritaet): Der Armor ersetzte den Entwurf schon vor Ausgangspruefung und SMTP; bei Fehler oder Hold war der Klartext weg.
    it('keeps the plaintext in the draft and the outbound review when the send is held', async () => {
      mockEvaluateOutbound.mockResolvedValue({ allowed: false, reason: 'Freigabe', workflowRunId: 5 });

      const r = await sendComposeDraft(pgpInput);

      expect(r).toMatchObject({ ok: false });
      expect(mockUpdateDraft).toHaveBeenCalledWith(10, expect.objectContaining({ bodyText: 'Geheimer Klartext' }));
      expect(mockEvaluateOutbound).toHaveBeenCalledWith(expect.objectContaining({ bodyText: 'Geheimer Klartext' }));
      expect(writtenBodies().some((body) => body?.includes('ARMOR'))).toBe(false);
    });

    it('keeps the plaintext draft when SMTP fails', async () => {
      mockSendSmtp.mockRejectedValueOnce(new Error('smtp down'));

      const r = await sendComposeDraft(pgpInput);

      expect(r).toMatchObject({ ok: false, error: 'smtp down' });
      expect(mockSendSmtp).toHaveBeenCalledWith(1, expect.objectContaining({ text: '-----BEGIN PGP MESSAGE-----ARMOR' }));
      expect(writtenBodies().some((body) => body?.includes('ARMOR'))).toBe(false);
    });

    it('stores the armor as sent copy after SMTP success, before the commit marker', async () => {
      const r = await sendComposeDraft(pgpInput);

      expect(r).toEqual({ ok: true });
      const armorWrite = mockDbRun.mock.invocationCallOrder[
        mockDbRun.mock.calls.findIndex((args) => args.includes('-----BEGIN PGP MESSAGE-----ARMOR'))
      ];
      const commitMarker = mockSetSyncInfo.mock.invocationCallOrder[
        mockSetSyncInfo.mock.calls.findIndex(([key, value]) => key === 'email_compose_smtp_ok:10' && value === '1')
      ];
      expect(armorWrite).toBeDefined();
      expect(armorWrite).toBeLessThan(commitMarker);
      expect(armorWrite).toBeGreaterThan(mockSendSmtp.mock.invocationCallOrder[0]);
      const { appendSentToImap } = jest.requireMock('../../electron/email/email-imap-append') as {
        appendSentToImap: jest.Mock;
      };
      expect(appendSentToImap.mock.calls[0][0]).toMatchObject({ text: '-----BEGIN PGP MESSAGE-----ARMOR' });
    });
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

  // F-A5-01: Desktop-Compose kuerzte '+tag' und schrieb den Local-Part klein; ungueltige Eintraege fielen still weg.
  it('sends to the exact recipient mailbox and rejects invalid recipient tokens', async () => {
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
      subject: 'Re: Rechnung',
      bodyText: 'Body',
      to: 'Kunde <Customer+Shop@Example.com>, customer+shop@example.com',
      cc: 'Mueller, Hans <Hans+Buchhaltung@Firma.DE>',
      inReplyToMessageId: 5,
    });
    expect(r).toEqual({ ok: true });
    expect(mockSendSmtp).toHaveBeenCalledWith(
      1,
      expect.objectContaining({
        to: 'Customer+Shop@example.com',
        cc: 'Hans+Buchhaltung@firma.de',
      }),
    );
    expect(mockUpdateDraft).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        toJson: JSON.stringify({ value: [{ address: 'Customer+Shop@example.com' }] }),
        ccJson: JSON.stringify({ value: [{ address: 'Hans+Buchhaltung@firma.de' }] }),
      }),
    );

    mockSendSmtp.mockClear();
    await expect(
      sendComposeDraft({
        accountId: 1,
        draftMessageId: 10,
        subject: 'Re: Rechnung',
        bodyText: 'Body',
        to: 'kunde@firma.de, chef@firma',
        inReplyToMessageId: 5,
      }),
    ).resolves.toEqual({ ok: false, error: expect.stringContaining('chef@firma') });
    expect(mockSendSmtp).not.toHaveBeenCalled();
  });

  // F-A5-02: Ein SMTP-Fehler nach vollstaendig uebertragener Nachricht war nicht als unklarer Zustellstatus erkennbar.
  it('flags SMTP failures after the message body as ambiguous delivery', async () => {
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
    const input = {
      accountId: 1,
      draftMessageId: 10,
      subject: 'Re: Angebot',
      bodyText: 'Body',
      to: 'kunde@firma.de',
      inReplyToMessageId: 5,
    };
    mockSendSmtp.mockRejectedValueOnce(new SmtpDeliveryAmbiguousError('Connection closed unexpectedly'));
    await expect(sendComposeDraft(input)).resolves.toEqual({
      ok: false,
      error: 'Connection closed unexpectedly',
      deliveryAmbiguous: true,
    });

    mockSendSmtp.mockRejectedValueOnce(new Error('Message failed: 554 5.7.1 rejected'));
    await expect(sendComposeDraft(input)).resolves.toEqual({
      ok: false,
      error: 'Message failed: 554 5.7.1 rejected',
    });
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
