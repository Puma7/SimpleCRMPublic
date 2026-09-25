import { IPCChannels } from '../../shared/ipc/channels';
import { ipcChannelCountsAsActivity, ipcChannelRequiresAuth } from '../../shared/ipc/channel-auth-policy';

describe('ipcChannelRequiresAuth', () => {
  test('allows public setup and auth channels without session', () => {
    expect(ipcChannelRequiresAuth('auth:login')).toBe(false);
    expect(ipcChannelRequiresAuth('auth:get-setup-state')).toBe(false);
    expect(ipcChannelRequiresAuth('auth:set-initial-password')).toBe(false);
    expect(ipcChannelRequiresAuth('setup:get-deploy-config')).toBe(false);
  });

  test('requires auth for CRM, database, automation, and MSSQL channels', () => {
    expect(ipcChannelRequiresAuth('db:get-customers')).toBe(true);
    expect(ipcChannelRequiresAuth('automation:generate-api-key')).toBe(true);
    expect(ipcChannelRequiresAuth('mssql:save-settings')).toBe(true);
    expect(ipcChannelRequiresAuth('sync:set-info')).toBe(true);
    expect(ipcChannelRequiresAuth('email:list-accounts')).toBe(true);
    expect(ipcChannelRequiresAuth('pgp:list-identities')).toBe(true);
  });
});

describe('ipcChannelCountsAsActivity', () => {
  test('renderer background polls do not count as user activity, everything else does', () => {
    for (const channel of [
      IPCChannels.Email.ListImapAuthNotices,
      IPCChannels.Email.GetReplySuggestion,
      IPCChannels.Diagnostics.GetServerLogs,
    ]) {
      expect(ipcChannelCountsAsActivity(channel)).toBe(false);
    }
    expect(ipcChannelCountsAsActivity(IPCChannels.Email.GetMessage)).toBe(true);
    expect(ipcChannelCountsAsActivity(IPCChannels.Tasks.GetAll)).toBe(true);
  });
});
