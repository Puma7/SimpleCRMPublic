jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn(),
  getEmailAccountById: jest.fn(),
}));

jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: jest.fn(),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: jest.fn(),
}));

jest.mock('../../electron/email/email-outbound-threading', () => ({
  generateOutboundMessageId: jest.fn(() => '<outbound@example.com>'),
}));

jest.mock('../../electron/email/email-workflow-engine', () => ({
  evaluateOutboundWorkflows: jest.fn(),
}));

import { simpleParser } from 'mailparser';
import { getEmailAccountById, getEmailMessageById } from '../../electron/email/email-store';
import { sendSmtpForAccount } from '../../electron/email/email-smtp';
import { getDb } from '../../electron/sqlite-service';
import { evaluateOutboundWorkflows } from '../../electron/email/email-workflow-engine';
import { sendReadReceiptMdn } from '../../electron/email/email-read-receipt-mdn';

const getMessageMock = getEmailMessageById as jest.MockedFunction<typeof getEmailMessageById>;
const getAccountMock = getEmailAccountById as jest.MockedFunction<typeof getEmailAccountById>;
const sendSmtpMock = sendSmtpForAccount as jest.MockedFunction<typeof sendSmtpForAccount>;
const getDbMock = getDb as jest.MockedFunction<typeof getDb>;
const workflowsMock = evaluateOutboundWorkflows as jest.MockedFunction<
  typeof evaluateOutboundWorkflows
>;

function inboundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    account_id: 7,
    is_spam: 0,
    folder_kind: 'inbox',
    soft_deleted: 0,
    raw_headers: 'Disposition-Notification-To: Sender <sender@example.com>\r\n',
    from_json: JSON.stringify({ value: [{ address: 'sender@example.com' }] }),
    subject: 'Status',
    message_id: 'original@example.com',
    references_header: '<root@example.com>',
    ...overrides,
  } as never;
}

describe('sendReadReceiptMdn', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getMessageMock.mockReturnValue(inboundRow());
    getAccountMock.mockReturnValue({
      id: 7,
      email_address: 'agent@example.org',
      display_name: 'Agent',
    } as never);
    workflowsMock.mockResolvedValue({ allowed: true } as never);
    sendSmtpMock.mockResolvedValue({ messageId: '<smtp@example.org>' } as never);
    getDbMock.mockReturnValue(null as never);
  });

  test('rejects missing, spam, deleted and non-MDN messages before SMTP', async () => {
    getMessageMock.mockReturnValueOnce(undefined);
    await expect(sendReadReceiptMdn(1)).resolves.toEqual({
      ok: false,
      error: 'Nachricht nicht gefunden',
    });

    getMessageMock.mockReturnValueOnce(inboundRow({ is_spam: 1 }));
    await expect(sendReadReceiptMdn(2)).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringMatching(/Spam/) }),
    );

    getMessageMock.mockReturnValueOnce(inboundRow({ folder_kind: 'trash' }));
    await expect(sendReadReceiptMdn(3)).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringMatching(/gelöschte/) }),
    );

    getMessageMock.mockReturnValueOnce(inboundRow({ folder_kind: 'inbox', soft_deleted: 1 }));
    await expect(sendReadReceiptMdn(4)).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringMatching(/gelöschte/) }),
    );

    getMessageMock.mockReturnValueOnce(inboundRow({ raw_headers: 'From: sender@example.com\r\n' }));
    await expect(sendReadReceiptMdn(5)).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringMatching(/Keine MDN/) }),
    );

    expect(sendSmtpMock).not.toHaveBeenCalled();
  });

  test('enforces RFC 8098 sender matching and an existing account', async () => {
    getMessageMock.mockReturnValueOnce(
      inboundRow({ from_json: JSON.stringify({ value: [{ address: 'other@example.com' }] }) }),
    );
    await expect(sendReadReceiptMdn(1)).resolves.toEqual(
      expect.objectContaining({ ok: false, error: expect.stringMatching(/RFC 8098/) }),
    );

    getAccountMock.mockReturnValueOnce(undefined);
    await expect(sendReadReceiptMdn(2)).resolves.toEqual({
      ok: false,
      error: 'Konto nicht gefunden',
    });
    expect(sendSmtpMock).not.toHaveBeenCalled();
  });

  test('honors an outbound workflow block including its reason', async () => {
    workflowsMock.mockResolvedValueOnce({ allowed: false, reason: 'Vier-Augen-Prüfung' } as never);

    await expect(sendReadReceiptMdn(41)).resolves.toEqual({
      ok: false,
      error: 'Vier-Augen-Prüfung',
    });
    expect(sendSmtpMock).not.toHaveBeenCalled();
  });

  test('sends a standards-marked MDN with threading headers', async () => {
    const run = jest.fn();
    const db = { prepare: jest.fn(() => ({ run })) } as never;
    getDbMock.mockReturnValue(db);

    await expect(sendReadReceiptMdn(41)).resolves.toEqual({ ok: true });

    expect(workflowsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        messageId: 41,
        accountId: 7,
        to: 'sender@example.com',
        subject: 'Gelesen: Status',
      }),
      { sideEffects: 'none' },
    );
    expect(sendSmtpMock).toHaveBeenCalledWith(
      7,
      expect.objectContaining({
        from: 'Agent <agent@example.org>',
        to: 'sender@example.com',
        messageId: '<outbound@example.com>',
        inReplyTo: '<original@example.com>',
        references: '<root@example.com> <original@example.com>',
        // The MDN is a prebuilt multipart/report (F-A7b-14), not a header override.
        raw: expect.any(Buffer),
      }),
    );
    expect(run).toHaveBeenNthCalledWith(1, 41, 'sent_back', 'sender@example.com');
    expect(run).toHaveBeenNthCalledWith(2, 41);
  });

  // F-A7b-14: Die MDN ging als kaputtes multipart/report ohne Teile (zweiter Content-Type, QP-Klartext) raus.
  test('sends an RFC 8098 multipart/report MDN that a MIME parser reads correctly', async () => {
    getDbMock.mockReturnValue({ prepare: jest.fn(() => ({ run: jest.fn() })) } as never);
    getAccountMock.mockReturnValue({
      id: 7,
      email_address: 'agent@example.org',
      display_name: 'Agentin Jürgens',
    } as never);
    getMessageMock.mockReturnValue(inboundRow({ subject: 'Angebot für Müller' }));

    await expect(sendReadReceiptMdn(41)).resolves.toEqual({ ok: true });

    const raw = (sendSmtpMock.mock.calls[0]![1] as { raw?: Buffer }).raw;
    expect(Buffer.isBuffer(raw)).toBe(true);
    const headerBlock = raw!.toString('utf8').split('\r\n\r\n')[0]!;
    expect(headerBlock.match(/^Content-Type:/gim)).toHaveLength(1);

    const parsed = await simpleParser(raw!);
    const contentType = parsed.headers.get('content-type') as { value: string; params: Record<string, string> };
    expect(contentType.value).toBe('multipart/report');
    expect(contentType.params['report-type']).toBe('disposition-notification');
    expect(parsed.subject).toBe('Gelesen: Angebot für Müller');
    expect(parsed.from?.value[0]).toMatchObject({ name: 'Agentin Jürgens', address: 'agent@example.org' });
    expect(parsed.inReplyTo).toBe('<original@example.com>');
    expect(parsed.headers.get('auto-submitted')).toBe('auto-replied');
    expect(parsed.text).toContain('Lesebestätigung');

    const report = parsed.attachments.find((a) => a.contentType === 'message/disposition-notification');
    expect(report).toBeDefined();
    const fields = report!.content.toString('utf8');
    expect(fields).toMatch(/^Final-Recipient: rfc822;agent@example\.org$/m);
    expect(fields).toMatch(/^Original-Message-ID: <original@example\.com>$/m);
    expect(fields).toMatch(/^Disposition: manual-action\/MDN-sent-manually; displayed$/m);
  });

  test('handles an absent subject and already bracketed or missing message IDs', async () => {
    getMessageMock.mockReturnValueOnce(
      inboundRow({ subject: null, message_id: '<ready@example.com>', references_header: null }),
    );
    await expect(sendReadReceiptMdn(41)).resolves.toEqual({ ok: true });
    expect(sendSmtpMock).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({
        subject: 'Gelesen: (ohne Betreff)',
        inReplyTo: '<ready@example.com>',
        references: '<ready@example.com>',
      }),
    );

    getMessageMock.mockReturnValueOnce(inboundRow({ message_id: ' ', references_header: null }));
    await expect(sendReadReceiptMdn(42)).resolves.toEqual({ ok: true });
    expect(sendSmtpMock).toHaveBeenLastCalledWith(
      7,
      expect.objectContaining({ inReplyTo: undefined, references: undefined }),
    );
  });
});
