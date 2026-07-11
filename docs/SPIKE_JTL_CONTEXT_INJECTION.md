# Spike: Auto-inject a JTL context block into inbound mail for AI nodes

> **SUPERSEDED (2026-07-11).** PR #146 rebuilt the workflow node system and now
> ships `jtl.order_context` in the core node-schema/catalog as a `runtime: 'server'`
> (server-only) node. The desktop-executor prototype this spike built was removed
> on the merge (it contradicted #146's server-only classification and its
> `workflow-node-catalog-sync` test). This doc is kept as background for the
> design questions; the implementation now lives with #146.

Status: COMPLETE (spike) — see recommendation · Planned at f24fb27

## Question

Can we, when a customer mail arrives, resolve sender → recent JTL order/tracking/
return/payment via the existing read-only MSSQL seam and hand it to the AI nodes
as a ready-made `{{jtl.*}}` block — without an agent hand-copying it?

This is the named differentiator ("KI + JTL-Kontext") and is tracked as a **P0**
gap (request #2) in `docs/FEATURE_REQUESTS_JTL_KI_SUPPORT.md`.

## Findings (what already exists)

- **Server edition already implements the resolver.** `jtl.order_context` lives
  in `packages/server/src/workflow-execution.ts` (dispatch ~1652, resolver
  `executeWorkflowJtlOrderContext` ~2890). It binds `{{email}}`/`{{orderNo}}` as
  SQL-escaped literals, validates SELECT-only, runs the query, and maps the first
  row's columns onto `jtl.*` variables (with an optional `col:jtl.target` mapping
  string). It has a passing test in `tests/unit/server-edition-foundation.test.ts`.

- **The shared catalog already advertises the node.**
  `packages/core/src/workflow/node-catalog.ts:377-385` declares `jtl.order_context`
  (label "JTL Bestell-Kontext", category `integration`, canvasType `registry`).
  Both editions read this catalog.

- **The Electron desktop runtime did NOT implement it — a dead catalog entry.**
  `electron/workflow/nodes/integration-nodes.ts` registered only `sync.run`,
  `http.request`, `mssql.query`, and `jtl.lookup`. There was no
  `jtl.order_context` anywhere under `electron/`, so on desktop the catalog
  advertised a node that never ran. **This spike ports the resolver to desktop**
  so the node is now live and behavior-aligned with the server edition.

- **Read-only MSSQL helper reused:** `executeReadOnlyMssqlQuery(sqlQuery: string)`
  in `electron/mssql-keytar-service.ts:569`. Important seam gap: this helper only
  enforces a length cap and a 30s timeout race — it does **not** enforce
  "SELECT-only". The SELECT-only guard lives in the `mssql.query` **node**
  (`integration-nodes.ts:87-95`), so the prototype **replicates that guard
  itself**, after placeholder binding and before calling the helper.

- **Interpolation seam:** `interpolateTemplate` (`electron/workflow/context.ts:148`)
  substitutes `{{key}}` for every key in `ctx.strings` **and** every key in
  `ctx.variables` (dot escaped), so a variable named `jtl.status` substitutes a
  `{{jtl.status}}` token. Proven empirically by the spike test's interpolation
  probe (`tests/unit/jtl-context-spike.test.ts`).

- **AI-node consumption — the crux.** Not every AI node interpolates its prompt:
  - `ai.transform_text`, `ai.review` / `ai.outbound_review` (custom prompt), and
    `ai.pick_canned` **do** run their template through `interpolateTemplate`, so
    they **already** pick up `{{jtl.*}}` if the operator writes `{{jtl.status}}`
    in the prompt/canned text downstream of a `jtl.order_context` node.
  - `ai.agent` (`electron/workflow/nodes/ai-nodes.ts:343-356`) builds its
    `systemPrompt` and user message **directly** from
    `config.systemPrompt` + `ctx.strings.combined_text` + retrieved knowledge
    chunks — **no interpolation** — so `{{jtl.*}}` would **not** reach it today.
  - `ai.reply_suggestion` (`ai-nodes.ts:379-455`) delegates to
    `generateAndStoreReplySuggestion` in `electron/email/email-reply-ai.ts`,
    whose `interpolateReplyTemplate` (lines 61-82) only handles a fixed vocabulary
    (`{{subject}}`, `{{from}}`, `{{body}}`, `{{text}}`,
    `{{customer.name|firstName|email}}`) — **no `{{jtl.*}}` support**.

So producing `jtl.*` variables is **necessary but not sufficient** for the two
nodes operators most want (`ai.agent`, `ai.reply_suggestion`). Wiring those is a
**follow-up build plan, not this spike** — deliberately not rewired here.

## Prototype (this spike)

A working desktop `jtl.order_context` node was added to
`electron/workflow/nodes/integration-nodes.ts` (after the `jtl.lookup` block).
It is a faithful port of the server resolver, reusing the desktop read-only
helper. Its contract:

1. Read the operator-configured `query` template. Empty → `skipped`.
2. Take the sender from `ctx.strings.from_address` (first address token) and an
   optional order number from `ctx.variables['jtl.order_no']` / `config.orderNo`.
3. **Bind + SQL-escape placeholders.** If the template contains `{{email}}`, the
   sender must match `JTL_CTX_EMAIL_RE`, else → `no_match` (query not run).
   Same for `{{orderNo}}` against `JTL_CTX_ORDER_NO_RE`. Every bound value is
   wrapped by `sqlLiteral` (`'…''…'` single-quote escaping) — **load-bearing**:
   raw email/order values never enter SQL unescaped. The test asserts the
   escaped literal reaches `executeReadOnlyMssqlQuery`.
4. **SELECT-only guard** (mutating-keyword blocklist + `startsWith('SELECT')`),
   run **after** binding and **before** the DB call, because the helper does not
   enforce it.
5. Dry-run short-circuit (`ctx.dryRun`) → `ok` with `jtl.context_found: false`,
   no DB call.
6. Run the query; map the **first row's** columns onto `jtl.*` variables using
   the `mapping` string (falling back to `jtl.<lowercased_column>`); coerce cells
   with `scalar` (numbers/booleans pass through, `Date` → ISO, else
   `String(v).slice(0, 2000)`).

**Spike addition over the server version:** the result also sets
`jtl.match_count` (row count), so a downstream `logic.threshold` / `logic.switch`
can branch on 0 / 1 / many. Ports emitted: `default` (match), `no_match`
(0 rows or invalid/absent required placeholder), `error` (guard failure / DB error).

**Where it would inject — and confirmation it is NOT wired into the live path:**
the node is a normal registry node the operator drops on the canvas *before* the
AI node. The `jtl.*` variables it returns land in `ctx.variables`, and any
downstream node that runs `interpolateTemplate` on its prompt/body renders the
`{{jtl.*}}` block. The context block is therefore built entirely by the node's
pure `execute` function; **nothing in this spike splices a JTL lookup into the
real inbound-mail sync path or into `email-workflow-engine`** — the injection is
opt-in via graph wiring, exactly as the plan directs. The resolver's decision
logic is exercised in isolation by `tests/unit/jtl-context-spike.test.ts` with
`executeReadOnlyMssqlQuery` mocked (no live MSSQL).

Test coverage (`tests/unit/jtl-context-spike.test.ts`, 8 cases): registration
present; happy-path binding + column mapping (asserts escaped SQL literal);
0-row → `no_match`; many-row → first row + `jtl.match_count`; invalid sender →
`no_match`, query not run; SELECT-only guard blocks `DELETE`, query not run;
dry-run skips DB; and an `interpolateTemplate('Status: {{jtl.status}}', …)`
probe proving the `{{jtl.*}}` seam.

## Open questions & recommendation

### 1. Match ambiguity (0 / 1 / many orders per sender)

Prototype behavior: **0 → `no_match` port** (`jtl.context_found: false`);
**1 → mapped** onto `jtl.*`; **many → first row wins + `jtl.match_count`** so a
downstream `logic.threshold`/`logic.switch` can branch.

**Recommendation: keep "first row + count" for v1 (option a), and in the build
plan add (c) an optional `{{orderNo}}` disambiguator** (already supported by the
binding path). Full N-order aggregation (b) is more useful long-term but needs a
mapping vocabulary for lists/arrays that the current scalar `jtl.*` model does
not express — defer it. Practical guidance for operators: order the example
query by recency (e.g. `ORDER BY dErstellt DESC`) so "first row" means "most
recent order", and use `jtl.match_count` to route ambiguous senders to a human.

### 2. Per-message latency

The resolver runs a **synchronous MSSQL round-trip on every matching inbound
message**. `executeReadOnlyMssqlQuery` races the query against a **30s timeout**
(`MSSQL_QUERY_TIMEOUT_MS`) and caps SQL at 8000 chars; a slow/unreachable JTL DB
therefore stalls that graph branch for up to 30s and returns an `error` port.

**Recommendation:** place `jtl.order_context` **after cheap gates** in the graph
— i.e. after spam scoring / obvious-automated-sender filtering / category routing
— so the DB is only touched for mails that actually warrant a JTL lookup, never
before spam scoring. Consider tightening the timeout for this node's use
(a shorter budget, e.g. 5-8s) in the build plan, and always design the graph so
the `error`/`no_match` ports degrade gracefully (AI node still runs without the
block) rather than dropping the mail.

### 3. Caching

None today — every run hits the DB. **Recommendation:** add a short-TTL
per-sender (and per-orderNo) cache in the build plan — e.g. an in-memory
`Map<emailKey, {value, expires}>` with a 1-5 min TTL keyed on the bound query, to
collapse bursts (auto-replies, threads) without serving stale order status. This
lives in the desktop runtime (near `executeReadOnlyMssqlQuery` or as a thin
wrapper), is **out of scope to build in this spike**, and must be invalidated
conservatively given order/tracking status changes quickly.

### 4. The crux — reaching `ai.agent` / `ai.reply_suggestion`

These two do not interpolate arbitrary variables, so `{{jtl.*}}` cannot reach
them today. Two candidate approaches:

- **(A) `ai.agent`:** append a rendered `jtl.*` block to the agent's user message
  (and/or run `config.systemPrompt` through `interpolateTemplate`) in
  `electron/workflow/nodes/ai-nodes.ts:343-356`. Cheap and localized: build the
  block from `ctx.variables` keys prefixed `jtl.` and inject it as a labelled
  section (e.g. "JTL-Kontext:\n…") alongside the existing "Nachricht" /
  "Wissensbasis" sections.
- **(B) `ai.reply_suggestion`:** extend `interpolateReplyTemplate`
  (`electron/email/email-reply-ai.ts:61`) to accept `{{jtl.*}}` tokens. This is
  harder because the reply-AI path is reached via
  `generateAndStoreReplySuggestion(messageId, …)` and does **not** currently
  receive the workflow `ctx.variables` — the follow-up must thread the resolved
  `jtl.*` block (or the raw variables) through that call boundary.

**Recommendation: do BOTH in the follow-up, but ship (A) first** — `ai.agent`
already builds its user message inline, so injecting a JTL section is a small,
self-contained change with immediate value, whereas (B) requires plumbing the
context across the `email-reply-ai` boundary. Sketch of the follow-up build
plan's scope (do **not** implement here):
- `electron/workflow/nodes/ai-nodes.ts` — render a `jtl.*` block into the
  `ai.agent` user message; optionally interpolate `systemPrompt`. (~S)
- `electron/email/email-reply-ai.ts` (+ its callers) — thread `jtl.*` into
  `interpolateReplyTemplate` and widen the prompt vocabulary. (~M, mostly
  plumbing the variables through `generateAndStoreReplySuggestion`).
- Tests mirroring this spike (mock the AI call; assert the JTL block appears in
  the prompt). UI (`node-properties-panel.tsx`) for editing the query/mapping is
  a separate, smaller task.

### 5. Go / No-go

**Go.** The server edition already ships this resolver, the shared catalog
already advertises it, and this spike proves the desktop port is a faithful,
low-risk reuse of the existing read-only MSSQL seam with the load-bearing
SQL-escaping and SELECT-only guard intact and tested. The only real open work is
the AI-node seam (§4), which is well-scoped and localized. Promote to a build
plan: land the desktop resolver (this prototype), then wire `jtl.*` into
`ai.agent` (approach A) and `ai.reply_suggestion` (approach B), keeping the
desktop and server resolvers' placeholder/mapping contract in lockstep so the two
editions and the shared catalog entry never diverge.

## Follow-ups deferred out of this spike (by design)

Caching (§3), multi-order aggregation (§1 option b), the actual AI-node rewiring
(§4), a shorter per-node query timeout (§2), and any UI in
`src/components/email/workflow/node-properties-panel.tsx`.
