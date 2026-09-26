/**
 * Learnings-Auswertung (TA-P5): gemeinsame Kernlogik für Desktop und Server.
 * Kandidaten auswählen, Prompt bauen, KI-Antwort robust parsen, Ausgabe erneut
 * bereinigen und die Operationen auf die Wissensbasis anwenden. Persistenz und
 * der eigentliche KI-Aufruf bleiben in den Editionen.
 */
import {
  applyKnowledgeOperations,
  type AppliedKnowledgeOperation,
  type KnowledgeOperation,
  type KnowledgeOperationKind,
} from './knowledge-sections';
import { redactPersonalData } from './redact';

export const LEARNING_CANDIDATE_KINDS = ['draft_edit', 'human_reply', 'note'] as const;
export type LearningCandidateKind = (typeof LEARNING_CANDIDATE_KINDS)[number];

export const LEARNING_DIGEST_STATUSES = ['pending', 'accepted', 'rejected', 'failed'] as const;
export type LearningDigestStatus = (typeof LEARNING_DIGEST_STATUSES)[number];

export const LEARNING_DIGEST_TRIGGERS = ['manual', 'workflow'] as const;
export type LearningDigestTrigger = (typeof LEARNING_DIGEST_TRIGGERS)[number];

export const LEARNINGS_DIGEST_PERIODS = ['since_last', 'day', 'week', 'month'] as const;
export type LearningsDigestPeriod = (typeof LEARNINGS_DIGEST_PERIODS)[number];

/** Ergebnis eines Auswertungs-Auftrags (Knoten-Ausgabe `learnings.status`). */
export const LEARNINGS_DIGEST_RESULT_STATUSES = [
  'queued',
  'created',
  'skipped_no_candidates',
  'skipped_pending',
  'failed',
] as const;
export type LearningsDigestResultStatus = (typeof LEARNINGS_DIGEST_RESULT_STATUSES)[number];

export const LEARNINGS_SETTING_KEYS = {
  collectEnabled: 'learnings_collect_enabled',
  targetKnowledgeBaseId: 'learnings_target_kb_id',
  profileId: 'learnings_profile_id',
} as const;

/** Name/Kontext der Wissensbasis, die angelegt wird, wenn kein Ziel gewählt ist. */
export const LEARNINGS_DEFAULT_KB_NAME = 'Learnings';
export const LEARNINGS_DEFAULT_KB_CONTEXT = 'general';
export const LEARNINGS_DEFAULT_KB_DOCUMENT =
  '# Learnings\n\nAllgemeine Regeln und Fakten aus freigegebenen Learnings (Einstellungen → Learnings).\n';

export const LEARNING_TEXT_MAX_LENGTH = 4000;
export const LEARNING_NOTE_MAX_LENGTH = 4000;
export const LEARNINGS_MIN_CHANGE_RATIO = 0.05;
export const LEARNINGS_DIGEST_MAX_CANDIDATES = 200;
export const LEARNINGS_DIGEST_MAX_TOTAL_CHARS = 60_000;
export const LEARNINGS_DEFAULT_MIN_CANDIDATES = 3;
export const LEARNINGS_CANDIDATE_RETENTION_DAYS = 90;
/** Obergrenze der Wissensbasis (Server-Route PUT …/document). */
export const LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH = 100_000;
export const LEARNINGS_MAX_OPERATIONS = 30;
export const LEARNINGS_MAX_OPERATION_CONTENT = 6000;
export const LEARNINGS_MAX_SECTION_TITLE = 200;
export const LEARNINGS_MAX_SUMMARY = 2000;
export const LEARNINGS_MAX_ERROR = 1000;

export function isLearningCandidateKind(value: unknown): value is LearningCandidateKind {
  return typeof value === 'string' && (LEARNING_CANDIDATE_KINDS as readonly string[]).includes(value);
}

export function isLearningsDigestPeriod(value: unknown): value is LearningsDigestPeriod {
  return typeof value === 'string' && (LEARNINGS_DIGEST_PERIODS as readonly string[]).includes(value);
}

export function normalizeLearningsDigestPeriod(value: unknown): LearningsDigestPeriod {
  return isLearningsDigestPeriod(value) ? value : 'since_last';
}

export function normalizeLearningsMinCandidates(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (!Number.isFinite(n) || n < 1) return LEARNINGS_DEFAULT_MIN_CANDIDATES;
  return Math.min(LEARNINGS_DIGEST_MAX_CANDIDATES, Math.floor(n));
}

/** Setting-Wert „an“ (sync_info speichert Strings). */
export function isLearningsCollectEnabledValue(value: string | null | undefined): boolean {
  const v = String(value ?? '').trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'on' || v === 'yes';
}

/**
 * Beginn des Auswertungszeitraums. `since_last` = seit der letzten Auswertung
 * dieser Wissensbasis (null = alles Unverarbeitete).
 */
export function learningsPeriodStart(
  period: LearningsDigestPeriod,
  now: Date,
  lastDigestAt?: Date | null,
): Date | null {
  const day = 24 * 60 * 60 * 1000;
  switch (period) {
    case 'day':
      return new Date(now.getTime() - day);
    case 'week':
      return new Date(now.getTime() - 7 * day);
    case 'month':
      return new Date(now.getTime() - 30 * day);
    default:
      return lastDigestAt ?? null;
  }
}

/** Cutoff für unverarbeitete Kandidaten (älter → löschen). */
export function learningsRetentionCutoff(now: Date, days = LEARNINGS_CANDIDATE_RETENTION_DAYS): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

function wordSet(text: string): Set<string> {
  return new Set(
    String(text ?? '')
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean),
  );
}

/**
 * Wort-Jaccard-Abstand (0 = gleiche Wörter, 1 = nichts gemeinsam) — Core-
 * Gegenstück zu computeTextChangeRatio (packages/server/src/ai-feedback.ts).
 */
export function computeLearningTextChangeRatio(suggestion: string, sent: string): number {
  const a = wordSet(suggestion);
  const b = wordSet(sent);
  if (a.size === 0 && b.size === 0) return 0;
  if (a.size === 0 || b.size === 0) return 1;
  let intersection = 0;
  for (const word of a) {
    if (b.has(word)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  if (union === 0) return 0;
  return Math.round((1 - intersection / union) * 1000) / 1000;
}

export function truncateLearningText(text: string | null | undefined, max = LEARNING_TEXT_MAX_LENGTH): string {
  const value = String(text ?? '').trim();
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

/** Betreff ohne „AW:/Re:/WG:“-Präfixe und Ticket-Codes. */
export function cleanLearningSubject(subject: string | null | undefined): string {
  let value = String(subject ?? '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 5; i += 1) {
    const next = value.replace(/^(?:re|aw|wg|fw|fwd|antw|sv|vs)\s*(?:\[\d+\])?\s*:\s*/i, '');
    if (next === value) break;
    value = next;
  }
  return value.replace(/\[[A-Z0-9]{1,12}-[A-Z0-9]{1,20}\]/gi, '').replace(/\s+/g, ' ').trim();
}

// --- Auswahl ------------------------------------------------------------------

export type LearningCandidateForDigest = {
  id: number;
  kind: LearningCandidateKind;
  questionText: string | null;
  aiText: string | null;
  humanText: string | null;
  noteText: string | null;
  createdAt: string;
};

function candidateSize(candidate: LearningCandidateForDigest): number {
  return (candidate.questionText?.length ?? 0)
    + (candidate.aiText?.length ?? 0)
    + (candidate.humanText?.length ?? 0)
    + (candidate.noteText?.length ?? 0);
}

/**
 * Nimmt die neuesten Kandidaten (Eingabe: neueste zuerst) bis zur
 * Höchstanzahl und Gesamtlänge. Zu große Einzelkandidaten werden übersprungen.
 */
export function selectLearningCandidatesForDigest<T extends LearningCandidateForDigest>(
  candidates: readonly T[],
  limits: { maxCount?: number; maxTotalChars?: number } = {},
): T[] {
  const maxCount = limits.maxCount ?? LEARNINGS_DIGEST_MAX_CANDIDATES;
  const maxTotal = limits.maxTotalChars ?? LEARNINGS_DIGEST_MAX_TOTAL_CHARS;
  const out: T[] = [];
  let total = 0;
  for (const candidate of candidates) {
    if (out.length >= maxCount) break;
    const size = candidateSize(candidate);
    if (total + size > maxTotal) continue;
    out.push(candidate);
    total += size;
  }
  return out;
}

// --- Prompt -------------------------------------------------------------------

const KIND_LABELS: Record<LearningCandidateKind, string> = {
  draft_edit: 'KI-Entwurf, vom Menschen geändert',
  human_reply: 'Antwort eines Mitarbeiters',
  note: 'Notiz eines Mitarbeiters',
};

export function learningCandidateKindLabel(kind: LearningCandidateKind): string {
  return KIND_LABELS[kind];
}

export const LEARNINGS_DIGEST_SYSTEM_PROMPT = [
  'Du pflegst die Wissensbasis eines Unternehmens, die KI-Bausteine beim Beantworten von E-Mails lesen.',
  'Du bekommst die aktuelle Wissensbasis (Markdown, Einträge sind ##-Abschnitte) und neue Beobachtungen:',
  'geänderte KI-Entwürfe (KI-Fassung und gesendete Fassung), Antworten von Mitarbeitern und Notizen.',
  '',
  'Leite daraus nur allgemeine, wiederverwendbare Regeln und Fakten ab: zu Produkten, Preisen, Abläufen,',
  'Fristen, Zuständigkeiten und Tonalität. Einzelfälle, die sich nicht verallgemeinern lassen, lässt du weg.',
  'Schreibe keine personenbezogenen Daten: keine Namen, E-Mail-Adressen, Telefonnummern, Adressen,',
  'Bestell-, Kunden- oder Rechnungsnummern. Platzhalter wie [Name] oder [Nummer] übernimmst du nicht.',
  'Korrigiere bevorzugt vorhandene Abschnitte, statt neue mit ähnlichem Inhalt anzulegen.',
  'Widersprechen sich Wissensbasis und neue Beobachtungen, gilt die neuere Beobachtung; löse den Widerspruch auf.',
  'Ändere nichts, wofür es keine Beobachtung gibt. Wenn nichts Allgemeines zu lernen ist, liefere keine Operationen.',
  '',
  'Antworte ausschließlich mit JSON in diesem Format:',
  '{"summary": "<2-4 Sätze, was du geändert hast und warum>",',
  ' "operations": [',
  '   {"op": "add" | "update" | "delete", "section": "<Abschnittstitel ohne ##>",',
  '    "content": "<kompletter neuer Markdown-Inhalt des Abschnitts ohne Überschrift; bei delete leer>",',
  '    "reason": "<kurze Begründung>"}',
  ' ]}',
  'Bei "update" lieferst du den vollständigen neuen Inhalt des Abschnitts (nicht nur die Änderung).',
  'Verwende für "update" und "delete" exakt die vorhandenen Abschnittstitel.',
].join('\n');

function block(label: string, text: string | null | undefined): string {
  const value = String(text ?? '').trim();
  return value ? `${label}:\n${value}` : '';
}

export function buildLearningsDigestPrompt(input: {
  knowledgeBaseName: string;
  currentDocument: string;
  candidates: readonly LearningCandidateForDigest[];
  maxOperations?: number;
}): { system: string; user: string } {
  const maxOperations = input.maxOperations ?? LEARNINGS_MAX_OPERATIONS;
  const observations = input.candidates.map((candidate, index) => {
    const parts = [
      `### Beobachtung ${index + 1} (${KIND_LABELS[candidate.kind]})`,
      block('Anfrage', candidate.questionText),
      block('KI-Entwurf', candidate.aiText),
      block(candidate.kind === 'draft_edit' ? 'Gesendete Fassung' : 'Antwort', candidate.humanText),
      block('Notiz', candidate.noteText),
    ].filter(Boolean);
    return parts.join('\n');
  });
  const document = input.currentDocument.trim() || '(leer)';
  const user = [
    `Wissensbasis „${input.knowledgeBaseName.trim() || LEARNINGS_DEFAULT_KB_NAME}“ (aktueller Stand):`,
    '<<<WISSENSBASIS',
    document,
    'WISSENSBASIS>>>',
    '',
    `Neue Beobachtungen (${input.candidates.length}):`,
    '',
    observations.join('\n\n'),
    '',
    `Liefere höchstens ${maxOperations} Operationen als JSON.`,
  ].join('\n');
  return { system: LEARNINGS_DIGEST_SYSTEM_PROMPT, user };
}

// --- Parser -------------------------------------------------------------------

export type ParsedLearningsDigest = {
  summary: string;
  operations: KnowledgeOperation[];
};

export type LearningsDigestParseResult =
  | { ok: true; value: ParsedLearningsDigest; discarded: number }
  | { ok: false; error: string };

const OP_ALIASES: Record<string, KnowledgeOperationKind> = {
  add: 'add', create: 'add', insert: 'add', append: 'add', new: 'add', neu: 'add', hinzufuegen: 'add', 'hinzufügen': 'add',
  update: 'update', replace: 'update', edit: 'update', modify: 'update', change: 'update', aendern: 'update', 'ändern': 'update', korrigieren: 'update',
  delete: 'delete', remove: 'delete', drop: 'delete', entfernen: 'delete', loeschen: 'delete', 'löschen': 'delete',
};

/** Codeblöcke und balancierte JSON-Objekte/-Arrays im Text (String-bewusst). */
function extractJsonCandidates(text: string): string[] {
  const out: string[] = [];
  const fence = /```(?:json|JSON)?[ \t]*\n?([\s\S]*?)```/g;
  for (let m = fence.exec(text); m; m = fence.exec(text)) out.push(m[1]!.trim());
  let start = 0;
  while (start < text.length && out.length < 8) {
    const open = text[start];
    if (open !== '{' && open !== '[') {
      start += 1;
      continue;
    }
    const close = open === '{' ? '}' : ']';
    let depth = 0;
    let inString = false;
    let escaped = false;
    let end = -1;
    for (let i = start; i < text.length; i += 1) {
      const ch = text[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    if (end < 0) {
      start += 1;
      continue;
    }
    out.push(text.slice(start, end + 1));
    start = end + 1;
  }
  return out;
}

function asTrimmedString(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

/**
 * Parser für die KI-Antwort `{ summary, operations: [...] }`. Toleriert
 * Codeblöcke und Zusatztext, verwirft Operationen ohne Titel bzw. ohne Inhalt
 * (add/update) und begrenzt Anzahl und Länge.
 */
export function parseLearningsDigestResponse(
  raw: string,
  limits: {
    maxOperations?: number;
    maxContentLength?: number;
    maxTitleLength?: number;
    maxSummaryLength?: number;
  } = {},
): LearningsDigestParseResult {
  const maxOperations = limits.maxOperations ?? LEARNINGS_MAX_OPERATIONS;
  const maxContent = limits.maxContentLength ?? LEARNINGS_MAX_OPERATION_CONTENT;
  const maxTitle = limits.maxTitleLength ?? LEARNINGS_MAX_SECTION_TITLE;
  const maxSummary = limits.maxSummaryLength ?? LEARNINGS_MAX_SUMMARY;
  const text = String(raw ?? '').trim();
  if (!text) return { ok: false, error: 'Leere Antwort der KI' };

  // Bevorzugt das erste JSON mit einer Operationsliste, sonst das erste gültige.
  let parsed: unknown = undefined;
  for (const candidate of extractJsonCandidates(text)) {
    let value: unknown;
    try {
      value = JSON.parse(candidate);
    } catch {
      continue;
    }
    const hasOps = Array.isArray(value)
      || (value !== null && typeof value === 'object'
        && Array.isArray((value as Record<string, unknown>).operations));
    if (parsed === undefined) parsed = value;
    if (hasOps) {
      parsed = value;
      break;
    }
  }
  if (parsed === undefined) return { ok: false, error: 'Antwort der KI enthält kein gültiges JSON' };

  let summary = '';
  let rawOps: unknown;
  if (Array.isArray(parsed)) {
    rawOps = parsed;
  } else if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    summary = asTrimmedString(obj.summary ?? obj.zusammenfassung, maxSummary);
    rawOps = obj.operations ?? obj.ops ?? obj.changes ?? obj.operationen ?? [];
  } else {
    return { ok: false, error: 'Antwort der KI hat ein unerwartetes Format' };
  }
  if (!Array.isArray(rawOps)) return { ok: false, error: 'Antwort der KI enthält keine Liste „operations“' };

  const operations: KnowledgeOperation[] = [];
  let discarded = 0;
  for (const item of rawOps) {
    if (operations.length >= maxOperations) {
      discarded += 1;
      continue;
    }
    if (!item || typeof item !== 'object') {
      discarded += 1;
      continue;
    }
    const obj = item as Record<string, unknown>;
    const opKey = String(obj.op ?? obj.action ?? obj.type ?? '').trim().toLowerCase();
    const op = OP_ALIASES[opKey];
    const section = asTrimmedString(obj.section ?? obj.title ?? obj.heading ?? obj.abschnitt, maxTitle)
      .replace(/^#+\s*/, '')
      .replace(/\s+/g, ' ')
      .trim();
    const content = asTrimmedString(obj.content ?? obj.text ?? obj.markdown ?? obj.inhalt, maxContent);
    const reason = asTrimmedString(obj.reason ?? obj.begruendung ?? obj['begründung'], 500);
    if (!op || !section || (op !== 'delete' && !content)) {
      discarded += 1;
      continue;
    }
    operations.push({
      op,
      section,
      ...(op === 'delete' ? {} : { content }),
      ...(reason ? { reason } : {}),
    });
  }
  return { ok: true, value: { summary, operations }, discarded };
}

// --- Gesamtablauf -------------------------------------------------------------

export type LearningsDigestComputation =
  | {
      ok: true;
      summary: string;
      operations: KnowledgeOperation[];
      applied: AppliedKnowledgeOperation[];
      proposedContent: string;
    }
  | { ok: false; error: string };

function truncateError(message: string): string {
  const value = message.trim() || 'Unbekannter Fehler';
  return value.length > LEARNINGS_MAX_ERROR ? value.slice(0, LEARNINGS_MAX_ERROR) : value;
}

/**
 * Prompt → KI → Parser → Datenschutzfilter → Operationen anwenden. Die
 * Wissensbasis selbst wird hier nie geschrieben; Ergebnis ist der Vorschlag.
 */
export async function computeLearningsDigestProposal(input: {
  knowledgeBaseName: string;
  baseContent: string;
  candidates: readonly LearningCandidateForDigest[];
  chat: (prompt: { system: string; user: string }) => Promise<string>;
  maxDocumentLength?: number;
}): Promise<LearningsDigestComputation> {
  const prompt = buildLearningsDigestPrompt({
    knowledgeBaseName: input.knowledgeBaseName,
    currentDocument: input.baseContent,
    candidates: input.candidates,
  });
  let raw: string;
  try {
    raw = await input.chat(prompt);
  } catch (error) {
    return { ok: false, error: truncateError(`KI-Aufruf fehlgeschlagen: ${error instanceof Error ? error.message : String(error)}`) };
  }
  const parsed = parseLearningsDigestResponse(raw);
  if (!parsed.ok) return { ok: false, error: truncateError(parsed.error) };

  // Ausgabe erneut filtern; Daten, die schon in der Wissensbasis stehen
  // (z. B. die Hotline), bleiben stehen.
  const keepExisting = input.baseContent;
  const operations = parsed.value.operations.map((operation) => ({
    ...operation,
    section: redactPersonalData(operation.section, { keepExisting }),
    ...(operation.content === undefined
      ? {}
      : { content: redactPersonalData(operation.content, { keepExisting }) }),
    ...(operation.reason === undefined ? {} : { reason: redactPersonalData(operation.reason) }),
  }));
  const summary = redactPersonalData(parsed.value.summary);
  const { content, applied } = applyKnowledgeOperations(input.baseContent, operations);
  const maxLength = input.maxDocumentLength ?? LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH;
  if (content.length > maxLength) {
    return {
      ok: false,
      error: `Vorgeschlagene Wissensbasis ist zu lang (${content.length} von höchstens ${maxLength} Zeichen).`,
    };
  }
  return { ok: true, summary, operations, applied, proposedContent: content };
}
