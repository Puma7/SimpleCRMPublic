import fs from 'fs';
import os from 'os';
import path from 'path';
import { clearStaleComposeSendingLocks, sendComposeDraft } from '../../electron/email/email-compose-send';

const mockGetMessage = jest.fn();
const mockUpdateDraft = jest.fn();
const mockMarkSent = jest.fn();
const mockGetAccount = jest.fn();
const mockSetMessageDoneLocal = jest.fn();
const mockSendSmtp = jest.fn();
const mockEvaluateOutbound = jest.fn();
const mockAppendSent = jest.fn();
const mockGetSyncInfo = jest.fn();
const mockSetSyncInfo = jest.fn();
const mockDbRun = jest.fn();
const mockClearHold = jest.fn();
const mockExtractInline = jest.fn();
const mockPersistLocalComposeAttachments = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (...args: unknown[]) => mockGetMessage(...args),
  updateComposeDraft: (...args: unknown[]) => mockUpdateDraft(...args),
  markDraftAsSent: (...args: unknown[]) => mockMarkSent(...args),
  getEmailAccountById: (...args: unknown[]) => mockGetAccount(...args),
  setMessageDoneLocal: (...args: unknown[]) => mockSetMessageDoneLocal(...args),
}));

jest.mock('../../electron/email/email-workflow-engine', () => ({
  evaluateOutboundWorkflows: (...args: unknown[]) => mockEvaluateOutbound(...args),
}));

jest.mock('../../electron/email/email-smtp', () => ({
  sendSmtpForAccount: (...args: unknown[]) => mockSendSmtp(...args),
}));

jest.mock('../../electron/email/email-imap-append', () => ({
  appendSentToImap: (...args: unknown[]) => mockAppendSent(...args),
}));

jest.mock('../../electron/email/email-outbound-review', () => ({
  clearOutboundHoldForResend: (...args: unknown[]) => mockClearHold(...args),
}));

jest.mock('../../electron/email/email-inline-images', () => ({
  extractInlineImagesFromHtml: (...args: unknown[]) => mockExtractInline(...args),
  cleanupInlineImageTempFiles: jest.fn(),
}));

jest.mock('../../electron/email/email-message-attachments-store', () => ({
  persistLocalComposeAttachments: (...args: unknown[]) => mockPersistLocalComposeAttachments(...args),
}));

jest.mock('../../electron/sqlite-service', () => ({
  getDb: () => ({
    prepare: () => ({ run: (...args: unknown[]) => mockDbRun(...args) }),
  }),
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...args),
  setSyncInfo: (...args: unknown[]) => mockSetSyncInfo(...args),
}));

jest.mock('../../electron/email/email-ticket', () => ({
  ensureTicketInSubject: (s: string, t: string) => `${s} [${t}]`,
  extractTicketFromSubject: (s: string) => (s.includes('T-99') ? 'T-99' : null),
  generateTicketCode: () => 'T-NEW',
  getOrCreateThreadForTicket: () => 'thread-x',
}));

jest.mock('../../electron/email/email-outbound-threading', () => ({
  buildOutboundThreadingHeaders: () => ({ inReplyTo: '<p@x>', references: '<p@x>' }),
  generateOutboundMessageId: () => '<new@local>',
}));

function draft(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    uid: -1,
    account_id: 1,
    folder_kind: 'draft',
    body_html: '<p>Hi</p>',
    message_id: null,
    ...overrides,
  };
}

describe('email-compose-send expanded', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockEvaluateOutbound.mockResolvedValue({ allowed: true, reason: null });
    mockGetSyncInfo.mockReturnValue(null);
    mockDbRun.mockReturnValue({ changes: 1 });
    mockGetAccount.mockReturnValue({ id: 1, email_address: 'me@shop.test', protocol: 'imap', request_read_receipt: 1 });
    mockSendSmtp.mockResolvedValue(undefined);
    mockAppendSent.mockResolvedValue(undefined);
    mockExtractInline.mockReturnValue({ html: '<p>Hi</p>', attachments: [] });
    mockPersistLocalComposeAttachments.mockReturnValue(undefined);
    mockGetMessage.mockImplementation((id: number) =>
      id === 99
        ? { id: 99, ticket_code: 'T-P', thread_id: 'th', message_id: '<p@x>', references_header: '<p@x>' }
        : draft(),
    );
  });

  test('clearStaleComposeSendingLocks deletes lock rows', () => {
    clearStaleComposeSendingLocks();
    expect(mockDbRun).toHaveBeenCalled();
  });

  test('rejects invalid draft and bad recipients', async () => {
    mockGetMessage.mockReturnValueOnce(undefined);
    expect(await sendComposeDraft({ accountId: 1, draftMessageId: 10, subject: 'S', bodyText: 'B', to: 'a@b.de' })).toEqual({
      ok: false,
      error: 'Ungültiger Entwurf',
    });

    mockGetMessage.mockReturnValueOnce(draft({ uid: 5 }));
    expect(await sendComposeDraft({ accountId: 1, draftMessageId: 10, subject: 'S', bodyText: 'B', to: 'a@b.de' })).toEqual({
      ok: false,
      error: 'Ungültiger Entwurf',
    });

    mockGetMessage.mockReturnValueOnce(draft());
    expect(await sendComposeDraft({ accountId: 1, draftMessageId: 10, subject: 'S', bodyText: 'B', to: 'not-an-email' })).toEqual({
      ok: false,
      error: expect.stringMatching(/An/),
    });

    mockGetMessage.mockReturnValueOnce(draft());
    expect(
      await sendComposeDraft({ accountId: 1, draftMessageId: 10, subject: 'S', bodyText: 'B', to: 'a@b.de', cc: 'bad' }),
    ).toMatchObject({ ok: false });

    mockGetMessage.mockReturnValueOnce(draft());
    expect(
      await sendComposeDraft({ accountId: 1, draftMessageId: 10, subject: 'S', bodyText: 'B', to: 'a@b.de', bcc: 'bad' }),
    ).toMatchObject({ ok: false });
  });

  test('blocks when outbound workflow rejects', async () => {
    mockEvaluateOutbound.mockResolvedValueOnce({ allowed: false, reason: 'hold' });
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
    });
    expect(r).toMatchObject({ ok: false, error: 'hold', workflowRunId: null });
  });

  test('sends successfully with reply parent and attachments', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'attach-'));
    const file = path.join(tmp, 'doc.txt');
    fs.writeFileSync(file, 'hello');
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'T-99 Re',
      bodyText: 'Body',
      bodyHtml: '<img src="data:image/png;base64,aa">',
      to: 'to@test.de',
      cc: 'cc@test.de',
      bcc: 'bcc@test.de',
      inReplyToMessageId: 99,
      attachmentPaths: [file],
    });
    expect(r).toEqual({ ok: true });
    expect(mockSendSmtp).toHaveBeenCalled();
    expect(mockPersistLocalComposeAttachments).toHaveBeenCalledWith(
      10,
      expect.arrayContaining([expect.objectContaining({ filename: 'doc.txt', path: file })]),
    );
    expect(mockClearHold).toHaveBeenCalled();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('rejects oversize and unreadable attachments', async () => {
    mockGetSyncInfo.mockImplementation((key: string) => (key === 'email_max_attachment_mb' ? '1' : null));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'big-'));
    const big = path.join(tmp, 'big.bin');
    fs.writeFileSync(big, Buffer.alloc(2 * 1024 * 1024));
    mockGetMessage.mockReturnValueOnce(draft());
    const tooBig = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
      attachmentPaths: [big],
    });
    expect(tooBig).toMatchObject({ ok: false });

    mockGetMessage.mockReturnValueOnce(draft());
    const missing = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
      attachmentPaths: [path.join(tmp, 'missing.bin')],
    });
    expect(missing).toMatchObject({ ok: false });
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test('returns warning when append to sent fails', async () => {
    mockAppendSent.mockRejectedValueOnce(new Error('imap append fail'));
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
    });
    expect(r).toEqual({ ok: true, warning: expect.stringContaining('Gesendet') });
  });

  test('pop3 account warns on sent append', async () => {
    mockGetAccount.mockReturnValue({ id: 1, email_address: 'me@test.de', protocol: 'pop3' });
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
    });
    expect(r).toMatchObject({ ok: true, warning: expect.stringContaining('POP3') });
  });

  test('smtp failure does not set commit flag', async () => {
    mockSendSmtp.mockRejectedValueOnce(new Error('smtp fail'));
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
    });
    expect(r).toEqual({ ok: false, error: 'smtp fail' });
    expect(mockSetSyncInfo).not.toHaveBeenCalledWith('email_compose_smtp_ok:10', '1');
  });

  test('finalizes locally (attachments + sent) before IMAP append', async () => {
    const order: string[] = [];
    mockPersistLocalComposeAttachments.mockImplementation(() => {
      order.push('persist');
    });
    mockMarkSent.mockImplementation(() => {
      order.push('markSent');
    });
    mockAppendSent.mockImplementation(async () => {
      order.push('imap');
    });
    await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
    });
    expect(order).toEqual(['persist', 'markSent', 'imap']);
  });

  test('warns when local attachment persistence fails after SMTP', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-warn-'));
    const fp = path.join(dir, 'doc.pdf');
    fs.writeFileSync(fp, 'pdf');
    mockPersistLocalComposeAttachments.mockImplementation(() => {
      throw new Error('Nur 0 von 1 Anhängen lokal gespeichert (doc.pdf: read_failed).');
    });
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
      attachmentPaths: [fp],
    });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.ok).toBe(true);
    expect(mockMarkSent).toHaveBeenCalled();
    expect((r as { warning?: string }).warning).toMatch(/Anhänge konnten nicht übernommen werden/);
  });

  test('does not skip IMAP append when per-file limit is low but total under 20MB', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-imap-'));
    const a = path.join(dir, 'a.bin');
    const b = path.join(dir, 'b.bin');
    fs.writeFileSync(a, Buffer.alloc(4 * 1024 * 1024));
    fs.writeFileSync(b, Buffer.alloc(4 * 1024 * 1024));
    mockGetSyncInfo.mockImplementation((key: string) => {
      if (key === 'email_max_attachment_mb') return '5';
      return null;
    });
    mockGetAccount.mockReturnValue({
      id: 1,
      email_address: 'me@shop.test',
      protocol: 'imap',
    });
    await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
      attachmentPaths: [a, b],
    });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(mockAppendSent).toHaveBeenCalled();
  });

  test('skips IMAP append when estimated message exceeds limit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compose-send-'));
    const bigPath = path.join(dir, 'large.bin');
    fs.writeFileSync(bigPath, Buffer.alloc(2 * 1024 * 1024));
    mockGetSyncInfo.mockImplementation((key: string) => {
      if (key === 'email_imap_sent_append_max_mb') return '1';
      if (key === 'email_max_attachment_mb') return '25';
      return null;
    });
    mockGetAccount.mockReturnValue({
      id: 1,
      email_address: 'me@shop.test',
      protocol: 'imap',
    });
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
      attachmentPaths: [bigPath],
    });
    fs.rmSync(dir, { recursive: true, force: true });
    expect(r.ok).toBe(true);
    expect(mockMarkSent).toHaveBeenCalled();
    expect(mockAppendSent).not.toHaveBeenCalled();
    expect((r as { warning?: string }).warning).toMatch(/lokal unter „Gesendet“/);
  });

  test('smtp success sets commit flag only after send', async () => {
    await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
    });
    expect(mockSendSmtp).toHaveBeenCalled();
    expect(mockSetSyncInfo).toHaveBeenCalledWith('email_compose_smtp_ok:10', '1');
  });

  test('missing account after validation', async () => {
    mockGetAccount.mockReturnValueOnce(null);
    const r = await sendComposeDraft({
      accountId: 1,
      draftMessageId: 10,
      subject: 'S',
      bodyText: 'B',
      to: 'a@b.de',
    });
    expect(r).toEqual({ ok: false, error: 'Konto nicht gefunden' });
  });
});
