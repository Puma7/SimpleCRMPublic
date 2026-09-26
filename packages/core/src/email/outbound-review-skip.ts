/**
 * „Ohne Ausgangsprüfung senden“ (Teilautomatisierung P2): Ein angehaltener
 * Entwurf geht ohne erneuten Durchlauf der Ausgangs-Workflows raus. Wer das
 * darf, legt die Einstellung `outbound_review_skip_policy` fest; beide
 * Editionen setzen sie serverseitig bzw. im Main-Prozess durch.
 */

export const OUTBOUND_REVIEW_SKIP_POLICY_KEY = 'outbound_review_skip_policy';

export const OUTBOUND_REVIEW_SKIP_POLICIES = ['all', 'admins', 'none'] as const;

/** all = alle, die senden dürfen (Standard) · admins = nur Owner und Admin · none = niemand. */
export type OutboundReviewSkipPolicy = typeof OUTBOUND_REVIEW_SKIP_POLICIES[number];

export const DEFAULT_OUTBOUND_REVIEW_SKIP_POLICY: OutboundReviewSkipPolicy = 'all';

export function isOutboundReviewSkipPolicy(value: unknown): value is OutboundReviewSkipPolicy {
  return typeof value === 'string'
    && (OUTBOUND_REVIEW_SKIP_POLICIES as readonly string[]).includes(value);
}

/** Gespeicherter Wert → Richtlinie; unbekannt/leer ⇒ Standard „all“. */
export function parseOutboundReviewSkipPolicy(value: string | null | undefined): OutboundReviewSkipPolicy {
  const normalized = (value ?? '').trim().toLowerCase();
  return isOutboundReviewSkipPolicy(normalized) ? normalized : DEFAULT_OUTBOUND_REVIEW_SKIP_POLICY;
}

/**
 * Darf diese Rolle die Ausgangsprüfung überspringen? Senderechte am Entwurf
 * prüft der Aufrufer zusätzlich (Server: Mail-ACL, Desktop: Kontozugriff).
 */
export function outboundReviewSkipAllowedForRole(
  policy: OutboundReviewSkipPolicy,
  role: string | null | undefined,
): boolean {
  if (policy === 'none') return false;
  if (policy === 'admins') return role === 'owner' || role === 'admin';
  return true;
}

export const OUTBOUND_REVIEW_SKIP_FORBIDDEN_MESSAGE =
  'Ausgangsprüfung überspringen ist für Ihre Rolle nicht erlaubt (Einstellungen → Automatisierung).';

export const OUTBOUND_REVIEW_SKIP_NOT_HELD_MESSAGE =
  'Der Entwurf ist nicht vom Ausgang angehalten.';

/**
 * sync_info-Schlüssel: dieser Entwurf wurde „ohne Ausgangsprüfung“ freigegeben.
 * Der Wert ist der Freigabe-Marker (`outbound_review_approved:<id>`) zum
 * Zeitpunkt des Überspringens; nur solange beide übereinstimmen, gilt der
 * spätere Versand als „Ausgangsprüfung übersprungen“.
 */
export const OUTBOUND_REVIEW_SKIPPED_PREFIX = 'outbound_review_skipped:';

export function outboundReviewSkippedKey(draftId: number): string {
  return `${OUTBOUND_REVIEW_SKIPPED_PREFIX}${draftId}`;
}
