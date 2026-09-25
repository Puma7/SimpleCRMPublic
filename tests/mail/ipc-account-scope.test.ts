jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn(),
}));
jest.mock('../../electron/email/email-message-attachments-store', () => ({
  getAttachmentById: jest.fn(),
}));

import { getEmailMessageById } from '../../electron/email/email-store';
import { getAttachmentById } from '../../electron/email/email-message-attachments-store';
import { IPCChannels } from '../../shared/ipc/channels';
import {
  EMAIL_MULTI_ACCOUNT_CHANNELS,
  EMAIL_SKIP_ACCOUNT_SCOPE,
  resolveEmailChannelAccountId,
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

  it('leaves unknown attachments to the handler (not found, nothing to leak)', () => {
    mockGetAttachment.mockReturnValue(undefined);
    expect(resolveEmailChannelAccountId('email:open-attachment-path', { attachmentId: 99 })).toBeUndefined();
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
