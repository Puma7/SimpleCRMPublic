jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn(),
  getMessageAccountIds: jest.fn(() => new Map()),
}));
jest.mock('../../electron/email/email-message-attachments-store', () => ({
  getAttachmentById: jest.fn(),
}));
jest.mock('../../electron/email/email-crm-store', () => ({
  getInternalNoteMessageId: jest.fn(),
  getCannedResponseById: jest.fn(),
  getAiPromptById: jest.fn(),
}));
jest.mock('../../electron/email/email-spam-store', () => ({
  getSpamListEntry: jest.fn(),
}));
jest.mock('../../electron/workflow/knowledge-base', () => ({
  getKnowledgeBaseById: jest.fn(),
}));
jest.mock('../../electron/workflow/run-steps', () => ({
  getWorkflowRunMessageId: jest.fn(),
}));

import { getEmailMessageById, getMessageAccountIds } from '../../electron/email/email-store';
import { getAttachmentById } from '../../electron/email/email-message-attachments-store';
import { getCannedResponseById, getInternalNoteMessageId } from '../../electron/email/email-crm-store';
import { getKnowledgeBaseById } from '../../electron/workflow/knowledge-base';
import { getWorkflowRunMessageId } from '../../electron/workflow/run-steps';
import { IPCChannels } from '../../shared/ipc/channels';
import {
  EMAIL_GLOBAL_OBJECT_CHANNELS,
  EMAIL_MULTI_ACCOUNT_CHANNELS,
  EMAIL_SKIP_ACCOUNT_SCOPE,
  resolveEmailChannelAccountId,
  resolveEmailChannelAccountScope,
} from '../../electron/ipc/ipc-account-scope';

const mockGetMessage = getEmailMessageById as jest.MockedFunction<typeof getEmailMessageById>;
const mockGetAttachment = getAttachmentById as jest.MockedFunction<typeof getAttachmentById>;

describe('resolveEmailChannelAccountId', () => {
  beforeEach(() => {
    mockGetMessage.mockReset();
    mockGetAttachment.mockReset();
  });

  it('returns undefined for non-email channels', () => {
    expect(resolveEmailChannelAccountId('pgp:list-keys', { accountId: 1 })).toBeUndefined();
  });

  it('skips account scope for admin/global channels', () => {
    for (const ch of EMAIL_SKIP_ACCOUNT_SCOPE) {
      expect(resolveEmailChannelAccountId(ch, { accountId: 99 })).toBeUndefined();
    }
  });

  it('only contains live email channel names in the skip list', () => {
    const liveEmailChannels = new Set<string>(Object.values(IPCChannels.Email));
    for (const ch of EMAIL_SKIP_ACCOUNT_SCOPE) {
      expect(liveEmailChannels.has(ch)).toBe(true);
    }
  });

  it('treats bare number as account id only on whitelisted account channels', () => {
    expect(resolveEmailChannelAccountId('email:sync-account', 7)).toBe(7);
    expect(resolveEmailChannelAccountId('email:get-message', 7)).toBeUndefined();
    mockGetMessage.mockReturnValue({ account_id: 3 } as never);
    expect(resolveEmailChannelAccountId('email:get-message', 7)).toBe(3);
    expect(mockGetMessage).toHaveBeenCalledWith(7);
  });

  it('does not treat bare number as account id on unlisted channels (IDOR guard)', () => {
    expect(resolveEmailChannelAccountId('email:unknown-channel', 42)).toBeUndefined();
  });

  // F-A7-03: delete-account bekommt eine nackte Konto-ID, die nie aufgeloest wurde, daher lief die Loeschung ohne Konto-ACL.
  it('resolves the bare account id that delete-account actually receives', () => {
    expect(resolveEmailChannelAccountId('email:delete-account', 5)).toBe(5);
  });

  // F-A7b-06: Anhang speichern/oeffnen loeste aus attachmentId kein Konto auf, die Konto-ACL wurde uebersprungen (IDOR).
  it('resolves the owning account of an attachment for save/open attachment channels', () => {
    mockGetAttachment.mockReturnValue({ id: 42, message_id: 7 } as never);
    mockGetMessage.mockReturnValue({ account_id: 3 } as never);

    expect(resolveEmailChannelAccountId('email:save-attachment-to-disk', { attachmentId: 42 })).toBe(3);
    expect(
      resolveEmailChannelAccountId('email:open-attachment-path', { attachmentId: 42, confirmOpenRisky: true }),
    ).toBe(3);
    expect(mockGetAttachment).toHaveBeenCalledWith(42);
    expect(mockGetMessage).toHaveBeenCalledWith(7);
  });

  // C-A78: Ein unbekannter Anhang uebersprang die Konto-ACL; jetzt nur noch Owner/Admin (fail-closed).
  it('marks unknown attachments as unresolved instead of skipping the ACL', () => {
    mockGetAttachment.mockReturnValue(undefined);
    expect(resolveEmailChannelAccountId('email:open-attachment-path', { attachmentId: 99 })).toBeUndefined();
    expect(resolveEmailChannelAccountScope('email:open-attachment-path', { attachmentId: 99 }))
      .toEqual({ kind: 'unresolved' });
    expect(mockGetMessage).not.toHaveBeenCalled();
  });

  it('uses payload.id as account only for update/delete-account', () => {
    expect(resolveEmailChannelAccountId('email:update-account', { id: 5 })).toBe(5);
    expect(resolveEmailChannelAccountId('email:delete-account', { id: 5 })).toBe(5);
    expect(resolveEmailChannelAccountId('email:get-message', { id: 5 })).toBeUndefined();
  });

  // F-A11a-04: Mit dem neuen Umhaengen per accountId haette das Gate nur noch das Zielkonto geprueft.
  it('gates update-compose-draft on the draft account, not on the move target', () => {
    mockGetMessage.mockReturnValue({ account_id: 3 } as never);
    expect(resolveEmailChannelAccountId('email:update-compose-draft', { messageId: 10, accountId: 7 })).toBe(3);
    expect(mockGetMessage).toHaveBeenCalledWith(10);
  });

  it('resolves accountId from object payload on scoped channels', () => {
    expect(
      resolveEmailChannelAccountId('email:send-message', { accountId: 2, messageId: 10 }),
    ).toBe(2);
    mockGetMessage.mockReturnValue({ account_id: 4 } as never);
    expect(resolveEmailChannelAccountId('email:send-message', { messageId: 10 })).toBe(4);
  });

  it('scopes multi-account channels only when accountId is explicit', () => {
    for (const ch of EMAIL_MULTI_ACCOUNT_CHANNELS) {
      expect(resolveEmailChannelAccountId(ch, { accountId: 1 })).toBe(1);
      expect(resolveEmailChannelAccountId(ch, {})).toBeUndefined();
    }
  });

  it('treats bare number on multi-account channels as account id', () => {
    expect(resolveEmailChannelAccountId('email:reporting', 3)).toBe(3);
  });
});

describe('resolveEmailChannelAccountScope', () => {
  const mockMessageAccounts = getMessageAccountIds as jest.MockedFunction<typeof getMessageAccountIds>;
  const mockNote = getInternalNoteMessageId as jest.MockedFunction<typeof getInternalNoteMessageId>;
  const mockCanned = getCannedResponseById as jest.MockedFunction<typeof getCannedResponseById>;
  const mockKb = getKnowledgeBaseById as jest.MockedFunction<typeof getKnowledgeBaseById>;
  const mockRun = getWorkflowRunMessageId as jest.MockedFunction<typeof getWorkflowRunMessageId>;
  const accounts = (...accountIds: number[]) => ({ kind: 'accounts', accountIds });
  const unresolved = { kind: 'unresolved' };
  const none = { kind: 'none' };

  beforeEach(() => {
    jest.mocked(getEmailMessageById).mockReset();
    mockMessageAccounts.mockReset();
    mockNote.mockReset();
    mockCanned.mockReset();
    mockKb.mockReset();
    mockRun.mockReset();
  });

  // C-B4: delete-compose-draft und get-compose-draft-recovery-state loesten die nackte Entwurfs-ID nicht auf.
  it('resolves the bare draft id of draft channels and fails closed for unknown drafts', () => {
    jest.mocked(getEmailMessageById).mockReturnValue({ account_id: 3 } as never);
    expect(resolveEmailChannelAccountScope('email:delete-compose-draft', 10)).toEqual(accounts(3));
    expect(resolveEmailChannelAccountScope('email:get-compose-draft-recovery-state', 10)).toEqual(accounts(3));
    jest.mocked(getEmailMessageById).mockReturnValue(undefined);
    expect(resolveEmailChannelAccountScope('email:delete-compose-draft', 10)).toEqual(unresolved);
  });

  // C-A14: messageIds in Bulk-Kanaelen wurden ignoriert; ohne accountId lief die ACL gar nicht.
  it('resolves every message of a bulk list plus the optional account filter', () => {
    mockMessageAccounts.mockReturnValue(new Map([[10, 1], [11, 2]]));
    expect(resolveEmailChannelAccountScope('email:bulk-soft-delete-messages', { messageIds: [10, 11] }))
      .toEqual(accounts(1, 2));
    expect(resolveEmailChannelAccountScope('email:bulk-set-message-done', { messageIds: [10, 11], accountId: 1, done: true }))
      .toEqual(accounts(1, 2));
    expect(resolveEmailChannelAccountScope('email:bulk-delete-compose-drafts', { messageIds: [10, 12] }))
      .toEqual(unresolved);
    expect(mockMessageAccounts).toHaveBeenCalledWith([10, 12]);
  });

  // C-A25: Notiz-IDs wurden nicht aufgeloest.
  it('resolves internal notes via their message', () => {
    mockNote.mockReturnValue(10);
    jest.mocked(getEmailMessageById).mockReturnValue({ account_id: 4 } as never);
    expect(resolveEmailChannelAccountScope('email:update-internal-note', { noteId: 7, body: 'x' })).toEqual(accounts(4));
    expect(resolveEmailChannelAccountScope('email:delete-internal-note', 7)).toEqual(accounts(4));
    mockNote.mockReturnValue(undefined);
    expect(resolveEmailChannelAccountScope('email:delete-internal-note', 7)).toEqual(unresolved);
  });

  // C-A29: Das Zielkonto ersetzte beim Speichern den Eigentuemer der Vorlage.
  it('checks both the owner and the target account of an account-override row', () => {
    mockCanned.mockReturnValue({ id: 4, account_id: 2 } as never);
    expect(resolveEmailChannelAccountScope('email:save-canned', { id: 4, title: 't', body: 'b', accountId: 1 }))
      .toEqual(accounts(2, 1));
    expect(resolveEmailChannelAccountScope('email:save-canned', { id: 4, title: 't', body: 'b' })).toEqual(accounts(2));
    expect(resolveEmailChannelAccountScope('email:delete-canned', 4)).toEqual(accounts(2));

    mockCanned.mockReturnValue({ id: 5, account_id: null } as never);
    expect(resolveEmailChannelAccountScope('email:save-canned', { id: 5, title: 't', body: 'b', accountId: null }))
      .toEqual(none);
    expect(resolveEmailChannelAccountScope('email:save-canned', { title: 't', body: 'b', accountId: 3 })).toEqual(accounts(3));

    mockCanned.mockReturnValue(undefined);
    expect(resolveEmailChannelAccountScope('email:save-canned', { id: 6, title: 't', body: 'b', accountId: 1 }))
      .toEqual(unresolved);
  });

  // C-A65: workflow:-Kanaele fielen aus dem Resolver; draftId blieb unaufgeloest.
  it('resolves workflow draft approval, message test, knowledge bases and runs', () => {
    jest.mocked(getEmailMessageById).mockReturnValue({ account_id: 5 } as never);
    expect(resolveEmailChannelAccountScope('workflow:approve-draft-send', { draftId: 9 })).toEqual(accounts(5));
    expect(resolveEmailChannelAccountScope('workflow:dismiss-draft-approval', { draftId: 9 })).toEqual(accounts(5));
    expect(resolveEmailChannelAccountScope('workflow:test-on-message', { workflowId: 1, messageId: 9 }))
      .toEqual(accounts(5));

    mockKb.mockReturnValue({ id: 3, account_id: 6 } as never);
    expect(resolveEmailChannelAccountScope('workflow:get-knowledge-base-document', 3)).toEqual(accounts(6));
    expect(resolveEmailChannelAccountScope('workflow:update-knowledge-base', { id: 3, accountId: 1 }))
      .toEqual(accounts(6, 1));
    expect(resolveEmailChannelAccountScope('workflow:list-knowledge-bases', { accountId: 6 })).toEqual(accounts(6));

    mockRun.mockReturnValue({ message_id: 9 });
    expect(resolveEmailChannelAccountScope('workflow:get-run-log', 12)).toEqual(accounts(5));
    mockRun.mockReturnValue({ message_id: null });
    expect(resolveEmailChannelAccountScope('workflow:list-run-steps', 12)).toEqual(none);
    mockRun.mockReturnValue(undefined);
    expect(resolveEmailChannelAccountScope('workflow:get-run-log', 12)).toEqual(unresolved);
  });

  it('reads the account of a UID-validity notice from its id', () => {
    expect(resolveEmailChannelAccountScope('email:dismiss-uidvalidity-notice', { noticeId: '7:1700000000000' }))
      .toEqual(accounts(7));
    expect(resolveEmailChannelAccountScope('email:dismiss-uidvalidity-notice', { noticeId: 'kaputt' })).toEqual(unresolved);
  });

  // C-A78: Unbekannte Kanaele mit Objekt-ID liefen ohne Pruefung (fail-open).
  it('fails closed for ids on unclassified channels and passes id-free payloads', () => {
    expect(resolveEmailChannelAccountScope('email:unknown-channel', 42)).toEqual(unresolved);
    expect(resolveEmailChannelAccountScope('email:unknown-channel', { fooId: 3 })).toEqual(unresolved);
    expect(resolveEmailChannelAccountScope('workflow:unknown-channel', 42)).toEqual(unresolved);
    expect(resolveEmailChannelAccountScope('email:unknown-channel', { query: 'x', accountId: null })).toEqual(none);
    expect(resolveEmailChannelAccountScope('email:unknown-channel', undefined)).toEqual(none);
    expect(resolveEmailChannelAccountScope('pgp:list-keys', 42)).toEqual(none);
  });

  it('documents a reason for every global object channel', () => {
    const liveChannels = new Set<string>(Object.values(IPCChannels.Email));
    for (const [channel, reason] of EMAIL_GLOBAL_OBJECT_CHANNELS) {
      expect(liveChannels.has(channel)).toBe(true);
      expect(reason.trim().length).toBeGreaterThan(10);
      expect(resolveEmailChannelAccountScope(channel, 42)).toEqual(none);
    }
  });
});
