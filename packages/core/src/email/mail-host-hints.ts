/** Suggest an SMTP host from a known IMAP host (display only — never used for sending). */
export function guessSmtpHostFromImapHost(imapHost: string): string | null {
  const trimmed = imapHost.trim();
  if (!trimmed) return null;
  if (/^imap\.ionos\./i.test(trimmed)) {
    return trimmed.replace(/^imap\./i, 'smtp.');
  }
  if (/^imap\./i.test(trimmed)) {
    return trimmed.replace(/^imap\./i, 'smtp.');
  }
  return null;
}

/** Returns the configured SMTP host or null when missing/blank. */
export function resolveConfiguredSmtpHost(smtpHost: string | null | undefined): string | null {
  const trimmed = smtpHost?.trim();
  return trimmed ? trimmed : null;
}

export const SMTP_HOST_MISSING_ERROR =
  'SMTP-Host fehlt (z. B. smtp.ionos.de unter Einstellungen → SMTP eintragen).';
