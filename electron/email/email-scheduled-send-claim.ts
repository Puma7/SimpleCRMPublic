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
 * Der Wert ist `<ISO-Zeitstempel>|<Prozess-Token>`. Ein FREMDER Claim läuft nach
 * `STALE_CLAIM_MS` ab — so blockiert ein Absturz mitten im SMTP-Aufruf den
 * Entwurf nicht dauerhaft, auch wenn der Boot-Sweep nicht lief. Ein Claim des
 * EIGENEN Prozesses gehört dagegen zu einem nachweislich laufenden Versand und
 * darf nicht nach fester Zeit verfallen (siehe `claimIsActive`). Werte, die kein
 * gültiger Zeitstempel sind, zählen nicht als Claim — der Schlüsselraum
 * sync_info wird von vielen Features geteilt.
 */
import { randomUUID } from 'node:crypto';

import { scheduledSendClaimedAtKey, SCHEDULED_SEND_CLAIMED_AT_PREFIX } from '@simplecrm/core';

import { getDb, getSyncInfo, setSyncInfo } from '../sqlite-service';

/** Nach dieser Zeit gilt ein FREMDER Claim als verwaist (Absturz im SMTP-Call). */
export const STALE_CLAIM_MS = 15 * 60_000;

/**
 * Absolute Obergrenze auch für eigene Claims.
 *
 * Der `finally`-Block der Sendeschleife gibt jeden Claim frei, auch im
 * Fehlerfall. Sollte er dennoch einmal ausfallen, darf ein Entwurf nicht für
 * die restliche Prozesslaufzeit gesperrt bleiben — die Grenze liegt bewusst weit
 * jenseits jedes realistischen Versands.
 */
const OWN_CLAIM_MAX_MS = 2 * 60 * 60_000;

/**
 * Identität dieses Prozesses. Ein Claim mit diesem Token gehört zu einem HIER
 * laufenden `sendComposeDraft` — unabhängig davon, wie alt er ist.
 */
const PROCESS_TOKEN = randomUUID();

function parseClaim(value: string | null | undefined): { claimedAt: number; token: string } | null {
  const raw = String(value ?? '');
  const separator = raw.indexOf('|');
  const stamp = separator === -1 ? raw : raw.slice(0, separator);
  const claimedAt = Date.parse(stamp);
  if (!Number.isFinite(claimedAt)) return null;
  return { claimedAt, token: separator === -1 ? '' : raw.slice(separator + 1) };
}

function claimIsActive(value: string | null | undefined, now: Date): boolean {
  const parsed = parseClaim(value);
  if (!parsed) return false;
  const age = now.getTime() - parsed.claimedAt;
  if (age < 0) return false;
  // Eigener Prozess: NICHT nach STALE_CLAIM_MS verfallen lassen. Ein Versand
  // kann legitim länger dauern — `imapTimeoutsForMessageBytes` erlaubt bis zu
  // 12 Minuten Socket-Timeout je Sent-Ordner-Kandidat, und es werden mehrere
  // Kandidaten probiert. Verfiele der Claim mittendrin, könnte eine parallel
  // endende Gegenprüfung eine bereits versendete Mail wieder als
  // freigabepflichtig stempeln.
  if (parsed.token && parsed.token === PROCESS_TOKEN) return age < OWN_CLAIM_MAX_MS;
  // Fremder oder tokenloser Claim (anderer Prozess, anderes Fenster, Altbestand):
  // dessen Lebendigkeit können wir nur über das Alter schätzen.
  return age < STALE_CLAIM_MS;
}

/** Läuft für diesen Entwurf gerade ein Versand? */
export function scheduledSendIsClaimed(draftId: number, now: Date = new Date()): boolean {
  return claimIsActive(getSyncInfo(scheduledSendClaimedAtKey(draftId)), now);
}

/** Claim setzen. false ⇒ ein anderer Durchlauf sendet diesen Entwurf bereits. */
export function claimScheduledSend(draftId: number, now: Date = new Date()): boolean {
  if (scheduledSendIsClaimed(draftId, now)) return false;
  setSyncInfo(scheduledSendClaimedAtKey(draftId), `${now.toISOString()}|${PROCESS_TOKEN}`);
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

/**
 * Geparktes HOLD lesen, OHNE es zu verbrauchen.
 *
 * Bewusst nicht-destruktiv: würde der Parkplatz schon beim Lesen geleert und
 * der Prozess stürzte vor `setDraftApprovalPending` ab, wäre danach weder das
 * HOLD noch `approval_state='pending'` vorhanden — und der weiterhin fällige
 * Entwurf ginge beim nächsten Durchlauf raus. Erst {@link clearDeferredSendHold}
 * aufrufen, wenn das Urteil auf dem Entwurf steht.
 */
export function peekDeferredSendHold(draftId: number): string | null {
  return getSyncInfo(deferredHoldKey(draftId)) || null;
}

/** Parkplatz räumen — nachdem das HOLD angewendet oder gegenstandslos wurde. */
export function clearDeferredSendHold(draftId: number): void {
  setSyncInfo(deferredHoldKey(draftId), '');
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
  const rows = getDb()
    .prepare(`SELECT key FROM sync_info WHERE key LIKE ?`)
    .all(`${SCHEDULED_SEND_CLAIMED_AT_PREFIX}%`) as { key: string }[];
  for (const row of rows) {
    getDb().prepare(`DELETE FROM sync_info WHERE key = ?`).run(row.key);
  }
  // Erst nach vollstaendigem Sweep verbrauchen. Wirft SELECT oder DELETE
  // (der Aufrufer faengt das im Startup-Catch), muss ein spaeterer Start der
  // Hintergrunddienste noch einmal aufraeumen duerfen — sonst blieben verwaiste
  // Claims bis zum Ablauf von STALE_CLAIM_MS liegen und blockierten faellige
  // Entwuerfe. Der Sweep ist idempotent, ein zweiter Lauf schadet nicht.
  bootSweepDone = true;
  return rows.length;
}
