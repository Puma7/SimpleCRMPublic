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

const DEFERRED_HOLD_PREFIX = 'scheduled_send_deferred_hold:';

function deferredHoldKey(draftId: number): string {
  return `${DEFERRED_HOLD_PREFIX}${draftId}`;
}

/**
 * Die Gegenlese-KI wollte den Entwurf zurückhalten, kam aber zu spät: der
 * Versand lief schon. Der Stempel „Wartet auf Freigabe" wäre jetzt gelogen —
 * also wird das Urteil hier geparkt statt verworfen.
 *
 * Ohne diesen Parkplatz wäre ein HOLD endgültig weg, sobald ein Claim stand.
 * Scheitert der SMTP-Aufruf danach (kein Empfänger, Auth, Netz), bliebe ein
 * Entwurf zurück, den die KI ausdrücklich nicht freigegeben hat, der aber wie
 * jeder andere Entwurf beim nächsten fälligen Durchlauf erneut versendet würde.
 *
 * Der Parkplatz überlebt einen Absturz absichtlich: `processDueScheduledSends`
 * liest ihn zu Beginn jedes Versuchs und wendet ein liegengebliebenes HOLD an,
 * statt zu senden. Der Boot-Sweep unten darf ihn deshalb NICHT mitlöschen — er
 * räumt nur Claims ab.
 */
export function deferHoldDuringSend(draftId: number, reason: string): void {
  setSyncInfo(deferredHoldKey(draftId), reason.slice(0, 500) || 'Gegenlese-KI empfiehlt menschliche Prüfung');
}

/** Geparktes HOLD auslesen und verbrauchen (auch wenn es verfällt). */
export function takeDeferredSendHold(draftId: number): string | null {
  const reason = getSyncInfo(deferredHoldKey(draftId));
  if (!reason) return null;
  setSyncInfo(deferredHoldKey(draftId), '');
  return reason;
}

/** Nur der erste Aufruf in diesem Prozess ist ein echter Boot. */
let bootSweepDone = false;

/**
 * Beim App-Start: ALLE Versand-Claims aufräumen.
 *
 * Der Claim gilt nur innerhalb eines laufenden Prozesses — er wird gesetzt,
 * bevor `sendComposeDraft` losläuft, und im `finally` desselben Aufrufs wieder
 * freigegeben. Läuft die App neu an, kann per Definition kein Claim mehr zu
 * einem laufenden SMTP-Aufruf gehören: der Prozess, der ihn hielt, existiert
 * nicht mehr. Ein Alterstest wäre hier also falsch — ein Claim, der 30 Sekunden
 * vor dem Absturz gesetzt wurde, ist genauso tot wie einer von gestern, würde
 * aber überleben und den Entwurf bis zum Ablauf von `STALE_CLAIM_MS` blockieren.
 * Der Ablauf bleibt trotzdem als zweite Sicherung bestehen (Absturz ohne
 * Neustart, mehrere Fenster auf derselben Datenbank).
 *
 * Genau deshalb greift der Sweep NUR beim ersten Aufruf im Prozess.
 * `startEmailBackgroundServices` läuft auch im laufenden Prozess erneut
 * (Reparatur, Restore-Fehlerbehandlung), und `stopEmailBackgroundServices`
 * wartet einen bereits laufenden Versand nicht ab — dort gehört ein Claim noch
 * zu einem aktiven SMTP-Aufruf. Würde er gelöscht, könnte eine gleichzeitig
 * endende Gegenprüfung den Entwurf auf „Wartet auf Freigabe" stempeln und
 * `scheduled_send_at` löschen, während die Mail rausgeht.
 */
export function releaseStaleScheduledSendClaims(): number {
  if (bootSweepDone) return 0;
  bootSweepDone = true;
  const rows = getDb()
    .prepare(`SELECT key FROM sync_info WHERE key LIKE ?`)
    .all(`${SCHEDULED_SEND_CLAIMED_AT_PREFIX}%`) as { key: string }[];
  for (const row of rows) {
    getDb().prepare(`DELETE FROM sync_info WHERE key = ?`).run(row.key);
  }
  return rows.length;
}
