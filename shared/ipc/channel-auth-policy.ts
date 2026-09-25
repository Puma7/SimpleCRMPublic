/** Channels that must work without an authenticated session. */
const PUBLIC_IPC_CHANNELS = new Set<string>([
  'auth:login',
  'auth:get-session',
  'auth:get-setup-state',
  'auth:set-initial-password',
  'auth:get-one-time-setup-password',
  'setup:get-deploy-config',
  'setup:save-deploy-config',
  'setup:reset-deploy-config',
  'window:get-state',
  'app:open-external-url',
  'app:get-update-status',
  'app:check-for-updates',
]);

/** Default IPC auth policy: deny unless explicitly public. */
export function ipcChannelRequiresAuth(channel: string): boolean {
  return !PUBLIC_IPC_CHANNELS.has(channel);
}

/**
 * Channels the renderer polls on timers without user interaction. They must not
 * extend the desktop idle window, otherwise an open mail view never auto-locks.
 */
const BACKGROUND_POLL_IPC_CHANNELS = new Set<string>([
  'email:list-imap-auth-notices',
  'email:get-reply-suggestion',
  'diagnostics:get-server-logs',
]);

/** Whether an authenticated call on this channel counts as user activity. */
export function ipcChannelCountsAsActivity(channel: string): boolean {
  return !BACKGROUND_POLL_IPC_CHANNELS.has(channel);
}
