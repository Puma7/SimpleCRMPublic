/**
 * Erkennung automatisch erzeugter eingehender Mails (RFC 3834 & Co.).
 * Auf solche Mails darf NIE automatisch geantwortet werden — sonst drohen
 * Mail-Loops zwischen zwei Automaten. Genutzt von der Urlaubs-Antwort und
 * vom Auto-Antwort-Gate (email.auto_reply) — Desktop UND Server-Edition
 * (electron/email/email-automation-headers.ts re-exportiert von hier).
 */

/**
 * Header-Wert extrahieren (erste Vorkommnis), Parameter/Kommentare nach
 * ';' bzw. '(' abgeschnitten. Erwartet bereits lowercased Roh-Header.
 */
function headerValue(headers: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\r?\\n)${name}\\s*:\\s*([^\\r\\n]*)`).exec(headers);
  if (!m) return null;
  return m[1]!.split(';')[0]!.split('(')[0]!.trim();
}

/** True, wenn die Roh-Header die Mail als automatisch erzeugt ausweisen. */
export function isAutomatedInboundMessage(rawHeaders: string | null | undefined): boolean {
  const headers = (rawHeaders ?? '').toLowerCase();
  if (!headers) return false;
  // RFC 3834: "Auto-Submitted: no" markiert explizit eine MANUELL erzeugte
  // Mail — nur andere Werte (auto-generated, auto-replied, …) zählen als
  // Automat. Analog Microsoft: "X-Auto-Response-Suppress: None" unterdrückt
  // nichts und darf nicht blocken.
  const autoSubmitted = headerValue(headers, 'auto-submitted');
  if (autoSubmitted !== null && autoSubmitted !== '' && autoSubmitted !== 'no') return true;
  const suppress = headerValue(headers, 'x-auto-response-suppress');
  if (suppress !== null && suppress !== '' && suppress !== 'none') return true;
  // Wert-basiert (nicht Substring): tolerant gegen "Precedence:bulk" ohne
  // Leerzeichen; nur bulk/junk zählen, "Precedence: list" o. Ä. nicht.
  const precedence = headerValue(headers, 'precedence');
  return precedence === 'bulk' || precedence === 'junk';
}

/**
 * Strengere Variante für vollautomatische KI-Antworten: zusätzlich
 * Newsletter/Verteiler (List-Unsubscribe/List-Id) ausschließen.
 */
export function isUnsafeAutoReplyTarget(rawHeaders: string | null | undefined): boolean {
  if (isAutomatedInboundMessage(rawHeaders)) return true;
  const headers = (rawHeaders ?? '').toLowerCase();
  return headers.includes('list-unsubscribe:') || headers.includes('list-id:');
}
