/**
 * Parser für die Antwort der Gegenlese-KI (ai.review_draft).
 * Erwartetes Format:
 *   STATUS: SEND | HOLD
 *   ANSWERED: yes | no
 *   REASON: kurze deutsche Begründung
 * Fail-safe: alles Unklare wird als HOLD gewertet (Mensch prüft).
 */

export type DraftReviewVerdict = {
  verdict: 'send' | 'hold';
  answered: boolean;
  reason: string;
  /** False, wenn die Antwort nicht dem Format entsprach (⇒ hold). */
  parsed: boolean;
};

export function parseDraftReviewResponse(raw: string): DraftReviewVerdict {
  const text = String(raw ?? '').trim();
  const statusMatch = /status\s*:\s*(send|hold|senden|halten)/i.exec(text);
  const answeredMatch = /answered\s*:\s*(yes|no|ja|nein)/i.exec(text);
  const reasonMatch = /reason\s*:\s*(.+)/i.exec(text);

  const reason = (reasonMatch?.[1] ?? '').split('\n')[0]!.trim().slice(0, 300);

  if (!statusMatch) {
    return {
      verdict: 'hold',
      answered: false,
      reason: reason || 'Antwort der Prüf-KI nicht auswertbar',
      parsed: false,
    };
  }

  const statusRaw = statusMatch[1]!.toLowerCase();
  const send = statusRaw === 'send' || statusRaw === 'senden';
  const answeredRaw = (answeredMatch?.[1] ?? '').toLowerCase();
  const answered = answeredRaw === 'yes' || answeredRaw === 'ja';

  // SEND ohne beantwortete Kundenfrage ist widersprüchlich → fail-safe hold.
  if (send && answeredMatch && !answered) {
    return {
      verdict: 'hold',
      answered: false,
      reason: reason || 'KI meldet SEND, aber Frage laut KI nicht beantwortet',
      parsed: true,
    };
  }

  return {
    verdict: send ? 'send' : 'hold',
    answered,
    reason,
    parsed: true,
  };
}
