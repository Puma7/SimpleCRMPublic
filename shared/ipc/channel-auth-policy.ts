/** Channels that must work without an authenticated session. */
const PUBLIC_IPC_CHANNELS = new Set<string>([
  'auth:login',
  'auth:get-session',
  'auth:get-setup-state',
  'setup:get-deploy-config',
  'setup:save-deploy-config',
]);

/** Default IPC auth policy: email + PGP namespaces require auth unless explicitly public. */
export function ipcChannelRequiresAuth(channel: string): boolean {
  if (PUBLIC_IPC_CHANNELS.has(channel)) return false;
  if (channel.startsWith('email:') || channel.startsWith('pgp:')) return true;
  return false;
}
