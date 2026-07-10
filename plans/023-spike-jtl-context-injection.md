# Plan 023: SPIKE — auto-inject a JTL context block into inbound mail for AI nodes

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. This is a **direction/design spike**: the
> deliverable is a working prototype node **plus a written recommendation**
> (`docs/SPIKE_JTL_CONTEXT_INJECTION.md`), **not** a shipped, UI-wired feature.
> Do not build beyond the scope below. When done, update the status row for
> this plan in the `README.md` of the directory this plan lives in
> (`plans/README.md`) — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- electron/workflow/nodes/integration-nodes.ts tests/unit/jtl-context-spike.test.ts docs/SPIKE_JTL_CONTEXT_INJECTION.md`
> If any in-scope file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition. This spike also *reads* (does not modify) several
> reference files — `packages/server/src/workflow-execution.ts`,
> `packages/core/src/workflow/node-catalog.ts`,
> `electron/workflow/nodes/ai-nodes.ts`, `electron/workflow/context.ts`,
> `electron/mssql-keytar-service.ts`, `electron/email/email-reply-ai.ts`. If any
> of those drifted from the excerpts below, re-validate before proceeding (see
> STOP conditions).

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The named differentiator for this product is "KI + JTL-Kontext": when a customer
mail arrives, the AI nodes should already see that sender's recent JTL order,
tracking, return, and payment status as a ready-made block, without an agent
hand-copying it. `docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md` lists this as a **P0**
gap (request #2). The surprise this spike must resolve: the **server edition
already implements the resolver** (`jtl.order_context` in
`packages/server/src/workflow-execution.ts`) and the shared **catalog already
advertises the node**, but the **Electron desktop runtime does not implement it**
— so the catalog entry is a dead node on desktop — and it is **not proven that
the resulting `jtl.*` variables actually reach the two AI nodes operators care
about** (`ai.agent`, `ai.reply_suggestion`). The point of this spike is to
prototype the desktop resolver by reusing the already-validated read-only MSSQL
seam, empirically pin down whether/how the block reaches each AI node, and write
a go/no-go recommendation with a concrete API and the open questions answered —
so a later build plan is de-risked, not guessed.

## Current state

This is a **spike**, so "Current state" is mostly a map of what already exists.
Read these before writing anything.

### 1. The feature request (the intent this spike serves)

`docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md:40` (P0 list):

```
- [ ] **JTL-Kontextblock automatisch zur Mail (#2).** Auf Basis von
  `jtl.lookup`/`mssql.query`: Absender → Bestellung(en) →
  Tracking/Retoure/Zahlstatus als strukturierter Kontext, der KI-Nodes
  automatisch mitbekommen.
```

### 2. The catalog already declares the node (both editions read this)

`packages/core/src/workflow/node-catalog.ts:377-385`:

```ts
  {
    type: 'jtl.order_context',
    label: 'JTL Bestell-Kontext',
    category: 'integration',
    canvasType: 'registry',
    description:
      'Read-only-Query (MSSQL) mit {{email}}/{{orderNo}}; mappt die erste Zeile auf jtl.*-Variablen für KI-Nodes.',
    defaultConfig: { query: 'SELECT TOP 1 cStatus FROM tBestellung WHERE cEmail = {{email}}', mapping: '' },
  },
```

### 3. The server edition ALREADY implements the resolver (port from here)

`packages/server/src/workflow-execution.ts` — dispatch at line 1652, the
resolver at 2890, and its helpers below. Excerpt of the resolver body
(`executeWorkflowJtlOrderContext`, ~2890-2927):

```ts
  const email = context.message ? extractWorkflowEmailAddress(context.message.from_json) : '';
  const orderNo = String(
    context.variables['jtl.order_no'] ?? context.strings.order_no ?? config.orderNo ?? '',
  ).trim();

  const bound = bindJtlContextPlaceholders(template, email, orderNo);
  if (!bound.ok) {
    return { status: 'skipped', port: 'no_match', message: bound.reason, variables: { 'jtl.context_found': false } };
  }
  const validation = validateReadOnlyMssqlQuery(bound.query);
  if (!validation.ok) return { status: 'error', port: 'error', message: validation.error };
  // ... run query ...
  const rows = result.rows ?? [];
  const first = rows[0];
  if (!first || typeof first !== 'object') {
    return { status: 'ok', port: 'no_match', message: 'Keine JTL-Daten gefunden', variables: { 'jtl.context_found': false } };
  }
  const mapping = parseJtlContextMapping(config.mapping);
  const variables: WorkflowVariableContext = { 'jtl.context_found': true };
  for (const [column, value] of Object.entries(first as Record<string, unknown>)) {
    const key = column.toLowerCase();
    variables[mapping[key] ?? `jtl.${key}`] = jtlContextScalar(value);
  }
  return { status: 'ok', port: 'default', variables };
```

Supporting helpers you will port (all in the same file):

- `bindJtlContextPlaceholders` (line 2929): replaces `{{email}}`/`{{orderNo}}`
  in the template with **SQL-escaped literals**; returns `{ ok: false, reason }`
  when a required placeholder is present but the value fails validation.
- `sqlStringLiteral` (line 2950): `` `'${value.replace(/'/g, "''")}'` `` — the
  single-quote escape. **Load-bearing: never interpolate the raw email/order
  number into SQL without this.**
- Validation regexes (lines 2879-2880):
  ```ts
  const JTL_CONTEXT_EMAIL_RE = /^[^\s@'";\\]+@[^\s@'";\\]+\.[^\s@'";\\]+$/;
  const JTL_CONTEXT_ORDER_NO_RE = /^[A-Za-z0-9._\-/]{1,64}$/;
  ```
- `parseJtlContextMapping` (line 3262): parses a `"col:jtl.target,col2:jtl.t2"`
  string into `{ col: 'jtl.target' }` (column keys lowercased).
- `jtlContextScalar` (line 3272): coerces a cell to a workflow scalar
  (numbers/booleans pass through, `Date` → ISO string, everything else
  `String(v).slice(0, 2000)`).

The server edition has a passing test for this at
`tests/unit/server-edition-foundation.test.ts:7747` ("… binds sender email into
jtl.order_context and maps columns", with `mapping: 'cStatus:jtl.status'`).

### 4. The Electron desktop runtime does NOT implement it

`electron/workflow/nodes/integration-nodes.ts` registers only `sync.run`,
`http.request`, `mssql.query` (line 72), and `jtl.lookup` (line 110). There is
**no** `jtl.order_context` registration anywhere under `electron/`
(`grep -rn order_context electron/` → nothing). So on desktop the catalog
advertises a node that never runs.

The read-only MSSQL execution helper the prototype must reuse
(`electron/mssql-keytar-service.ts:569`):

```ts
export async function executeReadOnlyMssqlQuery(
  sqlQuery: string,
): Promise<{ success: boolean; rows?: unknown[]; rowCount?: number; error?: string }> {
```

**Important seam gap**: `executeReadOnlyMssqlQuery` only enforces a length cap —
it does **not** enforce "SELECT-only". The SELECT-only guard lives in the
`mssql.query` **node**, `electron/workflow/nodes/integration-nodes.ts:87-95`:

```ts
      const upper = sqlText.toUpperCase();
      if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|MERGE)\b/.test(upper)) {
        return { status: 'error', message: 'Nur SELECT erlaubt' };
      }
      if (!upper.startsWith('SELECT')) {
        return { status: 'error', message: 'Query muss mit SELECT beginnen' };
      }
```

Your prototype MUST replicate this guard **after** placeholder binding and
**before** calling `executeReadOnlyMssqlQuery`.

### 5. The interpolation seam — how variables reach templates

`electron/workflow/context.ts:148` `interpolateTemplate(template, ctx)` replaces
`{{key}}` for every key in `ctx.strings` **and** every key in `ctx.variables`
(with the dot escaped), so a variable named `jtl.status` will substitute a
`{{jtl.status}}` token:

```ts
  for (const [k, v] of Object.entries(ctx.variables)) {
    out = out.replace(new RegExp(`\\{\\{${k.replace('.', '\\.')}\\}\\}`, 'g'), String(v ?? ''));
  }
```

### 6. AI-node consumption — the crux the spike must resolve

Not every AI node interpolates its prompt. Read `electron/workflow/nodes/ai-nodes.ts`:

- `ai.transform_text` (line 213-232): `interpolateTemplate(p.user_template, ctx)`
  → **DOES** pick up `{{jtl.*}}`.
- `ai.review` (line 62) / `ai.outbound_review` (line 113): interpolate a custom
  prompt template → DOES pick up `{{jtl.*}}` when a custom prompt is set.
- `ai.pick_canned` (line 487): interpolates the chosen canned body → DOES.
- `ai.agent` (line 332-377): builds the user message directly from
  `ctx.strings.combined_text` + retrieved knowledge chunks; `systemPrompt` and
  the user message are **NOT** interpolated → **`{{jtl.*}}` would NOT reach it
  today**.
- `ai.reply_suggestion` (line 379-455): delegates to
  `generateAndStoreReplySuggestion` in `electron/email/email-reply-ai.ts`, whose
  `interpolateReplyTemplate` (line 61-82) only handles
  `{{subject}}`, `{{from}}`, `{{body}}`, `{{text}}`, `{{customer.name|firstName|email}}`
  → **`{{jtl.*}}` is NOT supported there today.**

So the resolver producing `jtl.*` variables is necessary but **not sufficient**
for the two nodes operators most want (`ai.agent`, `ai.reply_suggestion`). This
gap is the spike's central open question — **document it; do not silently rewire
those nodes in this spike.**

### Conventions to match

- Node registration follows the `register({ type, label, category, canvasType,
  defaultConfig, execute })` shape — exemplar: the `jtl.lookup` block in
  `electron/workflow/nodes/integration-nodes.ts:110-135`. Match it exactly
  (German `label`, `category: 'integration'`, `canvasType: 'registry'`).
- Node unit tests use the `collect(...)` + `ctx(...)` helpers and `jest.mock`
  for side-effecting modules — exemplar:
  `tests/unit/workflow-builtin-nodes.test.ts` (see the `integration nodes …`
  test at line 218). Model your new test on this file's structure.
- Comments/labels are German in the workflow layer; keep that.

## Commands you will need

| Purpose   | Command                                                        | Expected on success |
|-----------|---------------------------------------------------------------|---------------------|
| Install   | `pnpm install --frozen-lockfile`                              | exit 0              |
| Typecheck | `npx tsc -p tsconfig.electron.json --noEmit`                  | exit 0, no errors   |
| Tests     | `pnpm test -- tests/unit/jtl-context-spike.test.ts`          | all pass            |
| Lint      | `pnpm run lint`                                               | exit 0 (eslint, `--max-warnings 0`) |
| Build     | `pnpm run build`                                              | exit 0              |

Notes:
- There is **no** `pnpm run typecheck` script yet; use the `npx tsc -p
  tsconfig.electron.json --noEmit` command above for the Electron main sources
  the prototype lives in.
- `pnpm test` runs Jest (`jest --passWithNoTests`). Targeted runs use
  `pnpm test -- <path>`.
- You do **not** need a live MSSQL/JTL server: the prototype's data path is
  exercised in the unit test by mocking `executeReadOnlyMssqlQuery`.

## Scope

**In scope** (the only files you should create/modify):
- `electron/workflow/nodes/integration-nodes.ts` — add a prototype
  `jtl.order_context` node (port of the server resolver, reusing
  `executeReadOnlyMssqlQuery`).
- `tests/unit/jtl-context-spike.test.ts` (create) — unit test proving the
  resolver's mapping / 0-row / many-row / invalid-sender / SELECT-only /
  dry-run behavior, plus a probe that `interpolateTemplate` picks up `jtl.*`.
- `docs/SPIKE_JTL_CONTEXT_INJECTION.md` (create) — the written recommendation
  (this is the primary deliverable).

(Index bookkeeping only, not a code change: update this plan's status row in
`plans/README.md` when done, unless a reviewer owns the index.)

**Out of scope** (do NOT touch, even though they look related):
- `packages/server/src/workflow-execution.ts` — the server resolver already
  exists and works; changing it risks the passing server-edition tests and is
  not this spike's job.
- `packages/core/src/workflow/node-catalog.ts` — the `jtl.order_context` catalog
  entry already exists and is correct; do not add/duplicate it.
- `electron/workflow/nodes/ai-nodes.ts` and `electron/email/email-reply-ai.ts` —
  the spike **recommends** how `jtl.*` should reach `ai.agent` /
  `ai.reply_suggestion`; wiring it is a follow-up build plan, not this spike.
  (Rewiring these here would turn a spike into an unreviewed feature.)
- `src/components/email/workflow/node-properties-panel.tsx` — UI for the node is
  out of scope for the spike.
- Any real customer JTL schema or hard-coded table/column names beyond the
  documented example query — the SQL is operator-configured by design.

## Git workflow

- Branch: `advisor/023-spike-jtl-context-injection`
- Commit per logical unit; conventional-commit style (matches `git log`, e.g.
  `feat(workflow): prototype jtl.order_context resolver on desktop`,
  `test(workflow): cover jtl context resolver spike`,
  `docs(spike): jtl context injection recommendation`).
- Do NOT push or open a PR.

## Steps

### Step 1: Create the spike report skeleton and record the landscape

Create `docs/SPIKE_JTL_CONTEXT_INJECTION.md` with these sections (fill the
"Findings" section now from "Current state" above, in your own words — the rest
you complete in later steps):

```
# Spike: Auto-inject a JTL context block into inbound mail for AI nodes

Status: DRAFT (spike) · Planned at f24fb27

## Question
Can we, when a customer mail arrives, resolve sender → recent JTL order/tracking/
return/payment via the existing read-only MSSQL seam and hand it to the AI nodes
as a ready-made {{jtl.*}} block?

## Findings (what already exists)
- Server edition implements the resolver (jtl.order_context) …
- Catalog already advertises the node …
- Electron desktop runtime does NOT implement it (dead catalog entry) …
- Read-only MSSQL helper reused: executeReadOnlyMssqlQuery (SELECT-only guard
  lives in the node, not the helper) …
- Interpolation: interpolateTemplate picks up ctx.variables keys, so {{jtl.*}}
  substitutes in any interpolated template …
- AI consumption: ai.transform_text / ai.review / ai.pick_canned interpolate;
  ai.agent and ai.reply_suggestion do NOT (the crux) …

## Prototype (this spike)
(filled in Step 2–3)

## Open questions & recommendation
(filled in Step 5)
```

**Verify**: `test -f docs/SPIKE_JTL_CONTEXT_INJECTION.md && echo OK` → prints `OK`.

### Step 2: Prototype the `jtl.order_context` resolver node on desktop

In `electron/workflow/nodes/integration-nodes.ts`, add a new `register({...})`
block (place it after the existing `jtl.lookup` block, before the closing `}` of
`registerIntegrationNodes`). Port the server logic, reusing the desktop
read-only helper. Target shape (fill in exactly; keep the inline helpers/regexes
local to this file so the prototype is self-contained):

```ts
  // --- SPIKE (plan 023): desktop port of jtl.order_context ---
  const JTL_CTX_EMAIL_RE = /^[^\s@'";\\]+@[^\s@'";\\]+\.[^\s@'";\\]+$/;
  const JTL_CTX_ORDER_NO_RE = /^[A-Za-z0-9._\-/]{1,64}$/;
  const sqlLiteral = (v: string) => `'${v.replace(/'/g, "''")}'`;

  const scalar = (value: unknown): string | number | boolean | null => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof Date) return value.toISOString();
    return String(value).slice(0, 2_000);
  };

  const parseMapping = (value: unknown): Record<string, string> => {
    const mapping: Record<string, string> = {};
    if (typeof value !== 'string' || !value.trim()) return mapping;
    for (const pair of value.split(',')) {
      const [col, target] = pair.split(':').map((p) => p.trim());
      if (col && target) mapping[col.toLowerCase()] = target;
    }
    return mapping;
  };

  register({
    type: 'jtl.order_context',
    label: 'JTL Bestell-Kontext',
    category: 'integration',
    canvasType: 'registry',
    defaultConfig: { query: 'SELECT TOP 1 cStatus FROM tBestellung WHERE cEmail = {{email}}', mapping: '' },
    execute: async (ctx, config) => {
      const template = String(config.query ?? '').trim();
      if (!template) return { status: 'skipped', message: 'Keine Query' };

      // Sender email from the message context (first address token).
      const email = (ctx.strings.from_address ?? '').split(',')[0]?.trim() ?? '';
      const orderNo = String(ctx.variables['jtl.order_no'] ?? config.orderNo ?? '').trim();

      // Bind + SQL-escape placeholders (skip -> no_match when required value invalid).
      let query = template;
      if (query.includes('{{email}}')) {
        if (!email || !JTL_CTX_EMAIL_RE.test(email)) {
          return { status: 'skipped', port: 'no_match', message: 'Ungültige Absender-E-Mail', variables: { 'jtl.context_found': false } };
        }
        query = query.replace(/\{\{email\}\}/g, sqlLiteral(email));
      }
      if (query.includes('{{orderNo}}')) {
        if (!orderNo || !JTL_CTX_ORDER_NO_RE.test(orderNo)) {
          return { status: 'skipped', port: 'no_match', message: 'Ungültige Bestellnummer', variables: { 'jtl.context_found': false } };
        }
        query = query.replace(/\{\{orderNo\}\}/g, sqlLiteral(orderNo));
      }

      // SELECT-only guard (executeReadOnlyMssqlQuery only length-caps; guard here).
      const upper = query.toUpperCase();
      if (/\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE|MERGE)\b/.test(upper)) {
        return { status: 'error', port: 'error', message: 'Nur SELECT erlaubt' };
      }
      if (!upper.startsWith('SELECT')) {
        return { status: 'error', port: 'error', message: 'Query muss mit SELECT beginnen' };
      }

      if (ctx.dryRun) return { status: 'ok', message: 'dry-run jtl.order_context', variables: { 'jtl.context_found': false } };

      const { executeReadOnlyMssqlQuery } = await import('../../mssql-keytar-service');
      const r = await executeReadOnlyMssqlQuery(query);
      if (!r.success) return { status: 'error', port: 'error', message: r.error ?? 'MSSQL-Fehler' };

      const rows = r.rows ?? [];
      const first = rows[0];
      if (!first || typeof first !== 'object') {
        return { status: 'ok', port: 'no_match', message: 'Keine JTL-Daten gefunden', variables: { 'jtl.context_found': false } };
      }

      const mapping = parseMapping(config.mapping);
      const variables: Record<string, string | number | boolean | null> = {
        'jtl.context_found': true,
        'jtl.match_count': rows.length,
      };
      for (const [column, value] of Object.entries(first as Record<string, unknown>)) {
        const key = column.toLowerCase();
        variables[mapping[key] ?? `jtl.${key}`] = scalar(value);
      }
      return { status: 'ok', port: 'default', variables };
    },
  });
```

Notes for the executor:
- Keep the `{ status, port, message, variables }` return shape — `port` is a
  valid field on `NodeExecuteResult` (`electron/workflow/types.ts:23-36`).
- `ctx.strings.from_address` is populated for inbound messages by
  `buildStringContextFromMessage` (`electron/workflow/context.ts:32-50`).
- `jtl.match_count` is a spike addition over the server version — it is what lets
  the report reason about match ambiguity (0/1/many); leave it in.

**Verify**: `npx tsc -p tsconfig.electron.json --noEmit` → exit 0, no errors.

### Step 3: Write the resolver unit test

Create `tests/unit/jtl-context-spike.test.ts`, modeled structurally on
`tests/unit/workflow-builtin-nodes.test.ts` (reuse its `collect` and `ctx`
helpers — copy them into this file). Mock BOTH the MSSQL helper AND
`sqlite-service`: `electron/workflow/nodes/integration-nodes.ts` imports
`getSyncInfo` from `../../sqlite-service` at module top level, so importing
`registerIntegrationNodes` in a Node unit test would otherwise load
`electron/sqlite-service` and its native `better-sqlite3`/electron deps before
the resolver runs. Mirror `workflow-builtin-nodes.test.ts`:

```ts
jest.mock('../../electron/mssql-keytar-service', () => ({
  executeReadOnlyMssqlQuery: jest.fn(),
}));
jest.mock('../../electron/sqlite-service', () => ({
  getSyncInfo: jest.fn(() => ''),   // integration-nodes.ts reads the HTTP allowlist from here
}));
```

Cover these cases against the `jtl.order_context` node obtained via
`collect(registerIntegrationNodes).get('jtl.order_context')!`:

1. **Happy path + mapping**: mock returns
   `{ success: true, rows: [{ cStatus: 'versendet', cTracking: '00340' }] }`;
   config `{ query: 'SELECT TOP 1 cStatus, cTracking FROM tBestellung WHERE cEmail = {{email}}', mapping: 'cstatus:jtl.status' }`;
   ctx has `strings: { from_address: 'kunde@example.com' }`, `dryRun: false`.
   Expect `status: 'ok'`, `port: 'default'`, and `variables` containing
   `'jtl.context_found': true`, `'jtl.status': 'versendet'` (mapped),
   `'jtl.ctracking': '00340'` (default-named), `'jtl.match_count': 1`.
2. **No match (0 rows)**: mock `{ success: true, rows: [] }` → `port: 'no_match'`,
   `'jtl.context_found': false`.
3. **Many rows → first row wins**: mock `rows: [{cStatus:'a'},{cStatus:'b'}]` →
   `'jtl.status'`/`'jtl.cstatus'` reflects `'a'`, `'jtl.match_count': 2`.
   (This is the ambiguity behavior the report must call out.)
4. **Invalid sender for `{{email}}`**: `from_address: 'not-an-email'` →
   `port: 'no_match'`, `executeReadOnlyMssqlQuery` **not** called.
5. **SELECT-only guard**: config `{ query: 'DELETE FROM tBestellung' }` →
   `status: 'error'`, message contains `Nur SELECT erlaubt`,
   `executeReadOnlyMssqlQuery` **not** called.
6. **Dry-run**: `ctx({ dryRun: true })` → `status: 'ok'`, helper **not** called.
7. **Interpolation probe** (proves the block reaches interpolated prompts):
   import `interpolateTemplate` from `../../electron/workflow/context` and assert
   `interpolateTemplate('Status: {{jtl.status}}', ctx({ variables: { 'jtl.status': 'versendet' } }))`
   equals `'Status: versendet'`. (Guards the seam claim in the report.)

**Verify**: `pnpm test -- tests/unit/jtl-context-spike.test.ts` → all tests pass
(7 cases).

### Step 4: Empirically confirm the AI-injection seam and record it

Do not change any AI node. Instead, confirm by reading + the Step 3 probe which
nodes interpolate, and write the result into the report's "Findings" /
"Prototype" sections:

- `interpolateTemplate` substitutes `{{jtl.*}}` (proven by test case 7).
- Therefore `ai.transform_text`, `ai.review`, `ai.outbound_review` (custom
  prompt), and `ai.pick_canned` **already** consume `jtl.*` if the operator puts
  `{{jtl.status}}` in the prompt/canned text after a `jtl.order_context` node.
- `ai.agent` (`electron/workflow/nodes/ai-nodes.ts:344-356`) and
  `ai.reply_suggestion` (via `email-reply-ai.ts:61-82`) do **not** interpolate
  arbitrary variables → they need an explicit follow-up change to accept the
  block. Record the two candidate approaches in the report (Step 5).

**Verify**: `grep -n "interpolateTemplate" docs/SPIKE_JTL_CONTEXT_INJECTION.md`
→ at least one match (you cited the seam). No code verification here; this step
is documentation.

### Step 5: Write the recommendation (open questions answered)

Complete `docs/SPIKE_JTL_CONTEXT_INJECTION.md` "Open questions & recommendation".
Each open question must have a **decision or a proposed answer**, not just a
restatement:

- **Match ambiguity (0/1/many orders per sender)**: prototype behavior is
  0 → `no_match` port; 1 → mapped; many → first row + `jtl.match_count` so a
  downstream `logic.threshold`/`logic.switch` can branch. Recommend whether the
  build should (a) keep "first row + count", (b) aggregate N recent orders into
  a list, or (c) require an `{{orderNo}}` disambiguator. State your pick and why.
- **Per-message latency**: the resolver runs a synchronous MSSQL round-trip on
  every matching inbound message. Note the existing helper's behavior
  (`executeReadOnlyMssqlQuery` races a timeout in `mssql-keytar-service.ts`) and
  recommend where the query should sit in the graph (e.g. after cheap gates, not
  before spam scoring) and any budget concern.
- **Caching**: none today. Recommend whether to cache per-sender for a short TTL
  and where that would live (out of spike scope to build).
- **The crux — reaching `ai.agent` / `ai.reply_suggestion`**: recommend ONE of:
  (A) append a rendered `jtl.*` block to the `ai.agent` user message / make its
  `systemPrompt` run through `interpolateTemplate`; or (B) extend the
  reply-suggestion template vocabulary in `interpolateReplyTemplate`
  (`email-reply-ai.ts:61`) to include `{{jtl.*}}`. Sketch the follow-up build
  plan's scope (files, ~effort) — do not implement it here.
- **Go / No-go**: a one-paragraph verdict on whether to promote this prototype to
  a build plan, given that the server edition already ships the resolver.

Flip the report's `Status:` line from `DRAFT (spike)` to
`COMPLETE (spike) — see recommendation`.

**Verify**: `grep -c "Go / No-go\|Recommendation\|recommend" docs/SPIKE_JTL_CONTEXT_INJECTION.md`
→ ≥ 1. (Human-readable content check; the reviewer reads the doc.)

### Step 6: Full-suite sanity + lint

**Verify**:
- `pnpm run lint` → exit 0.
- `pnpm test -- tests/unit/jtl-context-spike.test.ts` → all pass.
- `git status --porcelain` → only the in-scope files
  (`electron/workflow/nodes/integration-nodes.ts`,
  `tests/unit/jtl-context-spike.test.ts`,
  `docs/SPIKE_JTL_CONTEXT_INJECTION.md`, and optionally `plans/README.md`)
  are modified/created.

## Test plan

- New file `tests/unit/jtl-context-spike.test.ts` with the 7 cases in Step 3
  (happy+mapping, 0-row, many-row, invalid sender, SELECT-only, dry-run,
  interpolation probe). Model structure after
  `tests/unit/workflow-builtin-nodes.test.ts` (the `collect`/`ctx` helpers and
  the `jest.mock` pattern for `executeReadOnlyMssqlQuery`).
- No live MSSQL: the DB round-trip is mocked. This is a spike — coverage proves
  the resolver's *decision logic* (binding, guards, mapping, ambiguity), not a
  production JTL integration.
- Verification: `pnpm test -- tests/unit/jtl-context-spike.test.ts` → all pass
  (7 new tests).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc -p tsconfig.electron.json --noEmit` exits 0.
- [ ] `pnpm run lint` exits 0.
- [ ] `pnpm test -- tests/unit/jtl-context-spike.test.ts` exits 0; the 7 new
      cases exist and pass.
- [ ] `grep -rn "jtl.order_context" electron/workflow/nodes/integration-nodes.ts`
      returns the new registration (desktop node now exists).
- [ ] `docs/SPIKE_JTL_CONTEXT_INJECTION.md` exists, its `Status:` reads
      `COMPLETE (spike)`, and it answers all five open questions in Step 5
      (match ambiguity, latency, caching, the ai.agent/reply-suggestion seam,
      go/no-go).
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row updated (unless a reviewer owns the index).

Explicitly **NOT** required (this is a spike, not the build):
- A `pnpm run build` of the whole app (run it once if convenient, but a green
  build of unrelated packages is not a gate here).
- Any change to `ai.agent` / `ai.reply_suggestion` behavior.
- Any UI in `node-properties-panel.tsx`.

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows any cited file changed and the "Current state" excerpts
  no longer match — especially if `electron/workflow/nodes/integration-nodes.ts`
  already contains a `jtl.order_context` registration (someone shipped it first),
  or if `packages/core/src/workflow/node-catalog.ts` no longer declares
  `jtl.order_context`.
- `executeReadOnlyMssqlQuery`'s signature in `electron/mssql-keytar-service.ts`
  differs from `(sqlQuery: string) => Promise<{ success; rows?; rowCount?; error? }>`.
- A verification command fails twice after a reasonable fix attempt.
- Implementing the prototype appears to require touching an out-of-scope file
  (e.g. you find you must edit `ai-nodes.ts` to make any test pass) — that is a
  signal the seam decision belongs in the report, not in code.
- You discover the assumption "the resolver only needs read-only SELECT access"
  is false (e.g. the example query needs a stored proc / EXEC) — document it and
  stop; do not relax the SELECT-only guard.

## Maintenance notes

For the human/agent who owns this after the spike:

- This prototype makes the desktop `jtl.order_context` node **live** to match the
  catalog and the server edition. If a build plan follows, the natural next move
  is the interpolation seam: decide how `jtl.*` reaches `ai.agent`
  (`electron/workflow/nodes/ai-nodes.ts:344-356`) and `ai.reply_suggestion`
  (`electron/email/email-reply-ai.ts:61-82`). The report's recommendation should
  drive that plan.
- Keep the desktop resolver behavior aligned with the server resolver
  (`packages/server/src/workflow-execution.ts:2890`) — if one changes its
  placeholder/mapping contract, the other and the shared catalog entry must
  follow, or desktop/server workflows diverge.
- A reviewer should scrutinize: (1) that `sqlLiteral` escaping wraps every
  operator-supplied value put into SQL, (2) that the SELECT-only guard runs
  before `executeReadOnlyMssqlQuery`, and (3) that no real customer table/column
  names leaked into committed code (the example query is generic).
- Deferred out of this spike (by design): caching, multi-order aggregation, the
  actual AI-node rewiring, and any UI. The report names these as follow-ups.
