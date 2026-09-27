/**
 * Wissensbasis als Folge von `##`-Abschnitten (TA-P5). Eine Wissensbasis ist
 * ein Markdown-Dokument; Einträge sind `##`-Abschnitte. Unveränderte Abschnitte
 * behalten beim Zusammensetzen ihren Originaltext, damit die Änderungsansicht
 * nur echte Änderungen zeigt.
 */

export type KnowledgeSection = {
  title: string;
  /** Inhalt ohne Überschriftszeile, ohne umgebende Leerzeilen. */
  content: string;
  /** Originaltext (Überschrift bis vor die nächste), solange unverändert. */
  raw?: string;
};

export type KnowledgeSectionDocument = {
  /** Alles vor dem ersten `##` (z. B. `# Titel` und Einleitung). */
  preamble: string;
  sections: KnowledgeSection[];
};

export type KnowledgeOperationKind = 'add' | 'update' | 'delete';

export type KnowledgeOperation = {
  op: KnowledgeOperationKind;
  section: string;
  content?: string;
  reason?: string;
};

export type AppliedKnowledgeOperation = KnowledgeOperation & {
  /** Was tatsächlich passiert ist (update auf unbekannten Titel → added). */
  result: 'added' | 'updated' | 'appended' | 'deleted' | 'skipped';
};

/**
 * Titel einer Markdown-Überschrift mit genau min–max Rauten, sonst null.
 * Linear statt eines Regex mit faulem Titel-Muster (quadratisch bei langen Leerzeilen, CodeQL).
 */
function markdownHeadingTitle(line: string, minHashes: number, maxHashes: number): string | null {
  let hashes = 0;
  while (hashes < line.length && line[hashes] === '#') hashes += 1;
  if (hashes < minHashes || hashes > maxHashes) return null;
  let start = hashes;
  while (start < line.length && (line[start] === ' ' || line[start] === '\t')) start += 1;
  if (start === hashes) return null;
  // `.` im alten Muster traf keine Zeilentrenner.
  if (line.includes('\u2028') || line.includes('\u2029')) return null;
  let end = line.length;
  while (end > start && (line[end - 1] === ' ' || line[end - 1] === '\t' || line[end - 1] === '#')) end -= 1;
  if (end > start) return line.slice(start, end);
  // Das alte Titel-Muster verlangte mindestens ein Zeichen:
  if (start < line.length) return line[start]!; // „## #“ → „#“
  return start - hashes >= 2 ? line[start - 1]! : null; // „##  “ → „ “, „## “ → keine Überschrift
}
const FENCE_PATTERN = /^[ \t]*(```|~~~)/;

/** Schließt einen am Textende noch offenen Codeblock (``` oder ~~~). */
export function closeUnterminatedKnowledgeFence(text: string): string {
  let fence: string | null = null;
  for (const line of text.split('\n')) {
    const match = FENCE_PATTERN.exec(line);
    if (!match) continue;
    if (fence === null) fence = match[1]!;
    else if (fence === match[1]) fence = null;
  }
  return fence === null ? text : `${text.replace(/\n*$/, '')}\n${fence}`;
}

/**
 * Abschnittsanfänge. Ein Codeblock, der bis zum Dokumentende offen bleibt
 * (kaputter KI-Inhalt), endet ersatzweise an der nächsten `## `-Überschrift —
 * sonst verschwänden alle folgenden Abschnitte. Dokumente mit geschlossenen
 * Codeblöcken werden unverändert gelesen.
 */
function findSectionStarts(lines: readonly string[]): { line: number; title: string }[] {
  const lenientOpeners = new Set<number>();
  for (;;) {
    const starts: { line: number; title: string }[] = [];
    let fence: string | null = null;
    let opener = -1;
    let lenient = false;
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]!;
      const fenceMatch = FENCE_PATTERN.exec(line);
      if (fenceMatch) {
        if (fence === null) {
          fence = fenceMatch[1]!;
          opener = i;
          lenient = lenientOpeners.has(i);
        } else if (fence === fenceMatch[1]) {
          fence = null;
        }
        continue;
      }
      if (fence !== null) {
        if (!(lenient && markdownHeadingTitle(line, 2, 2) !== null)) continue;
        fence = null;
      }
      const heading = markdownHeadingTitle(line, 2, 2);
      if (heading !== null) starts.push({ line: i, title: heading.trim() });
    }
    if (fence === null || lenient) return starts;
    lenientOpeners.add(opener);
  }
}

/** Vergleichsschlüssel für Abschnittstitel (Groß-/Kleinschreibung, Leerzeichen). */
export function normalizeKnowledgeSectionTitle(title: string): string {
  return String(title ?? '')
    .replace(/^#+\s*/, '')
    .replace(/[\s\u00a0]+/g, ' ')
    .trim()
    .replace(/[:.]+$/, '')
    .trim()
    .toLocaleLowerCase('de-DE');
}

export function parseKnowledgeSections(markdown: string): KnowledgeSectionDocument {
  const text = String(markdown ?? '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const starts = findSectionStarts(lines);
  if (starts.length === 0) return { preamble: text, sections: [] };

  // Jeder Teil trägt den Zeilenumbruch hinter sich: preamble + raw₁ + raw₂ …
  // ergibt wieder exakt das Original.
  const joinLines = (from: number, to: number) =>
    lines.slice(from, to).join('\n') + (to < lines.length ? '\n' : '');
  const preamble = starts[0]!.line > 0 ? joinLines(0, starts[0]!.line) : '';
  const sections: KnowledgeSection[] = starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1]!.line : lines.length;
    const raw = joinLines(start.line, end);
    const content = lines.slice(start.line + 1, end).join('\n').trim();
    return { title: start.title, content, raw };
  });
  return { preamble, sections };
}

/** Titel der `##`-Abschnitte, die in `after` fehlen (Vergleich über normalizeKnowledgeSectionTitle). */
export function removedKnowledgeSectionTitles(before: string, after: string): string[] {
  const remaining = new Set(parseKnowledgeSections(after).sections.map((section) => normalizeKnowledgeSectionTitle(section.title)));
  const removed: string[] = [];
  const seen = new Set<string>();
  for (const section of parseKnowledgeSections(before).sections) {
    const key = normalizeKnowledgeSectionTitle(section.title);
    if (remaining.has(key) || seen.has(key)) continue;
    seen.add(key);
    removed.push(section.title);
  }
  return removed;
}

function renderSection(section: KnowledgeSection): string {
  const body = closeUnterminatedKnowledgeFence(section.content.trim());
  return body ? `## ${section.title.trim()}\n\n${body}\n` : `## ${section.title.trim()}\n`;
}

export function serializeKnowledgeSections(doc: KnowledgeSectionDocument): string {
  let out = doc.preamble ?? '';
  let previousRendered = false;
  for (const section of doc.sections) {
    if (section.raw !== undefined) {
      if (previousRendered) out += '\n';
      out += section.raw;
      previousRendered = false;
      continue;
    }
    // Neue/geänderte Abschnitte mit einer Leerzeile absetzen.
    if (out.trim()) out = out.replace(/\n*$/, '\n\n');
    else out = '';
    out += renderSection(section);
    previousRendered = true;
  }
  return out;
}

/**
 * Bereitet KI-Inhalt für einen Abschnitt auf: eine führende Überschrift mit
 * demselben Titel entfällt, `#`/`##`-Überschriften im Inhalt werden zu `###`,
 * damit die Abschnittsstruktur erhalten bleibt.
 */
export function normalizeKnowledgeSectionContent(content: string, title?: string): string {
  let lines = String(content ?? '').replace(/\r\n?/g, '\n').split('\n');
  const firstIdx = lines.findIndex((line) => line.trim());
  if (firstIdx >= 0) {
    const first = markdownHeadingTitle(lines[firstIdx]!, 1, 6);
    if (first !== null && (title === undefined || normalizeKnowledgeSectionTitle(first) === normalizeKnowledgeSectionTitle(title))) {
      lines = lines.slice(firstIdx + 1);
    }
  }
  let fence: string | null = null;
  lines = lines.map((line) => {
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]!;
      else if (fence === fenceMatch[1]) fence = null;
      return line;
    }
    if (fence !== null) return line;
    return line.replace(/^#{1,2}(?=[ \t])/, '###');
  });
  return closeUnterminatedKnowledgeFence(lines.join('\n').trim());
}

/**
 * Wendet KI-Operationen auf das Dokument an. update/delete finden Abschnitte
 * per Titel (tolerant). update auf unbekannten Titel legt den Abschnitt an;
 * add auf einen vorhandenen Titel hängt den Inhalt an (statt zu duplizieren).
 * Neue Abschnitte kommen ans Ende, die übrige Reihenfolge bleibt stabil.
 */
export function applyKnowledgeOperations(
  markdown: string,
  operations: readonly KnowledgeOperation[],
): { content: string; applied: AppliedKnowledgeOperation[]; structureError?: string } {
  const doc = parseKnowledgeSections(markdown);
  const applied: AppliedKnowledgeOperation[] = [];
  const indexOf = (title: string) => {
    const key = normalizeKnowledgeSectionTitle(title);
    return doc.sections.findIndex((section) => normalizeKnowledgeSectionTitle(section.title) === key);
  };

  for (const operation of operations) {
    const title = String(operation.section ?? '').replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim();
    if (!title) {
      applied.push({ ...operation, result: 'skipped' });
      continue;
    }
    const content = normalizeKnowledgeSectionContent(operation.content ?? '', title);
    const index = indexOf(title);

    if (operation.op === 'delete') {
      if (index < 0) {
        applied.push({ ...operation, result: 'skipped' });
        continue;
      }
      doc.sections.splice(index, 1);
      applied.push({ ...operation, result: 'deleted' });
      continue;
    }

    if (!content) {
      applied.push({ ...operation, result: 'skipped' });
      continue;
    }

    if (index < 0) {
      doc.sections.push({ title, content });
      applied.push({ ...operation, section: title, result: 'added' });
      continue;
    }

    const existing = doc.sections[index]!;
    if (operation.op === 'update') {
      if (existing.content.trim() === content) {
        applied.push({ ...operation, result: 'skipped' });
        continue;
      }
      doc.sections[index] = { title: existing.title, content };
      applied.push({ ...operation, result: 'updated' });
      continue;
    }

    // add auf vorhandenen Titel: anhängen, falls nicht schon enthalten.
    if (existing.content.includes(content)) {
      applied.push({ ...operation, result: 'skipped' });
      continue;
    }
    doc.sections[index] = {
      title: existing.title,
      content: existing.content.trim() ? `${existing.content.trimEnd()}\n\n${content}` : content,
    };
    applied.push({ ...operation, result: 'appended' });
  }

  const content = serializeKnowledgeSections(doc);
  // Schutz gegen verschluckte oder erfundene Überschriften: das Ergebnis muss
  // genau die Abschnitte enthalten, die nach den Operationen erwartet werden.
  const comparable = (title: string) => normalizeKnowledgeSectionTitle(title).replace(/[ \t#]+$/, '');
  const expected = doc.sections.map((section) => comparable(section.title));
  const actual = parseKnowledgeSections(content).sections.map((section) => comparable(section.title));
  const structureError = expected.length === actual.length && expected.every((title, index) => title === actual[index])
    ? undefined
    : `Abschnitte stimmen nach dem Anwenden nicht (erwartet ${expected.length}, gefunden ${actual.length}).`;
  return { content, applied, ...(structureError ? { structureError } : {}) };
}
