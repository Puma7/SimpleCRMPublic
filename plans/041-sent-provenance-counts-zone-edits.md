# Plan 041: Edits in the signature or quote zone of an AI draft count as human edits ("KI · freigegeben" stays honest)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") and tick its checkbox in
> `plans/MASTERPLAN.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/core/src/email/sent-provenance.ts tests/mail/email-sent-provenance.test.ts tests/integration/postgres-sent-provenance.test.ts`
> Plan 026 may have extended `htmlLinkTargets` / `LINK_TARGET` in
> `sent-provenance.ts`; that is expected. For any other change, compare the
> excerpts below with the live code; on a mismatch, STOP.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW — only affects the label (`sent_by_kind`), never sending.
- **Depends on**: none (run after 026 if both are open, same file)
- **Category**: bug
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

Sent mail is labelled by who wrote it: `human`, `ai_approved` ("KI ·
freigegeben", listed in the virtual folder "Gesendet (KI)") or `ai_auto`. An
AI draft stays `ai_approved` as long as no human changed its content. To
ignore what the compose window inserts by itself, the check
`draftContentChanged` compares only the authored part **above** the
signature/quote zone markers. Consequence: a human can add a P.S. below the
signature, rewrite the signature, or edit the quoted thread, and the mail is
still labelled "KI · freigegeben". The label feeds the Learnings collection
(`sent_by_kind`) and the automation statistics, so it should be accurate.

## Current state

- `packages/core/src/email/sent-provenance.ts` — the check (both editions call it):

  ```ts
  // :152-164 (comment excerpt)
  // … Trägt das HTML die Zonen-Marker des Entwurfsfensters, zählen nur Anrede und Text:
  // Signatur- und Zitat-Zone setzt das Fenster selbst ein.
  export function draftContentChanged(before: DraftContentSnapshot, after: DraftContentSnapshot): boolean {
    return normalizedDraftMeta(before) !== normalizedDraftMeta(after) || draftBodyChanged(before, after);
  }

  // :198-222
  function draftBodyForms(snapshot: DraftContentSnapshot): DraftBodyForms {
    const html = String(snapshot.bodyHtml ?? '');
    const zones = html.trim() ? composeZones(html) : null;
    const authored = zones ? zones.authored : '';
    const htmlForm = html.trim()
      ? {
        text: normalizedBodyText(plainTextFromHtml(stripOutboundWarningFromHtml(authored))),
        links: htmlLinkTargets(authored),
      }
      : null;
    let text = snapshot.bodyText?.trim()
      ? normalizedBodyText(stripOutboundWarningFromPlain(snapshot.bodyText))
      : null;
    // Der Textteil des Entwurfsfensters enthält Signatur und Zitat mit; nur
    // Anrede und Text zählen (wie im HTML).
    if (text !== null && zones) {
      for (const zoneHtml of [zones.quoteHtml, zones.signatureHtml]) {
        const zoneText = normalizedBodyText(plainTextFromHtml(zoneHtml));
        if (!zoneText) continue;
        const at = text.lastIndexOf(zoneText);
        if (at >= 0) text = collapseWhitespace(`${text.slice(0, at)} ${text.slice(at + zoneText.length)}`);
      }
    }
    return { text: text || null, html: htmlForm };
  }

  // :245-262 composeZones(html): splits at LEARNING_COMPOSE_QUOTE_MARKER ('<!-- simplecrm-quote -->')
  // and LEARNING_COMPOSE_SIGNATURE_MARKER ('<!-- simplecrm-signature -->');
  // without markers (AI draft, legacy) everything is "authored".
  ```

- How the check is called — always **save-to-save** (previous stored content vs. new content):
  - Server: `packages/server/src/db/postgres-mail-read-ports.ts:1379-1400` inside `updateComposeDraft` (`before` = current row, `after` = row + submitted values).
  - Desktop: `electron/email/email-sent-provenance.ts:107-111` `markDraftOriginEditedIfChanged(draftId, before)`.
- The compose window saves all fields when it opens (comment in `draftContentChanged`: "Das Entwurfsfenster speichert beim Öffnen und vor dem Senden immer alle Felder"). An AI draft stored by a workflow has **no** zone markers; the first window save turns it into zoned HTML (greeting/body, `<!-- simplecrm-signature -->` signature, `<!-- simplecrm-quote -->` quote; see `shared/compose-body.ts:1-60`). Every later save has markers on **both** sides.
- Existing tests: `tests/mail/email-sent-provenance.test.ts` — notably `:93` "Mensch sendet unveränderten KI-Entwurf ⇒ ai_approved; nach Bearbeitung ⇒ human", `:112` "Speichern im Entwurfsfenster: nur eine echte Änderung zählt als Bearbeitung", `:151` "Review B7 …". Server: `tests/integration/postgres-sent-provenance.test.ts`.

## Design

Zones are excluded only on the transition where the window **inserts** them.
When both `before` and `after` already carry zone markers (every save after
the first one), the signature and quote zones are compared as well
(normalized text + link targets, same normalization as the authored part).
This keeps the first-open save neutral and catches every later human edit in
those zones. Known residual (document it in the code comment): an edit made
inside the signature/quote zone **before the very first save** of the window
is not detected — the window saves on open, so this needs a save path that
skips the open-save.

## Commands you will need

| Purpose | Command | Expected |
|---|---|---|
| Env | `export PATH=/opt/node24/bin:$PATH` | — |
| Focused mail test | `pnpm exec jest --config jest.mail.config.cjs --coverageThreshold='{}' tests/mail/email-sent-provenance.test.ts` | all pass |
| Mail suite | `pnpm run test:mail` | all pass |
| Build packages | `pnpm run build:packages` | exit 0 |
| Postgres test (non-root) | `su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit tests/integration/postgres-sent-provenance.test.ts"` (after `chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist`) | all pass |
| Typecheck / Lint | `pnpm run typecheck` / `pnpm run lint` | exit 0 |

## Scope

**In scope**
- `packages/core/src/email/sent-provenance.ts`
- `tests/mail/email-sent-provenance.test.ts`
- `tests/integration/postgres-sent-provenance.test.ts`
- `CHANGELOG.md`

**Out of scope**
- `shared/compose-body.ts` and the compose window — no change to how zones are written.
- `htmlLinkTargets` extensions (plan 026).
- Re-labelling already sent mail.

## Git workflow

- Branch `advisor/041-sent-provenance-zone-edits`.
- Commit style: `Kennzeichnung: Änderungen an Signatur und Zitat zählen als Bearbeitung`.
- Do not push or open a PR unless the operator says so.

## Steps

### Step 1: Red tests (desktop and server)

In `tests/mail/email-sent-provenance.test.ts`, next to the test at `:112`, add tests that build an AI draft, simulate the window's first save (zones inserted, content otherwise identical — reuse the fixture style of the `:112` test), then a **second** save that:

1. adds `<p>P.S. Rabatt 20 %</p>` after the signature (inside the signature zone) → expect `human` on send;
2. changes the signature text → expect `human`;
3. edits text inside the quote zone → expect `human`;
4. re-saves with only whitespace/attribute differences in the zones (e.g. `<p>` → `<p class="ql-align-left">`, extra `<p><br></p>`) → expect `ai_approved` (must stay green before and after the fix).

Mirror cases 1 and 4 in `tests/integration/postgres-sent-provenance.test.ts` using its existing helpers for drafts with origin (read the file for the fixture pattern).

**Verify**: cases 1–3 FAIL (label stays `ai_approved`), case 4 PASSES; server case 1 FAILS, server case 4 PASSES.

### Step 2: Compare zones when both sides already have them

In `sent-provenance.ts`:

1. Extend `DraftBodyForms` with `zones: { signature: { text: string; links: string[] }; quote: { text: string; links: string[] } } | null` — `null` when the HTML has neither marker.
2. In `draftBodyForms`, detect markers with `html.includes(LEARNING_COMPOSE_SIGNATURE_MARKER) || html.includes(LEARNING_COMPOSE_QUOTE_MARKER)`; when present, fill `zones` from `composeZones(html)` using `normalizedBodyText(plainTextFromHtml(zoneHtml))` and `htmlLinkTargets(zoneHtml)`.
3. In `draftBodyChanged`, after the existing checks: `if (a.zones && b.zones && JSON.stringify(a.zones) !== JSON.stringify(b.zones)) return true;`
4. Update the doc comment of `draftContentChanged` (German, same tone): zones are ignored only when the window inserts them (previous state without markers); afterwards changes in signature and quote count. Mention the residual from "Design".

Do not change the `text`-part subtraction logic.

**Verify**: the focused mail test → all new and old tests pass; the Postgres test → pass.

### Step 3: Gates and CHANGELOG

Add under `[Unreleased]` → `### Fixed`:
`- **Beide Editionen:** Ändert ein Mensch in einem KI-Entwurf die Signatur oder das Zitat (oder schreibt etwas unter die Signatur), gilt die Mail als bearbeitet und wird als „Mensch“ statt „KI · freigegeben“ gekennzeichnet. Das Einfügen von Signatur und Zitat durch das Entwurfsfenster zählt weiterhin nicht.`

**Verify**: `pnpm run test:mail`, `pnpm run typecheck`, `pnpm run lint`, the Postgres test → all green.

## Test plan

- New: 4 desktop cases + 2 server cases (Step 1).
- Unchanged and green: all of `tests/mail/email-sent-provenance.test.ts`, `tests/integration/postgres-sent-provenance.test.ts`, `tests/mail/email-sent-ai-view.test.ts`, `tests/unit/sent-provenance-ui.test.tsx`, `tests/mail/email-ai-learnings.test.ts` (Learnings collection depends on `sent_by_kind`).

## Done criteria

- [ ] `pnpm run test:mail` exits 0 with the 4 new cases present
- [ ] `tests/integration/postgres-sent-provenance.test.ts` exits 0 (non-root) with the 2 new cases
- [ ] `pnpm run typecheck` and `pnpm run lint` exit 0
- [ ] Only in-scope files changed (`git status`)
- [ ] CHANGELOG entry present; row 041 DONE in `plans/README.md`; box ticked in `plans/MASTERPLAN.md`

## STOP conditions

- Case 4 (window re-save with only formatting differences in the zones) fails after Step 2 — the window re-renders zones on every save; STOP and report what differs (probably the quote HTML), do not loosen the normalization ad hoc.
- The existing test at `:112` or `:151` fails after Step 2.
- You find a save path that writes zone markers into a draft that had none **and** carries human edits in the same save (e.g. a desktop reply flow that creates the draft already zoned). Report it; it widens the documented residual.

## Maintenance notes

- If the compose window ever stops saving on open, the "first save inserts zones" assumption weakens; revisit the residual.
- Any new zone marker in `shared/compose-body.ts` (e.g. greeting zone) should be handled here in the same way.
- Reviewers: check that zone comparison is only active when both snapshots carry markers.
