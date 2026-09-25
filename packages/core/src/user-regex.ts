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
