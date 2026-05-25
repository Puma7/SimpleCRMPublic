import log from 'electron-log';
import { getEmailAccountById } from './email-store';
import { EMAIL_MESSAGES_TABLE } from '../database-schema';
import { getDb } from '../sqlite-service';

/** SQL filter: synced inbound mail wrongly archived (e.g. workflow auto-archive). */
const RESTORABLE_INBOX_ARCHIVE_WHERE = `
  account_id = ?
  AND archived = 1
  AND soft_deleted = 0
  AND is_spam = 0
  AND (folder_kind = 'inbox' OR folder_kind IS NULL OR folder_kind = '')
  AND (uid >= 0 OR pop3_uidl IS NOT NULL)
`;

export type InboxArchiveRecoveryPreview = {
  accountId: number;
  count: number;
  accountEmail: string;
  accountLabel: string;
};

export type InboxArchiveRecoveryResult =
  | { ok: true; restored: number }
  | { ok: false; error: string };

export function previewInboxArchiveRecovery(accountId: number): InboxArchiveRecoveryPreview | null {
  const account = getEmailAccountById(accountId);
  if (!account) return null;
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS c FROM ${EMAIL_MESSAGES_TABLE} WHERE ${RESTORABLE_INBOX_ARCHIVE_WHERE}`,
    )
    .get(accountId) as { c: number };
  return {
    accountId,
    count: row?.c ?? 0,
    accountEmail: account.email_address,
    accountLabel: account.display_name,
  };
}

/**
 * Restores archived inbox messages for one account after explicit confirmation.
 * Requires preview count and account e-mail to prevent accidental mass un-archive.
 */
export function restoreInboxMessagesFromArchiveSafe(input: {
  accountId: number;
  expectedCount: number;
  confirmPhrase: string;
}): InboxArchiveRecoveryResult {
  const account = getEmailAccountById(input.accountId);
  if (!account) {
    return { ok: false, error: 'Konto nicht gefunden' };
  }

  const phrase = input.confirmPhrase.trim().toLowerCase();
  const expectedEmail = account.email_address.trim().toLowerCase();
  if (!phrase || phrase !== expectedEmail) {
    return {
      ok: false,
      error: 'Bestätigung fehlgeschlagen: E-Mail-Adresse des Kontos exakt eingeben.',
    };
  }

  const preview = previewInboxArchiveRecovery(input.accountId);
  if (!preview) {
    return { ok: false, error: 'Konto nicht gefunden' };
  }

  if (preview.count !== input.expectedCount) {
    return {
      ok: false,
      error:
        'Die Anzahl betroffener Nachrichten hat sich geändert. Bitte Vorschau erneut ausführen.',
    };
  }

  if (preview.count === 0) {
    return { ok: true, restored: 0 };
  }

  if (preview.count > 10_000) {
    return {
      ok: false,
      error: `Zu viele Nachrichten (${preview.count}). Bitte zuerst filtern oder Support kontaktieren.`,
    };
  }

  const r = getDb()
    .prepare(
      `UPDATE ${EMAIL_MESSAGES_TABLE}
       SET archived = 0
       WHERE ${RESTORABLE_INBOX_ARCHIVE_WHERE}`,
    )
    .run(input.accountId);

  log.warn(
    `[email-inbox-recovery] Restored ${r.changes} archived inbox message(s) for account ${input.accountId} (${expectedEmail})`,
  );

  return { ok: true, restored: r.changes };
}

/** @deprecated Use restoreInboxMessagesFromArchiveSafe — kept for internal migration only. */
export function restoreInboxMessagesFromArchive(accountId: number): number {
  const preview = previewInboxArchiveRecovery(accountId);
  if (!preview || preview.count === 0) return 0;
  const result = restoreInboxMessagesFromArchiveSafe({
    accountId,
    expectedCount: preview.count,
    confirmPhrase: preview.accountEmail,
  });
  return result.ok ? result.restored : 0;
}
