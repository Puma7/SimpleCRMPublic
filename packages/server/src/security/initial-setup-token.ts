export const MIN_INITIAL_SETUP_TOKEN_LENGTH = 24;

/**
 * Whether INITIAL_SETUP_TOKEN may unlock the anonymous owner setup. The
 * docker/.env.example placeholder is public, and a short token is guessable
 * within the setup window of a fresh, internet-facing instance; either would
 * hand the first owner account to whoever asks first.
 */
export function isUsableInitialSetupToken(token: string): boolean {
  const value = token.trim();
  if (/^change[_-]?me/i.test(value)) return false;
  return value.length >= MIN_INITIAL_SETUP_TOKEN_LENGTH;
}
