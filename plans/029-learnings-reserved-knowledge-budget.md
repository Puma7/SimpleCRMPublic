# Plan 029: Give every knowledge base (incl. Learnings) a fair share of the AI knowledge budget

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/core/src/workflow/index.ts packages/server/src/knowledge-workflow-search.ts packages/server/src/workflow-ai-draft-nodes.ts packages/server/src/ai-classification.ts electron/workflow/nodes/ai-nodes.ts tests/unit/workflow-codex-review-regressions.test.ts tests/unit/workflow-two-stage-reply.test.ts CHANGELOG.md`
> If any in-scope file changed since this plan was written (CHANGELOG.md will
> usually have changed — only `[Unreleased]` matters), compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch, treat
> it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9e0491e3`, 2026-09-27

## Why this matters

AI drafts read knowledge from several knowledge bases (KBs) in a fixed order:
`general → inbound/outbound → learnings`. Each KB is stored as **one** chunk
holding the whole Markdown document, so a search hit returns the whole
document. The draft nodes then join all hits and cut the text at 12 000
characters. Once the company KB plus the inbound KB exceed ~12 000 characters,
the **Learnings KB (always last) is silently cut off** — approved learnings stop
influencing drafts without any error. This plan replaces the blind
`.slice(0, MAX)` with a shared helper that splits the budget fairly per KB
(unused share flows to the others), so Learnings always keep their share when
the budget is tight, and output is byte-identical when everything fits. The
real fix (retrieve only relevant `##` sections) is plan 048; this plan keeps
the guarantee small and testable.

A second Learnings gap is fixed here too: a Desktop `ai.draft_reply` node with
an explicitly selected knowledge base reads **only** that KB, so Learnings never
reach it, while the server draft node adds the selected KB to the direction's
context KBs (Learnings included). After this plan both editions behave the same.

## Current state

Order of contexts (`packages/server/src/knowledge-workflow-search.ts:15-25`;
Desktop uses the identical `shared/knowledge-context.ts:28-39`):

```ts
  if (direction === 'outbound' || direction === 'draft_created') {
    return ['general', 'outbound', 'learnings'];
  }
  if (direction === 'inbound') {
    return ['general', 'inbound', 'learnings'];
  }
  return ['general', 'learnings'];
```

Server search (`knowledge-workflow-search.ts:39-43, 130-152`) returns matches
**without** the KB id, grouped per KB in order (explicit KB first, then contexts):

```ts
export type WorkflowKnowledgeChunkMatch = { id: number; title: string | null; content: string };
…
  for (const kbId of kbIds) {
    merged.push(...await keywordSearchChunks(trx, workspaceId, kbId, query, perKb));
  }
  return merged.slice(0, limit);
```

`keywordSearchChunks` (`45-84`) maps rows to `{ id, title, content }` at lines 60–64.
A KB is one chunk titled `Dokument` (`packages/server/src/db/postgres-workflow-runtime-read-ports.ts:767-768, 824-890`).

Consumers that cut the joined knowledge (all found by
`grep -rn "searchKnowledgeForWorkflow\|KNOWLEDGE_MAX" packages/server/src electron`):

| Where | Code | Cap |
|---|---|---|
| Server `executeWorkflowAiDraftReply` | `packages/server/src/workflow-ai-draft-nodes.ts:149` `chunks.map((c) => c.content).join('\n---\n').slice(0, DRAFT_REPLY_KNOWLEDGE_MAX)` | 12 000 (`:53`) |
| Server `createPostgresAiDraftReplyPort` (job path) | same expression at `workflow-ai-draft-nodes.ts:916` | 12 000 |
| Server `ai.agent` with `autoKnowledge` | `packages/server/src/ai-classification.ts:1536-1547` `buildAgentUserPrompt`: `Titel: …\n<content>` joined by `'\n---\n'`, `.slice(0, AGENT_KNOWLEDGE_MAX)` | 12 000 (`:55`) |
| Desktop `ai.draft_reply` | `electron/workflow/nodes/ai-nodes.ts:797-798` same expression as server | 12 000 (`:95`) |

Consumers **without** a cap (Learnings are never cut there; leave unchanged):
Server `buildKnowledgePromptAppend` (`knowledge-workflow-search.ts:154-163`, used by
`packages/server/src/ai-reply-suggestion.ts:502`), Desktop reply suggestion
(`electron/email/email-reply-ai.ts:236-237`), Desktop `ai.agent`
(`electron/workflow/nodes/ai-nodes.ts:612-613`, `join('\n---\n')` without slice).

Desktop chunks already carry the KB id: `KnowledgeChunkRow.knowledge_base_id`
(`electron/workflow/knowledge-base.ts:27-34`; `searchKnowledgeChunks` does `SELECT *`).
Desktop embeds only the first 8 000 chars (`knowledge-base.ts:182`) — out of scope here.

Desktop KB resolution for `ai.agent` (`ai-nodes.ts:612`) and `ai.draft_reply`
(`ai-nodes.ts:797`) — `electron/workflow/nodes/ai-nodes.ts:128-139`:

```ts
/** Wissensbasis wie ai.agent: explizit gewählte KB, sonst passend zur Richtung. */
async function resolveKnowledgeChunks(
  ctx: WorkflowContext,
  config: Record<string, unknown>,
): Promise<Awaited<ReturnType<typeof searchKnowledgeChunks>>> {
  const kbId = config.knowledgeBaseId != null ? Number(config.knowledgeBaseId) : null;
  if (kbId != null && kbId > 0) {
    return searchKnowledgeChunks(kbId, ctx.strings.combined_text, 5);
  }
  const accountId = ctx.message?.account_id ?? ctx.outbound?.accountId ?? null;
  return searchKnowledgeForWorkflow(accountId, ctx.direction, ctx.strings.combined_text, 5);
}
```

Desktop `searchKnowledgeForWorkflow(accountId, direction, query, limit = 5, explicitKbId?)`
(`electron/workflow/knowledge-base.ts:366-387`) already supports the server
semantics ("Eine explizit gewählte Wissensbasis ergänzt die Kontext-Wissensbasen
der Richtung — die Learnings eingeschlossen"); the nodes just never pass
`explicitKbId`. The server draft node passes it
(`packages/server/src/workflow-ai-draft-nodes.ts:129-138`:
`searchKnowledgeForWorkflow(trx, …, 'inbound', query, 5, knowledgeBaseId)`).
The server **agent** with an explicit KB reads only that KB
(`ai-classification.ts:855`, `selectAgentKnowledgeChunks`), and the Desktop agent
test pins the same (`tests/unit/workflow-ai-nodes.test.ts:230-236`: explicit KB →
`searchKnowledgeChunks`, `searchKnowledgeForWorkflow` not called). So only
`ai.draft_reply` changes; `ai.agent` keeps its current behaviour in both editions.

A source-grep regression test pins the current cap expression
(`tests/unit/workflow-codex-review-regressions.test.ts:279-285`):

```ts
    expect(draftNodes).toContain('DRAFT_REPLY_KNOWLEDGE_MAX = 12_000');
    expect(draftNodes).toContain('.slice(0, DRAFT_REPLY_KNOWLEDGE_MAX)');
    expect(desktopAi).toContain('.slice(0, DRAFT_REPLY_KNOWLEDGE_MAX)');
```

Conventions: shared pure logic lives in `packages/core/src` (imported as
`@simplecrm/core` by server and electron; Jest maps it to `packages/core/src`).
Workflow helpers are re-exported from `packages/core/src/workflow/index.ts`
(one `export * from './…'` per file). German code comments.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;` in this environment.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build workspace packages (before Postgres tests) | `pnpm run build:packages` | exit 0 |
| Focused tests | `pnpm exec jest tests/unit/knowledge-budget.test.ts tests/unit/server-ai-draft-knowledge-budget.test.ts tests/unit/workflow-two-stage-reply.test.ts tests/unit/workflow-codex-review-regressions.test.ts` | all pass |
| Typecheck (all) | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Unit / integration | `pnpm run test:unit` / `pnpm run test:integration` | all pass |
| Server coverage ratchet | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |

Embedded-Postgres tests (`tests/integration/postgres-ai-learnings.test.ts`) refuse
to run as root. If `id -u` is 0, run them as a normal user:
`chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist` then
`su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit tests/integration/postgres-ai-learnings.test.ts"`.

## Scope

**In scope** (the only files you should modify):
- `packages/core/src/workflow/knowledge-budget.ts` (create)
- `packages/core/src/workflow/index.ts` (one export line)
- `packages/server/src/knowledge-workflow-search.ts` (add `knowledgeBaseId` to matches)
- `packages/server/src/workflow-ai-draft-nodes.ts`
- `packages/server/src/ai-classification.ts` (`buildAgentUserPrompt` only, plus `export` on it)
- `electron/workflow/nodes/ai-nodes.ts` (the `ai.draft_reply` knowledge line and
  `resolveKnowledgeChunks` only)
- `tests/unit/knowledge-budget.test.ts` (create)
- `tests/unit/server-ai-draft-knowledge-budget.test.ts` (create)
- `tests/unit/workflow-two-stage-reply.test.ts` (add two tests)
- `tests/unit/workflow-codex-review-regressions.test.ts` (update the 2 pinned `.slice` assertions)
- `CHANGELOG.md`

**Out of scope** (do NOT touch):
- Search/ranking itself (`keywordSearchChunks`, `searchKnowledgeChunks`, embeddings,
  chunking) — plan 048.
- Adding caps to the uncapped consumers listed above (behaviour change, not this bug).
- `ai.agent` with an explicit KB (both editions): stays single-KB, matching the
  server and `tests/unit/workflow-ai-nodes.test.ts:230-236`. Do not edit that test.
- `electron/workflow/knowledge-base.ts`: `searchKnowledgeForWorkflow` already
  handles `explicitKbId`; no change needed.
- `DRAFT_REPLY_BODY_MAX` and the other caps.

## Git workflow

- Branch: `advisor/029-learnings-reserved-knowledge-budget`
- Commit messages in German, imperative, area prefix, e.g.
  `KI-Entwurf: Wissensbudget fair auf Wissensbasen verteilen (Learnings nicht mehr abgeschnitten)`.
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Core helper with tests (test first)

Create `tests/unit/knowledge-budget.test.ts` importing
`joinKnowledgeWithinBudget` from `../../packages/core/src/workflow/knowledge-budget`:

- **fits** → identical to `texts.join(separator)` (e.g. three short items).
- **regression**: items `{group: 1, text: 'G'.repeat(10_000)}`,
  `{group: 2, text: 'I'.repeat(5_000)}`, `{group: 3, text: 'LEARNING-MARKER ' + 'L'.repeat(800)}`,
  `maxChars: 12_000`, `separator: '\n---\n'` → result contains the whole
  Learnings text, `result.length <= 12_000`, inbound text complete (5 000 `I`),
  general truncated.
- **fair share**: three groups each 10 000 chars, max 12 000 → each group's
  text length in the result is within ±2 of the others.
- **several chunks per group**: group 1 has two items; the group's share is
  spent in item order, and an item that gets 0 characters is dropped together
  with its separator.
- **edge cases**: empty list → `''`; `maxChars <= 0` → `''`.

Then create `packages/core/src/workflow/knowledge-budget.ts`:

```ts
/**
 * Verteilt das Zeichenbudget des Wissens-Blocks fair auf die Wissensbasen
 * (Gruppen): jede Gruppe bekommt höchstens ihren Anteil, ungenutzter Anteil
 * kleiner Gruppen geht an die übrigen. So schneidet eine große Firmen- oder
 * Eingangs-Wissensbasis die Learnings (immer zuletzt) nicht mehr ab. Passt
 * alles, ist das Ergebnis identisch mit `join(separator)`.
 */
export type KnowledgeBudgetItem = { group: string | number; text: string };

export function joinKnowledgeWithinBudget(
  items: readonly KnowledgeBudgetItem[],
  options: { maxChars: number; separator: string },
): string
```

Algorithm (keep it this simple):
1. `plain = items.map(i => i.text).join(separator)`; if `plain.length <= maxChars` return `plain`.
2. `available = max(0, maxChars - separator.length * (items.length - 1))`.
3. Group demands in first-appearance order; water-fill: sort groups by demand
   ascending, for each: `grant = min(demand, floor(remaining / groupsLeft))`,
   `remaining -= grant`.
4. Per group, hand out `grant` to its items in order (`text.slice(0, n)`); drop
   items with `n === 0`.
5. Join kept items in their **original order** with `separator`; return
   `.slice(0, maxChars)` as a final guard.

Add `export * from './knowledge-budget';` to `packages/core/src/workflow/index.ts`.

**Verify**: `pnpm exec jest tests/unit/knowledge-budget.test.ts` → all pass.

### Step 2: Server — expose the KB id and write the failing draft test

In `knowledge-workflow-search.ts` add `knowledgeBaseId: number` to
`WorkflowKnowledgeChunkMatch` and set it in `keywordSearchChunks`
(`knowledgeBaseId` is the function's parameter).

Create `tests/unit/server-ai-draft-knowledge-budget.test.ts` by copying the
mocks and `fakeTrx` from `tests/unit/server-ai-draft-signature-text.test.ts:1-66`.
Make `searchKnowledgeForWorkflow` resolve to three matches
(`knowledgeBaseId` 1/2/3, contents `'G'.repeat(10_000)`, `'I'.repeat(5_000)`,
`'LEARNING-MARKER Retoure 30 Tage'`), call `executeWorkflowAiDraftReply` with
`config: {}`, then read the `user` prompt from
`(runWorkflowTrackedChatCompletion as jest.Mock).mock.calls[0]![1].user` and
expect it to contain `'LEARNING-MARKER Retoure 30 Tage'`.

**Verify**: `pnpm exec jest tests/unit/server-ai-draft-knowledge-budget.test.ts` → FAILS (marker missing).

### Step 3: Server — use the helper in both draft paths and the agent prompt

In `workflow-ai-draft-nodes.ts` add one local function and use it at lines 149 and 916:

```ts
/** Wissens-Block des Entwurfs: Budget fair je Wissensbasis (Learnings bleiben drin). */
function draftReplyKnowledgeText(chunks: readonly { id: number; knowledgeBaseId?: number; content: string }[]): string {
  return joinKnowledgeWithinBudget(
    chunks.map((c) => ({ group: c.knowledgeBaseId ?? `chunk:${c.id}`, text: c.content })),
    { maxChars: DRAFT_REPLY_KNOWLEDGE_MAX, separator: '\n---\n' },
  );
}
```

(import `joinKnowledgeWithinBudget` from `@simplecrm/core`, next to the existing
core import at line 14). In `ai-classification.ts`, make `buildAgentUserPrompt`
exported and build `knowledge` with the helper: item text =
`[chunk.title ? `Titel: ${chunk.title}` : '', String(chunk.content ?? '')].filter(Boolean).join('\n')`,
group = `chunk.knowledgeBaseId ?? 0` (extend the local type at line 217 with
`knowledgeBaseId?: number`; chunks from `selectAgentKnowledgeChunks` all belong
to one KB, so group `0` is correct), `maxChars: AGENT_KNOWLEDGE_MAX`.
Add a test to `tests/unit/server-ai-draft-knowledge-budget.test.ts` calling
`buildAgentUserPrompt({ combined_text: 'Frage' }, chunks, {})` with the same
three chunks and asserting the marker is present.

Update `tests/unit/workflow-codex-review-regressions.test.ts:283` to
`expect(draftNodes).toContain('maxChars: DRAFT_REPLY_KNOWLEDGE_MAX');`
(keep the other assertions).

**Verify**: `pnpm exec jest tests/unit/server-ai-draft-knowledge-budget.test.ts tests/unit/server-ai-draft-signature-text.test.ts tests/unit/workflow-codex-review-regressions.test.ts` → all pass.

### Step 4: Desktop — same fix in `ai.draft_reply`

Add a test to `describe('ai.draft_reply (Agent 1)')` in
`tests/unit/workflow-two-stage-reply.test.ts`: override
`(searchKnowledgeForWorkflow as jest.Mock).mockResolvedValueOnce([...])` (import
it from `../../electron/workflow/knowledge-base`, which is mocked at lines 43–48)
with three rows `{ id, knowledge_base_id: 1|2|3, title, content }` as in Step 2,
execute the node with `ctx()` and `{}`, and assert
`(runChatCompletion as jest.Mock).mock.calls[0]![1]` contains the marker. Run it
→ FAILS. Then replace `ai-nodes.ts:798` with:

```ts
      const kbText = joinKnowledgeWithinBudget(
        chunks.map((c) => ({ group: c.knowledge_base_id ?? `chunk:${c.id}`, text: c.content })),
        { maxChars: DRAFT_REPLY_KNOWLEDGE_MAX, separator: '\n---\n' },
      );
```

(add `joinKnowledgeWithinBudget` to the `@simplecrm/core` import at line 83) and
update `tests/unit/workflow-codex-review-regressions.test.ts:285` to
`expect(desktopAi).toContain('maxChars: DRAFT_REPLY_KNOWLEDGE_MAX');`.

**Verify**: `pnpm exec jest tests/unit/workflow-two-stage-reply.test.ts tests/unit/workflow-ai-nodes.test.ts tests/unit/workflow-codex-review-regressions.test.ts` → all pass.

### Step 5: Desktop — explicit KB in `ai.draft_reply` adds to the context KBs (incl. Learnings)

Regression test first. In `describe('ai.draft_reply (Agent 1)')` of
`tests/unit/workflow-two-stage-reply.test.ts` (the `ctx()` helper there has
`direction: 'inbound'`, `message.account_id` from `baseMessage`, and the
`combined_text` `'Frage zu Bestellung 1234\nWo bleibt meine Bestellung?'`), add
`'explizite Wissensbasis ergänzt die Kontext-Wissensbasen inkl. Learnings (wie Server)'`:
import `searchKnowledgeChunks` and `searchKnowledgeForWorkflow` from
`../../electron/workflow/knowledge-base` (mocked at lines 43–48), run
`await node.execute(ctx(), { knowledgeBaseId: 9 }, 'd')` and expect:

```ts
expect(searchKnowledgeForWorkflow).toHaveBeenCalledWith(
  baseMessage.account_id, 'inbound', 'Frage zu Bestellung 1234\nWo bleibt meine Bestellung?', 5, 9,
);
expect(searchKnowledgeChunks).not.toHaveBeenCalled();
```

Run it → FAILS (today `searchKnowledgeChunks(9, …, 5)` is called instead).

Fix in `electron/workflow/nodes/ai-nodes.ts`: give `resolveKnowledgeChunks` an
option so only the draft node changes and `ai.agent` keeps single-KB behaviour:

```ts
/**
 * Wissensbasis für KI-Knoten. ai.agent: explizit gewählte KB allein.
 * ai.draft_reply (wie Server): die gewählte KB ergänzt die Kontext-Wissensbasen
 * der Richtung — die Learnings eingeschlossen — statt sie zu ersetzen.
 */
async function resolveKnowledgeChunks(
  ctx: WorkflowContext,
  config: Record<string, unknown>,
  opts: { explicitSupplementsContext?: boolean } = {},
): Promise<Awaited<ReturnType<typeof searchKnowledgeChunks>>> {
  const kbId = config.knowledgeBaseId != null ? Number(config.knowledgeBaseId) : null;
  const accountId = ctx.message?.account_id ?? ctx.outbound?.accountId ?? null;
  if (kbId != null && kbId > 0) {
    if (opts.explicitSupplementsContext) {
      return searchKnowledgeForWorkflow(accountId, ctx.direction, ctx.strings.combined_text, 5, kbId);
    }
    return searchKnowledgeChunks(kbId, ctx.strings.combined_text, 5);
  }
  return searchKnowledgeForWorkflow(accountId, ctx.direction, ctx.strings.combined_text, 5);
}
```

and call it at `ai-nodes.ts:797` (the `ai.draft_reply` node) as
`resolveKnowledgeChunks(ctx, config, { explicitSupplementsContext: true })`.
Leave the `ai.agent` call at `:612` unchanged. Keep the direction as
`ctx.direction` (Desktop already does so for the non-explicit case).

**Verify**: `pnpm exec jest tests/unit/workflow-two-stage-reply.test.ts tests/unit/workflow-ai-nodes.test.ts` →
all pass (the new test included; `workflow-ai-nodes.test.ts:230-236` unchanged and green).

### Step 6: Changelog and full checks

`CHANGELOG.md` → `[Unreleased]` → `### Fixed`:

`- **Beide Editionen:** KI-Entwürfe nutzen die freigegebenen Learnings auch bei großen Wissensbasen. Bisher wurde das Wissen nach 12.000 Zeichen abgeschnitten, und die Learnings (immer zuletzt) fielen weg, sobald Firmen- und Eingangs-Wissensbasis zusammen länger waren. Jetzt bekommt jede Wissensbasis einen fairen Anteil.`

`- **Desktop:** „KI-Antwortentwurf“ mit fest gewählter Wissensbasis liest jetzt zusätzlich die Wissensbasen der Richtung und die Learnings, wie auf dem Server. Bisher sah der Entwurf nur die gewählte Wissensbasis.`

**Verify**: `pnpm run build:packages`, `pnpm run typecheck`, `pnpm run lint`,
`pnpm run test:unit` → exit 0; `tests/integration/postgres-ai-learnings.test.ts`
(as non-root, see Commands) → all pass; server coverage ratchet passes.

## Test plan

- `tests/unit/knowledge-budget.test.ts` (new): fits/identity, the Learnings
  regression, fair share, multi-chunk groups, edge cases.
- `tests/unit/server-ai-draft-knowledge-budget.test.ts` (new, pattern
  `tests/unit/server-ai-draft-signature-text.test.ts`): server draft prompt and
  agent prompt keep the Learnings marker with general+inbound > 12 000.
- `tests/unit/workflow-two-stage-reply.test.ts`: two new Desktop draft tests —
  budget (Step 4: Learnings marker survives general+inbound > 12 000) and
  explicit KB (Step 5: `searchKnowledgeForWorkflow(…, 5, 9)` called,
  `searchKnowledgeChunks` not called).
- `tests/unit/workflow-ai-nodes.test.ts`: unchanged; must stay green (pins that
  `ai.agent` with an explicit KB still reads only that KB).
- `tests/unit/workflow-codex-review-regressions.test.ts`: two assertions updated.

## Done criteria

- [ ] `grep -rn "slice(0, DRAFT_REPLY_KNOWLEDGE_MAX)\|slice(0, AGENT_KNOWLEDGE_MAX)" packages/server/src electron` → no match
- [ ] `grep -rn "joinKnowledgeWithinBudget" packages/server/src electron` shows uses in `workflow-ai-draft-nodes.ts`, `ai-classification.ts`, `electron/workflow/nodes/ai-nodes.ts`
- [ ] Focused tests from the Commands table pass, incl. the new ones
- [ ] `grep -n "explicitSupplementsContext: true" electron/workflow/nodes/ai-nodes.ts` → exactly one match (the `ai.draft_reply` call); `pnpm exec jest tests/unit/workflow-ai-nodes.test.ts` passes with `git diff --quiet tests/unit/workflow-ai-nodes.test.ts` (file untouched)
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:unit` exit 0; Postgres learnings test passes
- [ ] `git status` shows only in-scope files changed
- [ ] CHANGELOG entry added; `plans/README.md` row updated; `plans/MASTERPLAN.md` checkbox ticked

## STOP conditions

Stop and report back (do not improvise) if:

- The Step 2 / Step 4 tests pass **before** the fix (the cut no longer happens; re-scope).
- `tests/integration/postgres-ai-learnings.test.ts` or `tests/mail/email-ai-learnings.test.ts`
  fails because of the new `knowledgeBaseId` field (e.g. a `toEqual` on match objects).
- Importing `buildAgentUserPrompt` from `ai-classification.ts` in a unit test
  fails on module side effects — then keep the helper change, drop that one
  test, and report.
- A fix appears to need changes to search, chunking or the uncapped consumers.

## Maintenance notes

- Plan 048 replaces whole-document chunks with `##` sections; keep using
  `joinKnowledgeWithinBudget` there (group = KB id) so Learnings keep their share.
- Reviewers: confirm output is unchanged when the total fits (first branch of the
  helper) and that original chunk order is preserved.
- Found while planning, not fixed here: Desktop `resolveKnowledgeChunks`
  (`electron/workflow/nodes/ai-nodes.ts:129-139`) ignores Learnings when a node
  has an explicit `knowledgeBaseId`, unlike the server draft path
  (`workflow-ai-draft-nodes.ts:129-138` passes `knowledgeBaseId` as `explicitKbId`).
  Desktop `ai.agent` and both reply-suggestion paths have no knowledge cap at all.
