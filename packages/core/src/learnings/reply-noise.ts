/**
 * Entfernt aus einer Antwort-Mail alles, was kein Inhalt ist: zitierte
 * Vorgänger-Mail, Signatur, Anrede am Anfang und Grußformel am Ende (TA-P5).
 * Arbeitet auf Klartext; HTML aus dem Compose-Dialog wird über die
 * Zonen-Marker (Spiegel von shared/compose-body.ts) zuerst zerlegt.
 */

/** Spiegel der Zonen-Marker aus shared/compose-body.ts (Test hält beide gleich). */
export const LEARNING_COMPOSE_QUOTE_MARKER = '<!-- simplecrm-quote -->';
export const LEARNING_COMPOSE_BODY_MARKER = '<!-- simplecrm-body -->';
export const LEARNING_COMPOSE_SIGNATURE_MARKER = '<!-- simplecrm-signature -->';

/** Zeilen, ab denen der Rest ein Zitat/eine weitergeleitete Mail ist. */
const QUOTE_HEADER_PATTERNS: readonly RegExp[] = [
  // „Am 12.03.2024 um 10:00 schrieb Max <max@x.de>:“ (auch über zwei Zeilen)
  /^[ \t]*Am [^\n]{3,200}?(?:\n[^\n]{0,200}?)?schrieb[^\n]{0,200}:[ \t]*$/im,
  /^[ \t]*Am [^\n]{3,200}?schrieb[^\n]{0,200}\n[^\n]{0,120}:[ \t]*$/im,
  /^[ \t]*On [^\n]{3,200}?(?:\n[^\n]{0,200}?)?wrote:[ \t]*$/im,
  /^[ \t]*Le [^\n]{3,200}?a écrit ?:[ \t]*$/im,
  /^[ \t]*-{2,}[ \t]*(?:Original(?:-?Nachricht)?|Original Message|Ursprüngliche Nachricht|Weitergeleitete Nachricht|Forwarded message|Nachricht im Original)[ \t]*-{2,}[ \t]*$/im,
  /^[ \t]*_{5,}[ \t]*\n(?=[ \t]*(?:Von|From):)/im,
  /^[ \t]*(?:Von|From):[^\n]+\n[ \t]*(?:Gesendet|Sent|Datum|Date):[^\n]+\n/im,
  /^[ \t]*-----BEGIN PGP /im,
];

const SIGNATURE_DELIMITER = /^--[ \t]?$/m;

const MOBILE_FOOTER = /^[ \t]*(?:Gesendet von meinem [^\n]{1,60}|Von meinem [^\n]{1,40} gesendet|Sent from my [^\n]{1,60}|Get Outlook for [^\n]{1,40}|Diese Nachricht wurde von meinem [^\n]{1,80} gesendet\.?)[ \t]*$/gim;

const GREETING_LINE = /^[ \t]*(?:Sehr geehrte[rs]?|Guten (?:Tag|Morgen|Abend)|Liebe[rs]?|Hallo|Hi|Hey|Moin(?: moin)?|Servus|Grüß Gott|Grüezi|Grüss Gott|Dear|Hello|Good (?:morning|afternoon|evening))(?![\p{L}])[^\n]{0,100}$/iu;

const CLOSING_LINE = /^[ \t]*(?:(?:Mit |Mit den )?(?:freundlichen|besten|herzlichen|lieben|schönen|sonnigen|kollegialen) Grüßen|(?:Mit |Mit den )?(?:freundlichen|besten|herzlichen|lieben|schönen) Grüssen|(?:Freundliche|Viele|Beste|Liebe|Herzliche|Schöne|Sonnige|Liebe) Grüße|(?:Freundliche|Viele|Beste|Liebe|Herzliche|Schöne) Grüsse|Grüße|Grüsse|Gruß|Gruss|MfG|mfg|LG|VG|BG|Beste Grüsse|Danke und Gruß|(?:Vielen )?Dank(?:e)?(?: und| &) (?:viele |beste |liebe )?Grüße|Best regards|Kind regards|Warm regards|Regards|Best wishes|Cheers|Sincerely|Yours sincerely|Yours truly|Many thanks|Thanks(?: and| &) (?:best )?regards)(?![\p{L}])[^\n]{0,60}$/iu;

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, '&');
}

/** Einfache HTML→Text-Umwandlung für Mail-Inhalte (keine Formatierung nötig). */
export function learningHtmlToText(html: string): string {
  return decodeBasicEntities(
    String(html ?? '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<(script|style|head)[^>]*>[\s\S]*?<\/\1>/gi, '')
      .replace(/<blockquote[^>]*>[\s\S]*?<\/blockquote>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function cutAtFirstMatch(text: string, patterns: readonly RegExp[]): string {
  let cut = text.length;
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  return text.slice(0, cut);
}

function stripClosing(lines: string[]): string[] {
  // Grußformel nur im letzten Drittel bzw. in den letzten zwölf Zeilen suchen,
  // damit ein „Grüße“ mitten im Text nicht den Inhalt abschneidet.
  const nonEmpty = lines.filter((line) => line.trim()).length;
  const window = Math.max(3, Math.min(12, Math.ceil(nonEmpty / 2)));
  let seen = 0;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (!lines[i]!.trim()) continue;
    seen += 1;
    if (seen > window) break;
    if (CLOSING_LINE.test(lines[i]!)) return lines.slice(0, i);
  }
  return lines;
}

function stripGreeting(lines: string[]): string[] {
  const first = lines.findIndex((line) => line.trim());
  if (first < 0) return lines;
  const line = lines[first]!;
  const trimmed = line.trim();
  // Nur echte Anredezeilen („Hallo Herr Müller,“), nicht „Hallo, die Rückgabe
  // ist innerhalb von 14 Tagen möglich.“
  const looksLikeGreeting = /[,!]$/.test(trimmed) || trimmed.split(/\s+/).length <= 4;
  if (trimmed.length <= 100 && looksLikeGreeting && GREETING_LINE.test(line)) {
    return lines.slice(first + 1);
  }
  return lines;
}

/**
 * Entfernt Zitat („Am … schrieb …:“, „-----Original-----“, „> “-Zeilen),
 * Signatur („-- “), Mobil-Fußzeilen, Anrede am Anfang und Grußformel am Ende.
 */
export function stripReplyNoise(text: string): string {
  let value = String(text ?? '').replace(/\r\n?/g, '\n');
  if (!value.trim()) return '';

  value = cutAtFirstMatch(value, QUOTE_HEADER_PATTERNS);
  const signature = SIGNATURE_DELIMITER.exec(value);
  if (signature) value = value.slice(0, signature.index);
  value = value.replace(MOBILE_FOOTER, '');

  let lines = value.split('\n').filter((line) => !/^[ \t]*>/.test(line));
  lines = stripGreeting(lines);
  lines = stripClosing(lines);

  return lines
    .join('\n')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Klartext der eigentlichen Antwort aus einer gesendeten Mail: nutzt die
 * Zonen-Marker im HTML (Anrede/Text/Signatur/Zitat), sonst den Klartext, und
 * entfernt danach das übrige Rauschen.
 */
export function extractLearningReplyText(input: { text?: string | null; html?: string | null }): string {
  const html = String(input.html ?? '');
  if (html.includes(LEARNING_COMPOSE_BODY_MARKER) || html.includes(LEARNING_COMPOSE_QUOTE_MARKER)
    || html.includes(LEARNING_COMPOSE_SIGNATURE_MARKER)) {
    let editable = html;
    const quoteIdx = editable.indexOf(LEARNING_COMPOSE_QUOTE_MARKER);
    if (quoteIdx >= 0) editable = editable.slice(0, quoteIdx);
    const sigIdx = editable.indexOf(LEARNING_COMPOSE_SIGNATURE_MARKER);
    if (sigIdx >= 0) editable = editable.slice(0, sigIdx);
    const bodyIdx = editable.indexOf(LEARNING_COMPOSE_BODY_MARKER);
    if (bodyIdx >= 0) editable = editable.slice(bodyIdx + LEARNING_COMPOSE_BODY_MARKER.length);
    return stripReplyNoise(learningHtmlToText(editable));
  }
  const text = String(input.text ?? '');
  if (text.trim()) return stripReplyNoise(text);
  return stripReplyNoise(learningHtmlToText(html));
}
