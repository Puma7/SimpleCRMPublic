/** Append actionable hint for common mail sync/auth failures. */
export function formatEmailSyncError(error: string, accountId: number): string {
  const lower = error.toLowerCase();
  if (
    lower.includes('oauth') ||
    lower.includes('passwort') ||
    lower.includes('password') ||
    lower.includes('token') ||
    lower.includes('client-id') ||
    lower.includes('client-secret') ||
    lower.includes('gespeichertes imap')
  ) {
    return `${error} — Bitte E-Mail-Einstellungen für Konto ${accountId} prüfen (OAuth oder Passwort).`;
  }
  if (lower.includes('cron') || lower.includes('schedule')) {
    return `${error} — Cron-Ausdruck im Workflow prüfen.`;
  }
  return error;
}
