# Plan 028: Close open code fences in knowledge-base sections so no section is lost

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/core/src/learnings/knowledge-sections.ts packages/core/src/learnings/digest.ts tests/unit/ai-learnings-text.test.ts tests/unit/ai-learnings-digest.test.ts CHANGELOG.md`
> If any in-scope file changed since this plan was written (CHANGELOG.md will
> usually have changed — only its `[Unreleased]` section matters), compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug (data loss)
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

The AI Learnings digest (both editions) edits a knowledge base per `## ` section:
the model returns operations (`add`/`update`/`delete` on a section title), the
shared core code applies them and a human approves the resulting document. If
the model's content for section A contains a code fence (```` ``` ```` or `~~~`)
that is never closed, the saved document has A's fence still open when
section B starts. The section parser then treats **every later `## ` heading
as code** — B and C become invisible to it. The next approved `update A`
serializes only what the parser saw, and **B and C are deleted from the
knowledge base**. Content truncation makes this realistic:
`parseLearningsDigestResponse` cuts each operation's content at 6 000
characters, which can cut off a closing fence. After this plan, new content
always has its fences closed, a document already damaged this way parses its
sections correctly again, and a proposal that would change the section list
in an unintended way is rejected before anyone can approve it.

Reproduced at `9e0491e3` against `packages/core/dist` (same code):

```text
doc = "# KB\n\n## A\n\nalt A\n\n## B\n\nInhalt B\n\n## C\n\nInhalt C\n"
update A with "Neu:\n```\ncode ohne Ende"  → parse(result).sections = ['A']
update A again with "ganz neu"             → "# KB\n\n## A\n\nganz neu\n"   (B and C gone)
```

## Current state

Files:

- `packages/core/src/learnings/knowledge-sections.ts` — parse/serialize a
  knowledge document into `##` sections and apply AI operations. Shared by
  Desktop (`electron/email/email-ai-learnings.ts`) and Server
  (`packages/server/src/ai-learnings.ts`) through `computeLearningsDigestProposal`.
- `packages/core/src/learnings/digest.ts` — `computeLearningsDigestProposal`
  (lines 472–514) calls `applyKnowledgeOperations` at line 505 and returns the
  proposal or `{ ok: false, error }`.
- `tests/unit/ai-learnings-text.test.ts` — existing tests for the section
  functions (`describe('Wissensbasis-Abschnitte (TA-P5)')`, lines 90–140).
- `tests/unit/ai-learnings-digest.test.ts` — tests for
  `computeLearningsDigestProposal` (`describe` at line 230).

Patterns (`knowledge-sections.ts:36-37`):

```ts
const HEADING_PATTERN = /^##(?!#)[ \t]+(.+?)[ \t#]*$/;
const FENCE_PATTERN = /^[ \t]*(```|~~~)/;
```

The parser (`knowledge-sections.ts:50-66`) — a fence opened and never closed
hides every later heading:

```ts
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
```

`normalizeKnowledgeSectionContent` (`knowledge-sections.ts:112-133`) tracks the
fence state while demoting `#`/`##` headings to `###`, but returns the text
with the fence still open:

```ts
  let fence: string | null = null;
  lines = lines.map((line) => { /* … toggles fence, demotes headings outside fences … */ });
  return lines.join('\n').trim();
```

`renderSection` (`knowledge-sections.ts:83-86`) renders changed/new sections;
untouched sections are re-emitted from `raw` by `serializeKnowledgeSections`
(`88-105`). `applyKnowledgeOperations` (`141-206`) parses the base, mutates
`doc.sections`, and returns `{ content: serializeKnowledgeSections(doc), applied }`.

Existing test that must keep passing unchanged — a **closed** fence containing a
`## ` line is not a section (`tests/unit/ai-learnings-text.test.ts:91-101`):

```ts
const doc = '# Firma\n\nEinleitung.\n\n## Versand\n\nVersand in 2 Tagen.\n\n## Rückgabe\n\n30 Tage.\n\n```md\n## kein Abschnitt\n```\n';
expect(parsed.sections.map((s) => s.title)).toEqual(['Versand', 'Rückgabe']);
expect(serializeKnowledgeSections(parsed)).toBe(doc);
```

Known quirk, **not** in scope: a line like ```` ```js ```` also closes an open
```` ``` ```` fence (CommonMark would not). Do not change it.

Conventions: German code comments in this file; tests are German `it(...)`
descriptions. Jest maps `@simplecrm/core` to `packages/core/src`, so unit tests
need no build.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;` in this environment.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Focused tests | `pnpm exec jest tests/unit/ai-learnings-text.test.ts tests/unit/ai-learnings-digest.test.ts` | all pass |
| Mail suite (uses the digest in both editions) | `pnpm exec jest tests/mail/email-ai-learnings.test.ts` | all pass |
| Typecheck (all) | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Unit tests | `pnpm run test:unit` | all pass |

## Scope

**In scope** (the only files you should modify):
- `packages/core/src/learnings/knowledge-sections.ts`
- `packages/core/src/learnings/digest.ts` (only `computeLearningsDigestProposal`)
- `tests/unit/ai-learnings-text.test.ts`
- `tests/unit/ai-learnings-digest.test.ts`
- `CHANGELOG.md` (`[Unreleased]` → `### Fixed`)

**Out of scope** (do NOT touch):
- `electron/email/email-ai-learnings.ts`, `packages/server/src/ai-learnings.ts` —
  both call the core function; the fix reaches them automatically. The accept
  paths (`acceptAiLearningDigest`) save the user-reviewed text as-is; the human
  may have edited it on purpose, so do not add checks there.
- The fence-closing quirk with info strings (see above) and any other markdown
  parsing change for documents whose fences are all closed.
- The knowledge document editor and document save paths.

## Git workflow

- Branch: `advisor/028-knowledge-sections-close-code-fences`
- Commit messages in German, imperative, area prefix, e.g.
  `Learnings: offene Codeblöcke schließen, keine Abschnitte verlieren`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Write the regression tests first (they must fail)

Extend `describe('Wissensbasis-Abschnitte (TA-P5)')` in
`tests/unit/ai-learnings-text.test.ts` with three tests:

1. **`'offener Codeblock im KI-Inhalt verschluckt keine späteren Abschnitte'`**:
   `base = '# KB\n\n## A\n\nalt A\n\n## B\n\nInhalt B\n\n## C\n\nInhalt C\n'`.
   `first = applyKnowledgeOperations(base, [{ op: 'update', section: 'A', content: 'Neu:\n```\ncode ohne Ende' }])`.
   Expect `parseKnowledgeSections(first.content).sections.map((s) => s.title)`
   to equal `['A', 'B', 'C']` and the A section content to end with
   `'code ohne Ende\n```'`.
   Then `second = applyKnowledgeOperations(first.content, [{ op: 'update', section: 'A', content: 'ganz neu' }])`;
   expect `second.content` to contain `'## B\n\nInhalt B'` and `'## C\n\nInhalt C'`.
   Also cover `~~~` once: `applyKnowledgeOperations(base, [{ op: 'add', section: 'D', content: '~~~\nx' }, { op: 'add', section: 'E', content: 'e' }])`
   → the parsed titles of the result equal `['A', 'B', 'C', 'D', 'E']`
   (today `E` is swallowed by D's open `~~~`).
2. **`'liest ein bereits beschädigtes Dokument (offener Codeblock bis Dateiende) abschnittsweise'`**:
   `broken = '## A\n\n```\ncode\n\n## B\n\nb\n\n## C\n\nc\n'` →
   titles `['A', 'B', 'C']`; `serializeKnowledgeSections(parseKnowledgeSections(broken))`
   must equal `broken` (lossless); `applyKnowledgeOperations(broken, [{ op: 'update', section: 'A', content: 'repariert' }]).content`
   must equal `'## A\n\nrepariert\n\n## B\n\nb\n\n## C\n\nc\n'`.
3. **`'korrekt geschlossene Codeblöcke bleiben unverändert'`**:
   `'## A\n\n```md\n## kein Abschnitt\n```\n\n## B\n\nb\n'` → titles `['A', 'B']`,
   and `'## A\n\n```\ncode ohne Ende\n'` (fence opened, **no** later heading) →
   titles `['A']` with content `'```\ncode ohne Ende'`. (Note: with the new rule,
   `'## A\n```\n## drin\n'` yields `['A', 'drin']` — an unterminated fence ends
   at the next `## ` heading; do not assert otherwise.)

**Verify**: `pnpm exec jest tests/unit/ai-learnings-text.test.ts` → the new tests
1 and 2 FAIL (1: titles `['A']`; 2: titles `['A']`), test 3 and all old tests pass.

### Step 2: Close open fences in normalized and rendered content

In `knowledge-sections.ts` add an exported helper next to `FENCE_PATTERN`:

```ts
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
```

Use it (a) at the end of `normalizeKnowledgeSectionContent`:
`return closeUnterminatedKnowledgeFence(lines.join('\n').trim());` and (b) in
`renderSection` on `body` (this also repairs an already-broken section as soon
as it is updated or appended to, because `appended` concatenates the existing
content).

**Verify**: `pnpm exec jest tests/unit/ai-learnings-text.test.ts` → test 1 now
passes; test 2 still fails; all pre-existing tests pass.

### Step 3: Parse an unterminated fence leniently (only when it runs to EOF)

Change the heading scan in `parseKnowledgeSections` so documents whose fences
all close parse exactly as before, and only a fence that is **still open at the
end of the document** is treated as ending at the next `## ` heading. Extract
the loop into a private function and re-scan:

```ts
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
        if (fence === null) { fence = fenceMatch[1]!; opener = i; lenient = lenientOpeners.has(i); }
        else if (fence === fenceMatch[1]) fence = null;
        continue;
      }
      if (fence !== null) {
        if (!(lenient && HEADING_PATTERN.test(line))) continue;
        fence = null;
      }
      const heading = HEADING_PATTERN.exec(line);
      if (heading) starts.push({ line: i, title: heading[1]!.trim() });
    }
    if (fence === null || lenient) return starts;
    lenientOpeners.add(opener);
  }
}
```

The loop terminates: every extra pass adds a new opener line to the set.
`parseKnowledgeSections` then uses `const starts = findSectionStarts(lines);`;
the rest (preamble/raw/content slicing) stays unchanged, so serialization stays
lossless. (This algorithm was prototyped against the four test inputs above.)

**Verify**: `pnpm exec jest tests/unit/ai-learnings-text.test.ts` → all tests pass.

### Step 4: Reject proposals whose section list is not the expected one

Defence in depth for anything else that could hide or invent headings. In
`applyKnowledgeOperations`, after `const content = serializeKnowledgeSections(doc)`,
re-parse and compare section titles with `doc.sections`:

```ts
const comparable = (title: string) => normalizeKnowledgeSectionTitle(title).replace(/[ \t#]+$/, '');
const expected = doc.sections.map((s) => comparable(s.title));
const actual = parseKnowledgeSections(content).sections.map((s) => comparable(s.title));
const structureError = expected.length === actual.length && expected.every((t, i) => t === actual[i])
  ? undefined
  : `Abschnitte stimmen nach dem Anwenden nicht (erwartet ${expected.length}, gefunden ${actual.length}).`;
return { content, applied, ...(structureError ? { structureError } : {}) };
```

Extend the return type with `structureError?: string`. In `digest.ts`
`computeLearningsDigestProposal`, directly after the `applyKnowledgeOperations`
call (line 505), return
`{ ok: false, error: truncateError(`Vorschlag verworfen: ${structureError}`) }` when set.

Add a test to `tests/unit/ai-learnings-digest.test.ts` (`describe('computeLearningsDigestProposal (TA-P5)')`):
with `base` from line 231 and a chat answer that updates `Kontakt` with
content `'Hotline\n```\nnicht geschlossen'`, the result is `ok: true` and
`parseKnowledgeSections(result.proposedContent).sections.map((s) => s.title)`
equals `['Kontakt', 'Rückgabe']` (import `parseKnowledgeSections` from
`../../packages/core/src/learnings/knowledge-sections`; before the fix this is
`['Kontakt']` — note that a plain `toContain('## Rückgabe')` would pass even
before the fix, so do not use it). The
`structureError` branch itself is covered by a unit test in
`ai-learnings-text.test.ts` only if you can construct a real mismatch; if you
cannot after Steps 2–3, do not invent one — leave the branch as a guard.

**Verify**: `pnpm exec jest tests/unit/ai-learnings-text.test.ts tests/unit/ai-learnings-digest.test.ts` → all pass.

### Step 5: Changelog and full checks

Add under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`, in the tone of
the existing entries:

`- **Beide Editionen:** Learnings: Enthielt ein KI-Vorschlag einen nicht geschlossenen Codeblock, erkannte die Wissensbasis alle folgenden Abschnitte nicht mehr, und der nächste übernommene Vorschlag für denselben Abschnitt löschte sie. Offene Codeblöcke werden jetzt geschlossen, bereits betroffene Wissensbasen werden wieder abschnittsweise gelesen, und ein Vorschlag, der Abschnitte verlieren würde, wird verworfen.`

**Verify**: `pnpm run typecheck` → exit 0; `pnpm run lint` → exit 0;
`pnpm run test:unit` → all pass; `pnpm exec jest tests/mail/email-ai-learnings.test.ts` → all pass.

## Test plan

- `tests/unit/ai-learnings-text.test.ts`: three new tests from Step 1
  (regression: unclosed fence then second update keeps B and C; lenient parse of
  an already-broken document incl. lossless round trip; closed fences unchanged).
- `tests/unit/ai-learnings-digest.test.ts`: one new test from Step 4 (end to end
  through `computeLearningsDigestProposal`).
- Pattern: the existing `it(...)` blocks in the same `describe`s.

## Done criteria

- [ ] `pnpm exec jest tests/unit/ai-learnings-text.test.ts tests/unit/ai-learnings-digest.test.ts` exits 0 with the 4 new tests
- [ ] The pre-existing test `'zerlegt verlustfrei und respektiert Codeblöcke'` is unmodified and passes (`git diff tests/unit/ai-learnings-text.test.ts` shows only additions)
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:unit` exit 0
- [ ] `grep -n "closeUnterminatedKnowledgeFence" packages/core/src/learnings/knowledge-sections.ts` shows the definition and ≥2 uses
- [ ] `git status` shows changes only in the in-scope files
- [ ] CHANGELOG entry added; row in `plans/README.md` updated and checkbox in `plans/MASTERPLAN.md` ticked

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1's tests 1/2 do **not** fail before the fix (the bug was fixed another way; re-scope).
- Any pre-existing test in `ai-learnings-text.test.ts` or `ai-learnings-digest.test.ts`
  needs its expectation changed — that means parsing of correct documents changed.
- The structure check of Step 4 fires in `tests/mail/email-ai-learnings.test.ts`
  or `tests/integration/postgres-ai-learnings.test.ts` (a false positive on valid data).
- The fix seems to require changes to the accept paths or the document editor.

## Maintenance notes

- Plan 048 (section-level retrieval) will chunk documents with
  `parseKnowledgeSections`; it inherits the lenient EOF rule, which is intended.
- Reviewers: check that `findSectionStarts` returns the same starts as the old
  loop whenever all fences close (only then is behaviour for correct documents
  unchanged), and that `renderSection` closes fences for `appended` sections.
- Deferred: CommonMark-correct fence closing (closing fence without info string,
  length ≥ opener). Changing it could re-split existing documents; only worth it
  if a real document needs it.
