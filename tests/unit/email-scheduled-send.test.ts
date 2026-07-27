const mockGetSyncInfo = jest.fn();
const mockSetSyncInfo = jest.fn();
const mockSendComposeDraft = jest.fn();
const mockSetDraftScheduledSendAt = jest.fn();
const mockListDue = jest.fn();

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (...args: unknown[]) => mockGetSyncInfo(...args),
  setSyncInfo: (...args: unknown[]) => mockSetSyncInfo(...args),
}));

const mockSetDraftApprovalPending = jest.fn();
jest.mock('../../electron/email/email-draft-approval', () => ({
  setDraftApprovalPending: (...args: unknown[]) => mockSetDraftApprovalPending(...args),
}));

jest.mock('../../electron/email/email-store', () => ({
  getEmailMessageById: jest.fn((id: number) => ({
    id,
    uid: -1,
    account_id: 1,
    to_json: JSON.stringify({ value: [{ address: 'to@example.com' }] }),
    subject: 'Hi',
    body_text: 'Body',
    body_html: null,
    cc_json: null,
    bcc_json: null,
  })),
}));

jest.mock('../../electron/email/email-compose-send', () => ({
  sendComposeDraft: (...args: unknown[]) => mockSendComposeDraft(...args),
}));

jest.mock('../../electron/email/email-message-features', () => ({
  listDueScheduledDraftIds: () => mockListDue(),
  setDraftScheduledSendAt: (...args: unknown[]) => mockSetDraftScheduledSendAt(...args),
}));

import { processDueScheduledSends } from '../../electron/email/email-scheduled-send';

describe('email-scheduled-send', () => {
  const logger = { warn: jest.fn(), debug: jest.fn() };

  /**
   * sync_info ist ein geteilter Schluesselraum — der Mock muss nach Schluessel
   * antworten. Ein pauschaler Rueckgabewert liesse jeden Lauf so aussehen, als
   * laege ein geparktes HOLD der Gegenlese-KI vor.
   */
  function syncInfo(values: Record<string, string>): void {
    mockGetSyncInfo.mockImplementation((key: string) => values[key] ?? '');
  }

  beforeEach(() => {
    jest.clearAllMocks();
    // Die echte Funktion liefert true, wenn der Stempel gesetzt wurde.
    mockSetDraftApprovalPending.mockReturnValue(true);
    mockListDue.mockReturnValue([99]);
    syncInfo({ 'scheduled_send_failures:99': '0' });
  });

  test('clears schedule after repeated throws', async () => {
    mockSendComposeDraft.mockRejectedValue(new Error('db locked'));
    syncInfo({ 'scheduled_send_failures:99': '4' });

    await processDueScheduledSends(logger);

    expect(mockSetDraftScheduledSendAt).toHaveBeenCalledWith(99, null);
    expect(logger.warn).toHaveBeenCalled();
  });

  test('does not clear schedule on first throw', async () => {
    mockSendComposeDraft.mockRejectedValue(new Error('transient'));
    syncInfo({ 'scheduled_send_failures:99': '0' });

    await processDueScheduledSends(logger);

    expect(mockSetDraftScheduledSendAt).not.toHaveBeenCalled();
    expect(mockSetSyncInfo).toHaveBeenCalledWith('scheduled_send_failures:99', '1');
  });

  test('geparktes HOLD wird nach gescheitertem Versand nachgeholt', async () => {
    // Die Gegenlese-KI kam waehrend des laufenden SMTP-Aufrufs zu spaet und hat
    // ihr HOLD geparkt. Geht die Mail dann doch nicht raus, muss der Entwurf auf
    // „Wartet auf Freigabe" — sonst versendet ihn der naechste faellige Lauf
    // ungeprueft.
    const values: Record<string, string> = { 'scheduled_send_failures:99': '0' };
    syncInfo(values);
    mockSendComposeDraft.mockImplementation(async () => {
      values['scheduled_send_deferred_hold:99'] = 'Gegenlese-KI empfiehlt menschliche Pruefung';
      return { ok: false, error: 'SMTP 550' };
    });

    await processDueScheduledSends(logger);

    expect(mockSetDraftApprovalPending).toHaveBeenCalledWith(
      99,
      'Gegenlese-KI empfiehlt menschliche Pruefung',
    );
    // Der Parkplatz wird erst danach verbraucht.
    expect(mockSetSyncInfo).toHaveBeenCalledWith('scheduled_send_deferred_hold:99', '');
  });

  test('HOLD bleibt geparkt, wenn der Stempel nicht gesetzt werden konnte', async () => {
    // Fail-safe: setDraftApprovalPending verweigert (z. B. weil doch noch ein
    // Claim steht). Wuerde der Parkplatz trotzdem geraeumt, waere das Urteil
    // weg und der weiterhin faellige Entwurf ginge beim naechsten Tick raus.
    mockSetDraftApprovalPending.mockReturnValue(false);
    const values: Record<string, string> = { 'scheduled_send_failures:99': '0' };
    syncInfo(values);
    mockSendComposeDraft.mockImplementation(async () => {
      values['scheduled_send_deferred_hold:99'] = 'bitte pruefen';
      return { ok: false, error: 'SMTP 550' };
    });

    await processDueScheduledSends(logger);

    expect(mockSetDraftApprovalPending).toHaveBeenCalledWith(99, 'bitte pruefen');
    expect(mockSetSyncInfo).not.toHaveBeenCalledWith('scheduled_send_deferred_hold:99', '');
  });

  test('erfolgreicher Versand verbraucht das geparkte HOLD ohne es anzuwenden', async () => {
    // Das HOLD entsteht WAEHREND des Versands — genau der Fall, fuer den der
    // Parkplatz da ist. Ein vorher liegendes HOLD verhindert den Versand (Test
    // darunter), deshalb wird es hier erst im SMTP-Aufruf gesetzt.
    const values: Record<string, string> = { 'scheduled_send_failures:99': '0' };
    syncInfo(values);
    mockSendComposeDraft.mockImplementation(async () => {
      values['scheduled_send_deferred_hold:99'] = 'zu spaet';
      return { ok: true };
    });

    await processDueScheduledSends(logger);

    expect(mockSetDraftApprovalPending).not.toHaveBeenCalled();
    expect(mockSetSyncInfo).toHaveBeenCalledWith('scheduled_send_deferred_hold:99', '');
  });

  test('HOLD aus abgestuerztem Vorlauf verhindert den Versand', async () => {
    // App weg zwischen Parken und Anwenden: Claim, HOLD und Versandzeitpunkt
    // ueberleben. Der Boot-Sweep raeumt nur den Claim ab — ohne diese Pruefung
    // ginge genau der Entwurf raus, den die Gegenlese-KI halten wollte.
    syncInfo({
      'scheduled_send_failures:99': '0',
      'scheduled_send_deferred_hold:99': 'Gegenlese-KI: bitte pruefen',
    });

    const sent = await processDueScheduledSends(logger);

    expect(sent).toBe(0);
    expect(mockSendComposeDraft).not.toHaveBeenCalled();
    expect(mockSetDraftApprovalPending).toHaveBeenCalledWith(99, 'Gegenlese-KI: bitte pruefen');
  });

  test('belegter Compose-Lock verbraucht das geparkte HOLD nicht', async () => {
    // „Versand laeuft bereits" beweist keine Zustellung. Scheitert der parallele
    // Versand, muss das HOLD beim naechsten faelligen Durchlauf noch da sein.
    const values: Record<string, string> = { 'scheduled_send_failures:99': '0' };
    syncInfo(values);
    mockSendComposeDraft.mockImplementation(async () => {
      values['scheduled_send_deferred_hold:99'] = 'zu spaet';
      return { ok: false, error: 'Versand laeuft bereits fuer diesen Entwurf.' };
    });

    await processDueScheduledSends(logger);

    expect(mockSetDraftApprovalPending).not.toHaveBeenCalled();
    expect(mockSetSyncInfo).not.toHaveBeenCalledWith('scheduled_send_deferred_hold:99', '');
  });
});
