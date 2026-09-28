# Plan 035: Learnings digest rejects an oversized knowledge base before the AI call and never retries a paid run

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- packages/core/src/learnings/digest.ts packages/server/src/ai-learnings.ts packages/server/src/api/ai-learnings-routes.ts electron/email/email-ai-learnings.ts tests/unit/ai-learnings-digest.test.ts tests/unit/server-ai-learnings-routes.test.ts tests/integration/postgres-ai-learnings.test.ts tests/mail/email-ai-learnings.test.ts tests/unit/learnings-panel.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `9e0491e3`, 2026-09-27

**Audit correction:** the audit also asked to "cap `proposed_content` before insert".
That is already done: `computeLearningsDigestProposal` (`packages/core/src/learnings/digest.ts:506-512`)
returns `ok: false` when the proposal exceeds `LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH`
(100 000). AI failures are also already stored as a `failed` digest (`status: computed.ok ? 'pending' : 'failed'`).
The real gap is `base_content` (and any other insert error), described below.

## Why this matters

Server edition: the digest job loads the whole target knowledge base (KB) without a size
check, sends it to the AI, and only then inserts it as `base_content` into
`ai_learning_digests`, whose column has `CHECK (char_length(base_content) <= 100000)`.
A KB can exceed 100 000 chars: the merged document joins several chunks (each chunk
may be up to 100 000 chars via `POST /api/v1/workflow-knowledge-chunks`, or imported from
Desktop), and even a 100 000-char document saved via `PUT …/document` is stored with an
appended `\n` (100 001). The insert then fails with a CHECK violation, the error is
rethrown, and the manually triggered job (default `maxAttempts` 5) repeats the **paid AI
call up to five times**, never records a failed digest, and the UI's "läuft" marker
disappears without any explanation. Desktop has no CHECK, but sends an arbitrarily large
KB to the AI and then fails with "Vorgeschlagene Wissensbasis ist zu lang" after paying.
After this plan: an oversized KB is rejected before any AI call with a clear German
message in both editions, the manual server job runs at most once, and an unexpected
insert error becomes a visible `failed` digest.

## Current state

- `packages/core/src/learnings/digest.ts` — shared logic.
  - `:60-61` `export const LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH = 100_000;`
  - `:472-513` `computeLearningsDigestProposal({ knowledgeBaseName, baseContent, candidates, chat, maxDocumentLength })`
    builds the prompt and calls `chat` immediately (`:479-489`); size check only on the result (`:506-512`).
- `packages/server/src/ai-learnings.ts` — server Learnings.
  - `:973-977` preflight result type:
    ```ts
    export type AiLearningsDigestPreflight =
      | { status: 'skipped_pending'; knowledgeBaseId: number; digestId: number; candidateCount: number }
      | { status: 'skipped_no_candidates'; knowledgeBaseId: number | null; candidateCount: number }
      | { status: 'failed'; error: string; knowledgeBaseId: number | null; candidateCount: number }
      | { status: 'ready'; knowledgeBaseId: number | null; candidateCount: number };
    ```
  - `:980-1015` `preflightAiLearningsDigest(trx, plan, now)` — used by the route
    (`prepareDigestRequest`, `:1314-1326`), the workflow node (`executeServerLearningsDigestNode`, `:1359-1439`)
    and the job (`runAiLearningsDigest`, `:1034`). Checks: target exists, no pending digest, enough candidates. No size check.
  - `:1049-1059` job loads the document: `const document = await loadWorkflowKnowledgeDocument(...)` … `baseContent: document?.content ?? ''`.
  - `:1093-1104` AI call via `computeLearningsDigestProposal`.
  - `:1106-1159` insert; `:1119-1140` `base_content: prepared.baseContent`; `:1152-1159`:
    ```ts
    } catch (error) {
      if (isUniqueViolation(error)) { … return { status: 'skipped_pending', … }; }
      throw error;
    }
    ```
  - `:1181-1189` `finally` deletes the `learnings_digest_running_at` marker (UI "läuft").
  - `:1415-1428` the workflow node enqueues with `max_attempts: 1` (direct `job_queue` insert).
- `packages/server/src/api/ai-learnings-routes.ts:280-297` — manual route:
  `if (preflight.status === 'failed') return error(404, 'workflow_knowledge_base_not_found', preflight.error);`
  and `await ports.jobQueue.enqueue({ type: 'learnings.digest', workspaceId, payload: {…} });` — **no `maxAttempts`**.
- `packages/server/src/jobs/policy.ts:5` `JOB_DEFAULT_MAX_ATTEMPTS = 5`; `:367-373` `normalizeMaxAttempts(undefined) → 5`.
  `EnqueueJobInput` (`packages/server/src/jobs/types.ts:37-43`) accepts `maxAttempts?: number`.
- `packages/server/src/migrations/0057_ai_learnings.ts:36-37` — `base_content`/`proposed_content` CHECK ≤ 100000; `error` CHECK ≤ 2000.
- `electron/email/email-ai-learnings.ts:705-790` — desktop `runAiLearningsDigest`; `:728`
  `const baseContent = document?.content ?? '';` then the AI call at `:735-740`. No size check.
  Desktop KBs are Markdown files (`electron/workflow/knowledge-base.ts:90-151`) without a limit.
- UI `src/components/email/settings/learnings-panel.tsx:266-293` `runDigest`: the `default:`
  branch shows `toast.error(\`Auswertung fehlgeschlagen: ${result.error ?? "unbekannter Fehler"}\`)`
  for `status: 'failed'` — so returning `{ status: 'failed', error }` needs **no UI change**.
  (A new status such as `skipped_too_large` was considered and rejected: it would ripple
  into `LEARNINGS_DIGEST_RESULT_STATUSES`, node variables/schema help, both node message
  maps and the UI switch for no user benefit.)

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;` in this environment.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Build packages (before Postgres tests) | `pnpm run build:packages` | exit 0 |
| Core test | `pnpm exec jest tests/unit/ai-learnings-digest.test.ts` | all pass |
| Route test | `pnpm exec jest tests/unit/server-ai-learnings-routes.test.ts` | all pass |
| Panel test | `pnpm exec jest tests/unit/learnings-panel.test.tsx` | all pass |
| Postgres test | `pnpm exec jest tests/integration/postgres-ai-learnings.test.ts` (as non-root, see below) | all pass |
| Desktop test | `pnpm run test:mail -- tests/mail/email-ai-learnings.test.ts` | all pass |
| Mail coverage | `pnpm run test:mail:coverage` | pass, ratchet ok |
| Typecheck / Lint | `pnpm run typecheck` / `pnpm run lint` | exit 0 / 0 warnings |
| Server coverage ratchet | `pnpm run test:server:coverage && node scripts/check-server-coverage-ratchet.mjs` | pass |

Postgres tests refuse to run as root. If root: `chmod -R a+rwX .tmp-tests tests packages/core/dist packages/server/dist`
then `su tester -s /bin/bash -c "export PATH=/opt/node24/bin:\$PATH; cd /home/user/SimpleCRMPublic && node_modules/.bin/jest --cacheDirectory /tmp/jest-tester --forceExit tests/integration/postgres-ai-learnings.test.ts"`.
The file must keep `jest.mock('kysely', () => jest.requireActual('../../packages/server/node_modules/kysely'));`.

## Scope

**In scope**:
- `packages/core/src/learnings/digest.ts`
- `packages/server/src/ai-learnings.ts`
- `packages/server/src/api/ai-learnings-routes.ts`
- `electron/email/email-ai-learnings.ts`
- Tests: `tests/unit/ai-learnings-digest.test.ts`, `tests/unit/server-ai-learnings-routes.test.ts`,
  `tests/integration/postgres-ai-learnings.test.ts`, `tests/mail/email-ai-learnings.test.ts`, `tests/unit/learnings-panel.test.tsx`
- `CHANGELOG.md`

**Out of scope**:
- Migration changes (the CHECK stays; we just never violate it).
- `LEARNINGS_DIGEST_RESULT_STATUSES` / new result statuses; the workflow schema help text.
- Prompt wording and acceptance logic (plan 038 touches the same files — do not pre-empt it).
- Desktop dry-run preflight (`preflightAiLearningsDigest` in electron is sync and does not
  read the KB file; the size check happens at run time there).

## Git workflow

- Branch: `advisor/035-learnings-digest-size-preflight`
- Commit message e.g. `Learnings: zu große Wissensbasis vor dem KI-Aufruf ablehnen, Auswertung nicht wiederholen`
- Do NOT push or open a PR unless the operator says so.

## Steps

### Step 1: Regression tests first (all should fail)

1. `tests/unit/ai-learnings-digest.test.ts`, in `describe('computeLearningsDigestProposal (TA-P5)')` add
   `it('ruft die KI bei zu großer Wissensbasis gar nicht erst auf', …)`: `chat = jest.fn()`,
   `baseContent: 'x'.repeat(LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH + 1)` → expect
   `{ ok: false, error: expect.stringContaining('Die Wissensbasis ist zu groß') }` and `chat` not called.
2. `tests/integration/postgres-ai-learnings.test.ts`, new
   `test('Zu große Wissensbasis: kein KI-Aufruf, klare Meldung, Knoten meldet Fehler', …)`:
   - `await saveAiLearningsSettings({ db }, WS_A, { targetKnowledgeBaseId: KB_ID });`
     then as admin add a second chunk so the merged document exceeds 100 000 chars:
     `INSERT INTO workflow_knowledge_chunks (workspace_id, source_sqlite_id, knowledge_base_source_sqlite_id, knowledge_base_id, title, content) VALUES ($1, 9713, $2, $2, 'Groß', $3)` with `'x'.repeat(100_000)`.
   - `await seedCandidates(2);` `const chat = jest.fn(async () => '{"operations":[]}');`
   - `runAiLearningsDigest({ db, chat }, { workspaceId: WS_A, period: 'week', minCandidates: 1, trigger: 'manual' })`
     → resolves `{ status: 'failed', digestId: null, error: expect.stringContaining('zu groß') }`; `chat` not called.
     (Today it calls `chat` once and then **rejects** with a check-constraint error — confirm this failure first.)
   - `executeServerLearningsDigestNode(trx, …)` inside `withWorkspaceTransaction` (copy the call shape from the
     existing test at `:586`, direction `'schedule'`) → `{ status: 'error', port: 'error', message: expect.stringContaining('zu groß') }` and no row in `job_queue` of type `learnings.digest`.
   - Delete the extra chunk in a `finally` (`DELETE FROM workflow_knowledge_chunks WHERE workspace_id = $1 AND source_sqlite_id = 9713`):
     `beforeEach` (`:80-86`) does NOT reset chunks of `KB_ID`, and later tests assert its exact chunk rows.
3. Same file, new `test('Speicherfehler nach dem KI-Aufruf wird als fehlgeschlagener Vorschlag festgehalten', …)`:
   as admin create a trigger that fails pending inserts, run a digest, then drop the trigger in `finally`:
   ```sql
   CREATE OR REPLACE FUNCTION test_fail_pending_digest() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN IF NEW.status = 'pending' THEN RAISE EXCEPTION 'Testfehler beim Speichern'; END IF; RETURN NEW; END $$;
   CREATE TRIGGER test_fail_pending_digest BEFORE INSERT ON ai_learning_digests
     FOR EACH ROW EXECUTE FUNCTION test_fail_pending_digest();
   ```
   Expect `{ status: 'failed', digestId: expect.any(Number), error: expect.stringContaining('Testfehler beim Speichern') }`,
   one `ai_learning_digests` row with `status = 'failed'`, and all seeded candidates still `processed_at IS NULL`.
4. `tests/unit/server-ai-learnings-routes.test.ts:193-212`: extend the `enqueue` expectation with `maxAttempts: 1`,
   and add a case with `prepareDigestRequest` returning
   `{ status: 'failed', code: 'knowledge_base_too_large', error: 'Die Wissensbasis ist zu groß …', knowledgeBaseId: 3, candidateCount: 0 }`
   → response `{ status: 200, body: { data: { status: 'failed', digestId: null, error: expect.stringContaining('zu groß') } } }`, `enqueue` not called.
5. `tests/mail/email-ai-learnings.test.ts`: new test — `createKnowledgeBase('Groß', …)`,
   `saveKnowledgeBaseDocument(kb, 'x'.repeat(100_001))`, set it as target with `saveAiLearningsSettings({ targetKnowledgeBaseId: kb })` (as at `:148-158`),
   seed a note candidate the way the test at `:239-256` does, run `runAiLearningsDigest({ trigger: 'manual', minCandidates: 1, chat })` (default minimum is 3) → `{ status: 'failed', digestId: null, error: /zu groß/ }`, `chat` not called, no digest row.

**Verify**: each new test fails for the expected reason (chat called / promise rejects / `maxAttempts` missing).

### Step 2: Core guard and message

In `digest.ts` next to the constants add:

```ts
/** Meldung, wenn die Wissensbasis für eine Auswertung zu groß ist (null = passt). */
export function learningsKnowledgeBaseTooLargeError(
  length: number,
  max: number = LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH,
): string | null {
  if (length <= max) return null;
  return `Die Wissensbasis ist zu groß für eine Auswertung (${length} von höchstens ${max} Zeichen). `
    + 'Bitte kürzen oder in den Learnings-Einstellungen eine andere Ziel-Wissensbasis wählen.';
}
```

In `computeLearningsDigestProposal`, before `buildLearningsDigestPrompt`, compute
`maxLength` once (move the existing `const maxLength = …` line up) and
`const tooLarge = learningsKnowledgeBaseTooLargeError(input.baseContent.length, maxLength); if (tooLarge) return { ok: false, error: tooLarge };`.

**Verify**: `pnpm exec jest tests/unit/ai-learnings-digest.test.ts` → all pass.

### Step 3: Server preflight, job and route

1. `AiLearningsDigestPreflight` failed variant: add `code?: 'knowledge_base_too_large'`.
2. `preflightAiLearningsDigest`: after the candidate-count check (so "keine Einträge" still wins)
   and only when `knowledgeBaseId !== null`, load the document with
   `loadWorkflowKnowledgeDocument(trx, plan.workspaceId, knowledgeBaseId)` and return
   `{ status: 'failed', code: 'knowledge_base_too_large', error, knowledgeBaseId, candidateCount: candidates.length }`
   when `learningsKnowledgeBaseTooLargeError(document?.content.length ?? 0)` is non-null.
   (`knowledgeBaseId === null` means the small default KB will be created — nothing to check.)
3. `runAiLearningsDigest`:
   - add a private helper `recordFailedDigest(deps, plan, { knowledgeBaseId, candidateCount, from, now, error })`
     that inserts one `ai_learning_digests` row in its own `withWorkspaceTransaction(… role: 'system' …)`
     with `status: 'failed'`, `base_content: ''`, `proposed_content: ''`, `summary: ''`,
     `operations_json: JSON.stringify([])`, `error` cut to `LEARNINGS_MAX_ERROR` (import from `@simplecrm/core`),
     the same `trigger`/`requested_by_user_id`/`period_*` values as the normal insert, `workflow_id: null`; returns the id.
   - in the insert `catch`: keep the unique-violation branch; otherwise
     `const message = \`Vorschlag konnte nicht gespeichert werden: ${error instanceof Error ? error.message : String(error)}\`;`
     try `recordFailedDigest(...)` and return `{ status: 'failed', digestId, candidateCount, knowledgeBaseId, error: message }`;
     if recording also throws, rethrow the **original** error.
   - in the `prepared.kind === 'skip'` branch, when `preflight.code === 'knowledge_base_too_large'` and
     `preflight.knowledgeBaseId !== null`, record a failed digest with the preflight message (race case: KB grew
     after the route/node preflight) and return its id; the existing return shape stays otherwise.
4. `ai-learnings-routes.ts`: before the 404 mapping, return
   `data(200, { status: 'failed', digestId: null, candidateCount: preflight.candidateCount, error: preflight.error })`
   when `preflight.code === 'knowledge_base_too_large'`. Add `maxAttempts: 1` to the `enqueue` call with a
   German comment: `// Wie der Knoten: ein fehlgeschlagener Lauf kostet schon einen KI-Aufruf, keine Wiederholung.`
5. The node (`executeServerLearningsDigestNode`) needs no change: its `failed` branch already returns the error port with `preflight.error`.

**Verify**: `pnpm run build:packages` exit 0; `pnpm exec jest tests/unit/server-ai-learnings-routes.test.ts` all pass;
Postgres test file (non-root) all pass.

### Step 4: Desktop

In `electron/email/email-ai-learnings.ts` right after `const baseContent = document?.content ?? '';` (`:728`):

```ts
const tooLarge = learningsKnowledgeBaseTooLargeError(baseContent.length);
if (tooLarge) return { status: 'failed', digestId: null, candidateCount: preflight.candidates.length, error: tooLarge };
```

(import `learningsKnowledgeBaseTooLargeError` from the same module the file already imports
`computeLearningsDigestProposal` from). The `finally` still clears `runningDigests`.

**Verify**: `pnpm run test:mail -- tests/mail/email-ai-learnings.test.ts` → all pass.

### Step 5: UI pin, changelog, gates

- `tests/unit/learnings-panel.test.tsx`: in the "Auswertung starten" test (`:252-276`) add a run returning
  `{ status: 'failed', digestId: null, candidateCount: 0, error: 'Die Wissensbasis ist zu groß …' }` and assert
  `mockToast.error` was called with `'Auswertung fehlgeschlagen: Die Wissensbasis ist zu groß …'`. No component change.
- `CHANGELOG.md` `[Unreleased]` → `### Fixed`:
  `- **Beide Editionen:** „Learnings auswerten“ lehnt eine Wissensbasis über 100 000 Zeichen jetzt vor dem KI-Aufruf mit einer Meldung ab. Auf dem Server scheiterte das Speichern des Vorschlags danach, und die Auswertung wurde bis zu fünfmal wiederholt – mit je einem bezahlten KI-Aufruf und ohne Eintrag im Verlauf. Die Auswertung per Knopf läuft jetzt höchstens einmal; ein Speicherfehler erscheint als fehlgeschlagener Vorschlag.`

**Verify**: `pnpm run typecheck` 0; `pnpm run lint` 0 warnings; `pnpm run test:mail:coverage` ok;
server coverage ratchet command passes.

## Test plan

- Core: 1 new `it` (no AI call on oversized base).
- Postgres: 2 new tests (oversized KB → failed without AI call + node error port; forced insert
  error → failed digest row, candidates open). Pattern: the existing `'Auswerten: …'` test at `:326`.
- Routes unit: `maxAttempts: 1` + too-large preflight → 200 failed, no enqueue.
- Desktop mail: 1 new test (oversized KB file → failed, no AI call). Pattern: `:275-309`.
- Panel: 1 assertion for the failed toast.

## Done criteria

- [ ] `pnpm run typecheck` exits 0; `pnpm run lint` exits 0 with 0 warnings
- [ ] Core, route, panel, desktop and Postgres Learnings tests pass, including the new ones
- [ ] `grep -n "maxAttempts: 1" packages/server/src/api/ai-learnings-routes.ts` shows the enqueue
- [ ] `grep -n "learningsKnowledgeBaseTooLargeError" packages/server/src/ai-learnings.ts electron/email/email-ai-learnings.ts packages/core/src/learnings/digest.ts` finds all three files
- [ ] `pnpm run test:mail:coverage` and the server coverage ratchet pass
- [ ] Only in-scope files changed (`git status`)
- [ ] Row 035 in `plans/README.md` (Runde 2) updated; checkbox in `plans/MASTERPLAN.md` ticked

## STOP conditions

- The Postgres regression test in Step 1.2 does **not** fail before the fix (e.g. chunk inserts rejected
  by a constraint you did not expect) — report what happened instead of changing the scenario.
- The route test harness `makePorts()` cannot express `code` on the preflight result without changing the
  `AiLearningsApiPort` type beyond adding the optional `code` field.
- `recordFailedDigest` would need RLS/role changes (the existing insert already runs as `role: 'system'`; if it
  does not work for the new helper, stop).
- Any change to `packages/server/src/migrations/*` seems necessary.

## Maintenance notes

- The preflight threshold equals the DB CHECK (100 000). If the CHECK or
  `LEARNINGS_KNOWLEDGE_DOCUMENT_MAX_LENGTH` changes, both must move together.
- A KB just under the limit can still produce a proposal over the limit (AI adds sections) — that
  case already ends as a `failed` digest ("Vorgeschlagene Wissensbasis ist zu lang") after one AI call. A
  headroom check was deliberately not added.
- Server preflight now loads the KB document once more per request/node run (two queries). Negligible,
  but if KBs get large and nodes run often, consider a `char_length` aggregate query instead.
- Plan 038 edits the same functions (prompt, acceptance); rebase carefully.
- Reviewer focus: the `catch` in `runAiLearningsDigest` must still map unique violations to `skipped_pending`
  and must never swallow an error without either a failed row or a rethrow.
