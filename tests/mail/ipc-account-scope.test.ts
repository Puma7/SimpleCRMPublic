jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn(),
}));

import { getEmailMessageById } from '../../electron/email/email-store';
import { IPCChannels } from '../../shared/ipc/channels';
import {
  EMAIL_MULTI_ACCOUNT_CHANNELS,
  EMAIL_SKIP_ACCOUNT_SCOPE,
  resolveEmailChannelAccountId,
} from '../../electron/ipc/ipc-account-scope';

const mockGetMessage = getEmailMessageById as jest.MockedFunction<typeof getEmailMessageById>;

describe('resolveEmailChannelAccountId', () => {
  beforeEach(() => {
    mockGetMessage.mockReset();
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

  it('uses payload.id as account only for update/delete-account', () => {
    expect(resolveEmailChannelAccountId('email:update-account', { id: 5 })).toBe(5);
    expect(resolveEmailChannelAccountId('email:delete-account', { id: 5 })).toBe(5);
    expect(resolveEmailChannelAccountId('email:get-message', { id: 5 })).toBeUndefined();
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
