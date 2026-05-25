import { getMailSecuritySpamScoreThreshold } from '../email/mail-security-settings';

/** Global spam score threshold from Einstellungen → Mail-Sicherheit (1–100). */
export function getWorkflowSpamScoreThreshold(): number {
  return getMailSecuritySpamScoreThreshold();
}
