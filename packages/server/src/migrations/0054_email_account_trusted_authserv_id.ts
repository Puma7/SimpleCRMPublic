import type { SqlMigration } from './types';

/**
 * Vertrauenswuerdige authserv-id je Mailkonto (F-A5-12, RFC 8601 §5).
 *
 * Scheitert die Live-Pruefung (mailauth-Timeout, DNS-Fehler), uebernimmt der
 * Server SPF/DKIM/DMARC aus einem `Authentication-Results`-Header. Den kann
 * jeder Absender selbst mitschicken. Gezaehlt wird deshalb nur ein Header,
 * dessen authserv-id zu diesem Konto passt.
 *
 * NULL heisst: Standard, also die Domain des Eingangsservers (IMAP-Host, bei
 * POP3 der POP3-Host) ohne erstes Label, z. B. imap.example.com -> example.com
 * (Regel in packages/core/src/email/authentication-results.ts). Ein gesetzter
 * Wert ersetzt den Standard, etwa `mx.google.com` fuer Gmail. Passend ist eine
 * authserv-id, die gleich dem Wert oder eine Subdomain davon ist.
 *
 * Nur eine neue, nullable Spalte ohne Default: bestehende Konten bleiben
 * unveraendert und nutzen den Standard.
 */
export const emailAccountTrustedAuthservIdMigration: SqlMigration = {
  id: '0054_email_account_trusted_authserv_id',
  description: 'Per-account trusted authserv-id for the Authentication-Results fallback',
  upSql: [
    `ALTER TABLE email_accounts
  ADD COLUMN IF NOT EXISTS trusted_authserv_id text;`,
  ],
  downSql: [
    'ALTER TABLE email_accounts DROP COLUMN IF EXISTS trusted_authserv_id;',
  ],
};
