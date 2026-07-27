/**
 * Versand-Claim für den Desktop-Scheduled-Send.
 *
 * Ohne Claim gibt es zwischen „Entwurf steht zum Versand an" und „SMTP ist
 * durch" kein Signal, an dem sich etwas anderes serialisieren könnte:
 * `processDueScheduledSends` liest die Zeile, ruft `sendComposeDraft` auf und
 * räumt `scheduled_send_at` erst danach ab. In diesem Fenster konnte die
 * Gegenlese-KI (`ai.review_draft`) den Entwurf auf „Wartet auf Freigabe"
 * stempeln und `scheduled_send_at` löschen — den bereits laufenden SMTP-Aufruf
 * stoppt das nicht, die Oberfläche behauptet aber das Gegenteil.
 *
 * Der Claim nutzt bewusst denselben sync_info-Schlüssel wie die Server-Edition
 * (`scheduledSendClaimedAtKey`, @simplecrm/core), damit beide Editionen dieselbe
 * Semantik haben.
 *
 * Der Wert ist ein ISO-Zeitstempel und der Claim läuft nach `STALE_CLAIM_MS`
 * von selbst ab. Damit blockiert ein Absturz mitten im SMTP-Aufruf den Entwurf
 * nicht dauerhaft, auch wenn der Boot-Sweep nicht lief. Werte, die kein
 * gültiger Zeitstempel sind, zählen nicht als Claim — der Schlüsselraum
 * sync_info wird von vielen Features geteilt.
 */
import { scheduledSendClaimedAtKey, SCHEDULED_SEND_CLAIMED_AT_PREFIX } from '@simplecrm/core';

import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';

/** Nach dieser Zeit gilt ein Claim als verwaist (Absturz mitten im SMTP-Call). */
export const STALE_CLAIM_MS = 15 * 60_000;

function activeClaimAge(value: string | null | undefined, now: Date): number | null {
  const claimedAt = Date.parse(String(value ?? ''));
  if (!Number.isFinite(claimedAt)) return null;
  const age = now.getTime() - claimedAt;
  return age >= 0 && age < STALE_CLAIM_MS ? age : null;
}

/** Läuft für diesen Entwurf gerade ein Versand? */
export function scheduledSendIsClaimed(draftId: number, now: Date = new Date()): boolean {
  return activeClaimAge(getSyncInfo(scheduledSendClaimedAtKey(draftId)), now) !== null;
}

/** Claim setzen. false ⇒ ein anderer Durchlauf sendet diesen Entwurf bereits. */
export function claimScheduledSend(draftId: number, now: Date = new Date()): boolean {
  if (scheduledSendIsClaimed(draftId, now)) return false;
  setSyncInfo(scheduledSendClaimedAtKey(draftId), now.toISOString());
  return true;
}

export function releaseScheduledSendClaim(draftId: number): void {
  setSyncInfo(scheduledSendClaimedAtKey(draftId), '');
}

/**
 * Beim App-Start: Claims aufräumen, deren Prozess den Versand nie beendet hat.
 * Der Ablauf über `STALE_CLAIM_MS` würde sie ohnehin entwerten; der Sweep hält
 * die sync_info-Tabelle zusätzlich sauber.
 */
export function releaseStaleScheduledSendClaims(now: Date = new Date()): number {
  const rows = getDb()
    .prepare(`SELECT key, value FROM sync_info WHERE key LIKE ?`)
    .all(`${SCHEDULED_SEND_CLAIMED_AT_PREFIX}%`) as { key: string; value: string | null }[];
  let released = 0;
  for (const row of rows) {
    if (activeClaimAge(row.value, now) !== null) continue;
    getDb().prepare(`DELETE FROM sync_info WHERE key = ?`).run(row.key);
    released += 1;
  }
  return released;
}
