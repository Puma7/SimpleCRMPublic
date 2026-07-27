/**
 * Verhaltenstests für den Desktop-Versand-Claim: er ist das Signal, an dem sich
 * die Gegenlese-KI mit einem laufenden SMTP-Aufruf serialisiert.
 */
const store = new Map<string, string>();

jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: (key: string) => store.get(key) ?? null,
  setSyncInfo: (key: string, value: string) => {
    if (value === '') store.delete(key);
    else store.set(key, value);
  },
}));

import {
  STALE_CLAIM_MS,
  claimScheduledSend,
  releaseScheduledSendClaim,
  scheduledSendIsClaimed,
} from '../../electron/email/email-scheduled-send-claim';

describe('desktop scheduled-send claim', () => {
  beforeEach(() => store.clear());

  test('claimt einmal und sperrt danach', () => {
    expect(scheduledSendIsClaimed(7)).toBe(false);
    expect(claimScheduledSend(7)).toBe(true);
    expect(scheduledSendIsClaimed(7)).toBe(true);
    // Zweiter Durchlauf darf denselben Entwurf nicht parallel senden.
    expect(claimScheduledSend(7)).toBe(false);
  });

  test('nach Freigabe wieder claimbar', () => {
    claimScheduledSend(7);
    releaseScheduledSendClaim(7);
    expect(scheduledSendIsClaimed(7)).toBe(false);
    expect(claimScheduledSend(7)).toBe(true);
  });

  test('Claims sind pro Entwurf getrennt', () => {
    claimScheduledSend(7);
    expect(scheduledSendIsClaimed(8)).toBe(false);
    expect(claimScheduledSend(8)).toBe(true);
  });

  test('abgelaufener Claim blockiert nicht dauerhaft (Absturz im SMTP-Call)', () => {
    const start = new Date('2026-07-27T10:00:00.000Z');
    claimScheduledSend(7, start);
    const stillFresh = new Date(start.getTime() + STALE_CLAIM_MS - 1000);
    expect(scheduledSendIsClaimed(7, stillFresh)).toBe(true);
    const expired = new Date(start.getTime() + STALE_CLAIM_MS + 1000);
    expect(scheduledSendIsClaimed(7, expired)).toBe(false);
    expect(claimScheduledSend(7, expired)).toBe(true);
  });

  test('fremde sync_info-Werte zaehlen nicht als Claim', () => {
    // Der Schluesselraum wird geteilt; nur ein gueltiger Zeitstempel zaehlt.
    store.set('scheduled_send_claimed_at:7', '0');
    expect(scheduledSendIsClaimed(7)).toBe(false);
    store.set('scheduled_send_claimed_at:7', 'irgendwas');
    expect(scheduledSendIsClaimed(7)).toBe(false);
  });
});
