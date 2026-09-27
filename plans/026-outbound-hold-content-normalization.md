# Plan 026: "Unchanged held content" really means unchanged — no hidden text, CSS or image-source edits slip through the review skip

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") and tick its checkbox in
> `plans/MASTERPLAN.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/core/src/email/outbound-review-skip.ts packages/core/src/email/outbound-review-parse.ts packages/core/src/email/sent-provenance.ts packages/core/src/email/parse-utils.ts tests/unit/outbound-hold-content.test.ts tests/unit/outbound-warning-reformatted.test.ts`
> Plan 025 (approval marker bound to account) must be DONE first and may have
> touched `outbound-review-skip.ts` / `outbound-approval-marker.ts`; that is
> expected. For any other change, compare the "Current state" excerpts below
> with the live code; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED — a stricter comparison can disable the "Ohne Ausgangsprüfung senden" button after harmless editor re-saves; existing reformatting tests guard this.
- **Depends on**: `plans/025-approval-marker-bound-to-sender-account.md`
- **Category**: security
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

When the outbound review ("Ausgangsprüfung") holds a draft, a user may send
that exact held content anyway with "Ohne Ausgangsprüfung senden" (policy
`all`) — or, with policy `admins`, an admin does it. The server and the
desktop only allow the skip when the draft's normalized content still equals
the content at hold time, and the compose window only enables the button when
`outboundHoldContentEquals` says so. The normalization is lossy in three ways
(reproduced by the advisor on `packages/core/dist`, all three return `true`
= "unchanged"):

1. Appending `<span style="font-size:0">⚠️ AUSGANGSPRÜFUNG — VERSAND BLOCKIERT</span> Neue Bankverbindung: …`
   — everything after a bare marker copy is cut away before comparing, but it is **sent**.
2. Adding `<style>p::after{content:"Neue IBAN"}</style>` — `<style>` blocks are dropped before comparing.
3. Adding `<img srcset="https://evil.example/x.png 1x">` — only `href`/`src` count as link targets.

So content the review never saw can go out review-free; with policy `admins`
a non-admin can plant it and an admin releases it believing it is the held
content. After this plan, any of these edits counts as a change.

## Current state

- `packages/core/src/email/outbound-review-skip.ts` — normalization used for the hold fingerprint (server + desktop) and the UI equality check:

  ```ts
  // outbound-review-skip.ts:117-131
  export function normalizeOutboundHoldContent(input: OutboundHoldContentInput): OutboundHoldContent {
    const html = stripOutboundWarningFromHtml(String(input.bodyHtml ?? ''));
    return {
      accountId: String(input.accountId ?? '').trim(),
      subject: collapseWhitespace(String(input.subject ?? '')),
      bodyText: normalizedText(stripOutboundWarningFromPlain(String(input.bodyText ?? ''))),
      bodyHtml: JSON.stringify({
        text: normalizedText(stripOutboundWarningFromPlain(plainTextFromHtml(html))),
        links: htmlLinkTargets(html),
      }),
      to: draftRecipientAddresses(input.to).join(', '),
      cc: draftRecipientAddresses(input.cc).join(', '),
      bcc: draftRecipientAddresses(input.bcc).join(', '),
      attachmentPaths: attachmentPathList(input.attachments),
    };
  }
  ```

- `packages/core/src/email/outbound-review-parse.ts` — marker constants and strip helpers:

  ```ts
  // :3
  export const OUTBOUND_WARNING_MARKER = '⚠️ AUSGANGSPRÜFUNG — VERSAND BLOCKIERT';
  // :81
  export const OUTBOUND_WARNING_CLOSING_TEXT = 'Bitte E-Mail prüfen, korrigieren und erneut senden.';
  // :104-116
  export function stripOutboundWarningFromPlain(body: string): string {
    const text = body ?? '';
    const idx = text.indexOf(OUTBOUND_WARNING_MARKER);
    if (idx < 0) return text.trim();
    const after = text.slice(idx);
    const sep = after.indexOf('\n---\n');
    if (sep >= 0) {
      return text.slice(idx + sep + '\n---\n'.length).trimStart();
    }
    // Umgeformter Hinweis (Entwurfsfenster): nur den Hinweis entfernen, den Text behalten.
    if (after.includes(OUTBOUND_WARNING_CLOSING_TEXT)) return removeFlattenedOutboundWarning(text).trim();
    return text.slice(0, idx).trim();
  }
  // :180-190 stripOutboundWarningFromHtml: removes <div>…AUSGANGSPRÜFUNG…</div> blocks,
  // then, if the marker is still present, removeOutboundWarningParagraphs (only when
  // OUTBOUND_WARNING_CLOSING_TEXT follows the marker).
  ```

  `plainTextFromHtml` (`packages/core/src/email/parse-utils.ts:229-236`) drops `<style>`/`<script>` blocks and collapses **all** whitespace to single spaces, so the `'\n---\n'` separator can never match on its output; a bare marker therefore always hits `return text.slice(0, idx).trim()`.

- `packages/core/src/email/sent-provenance.ts:228-238` — link targets, shared with the sent-provenance check (`draftContentChanged`, `:205`):

  ```ts
  const LINK_TARGET = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi;
  export function htmlLinkTargets(html: string): string[] { … collapseWhitespace(decodeHtmlEntities(value)) … sort() }
  ```

- Callers (all go through the core function, so one fix covers both editions):
  - `packages/server/src/mail-outbound-hold.ts:99,126` — fingerprint at hold time and for the current draft.
  - `electron/email/outbound-hold-fingerprint.ts:30` — desktop fingerprint.
  - `src/components/email/compose-dialog.tsx:883` — button enable check (`outboundHoldContentEquals`).

- Existing tests that pin the **harmless** cases and must stay green:
  - `tests/unit/outbound-hold-content.test.ts` — "Speichern im Entwurfsfenster (Hinweis als Absatz, Attribute, Leerraum) ist keine Änderung" (`:39`), plus a `test.each` of real changes (text, text part only, link target, subject, recipients, bcc, attachment).
  - `tests/unit/outbound-warning-reformatted.test.ts` — strip behaviour; **note** `:37` pins the legacy behaviour `stripOutboundWarningFromPlain("Hallo ⚠️… Rest") === "Hallo"`. Do not change `stripOutboundWarningFromPlain` itself; it is also used to extract the body when (re-)holding a draft.
  - Mail/integration: `tests/mail/email-outbound-review-skip.test.ts`, `tests/integration/postgres-outbound-ai-decide-e2e.test.ts`, `tests/integration/sqlite-outbound-ai-decide-e2e.test.ts`, `tests/mail/email-sent-provenance.test.ts`, `tests/integration/postgres-sent-provenance.test.ts`.

- Backward compatibility: fingerprints of drafts held **before** this change are stored (`sync_info` key `outbound_hold_fingerprint:<id>`). If the normalized JSON shape changes for unchanged content, those drafts lose the skip button and must be sent normally (review runs again). Design the change so that content without residual markers, `<style>` blocks or extra URL attributes normalizes to **exactly the same JSON as today** (add new keys only when non-empty).

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Env | `export PATH=/opt/node24/bin:$PATH` | — |
| Focused unit tests | `pnpm exec jest tests/unit/outbound-hold-content.test.ts tests/unit/outbound-warning-reformatted.test.ts` | all pass |
| Mail suite | `pnpm run test:mail` | all pass |
| Build packages (for Postgres tests) | `pnpm run build:packages` | exit 0 |
| Postgres tests (non-root) | `su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit tests/integration/postgres-sent-provenance.test.ts tests/integration/postgres-outbound-ai-decide-e2e.test.ts"` (after `chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist`) | all pass |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |

## Scope

**In scope**
- `packages/core/src/email/outbound-review-skip.ts`
- `packages/core/src/email/sent-provenance.ts` (only `LINK_TARGET` / `htmlLinkTargets`, see Step 3)
- `tests/unit/outbound-hold-content.test.ts`
- `tests/unit/sent-provenance-link-targets.test.ts` (create, only if you prefer a separate file for Step 3)
- `CHANGELOG.md`

**Out of scope**
- `stripOutboundWarningFromPlain` / `stripOutboundWarningFromHtml` behaviour (used by hold/re-hold extraction; pinned by `outbound-warning-reformatted.test.ts`).
- The approval marker fingerprint (`outboundDraftFingerprint`) — plan 025.
- The skip policy (`all` / `admins`) and its UI.
- The sent-provenance zone logic — plan 041.

## Git workflow

- Branch `advisor/026-outbound-hold-content-normalization`.
- Commit style: `Ausgangsprüfung: versteckten Hinweis, Stile und Bildquellen beim Inhaltsvergleich mitzählen`.
- Do not push or open a PR unless the operator says so.

## Steps

### Step 1: Red tests for the three bypasses

In `tests/unit/outbound-hold-content.test.ts`, inside the existing `describe`, add a `test.each` using the file's `held()` helper and `atHold` (same pattern as the existing list of real changes). Each case must assert `outboundHoldContentEquals(atHold, changed)` is `false` **and** `outboundHoldFingerprint(changed) !== outboundHoldFingerprint(atHold)`:

- `'versteckter Hinweis mit angehängtem Text'`: `bodyHtml: atHold.bodyHtml + '<p><span style="font-size:0">' + OUTBOUND_WARNING_MARKER + '</span> Neue Bankverbindung: DE00 1234</p>'`
- `'Text im Textteil hinter einem Hinweis ohne Schlusssatz'`: `bodyText: atHold.bodyText + '\n' + OUTBOUND_WARNING_MARKER + ' Neue Bankverbindung'`
- `'style-Block'`: `bodyHtml: atHold.bodyHtml + '<style>p::after{content:"Neue IBAN"}</style>'`
- `'Stil-Attribut mit url()'`: `bodyHtml: atHold.bodyHtml.replace('<p>', '<p style="background:url(https://evil.example/b.png)">')` (adjust the replace target to a tag that exists in `atHold.bodyHtml`; print it once if unsure)
- `'srcset'`: `bodyHtml: atHold.bodyHtml + '<img srcset="https://evil.example/x.png 1x">'`
- `'background-Attribut'`: `bodyHtml: atHold.bodyHtml + '<table background="https://evil.example/t.png"><tr><td>x</td></tr></table>'`
- `'Formularziel'`: `bodyHtml: atHold.bodyHtml + '<form action="https://evil.example/f"><button>OK</button></form>'`

Also add one test asserting **unchanged-content stability**: for the existing `saved` fixture of the "Speichern im Entwurfsfenster" test, `JSON.stringify(normalizeOutboundHoldContent(atHold))` equals the value computed by the **current** code. Capture it before changing code: run a one-off `node -e` against `packages/core/dist` (after `pnpm run build:packages`) and paste the literal string into the test as the expected value. This pins backward compatibility of stored fingerprints.

**Verify**: `pnpm exec jest tests/unit/outbound-hold-content.test.ts` → the 7 new bypass cases FAIL (they return `true`), the stability test and all existing tests PASS.

### Step 2: Residual markers count as content

In `normalizeOutboundHoldContent`:

1. After `const html = stripOutboundWarningFromHtml(...)`, compute `const htmlText = normalizedText(plainTextFromHtml(html));`.
2. If `htmlText.includes(OUTBOUND_WARNING_MARKER)` the strip did not remove a real warning block → do **not** apply `stripOutboundWarningFromPlain` to it; use `htmlText` as-is for the `text` field. Otherwise keep today's `normalizedText(stripOutboundWarningFromPlain(plainTextFromHtml(html)))`.
3. For `bodyText`: a real warning in the text part is either followed by `'\n---\n'` or by `OUTBOUND_WARNING_CLOSING_TEXT`. Write a small local helper `stripKnownWarningFromPlain(text)` that returns `stripOutboundWarningFromPlain(text)` only when the marker is followed by one of those two; otherwise returns `text.trim()` unchanged (marker and trailing text stay part of the compared content). Use it for the `bodyText` field.

Import `OUTBOUND_WARNING_MARKER` / `OUTBOUND_WARNING_CLOSING_TEXT` from `./outbound-review-parse` (check the existing import list at the top of the file and extend it).

**Verify**: `pnpm exec jest tests/unit/outbound-hold-content.test.ts tests/unit/outbound-warning-reformatted.test.ts` → the two marker cases pass; all pre-existing tests and the stability test still pass.

### Step 3: Count `<style>` content and every URL-bearing attribute

1. In `sent-provenance.ts`, extend link-target extraction (keep the function name and sorted output):
   - attributes `href`, `src`, `srcset` (split on commas, take the URL part of each candidate), `background`, `action`, `formaction`, `poster`, `data`, `cite`, `xlink:href`;
   - `url(...)` values inside `style="…"` attributes and inside `<style>…</style>` blocks.
   Keep it linear: attribute regexes of the same shape as `LINK_TARGET` (one alternation of names, no nested quantifiers), and a single `indexOf`-based scan for `url(` … `)`. Do not use lazy `[\s\S]*?` over the whole document (the repo had CodeQL polynomial-regex findings; see commit `c40ed504`).
2. In `normalizeOutboundHoldContent`, add a `styles` value: the text of all `<style>` blocks of `html`, whitespace-collapsed, joined with `\n`. Use a linear scan (`indexOf('<style')`, `indexOf('>')`, `indexOf('</style>')`, case-insensitive via a lower-cased copy). Include it in the `bodyHtml` JSON **only when non-empty**: `JSON.stringify(styles ? { text, links, styles } : { text, links })`, so unchanged legacy content keeps its exact JSON.

Because `htmlLinkTargets` is shared with `draftContentChanged` (sent provenance), a human who adds a `srcset` image now also marks an AI draft as edited — that is correct. Run the provenance tests to confirm nothing else moves.

**Verify**: `pnpm exec jest tests/unit/outbound-hold-content.test.ts` → all 7 new cases pass, stability test passes; `pnpm run test:mail` → all pass.

### Step 4: Linear-time guard

Add a test in `tests/unit/outbound-hold-content.test.ts`: `normalizeOutboundHoldContent` on a hostile body of 200 000 characters (e.g. `'<style'.repeat(20_000) + 'url('.repeat(10_000) + ' srcset='.repeat(10_000)`) finishes in under 1 000 ms (use `Date.now()` like `tests/unit/workflow-run-step-detail.test.ts:198-207`).

**Verify**: the test passes in < 1 s.

### Step 5: Full gates and CHANGELOG

Add under `[Unreleased]` → `### Fixed` in `CHANGELOG.md`:
`- **Beide Editionen:** „Ohne Ausgangsprüfung senden“ gilt nur noch für wirklich unveränderten Inhalt. Ein nachträglich eingefügter (auch versteckter) Hinweis „Versand blockiert“ mit Text dahinter, geänderte Stile (\`<style>\`, \`url(…)\`) und weitere Bild- und Linkquellen (\`srcset\`, \`background\`, Formularziele) zählen jetzt als Änderung; dann läuft die Prüfung erneut.`

**Verify**: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:mail`, the Postgres tests from the Commands table → all green.

## Test plan

- New in `tests/unit/outbound-hold-content.test.ts`: 7 bypass cases (Step 1), stability pin (Step 1), linear-time guard (Step 4).
- Existing tests unchanged and green: `outbound-hold-content.test.ts`, `outbound-warning-reformatted.test.ts`, `tests/mail/email-outbound-review-skip.test.ts`, `tests/mail/email-sent-provenance.test.ts`, `tests/integration/postgres-sent-provenance.test.ts`, `tests/integration/postgres-outbound-ai-decide-e2e.test.ts`, `tests/integration/sqlite-outbound-ai-decide-e2e.test.ts`.

## Done criteria

- [ ] `pnpm exec jest tests/unit/outbound-hold-content.test.ts tests/unit/outbound-warning-reformatted.test.ts` exits 0 with the new tests present
- [ ] `pnpm run test:mail` exits 0
- [ ] Postgres tests from the Commands table exit 0 (run as non-root)
- [ ] `pnpm run typecheck` and `pnpm run lint` exit 0
- [ ] `git diff --name-only 9e0491e3..HEAD` lists only in-scope files (plus files changed by plan 025)
- [ ] CHANGELOG entry present
- [ ] Row 026 in `plans/README.md` set to DONE and the box ticked in `plans/MASTERPLAN.md`

## STOP conditions

- The stability test (Step 1) fails after Step 2 or 3 — the change would invalidate fingerprints of drafts already held; STOP and report instead of re-baselining it.
- Any existing "harmless reformatting" test in `outbound-hold-content.test.ts` or `outbound-warning-reformatted.test.ts` fails and the fix would require loosening the new checks.
- The compose editor turns out to add `style`/`srcset`/`url()` on its own when re-saving (e.g. a sent-provenance or compose test starts failing with only editor-generated markup). STOP and report which markup the editor produces.
- The fix appears to need changes to `stripOutboundWarningFromPlain` or `stripOutboundWarningFromHtml`.

## Maintenance notes

- `htmlLinkTargets` is shared by the hold comparison and sent provenance; new URL-bearing HTML features (e.g. `<video poster>`, `<source srcset>`) must be added there once.
- If the warning banner format changes (`buildOutboundWarningBanner`, marker or closing text), update the "known warning" detection in Step 2 in the same commit.
- Reviewers: check the new scans for linear complexity and the "new keys only when non-empty" rule.
