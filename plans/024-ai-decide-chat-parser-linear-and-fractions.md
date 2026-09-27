# Plan 024: Parse KI-Entscheidung chat answers in linear time and read `1.0` as 100 %

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/core/src/workflow/ai-decide.ts packages/core/src/learnings/knowledge-sections.ts tests/unit/workflow-ai-decide.test.ts tests/unit/ai-learnings-text.test.ts`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: security (ReDoS / event-loop block) + bug (fraction `1.0`)
- **Planned at**: commit `9e0491e3`, 2026-09-27

Audit claims verified by the planner (all correct): the line regex is super-linear
(measured on `packages/core/dist`: 20 lines of 40 spaces = 0.5 s, 40 lines = 1.2 s;
the advisor measured 100 lines = 17.6 s); `{"wahrscheinlichkeit_ja": 1.0}` yields
probability 1; the knowledge-section heading regex takes ~1.9 s on one 40 000-space line.
One addition: the SAME heading regex shape is used a second time in
`normalizeKnowledgeSectionContent` (`knowledge-sections.ts:116`, ~1.4 s) — this plan fixes both.

## Why this matters

`parseAiDecideChatResponse` parses the answer of a chat model in the workflow node
„KI-Entscheidung“ (`ai.decide`). When the answer contains no usable JSON, it falls back
to a multi-line regex with overlapping `\s` groups that backtracks super-linearly: an
8 000-character answer of blank-ish lines blocks the Node event loop for seconds to
minutes. On the server the API process also runs the job worker, and the synchronous
send preview calls the parser while a user waits for "Senden". Separately, a model that
answers with a fraction `1.0` ("certainly yes") is read as **1 %** (→ „Nein“) while
`0.99` is read as 99 % — an inconsistent, surprising result. The knowledge-base Markdown
parser has the same class of quadratic regex on headings.

## Current state

Files:
- `packages/core/src/workflow/ai-decide.ts` (512 lines) — shared pure logic of `ai.decide` for both editions. Callers of `parseAiDecideChatResponse`: server job `packages/server/src/workflow-ai-decide.ts:266` (also used by the synchronous send preview via `runServerAiDecision`), desktop `electron/email/email-openai.ts:175`. No caller changes are needed.
- `packages/core/src/learnings/knowledge-sections.ts` (206 lines) — `##`-section parser for knowledge-base Markdown.
- `tests/unit/workflow-ai-decide.test.ts` — `describe('parseAiDecideChatResponse')` at lines 141–197 (time test for `{`-spam at 192–196). Imports from `'../../packages/core/src/workflow'`.
- `tests/unit/ai-learnings-text.test.ts` — `describe('Wissensbasis-Abschnitte (TA-P5)')` at line 90; imports from `'../../packages/core/src/learnings/knowledge-sections'` (lines 14–19).

`ai-decide.ts:24` — `const AI_DECIDE_CHAT_PARSE_MAX_CHARS = 8_000;`

`ai-decide.ts:346-363` (probability reading; `match[2]` is the `%` suffix):
```ts
/** Chat-Wahrscheinlichkeit: „85“, „85 %“, „0.85“ (Anteil), „85,5“. */
function chatProbabilityPercent(value: unknown): number | null {
  let text: string;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return null;
  }
  const match = /^(-?\d+(?:[.,]\d+)?)\s*(%|prozent)?$/i.exec(text);
  if (!match) return null;
  const n = Number(match[1]!.replace(',', '.'));
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  const percent = !match[2] && n > 0 && n < 1 ? n * 100 : n;
  return clampAiDecideProbability(percent);
}
```

`ai-decide.ts:433-438` (the ReDoS; `re` is applied to the whole ≤ 8 000-char text):
```ts
function fieldsFromLines(text: string): ChatFields[] {
  const probs: number[] = [];
  const answers: ('ja' | 'nein')[] = [];
  let reason = '';
  const re = /^[\s*_\-"']*([A-Za-zÄÖÜäöüß_ \-]{2,40}?)[\s*_"']*[:=]\s*(.+?)\s*,?\s*$/gm;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const key = normalizeKey(m[1]!);
    const value = m[2]!.replace(/^["'„“]|["'“”]$/g, '').trim();
```
The rest of the loop body (lines 441–468: key classification, ambiguity handling) stays unchanged.

`ai-decide.ts:481-492` (JSON path; `JSON.parse` turns `1.0` into the number `1`, so the decimal point is lost before `fieldsFromObject` → `chatProbabilityPercent` sees it):
```ts
  for (const candidate of jsonObjectCandidates(text)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(candidate) as unknown;
    } catch {
      continue;
    }
    ...
  if (found.length === 0) found.push(...fieldsFromLines(text));
```
Verified with Node 24: a `JSON.parse` reviver receives the raw token as a third argument —
`JSON.parse('{"a":1.0}', (k, v, ctx) => ctx.source)` gives `"1.0"` (V8 "JSON.parse source
text access"; Node 24 and Electron 43 both ship it).

Safety net already in place (`ai-decide.ts:110-141`, `evaluateAiDecideOutcome`): if the
model's explicit `antwort` contradicts the probability (e.g. `nein` at 100 %), the result is
„unsicher“, which holds outbound mail. Keep it.

`knowledge-sections.ts:36` and `:116`:
```ts
const HEADING_PATTERN = /^##(?!#)[ \t]+(.+?)[ \t#]*$/;
...
    const first = /^#{1,6}[ \t]+(.+?)[ \t#]*$/.exec(lines[firstIdx]!);
```
Used at `:64` as `const heading = HEADING_PATTERN.exec(line); if (heading) starts.push({ line: i, title: heading[1]!.trim() });`
and at `:117` as `first[1]!` passed to `normalizeKnowledgeSectionTitle`. Lines are already split on `\n` after `\r\n?` normalisation.
Current edge behaviour (measured, must be preserved): `"## Titel ##"`→`Titel`, `"## Titel # x ##  "`→`Titel # x`,
`"##\tA\t#"`→`A`, `"## #"`→`#`, `"##  "` (two spaces)→heading with title `""`, `"## "` / `"###  x"` / `"##x"` → no heading.

Conventions: German code comments; commit style `KI-Entscheidung: …`; prior linear-rewrite exemplar: commit `c40ed504` („Lauf-Historie: Platzhalter linear scannen statt mit Regex (CodeQL)“).

## Decision: the probability rule (normative)

For a value without `%`/`prozent`:
- **integer token** (`0`, `1`, `85`) ⇒ percent. `1` = 1 %. (The prompt asks for „ganze Zahl von 0 bis 100“.)
- **token with a decimal separator** (`.` or `,`) and value **≤ 1** ⇒ fraction × 100. `1.0`/`1,0`/`1.00` = 100 %, `0.5` = 50 %, `0.0` = 0 %.
- token with a decimal separator and value in (1, 100] ⇒ percent (unchanged: `60,5` → 61).
- With `%`/`prozent` ⇒ always percent (unchanged).
- JSON numbers are judged by their **raw source text** (via the reviver). A JSON number whose source does not match the pattern (e.g. `1e0`) ⇒ no probability (fail-closed; before it was read as `1`).
- If the raw source is unavailable (reviver got no `context.source`), a JSON number exactly equal to `1` ⇒ no probability (ambiguous, fail-closed); other numbers use `String(value)` as today.

Only observable change vs. today: `1.0`-style tokens become 100 % instead of 1 %; `1e0`-style JSON numbers become unreadable.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;` in this environment.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Focused test (ai.decide) | `pnpm exec jest tests/unit/workflow-ai-decide.test.ts` | all pass |
| Focused test (knowledge) | `pnpm exec jest tests/unit/ai-learnings-text.test.ts` | all pass |
| Desktop caller | `pnpm exec jest tests/unit/workflow-ai-decide-desktop.test.ts` | all pass |
| Mail suite (desktop caller in electron/email) | `pnpm run test:mail` | all pass |
| Typecheck (all) | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Unit | `pnpm run test:unit` | all pass |

## Scope

**In scope** (the only files you should modify):
- `packages/core/src/workflow/ai-decide.ts`
- `packages/core/src/learnings/knowledge-sections.ts`
- `tests/unit/workflow-ai-decide.test.ts`
- `tests/unit/ai-learnings-text.test.ts`
- `CHANGELOG.md` (one `[Unreleased]` → `### Fixed` entry)

**Out of scope**:
- `jsonObjectCandidates` (already budgeted, has its own time test).
- `packages/core/src/workflow/ai-decisions-api.ts` — the Decisions API is fraction-only by contract; leave `decisionsProbabilityToPercent` alone.
- The prompt text in `buildAiDecideChatPrompts` — do not change what the model is asked for.
- Callers in `packages/server/**` and `electron/**` — the function signature does not change.
- `serializeKnowledgeSections` / `normalizeKnowledgeSectionTitle` regexes — see Maintenance notes.

## Git workflow

- Branch: `advisor/024-ai-decide-chat-parser-linear`
- Commits in German, imperative, area prefix, e.g. `KI-Entscheidung: Antwortzeilen linear lesen, 1.0 als 100 %` and `Wissensbasis: Überschriften linear erkennen (CodeQL)`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Regression tests first (red)

In `tests/unit/workflow-ai-decide.test.ts`, inside `describe('parseAiDecideChatResponse')`, add:

1. `test('Anteil mit Dezimalpunkt: 1.0 ist 100 %, ganze 1 ist 1 %', …)` asserting via `toMatchObject`:
   - `'{"wahrscheinlichkeit_ja": 1.0}'` → `{ ok: true, probability: 100 }`
   - `'{"wahrscheinlichkeit_ja": "1,0"}'` → 100; `'wahrscheinlichkeit_ja: 1.00'` → 100
   - `'{"wahrscheinlichkeit_ja": 1}'` → 1; `'wahrscheinlichkeit_ja: 1'` → 1; `'{"wahrscheinlichkeit_ja": "1 %"}'` → 1
   - `'{"wahrscheinlichkeit_ja": 0.0}'` → 0; `'{"wahrscheinlichkeit_ja": 0}'` → 0; `'{"wahrscheinlichkeit_ja": 0.99}'` → 99; `'{"wahrscheinlichkeit_ja": 100}'` → 100
   - `'{"nein": 1.0}'` → 0 (100 − 100)
   - `'{"wahrscheinlichkeit_ja": 1e0}'` → `{ ok: false }`
   - contradiction safety net: `evaluateAiDecideOutcome({ probability: 100, threshold: 80, source: 'chat', model: 'm', modelAnswer: 'nein' }).answer` is `'unsicher'` (already true; pins it).
2. `test('Zeilenformat bleibt schnell (kein Backtracking über Leerzeilen)', …)` with a **moderate** input so the old code fails in about a second instead of hanging:
   ```ts
   const inputs = [
     'a\n' + (' '.repeat(40) + '\n').repeat(40) + 'x',
     'Antwort\n' + (' '.repeat(16) + '\n').repeat(80) + 'x',
   ];
   for (const raw of inputs) {
     const started = Date.now();
     expect(parseAiDecideChatResponse(raw).ok).toBe(false);
     expect(Date.now() - started).toBeLessThan(200);
   }
   ```

In `tests/unit/ai-learnings-text.test.ts`, add `normalizeKnowledgeSectionContent` to the import list (lines 14–19) and, inside `describe('Wissensbasis-Abschnitte (TA-P5)')`, add
`it('Überschriften: gleiche Titel wie bisher, lange Leerzeilen bleiben schnell', …)`:
- `parseKnowledgeSections('## Titel ##\n## Titel # x ##  \n##\tA\t#\n## #\n##  \n## \n### x\n##x\n').sections.map((s) => s.title)` equals `['Titel', 'Titel # x', 'A', '#', '']`.
- `normalizeKnowledgeSectionContent('## Versand ##\nText', 'Versand')` is `'Text'`; `normalizeKnowledgeSectionContent('####### x\nText')` is `'####### x\nText'`.
- Timing: `'## a' + ' '.repeat(40_000) + 'b'` through `parseKnowledgeSections` and `'# a' + ' '.repeat(40_000) + 'b'` through `normalizeKnowledgeSectionContent`, each `< 200` ms, and the first yields title `'a' + ' '.repeat(40_000) + 'b'`.

**Verify**: `pnpm exec jest tests/unit/workflow-ai-decide.test.ts tests/unit/ai-learnings-text.test.ts` → the new fraction test fails (`probability: 1` received for `1.0`), both time tests fail on the `< 200` assertion; all pre-existing tests pass. Do not add larger inputs yet — on the old code they run for minutes.

### Step 2: Keep the raw JSON number text

In `ai-decide.ts`, add near `chatProbabilityPercent`:
```ts
/** Zahl aus JSON mit ihrem Rohtext („1.0“ bleibt „1.0“ statt 1). */
class JsonNumberToken {
  constructor(readonly value: number, readonly source: string | null) {}
}

function keepJsonNumberSource(_key: string, value: unknown, context?: { source?: unknown }): unknown {
  if (typeof value !== 'number') return value;
  return new JsonNumberToken(value, typeof context?.source === 'string' ? context.source : null);
}
```
Change the parse call (line 484) to `parsed = JSON.parse(candidate, keepJsonNumberSource) as unknown;`.
(The optional third parameter keeps it assignable to the lib's two-argument reviver type; if `pnpm run typecheck` rejects it anyway, cast the reviver with `as (key: string, value: unknown) => unknown` — nothing else.)
Only `chatProbabilityPercent` needs to understand the wrapper; `chatAnswer` and the reason branch already ignore non-string/non-boolean values, so their behaviour is unchanged.

### Step 3: Apply the probability rule

Rewrite `chatProbabilityPercent` (keep its name and signature):
```ts
/**
 * Chat-Wahrscheinlichkeit: „85“, „85 %“, „0.85“/„1.0“ (Anteil), „85,5“.
 * Ganze Zahl ⇒ Prozent (1 = 1 %); mit Dezimaltrenner und ≤ 1 ⇒ Anteil
 * (1.0 = 100 %). JSON-Zahlen zählen mit ihrem Rohtext.
 */
function chatProbabilityPercent(value: unknown): number | null {
  let text: string;
  if (value instanceof JsonNumberToken) {
    if (!Number.isFinite(value.value)) return null;
    if (value.source === null) {
      if (value.value === 1) return null; // ohne Rohtext mehrdeutig: fail-closed
      text = String(value.value);
    } else {
      text = value.source.trim();
    }
  } else if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    text = String(value);
  } else if (typeof value === 'string') {
    text = value.trim();
  } else {
    return null;
  }
  const match = /^(-?\d+)(?:[.,](\d+))?\s*(%|prozent)?$/i.exec(text);
  if (!match) return null;
  const n = Number(match[2] === undefined ? match[1] : `${match[1]}.${match[2]}`);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  const fraction = !match[3] && match[2] !== undefined && n <= 1;
  return clampAiDecideProbability(fraction ? n * 100 : n);
}
```
(The regex is anchored, has no nested/overlapping quantifiers and runs on a single value — linear.)

**Verify**: `pnpm exec jest tests/unit/workflow-ai-decide.test.ts -t "Dezimalpunkt"` → passes; `pnpm exec jest tests/unit/workflow-ai-decide.test.ts -t "Englische|englische|geforderte|Codeblock|fail-closed"` → pass.

### Step 4: Replace the line regex with a per-line scan

In `fieldsFromLines`, replace the `re`/`exec` loop header with a loop over lines that yields the same `(key, value)` pairs, then keep the existing body unchanged (it starts at `const key = normalizeKey(…)`). Target shape:
```ts
// Zeilenweise statt eines mehrzeiligen Regex: die überlappenden \s-Gruppen
// liefen bei Leerzeilen-Ausgaben superlinear (Event-Loop blockiert).
const LINE_BREAK = /\r\n|[\n\r  ]/;
const LINE_KEY = /^[A-Za-zÄÖÜäöüß_ \-]{2,40}$/;
const isKeyLead = (ch: string) => /\s/.test(ch) || ch === '*' || ch === '_' || ch === '-' || ch === '"' || ch === "'";
const isKeyTail = (ch: string) => /\s/.test(ch) || ch === '*' || ch === '_' || ch === '"' || ch === "'";

function keyValueFromLine(line: string): { key: string; value: string } | null {
  const sep = line.search(/[:=]/);
  if (sep < 0) return null;
  let start = 0;
  while (start < sep && isKeyLead(line[start]!)) start += 1;
  let end = sep;
  while (end > start && isKeyTail(line[end - 1]!)) end -= 1;
  const key = line.slice(start, end);
  if (!LINE_KEY.test(key)) return null;
  let value = line.slice(sep + 1).trim();
  if (value.length > 1 && value.endsWith(',')) value = value.slice(0, -1).trimEnd();
  return value ? { key, value } : null;
}
```
and in `fieldsFromLines`: `for (const line of text.split(LINE_BREAK)) { const kv = keyValueFromLine(line); if (!kv) continue; const key = normalizeKey(kv.key); const value = kv.value.replace(/^["'„“]|["'“”]$/g, '').trim(); …existing body… }`.

Parity notes (why this equals the old regex for every same-line match): the old key/prefix/suffix classes never contain `:`/`=`, so the separator is always the first `:`/`=` of the line; stripping the maximal lead/tail can only drop characters that `normalizeKey` removes anyway, and every key in the key sets has ≥ 2 alphanumerics. Intended difference: the old `\s` groups could pair a key and value on **different** lines (`"Antwort:\nja"`); the new scan does not. Add one assertion pinning this: `parseAiDecideChatResponse('Wahrscheinlichkeit_ja:\n85')` → `{ ok: false }`.

**Verify**: `pnpm exec jest tests/unit/workflow-ai-decide.test.ts` → all pass, including `Schlüssel-Wert-Zeilen ohne JSON` and the two time tests.

### Step 5: Full-size time tests

Extend the time test from Step 1 with 8 000-char inputs (only now — they would hang on the old code):
`'a\n' + (' '.repeat(40) + '\n').repeat(200) + 'x'`, `'Antwort\n' + (' '.repeat(16) + '\n').repeat(470) + 'x'`,
`'a' + ' '.repeat(7_990) + 'b'`, `'*'.repeat(3_990) + ':' + ' '.repeat(3_990) + 'x'`, `'-\n'.repeat(4_000)`, each `< 200` ms.

**Verify**: `pnpm exec jest tests/unit/workflow-ai-decide.test.ts` → all pass.

### Step 6: Linear heading detection in knowledge-sections.ts

Add a helper and use it at both sites (`:64` with `(line, 2, 2)`, `:116` with `(lines[firstIdx]!, 1, 6)`), then delete `HEADING_PATTERN`:
```ts
/**
 * Titel einer Markdown-Überschrift mit genau min–max Rauten, sonst null.
 * Linear statt /^#{n}[ \t]+(.+?)[ \t#]*$/ (quadratisch bei langen Leerzeilen, CodeQL).
 */
function markdownHeadingTitle(line: string, minHashes: number, maxHashes: number): string | null {
  let hashes = 0;
  while (hashes < line.length && line[hashes] === '#') hashes += 1;
  if (hashes < minHashes || hashes > maxHashes) return null;
  let start = hashes;
  while (start < line.length && (line[start] === ' ' || line[start] === '\t')) start += 1;
  if (start === hashes) return null;
  if (line.includes(' ') || line.includes(' ')) return null; // `.` traf keine Zeilentrenner
  let end = line.length;
  while (end > start && (line[end - 1] === ' ' || line[end - 1] === '\t' || line[end - 1] === '#')) end -= 1;
  if (end > start) return line.slice(start, end);
  // (.+?) verlangte mindestens ein Zeichen:
  if (start < line.length) return line[start]!;            // „## #“ → „#“
  return start - hashes >= 2 ? line[start - 1]! : null;     // „##  “ → „ “, „## “ → keine Überschrift
}
```
Callers keep their `.trim()` / `normalizeKnowledgeSectionTitle` handling (`title: markdownHeadingTitle(line, 2, 2)!.trim()` after a null check).
Plan 028 (`plans/028-knowledge-sections-close-code-fences.md`) edits the same parser and uses `HEADING_PATTERN.test(line)` / `.exec(line)`.
If 028 is already merged, replace every remaining `HEADING_PATTERN` use with the helper (`markdownHeadingTitle(line, 2, 2) !== null` for `.test`) —
that is in scope. Tell the operator in your report that 028 (if still open) must use the helper instead of `HEADING_PATTERN`.

**Verify**: `pnpm exec jest tests/unit/ai-learnings-text.test.ts` → all pass (new + existing `zerlegt verlustfrei…`, `wendet add/update/delete stabil an`).

### Step 7: CHANGELOG, full checks

Add under `## [Unreleased]` → `### Fixed`:
`- **Beide Editionen:** KI-Entscheidung mit Chat-Modell: Eine Antwort als Anteil „1.0“ zählt jetzt als 100 % Ja-Wahrscheinlichkeit (vorher 1 %, also „Nein“); eine ganze „1“ bleibt 1 %. Antworten aus vielen Leerzeilen blockieren den Server bzw. die App nicht mehr sekundenlang, ebenso lange Leerzeilen in Wissensbasis-Überschriften.`

**Verify**: `pnpm run typecheck` → exit 0; `pnpm run lint` → exit 0, 0 warnings; `pnpm run test:unit` → all pass; `pnpm run test:mail` → all pass.

## Test plan

- `tests/unit/workflow-ai-decide.test.ts`: fraction/integer boundary test (Step 1.1), cross-line pin (Step 4), time tests moderate (Step 1.2) and 8 000-char (Step 5). Pattern: existing `entartete Ausgabe bleibt schnell` (lines 192–196).
- `tests/unit/ai-learnings-text.test.ts`: heading parity + timing (Step 1).
- All existing tests in both files and `tests/unit/workflow-ai-decide-desktop.test.ts`, `tests/mail/email-openai.test.ts` stay green unchanged.

## Done criteria

- [ ] `pnpm exec jest tests/unit/workflow-ai-decide.test.ts tests/unit/ai-learnings-text.test.ts` exits 0 with the new tests present
- [ ] `grep -n "/gm" packages/core/src/workflow/ai-decide.ts` returns nothing; `grep -n "(.+?)" packages/core/src/learnings/knowledge-sections.ts` returns nothing
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:mail` exit 0
- [ ] `git status` shows only the in-scope files modified
- [ ] Row 024 in `plans/README.md` updated and box ticked in `plans/MASTERPLAN.md`

## STOP conditions

- Any pre-existing test in `workflow-ai-decide.test.ts` (notably `Schlüssel-Wert-Zeilen ohne JSON`, `fail-closed: …`, `englische Schlüssel und Anteil 0–1`) needs a changed expectation — the parity argument is then wrong; report the input.
- `JSON.parse('{"a":1.0}', (k, v, c) => c && c.source)` does not return `"1.0"` under the Node used by Jest (`node -e` check) — the runtime lacks source access; report instead of inventing another number tokenizer.
- Any test time budget still fails after Step 4/6 — do not raise the 200 ms limit.
- The fix appears to need changes in `packages/server/**` or `electron/**`.

## Maintenance notes

- If the prompt ever asks for fractions instead of integers, revisit the rule (then bare `1` would mean 100 %).
- Remaining regexes of the same family, deliberately not touched: `serializeKnowledgeSections` uses `out.replace(/\n*$/, '\n\n')` and `normalizeKnowledgeSectionTitle` uses `/[:.]+$/` — both quadratic only on long runs of `\n` / `:` and fed by short titles/our own output; follow-up candidates if CodeQL flags them.
- Coordination: plan 028 touches `knowledge-sections.ts` too; whichever lands second must use `markdownHeadingTitle` instead of `HEADING_PATTERN`.
- Reviewers: check the parity argument in Step 4 against the old regex and that `JsonNumberToken` never leaks into `reason`/`answer`.
