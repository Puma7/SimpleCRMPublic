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
