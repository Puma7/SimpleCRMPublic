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

  test('Claim eines FREMDEN Prozesses laeuft ab (Absturz im SMTP-Call)', () => {
    // Nach einem Absturz startet die App mit neuem Token; der liegengebliebene
    // Claim ist fremd und darf den Entwurf nicht dauerhaft blockieren.
    const start = new Date('2026-07-27T10:00:00.000Z');
    store.set('scheduled_send_claimed_at:7', `${start.toISOString()}|fremder-prozess`);
    const stillFresh = new Date(start.getTime() + STALE_CLAIM_MS - 1000);
    expect(scheduledSendIsClaimed(7, stillFresh)).toBe(true);
    const expired = new Date(start.getTime() + STALE_CLAIM_MS + 1000);
    expect(scheduledSendIsClaimed(7, expired)).toBe(false);
    expect(claimScheduledSend(7, expired)).toBe(true);
  });

  test('eigener Claim verfaellt nicht nach STALE_CLAIM_MS', () => {
    // Ein IMAP-APPEND darf laenger dauern als die Ablauffrist: bis zu 12 Minuten
    // Socket-Timeout je Sent-Ordner-Kandidat, mehrere Kandidaten. Verfiele der
    // Claim mittendrin, koennte die Gegenpruefung eine bereits versendete Mail
    // wieder als freigabepflichtig stempeln.
    const start = new Date('2026-07-27T10:00:00.000Z');
    expect(claimScheduledSend(7, start)).toBe(true);
    const wayPastTtl = new Date(start.getTime() + STALE_CLAIM_MS * 3);
    expect(scheduledSendIsClaimed(7, wayPastTtl)).toBe(true);
    expect(claimScheduledSend(7, wayPastTtl)).toBe(false);
  });

  test('auch ein eigener Claim hat eine absolute Obergrenze', () => {
    // Fiele der finally-Block einmal aus, darf der Entwurf nicht fuer die
    // restliche Prozesslaufzeit gesperrt bleiben.
    const start = new Date('2026-07-27T10:00:00.000Z');
    claimScheduledSend(7, start);
    const afterHours = new Date(start.getTime() + 3 * 60 * 60_000);
    expect(scheduledSendIsClaimed(7, afterHours)).toBe(false);
  });

  test('fremde sync_info-Werte zaehlen nicht als Claim', () => {
    // Der Schluesselraum wird geteilt; nur ein gueltiger Zeitstempel zaehlt.
    store.set('scheduled_send_claimed_at:7', '0');
    expect(scheduledSendIsClaimed(7)).toBe(false);
    store.set('scheduled_send_claimed_at:7', 'irgendwas');
    expect(scheduledSendIsClaimed(7)).toBe(false);
  });
});
