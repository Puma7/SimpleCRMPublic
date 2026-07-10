import {
  isDraftFolderMessage,
  isEditableDraftMessage,
  isInboxMessage,
  isTrashedMessage,
} from '../../src/components/email/types';

/**
 * Message-basierte Draft-Erkennung des MessageViewers (Codex R7): Drafts aus
 * der Broad-Suche (aktuelle View ist NICHT drafts/scheduled_send) muessen
 * Bearbeiten-/Loeschen-Controls bekommen; View-Sonderfaelle (Papierkorb,
 * outbound-held) behalten ihr bisheriges Verhalten.
 */
describe('isEditableDraftMessage', () => {
  const draft = { uid: -1, folder_kind: 'draft', soft_deleted: 0, outbound_hold: 0 };

  test('erkennt lokale Drafts message-basiert (Broad-Suche ausserhalb der Drafts-View)', () => {
    expect(isEditableDraftMessage(draft)).toBe(true);
    // Server-Transport liefert outbound_hold nicht — folder_kind genuegt.
    expect(isEditableDraftMessage({ uid: -2, folder_kind: 'draft' })).toBe(true);
  });

  test('IMAP-synchronisierte Drafts (uid >= 0) bleiben nicht lokal editierbar', () => {
    expect(isEditableDraftMessage({ ...draft, uid: 5 })).toBe(false);
  });

  test('soft-geloeschte Drafts zeigen weiterhin Papierkorb- statt Draft-Controls', () => {
    expect(isEditableDraftMessage({ ...draft, soft_deleted: 1 })).toBe(false);
  });

  test('outbound-held bleibt view- und loesch-unabhaengig Draft (Bestandsverhalten)', () => {
    expect(isEditableDraftMessage({ uid: -1, folder_kind: 'draft', outbound_hold: 1 })).toBe(true);
    expect(
      isEditableDraftMessage({ uid: -1, folder_kind: 'draft', soft_deleted: 1, outbound_hold: 1 }),
    ).toBe(true);
  });

  test('normale Mails und fehlende Nachricht sind keine Drafts', () => {
    expect(isEditableDraftMessage(null)).toBe(false);
    expect(isEditableDraftMessage(undefined)).toBe(false);
    expect(isEditableDraftMessage({ uid: 3, folder_kind: 'inbox' })).toBe(false);
    expect(isEditableDraftMessage({ uid: -2, folder_kind: 'sent' })).toBe(false);
  });
});

/**
 * Message-basierte Papierkorb-Erkennung (Codex R8): soft-geloeschte Treffer
 * der Broad-Suche ("Papierkorb einbeziehen") muessen Wiederherstellen- statt
 * der normalen destruktiven Controls zeigen — unabhaengig von der aktiven
 * View. In der Trash-View selbst ist jede Zeile soft-geloescht (View-
 * Filter), dort aendert sich nichts.
 */
describe('isTrashedMessage', () => {
  test('soft-geloeschte Nachricht gilt unabhaengig von der View als Papierkorb', () => {
    expect(isTrashedMessage({ soft_deleted: 1 })).toBe(true);
  });

  test('nicht geloeschte Nachricht bleibt normal, auch ohne Feld (Legacy/Server)', () => {
    expect(isTrashedMessage({ soft_deleted: 0 })).toBe(false);
    expect(isTrashedMessage({})).toBe(false);
    expect(isTrashedMessage(null)).toBe(false);
    expect(isTrashedMessage(undefined)).toBe(false);
  });
});

/**
 * Draft-Ordner-Zugehoerigkeit der Zeile: gated Antworten/Weiterleiten-,
 * Spam- und IMAP-Draft-Loeschen-Controls unabhaengig von der aktiven View —
 * auch uid >= 0-IMAP-Drafts aus der Broad-Suche zaehlen (anders als
 * isEditableDraftMessage, das lokale editierbare Drafts meint).
 */
describe('isDraftFolderMessage', () => {
  test('jede Zeile im Draft-Ordner zaehlt, unabhaengig von uid', () => {
    expect(isDraftFolderMessage({ folder_kind: 'draft' })).toBe(true);
    // uid ist fuer die Ordner-Zugehoerigkeit irrelevant (IMAP-Draft uid >= 0).
    const imapDraft = { folder_kind: 'draft', uid: 7 };
    expect(isDraftFolderMessage(imapDraft)).toBe(true);
  });

  test('andere Ordner und fehlende Nachricht sind keine Draft-Zeilen', () => {
    expect(isDraftFolderMessage({ folder_kind: 'inbox' })).toBe(false);
    expect(isDraftFolderMessage({ folder_kind: 'sent' })).toBe(false);
    expect(isDraftFolderMessage({})).toBe(false);
    expect(isDraftFolderMessage(null)).toBe(false);
    expect(isDraftFolderMessage(undefined)).toBe(false);
  });
});

/**
 * Inbox-Zugehoerigkeit der Zeile (Erledigt-Toggle): exakt die Inbox-View-
 * Praedikat-Semantik der Store-Logik — Broad-Treffer aus sent/archived/spam
 * zeigen den Toggle nicht mehr, Inbox-Treffer aus jeder View schon.
 */
describe('isInboxMessage', () => {
  const inboxMail = {
    uid: 3,
    folder_kind: 'inbox',
    soft_deleted: 0,
    archived: 0,
    is_spam: 0,
    spam_status: 'clean',
  };

  test('normale Inbox-Mail zaehlt, auch mit leerem/fehlendem folder_kind', () => {
    expect(isInboxMessage(inboxMail)).toBe(true);
    expect(isInboxMessage({ ...inboxMail, folder_kind: '' })).toBe(true);
    expect(isInboxMessage({ ...inboxMail, folder_kind: undefined })).toBe(true);
    // Fehlende optionale Felder (Server-Transport) verhalten sich wie clean.
    expect(isInboxMessage({ uid: 3 })).toBe(true);
  });

  test('uid < 0 bleibt ausgeschlossen (outbound-held/POP3-Bestandsverhalten)', () => {
    expect(isInboxMessage({ ...inboxMail, uid: -1 })).toBe(false);
  });

  test('andere Ordner-Zeilen zaehlen nicht (sent/draft/archiv/spam/trash)', () => {
    expect(isInboxMessage({ ...inboxMail, folder_kind: 'sent' })).toBe(false);
    expect(isInboxMessage({ ...inboxMail, folder_kind: 'draft' })).toBe(false);
    expect(isInboxMessage({ ...inboxMail, archived: 1 })).toBe(false);
    expect(isInboxMessage({ ...inboxMail, is_spam: 1 })).toBe(false);
    expect(isInboxMessage({ ...inboxMail, spam_status: 'spam' })).toBe(false);
    // 'review' lebt in der spam_review-View, nicht in der Inbox.
    expect(isInboxMessage({ ...inboxMail, spam_status: 'review' })).toBe(false);
    expect(isInboxMessage({ ...inboxMail, soft_deleted: 1 })).toBe(false);
  });

  test('fehlende Nachricht ist keine Inbox-Zeile', () => {
    expect(isInboxMessage(null)).toBe(false);
    expect(isInboxMessage(undefined)).toBe(false);
  });
});
