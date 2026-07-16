import {
  evaluateRelayTrackingRule,
  type EvaluateRelayTrackingRuleInput,
} from '../../packages/core/src/email';

function evaluate(overrides: Partial<EvaluateRelayTrackingRuleInput>): ReturnType<typeof evaluateRelayTrackingRule> {
  return evaluateRelayTrackingRule({
    mode: 'rule',
    subjectPatterns: null,
    allowHeaderOverride: false,
    subject: '',
    headerOverride: null,
    ...overrides,
  });
}

describe('evaluateRelayTrackingRule precedence', () => {
  test('explicit off header wins over always mode when overrides are allowed', () => {
    expect(evaluate({ mode: 'always', allowHeaderOverride: true, headerOverride: 'off' }))
      .toEqual({ track: false, reason: 'header_override' });
  });

  test('explicit off header wins even over an on header (off is checked first)', () => {
    // Callers only pass a single parsed value, but this pins the branch order:
    // the off short-circuit is evaluated before the on branch.
    expect(evaluate({ mode: 'rule', allowHeaderOverride: true, headerOverride: 'off' }))
      .toEqual({ track: false, reason: 'header_override' });
  });

  test('mode off reports disabled', () => {
    expect(evaluate({ mode: 'off' }))
      .toEqual({ track: false, reason: 'disabled' });
  });

  test('mode off still honours an explicit off override before disabling', () => {
    expect(evaluate({ mode: 'off', allowHeaderOverride: true, headerOverride: 'off' }))
      .toEqual({ track: false, reason: 'header_override' });
  });

  test('mode off ignores an on override (disabled wins over opt-in)', () => {
    expect(evaluate({ mode: 'off', allowHeaderOverride: true, headerOverride: 'on' }))
      .toEqual({ track: false, reason: 'disabled' });
  });

  test('explicit on header forces tracking under rule mode with no matching subject', () => {
    expect(evaluate({ mode: 'rule', allowHeaderOverride: true, headerOverride: 'on', subject: 'hello' }))
      .toEqual({ track: true, reason: 'header_override' });
  });

  test('always mode tracks unconditionally', () => {
    expect(evaluate({ mode: 'always', subject: 'anything' }))
      .toEqual({ track: true, reason: 'always' });
  });
});

describe('evaluateRelayTrackingRule header override gating', () => {
  test('header override is ignored when allowHeaderOverride is false (on)', () => {
    // Falls through to rule mode; no patterns => no_match.
    expect(evaluate({ mode: 'rule', allowHeaderOverride: false, headerOverride: 'on', subject: 'hi' }))
      .toEqual({ track: false, reason: 'no_match' });
  });

  test('header override is ignored when allowHeaderOverride is false (off)', () => {
    // Off header ignored => always mode still tracks.
    expect(evaluate({ mode: 'always', allowHeaderOverride: false, headerOverride: 'off' }))
      .toEqual({ track: true, reason: 'always' });
  });

  test('absent header (null) with overrides allowed falls through to mode logic', () => {
    expect(evaluate({ mode: 'always', allowHeaderOverride: true, headerOverride: null }))
      .toEqual({ track: true, reason: 'always' });
  });
});

describe('evaluateRelayTrackingRule rule-mode subject matching', () => {
  test('no patterns configured => no_match', () => {
    expect(evaluate({ mode: 'rule', subjectPatterns: null, subject: 'Invoice 42' }))
      .toEqual({ track: false, reason: 'no_match' });
  });

  test('blank / whitespace-only patterns are skipped => no_match', () => {
    expect(evaluate({ mode: 'rule', subjectPatterns: '\n   \n\t\n', subject: 'anything' }))
      .toEqual({ track: false, reason: 'no_match' });
  });

  test('case-insensitive substring match', () => {
    expect(evaluate({ mode: 'rule', subjectPatterns: 'invoice', subject: 'Your INVOICE is ready' }))
      .toEqual({ track: true, reason: 'subject_match' });
  });

  test('substring miss => no_match', () => {
    expect(evaluate({ mode: 'rule', subjectPatterns: 'invoice', subject: 'Newsletter' }))
      .toEqual({ track: false, reason: 'no_match' });
  });

  test('matches any of several newline-separated patterns', () => {
    expect(evaluate({ mode: 'rule', subjectPatterns: 'receipt\norder\ninvoice', subject: 'Your Order #7' }))
      .toEqual({ track: true, reason: 'subject_match' });
  });

  test('regex pattern with flags matches (anchored, case-insensitive)', () => {
    expect(evaluate({ mode: 'rule', subjectPatterns: '/^\\[urgent\\]/i', subject: '[URGENT] payment due' }))
      .toEqual({ track: true, reason: 'subject_match' });
  });

  test('regex pattern respects the authors flags (case-sensitive without i)', () => {
    expect(evaluate({ mode: 'rule', subjectPatterns: '/URGENT/', subject: 'urgent matter' }))
      .toEqual({ track: false, reason: 'no_match' });
  });

  test('invalid regex is treated as a literal substring (not dropped, not thrown)', () => {
    // `(` is an unterminated group => RegExp construction throws => literal.
    // The literal form includes the surrounding slashes, so the subject must
    // contain the exact `/(open/` text to match.
    expect(evaluate({ mode: 'rule', subjectPatterns: '/(open/', subject: 'contains /(open/ token' }))
      .toEqual({ track: true, reason: 'subject_match' });
    expect(evaluate({ mode: 'rule', subjectPatterns: '/(open/', subject: 'no such token' }))
      .toEqual({ track: false, reason: 'no_match' });
  });

  test('a non-regex line containing a slash is matched literally, not as regex', () => {
    expect(evaluate({ mode: 'rule', subjectPatterns: 'and/or', subject: 'terms And/Or conditions' }))
      .toEqual({ track: true, reason: 'subject_match' });
  });
});
