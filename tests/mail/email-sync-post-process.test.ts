const mockPending = jest.fn();
const mockGetMessage = jest.fn();
const mockMarkDone = jest.fn();
const mockBuildMap = jest.fn();
const mockLink = jest.fn();
const mockListWorkflows = jest.fn();
const mockLoadApplied = jest.fn();
const mockPersist = jest.fn();
const mockHasStoredAttachments = jest.fn();
const mockThread = jest.fn();
const mockRunInbound = jest.fn();
const mockSimpleParser = jest.fn();

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: (...a: unknown[]) => mockGetMessage(...a),
  listMessagesPendingPostProcess: (...a: unknown[]) => mockPending(...a),
  markMessagePostProcessDone: (...a: unknown[]) => mockMarkDone(...a),
}));
jest.mock('../../electron/email/email-crm-store', () => ({
  buildCustomerEmailMap: () => mockBuildMap(),
  tryLinkMessageToCustomer: (...a: unknown[]) => mockLink(...a),
}));
jest.mock('../../electron/email/email-workflow-store', () => ({
  listWorkflowsByTrigger: () => mockListWorkflows(),
  loadAppliedWorkflowIdsForMessage: (...a: unknown[]) => mockLoadApplied(...a),
}));
jest.mock('../../electron/email/email-message-attachments-store', () => ({
  persistParsedAttachments: (...a: unknown[]) => mockPersist(...a),
  hasStoredAttachmentsForMessage: (...a: unknown[]) => mockHasStoredAttachments(...a),
}));
jest.mock('../../electron/email/email-threading-jwz', () => ({
  assignJwzThreadAndTicket: (...a: unknown[]) => mockThread(...a),
}));
jest.mock('../../electron/email/email-workflow-engine', () => ({
  runInboundWorkflowsForMessage: (...a: unknown[]) => mockRunInbound(...a),
}));
jest.mock('mailparser', () => ({
  simpleParser: (...a: unknown[]) => mockSimpleParser(...a),
}));

import { processNewMessagesAfterSync } from '../../electron/email/email-sync-post-process';

describe('processNewMessagesAfterSync', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockBuildMap.mockReturnValue(new Map());
    mockListWorkflows.mockReturnValue([]);
    mockLoadApplied.mockReturnValue([]);
    mockGetMessage.mockReturnValue({ id: 1 });
    mockPersist.mockResolvedValue(undefined);
    mockHasStoredAttachments.mockReturnValue(false);
    mockRunInbound.mockResolvedValue(undefined);
    mockSimpleParser.mockResolvedValue({ attachments: [] });
  });

  test('no-op for empty items', async () => {
    await processNewMessagesAfterSync(1, []);
    expect(mockPersist).not.toHaveBeenCalled();
  });

  test('processes items and runs workflows', async () => {
    await processNewMessagesAfterSync(1, [
      {
        localMsgId: 5,
        parsedAttachments: [{ filename: 'a.txt', content: Buffer.from('x') }],
        threading: {
          messageIdHeader: '<m@x>',
          inReplyTo: null,
          referencesHeader: null,
          subject: 'Subj',
        },
      },
    ]);
    expect(mockPersist).toHaveBeenCalledWith(5, expect.any(Array));
    expect(mockThread).toHaveBeenCalled();
    expect(mockRunInbound).toHaveBeenCalled();
    expect(mockMarkDone).toHaveBeenCalledWith(5);
  });

  test('merges pending folder messages', async () => {
    mockPending.mockReturnValue([
      {
        id: 9,
        message_id: '<p@x>',
        in_reply_to: null,
        references_header: null,
        subject: 'P',
      },
    ]);
    await processNewMessagesAfterSync(
      1,
      [{ localMsgId: 5, parsedAttachments: undefined, threading: { messageIdHeader: null, inReplyTo: null, referencesHeader: null, subject: null } }],
      2,
    );
    expect(mockPending).toHaveBeenCalledWith(2);
    expect(mockRunInbound).toHaveBeenCalledTimes(2);
  });

  test('continues when attachment step fails', async () => {
    mockPersist.mockRejectedValueOnce(new Error('disk'));
    mockGetMessage.mockImplementation((id: number) => ({ id }));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await processNewMessagesAfterSync(1, [
      {
        localMsgId: 1,
        parsedAttachments: undefined,
        threading: { messageIdHeader: null, inReplyTo: null, referencesHeader: null, subject: null },
      },
      {
        localMsgId: 2,
        parsedAttachments: undefined,
        threading: { messageIdHeader: null, inReplyTo: null, referencesHeader: null, subject: null },
      },
    ]);
    expect(mockThread).toHaveBeenCalledTimes(2);
    expect(mockRunInbound).toHaveBeenCalledTimes(1);
    expect(mockRunInbound).toHaveBeenCalledWith(2, expect.any(Object));
    expect(mockMarkDone).not.toHaveBeenCalledWith(1);
    expect(mockMarkDone).toHaveBeenCalledWith(2);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  test('recovers attachments from the raw message when retrying pending post-process work', async () => {
    const recoveredAttachments = [{ filename: 'recovered.pdf', content: Buffer.from('pdf') }];
    mockPending.mockReturnValue([
      {
        id: 9,
        message_id: '<p@x>',
        in_reply_to: null,
        references_header: null,
        subject: 'P',
      },
    ]);
    mockGetMessage.mockReturnValue({
      id: 9,
      has_attachments: 1,
      raw_rfc822_b64: Buffer.from('raw mail').toString('base64'),
    });
    mockSimpleParser.mockResolvedValue({ attachments: recoveredAttachments });

    await processNewMessagesAfterSync(1, [], 2);

    expect(mockSimpleParser).toHaveBeenCalledWith(Buffer.from('raw mail'));
    expect(mockPersist).toHaveBeenCalledWith(9, recoveredAttachments);
    expect(mockMarkDone).toHaveBeenCalledWith(9);
  });

  test('still runs attachments when threading fails', async () => {
    mockThread.mockImplementationOnce(() => {
      throw new Error('thread');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await processNewMessagesAfterSync(1, [
      {
        localMsgId: 1,
        parsedAttachments: [{ filename: 'a.txt' }],
        threading: { messageIdHeader: null, inReplyTo: null, referencesHeader: null, subject: null },
      },
    ]);
    expect(mockPersist).toHaveBeenCalled();
    expect(mockMarkDone).not.toHaveBeenCalledWith(1);
    warn.mockRestore();
  });

  test('keeps pending attachment recovery retryable when the raw message is unavailable', async () => {
    mockGetMessage.mockReturnValue({ id: 4, has_attachments: 1, raw_rfc822_b64: null });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);

    await processNewMessagesAfterSync(1, [
      {
        localMsgId: 4,
        parsedAttachments: undefined,
        threading: { messageIdHeader: null, inReplyTo: null, referencesHeader: null, subject: null },
      },
    ]);

    expect(mockPersist).not.toHaveBeenCalled();
    expect(mockMarkDone).not.toHaveBeenCalledWith(4);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('post-process attachments failed msg 4'),
      expect.any(Error),
    );
    warn.mockRestore();
  });

  test('completes retry without raw mail when attachments are already stored', async () => {
    mockGetMessage.mockReturnValue({ id: 14, has_attachments: 1, raw_rfc822_b64: null });
    mockHasStoredAttachments.mockReturnValue(true);

    await processNewMessagesAfterSync(1, [
      {
        localMsgId: 14,
        parsedAttachments: undefined,
        threading: { messageIdHeader: null, inReplyTo: null, referencesHeader: null, subject: null },
      },
    ]);

    expect(mockSimpleParser).not.toHaveBeenCalled();
    expect(mockPersist).toHaveBeenCalledWith(14, undefined);
    expect(mockMarkDone).toHaveBeenCalledWith(14);
  });

  test('skips workflow when message row missing', async () => {
    mockGetMessage.mockReturnValue(undefined);
    await processNewMessagesAfterSync(1, [
      {
        localMsgId: 3,
        parsedAttachments: undefined,
        threading: { messageIdHeader: null, inReplyTo: null, referencesHeader: null, subject: null },
      },
    ]);
    expect(mockMarkDone).not.toHaveBeenCalled();
  });
});
