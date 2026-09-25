/**
 * Nutzer-Regex (Workflow-Bedingungen, Relay-Betreffregeln) laeuft synchron auf
 * Text, den der Absender einer Mail bestimmt. Gegen katastrophales Backtracking
 * starten API und Desktop mit dem V8-Flag
 * `--enable-experimental-regexp-engine-on-excessive-backtracks`: nach zu vielen
 * Backtracks wertet V8 das Muster mit einer Engine linearer Laufzeit neu aus.
 * Diese Engine kann keine Lookarounds und keine Rueckverweise – ein Muster mit
 * einem davon bliebe ungeschuetzt. Deshalb werden sie beim Speichern abgelehnt.
 */

export type UnsupportedUserRegexConstruct = 'lookaround' | 'backreference';

/**
 * Erstes Konstrukt im Muster, das die lineare Engine nicht verarbeiten kann,
 * oder `null`. Escapes (`\(?=`, `\\1`) und Zeichenklassen (`[(?=]`) zaehlen
 * nicht; benannte Gruppen `(?<name>…)` sind erlaubt.
 */
export function findUnsupportedUserRegexConstruct(source: string): UnsupportedUserRegexConstruct | null {
  let inClass = false;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    if (ch === '\\') {
      const next = source[i + 1] ?? '';
      if (!inClass) {
        if (next >= '1' && next <= '9') return 'backreference';
        if (next === 'k' && source[i + 2] === '<') return 'backreference';
      }
      i++;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch === '(' && source[i + 1] === '?') {
      const a = source[i + 2];
      const b = source[i + 3];
      if (a === '=' || a === '!') return 'lookaround';
      if (a === '<' && (b === '=' || b === '!')) return 'lookaround';
    }
  }
  return null;
}

const MAX_QUOTED_PATTERN = 60;

function quotePattern(source: string): string {
  const shown = source.length > MAX_QUOTED_PATTERN ? `${source.slice(0, MAX_QUOTED_PATTERN)}…` : source;
  return `„${shown}“`;
}

/** Deutsche Fehlermeldung fuer ein nicht erlaubtes Muster, sonst `null`. */
export function describeUnsupportedUserRegex(source: string): string | null {
  const construct = findUnsupportedUserRegexConstruct(source);
  if (construct === 'lookaround') {
    return `Der reguläre Ausdruck ${quotePattern(source)} enthält einen Lookaround ((?=, (?!, (?<=, (?<!). `
      + 'Das ist nicht erlaubt, weil solche Muster nicht gegen katastrophales Backtracking geschützt werden können.';
  }
  if (construct === 'backreference') {
    return `Der reguläre Ausdruck ${quotePattern(source)} enthält einen Rückverweis (\\1 … \\9, \\k<name>). `
      + 'Das ist nicht erlaubt, weil solche Muster nicht gegen katastrophales Backtracking geschützt werden können.';
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function regexConditionValue(condition: unknown): string | null {
  if (!isRecord(condition)) return null;
  if (condition.op !== 'regex' || typeof condition.value !== 'string') return null;
  return condition.value;
}

function collectDefinitionConditionPatterns(when: unknown, out: string[], depth = 0): void {
  if (!isRecord(when) || depth > 20) return;
  for (const key of ['all', 'any'] as const) {
    const items = when[key];
    if (Array.isArray(items)) {
      for (const item of items) collectDefinitionConditionPatterns(item, out, depth + 1);
    }
  }
  if (isRecord(when.not)) collectDefinitionConditionPatterns(when.not, out, depth + 1);
  const pattern = regexConditionValue(when);
  if (pattern !== null) out.push(pattern);
}

/**
 * Alle Regex-Muster aus Bedingungsknoten eines Graphen und aus den Regeln einer
 * (kompilierten) Definition. Beide Formen werden ausgefuehrt: der Server wertet
 * den Graphen aus, der Desktop je nach Ausfuehrungsmodus auch die Regeln.
 * Nimmt Objekte oder JSON-Text entgegen.
 */
export function collectWorkflowRegexPatterns(input: { graph?: unknown; definition?: unknown }): string[] {
  const patterns: string[] = [];
  const graph = parseMaybeJson(input.graph);
  if (isRecord(graph) && Array.isArray(graph.nodes)) {
    for (const node of graph.nodes) {
      if (!isRecord(node) || node.type !== 'condition') continue;
      const pattern = regexConditionValue(node.data);
      if (pattern !== null) patterns.push(pattern);
    }
  }
  const definition = parseMaybeJson(input.definition);
  if (isRecord(definition) && Array.isArray(definition.rules)) {
    for (const rule of definition.rules) {
      if (isRecord(rule)) collectDefinitionConditionPatterns(rule.when, patterns);
    }
  }
  return patterns;
}

/** Deutsche Fehlermeldung fuer das erste nicht erlaubte Workflow-Regex, sonst `null`. */
export function describeUnsupportedWorkflowRegex(input: { graph?: unknown; definition?: unknown }): string | null {
  for (const pattern of collectWorkflowRegexPatterns(input)) {
    const message = describeUnsupportedUserRegex(pattern);
    if (message) return message;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Flag i auf der linearen Engine
//
// V8 schaltet ein Muster mit Flag i (oder u/v, d) nie auf die lineare Engine
// um. Workflow-Bedingungen sind aber standardmaessig case-insensitiv, und auch
// Relay-Regeln nutzen meist /…/i. Deshalb wird ein i-Muster ohne u/v in ein
// case-sensitives Muster umgeschrieben und auf den kanonisch grossgeschriebenen
// Text angewandt. Das ist exakt die Semantik von Flag i ohne u (ECMA-262
// Canonicalize): zwei Zeichen passen, wenn ihre kanonische Form gleich ist.
// Ein Literal wird durch seine kanonische Form ersetzt, eine Zeichenklasse S
// durch S ∪ Canonicalize(S); \w, \d, \s und ihre Komplemente sind ohne u unter
// Canonicalize abgeschlossen, \b und . bleiben gleich. Was der Umschreiber
// nicht sicher abbildet (Rueckverweise, Modifier-Gruppen, Oktal in Klassen),
// bleibt beim nativen Muster.
// ---------------------------------------------------------------------------

let canonicalCase: Uint16Array | null = null;

/** Canonicalize(ch) aus ECMA-262 fuer Flag i ohne u, je UTF-16-Einheit. */
function canonicalCaseTable(): Uint16Array {
  if (canonicalCase) return canonicalCase;
  const table = new Uint16Array(0x10000);
  for (let code = 0; code < 0x10000; code += 1) {
    const upper = String.fromCharCode(code).toUpperCase();
    const cu = upper.length === 1 ? upper.charCodeAt(0) : code;
    table[code] = code >= 128 && cu < 128 ? code : cu;
  }
  canonicalCase = table;
  return table;
}

/** Text in kanonischer Form (gleiche Laenge, je UTF-16-Einheit abgebildet). */
export function canonicalizeUserRegexText(value: string): string {
  const table = canonicalCaseTable();
  const chunk: number[] = new Array<number>(Math.min(value.length, 8192));
  let out = '';
  for (let start = 0; start < value.length; start += 8192) {
    const size = Math.min(value.length - start, 8192);
    if (size < chunk.length) chunk.length = size;
    for (let k = 0; k < size; k += 1) chunk[k] = table[value.charCodeAt(start + k)]!;
    out += String.fromCharCode.apply(null, chunk);
  }
  return out;
}

type EscapeToken =
  | { kind: 'char'; code: number; raw: string; length: number }
  | { kind: 'set'; raw: string; length: number };

const CONTROL_ESCAPES: Readonly<Record<string, number>> = { f: 12, n: 10, r: 13, t: 9, v: 11 };

function isHexDigit(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= '0' && ch <= '9') || (ch >= 'a' && ch <= 'f') || (ch >= 'A' && ch <= 'F'));
}

function isAsciiLetter(ch: string | undefined): boolean {
  return ch !== undefined && ((ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z'));
}

function unitEscape(code: number): string {
  return `\\u${code.toString(16).padStart(4, '0')}`;
}

/**
 * Escape ab `source[i] === '\\'` nach Annex B (ohne u). `set` sind \d \s \w,
 * ihre Komplemente und ausserhalb von Klassen \b \B; `null` heisst: nicht
 * umschreiben.
 */
function parseEscape(source: string, i: number, inClass: boolean): EscapeToken | null {
  const next = source[i + 1];
  if (next === undefined) return null;
  if ('dDsSwW'.includes(next)) return { kind: 'set', raw: source.slice(i, i + 2), length: 2 };
  if (next === 'b') {
    return inClass ? { kind: 'char', code: 8, raw: '\\b', length: 2 } : { kind: 'set', raw: '\\b', length: 2 };
  }
  if (next === 'B' && !inClass) return { kind: 'set', raw: '\\B', length: 2 };
  const control = CONTROL_ESCAPES[next];
  if (control !== undefined) return { kind: 'char', code: control, raw: source.slice(i, i + 2), length: 2 };
  if (next === 'c') {
    const letter = source[i + 2];
    if (isAsciiLetter(letter) || (inClass && letter !== undefined && ((letter >= '0' && letter <= '9') || letter === '_'))) {
      return { kind: 'char', code: letter!.charCodeAt(0) % 32, raw: source.slice(i, i + 3), length: 3 };
    }
    // Annex B: ein allein stehendes \c ist ein Backslash; das c folgt als eigenes Zeichen.
    return { kind: 'char', code: 92, raw: '\\\\', length: 1 };
  }
  if (next === 'x' && isHexDigit(source[i + 2]) && isHexDigit(source[i + 3])) {
    return { kind: 'char', code: parseInt(source.slice(i + 2, i + 4), 16), raw: source.slice(i, i + 4), length: 4 };
  }
  if (next === 'u' && [2, 3, 4, 5].every((offset) => isHexDigit(source[i + offset]))) {
    return { kind: 'char', code: parseInt(source.slice(i + 2, i + 6), 16), raw: source.slice(i, i + 6), length: 6 };
  }
  if (next === '0') {
    const after = source[i + 2];
    // Ausserhalb einer Klasse bleibt \0 samt folgender Ziffern Wort fuer Wort
    // stehen (Oktal ohne Buchstaben); in einer Klasse waere es ein Bereichsende.
    if (inClass && after !== undefined && after >= '0' && after <= '9') return null;
    return { kind: 'char', code: 0, raw: '\\0', length: 2 };
  }
  if (next >= '1' && next <= '9') return null;
  if (next === 'k') return null;
  return { kind: 'char', code: next.charCodeAt(0), raw: source.slice(i, i + 2), length: 2 };
}

function parseClassAtom(source: string, i: number): EscapeToken | null {
  if (source[i] === '\\') return parseEscape(source, i, true);
  return { kind: 'char', code: source.charCodeAt(i), raw: source[i]!, length: 1 };
}

/** Zeichenklasse ab `source[i] === '['` als S ∪ Canonicalize(S). */
function rewriteClass(source: string, start: number, table: Uint16Array): { text: string; next: number } | null {
  let i = start + 1;
  const negated = source[i] === '^';
  if (negated) i += 1;
  const sets: string[] = [];
  const ranges: Array<[number, number]> = [];
  for (;;) {
    if (i >= source.length) return null;
    if (source[i] === ']') break;
    const first = parseClassAtom(source, i);
    if (!first) return null;
    i += first.length;
    if (source[i] === '-' && i + 1 < source.length && source[i + 1] !== ']') {
      const second = parseClassAtom(source, i + 1);
      if (!second) return null;
      i += 1 + second.length;
      if (first.kind === 'char' && second.kind === 'char') {
        if (first.code > second.code) return null;
        ranges.push([first.code, second.code]);
      } else {
        // Annex B: neben \d/\w/\s ist '-' ein gewoehnliches Zeichen.
        for (const atom of [first, second]) {
          if (atom.kind === 'set') sets.push(atom.raw);
          else ranges.push([atom.code, atom.code]);
        }
        ranges.push([45, 45]);
      }
      continue;
    }
    if (first.kind === 'set') sets.push(first.raw);
    else ranges.push([first.code, first.code]);
  }

  const inRanges = (code: number) => ranges.some(([lo, hi]) => code >= lo && code <= hi);
  const extras = new Set<number>();
  for (const [lo, hi] of ranges) {
    for (let code = lo; code <= hi; code += 1) {
      const canon = table[code]!;
      if (canon !== code && !inRanges(canon)) extras.add(canon);
    }
  }
  const all = [...ranges];
  const sortedExtras = [...extras].sort((a, b) => a - b);
  for (let k = 0; k < sortedExtras.length;) {
    let end = k;
    while (end + 1 < sortedExtras.length && sortedExtras[end + 1] === sortedExtras[end]! + 1) end += 1;
    all.push([sortedExtras[k]!, sortedExtras[end]!]);
    k = end + 1;
  }
  const body = sets.join('') + all
    .map(([lo, hi]) => (lo === hi ? unitEscape(lo) : `${unitEscape(lo)}-${unitEscape(hi)}`))
    .join('');
  return { text: `[${negated ? '^' : ''}${body}]`, next: i + 1 };
}

const SYNTAX_CHARACTERS = new Set(['^', '$', '.', '|', ')', '*', '+', '?', '{', '}', ']']);

/**
 * Case-sensitives Muster, das auf canonicalizeUserRegexText(text) genau dann
 * passt, wenn `source` mit Flag i (ohne u) auf `text` passt; `null`, wenn das
 * Muster etwas enthaelt, das hier nicht sicher abgebildet wird.
 */
export function rewriteCaseInsensitiveUserRegex(source: string): string | null {
  const table = canonicalCaseTable();
  let out = '';
  let i = 0;
  while (i < source.length) {
    const ch = source[i]!;
    if (ch === '\\') {
      const token = parseEscape(source, i, false);
      if (!token) return null;
      if (token.kind === 'char' && table[token.code] !== token.code) out += unitEscape(table[token.code]!);
      else out += token.raw;
      i += token.length;
      continue;
    }
    if (ch === '[') {
      const rewritten = rewriteClass(source, i, table);
      if (!rewritten) return null;
      out += rewritten.text;
      i = rewritten.next;
      continue;
    }
    if (ch === '(') {
      if (source[i + 1] !== '?') {
        out += ch;
        i += 1;
        continue;
      }
      const kind = source[i + 2];
      if (kind === ':' || kind === '=' || kind === '!') {
        out += source.slice(i, i + 3);
        i += 3;
        continue;
      }
      if (kind === '<') {
        const after = source[i + 3];
        const end = after === '=' || after === '!' ? i + 3 : source.indexOf('>', i + 3);
        if (end < 0) return null;
        out += source.slice(i, end + 1);
        i = end + 1;
        continue;
      }
      // Modifier-Gruppen wie (?i:…) oder (?-i:…) aendern die Semantik lokal.
      return null;
    }
    if (SYNTAX_CHARACTERS.has(ch)) {
      out += ch;
      i += 1;
      continue;
    }
    const code = source.charCodeAt(i);
    out += table[code] === code ? ch : unitEscape(table[code]!);
    i += 1;
  }
  return out;
}

export type UserRegexMatcher = (value: string) => boolean;

/**
 * Flags, unter denen V8 bei zu vielen Backtracks auf die lineare Engine umstellt
 * (d streicht compileUserRegex fuer test()). Mit u oder v bleibt das Muster auf
 * der Backtracking-Engine: /^(a|aa)+$/u braucht auf 34 Zeichen schon ueber 1 s.
 */
const LINEAR_SAFE_USER_REGEX_FLAGS = new Set(['d', 'g', 'i', 'm', 's', 'y']);

/** Meldung fuer Flags ausserhalb der geschuetzten Menge, sonst `null`. */
export function describeUnsupportedUserRegexFlags(flags: string): string | null {
  const unsupported = [...new Set(flags)].filter((flag) => !LINEAR_SAFE_USER_REGEX_FLAGS.has(flag));
  if (unsupported.length === 0) return null;
  return `Das Regex-Flag ${unsupported.join(', ')} ist nicht erlaubt, weil solche Muster nicht gegen `
    + 'katastrophales Backtracking geschützt werden können (erlaubt: i, m, s, g, y).';
}

/**
 * Kompiliert ein Nutzer-Regex so, dass V8 es bei zu vielen Backtracks auf die
 * lineare Engine umstellen kann. Wirft wie `new RegExp` bei ungueltigem Muster
 * oder Flag, ausserdem bei u oder v (dafuer gibt es keinen linearen Fallback). Jeder Aufruf beginnt wie ein frisch erzeugter RegExp bei Index 0.
 */
export function compileUserRegex(source: string, flags = ''): UserRegexMatcher {
  const unsupportedFlags = describeUnsupportedUserRegexFlags(flags);
  if (unsupportedFlags) throw new SyntaxError(unsupportedFlags);
  const native = new RegExp(source, flags);
  // hasIndices aendert test() nicht, sperrt aber die lineare Engine.
  const testFlags = flags.replace('d', '');
  if (native.ignoreCase && !flags.includes('u') && !flags.includes('v')) {
    const rewritten = rewriteCaseInsensitiveUserRegex(source);
    let linear: RegExp | null = null;
    if (rewritten !== null) {
      try {
        linear = new RegExp(rewritten, testFlags.replace('i', ''));
      } catch {
        linear = null;
      }
    }
    if (linear) {
      const re = linear;
      return (value) => {
        re.lastIndex = 0;
        return re.test(canonicalizeUserRegexText(value));
      };
    }
  }
  const re = testFlags === flags ? native : new RegExp(source, testFlags);
  return (value) => {
    re.lastIndex = 0;
    return re.test(value);
  };
}
