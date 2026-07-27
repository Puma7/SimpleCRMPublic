/**
 * Parser für die Antwort der Gegenlese-KI (ai.review_draft).
 * Fail-safe: alles Unklare wird als HOLD gewertet (Mensch prüft).
 */

export type DraftReviewVerdict = {
  verdict: 'send' | 'hold';
  answered: boolean;
  reason: string;
  /** False, wenn die Antwort nicht dem Format entsprach (⇒ hold). */
  parsed: boolean;
};

function lastMatch(re: RegExp, text: string): RegExpExecArray | null {
  let match: RegExpExecArray | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) match = m;
  return match;
}

/**
 * Alle Treffer einer zeilenverankerten Regex — mehrdeutige Antworten sollen
 * erkennbar sein, statt dass der letzte Treffer stillschweigend gewinnt.
 */
function allMatches(re: RegExp, text: string): RegExpExecArray[] {
  const out: RegExpExecArray[] = [];
  for (let m = re.exec(text); m; m = re.exec(text)) out.push(m);
  return out;
}

export function parseDraftReviewResponse(raw: string): DraftReviewVerdict {
  const text = String(raw ?? '').trim();
  const statusMatches = allMatches(/^\s*status\s*:\s*(send|hold|senden|halten)\s*$/gim, text);
  const answeredMatches = allMatches(/^\s*answered\s*:\s*(yes|no|ja|nein)\s*$/gim, text);
  const statusMatch = statusMatches.length === 1 ? statusMatches[0]! : null;
  const answeredMatch = answeredMatches.length === 1 ? answeredMatches[0]! : null;
  const reasonMatch = lastMatch(/^\s*reason\s*:\s*(.+)$/gim, text);

  const reason = (reasonMatch?.[1] ?? '').split('\n')[0]!.trim().slice(0, 300);

  // Fail-closed bei Mehrdeutigkeit: eine Modell- oder prompt-injizierte Antwort
  // mit „STATUS: HOLD … STATUS: SEND" darf den automatischen Versand nicht
  // freigeben. Gleiche Härtung wie parseOutboundReviewResponse.
  if (statusMatches.length > 1 || answeredMatches.length > 1) {
    return {
      verdict: 'hold',
      answered: false,
      reason: reason || 'Antwort der Prüf-KI mehrdeutig (mehrere STATUS/ANSWERED-Zeilen)',
      parsed: false,
    };
  }

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

  if (send && !answeredMatch) {
    return {
      verdict: 'hold',
      answered: false,
      reason: reason || 'Antwort der Prüf-KI unvollständig (ANSWERED fehlt)',
      parsed: false,
    };
  }

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
