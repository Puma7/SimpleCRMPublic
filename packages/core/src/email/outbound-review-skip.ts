/**
 * „Ohne Ausgangsprüfung senden“ (Teilautomatisierung P2): Ein angehaltener
 * Entwurf geht ohne erneuten Durchlauf der Ausgangs-Workflows raus. Wer das
 * darf, legt die Einstellung `outbound_review_skip_policy` fest; beide
 * Editionen setzen sie serverseitig bzw. im Main-Prozess durch. Das gilt nur
 * für den unveränderten, angehaltenen Inhalt (Fingerprint beim Anhalten).
 */
import { stripOutboundWarningFromHtml, stripOutboundWarningFromPlain } from './outbound-review-parse';
import { decodeHtmlEntities, plainTextFromHtml } from './parse-utils';
import { draftRecipientAddresses, htmlLinkTargets } from './sent-provenance';

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

export const OUTBOUND_REVIEW_SKIP_CHANGED_MESSAGE =
  'Der Entwurf wurde nach dem Anhalten geändert. Bitte normal senden – die Ausgangsprüfung prüft dann den neuen Inhalt.';

/**
 * sync_info-Schlüssel: Fingerprint des Inhalts, den der Ausgang endgültig
 * angehalten hat. „Ohne Ausgangsprüfung senden“ ist nur erlaubt, solange der
 * aktuelle Inhalt denselben Fingerprint hat; fehlt er (Altbestand), wie bei
 * einer Änderung.
 */
export const OUTBOUND_HOLD_FINGERPRINT_PREFIX = 'outbound_hold_fingerprint:';

export function outboundHoldFingerprintKey(draftId: number): string {
  return `${OUTBOUND_HOLD_FINGERPRINT_PREFIX}${draftId}`;
}

/** Inhalt eines Entwurfs, wie gespeichert (Empfänger/Anhänge als JSON oder Liste). */
export type OutboundHoldContentInput = {
  /**
   * Absenderkonto. Gehört zum angehaltenen Stand: Nach einem Kontowechsel
   * ginge derselbe Text über eine andere Absender-Identität raus, die die
   * Ausgangsprüfung nie gesehen hat.
   */
  accountId?: unknown;
  subject?: string | null;
  bodyText?: string | null;
  bodyHtml?: string | null;
  to?: unknown;
  cc?: unknown;
  bcc?: unknown;
  /** draft_attachment_paths_json (Text/JSON) oder Pfadliste. */
  attachments?: unknown;
};

/** Normalisierte Felder in der Form von outboundDraftFingerprint. */
export type OutboundHoldContent = {
  accountId: string;
  subject: string;
  bodyText: string;
  bodyHtml: string;
  to: string;
  cc: string;
  bcc: string;
  attachmentPaths: string[];
};

/**
 * Was der Empfänger sieht, ohne Formatierungsrauschen: Das Entwurfsfenster
 * speichert beim Öffnen alle Felder und formt dabei HTML um (Hinweis-Block
 * wird Absatz, Entitäten, Umbrüche). Ignoriert werden daher der Hinweis
 * „Versand blockiert“, Leerraum und HTML-Auszeichnung; verglichen werden
 * Betreff, Textteil, Text des HTML-Teils, Link- und Bildziele, Empfänger-
 * Adressen und Anhänge. Beide Teile zählen: auch eine Änderung nur am
 * Textteil oder nur an einem Link-Ziel ist eine Änderung.
 */
export function normalizeOutboundHoldContent(input: OutboundHoldContentInput): OutboundHoldContent {
  const html = stripOutboundWarningFromHtml(String(input.bodyHtml ?? ''));
  return {
    accountId: String(input.accountId ?? '').trim(),
    subject: collapseWhitespace(String(input.subject ?? '')),
    bodyText: normalizedText(stripOutboundWarningFromPlain(String(input.bodyText ?? ''))),
    bodyHtml: JSON.stringify({
      text: normalizedText(stripOutboundWarningFromPlain(plainTextFromHtml(html))),
      links: htmlLinkTargets(html),
    }),
    to: draftRecipientAddresses(input.to).join(', '),
    cc: draftRecipientAddresses(input.cc).join(', '),
    bcc: draftRecipientAddresses(input.bcc).join(', '),
    attachmentPaths: attachmentPathList(input.attachments),
  };
}

/** Gleicher angehaltener Inhalt? (Oberfläche: Knopf nur bei unverändertem Inhalt.) */
export function outboundHoldContentEquals(a: OutboundHoldContentInput, b: OutboundHoldContentInput): boolean {
  return JSON.stringify(normalizeOutboundHoldContent(a)) === JSON.stringify(normalizeOutboundHoldContent(b));
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function normalizedText(value: string): string {
  return collapseWhitespace(decodeHtmlEntities(value));
}

function attachmentPathList(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof value === 'string') {
    if (!value.trim()) return [];
    try {
      parsed = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!Array.isArray(parsed)) return [];
  const paths = new Set<string>();
  for (const item of parsed) {
    const path = typeof item === 'string'
      ? item.trim()
      : item && typeof item === 'object'
        ? String((item as { path?: unknown }).path ?? '').trim()
        : '';
    if (path) paths.add(path);
  }
  return [...paths].sort();
}
