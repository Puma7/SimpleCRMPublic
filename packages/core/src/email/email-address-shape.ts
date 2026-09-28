/**
 * Lineare Gegenstücke zu Adress-Regexen, die bei präparierten Eingaben
 * polynomial zurückspringen (CodeQL „Polynomial regular expression used on
 * uncontrolled data“). Jede Funktion liefert genau das Ergebnis des genannten
 * Musters; tests/unit/email-address-shape.test.ts vergleicht sie damit.
 */

/** Zeilenenden, die `.` in einem Regex ohne `s`-Flag nicht trifft. */
const LINE_TERMINATORS = '\n\r  ';

/**
 * Wie `/<([^>]+)>/` (erster Treffer, Gruppe 1), aber linear: das Regex liest
 * bei vielen `<` ohne `>` ab jedem `<` bis zum Textende.
 */
export function firstAngleBracketContent(value: string): string | null {
  let open = value.indexOf('<');
  while (open >= 0) {
    const close = value.indexOf('>', open + 1);
    if (close < 0) return null;
    if (close > open + 1) return value.slice(open + 1, close);
    open = value.indexOf('<', open + 1);
  }
  return null;
}

/**
 * Wie `/^(.+)<([^>]+)>$/` (Gruppe 2: „Name <adresse>“ am Ende), aber linear:
 * das gierige `(.+)` probiert sonst jedes `<` einzeln und läuft von dort bis
 * zum Ende. Gewählt wird wie beim Regex das letzte passende `<`.
 */
export function trailingAngleBracketContent(value: string): string | null {
  const end = value.length - 1;
  if (end < 2 || value[end] !== '>') return null;
  // Zwischen `<` und dem schließenden `>` darf kein weiteres `>` stehen …
  const lowest = Math.max(1, value.lastIndexOf('>', end - 1) + 1);
  // … und vor dem `<` kein Zeilenende (`.` trifft es nicht).
  let highest = end - 2;
  for (let i = 0; i < value.length && i <= highest; i += 1) {
    if (LINE_TERMINATORS.includes(value[i]!)) {
      highest = i - 1;
      break;
    }
  }
  for (let open = highest; open >= lowest; open -= 1) {
    if (value[open] === '<') return value.slice(open + 1, end);
  }
  return null;
}

/**
 * Wie `^[^\s@X]+@[^\s@X]+\.[^\s@X]+$` (X = `forbiddenChars`), aber linear:
 * im Regex überlappen sich Domain-Teil und `\.` und laufen bei vielen Punkten
 * ohne passendes Ende polynomial.
 */
export function hasSimpleEmailShape(value: string, forbiddenChars = ''): boolean {
  const at = value.indexOf('@');
  if (at <= 0 || at !== value.lastIndexOf('@')) return false;
  for (const char of value) {
    if (char !== '@' && (forbiddenChars.includes(char) || /\s/.test(char))) return false;
  }
  const domain = value.slice(at + 1);
  return domain.length >= 3 && domain.slice(1, -1).includes('.');
}
