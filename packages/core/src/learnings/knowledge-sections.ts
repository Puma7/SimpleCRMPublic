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

const HEADING_PATTERN = /^##(?!#)[ \t]+(.+?)[ \t#]*$/;
const FENCE_PATTERN = /^[ \t]*(```|~~~)/;

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
  const starts: { line: number; title: string }[] = [];
  let fence: string | null = null;
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const fenceMatch = FENCE_PATTERN.exec(line);
    if (fenceMatch) {
      if (fence === null) fence = fenceMatch[1]!;
      else if (fence === fenceMatch[1]) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const heading = HEADING_PATTERN.exec(line);
    if (heading) starts.push({ line: i, title: heading[1]!.trim() });
  }
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

function renderSection(section: KnowledgeSection): string {
  const body = section.content.trim();
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
    const first = /^#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(lines[firstIdx]!);
    if (first && (title === undefined || normalizeKnowledgeSectionTitle(first[1]!) === normalizeKnowledgeSectionTitle(title))) {
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
  return lines.join('\n').trim();
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
): { content: string; applied: AppliedKnowledgeOperation[] } {
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

  return { content: serializeKnowledgeSections(doc), applied };
}
