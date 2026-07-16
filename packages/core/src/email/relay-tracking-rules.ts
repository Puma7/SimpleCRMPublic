/**
 * Pure decision logic for whether an outbound message relayed through the
 * SMTP-relay feature should be instrumented for open/click tracking.
 *
 * The relay stores a per-relay tracking policy (`tracking_mode`,
 * `tracking_subject_patterns`, `allow_header_override`). At submission time the
 * relay also inspects an optional `X-SimpleCRM-Track` header the sender may set
 * to force tracking on/off for a single message. This module resolves all of
 * that into a single, auditable decision + reason so the caller can persist the
 * reason on the submission row and the runtime never has to re-derive it.
 *
 * Keep this module pure (no IO, no clock, no crypto) so it stays trivially
 * testable and reusable from both the SMTP submission path and any UI preview.
 */

export type RelayTrackingMode = 'off' | 'rule' | 'always';

/** Parsed value of the `X-SimpleCRM-Track` header (`null` = header absent). */
export type RelayTrackingHeaderOverride = 'on' | 'off';

export type RelayTrackingRuleReason =
  | 'always'
  | 'off'
  | 'subject_match'
  | 'header_override'
  | 'no_match'
  | 'disabled';

export type EvaluateRelayTrackingRuleInput = Readonly<{
  /** The relay's configured tracking mode. */
  mode: RelayTrackingMode;
  /** Newline-separated subject patterns (only consulted when `mode === 'rule'`). */
  subjectPatterns: string | null;
  /** Whether a per-message `X-SimpleCRM-Track` header may override the mode. */
  allowHeaderOverride: boolean;
  /** The outbound message subject to test against the patterns. */
  subject: string;
  /** Parsed `X-SimpleCRM-Track` value; `null` when the header is absent. */
  headerOverride: RelayTrackingHeaderOverride | null;
}>;

export type RelayTrackingRuleDecision = Readonly<{
  track: boolean;
  reason: RelayTrackingRuleReason;
}>;

/**
 * Upper bounds guarding the (admin-supplied) pattern set. They cap the work a
 * single message can trigger — the patterns come from a trusted workspace admin,
 * but a subject can be attacker-influenced, so we still bound the match loop.
 */
const MAX_PATTERNS = 200;
const MAX_PATTERN_LENGTH = 512;

/**
 * Resolve whether a relayed message should be tracked.
 *
 * Precedence (first matching rule wins):
 *   1. An explicit `off` header override (when allowed) always wins — a sender
 *      opting a single message out of tracking is honoured over any mode.
 *   2. `mode === 'off'` disables tracking entirely (`disabled`).
 *   3. An explicit `on` header override (when allowed) forces tracking on.
 *   4. `mode === 'always'` tracks unconditionally (`always`).
 *   5. `mode === 'rule'` tracks iff the subject matches any configured pattern
 *      (`subject_match`), otherwise `no_match`.
 */
export function evaluateRelayTrackingRule(
  input: EvaluateRelayTrackingRuleInput,
): RelayTrackingRuleDecision {
  const { mode, allowHeaderOverride, headerOverride } = input;

  // 1. Explicit opt-out via header always wins.
  if (allowHeaderOverride && headerOverride === 'off') {
    return { track: false, reason: 'header_override' };
  }

  // 2. Relay tracking switched off entirely.
  if (mode === 'off') {
    return { track: false, reason: 'disabled' };
  }

  // 3. Explicit opt-in via header.
  if (allowHeaderOverride && headerOverride === 'on') {
    return { track: true, reason: 'header_override' };
  }

  // 4. Always-on relay.
  if (mode === 'always') {
    return { track: true, reason: 'always' };
  }

  // 5. Rule mode: consult the subject patterns.
  return subjectMatchesAnyPattern(input.subjectPatterns, input.subject)
    ? { track: true, reason: 'subject_match' }
    : { track: false, reason: 'no_match' };
}

/**
 * Pattern-matching contract (one consistent, documented approach):
 *
 * `subjectPatterns` is newline-separated. Each line is trimmed; blank lines are
 * skipped. A line is interpreted as EITHER:
 *   - a `/source/flags` regular expression when it is delimited by slashes
 *     (e.g. `/^\[urgent\]/i`). The author's flags are respected verbatim. If the
 *     source fails to compile it is NOT silently dropped — it falls back to the
 *     literal branch below (so a typo can never make a pattern match nothing
 *     unexpectedly, and an invalid regex behaves predictably).
 *   - otherwise a plain, case-insensitive SUBSTRING of the subject.
 *
 * Regex patterns run against admin-controlled sources only, but we still bound
 * the pattern count/length to keep the per-message cost predictable.
 */
function subjectMatchesAnyPattern(subjectPatterns: string | null, subject: string): boolean {
  if (!subjectPatterns) return false;

  const subjectLower = subject.toLowerCase();
  const lines = subjectPatterns
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.length <= MAX_PATTERN_LENGTH)
    .slice(0, MAX_PATTERNS);

  for (const line of lines) {
    const regex = tryCompilePatternRegex(line);
    if (regex) {
      try {
        if (regex.test(subject)) return true;
      } catch {
        // A pathological regex that throws at match time is treated as no-match
        // for this line rather than aborting the whole evaluation.
      }
      continue;
    }
    if (subjectLower.includes(line.toLowerCase())) return true;
  }

  return false;
}

/** Matches a `/source/flags` regex-pattern line (shared by the compiler and the
 *  server-side ReDoS validator so both agree on what counts as a regex). */
const REGEX_PATTERN_LINE = /^\/(.+)\/([a-z]*)$/i;

/**
 * Compile a `/source/flags` line into a RegExp, or return `null` so the caller
 * falls back to literal substring matching. `null` covers both "not regex
 * syntax" and "invalid regex" — an invalid regex is deliberately treated as a
 * literal rather than throwing.
 */
function tryCompilePatternRegex(line: string): RegExp | null {
  const match = REGEX_PATTERN_LINE.exec(line);
  if (!match) return null;
  const [, source, flags] = match;
  try {
    return new RegExp(source!, flags);
  } catch {
    return null;
  }
}

/**
 * The RegExp *source* of every `/source/flags` line in the patterns (substring
 * lines are skipped). Lets a server-side validator run a ReDoS/safe-regex check
 * against exactly the sources this module would compile — regex evaluation runs
 * synchronously against attacker-controlled subjects during the SMTP DATA
 * phase, so a catastrophically-backtracking pattern must be rejected before it
 * is ever stored. Applies the same trim + length bound as evaluation. */
export function extractRelaySubjectRegexSources(subjectPatterns: string | null): string[] {
  if (!subjectPatterns) return [];
  const sources: string[] = [];
  for (const raw of subjectPatterns.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.length > MAX_PATTERN_LENGTH) continue;
    const match = REGEX_PATTERN_LINE.exec(line);
    if (match) sources.push(match[1]!);
  }
  return sources;
}
