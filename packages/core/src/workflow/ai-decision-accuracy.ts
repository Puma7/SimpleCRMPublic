/**
 * Plan 050: Treffsicherheit der KI-Entscheidung (`ai.decide`).
 *
 * Jede produktive Entscheidung wird als kleines Ereignis ohne Text gespeichert
 * (Server `ai_decision_events`, Desktop gleiche Tabelle). Menschliche
 * Korrekturen werden damit verknüpft; daraus entstehen Übereinstimmung und ein
 * Schwellen-Vorschlag. Nichts ändert das Routing automatisch.
 * Entscheidungen: docs/design/ai-decision-accuracy.md (freigegeben 28.09.2026).
 */
import { aiDecideAnswerForProbability, type AiDecideAnswer } from './ai-decide';

/** Worauf sich „Ja“ bezieht – nur dann werden Korrekturen gezählt. */
export type AiDecisionFeedbackSignal = 'none' | 'spam' | 'human_needed' | 'send_ok';

export const AI_DECISION_FEEDBACK_SIGNALS: readonly AiDecisionFeedbackSignal[] = [
  'none',
  'spam',
  'human_needed',
  'send_ok',
];

export type AiDecisionOverrideKind =
  | 'spam_to_clean'
  | 'clean_to_spam'
  | 'review_to_clean'
  | 'review_to_spam'
  | 'human_reply'
  | 'sent_without_review';

export const AI_DECISION_OVERRIDE_KINDS: readonly AiDecisionOverrideKind[] = [
  'spam_to_clean',
  'clean_to_spam',
  'review_to_clean',
  'review_to_spam',
  'human_reply',
  'sent_without_review',
];

export type AiDecisionTruth = 'ja' | 'nein';

export type AiDecisionOverride = Readonly<{ overrideKind: AiDecisionOverrideKind; truth: AiDecisionTruth }>;

/** Ereignisse werden nach einem Jahr gelöscht. */
export const AI_DECISION_EVENT_RETENTION_DAYS = 365;
/** Korrekturen zählen nur innerhalb von 30 Tagen; danach gilt Ja/Nein als bestätigt. */
export const AI_DECISION_OVERRIDE_WINDOW_DAYS = 30;
/** Erst ab so vielen gelabelten Fällen gibt es einen Schwellen-Vorschlag. */
export const AI_DECISION_MIN_SAMPLES = 30;
/** Höchstens 5 % falsche automatische Antworten beim Vorschlag. */
export const AI_DECISION_MAX_WRONG_RATE = 0.05;
/** Zeitraum der Anzeige im Knoten. */
export const AI_DECISION_STATS_DAYS = 90;

const DAY_MS = 86_400_000;

export function normalizeAiDecisionFeedbackSignal(value: unknown): AiDecisionFeedbackSignal {
  const text = typeof value === 'string' ? value.trim() : '';
  return (AI_DECISION_FEEDBACK_SIGNALS as readonly string[]).includes(text)
    ? (text as AiDecisionFeedbackSignal)
    : 'none';
}

/**
 * Ein Mensch ändert den Spam-Status einer Mail (Rückmeldung `spam`: Ja = Spam).
 * Widerspruch nach Ja/Nein, Klärung nach „Unsicher“; Zustimmung verknüpft nichts
 * (sie zählt nach 30 Tagen ohnehin als bestätigt).
 */
export function overrideForSpamTransition(input: {
  answer: AiDecideAnswer;
  previous: string | null | undefined;
  next: string | null | undefined;
}): AiDecisionOverride | null {
  const next = input.next;
  if (next !== 'clean' && next !== 'spam') return null;
  if (input.previous === next) return null;
  if (input.answer === 'ja' && next === 'clean') return { overrideKind: 'spam_to_clean', truth: 'nein' };
  if (input.answer === 'nein' && next === 'spam') return { overrideKind: 'clean_to_spam', truth: 'ja' };
  if (input.answer === 'unsicher') {
    return next === 'clean'
      ? { overrideKind: 'review_to_clean', truth: 'nein' }
      : { overrideKind: 'review_to_spam', truth: 'ja' };
  }
  return null;
}

/** Ein Mensch beantwortet die Mail (Rückmeldung `human_needed`: Ja = Mensch nötig). */
export function overrideForHumanReply(input: { answer: AiDecideAnswer }): AiDecisionOverride | null {
  return input.answer === 'nein' ? { overrideKind: 'human_reply', truth: 'ja' } : null;
}

/** „Ohne Ausgangsprüfung senden“ (Rückmeldung `send_ok`: Ja = versandfähig). */
export function overrideForReviewSkip(input: { answer: AiDecideAnswer }): AiDecisionOverride | null {
  return input.answer === 'nein' || input.answer === 'unsicher'
    ? { overrideKind: 'sent_without_review', truth: 'ja' }
    : null;
}

export type AiDecisionSample = Readonly<{ probability: number; truth: AiDecisionTruth }>;

/**
 * Kleinste Schwelle (50–99), bei der höchstens `maxWrongRate` der automatischen
 * Antworten (Ja oder Nein, nicht „Unsicher“) falsch wären und mindestens eine
 * automatische Antwort bleibt. Gleiche Regel wie aiDecideAnswerForProbability.
 * Unter `minSamples` gelabelten Fällen kein Vorschlag.
 */
export function suggestAiDecideThreshold(
  samples: readonly AiDecisionSample[],
  options: { maxWrongRate?: number; minSamples?: number } = {},
): number | null {
  const maxWrongRate = options.maxWrongRate ?? AI_DECISION_MAX_WRONG_RATE;
  const minSamples = options.minSamples ?? AI_DECISION_MIN_SAMPLES;
  if (samples.length < minSamples) return null;
  for (let threshold = 50; threshold <= 99; threshold += 1) {
    let automatic = 0;
    let wrong = 0;
    for (const sample of samples) {
      const answer = aiDecideAnswerForProbability(sample.probability, threshold);
      if (answer === 'unsicher') continue;
      automatic += 1;
      if (answer !== sample.truth) wrong += 1;
    }
    if (automatic > 0 && wrong / automatic <= maxWrongRate) return threshold;
  }
  return null;
}

export type AiDecisionEventForStats = Readonly<{
  answer: AiDecideAnswer;
  probability: number | null;
  createdAt: Date | string;
  overrideKind: string | null;
  truth: AiDecisionTruth | null;
  /**
   * Rückmeldungsart beim Entscheiden. `none` (auch unbekannt) zählt nur zur
   * Verteilung: ohne Rückmeldung wird nie eine Korrektur verknüpft, nach
   * 30 Tagen wäre sonst jede Antwort „bestätigt“.
   */
  feedbackSignal: string | null;
}>;

export type AiDecisionStats = Readonly<{
  total: number;
  byAnswer: Readonly<Record<AiDecideAnswer, number>>;
  /** 10 Stufen der Ja-Wahrscheinlichkeit: 0–9, 10–19, …, 90–100. */
  histogram: readonly number[];
  /** Korrigiert oder älter als das 30-Tage-Fenster (nur mit Rückmeldung). */
  closed: number;
  /** Ja/Nein ohne Korrektur nach Ablauf des Fensters. */
  agreed: number;
  /** Ja/Nein mit Korrektur (Widerspruch). */
  overridden: number;
  /** agreed / (agreed + overridden), 0..1; null ohne abgeschlossene Ja/Nein-Fälle. */
  agreementRate: number | null;
  /** Fälle mit bekannter Wahrheit (Grundlage des Vorschlags). */
  labelled: number;
  minSamples: number;
  suggestedThreshold: number | null;
}>;

export function emptyAiDecisionStats(): AiDecisionStats {
  return summarizeAiDecisionEvents([], new Date(0));
}

export function summarizeAiDecisionEvents(
  events: readonly AiDecisionEventForStats[],
  now: Date,
): AiDecisionStats {
  const byAnswer: Record<AiDecideAnswer, number> = { ja: 0, nein: 0, unsicher: 0, error: 0 };
  const histogram = Array.from({ length: 10 }, () => 0);
  const windowStart = now.getTime() - AI_DECISION_OVERRIDE_WINDOW_DAYS * DAY_MS;
  const samples: AiDecisionSample[] = [];
  let closed = 0;
  let agreed = 0;
  let overridden = 0;
  for (const event of events) {
    if (event.answer in byAnswer) byAnswer[event.answer] += 1;
    const probability = typeof event.probability === 'number' && Number.isFinite(event.probability)
      ? Math.max(0, Math.min(100, Math.round(event.probability)))
      : null;
    if (probability !== null) histogram[Math.min(9, Math.floor(probability / 10))]! += 1;
    if (normalizeAiDecisionFeedbackSignal(event.feedbackSignal) === 'none') continue;
    const hasOverride = Boolean(event.overrideKind) && (event.truth === 'ja' || event.truth === 'nein');
    const created = new Date(event.createdAt).getTime();
    const isClosed = hasOverride || (Number.isFinite(created) && created < windowStart);
    if (!isClosed) continue;
    closed += 1;
    if (event.answer === 'ja' || event.answer === 'nein') {
      if (hasOverride) overridden += 1;
      else agreed += 1;
      if (probability !== null) samples.push({ probability, truth: hasOverride ? event.truth! : event.answer });
    } else if (event.answer === 'unsicher' && hasOverride && probability !== null) {
      // Q6: vom Menschen geklärte „Unsicher“-Fälle sind Stichproben, kein Widerspruch.
      samples.push({ probability, truth: event.truth! });
    }
  }
  return {
    total: events.length,
    byAnswer,
    histogram,
    closed,
    agreed,
    overridden,
    agreementRate: agreed + overridden > 0 ? agreed / (agreed + overridden) : null,
    labelled: samples.length,
    minSamples: AI_DECISION_MIN_SAMPLES,
    suggestedThreshold: suggestAiDecideThreshold(samples),
  };
}
