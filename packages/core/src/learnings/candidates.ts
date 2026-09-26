/**
 * Aufbereitung gesammelter Learnings (TA-P5): Aus gesendeter Antwort,
 * KI-Schnappschuss und Eltern-Mail wird ein bereinigter Kandidat. Gespeichert
 * wird nur, was hier herauskommt — ohne Zitat, Signatur, Anrede/Gruß und mit
 * ersetzten personenbezogenen Daten.
 */
import {
  cleanLearningSubject,
  computeLearningTextChangeRatio,
  LEARNING_NOTE_MAX_LENGTH,
  LEARNING_TEXT_MAX_LENGTH,
  LEARNINGS_MIN_CHANGE_RATIO,
  truncateLearningText,
  type LearningCandidateKind,
} from './digest';
import { redactPersonalData, type RedactionHints } from './redact';
import {
  clampLearningSource,
  extractLearningReplyText,
  LEARNING_SOURCE_HTML_MAX_LENGTH,
  learningHtmlToText,
  stripReplyNoise,
} from './reply-noise';

export type PreparedLearningCandidate = {
  kind: LearningCandidateKind;
  questionText: string | null;
  aiText: string | null;
  humanText: string | null;
  noteText: string | null;
  /** Nur für draft_edit: Änderungsquote KI-Entwurf ↔ gesendete Fassung. */
  changeRatio?: number;
};

export type SentLearningSource = {
  /** KI-Schnappschuss des Entwurfs (null/leer = kein KI-Entwurf). */
  aiSnapshot?: string | null;
  sentText?: string | null;
  sentHtml?: string | null;
  parentSubject?: string | null;
  parentText?: string | null;
  parentHtml?: string | null;
  /** Namen für die Bereinigung (Absender/Empfänger, CRM-Kunde, eigener Name). */
  names?: readonly (string | null | undefined)[];
  minChangeRatio?: number;
};

function isEncrypted(text: string): boolean {
  return /-----BEGIN PGP (?:MESSAGE|SIGNED MESSAGE)-----/.test(text);
}

function sanitize(text: string, hints: RedactionHints, max = LEARNING_TEXT_MAX_LENGTH): string {
  return truncateLearningText(redactPersonalData(text, hints), max);
}

/** Frage-Text aus der Eltern-Mail: Betreff + Inhalt ohne Zitat/Signatur. */
export function buildLearningQuestionText(
  input: { subject?: string | null; text?: string | null; html?: string | null },
  hints: RedactionHints,
): string {
  // Vor jeder Verarbeitung hart kürzen: Eltern-Mails sind fremder, beliebig langer Inhalt.
  const subject = cleanLearningSubject(clampLearningSource(input.subject, 1000));
  const text = clampLearningSource(input.text);
  const bodySource = text.trim()
    ? text
    : clampLearningSource(learningHtmlToText(clampLearningSource(input.html, LEARNING_SOURCE_HTML_MAX_LENGTH)));
  const body = isEncrypted(bodySource) ? '' : stripReplyNoise(bodySource);
  const combined = [subject ? `Betreff: ${subject}` : '', body].filter(Boolean).join('\n\n');
  return sanitize(combined, hints);
}

/**
 * Kandidat aus einer gesendeten Antwort. Mit KI-Schnappschuss → draft_edit
 * (nur wenn der Mensch mehr als minChangeRatio geändert hat), sonst
 * human_reply (die Aufrufer prüfen vorher, dass ein Mensch gesendet hat).
 * null = nichts zu lernen.
 */
export function prepareSentLearningCandidate(source: SentLearningSource): PreparedLearningCandidate | null {
  const hints: RedactionHints = { names: source.names ?? [] };
  const rawSent = clampLearningSource(source.sentText);
  if (isEncrypted(rawSent)) return null;
  const human = extractLearningReplyText({ text: source.sentText, html: source.sentHtml });
  if (!human.trim()) return null;

  const snapshot = clampLearningSource(source.aiSnapshot).trim();
  const question = buildLearningQuestionText(
    { subject: source.parentSubject, text: source.parentText, html: source.parentHtml },
    hints,
  );

  if (snapshot) {
    const ai = stripReplyNoise(snapshot) || snapshot;
    const ratio = computeLearningTextChangeRatio(ai, human);
    if (ratio <= (source.minChangeRatio ?? LEARNINGS_MIN_CHANGE_RATIO)) return null;
    return {
      kind: 'draft_edit',
      questionText: question || null,
      aiText: sanitize(ai, hints) || null,
      humanText: sanitize(human, hints) || null,
      noteText: null,
      changeRatio: ratio,
    };
  }

  // Menschliche Antwort ohne Frage ist kein brauchbares Learning.
  if (!question) return null;
  return {
    kind: 'human_reply',
    questionText: question,
    aiText: null,
    humanText: sanitize(human, hints) || null,
    noteText: null,
  };
}

/** Kandidat aus „Learning notieren“ (optional mit Bezug auf eine Mail). */
export function prepareNoteLearningCandidate(input: {
  note: string;
  questionSubject?: string | null;
  questionText?: string | null;
  questionHtml?: string | null;
  names?: readonly (string | null | undefined)[];
}): PreparedLearningCandidate | null {
  const hints: RedactionHints = { names: input.names ?? [] };
  const note = sanitize(clampLearningSource(input.note), hints, LEARNING_NOTE_MAX_LENGTH);
  if (!note.trim()) return null;
  const hasQuestion = Boolean(
    String(input.questionSubject ?? '').trim()
    || String(input.questionText ?? '').trim()
    || String(input.questionHtml ?? '').trim(),
  );
  const question = hasQuestion
    ? buildLearningQuestionText(
      { subject: input.questionSubject, text: input.questionText, html: input.questionHtml },
      hints,
    )
    : '';
  return {
    kind: 'note',
    questionText: question || null,
    aiText: null,
    humanText: null,
    noteText: note,
  };
}

/** Namen aus einem Adress-JSON ({ value: [{ name, address }] } oder Liste). */
export function learningNamesFromAddressJson(value: unknown): string[] {
  let parsed: unknown = value;
  if (typeof parsed === 'string') {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  const list = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as { value?: unknown }).value)
      ? (parsed as { value: unknown[] }).value
      : [];
  const out: string[] = [];
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as { name?: unknown; address?: unknown };
    if (typeof record.name === 'string' && record.name.trim()) out.push(record.name.trim());
    if (typeof record.address === 'string' && record.address.trim()) out.push(record.address.trim());
  }
  return out;
}
