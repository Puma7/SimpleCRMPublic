# Plan 032: Learnings privacy filter also removes card numbers, tax/social-security/ID numbers and IP addresses

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/core/src/learnings/redact.ts tests/unit/ai-learnings-redact.test.ts tests/unit/ai-learnings-redos.test.ts src/components/email/settings/learnings-panel.tsx docs/USER_GUIDE_WORKFLOWS.md`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security (privacy)
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

"Learnings" collects text from sent replies and notes, redacts personal data with
`redactPersonalData`, stores **only the redacted text** for up to 90 days and sends
it to the configured AI provider in the digest prompt. The settings page promises
"Gespeichert wird nur der bereinigte Text". Verified at HEAD (run against the built
`packages/core/dist`), these inputs pass through **unchanged**:

| Input | Output today |
|---|---|
| `Kreditkarte 4111 1111 1111 1111` | unchanged |
| `4111-1111-1111-1111` | unchanged |
| `Steuer-ID 12 345 678 901` | unchanged |
| `Steuernummer 123/456/78901` | unchanged |
| `Sozialversicherungsnummer 65 170839 J 003` | unchanged |
| `Personalausweis L01X00T47` | unchanged |
| `IP 192.168.1.10`, `IPv6 2001:db8::1` | unchanged |

(`4111111111111111` without separators and `Steuer-ID: 12345678901` ARE already
replaced by `[Nummer]` via the long-digit rule.) After this plan, these categories
are replaced before storage and before the AI sees them, with the same
linear-time guarantees as the existing patterns.

## Current state

- `packages/core/src/learnings/redact.ts` — the filter (shared by Desktop and Server).
  - Placeholders, `redact.ts:17-26`:
    ```ts
    export const LEARNING_PLACEHOLDERS = {
      email: '[E-Mail]', phone: '[Telefon]', iban: '[IBAN]', bic: '[BIC]',
      link: '[Link]', address: '[Adresse]', number: '[Nummer]', name: '[Name]',
    } as const;
    ```
    (shown condensed; one key per line in the file). `collapsePlaceholders`
    (`redact.ts:314-321`) iterates `Object.values(P)`, so new placeholders are
    collapsed automatically.
  - Long digits, `redact.ts:187-188`: only unbroken runs are caught:
    `const LONG_DIGITS_PATTERN = /(?<![\d.,])\d{7,}(?![\d.,]\d)/g;`
  - Phones, `redact.ts:196-197`: international needs `+`/`00`, national needs a leading `0`.
  - Keyword pattern for business numbers (`NUMBER_KEYWORDS`, `redact.ts:148-182`):
    keyword stays, value becomes `[Nummer]`; value class `[A-Z0-9](?:[A-Z0-9./_-]*[A-Z0-9])?`
    has **no spaces**, so grouped values survive.
  - Pipeline order in `redactPersonalData`, `redact.ts:327-380`: URL → e-mail → IBAN →
    BIC keyword → BIC bare → ticket code → number keyword → `#` number → phone keyword →
    phone international → phone national → street → English street → postal/city →
    long digits → names → title+name → `collapsePlaceholders`.
  - Test hook, `redact.ts:386-403`: `LEARNING_REDACTION_PATTERNS_FOR_TESTS` maps a name
    to every regex; `tests/unit/ai-learnings-redos.test.ts:94-105` runs **every entry**
    against 200 KB degenerate inputs (`DEGENERATE`, lines 26-72) with a 200 ms budget.
  - The header comment (`redact.ts:10-14`) states the linearity rules: a match starts
    only at the beginning of a token (lookbehind instead of `\b`), whitespace is never
    split ambiguously across several `\s*`, follow-up checks look back over few chars.
- `packages/core/src/learnings/candidates.ts:52-54` — `sanitize()` = `truncateLearningText(redactPersonalData(text, hints), max)`; the only stored form.
- `packages/core/src/learnings/digest.ts:493-504` — AI output is redacted again with
  `keepExisting: baseContent` (data already in the KB stays).
- `tests/unit/ai-learnings-redact.test.ts` (110 lines) — behaviour tests; the
  no-false-positive test is at lines 73-91 (dates, prices `1.299,00 €`, `Version 2.4.1`,
  `Lieferzeit 10-12 Werktage` must stay). Idempotence test at lines 93-98.
- UI privacy notice, `src/components/email/settings/learnings-panel.tsx:430-438`
  (`data-testid="learnings-privacy"`), lists the categories:
  `personenbezogene Daten (Namen, E-Mail-Adressen, Telefonnummern, IBAN, Links, Adressen, Bestell-,
  Kunden- und Rechnungsnummern) durch Platzhalter.`
  `tests/unit/learnings-panel.test.tsx:193` only asserts it contains `personenbezogene Daten`.
- User docs, `docs/USER_GUIDE_WORKFLOWS.md:279` — same list with placeholder names.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;` in this environment.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Focused tests | `pnpm exec jest tests/unit/ai-learnings-redact.test.ts tests/unit/ai-learnings-redos.test.ts tests/unit/ai-learnings-digest.test.ts` | all pass |
| Panel test | `pnpm exec jest tests/unit/learnings-panel.test.tsx` | all pass |
| Desktop Learnings tests | `pnpm run test:mail -- tests/mail/email-ai-learnings.test.ts` | all pass |
| Typecheck | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Unit | `pnpm run test:unit` | all pass |
| UI coverage ratchet | `pnpm run test:ui:coverage:check` | pass |

## Scope

**In scope** (the only files you should modify):
- `packages/core/src/learnings/redact.ts`
- `tests/unit/ai-learnings-redact.test.ts`
- `tests/unit/ai-learnings-redos.test.ts` (add degenerate inputs only)
- `src/components/email/settings/learnings-panel.tsx` (privacy text only)
- `tests/unit/learnings-panel.test.tsx` (one assertion)
- `docs/USER_GUIDE_WORKFLOWS.md` (line 279 list)
- `CHANGELOG.md` (`[Unreleased]` → `### Fixed`)

**Out of scope** (do NOT touch):
- `packages/core/src/learnings/candidates.ts`, `digest.ts` — callers need no change.
- Re-redacting candidates already stored in `ai_learning_candidates` (both editions).
  They expire after 90 days; a one-off job is a separate decision (see Maintenance notes).
- USt-IdNr (`DE123456789`): company VAT IDs are business data a KB may legitimately
  contain; not added here.
- Bare, unlabelled grouped numbers like `12 345 678 901` without a keyword — not
  reliably distinguishable from quantities; not added.
- Any change to existing patterns' behaviour (all existing tests must stay green unchanged).

## Git workflow

- Branch: `advisor/032-learnings-redaction-gaps`
- Commit message (German, area prefix), e.g.
  `Learnings: Kartennummern, Steuer-/SV-/Ausweisnummern und IP-Adressen im Datenschutzfilter ersetzen`
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Regression tests first

In `tests/unit/ai-learnings-redact.test.ts` add a new `it('ersetzt Kartennummern, Steuer-/SV-/Ausweisnummern und IP-Adressen', …)` with these exact expectations:

```ts
expect(redactPersonalData('Kreditkarte 4111 1111 1111 1111')).toBe('Kreditkarte [Kartennummer]');
expect(redactPersonalData('Karte: 4111-1111-1111-1111.')).toBe('Karte: [Kartennummer].');
expect(redactPersonalData('Amex 3782 822463 10005 bitte')).toBe('Amex [Kartennummer] bitte');
expect(redactPersonalData('Steuer-ID 12 345 678 901')).toBe('Steuer-ID [Nummer]');
expect(redactPersonalData('Steuernummer 123/456/78901')).toBe('Steuernummer [Nummer]');
expect(redactPersonalData('St.-Nr. 21/815/08150')).toBe('St.-Nr. [Nummer]');
expect(redactPersonalData('Sozialversicherungsnummer 65 170839 J 003')).toBe('Sozialversicherungsnummer [Nummer]');
expect(redactPersonalData('SV-Nummer: 65170839J003 ist hinterlegt')).toBe('SV-Nummer: [Nummer] ist hinterlegt');
expect(redactPersonalData('Personalausweis L01X00T47')).toBe('Personalausweis [Nummer]');
expect(redactPersonalData('Ausweisnummer: L01X00T47, gültig')).toBe('Ausweisnummer: [Nummer], gültig');
expect(redactPersonalData('Reisepass C01X00T47')).toBe('Reisepass [Nummer]');
expect(redactPersonalData('IP 192.168.1.10.')).toBe('IP [IP-Adresse].');
expect(redactPersonalData('IPv6 2001:db8::1 und fe80::1ff:fe23:4567:890a'))
  .toBe('IPv6 [IP-Adresse] und [IP-Adresse]');
expect(redactPersonalData('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe('[IP-Adresse]');
```

Add a second `it('keine Fehlalarme bei Karten-, ID- und IP-Mustern', …)`:

```ts
for (const text of [
  'Karte 4111 1111 1111 1112',            // Luhn falsch
  'Preis 1.234,56 € am 12.03.2026 um 12:30:45 Uhr',
  'Version 1.2.3.4 und v10.0.0.1',        // Versionsnummern, keine IPs
  'Lieferzeit 10-12 Werktage',
  'Pass auf, 3 Tage. Ausweis bitte mitbringen. Steuer-ID bitte nachreichen.',
]) expect(redactPersonalData(text)).toBe(text);
```

Do NOT use `Rechnung 2026-0012-0001` as a no-false-positive case: the existing
NUMBER_KEYWORD rule already (intentionally) turns it into `Rechnung [Nummer]` (verified on dist).
Extend the idempotence test (lines 93-98) input
with `, Karte 4111 1111 1111 1111, IP 10.0.0.7` and assert `once` does not match `/4111|10\.0\.0\.7/`.

**Verify**: `pnpm exec jest tests/unit/ai-learnings-redact.test.ts` → the new positive test FAILS (values unchanged); the no-false-positive test passes.

### Step 2: Add placeholders and patterns

In `redact.ts`:

1. Extend `LEARNING_PLACEHOLDERS` with `card: '[Kartennummer]'` and `ip: '[IP-Adresse]'`.
   Tax/SV/ID values use the existing `number: '[Nummer]'` (keyword stays, value replaced —
   same convention as `NUMBER_KEYWORD_PATTERN`). Update the JSDoc list at `redact.ts:323-326`.
   Add `'kartennummer'` to `NAME_PART_STOPWORDS` (placeholder words are listed there).
2. Add these patterns (prototyped against the cases in Step 1; all bounded per start
   position and anchored by lookbehind, therefore linear):

```ts
// --- Kartennummern ----------------------------------------------------------
/** 13–19 Ziffern in Gruppen mit genau einem Leerzeichen/Bindestrich; ohne Trenner greift LONG_DIGITS. */
const CARD_PATTERN = /(?<![\d.,/-])\d{4}(?:[ -]\d{3,6}){2,4}(?!\d|[.,/-]\d)/g;

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits.charCodeAt(i) - 48;
    if (double) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

// --- IP-Adressen ------------------------------------------------------------
const IPV4_OCTET = '(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)';
const IPV4_PATTERN = new RegExp(`(?<![\\w.])(?:${IPV4_OCTET}\\.){3}${IPV4_OCTET}(?![\\w]|\\.\\d)`, 'g');
const HEX = '[0-9A-Fa-f]{1,4}';
const IPV6_PATTERN = new RegExp(
  `(?<![\\w:.])(?:(?:${HEX}:){7}${HEX}|(?:${HEX}(?::${HEX}){0,6})?::(?:${HEX}(?::${HEX}){0,6})?)(?![\\w:.])`,
  'g',
);

// --- Steuer-, Sozialversicherungs-, Ausweisnummern ---------------------------
const ID_KEYWORDS = [
  'Steuer-?ID', 'Steuer-?Identifikationsnummer', '(?:Steuerliche\\s)?Identifikationsnummer', 'IdNr\\.?',
  'Steuer-?(?:nummer|-?Nr\\.?)', 'St\\.?-?Nr\\.?',
  'Sozialversicherungs-?(?:nummer|ausweis)', 'SV-?(?:Nummer|Nr\\.?)', 'SVNR',
  'Renten(?:versicherungs)?-?(?:nummer|Nr\\.?)', 'RV-?(?:Nummer|Nr\\.?)',
  'Krankenversicherten-?(?:nummer|Nr\\.?)', 'KVNR',
  '(?:Personal)?ausweis(?:nummer|-?Nr\\.?)?', 'Reisepass(?:nummer|-?Nr\\.?)?', 'Pass(?:nummer|-?Nr\\.?)',
  'Führerschein(?:nummer|-?Nr\\.?)?',
  'Tax\\s?ID', 'Passport(?:\\s?(?:number|no\\.?))?', 'Social\\sSecurity(?:\\s?(?:number|no\\.?))?', 'SSN',
];
/**
 * Wert: Blöcke aus Buchstaben/Ziffern, getrennt durch / . - oder ein Leerzeichen,
 * nach dem eine Ziffer folgt (oder ein einzelner Buchstabe vor einer Ziffer, SV-Nummer
 * „65 170839 J 003“). Beschränkte Wiederholungen → linear.
 */
const ID_KEYWORD_PATTERN = new RegExp(
  `(?<![\\p{L}\\p{N}])(${ID_KEYWORDS.join('|')})((?:\\s*[:#]|\\s)\\s*)([A-Z0-9]{1,12}(?:[/.-][A-Z0-9]{1,12}|[ ](?:\\d[A-Z0-9]{0,11}|[A-Z](?=[ ]\\d))){0,6})`,
  'giu',
);
```

3. Wire them into `redactPersonalData` **right after the `BIC_BARE_PATTERN` line and
   before `TICKET_CODE_PATTERN`** (so the business-number and phone rules never see
   partial card/ID values), in this order:

```ts
out = replaceWith(out, IPV6_PATTERN, keep, (match) => (isLikelyIpv6(match) ? P.ip : null));
out = out.replace(IPV4_PATTERN, (match, offset: number, whole: string) =>
  keep(match) || followsVersionWord(whole, offset) ? match : P.ip);
out = replaceWith(out, CARD_PATTERN, keep, (match) => {
  const digits = match.replace(/\D/g, '');
  return digits.length >= 13 && digits.length <= 19 && passesLuhn(digits) ? P.card : null;
});
out = replaceWith(out, ID_KEYWORD_PATTERN, keep, (_m, g) => {
  const value = g[2] ?? '';
  const alnum = value.replace(/[^A-Za-z0-9]/g, '');
  return countDigits(value) >= 3 && alnum.length >= 6 ? `${g[0]}${g[1]}${P.number}` : null;
});
```

   Helpers (keep them tiny and non-regex over the whole text):
   - `isLikelyIpv6(m)`: without `::` → always true (the pattern already demands 8 groups);
     with `::` → at least 2 non-empty groups AND at least one group of length ≥ 3 or
     containing `a-f` (so `12:30::45`-style noise and bare `::1` stay).
   - `followsVersionWord(whole, offset)`: look back over at most 12 characters before
     `offset`; true if they end with `/(?:version|vers\.|v)\s*$/i`. Reuse the
     backwards-scan style of `startsLineOrFollowsComma` (`redact.ts:219-223`) — slice at
     most 12 chars, never the whole prefix.
   Note: `replaceWith` passes groups via `args.slice(1, -2)`; `ID_KEYWORD_PATTERN` uses
   the `u` flag but no named groups, so that slice is still correct.
4. Register all four in `LEARNING_REDACTION_PATTERNS_FOR_TESTS`:
   `card: CARD_PATTERN, ipv4: IPV4_PATTERN, ipv6: IPV6_PATTERN, idKeyword: ID_KEYWORD_PATTERN`.

**Verify**: `pnpm exec jest tests/unit/ai-learnings-redact.test.ts` → all pass (new and old).

### Step 3: Extend the ReDoS suite

In `tests/unit/ai-learnings-redos.test.ts` add to `DEGENERATE` (lines 26-72):
`'1111 ': repeatTo('1111 ')`, `'1111-': repeatTo('1111-')`, `'1.': repeatTo('1.')`,
`'1:': repeatTo('1:')`, `'f:f::': repeatTo('f:f::')`, `'Steuer-ID 1 ': repeatTo('Steuer-ID 1 ')`,
`'Ausweis A ': repeatTo('Ausweis A ')`, `'SV-Nr 1 A ': repeatTo('SV-Nr 1 A ')`,
`'Pass 1/': repeatTo('Pass 1/')`. The four new patterns are picked up automatically
through `LEARNING_REDACTION_PATTERNS_FOR_TESTS`.

**Verify**: `pnpm exec jest tests/unit/ai-learnings-redos.test.ts` → all pass; the
`test.each` list now includes `Muster card`, `Muster ipv4`, `Muster ipv6`, `Muster idKeyword`
(check with `--verbose`).

### Step 4: Update the privacy promise (UI + docs)

- `learnings-panel.tsx:433-435`: replace the category list with
  `(Namen, E-Mail-Adressen, Telefonnummern, IBAN, Kartennummern, Steuer-, Sozialversicherungs- und Ausweisnummern, IP-Adressen, Links, Adressen, Bestell-, Kunden- und Rechnungsnummern)`.
- `tests/unit/learnings-panel.test.tsx:193`: add
  `expect(screen.getByTestId('learnings-privacy')).toHaveTextContent('Kartennummern');`
- `docs/USER_GUIDE_WORKFLOWS.md:279`: add
  `Kreditkartennummern (mit Prüfziffer) → [Kartennummer], Steuer-ID/Steuernummer, Sozialversicherungs-, Ausweis-, Pass- und Führerscheinnummern (nach dem Stichwort) → [Nummer], IP-Adressen → [IP-Adresse]`.
  Also state: "Bereits gesammelte Einträge werden nicht nachträglich bereinigt; sie werden spätestens nach 90 Tagen gelöscht."
- `CHANGELOG.md` `[Unreleased]` → `### Fixed`:
  `- **Beide Editionen:** Der Learnings-Datenschutzfilter ersetzt jetzt auch Kreditkartennummern mit Leerzeichen oder Bindestrichen, Steuer-ID/Steuernummer, Sozialversicherungs-, Ausweis- und Passnummern sowie IPv4-/IPv6-Adressen. Vorher gingen sie unverändert in die gesammelten Einträge und in die KI-Auswertung. Schon gesammelte Einträge werden nicht nachträglich bereinigt.`

**Verify**: `pnpm exec jest tests/unit/learnings-panel.test.tsx` → all pass.

### Step 5: Full gates

**Verify**: `pnpm run typecheck` exit 0; `pnpm run lint` exit 0; `pnpm run test:unit` all pass;
`pnpm run test:mail -- tests/mail/email-ai-learnings.test.ts` all pass;
`pnpm run test:ui:coverage:check` pass.

## Test plan

- `tests/unit/ai-learnings-redact.test.ts`: 2 new `it` blocks (positive cases, no false
  positives) + extended idempotence case — model after the existing `it` blocks there.
- `tests/unit/ai-learnings-redos.test.ts`: 9 new degenerate inputs; 4 new patterns covered
  by the existing `test.each(PATTERNS)`.
- `tests/unit/learnings-panel.test.tsx`: 1 new assertion.
- Existing tests in `tests/mail/email-ai-learnings.test.ts`, `tests/unit/ai-learnings-digest.test.ts`
  and `tests/integration/postgres-ai-learnings.test.ts` must pass unchanged.

## Done criteria

- [ ] `pnpm run typecheck` exits 0; `pnpm run lint` exits 0 with 0 warnings
- [ ] `pnpm exec jest tests/unit/ai-learnings-redact.test.ts tests/unit/ai-learnings-redos.test.ts tests/unit/learnings-panel.test.tsx` all pass
- [ ] `grep -n "card: CARD_PATTERN\|ipv4: IPV4_PATTERN\|ipv6: IPV6_PATTERN\|idKeyword: ID_KEYWORD_PATTERN" packages/core/src/learnings/redact.ts` shows 4 lines
- [ ] `pnpm run test:unit` and `pnpm run test:ui:coverage:check` pass
- [ ] `git status` shows only in-scope files changed
- [ ] Row 032 in `plans/README.md` (Runde 2) updated and checkbox in `plans/MASTERPLAN.md` ticked

## STOP conditions

Stop and report (do not improvise) if:

- Any existing assertion in `ai-learnings-redact.test.ts` or `ai-learnings-redos.test.ts`
  fails after Step 2 and the only fix would be changing an existing pattern or expectation.
- A new pattern exceeds the 200 ms budget in the ReDoS test and cannot be made linear by
  tightening bounds (do not raise `BUDGET_MS` or remove degenerate inputs).
- The desktop or Postgres Learnings tests show a changed stored text for an existing fixture
  (would mean a false positive on realistic mail text).
- You feel the need to change `candidates.ts`/`digest.ts` or add a DB migration.

## Maintenance notes

- **Stored data is not re-redacted.** Candidates collected before this change keep their
  text until they are processed or pruned (≤ 90 days, `pruneAiLearningCandidates` /
  desktop equivalent). A one-off re-redaction job (both editions: read `question_text`,
  `ai_text`, `human_text`, `note_text`, run `redactPersonalData`, write back) is deferred —
  it touches customer data in production and needs Pascal's approval. Pending digests'
  `base_content`/`proposed_content` are not affected by this plan either.
- **Deliberate trade-offs**: order/article numbers with ≥ 7 unbroken digits (incl. 13-digit
  EAN/GTIN) were already replaced by `LONG_DIGITS_PATTERN` before this plan — unchanged.
  A grouped 13–19 digit number that happens to pass Luhn (≈10 % of random numbers) is
  replaced as `[Kartennummer]`; acceptable for a privacy filter. Four-part version numbers
  are protected only when preceded by `Version`/`Vers.`/`v`.
- The AI-output pass (`digest.ts:493-504`) uses `keepExisting`, so an IP or ID that is
  already in the KB stays — same semantics as phones.
- Reviewer focus: linearity of `ID_KEYWORD_PATTERN` (bounded `{1,12}`/`{0,6}` only) and
  pipeline order (new rules before `TICKET_CODE_PATTERN`/`NUMBER_KEYWORD_PATTERN`).
