/**
 * Erkennung automatisch erzeugter eingehender Mails (RFC 3834 & Co.).
 * Auf solche Mails darf NIE automatisch geantwortet werden — sonst drohen
 * Mail-Loops zwischen zwei Automaten. Genutzt von der Urlaubs-Antwort und
 * vom Auto-Antwort-Gate (email.auto_reply).
 */

/** True, wenn die Roh-Header die Mail als automatisch erzeugt ausweisen. */
export function isAutomatedInboundMessage(rawHeaders: string | null | undefined): boolean {
  const headers = (rawHeaders ?? '').toLowerCase();
  if (!headers) return false;
  return (
    headers.includes('auto-submitted:') ||
    headers.includes('x-auto-response-suppress:') ||
    headers.includes('precedence: bulk') ||
    headers.includes('precedence: junk')
  );
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
