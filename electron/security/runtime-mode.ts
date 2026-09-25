/**
 * Development mode (Vite dev server URL with the full preload, relaxed CSP, no
 * auto-update, verbose logs) is only possible for an unpackaged Electron run. A
 * packaged app ignores NODE_ENV=development inherited from the user's shell.
 */
export function resolveIsDevelopment(input: {
  isPackaged: boolean | undefined;
  nodeEnv: string | undefined;
}): boolean {
  return !input.isPackaged && input.nodeEnv === 'development';
}
