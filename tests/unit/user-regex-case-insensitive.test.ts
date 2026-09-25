import { setFlagsFromString } from 'v8';
import { evaluateRelayTrackingRule } from '../../packages/core/src/email';
import {
  canonicalizeUserRegexText,
  compileUserRegex,
  rewriteCaseInsensitiveUserRegex,
} from '../../packages/core/src/user-regex';

// Wie in Produktion (docker/api.Dockerfile, electron/main.js). Wirkt auf jeden
// danach erzeugten RegExp dieses Test-Workers.
setFlagsFromString('--enable-experimental-regexp-engine-on-excessive-backtracks');

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const ALL_CODE_UNITS = (() => {
  let s = '';
  for (let c = 0; c < 0x10000; c += 1) s += String.fromCharCode(c);
  return s;
})();

// Buchstaben mit Sonderfaellen der Gross-/Kleinschreibung (ß, ſ, ı, İ, Kelvin,
// Angström, µ, ǅ, Schluss-Sigma, Ohm) neben ASCII und Umlauten.
const LETTERS = [
  'a', 'A', 'b', 'B', 'k', 'K', 's', 'S', 'i', 'I', 'z', 'Z', 'ß', 'ſ', 'ı', 'İ', 'µ', 'Μ', 'μ',
  'ÿ', 'Ÿ', 'ä', 'Ä', 'ü', 'Ü', 'K', 'Å', 'å', 'Å', 'ǅ', 'Ǆ', 'ǆ', 'σ', 'ς', 'Σ',
  'ω', 'Ω', 'Ω', 'é', 'É', 'ﬀ', 'ᾳ', 'ΐ',
];
const OTHERS = ['0', '1', '9', '_', '-', ' ', '.', '\n', '\t', '!', '/', '\\', ' ', 'ɐ', 'ⓐ', 'Ⓐ'];
const SYNTAX = new Set(['\\', '^', '$', '.', '|', '?', '*', '+', '(', ')', '[', ']', '{', '}', '/', '-']);

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)]!;
}

function literal(rand: () => number): string {
  const ch = rand() < 0.75 ? pick(rand, LETTERS) : pick(rand, OTHERS);
  if (SYNTAX.has(ch)) return `\\${ch}`;
  if (ch === '\n') return '\\n';
  return ch;
}

function hex(code: number, width: number): string {
  return code.toString(16).padStart(width, '0');
}

function escapeAtom(rand: () => number): string {
  const ch = pick(rand, LETTERS).charCodeAt(0);
  const forms = [
    () => `\\u${hex(ch, 4)}`,
    () => `\\u${hex(ch, 4).toUpperCase()}`,
    () => (ch < 0x100 ? `\\x${hex(ch, 2)}` : `\\u${hex(ch, 4)}`),
    () => pick(rand, ['\\d', '\\D', '\\w', '\\W', '\\s', '\\S', '\\b', '\\B', '\\t', '\\n', '\\cJ', '\\cj']),
    () => pick(rand, ['\\c', '\\c1', '\\q', '\\p', '\\e', '\\K', '\\-', '\\/', '\\x4', '\\xg', '\\u12', '\\0']),
  ];
  return pick(rand, forms)();
}

function classItem(rand: () => number): string {
  const roll = rand();
  if (roll < 0.35) {
    const a = pick(rand, [...LETTERS, ...OTHERS]).charCodeAt(0);
    const b = pick(rand, [...LETTERS, ...OTHERS]).charCodeAt(0);
    const [lo, hi] = a <= b ? [a, b] : [b, a];
    return `\\u${hex(lo, 4)}-\\u${hex(hi, 4)}`;
  }
  if (roll < 0.45) return pick(rand, ['a-z', 'A-Z', 'à-þ', 'α-ω', 'Α-Ω', '\\u0100-\\u017f', '0-9', 'k-s']);
  if (roll < 0.6) return pick(rand, ['\\w', '\\W', '\\d', '\\D', '\\s', '\\S', '\\b', '-', '\\-', '^', '\\]']);
  if (roll < 0.7) return escapeAtom(rand).replace(/^\\[bBc].*$/, '\\x41');
  const ch = rand() < 0.8 ? pick(rand, LETTERS) : pick(rand, OTHERS);
  return ch === '\\' || ch === ']' || ch === '-' ? `\\${ch}` : ch === '\n' ? '\\n' : ch;
}

function charClass(rand: () => number): string {
  const count = Math.floor(rand() * 4);
  let body = '';
  for (let i = 0; i < count; i += 1) body += classItem(rand);
  return `[${rand() < 0.3 ? '^' : ''}${body}]`;
}

function quantifier(rand: () => number): string {
  if (rand() < 0.65) return '';
  const q = pick(rand, ['*', '+', '?', '{2}', '{1,3}', '{0,}', '{2,5}']);
  return rand() < 0.2 ? `${q}?` : q;
}

let groupCounter = 0;
function sequence(rand: () => number, depth: number): string {
  const length = 1 + Math.floor(rand() * 4);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    const roll = rand();
    let atom: string;
    if (roll < 0.45) atom = literal(rand);
    else if (roll < 0.6) atom = escapeAtom(rand);
    else if (roll < 0.75) atom = charClass(rand);
    else if (roll < 0.8) atom = '.';
    else if (roll < 0.85) atom = pick(rand, ['^', '$']);
    else if (depth < 2) {
      groupCounter += 1;
      const open = pick(rand, ['(', '(?:', `(?<g${groupCounter}>`]);
      atom = `${open}${alternation(rand, depth + 1)})`;
    } else atom = literal(rand);
    out += atom + (atom === '^' || atom === '$' || atom.startsWith('\\b') || atom.startsWith('\\B') ? '' : quantifier(rand));
  }
  return out;
}

function alternation(rand: () => number, depth: number): string {
  const branches = 1 + (rand() < 0.3 ? 1 : 0) + (rand() < 0.1 ? 1 : 0);
  const out: string[] = [];
  for (let i = 0; i < branches; i += 1) out.push(sequence(rand, depth));
  return out.join('|');
}

function haystack(rand: () => number): string {
  const length = Math.floor(rand() * 10);
  let out = '';
  for (let i = 0; i < length; i += 1) out += rand() < 0.8 ? pick(rand, LETTERS) : pick(rand, OTHERS);
  return out;
}

function nativeResult(source: string, flags: string, value: string): boolean | 'error' {
  try {
    return new RegExp(source, flags).test(value);
  } catch {
    return 'error';
  }
}

function ourResult(source: string, flags: string, value: string): boolean | 'error' {
  try {
    return compileUserRegex(source, flags)(value);
  } catch {
    return 'error';
  }
}

describe('Nutzer-Regex mit Flag i auf der linearen Engine (F-A13A14-04, E1)', () => {
  // F-A13A14-04: V8 schaltet Muster mit Flag i nie auf die lineare Engine um; Workflow-Bedingungen sind standardmaessig case-insensitiv und blieben ungeschuetzt.
  test('case-insensitive (a|a)*b auf 26 Zeichen bleibt unter einer Sekunde', () => {
    const matcher = compileUserRegex('(a|a)*b', 'i');
    const started = Date.now();
    expect(matcher('a'.repeat(26) + '!')).toBe(false);
    expect(matcher('A'.repeat(26) + 'B')).toBe(true);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('case-insensitive (\\w|\\d)+$ auf 26 Ziffern bleibt unter einer Sekunde', () => {
    const matcher = compileUserRegex('(\\w|\\d)+$', 'i');
    const started = Date.now();
    expect(matcher('1'.repeat(26) + '!')).toBe(false);
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('Relay-Betreffregel /(a|a)*b/i blockiert nicht', () => {
    const started = Date.now();
    const decision = evaluateRelayTrackingRule({
      mode: 'rule',
      subjectPatterns: '/(a|a)*b/i',
      allowHeaderOverride: false,
      subject: 'a'.repeat(26) + '!',
      headerOverride: null,
    });
    expect(decision).toEqual({ track: false, reason: 'no_match' });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  test('die Grossschreibung ist idempotent und laengentreu fuer alle UTF-16-Einheiten', () => {
    const once = canonicalizeUserRegexText(ALL_CODE_UNITS);
    expect(once.length).toBe(ALL_CODE_UNITS.length);
    expect(canonicalizeUserRegexText(once)).toBe(once);
  });

  test.each([
    'k', 's', 'i', 'ß', 'ſ', 'µ', 'ÿ', 'Ω', 'ǅ', 'σ', 'ΐ', 'ﬀ', '\\u212a', '\\x41', '\\q', '\\c',
    '[a-z]', '[^a-z]', '[à-þ]', '[\\u0100-\\u017f]', '[α-ω]', '[\\u0370-\\u03ff]', '[^\\u0041-\\u005a0-9]',
    '[k-s\\d]', '[\\w-a]', '[a-]', '[-z]', '[]', '[^]', '\\w', '\\W', '\\b.', '.\\B', '.',
  ])('trifft fuer %s dieselben UTF-16-Einheiten wie das native Flag i', (source) => {
    const rewritten = rewriteCaseInsensitiveUserRegex(source);
    expect(rewritten).not.toBeNull();
    const nativeHits: number[] = [];
    const native = new RegExp(source, 'gi');
    for (let m = native.exec(ALL_CODE_UNITS); m; m = native.exec(ALL_CODE_UNITS)) {
      nativeHits.push(m.index);
      if (m[0] === '') native.lastIndex += 1;
    }
    const ourHits: number[] = [];
    const ours = new RegExp(rewritten!, 'g');
    const canonical = canonicalizeUserRegexText(ALL_CODE_UNITS);
    for (let m = ours.exec(canonical); m; m = ours.exec(canonical)) {
      ourHits.push(m.index);
      if (m[0] === '') ours.lastIndex += 1;
    }
    expect(ourHits).toEqual(nativeHits);
  });

  test('zufaellige Muster und Texte liefern dasselbe Ergebnis wie das native Flag i', () => {
    const rand = mulberry32(0x5eed_e1);
    const mismatches: string[] = [];
    let rewrittenCount = 0;
    for (let round = 0; round < 6000; round += 1) {
      const source = alternation(rand, 0);
      const flags = pick(rand, ['i', 'i', 'i', 'im', 'is', 'gi', 'iy', 'di']);
      if (rewriteCaseInsensitiveUserRegex(source) !== null) rewrittenCount += 1;
      for (let probe = 0; probe < 6; probe += 1) {
        const value = haystack(rand);
        const expected = nativeResult(source, flags, value);
        const actual = ourResult(source, flags, value);
        if (expected !== actual && mismatches.length < 10) {
          mismatches.push(`${JSON.stringify(source)} /${flags} ${JSON.stringify(value)}: nativ ${expected}, neu ${actual}`);
        }
      }
    }
    expect(mismatches).toEqual([]);
    // Der Fuzzer soll ueberwiegend den umgeschriebenen Pfad treffen, nicht den Rueckfall.
    expect(rewrittenCount).toBeGreaterThan(4000);
  });

  test('ohne Flag i, mit u oder mit nicht umschreibbaren Konstrukten bleibt es beim nativen Muster', () => {
    expect(rewriteCaseInsensitiveUserRegex('(?i:a)b')).toBeNull();
    expect(rewriteCaseInsensitiveUserRegex('(a)\\1')).toBeNull();
    expect(rewriteCaseInsensitiveUserRegex('[\\1]')).toBeNull();
    expect(compileUserRegex('Straße', 'iu')('STRASSE')).toBe(false);
    expect(compileUserRegex('abc', '')('ABC')).toBe(false);
    expect(compileUserRegex('abc', 'i')('xABCx')).toBe(true);
    const sticky = compileUserRegex('b', 'gi');
    expect(sticky('ab')).toBe(true);
    expect(sticky('ab')).toBe(true);
    expect(() => compileUserRegex('(', 'i')).toThrow(SyntaxError);
    expect(() => compileUserRegex('a', 'iq')).toThrow(SyntaxError);
  });
});
