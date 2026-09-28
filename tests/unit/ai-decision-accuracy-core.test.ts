import {
  AI_DECISION_MIN_SAMPLES,
  normalizeAiDecisionFeedbackSignal,
  overrideForHumanReply,
  overrideForReviewSkip,
  overrideForSpamTransition,
  suggestAiDecideThreshold,
  summarizeAiDecisionEvents,
  type AiDecisionEventForStats,
} from '../../packages/core/src/workflow/ai-decision-accuracy';

/**
 * Plan 050: Treffsicherheit der KI-Entscheidung. Entscheidungen werden ohne Text
 * gespeichert, menschliche Korrekturen verknüpft, daraus Übereinstimmung und ein
 * Schwellen-Vorschlag berechnet (Entscheidungsdokument docs/design/ai-decision-accuracy.md).
 */
describe('feedbackSignal', () => {
  test('unbekannte Werte werden zu none', () => {
    expect(normalizeAiDecisionFeedbackSignal('spam')).toBe('spam');
    expect(normalizeAiDecisionFeedbackSignal(' human_needed ')).toBe('human_needed');
    expect(normalizeAiDecisionFeedbackSignal('send_ok')).toBe('send_ok');
    for (const value of [undefined, null, '', 'SPAM', 'irgendwas', 3]) {
      expect(normalizeAiDecisionFeedbackSignal(value)).toBe('none');
    }
  });
});

describe('Korrekturen', () => {
  test('Spam-Status: Widerspruch nach ja/nein, Klärung nach unsicher', () => {
    expect(overrideForSpamTransition({ answer: 'ja', previous: 'spam', next: 'clean' }))
      .toEqual({ overrideKind: 'spam_to_clean', truth: 'nein' });
    expect(overrideForSpamTransition({ answer: 'nein', previous: 'clean', next: 'spam' }))
      .toEqual({ overrideKind: 'clean_to_spam', truth: 'ja' });
    expect(overrideForSpamTransition({ answer: 'unsicher', previous: 'review', next: 'clean' }))
      .toEqual({ overrideKind: 'review_to_clean', truth: 'nein' });
    expect(overrideForSpamTransition({ answer: 'unsicher', previous: 'review', next: 'spam' }))
      .toEqual({ overrideKind: 'review_to_spam', truth: 'ja' });
  });

  test('Spam-Status: Zustimmung, keine Änderung, review und Fehler verknüpfen nichts', () => {
    expect(overrideForSpamTransition({ answer: 'ja', previous: 'clean', next: 'spam' })).toBeNull();
    expect(overrideForSpamTransition({ answer: 'nein', previous: 'spam', next: 'clean' })).toBeNull();
    expect(overrideForSpamTransition({ answer: 'ja', previous: 'clean', next: 'clean' })).toBeNull();
    expect(overrideForSpamTransition({ answer: 'ja', previous: 'spam', next: 'review' })).toBeNull();
    expect(overrideForSpamTransition({ answer: 'error', previous: 'spam', next: 'clean' })).toBeNull();
  });

  test('Menschliche Antwort nur nach „nein – kein Mensch nötig“', () => {
    expect(overrideForHumanReply({ answer: 'nein' })).toEqual({ overrideKind: 'human_reply', truth: 'ja' });
    for (const answer of ['ja', 'unsicher', 'error'] as const) {
      expect(overrideForHumanReply({ answer })).toBeNull();
    }
  });

  test('Ohne Ausgangsprüfung senden nach nein oder unsicher', () => {
    expect(overrideForReviewSkip({ answer: 'nein' })).toEqual({ overrideKind: 'sent_without_review', truth: 'ja' });
    expect(overrideForReviewSkip({ answer: 'unsicher' })).toEqual({ overrideKind: 'sent_without_review', truth: 'ja' });
    expect(overrideForReviewSkip({ answer: 'ja' })).toBeNull();
    expect(overrideForReviewSkip({ answer: 'error' })).toBeNull();
  });
});

describe('suggestAiDecideThreshold', () => {
  const samples = (list: Array<[number, 'ja' | 'nein']>) => list.map(([probability, truth]) => ({ probability, truth }));

  test('weniger als 30 gelabelte Fälle → kein Vorschlag', () => {
    const few = samples(Array.from({ length: AI_DECISION_MIN_SAMPLES - 1 }, (_, i) => [i % 2 ? 95 : 5, i % 2 ? 'ja' : 'nein']));
    expect(suggestAiDecideThreshold(few)).toBeNull();
  });

  test('sauber getrennte Fälle → 50', () => {
    const clean = samples(Array.from({ length: 40 }, (_, i) => (i % 2 ? [90, 'ja'] : [10, 'nein'])));
    expect(suggestAiDecideThreshold(clean)).toBe(50);
  });

  test('Fehler bei mittleren Wahrscheinlichkeiten → höhere Schwelle', () => {
    const noisy = samples([
      ...Array.from({ length: 30 }, () => [95, 'ja'] as [number, 'ja']),
      ...Array.from({ length: 30 }, () => [5, 'nein'] as [number, 'nein']),
      ...Array.from({ length: 10 }, () => [70, 'nein'] as [number, 'nein']),
      ...Array.from({ length: 10 }, () => [30, 'ja'] as [number, 'ja']),
    ]);
    // Ab 71 fallen die falschen 70er heraus, und 30 ≤ 100 − 71 gilt nicht mehr.
    expect(suggestAiDecideThreshold(noisy)).toBe(71);
  });

  test('p = 50 zählt bei Schwelle 50 als ja (wie aiDecideAnswerForProbability)', () => {
    const list = samples([
      ...Array.from({ length: 30 }, () => [50, 'ja'] as [number, 'ja']),
      ...Array.from({ length: 5 }, () => [0, 'nein'] as [number, 'nein']),
    ]);
    expect(suggestAiDecideThreshold(list)).toBe(50);
  });

  test('keine Schwelle erfüllt die Fehlerquote → kein Vorschlag', () => {
    const wrong = samples(Array.from({ length: 40 }, (_, i) => (i % 2 ? [99, 'nein'] : [1, 'ja'])));
    expect(suggestAiDecideThreshold(wrong)).toBeNull();
  });
});

describe('summarizeAiDecisionEvents', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000).toISOString();
  const event = (overrides: Partial<AiDecisionEventForStats>): AiDecisionEventForStats => ({
    answer: 'ja',
    probability: 90,
    createdAt: daysAgo(40),
    overrideKind: null,
    truth: null,
    ...overrides,
  });

  test('Verteilung, Histogramm-Ränder und Übereinstimmung', () => {
    const stats = summarizeAiDecisionEvents([
      event({ probability: 0, answer: 'nein' }),
      event({ probability: 9, answer: 'nein' }),
      event({ probability: 10, answer: 'nein' }),
      event({ probability: 100 }),
      event({ probability: 95, overrideKind: 'spam_to_clean', truth: 'nein', createdAt: daysAgo(2) }),
      event({ probability: 60, answer: 'unsicher', overrideKind: 'review_to_spam', truth: 'ja' }),
      event({ probability: 55, answer: 'unsicher' }),
      event({ probability: null, answer: 'error' }),
      event({ probability: 92, createdAt: daysAgo(3) }), // noch offen (im 30-Tage-Fenster)
    ], now);
    expect(stats.total).toBe(9);
    expect(stats.byAnswer).toEqual({ ja: 3, nein: 3, unsicher: 2, error: 1 });
    expect(stats.histogram).toEqual([2, 1, 0, 0, 0, 1, 1, 0, 0, 3]);
    // abgeschlossen: 4 bestätigte (0, 9, 10, 100) + 1 Widerspruch; offen: der 92er von vor 3 Tagen
    expect(stats.agreed).toBe(4);
    expect(stats.overridden).toBe(1);
    // abgeschlossen = korrigiert oder älter als 30 Tage (alle Antworten)
    expect(stats.closed).toBe(8);
    expect(stats.agreementRate).toBeCloseTo(0.8);
    // gelabelt: 4 bestätigte + Widerspruch + geklärte Unsicher
    expect(stats.labelled).toBe(6);
    expect(stats.suggestedThreshold).toBeNull();
  });

  test('ohne abgeschlossene Ja/Nein-Fälle keine Übereinstimmung', () => {
    const stats = summarizeAiDecisionEvents([event({ createdAt: daysAgo(1) })], now);
    expect(stats.agreementRate).toBeNull();
    expect(stats.closed).toBe(0);
  });
});
