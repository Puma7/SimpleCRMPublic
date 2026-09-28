/**
 * Wissensbasis als Suchindex je `##`-Abschnitt (Plan 048). Das Dokument bleibt
 * die einzige Quelle; die Abschnitte werden daraus abgeleitet und können
 * jederzeit neu gebaut werden. Dazu die bereinigten Suchbegriffe für die
 * Volltextsuche beider Editionen.
 */
import { parseKnowledgeSections } from './knowledge-sections';

/** Abschnitte darüber werden an Absätzen geteilt („Titel (Teil n)“). */
export const KNOWLEDGE_SECTION_MAX_CHARS = 4_000;
/** Kleine Wissensbasen gehen ganz an die KI (keine Suche nötig). */
export const KNOWLEDGE_SMALL_KB_MAX_CHARS = 6_000;

export type DerivedKnowledgeSection = { position: number; title: string; content: string };

const FENCE_PATTERN = /^[ \t]*(```|~~~)/;

/** Absätze (durch Leerzeilen getrennt); Codeblöcke bleiben zusammen. */
function paragraphs(text: string): string[] {
  const result: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const match = FENCE_PATTERN.exec(line);
    if (match) {
      if (fence === null) fence = match[1]!;
      else if (fence === match[1]) fence = null;
    }
    if (fence === null && !match && line.trim() === '') {
      if (current.length > 0) result.push(current.join('\n'));
      current = [];
      continue;
    }
    current.push(line);
  }
  if (current.length > 0) result.push(current.join('\n'));
  return result;
}

function splitContent(content: string, max: number): string[] {
  if (content.length <= max) return [content];
  const parts: string[] = [];
  let current = '';
  const flush = () => {
    if (current) parts.push(current);
    current = '';
  };
  for (const paragraph of paragraphs(content)) {
    if (paragraph.length > max) {
      flush();
      for (let offset = 0; offset < paragraph.length; offset += max) parts.push(paragraph.slice(offset, offset + max));
      continue;
    }
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > max) {
      flush();
      current = paragraph;
    } else {
      current = next;
    }
  }
  flush();
  return parts;
}

/** Trennlinien `---` am Rand (Zusammenführung alter Chunks) gehören zu keinem Abschnitt. */
function trimRules(text: string): string {
  const lines = text.split('\n');
  const isEdge = (line: string | undefined) => line !== undefined && (line.trim() === '' || /^[ \t]*-{3,}[ \t]*$/.test(line));
  while (isEdge(lines[0])) lines.shift();
  while (isEdge(lines[lines.length - 1])) lines.pop();
  return lines.join('\n');
}

/**
 * Einleitung (ohne eine allein stehende `# Titel`-Zeile) als erster Abschnitt
 * mit dem Namen der Wissensbasis, dann jeder `##`-Abschnitt; leere entfallen,
 * zu lange werden an Absätzen geteilt.
 */
export function deriveKnowledgeSections(
  document: string,
  kbName: string,
  opts: { maxSectionChars?: number } = {},
): DerivedKnowledgeSection[] {
  const max = Math.max(1, Math.floor(opts.maxSectionChars ?? KNOWLEDGE_SECTION_MAX_CHARS));
  const parsed = parseKnowledgeSections(String(document ?? ''));
  const entries: { title: string; content: string }[] = [];
  const preamble = trimRules(parsed.preamble
    .split('\n')
    .filter((line) => !/^#[ \t]+\S/.test(line))
    .join('\n'));
  if (preamble) entries.push({ title: kbName.trim() || 'Wissensbasis', content: preamble });
  for (const section of parsed.sections) {
    const content = trimRules(section.content);
    if (content) entries.push({ title: section.title, content });
  }
  const result: DerivedKnowledgeSection[] = [];
  for (const entry of entries) {
    const parts = splitContent(entry.content, max);
    parts.forEach((content, index) => {
      result.push({
        position: result.length,
        title: parts.length > 1 ? `${entry.title} (Teil ${index + 1})` : entry.title,
        content,
      });
    });
  }
  return result;
}

/** Häufige deutsche (und englische) Füllwörter; ohne Stammformen. */
export const GERMAN_KNOWLEDGE_STOPWORDS: ReadonlySet<string> = new Set([
  'aber', 'alle', 'allem', 'allen', 'aller', 'alles', 'als', 'also', 'am', 'an', 'and', 'andere', 'anderen', 'auch',
  'auf', 'aus', 'bei', 'beim', 'bin', 'bis', 'bist', 'bitte', 'damen', 'dank', 'danke', 'dann', 'das', 'dass', 'daß',
  'dem', 'den', 'denn', 'der', 'des', 'dessen', 'dich', 'die', 'dies', 'diese', 'diesem', 'diesen', 'dieser', 'dieses',
  'dir', 'doch', 'dort', 'durch', 'ein', 'eine', 'einem', 'einen', 'einer', 'eines', 'email', 'etwas', 'euch', 'euer',
  'eure', 'for', 'freundlichen', 'from', 'für', 'geehrte', 'geehrter', 'gegen', 'gern', 'gerne', 'gibt', 'grüße',
  'grüßen', 'gruß', 'guten', 'habe', 'haben', 'hallo', 'hast', 'hat', 'hatte', 'hatten', 'herr', 'herren', 'hier',
  'ich', 'ihm', 'ihn', 'ihnen', 'ihr', 'ihre', 'ihrem', 'ihren', 'ihrer', 'ihres', 'im', 'in', 'ins', 'ist', 'jetzt',
  'kann', 'kannst', 'kein', 'keine', 'keinen', 'können', 'könnte', 'leider', 'mail', 'man', 'mehr', 'mein', 'meine',
  'meinem', 'meinen', 'meiner', 'mfg', 'mich', 'mir', 'mit', 'möchte', 'möchten', 'muss', 'müssen', 'nach', 'nicht',
  'noch', 'nun', 'nur', 'oder', 'ohne', 'schon', 'sehr', 'sein', 'seine', 'seinem', 'seinen', 'seiner', 'sich', 'sie',
  'sind', 'soll', 'sollen', 'sowie', 'tag', 'that', 'the', 'this', 'über', 'um', 'und', 'uns', 'unser', 'unsere',
  'unter', 'viel', 'viele', 'vielen', 'vom', 'von', 'vor', 'war', 'waren', 'warum', 'was', 'weil', 'welche', 'welcher',
  'welches', 'wenn', 'wer', 'werden', 'wie', 'wieder', 'will', 'wir', 'wird', 'with', 'wo', 'wollen', 'wurde',
  'wurden', 'you', 'your', 'zum', 'zur', 'zwischen',
]);

/**
 * Suchbegriffe aus einem Text: klein geschrieben, an allem außer Buchstaben
 * und Ziffern getrennt, mindestens 3 Zeichen, ohne Füllwörter, ohne Dubletten,
 * höchstens `max`. Das Ergebnis enthält nur Buchstaben und Ziffern und kann
 * daher sicher zu einer tsquery bzw. FTS5-Abfrage verbunden werden.
 */
export function buildKnowledgeQueryTerms(text: string, max = 24): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const raw of String(text ?? '').toLocaleLowerCase('de-DE').split(/[^\p{L}\p{N}]+/u)) {
    if (terms.length >= max) break;
    if ([...raw].length < 3 || GERMAN_KNOWLEDGE_STOPWORDS.has(raw) || seen.has(raw)) continue;
    seen.add(raw);
    terms.push(raw);
  }
  return terms;
}

/** Höchstlänge der Quellenangabe am KI-Entwurf. */
export const KNOWLEDGE_SOURCES_LABEL_MAX = 500;

/**
 * Plan 048: genutztes Wissen am Entwurf als `KB-Name › Abschnitt`, ohne
 * Dubletten, mit `; ` verbunden, höchstens 500 Zeichen. Ist der Abschnitt die
 * Einleitung (Titel = Name der Wissensbasis), steht nur der Name. Ohne Titel
 * steht wie bisher `Chunk #id`.
 */
export function formatKnowledgeSourcesLabel(
  sources: ReadonlyArray<{ id?: number | string | null; knowledgeBaseName?: string | null; title?: string | null }>,
): string {
  const seen = new Set<string>();
  const parts: string[] = [];
  for (const source of sources) {
    const kb = source.knowledgeBaseName?.trim() ?? '';
    const title = source.title?.trim() || (source.id !== null && source.id !== undefined ? `Chunk #${source.id}` : '');
    const label = kb && title && kb !== title ? `${kb} › ${title}` : title || kb;
    if (!label || seen.has(label)) continue;
    seen.add(label);
    parts.push(label);
  }
  const joined = parts.join('; ');
  return joined.length > KNOWLEDGE_SOURCES_LABEL_MAX
    ? `${joined.slice(0, KNOWLEDGE_SOURCES_LABEL_MAX - 1)}…`
    : joined;
}
