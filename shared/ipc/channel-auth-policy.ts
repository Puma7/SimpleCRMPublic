/** Channels that must work without an authenticated session. */
const PUBLIC_IPC_CHANNELS = new Set<string>([
  'auth:login',
  'auth:get-session',
  'auth:get-setup-state',
  'auth:set-initial-password',
  'auth:get-one-time-setup-password',
  'setup:get-deploy-config',
  'setup:save-deploy-config',
  'window:get-state',
  'app:open-external-url',
  'app:get-update-status',
  'app:check-for-updates',
]);

/** Default IPC auth policy: deny unless explicitly public. */
export function ipcChannelRequiresAuth(channel: string): boolean {
  return !PUBLIC_IPC_CHANNELS.has(channel);
}
