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
    mockSendComposeDraft.mockResolvedValue({ ok: false, error: 'SMTP 550' });
    syncInfo({
      'scheduled_send_failures:99': '0',
      'scheduled_send_deferred_hold:99': 'Gegenlese-KI empfiehlt menschliche Pruefung',
    });

    await processDueScheduledSends(logger);

    expect(mockSetDraftApprovalPending).toHaveBeenCalledWith(
      99,
      'Gegenlese-KI empfiehlt menschliche Pruefung',
    );
    // Der Parkplatz wird dabei verbraucht.
    expect(mockSetSyncInfo).toHaveBeenCalledWith('scheduled_send_deferred_hold:99', '');
  });

  test('erfolgreicher Versand verbraucht das geparkte HOLD ohne es anzuwenden', async () => {
    mockSendComposeDraft.mockResolvedValue({ ok: true });
    syncInfo({
      'scheduled_send_failures:99': '0',
      'scheduled_send_deferred_hold:99': 'zu spaet',
    });

    await processDueScheduledSends(logger);

    expect(mockSetDraftApprovalPending).not.toHaveBeenCalled();
    expect(mockSetSyncInfo).toHaveBeenCalledWith('scheduled_send_deferred_hold:99', '');
  });
});
