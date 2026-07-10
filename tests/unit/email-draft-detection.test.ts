import { isEditableDraftMessage } from '../../src/components/email/types';

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
