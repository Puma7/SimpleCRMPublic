/**
 * Datenschutzfilter für Learnings (TA-P5): ersetzt personenbezogene Daten in
 * Freitext durch Platzhalter, bevor etwas gespeichert oder an die KI gegeben
 * wird. Rein, deterministisch und idempotent (redact(redact(x)) === redact(x)).
 *
 * Bewusst konservativ bei Zahlen: Datumsangaben, Uhrzeiten, Preise, Mengen und
 * Fristen bleiben stehen, weil genau sie oft den Inhalt eines Learnings tragen
 * („Rückgabe innerhalb von 14 Tagen“, „Versand ab 49,00 €“).
 *
 * Laufzeit: Die Texte stammen aus fremden Mails. Jedes Muster ist linear —
 * ein Treffer beginnt nur am Anfang einer Zeichenfolge (Lookbehind statt
 * `\b`/ohne Anker), Leerraum ist nie zweideutig auf mehrere `\s*` verteilt,
 * und Rückfragen an den Resttext laufen rückwärts über wenige Zeichen statt
 * über den ganzen Text (Test: tests/unit/ai-learnings-redos.test.ts).
 */

export const LEARNING_PLACEHOLDERS = {
  email: '[E-Mail]',
  phone: '[Telefon]',
  iban: '[IBAN]',
  bic: '[BIC]',
  link: '[Link]',
  address: '[Adresse]',
  number: '[Nummer]',
  name: '[Name]',
} as const;

export type RedactionHints = {
  /**
   * Namen, die sicher personenbezogen sind (Absender-/Empfänger-Anzeigenamen,
   * CRM-Kundenname, eigener Nutzer-/Signaturname). Vollständige Namen und ihre
   * Bestandteile (ab drei Buchstaben) werden ersetzt.
   */
  names?: readonly (string | null | undefined)[];
  /**
   * `full` (Standard): ganze URL → [Link]. `query`: Schema, Host und Pfad
   * bleiben, Query/Fragment und Pfadsegmente mit Ziffern werden ersetzt.
   */
  urlMode?: 'full' | 'query';
  /**
   * Treffer, die wörtlich in diesem Text vorkommen, bleiben stehen. Genutzt
   * für die KI-Ausgabe: Kontaktdaten, die schon in der Wissensbasis stehen
   * (z. B. die Hotline), sind keine neuen personenbezogenen Daten.
   */
  keepExisting?: string | null;
};

const P = LEARNING_PLACEHOLDERS;

/** Wörter, die als Namensbestandteil nie ersetzt werden (Rollen/Firmenzusätze). */
const NAME_PART_STOPWORDS = new Set([
  'gmbh', 'mbh', 'ag', 'kg', 'ug', 'ohg', 'gbr', 'ltd', 'inc', 'llc', 'e.k.', 'ek', 'co',
  'und', 'and', 'the', 'der', 'die', 'das', 'von', 'van', 'vom', 'zum', 'zur', 'des', 'den',
  'team', 'service', 'support', 'info', 'kontakt', 'contact', 'kundenservice', 'kundendienst',
  'customer', 'noreply', 'no-reply', 'mail', 'email', 'office', 'büro', 'buero', 'shop',
  'sales', 'vertrieb', 'verkauf', 'hello', 'hallo', 'admin', 'newsletter', 'news', 'online',
  'herr', 'herrn', 'frau', 'dr', 'prof', 'mr', 'mrs', 'ms', 'name', 'link', 'nummer',
  'telefon', 'adresse', 'iban', 'bic',
]);

/** Einheiten/Währungen: eine Zahl davor ist nie eine Postleitzahl. */
const UNIT_WORDS = new Set([
  'euro', 'eur', 'cent', 'chf', 'franken', 'usd', 'dollar', 'pfund', 'gbp',
  'stück', 'stueck', 'stk', 'artikel', 'pakete', 'paket', 'kartons', 'karton', 'paletten',
  'kilo', 'kg', 'gramm', 'tonnen', 'liter', 'meter', 'kilometer', 'km', 'mm', 'cm',
  'sekunden', 'minuten', 'stunden', 'tage', 'tagen', 'wochen', 'monate', 'monaten', 'jahre',
  'jahren', 'mal', 'kunden', 'nutzer', 'mitarbeiter', 'bestellungen', 'mails', 'zeichen',
  'punkte', 'prozent', 'seiten', 'units', 'items', 'pieces', 'days', 'hours', 'minutes',
  'users', 'customers', 'orders', 'dollars', 'euros', 'mb', 'gb', 'kb', 'tb', 'watt', 'kw',
  'kwh', 'volt', 'grad', 'bar', 'lux', 'uhr',
]);

const LETTER = 'A-Za-zÄÖÜäöüßÀ-ÖØ-öø-ÿ';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function countDigits(value: string): number {
  let n = 0;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    if (c >= 48 && c <= 57) n += 1;
  }
  return n;
}

type Keeper = (match: string) => boolean;

function makeKeeper(keepExisting: string | null | undefined): Keeper {
  const haystack = (keepExisting ?? '').trim();
  if (!haystack) return () => false;
  return (match: string) => {
    const needle = match.trim();
    return needle.length >= 3 && haystack.includes(needle);
  };
}

function replaceWith(
  text: string,
  pattern: RegExp,
  keep: Keeper,
  build: (match: string, groups: string[]) => string | null,
): string {
  return text.replace(pattern, (...args: unknown[]) => {
    const match = String(args[0]);
    const groups = args.slice(1, -2).map((g) => (typeof g === 'string' ? g : ''));
    if (keep(match)) return match;
    const out = build(match, groups);
    return out === null ? match : out;
  });
}

// --- URLs -------------------------------------------------------------------

const URL_PATTERN = /\b(?:https?:\/\/|www\.)[^\s<>"'()[\]{}]+[^\s<>"'()[\]{}.,;:!?]/gi;

function redactUrl(url: string, mode: 'full' | 'query'): string {
  if (mode === 'full') return P.link;
  const match = /^((?:https?:\/\/)?[^/?#\s]+)([^?#]*)([?#].*)?$/i.exec(url);
  if (!match) return P.link;
  const origin = match[1] ?? '';
  const path = (match[2] ?? '')
    .split('/')
    .map((segment) => (/\d{3,}|[A-Za-z0-9_-]{24,}/.test(segment) ? P.link : segment))
    .join('/');
  const tail = match[3] ? `?${P.link}` : '';
  return `${origin}${path}${tail}`;
}

// --- E-Mail -----------------------------------------------------------------

/**
 * Beginnt nur am Anfang eines Lokalteils: ohne den Lookbehind liefe der
 * Lokalteil von jeder Position einer langen Folge („aaaa…“) bis zum Ende.
 */
const EMAIL_PATTERN = /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g;

// --- IBAN / BIC -------------------------------------------------------------

/** Großbuchstaben: „Konto AT61… bei …“ darf nicht in die IBAN hineinlaufen. */
const IBAN_PATTERN = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){2,7}(?:[ ]?[A-Z0-9]{1,4})?\b/g;
const BIC_KEYWORD_PATTERN = /\b(BIC|SWIFT(?:-Code)?|SWIFT\/BIC)(\s*(?:[:.]\s*)?)([A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?)\b/gi;
const BIC_BARE_PATTERN = /\b[A-Z]{4}(?:DE|AT|CH|LI|LU|NL|BE|FR|IT|ES|GB|PL|CZ|DK|SE|NO|FI|IE|PT)[A-Z0-9]{2}(?:[A-Z0-9]{3})?\b/g;

// --- Bestell-/Kunden-/Rechnungsnummern ----------------------------------------

const NUMBER_KEYWORDS = [
  'Bestell(?:ung|nummer|-?nr\\.?|-Nr\\.?)?',
  'Auftrags?(?:nummer|-?nr\\.?|-Nr\\.?)?',
  'Kunden(?:nummer|-?nr\\.?|-Nr\\.?|konto|-ID|id)',
  'Kd\\.?-?\\s?Nr\\.?',
  'KdNr\\.?',
  'Rechnung(?:snummer|s-?nr\\.?|s-Nr\\.?)?',
  'Re\\.?-?\\s?Nr\\.?',
  'Vertrags?(?:nummer|-?nr\\.?|-Nr\\.?)',
  'Vorgangs?(?:nummer|-?nr\\.?|-Nr\\.?)?',
  'Ticket(?:nummer|-?nr\\.?|-Nr\\.?)?',
  'Lieferschein(?:nummer|-?nr\\.?|-Nr\\.?)?',
  'Sendungs(?:nummer|-?nr\\.?|-Nr\\.?)',
  'Tracking(?:-?nummer|-?ID|-?code)?',
  'Paket(?:nummer|-?nr\\.?)',
  'Mitglieds(?:nummer|-?nr\\.?)',
  'Versicherungs(?:nummer|-?nr\\.?)',
  'Aktenzeichen', 'Az\\.',
  'Referenz(?:nummer)?', 'Ref\\.?(?:-?Nr\\.?)?',
  'Mandats?(?:referenz|nummer)',
  'Gutschein(?:code)?',
  'Order(?:\\s?(?:number|no\\.?|ID))?',
  'Invoice(?:\\s?(?:number|no\\.?))?',
  'Customer\\s?(?:number|no\\.?|ID)',
  'Account\\s?(?:number|no\\.?)',
  'Reference(?:\\s?(?:number|no\\.?))?',
  'Case(?:\\s?(?:number|no\\.?|ID))?',
];

const NUMBER_KEYWORD_PATTERN = new RegExp(
  // Trenner wie „\s*(Nr\s*)?([:#]|-|\s)\s*#?\s*“, aber ohne zwei benachbarte \s*
  // (sonst quadratisch viele Aufteilungen eines langen Leerraums).
  `\\b(${NUMBER_KEYWORDS.join('|')})((?:\\s*(?:Nr\\.?|No\\.?|Nummer|number))?(?:\\s*[:#]|\\s*-(?=\\s)|\\s)\\s*(?:#\\s*)?)([A-Z0-9](?:[A-Z0-9./_-]*[A-Z0-9])?)`,
  'gi',
);

/** `\d{4}[A-Z0-9-]*` = `\d{4,}[A-Z0-9-]*`, ohne zwei konkurrierende Ziffernläufe. */
const HASH_NUMBER_PATTERN = /(^|[\s(])#\s?(\d{4}[A-Z0-9-]*)\b/gi;
const TICKET_CODE_PATTERN = /\[[A-Z0-9]{1,12}-[A-Z0-9]{1,20}\]/g;
/** Lange Ziffernfolgen ohne Trenner (Sendungs-/Kontonummern). Preise/Daten haben Trenner. */
const LONG_DIGITS_PATTERN = /(?<![\d.,])\d{7,}(?![\d.,]\d)/g;

// --- Telefon ----------------------------------------------------------------

const PHONE_KEYWORD_PATTERN = new RegExp(
  `\\b(Tel(?:efon)?\\.?|Fon|Phone|Mobil(?:funk)?|Mobile|Handy|Fax|Telefax|Cell|WhatsApp|Hotline)(\\s*(?:(?:[:.]|-?Nr\\.?:?)\\s*)?)(\\+?[\\d(][\\d\\s()/.-]{4,}\\d)`,
  'gi',
);
const PHONE_INTERNATIONAL_PATTERN = /(?<![\w+])(?:\+|00)[1-9][\d \t./()-]{6,}\d(?!\d)/g;
const PHONE_NATIONAL_PATTERN = /(?<![\w.,/])(?:\(0\d{2,5}\)|0\d{2,5})(?:[ \t/-]\d{2,}|\d){1,5}(?:[ \t-]\d{1,4})?(?![\d.,]?\d)/g;

// --- Adresse ----------------------------------------------------------------

const STREET_SUFFIX = '(?:straße|strasse|str\\.|weg|gasse|platz|allee|ring|damm|ufer|steig|pfad|stieg|chaussee|kai)';
const STREET_PATTERN = new RegExp(
  // Beginnt nur am Anfang eines Wortes aus Buchstaben/Bindestrichen: mit `\b`
  // startete „a-a-a-…“ an jedem Buchstaben neu und liefe jedes Mal bis zum Ende.
  `(?:(?<![${LETTER}0-9_-])[${LETTER}][${LETTER}-]*${STREET_SUFFIX}|\\b(?:Straße|Strasse|Str\\.|Weg|Gasse|Platz|Allee)(?=[ \\t]+\\d))[ \\t]+\\d{1,3}(?:[ \\t]?[a-zA-Z])?(?:[ \\t]?[-/][ \\t]?\\d{1,3}[a-zA-Z]?)?(?![\\d\\p{L}])`,
  'gu',
);
const ENGLISH_STREET_PATTERN = /\b\d{1,5}\s+(?:[A-Z][a-z]+\s){1,3}(?:Street|St\.|Road|Rd\.|Avenue|Ave\.|Lane|Ln\.|Drive|Boulevard|Blvd\.|Way|Court|Ct\.)(?=[\s,.]|$)/g;
const POSTAL_CITY_PATTERN = new RegExp(
  `(^|[\\s,(;])((?:D|A|CH|DE|AT)-)?(\\d{4,5})[ \\t]+([A-ZÄÖÜ][${LETTER}]+(?:(?:[ -]|[ \\t](?:am|an der|im|bei|ob der)[ \\t])[A-ZÄÖÜ(][${LETTER})./]+)?)`,
  'gm',
);

/**
 * Steht vor `index` (nach Leerzeichen/Tabs) der Textanfang, ein Zeilenumbruch
 * oder ein Komma? Rückwärts über den Leerraum statt Regex über den ganzen
 * Text davor (das wäre je Treffer linear, insgesamt quadratisch).
 */
function startsLineOrFollowsComma(whole: string, index: number): boolean {
  let i = index;
  while (i > 0 && (whole[i - 1] === ' ' || whole[i - 1] === '\t')) i -= 1;
  return i === 0 || whole[i - 1] === '\n' || whole[i - 1] === ',';
}

function isPostalCity(prefix: string | undefined, code: string, city: string, precededByLineStart: boolean): boolean {
  const cityWord = city.split(/[\s-]/)[0]!.toLowerCase().replace(/[^a-zäöüß]/g, '');
  if (UNIT_WORDS.has(cityWord)) return false;
  if (prefix) return true;
  if (code.length === 5) return true;
  // Vierstellig (AT/CH): nicht bei Jahreszahlen und nur am Zeilenanfang/nach Komma.
  const n = Number(code);
  if (n >= 1900 && n <= 2099) return false;
  return precededByLineStart;
}

// --- Namen ------------------------------------------------------------------

/**
 * „Herr Müller“, „Frau Dr. Schmidt“, „Mr. Smith“: die Anrede bleibt, der Name
 * wird ersetzt. Ein zweites großgeschriebenes Wort zählt nur zum Namen, wenn
 * danach ein Satzzeichen/Zeilenende folgt — deutsche Substantive
 * („Frau Schmidt Bescheid geben“) bleiben so stehen.
 */
const TITLE_NAME_PATTERN = new RegExp(
  `\\b(Herrn?|Frau|Hr\\.|Fr\\.|Mr\\.?|Mrs\\.?|Ms\\.?|Miss)([ \\t]+(?:(?:Dr|Prof)\\.[ \\t]+)?)([A-ZÄÖÜ][${LETTER}'’-]+(?:[ \\t]+[A-ZÄÖÜ][${LETTER}'’-]+(?=[ \\t]*(?:[,.;:!?)]|$)))?)`,
  'gm',
);

/** Jeder Hinweis kostet einen Durchlauf über den Text: Anzahl und Länge begrenzen. */
const MAX_NAME_HINTS = 300;
const MAX_NAME_HINT_LENGTH = 200;
const MAX_NAME_VARIANTS = 600;

function collectNameVariants(names: readonly (string | null | undefined)[] | undefined): string[] {
  const full = new Set<string>();
  const parts = new Set<string>();
  for (const raw of (names ?? []).slice(0, MAX_NAME_HINTS)) {
    let value = String(raw ?? '')
      .slice(0, MAX_NAME_HINT_LENGTH)
      .replace(/<[^>]*>/g, ' ')
      .replace(/["'„“”«»]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!value) continue;
    // E-Mail-Adresse als Hinweis: Lokalteil „max.mustermann“ → „max mustermann“.
    if (value.includes('@')) {
      const local = value.split('@')[0] ?? '';
      if (!/[._-]/.test(local)) continue;
      value = local.replace(/[._-]+/g, ' ').replace(/\d+/g, ' ').trim();
      if (!value) continue;
    }
    // „Mustermann, Max“ → beide Reihenfolgen
    const commaParts = value.split(',').map((p) => p.trim()).filter(Boolean);
    if (commaParts.length === 2) full.add(`${commaParts[1]} ${commaParts[0]}`);
    if (value.length >= 2 && !NAME_PART_STOPWORDS.has(value.toLowerCase())) full.add(value);
    for (const part of value.split(/[\s,]+/)) {
      const cleaned = part.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (cleaned.length < 3) continue;
      if (NAME_PART_STOPWORDS.has(cleaned.toLowerCase())) continue;
      parts.add(cleaned);
    }
  }
  // Lange Varianten zuerst, damit „Max Mustermann“ vor „Max“ ersetzt wird.
  return [...new Set([...full, ...parts])]
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_NAME_VARIANTS);
}

function redactNames(text: string, names: readonly (string | null | undefined)[] | undefined, keep: Keeper): string {
  const variants = collectNameVariants(names);
  let out = text;
  for (const variant of variants) {
    // Mehrteilige Namen ohne Rücksicht auf Groß-/Kleinschreibung; einzelne
    // Bestandteile nur in der Schreibweise des Hinweises bzw. in Großbuchstaben
    // („Max“ ja, „max. 5 Stück“ nein).
    const multiWord = /\s/.test(variant);
    const source = escapeRegExp(variant).replace(/\\? /g, '\\s+');
    const capitalized = variant.charAt(0).toUpperCase() + variant.slice(1);
    const spellings = [capitalized, variant.toUpperCase()];
    if (variant !== variant.toLowerCase()) spellings.push(variant);
    const alternatives = multiWord
      ? source
      : [...new Set(spellings)].map(escapeRegExp).join('|');
    const pattern = new RegExp(
      `(?<![\\p{L}\\p{N}\\[])(?:${alternatives})(?![\\p{L}\\p{N}\\]])`,
      multiWord ? 'giu' : 'gu',
    );
    out = out.replace(pattern, (match) => (keep(match) ? match : P.name));
  }
  return out;
}

/** Kollabiert „[Name] [Name]“ zu einem Platzhalter. */
function collapsePlaceholders(text: string): string {
  let out = text;
  for (const placeholder of Object.values(P)) {
    const escaped = escapeRegExp(placeholder);
    out = out.replace(new RegExp(`${escaped}(?:[ \\t]+${escaped})+`, 'g'), placeholder);
  }
  return out;
}

/**
 * Ersetzt personenbezogene Daten durch Platzhalter ([E-Mail], [Telefon],
 * [IBAN], [BIC], [Link], [Adresse], [Nummer], [Name]).
 */
export function redactPersonalData(text: string, hints: RedactionHints = {}): string {
  let out = String(text ?? '');
  if (!out.trim()) return out;
  const keep = makeKeeper(hints.keepExisting);
  const urlMode = hints.urlMode ?? 'full';

  out = replaceWith(out, URL_PATTERN, keep, (url) => redactUrl(url, urlMode));
  out = replaceWith(out, EMAIL_PATTERN, keep, () => P.email);
  out = replaceWith(out, IBAN_PATTERN, keep, (match) => (countDigits(match) >= 10 ? P.iban : null));
  out = replaceWith(out, BIC_KEYWORD_PATTERN, keep, (_m, g) => `${g[0]}${g[1]}${P.bic}`);
  out = replaceWith(out, BIC_BARE_PATTERN, keep, (match) =>
    /\d/.test(match.slice(6)) || match.endsWith('XXX') ? P.bic : null);
  out = replaceWith(out, TICKET_CODE_PATTERN, keep, () => P.number);
  out = out.replace(NUMBER_KEYWORD_PATTERN, (match, keyword: string, sep: string, value: string, offset: number, whole: string) => {
    if (keep(match)) return match;
    const after = whole.slice(offset + match.length, offset + match.length + 2);
    // Preise („Rechnung: 1.299,00 €“) und Datumsangaben sind keine Kennungen.
    if (/^\d{1,3}(?:\.\d{3})+$/.test(value) && /^,\d/.test(after)) return match;
    if (/^\d{1,2}\.\d{1,2}\.(?:\d{2,4})?$/.test(value)) return match;
    const explicit = /[:#]|nr|no|nummer|number/i.test(sep) || /nr|nummer|number|no\.?$|id$/i.test(keyword);
    // Nur echte Kennungen, keine Wörter oder Mengen („Order 100 pieces“).
    if (countDigits(value) < (explicit ? 3 : 4)) return match;
    return `${keyword}${sep}${P.number}`;
  });
  out = replaceWith(out, HASH_NUMBER_PATTERN, keep, (_m, g) => `${g[0]}#${P.number}`);
  out = replaceWith(out, PHONE_KEYWORD_PATTERN, keep, (_m, g) =>
    countDigits(g[2] ?? '') >= 5 ? `${g[0]}${g[1]}${P.phone}` : null);
  // E.164: höchstens 15 Ziffern (+ „00“-Präfix); längere Folgen sind Sendungsnummern.
  out = replaceWith(out, PHONE_INTERNATIONAL_PATTERN, keep, (match) => {
    const digits = countDigits(match);
    const max = match.trimStart().startsWith('+') ? 15 : 17;
    return digits >= 8 && digits <= max ? P.phone : null;
  });
  out = replaceWith(out, PHONE_NATIONAL_PATTERN, keep, (match) => {
    const digits = countDigits(match);
    return digits >= 7 && digits <= 15 ? P.phone : null;
  });
  out = replaceWith(out, STREET_PATTERN, keep, () => P.address);
  out = replaceWith(out, ENGLISH_STREET_PATTERN, keep, () => P.address);
  out = out.replace(POSTAL_CITY_PATTERN, (match, lead: string, prefix: string | undefined, code: string, city: string, offset: number, whole: string) => {
    const body = match.slice(lead.length);
    if (keep(body)) return match;
    if (!isPostalCity(prefix, code, city, startsLineOrFollowsComma(whole, offset + lead.length))) return match;
    return `${lead}${P.address}`;
  });
  out = replaceWith(out, LONG_DIGITS_PATTERN, keep, () => P.number);
  out = redactNames(out, hints.names, keep);
  out = replaceWith(out, TITLE_NAME_PATTERN, keep, (_m, g) => {
    const name = g[2] ?? '';
    if (NAME_PART_STOPWORDS.has(name.toLowerCase())) return null;
    return `${g[0]}${g[1]}${P.name}`;
  });
  return collapsePlaceholders(out);
}

/**
 * Nur für den Laufzeit-Test (tests/unit/ai-learnings-redos.test.ts): jedes
 * Muster wird dort einzeln gegen entartete Eingaben gemessen.
 */
export const LEARNING_REDACTION_PATTERNS_FOR_TESTS: Readonly<Record<string, RegExp>> = {
  url: URL_PATTERN,
  email: EMAIL_PATTERN,
  iban: IBAN_PATTERN,
  bicKeyword: BIC_KEYWORD_PATTERN,
  bicBare: BIC_BARE_PATTERN,
  numberKeyword: NUMBER_KEYWORD_PATTERN,
  hashNumber: HASH_NUMBER_PATTERN,
  ticketCode: TICKET_CODE_PATTERN,
  longDigits: LONG_DIGITS_PATTERN,
  phoneKeyword: PHONE_KEYWORD_PATTERN,
  phoneInternational: PHONE_INTERNATIONAL_PATTERN,
  phoneNational: PHONE_NATIONAL_PATTERN,
  street: STREET_PATTERN,
  englishStreet: ENGLISH_STREET_PATTERN,
  postalCity: POSTAL_CITY_PATTERN,
  titleName: TITLE_NAME_PATTERN,
};
