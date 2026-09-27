# Plan 048: Retrieve knowledge by `##` section (not whole documents) and show the sources on AI drafts

> **Executor instructions**: This is a design + build plan in three phases (A,
> B, C). Each phase ends in a working, tested state and may be merged on its
> own; do them in order. Follow the steps, run every verification command and
> confirm the expected result before moving on. If anything in "STOP
> conditions" occurs, stop and report — do not improvise. Answer or escalate
> the "Open questions" before Phase A if the operator is reachable; otherwise
> use the stated defaults. When done (or when a phase is done), update this
> plan's row in `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md` (note the finished phases in the row).
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/core/src/learnings/knowledge-sections.ts packages/server/src/knowledge-workflow-search.ts packages/server/src/db/postgres-workflow-runtime-read-ports.ts packages/server/src/ai-classification.ts packages/server/src/workflow-ai-draft-nodes.ts packages/server/src/workflow-execution.ts packages/server/src/migrations/index.ts packages/server/src/db/schema.ts packages/server/src/security/rls-isolation-check.ts electron/workflow/knowledge-base.ts electron/workflow/nodes/ai-nodes.ts electron/database-schema.ts electron/sqlite-service.ts src/components/email/message-viewer.tsx`
> Plans 028 and 029 are expected to have changed `knowledge-sections.ts`,
> `workflow-ai-draft-nodes.ts`, `ai-classification.ts` and `ai-nodes.ts`; check
> that their results are present (see "Depends on"). Any other change: compare
> with "Current state"; on a mismatch, STOP.

## Status

- **Priority**: P2
- **Effort**: M–L (A: M, B: M, C: S)
- **Risk**: MED (new derived tables in both editions, retrieval behaviour changes)
- **Depends on**: `plans/028-knowledge-sections-close-code-fences.md` (parser must
  survive unclosed fences — `grep -n findSectionStarts packages/core/src/learnings/knowledge-sections.ts`
  must match) and `plans/029-learnings-reserved-knowledge-budget.md`
  (`grep -rn joinKnowledgeWithinBudget packages/core/src/workflow` must match). Both DONE first.
- **Category**: direction
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

Every knowledge base (KB) is stored and searched as **one chunk that holds the
whole Markdown document**. A search "hit" therefore returns the entire company
handbook, and plan 029 can only share a 12 000-character budget fairly between
whole documents — the model still gets mostly irrelevant text, large KBs are
still truncated, and the Learnings feature (which already edits the KB per `##`
section) gains little. Retrieval is naive: the server ignores its existing
full-text index and counts substring hits of whitespace-split words (German
stopwords like `und`, `die`, `der` match everything); the desktop embeds only
the first 8 000 characters. Reviewers of an AI draft also cannot see which
knowledge the draft used. After this plan, KBs are searched per `##` section
with real full-text ranking, Learnings keep a guaranteed share, and a draft
awaiting approval shows the section titles it drew on.

## Current state (verified at `9e0491e3`)

**Audit corrections** (the finding was partly inaccurate):
- `ai.draft.sources` / `ai.agent.sources` **already exist** as workflow
  variables in both editions — server `workflow-ai-draft-nodes.ts:275, 1204`
  (`knowledgeSourcesLabel`, `:583-589`), server `ai-classification.ts:947`,
  desktop `electron/workflow/nodes/ai-nodes.ts:625, 921` (`:141-145`). They list
  chunk titles, i.e. `Dokument` (server) or the KB name (desktop). What is
  missing is persisting them on the draft and showing them in the UI (`src/`).
- `docs/KI_SUPPORT_IMPLEMENTATION_PLAN.md:101-107` (P1-8) marks the basis as
  done ("🟩 Basis steht") and only "Quellen direkt am Entwurf sichtbar" as later.
- `docs/PRODUCT_REQUIREMENTS.md:65` (AI-5 "Keyword + Cosine") is true for the
  desktop only; the server never writes `embedding_json` and has no cosine path.

**Storage.**
- Server: `saveWorkflowKnowledgeDocument` (`packages/server/src/db/postgres-workflow-runtime-read-ports.ts:824-890`)
  writes the whole document into the first chunk (title `Dokument`,
  `WORKFLOW_KNOWLEDGE_DOCUMENT_CHUNK_TITLE`, `:767-768`) and deletes the rest.
  `loadWorkflowKnowledgeDocument` (`:789-816`) rebuilds the document with
  `mergeWorkflowKnowledgeChunks` (`:772-786`: non-`Dokument` chunks become
  `## title\n\ncontent`, joined by `\n\n---\n\n`). The **renderer does the same
  merge client-side** (`src/services/transport/channel-http-registry.ts:3635-3646, 6651-6664`),
  there is a per-chunk CRUD API (`createPostgresWorkflowKnowledgeChunkReadPort`,
  `:936-1095`), and the desktop→server SQLite import copies
  `workflow_knowledge_chunks` (`packages/server/src/sqlite-migration/manifest.ts:109`).
- Server index: `workflow_knowledge_chunks.search_vector` =
  `to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(content,''))` with GIN
  `workflow_knowledge_chunks_search_idx` (`packages/server/src/migrations/0008_workflow_security_schema.ts:208-217`).
  **Config is `simple`** (no stemming, no stopwords). Nothing queries it.
- Desktop: the `.md` file under `userData/workflow-knowledge/<id>.md` is the
  source of truth; `syncChunksFromDocument` (`electron/workflow/knowledge-base.ts:153-183`)
  replaces all chunks by one chunk (title = KB name) and embeds `capped.slice(0, 8000)`.
  `getKnowledgeBaseDocument` (`:90-130`) falls back to merging chunks when the file is missing.

**Consequence for the design:** splitting `workflow_knowledge_chunks` itself
would corrupt the document in the renderer merge, the chunk API and the SQLite
import. **Sections go into a new, derived table in each edition; the document
(server `Dokument` chunk, desktop `.md` file) stays the only source of truth,
and the document editor keeps editing whole documents.**

**Retrieval code** (all to be replaced by one section search per edition):
- Server `keywordSearchChunks` (`knowledge-workflow-search.ts:45-84`), used by
  `searchKnowledgeForWorkflow` (`:130-152`) and `buildKnowledgePromptAppend` (`:154-163`);
  duplicate keyword searchers in `ai-classification.ts:1452+` (`selectAgentKnowledgeChunks`)
  and `workflow-execution.ts:5209+` (`searchWorkflowKnowledgeChunks`, `ai.tool` `search_knowledge` at `:4616`).
- Desktop `searchKnowledgeChunks` (`knowledge-base.ts:390-416`, cosine > 0.2 else
  `keywordSearch` `:298-326`), `searchKnowledgeForWorkflow` (`:366-387`); `ai.tool` at `ai-nodes.ts:739-745`.

**Section parser** (shared): `parseKnowledgeSections` in
`packages/core/src/learnings/knowledge-sections.ts` returns
`{ preamble, sections: [{ title, content, raw }] }`, fence-aware (plan 028).

**Approval banner**: `src/components/email/message-viewer.tsx:1271-1302`
(`<p className="font-semibold">Wartet auf Freigabe</p>`, shows `selectedMessage.approval_reason`).
DTO: server `approvalReason` mapping at `packages/server/src/db/postgres-mail-read-ports.ts:5784-5786`
(redacted when `content_readable === false`), renderer mapping
`channel-http-registry.ts:5815`, type `src/components/email/types.ts:130`.
Desktop columns are added in `electron/sqlite-service.ts:906-922` (`emailMsgCols`).

**Conventions**: server migrations are SQL-only `SqlMigration`s
(`packages/server/src/migrations/types.ts`), registered in `migrations/index.ts`;
extend the id list in `tests/unit/server-edition-foundation.test.ts` (latest id
at plan time `'0060_workflow_run_step_detail_retention_index'`, line 399 — other
Runde-2 plans may have added ids; take the next free number). New workspace
tables need RLS exactly like `0057_ai_learnings.ts` (ENABLE + FORCE + policy
`app.can_access_workspace(workspace_id)`), an entry in
`packages/server/src/security/rls-isolation-check.ts` (`rlsPolicyTable('…')`,
list at ~`:124`) and a Kysely type in `packages/server/src/db/schema.ts`. Desktop
tables: `CREATE TABLE IF NOT EXISTS` constant in `electron/database-schema.ts`
+ `ensureMigrationTable(...)` in `electron/sqlite-service.ts` (see `:1153`, `:1174`).
Desktop SQLite has FTS5 (used for `email_messages`, `sqlite-service.ts:415-640`).

## Open questions for the maintainer (defaults in bold)

1. Section size: split sections longer than **4 000 chars** at paragraph breaks into `Titel (Teil n)`?
2. Small-KB fallback: send the whole document when it is **≤ 6 000 chars**?
3. Stopwords/stemming: server `german` FTS config (**yes**, if `pg_ts_config` has it); desktop: FTS5 `unicode61 remove_diacritics 2` + a **shared German stopword list in core** (no stemming).
4. Desktop embeddings per section: **only when an embedding model is configured, max 50 sections per save, asynchronous**; otherwise FTS only?
5. No section matches: send **nothing** from that KB (vs. its first section)?
6. Sources label format: **`KB-Name › Abschnitt`**, joined by `; `, max 500 chars.

## Commands you will need

Prefix with `export PATH=/opt/node24/bin:$PATH;`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build workspace packages (before Postgres tests) | `pnpm run build:packages` | exit 0 |
| Typecheck (all) | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest <test file path>` | all pass |
| Unit / integration | `pnpm run test:unit` / `pnpm run test:integration` | all pass |
| Mail suite (desktop KB tests live here) | `pnpm run test:mail` then `pnpm run test:mail:coverage` | pass, ratchet ok |
| Server coverage ratchet | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |
| UI coverage ratchet (Phase C) | `pnpm run test:ui:coverage:check` | pass |

Postgres tests (`tests/integration/postgres-*.test.ts`) refuse to run as root:
`chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist`, then
`su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit <file>"`.
Postgres test files must keep `jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'))`.

## Scope

**In scope**: `packages/core/src/learnings/knowledge-chunking.ts` (create) +
`learnings/index.ts`; a new server migration + `migrations/index.ts`;
`packages/server/src/db/schema.ts`, `security/rls-isolation-check.ts`,
`db/postgres-workflow-runtime-read-ports.ts`, `knowledge-workflow-search.ts`,
`ai-classification.ts`, `workflow-ai-draft-nodes.ts`, `workflow-execution.ts`
(`search_knowledge` only), `db/postgres-mail-read-ports.ts` (DTO field, Phase C);
`electron/database-schema.ts`, `electron/sqlite-service.ts`,
`electron/workflow/knowledge-base.ts`, `electron/workflow/nodes/ai-nodes.ts`,
desktop draft creation/DTO (`electron/email/email-store.ts`);
`src/components/email/message-viewer.tsx`, `src/components/email/types.ts`,
`src/services/transport/channel-http-registry.ts` (one mapping line);
tests; `docs/PRODUCT_REQUIREMENTS.md:65`, `docs/KI_SUPPORT_IMPLEMENTATION_PLAN.md` (P1-8); `CHANGELOG.md`.

**Out of scope**: the document editor and document save API contract; the
chunk CRUD API contract; `workflow_knowledge_chunks` schema (no column/semantics
change); the SQLite import manifest (sections are derived, never imported);
Learnings digest logic; server embeddings/pgvector.

## Git workflow

- Branch `advisor/048-knowledge-section-retrieval`; one commit per phase at least.
- German commit messages with area prefix, e.g. `Wissensbasis: Abschnitte als Suchindex ableiten (beide Editionen)`.
- Do NOT push or open a PR unless the operator says so.

## Phase A — derive section chunks on save, backfill existing KBs

### Step A1: Shared chunker in core (test first)

Create `tests/unit/knowledge-chunking.test.ts`, then
`packages/core/src/learnings/knowledge-chunking.ts` exporting
`deriveKnowledgeSections(document: string, kbName: string, opts?: { maxSectionChars?: number }): { position: number; title: string; content: string }[]`:
preamble (if non-blank, without a lone `# Titel` line) → position 0 titled `kbName`;
each `##` section in order; sections over `maxSectionChars` (default 4 000) split at
blank lines into `Titel (Teil n)`; blank sections dropped. Tests: plain doc, preamble
only, fenced `## ` not split, unclosed fence (028 case), oversized split, empty input → `[]`.

**Verify**: `pnpm exec jest tests/unit/knowledge-chunking.test.ts` → all pass.

### Step A2: Server table + migration

New migration `NNNN_workflow_knowledge_sections` (next free id):

```sql
CREATE TABLE IF NOT EXISTS workflow_knowledge_sections (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  knowledge_base_id bigint NOT NULL REFERENCES workflow_knowledge_bases(id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  search_vector tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('german', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('german', coalesce(content, '')), 'B')) STORED,
  built_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, knowledge_base_id, position)
);
CREATE INDEX … USING gin (search_vector);
```
plus RLS (copy `0057_ai_learnings.ts` statements), down SQL `DROP TABLE IF EXISTS`.
Register it, add the id to `tests/unit/server-edition-foundation.test.ts`, add
`rlsPolicyTable('workflow_knowledge_sections')`, add the Kysely type.
If `SELECT 1 FROM pg_ts_config WHERE cfgname = 'german'` is empty in the test
Postgres, STOP (see STOP conditions).

**Verify**: `pnpm exec jest tests/unit/server-edition-foundation.test.ts` → pass.

### Step A3: Server rebuild + backfill

Add `rebuildWorkflowKnowledgeSections(trx, workspaceId, knowledgeBaseId, now)` in
`postgres-workflow-runtime-read-ports.ts`: `loadWorkflowKnowledgeDocument` →
`deriveKnowledgeSections` → delete + insert in the same transaction. Call it at
the end of `saveWorkflowKnowledgeDocument` and after chunk create/update/delete in
the chunk port. Backfill lazily: the search (Phase B) calls
`ensureWorkflowKnowledgeSections` for each KB id, which rebuilds when the KB has
no section rows or `max(chunks.updated_at) > min(sections.built_at)` (covers
existing data, SQLite imports and legacy edits without a data migration).
Tests in a new `tests/integration/postgres-knowledge-sections.test.ts` (pattern:
`tests/integration/postgres-ai-learnings.test.ts`): save → sections; legacy KB
without sections → ensure builds them; chunk API edit → rebuilt; RLS: workspace B sees none.

**Verify**: that Postgres test → all pass (as non-root).

### Step A4: Desktop table + rebuild + backfill

`electron/database-schema.ts`: `workflow_knowledge_sections (id, knowledge_base_id
FK CASCADE, position, title, content, embedding_json, built_at)` plus an FTS5
external-content table `workflow_knowledge_sections_fts(title, content,
tokenize='unicode61 remove_diacritics 2')` kept in sync by triggers (copy the
email FTS trigger pattern, `sqlite-service.ts:415-450`). Register via
`ensureMigrationTable`. In `syncChunksFromDocument` (`knowledge-base.ts:153`)
rebuild sections from the same content in the same transaction; keep the single
chunk as today. Backfill: `ensureKnowledgeSections(kbId)` rebuilds from
`getKnowledgeBaseDocument` when no rows exist. Test in
`tests/mail/email-ai-learnings.test.ts` style (real SQLite): save → sections + FTS rows.

**Phase A done**: all tests above + `pnpm run typecheck`, `pnpm run lint`,
`pnpm run test:unit`, `pnpm run test:mail` pass; retrieval unchanged.

## Phase B — section retrieval with a guaranteed Learnings share

### Step B1: Query terms in core

`buildKnowledgeQueryTerms(text, max = 24)` in `knowledge-chunking.ts`: lowercase,
split on non-letters/digits (`/[^\p{L}\p{N}]+/u`), length ≥ 3, drop a German
stopword list (export it as `GERMAN_KNOWLEDGE_STOPWORDS`), dedupe, keep the first
`max`. Output contains only `[\p{L}\p{N}]` — safe to join into a tsquery / FTS5 query.

### Step B2: Server search

Replace the body of `searchKnowledgeForWorkflow` with one SQL query over
`workflow_knowledge_sections` for the resolved KB ids:
`to_tsquery('german', $terms joined by ' | ')` as a **bound parameter**,
`ts_rank_cd` ordering, per-KB limit via `row_number() OVER (PARTITION BY knowledge_base_id)`.
Small-KB fallback (Q2): KBs whose total section length ≤ threshold return all
their sections. Return `{ id, knowledgeBaseId, knowledgeBaseName, title, content }`.
Keep the function signature so callers compile. Point `buildKnowledgePromptAppend`,
`selectAgentKnowledgeChunks` and `searchWorkflowKnowledgeChunks` at the same
section search (single KB id for the latter two). Keep 029's
`joinKnowledgeWithinBudget` grouping by `knowledgeBaseId`; with sections the
Learnings group keeps ≥ its fair share.

Tests (extend `postgres-knowledge-sections.test.ts`): general KB with 30 sections
+ Learnings KB; query "Rücksendung Etikett" returns the matching sections only;
stopword-only query returns nothing (or fallback for small KBs); Learnings hit
present in the draft prompt of `executeWorkflowAiDraftReply` when general+inbound
are > 12 000 chars.

### Step B3: Desktop search

`searchKnowledgeChunks`/`searchKnowledgeForWorkflow` query
`workflow_knowledge_sections_fts` with `MATCH` of the OR-joined quoted terms,
`ORDER BY bm25(...)`, same fallback; if embeddings exist for sections (Q4), rank
by cosine first as today. Return rows shaped like `KnowledgeChunkRow`
(`knowledge_base_id`, `title`, `content`) so `ai-nodes.ts` stays compatible.

**Phase B done**: new tests pass; `tests/unit/workflow-ai-nodes.test.ts`,
`tests/unit/workflow-two-stage-reply.test.ts`, `tests/mail/email-ai-learnings.test.ts`,
`tests/integration/postgres-ai-learnings.test.ts` pass (update their expected
per-KB counts only where they asserted whole-document chunks, and say so in the commit).

## Phase C — show sources on drafts awaiting approval

1. `knowledgeSourcesLabel` (server `workflow-ai-draft-nodes.ts:583`, desktop
   `ai-nodes.ts:141`) → `KB-Name › Abschnitt` (Q6), deduped, ≤ 500 chars.
2. Persist it on the draft: new column `email_messages.ai_sources text` (server
   migration, next id; desktop `emailMsgCols` entry), written where
   `ai.draft_reply` creates the draft (both editions, both server paths).
3. DTO: server `aiSources` next to `approvalReason` with the same
   `content_readable === false → null` rule; renderer mapping next to
   `channel-http-registry.ts:5815`; `ai_sources?: string | null` in `src/components/email/types.ts`.
4. Banner (`message-viewer.tsx` inside the `isAwaitingApproval` block): when
   `selectedMessage.ai_sources` is set, render
   `<p className="mt-1 text-[12px] text-muted-foreground">Genutztes Wissen: {selectedMessage.ai_sources}</p>`.
5. Tests: UI test for the banner (pattern: existing message-viewer tests under
   `tests/`; find with `grep -rln "Wartet auf Freigabe" tests`), server/desktop
   draft tests asserting the column is written. Update `docs/PRODUCT_REQUIREMENTS.md:65`
   and P1-8 in `docs/KI_SUPPORT_IMPLEMENTATION_PLAN.md`; CHANGELOG `### Changed`
   entry `**Beide Editionen:**` describing section search and the sources line.

**Phase C done**: `pnpm run test:ui:coverage:check` passes, typecheck/lint/unit pass.

## Done criteria (whole plan)

- [ ] `workflow_knowledge_sections` exists in both editions, with RLS on the server and the id in the migration list test
- [ ] Saving a KB document rebuilds its sections; a KB without sections is rebuilt on first search
- [ ] `grep -n "keywordSearchChunks\|function keywordSearch(" packages/server/src/knowledge-workflow-search.ts electron/workflow/knowledge-base.ts` → no match
- [ ] A draft prompt contains the relevant section, not the whole document (test), and a Learnings hit survives a > 12 000-char general KB (test)
- [ ] The approval banner shows `Genutztes Wissen: …` (UI test)
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run test:integration`, `pnpm run test:mail:coverage`, server and UI ratchets pass
- [ ] `plans/README.md` row and `plans/MASTERPLAN.md` checkbox updated

## STOP conditions

- 028 or 029 is not on the branch (grep checks under "Depends on" fail).
- The Postgres image or embedded test Postgres has no `german` text search config.
- Any change to `workflow_knowledge_chunks` rows' semantics seems necessary
  (renderer merge, chunk API, SQLite import would break).
- The document editor would have to edit sections instead of whole documents.
- Existing Learnings tests need more than count/shape updates (behaviour regressions).
- The desktop FTS5 table cannot be created on the bundled better-sqlite3 build.

## Maintenance notes

- Sections are a cache: they can always be dropped and rebuilt from the document.
  Anything that writes a KB document or chunks must call the rebuild (or rely on
  the staleness check).
- The server `search_vector` on `workflow_knowledge_chunks` (`simple`) stays
  unused; removing it is a separate clean-up.
- Reviewers: check the tsquery is built only from sanitized terms passed as a
  parameter, RLS on the new table, and that per-KB grouping still feeds
  `joinKnowledgeWithinBudget`.
- Deferred: server embeddings (pgvector), relevance scores in the sources line,
  JTL context sources (P1-8 "Tiefe").
