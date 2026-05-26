/** Map low-level fetch/Abort errors to user-facing German messages. */

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return String(err);
}

function isAbortOrTimeout(err: unknown, msg: string): boolean {
  const lower = msg.toLowerCase();
  if (lower.includes('operation was aborted')) return true;
  if (lower.includes('the operation was aborted')) return true;
  if (lower.includes('aborterror')) return true;
  if (lower.includes('timed out') || lower.includes('timeout')) return true;
  if (err instanceof DOMException && err.name === 'TimeoutError') return true;
  if (err instanceof Error && err.name === 'AbortError') return true;
  return false;
}

/** Format stored or fresh AI errors for UI and reply_suggestion_error. */
export function formatAiUserError(err: unknown): string {
  const msg = errorMessage(err).trim();
  if (!msg) return 'KI-Anfrage fehlgeschlagen';

  if (isAbortOrTimeout(err, msg)) {
    return (
      'KI-Anfrage abgebrochen oder Zeitlimit (90 Sekunden) überschritten. ' +
      'Bitte erneut versuchen oder die Nachricht erneut öffnen und „Antwort entwerfen“ wählen.'
    );
  }

  if (/fetch failed|network|econnrefused|enotfound|socket hang up/i.test(msg)) {
    return `Netzwerkfehler bei der KI-Anfrage: ${msg}`;
  }

  return msg;
}
