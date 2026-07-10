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

/** Letzten Treffer eines zeilen-verankerten Musters nehmen. */
function lastMatch(re: RegExp, text: string): RegExpExecArray | null {
  let match: RegExpExecArray | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) match = m;
  return match;
}

export function parseDraftReviewResponse(raw: string): DraftReviewVerdict {
  const text = String(raw ?? '').trim();
  // Zeilen-verankert (^…$) und LETZTER Treffer gewinnt: Modelle zitieren gern
  // die Format-Anweisung ("STATUS: SEND oder HOLD") vor der echten Antwort —
  // ein Substring-Match darauf würde fail-OPEN in Richtung Senden kippen.
  const statusMatch = lastMatch(/^\s*status\s*:\s*(send|hold|senden|halten)\s*$/gim, text);
  const answeredMatch = lastMatch(/^\s*answered\s*:\s*(yes|no|ja|nein)\s*$/gim, text);
  const reasonMatch = lastMatch(/^\s*reason\s*:\s*(.+)$/gim, text);

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

  // SEND nur mit explizitem ANSWERED: yes — eine fehlende ANSWERED-Zeile ist
  // eine unvollständige Antwort und darf nicht fail-open Richtung Senden kippen.
  if (send && !answeredMatch) {
    return {
      verdict: 'hold',
      answered: false,
      reason: reason || 'Antwort der Prüf-KI unvollständig (ANSWERED fehlt)',
      parsed: false,
    };
  }

  // SEND ohne beantwortete Kundenfrage ist widersprüchlich → fail-safe hold.
  if (send && !answered) {
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
