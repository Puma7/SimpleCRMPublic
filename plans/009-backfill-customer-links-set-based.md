# Plan 009: Replace the per-row UPDATE loop in `backfillCustomerLinks` with a single set-based UPDATE

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`) —
> unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> ```
> git diff --stat f24fb27..HEAD -- \
>   packages/server/src/db/postgres-mail-read-ports.ts \
>   tests/unit/postgres-mail-backfill-customer-links.test.ts
> ```
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition. (The test file does not exist at
> `f24fb27` — you create it in this plan — so it will show no diff.)

## Status

- **Priority**: P3
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

`backfillMessageCustomerLinks` (the server-edition implementation behind the
`POST /api/v1/email/messages/backfill-customer-links` route) matches unlinked
email messages to customers by sender address and links them. It already builds
the whole sender→customer map in memory, but then issues **one `UPDATE … RETURNING`
round-trip per matched message** inside a `for` loop, up to the normalized cap of
**5000** rows per call. That is up to 5000 sequential statements in a single
transaction — a burst of round-trips that scales linearly with the backfill size
and holds the transaction open far longer than needed. Collapsing the loop into
**one** set-based `UPDATE … FROM (VALUES …)` sends a single statement that links
every matched row at once, preserving the existing `customer_id IS NULL` guard.
After this lands the operation is O(1) statements instead of O(N), with identical
results.

## Current state

- `packages/server/src/db/postgres-mail-read-ports.ts` — the server-edition mail
  read/mutation port. Contains `backfillMessageCustomerLinks(trx, input)` (the
  function this plan changes) and its wiring into the public port.
  - The port method that calls it, at **lines 1273–1280**:
    ```ts
    async backfillCustomerLinks(input) {
      return withWorkspaceTransaction(
        options.db,
        { workspaceId: input.workspaceId, role: 'system' },
        async (trx) => backfillMessageCustomerLinks(trx, input),
        { applySession: options.applyWorkspaceSession },
      );
    },
    ```
  - The factory that exposes it: `export function createPostgresEmailMessageReadPort(options: PostgresMailReadPortOptions): EmailMessageApiPort` at **line 688**. It is re-exported from `packages/server/src` (via `packages/server/src/db/index.ts` → `export * from './postgres-mail-read-ports'`), so tests import it as `import { createPostgresEmailMessageReadPort } from '../../packages/server/src'`.

- The function under change, `backfillMessageCustomerLinks`, begins at **line 2199**.
  Its **first half is unchanged by this plan** and is what you must leave intact —
  it computes the limit, selects the unlinked messages, selects candidate
  customers, and builds the in-memory `customerByEmail` map. Excerpt (**lines 2207–2246**):
  ```ts
  const limit = normalizeBackfillCustomerLinkLimit(input.limit);
  // ...
  const { sql: kyselySql } = require('kysely') as typeof import('kysely');

  let messageQuery = trx
    .selectFrom('email_messages')
    .select(['id', 'from_json'])
    .where('workspace_id', '=', input.workspaceId)
    .where('customer_id', 'is', null)
    .where('soft_deleted', '=', false)
    // ...
    .orderBy('id', 'desc')
    .limit(limit);
  if (input.accountId !== undefined) {
    messageQuery = messageQuery.where('account_id', '=', input.accountId);
  }
  const messages = await messageQuery.execute() as Array<{ id: number; from_json: unknown | null }>;
  if (messages.length === 0) return { count: 0 };

  const customers = await trx
    .selectFrom('customers')
    .select(['id', 'source_sqlite_id', 'email'])
    .where('workspace_id', '=', input.workspaceId)
    .where(kyselySql<boolean>`email IS NOT NULL AND btrim(email) <> ''`)
    .execute() as Array<{ id: number; source_sqlite_id: number; email: string | null }>;

  const customerByEmail = new Map<string, { id: number; sourceSqliteId: number }>();
  for (const customer of customers) {
    const normalized = normalizeEmailAddress(customer.email ?? '');
    if (normalized && !customerByEmail.has(normalized)) {
      customerByEmail.set(normalized, {
        id: Number(customer.id),
        sourceSqliteId: Number(customer.source_sqlite_id),
      });
    }
  }
  if (customerByEmail.size === 0) return { count: 0 };
  ```

- **The exact block you will replace** is the per-row loop, currently at
  **lines 2248–2269** (the tail of the function, immediately before the closing
  `}` at line 2270):
  ```ts
  const now = new Date();
  let count = 0;
  for (const message of messages) {
    const sender = firstAddressFromRecipientJson(message.from_json);
    if (!sender) continue;
    const customer = customerByEmail.get(normalizeEmailAddress(sender));
    if (!customer) continue;
    const updated = await trx
      .updateTable('email_messages')
      .set({
        customer_id: customer.id,
        customer_source_sqlite_id: customer.sourceSqliteId,
        updated_at: now,
      })
      .where('workspace_id', '=', input.workspaceId)
      .where('id', '=', Number(message.id))
      .where('customer_id', 'is', null)
      .returning('id')
      .executeTakeFirst();
    if (updated) count += 1;
  }
  return { count };
  ```
  Note the guard `.where('customer_id', 'is', null)` — a row that was linked
  concurrently between the SELECT and the UPDATE is skipped. **This guard must be
  preserved** in the replacement.

- The normalized cap is 5000, set by `normalizeBackfillCustomerLinkLimit`
  (**lines 2272–2278**): `return Math.min(value, 5000);` (default 500). So `targets`
  can hold at most 5000 rows.

- Helpers referenced (leave them as-is): `firstAddressFromRecipientJson`
  (**line 2280**, extracts `from_json.value[0].address`), and the module-scoped
  `normalizeEmailAddress` (imported at **line 13** from `@simplecrm/core`).

### Repo conventions to match

- **Raw SQL tag**: this file uses Kysely's `sql` tag aliased to `kyselySql`. Inside
  `backfillMessageCustomerLinks` it is already in scope via
  `const { sql: kyselySql } = require('kysely') as typeof import('kysely');`
  (line 2211). Reuse that same `kyselySql` binding — do **not** add a new import.
  (There is a separate plan, `plans/007-*`, that may later collapse these inline
  requires into the file's top-level `import { sql as kyselySql, … } from 'kysely'`
  at line 29. Either way the identifier is `kyselySql`; your code does not care
  which form provides it.)
- **`trx` is typed `any`** in this function (`backfillMessageCustomerLinks(trx: any, …)`,
  line 2200), so the query-builder chain is untyped — no generic/column type
  friction from mixing `kyselySql.ref(...)` into `.set()`.
- **Unit-test doubles**: DB-port unit tests fake the Kysely query-builder chain
  and capture the calls. The structural exemplar to copy is
  `tests/unit/workflow-execution-jsonb.test.ts` (a `fakeDb(...)` that returns a
  `db.transaction().execute(cb)` shape and per-table builder stubs). Model the new
  test on it.
- **`kysely` is mocked in unit tests** via `jest.config.cjs`
  `moduleNameMapper: { '^kysely$': '<rootDir>/tests/setup/kysely-mock.ts' }`. That
  mock exports only the `sql` template tag and `sql.ref` — it does **not** provide
  `sql.join`. **Your production code must therefore avoid `kyselySql.join(...)`**
  (build the VALUES list by chaining template tags instead — see Step 2). Using
  `sql.join` would compile fine against real Postgres but throw
  `kyselySql.join is not a function` under the unit-test mock.

## Commands you will need

| Purpose | Command | Expected on success |
|---------|---------|---------------------|
| Install | `pnpm install --frozen-lockfile` | exit 0 |
| Typecheck (server only, fast) | `npx tsc -b packages/core packages/server` | exit 0, no errors |
| Typecheck / build (authoritative) | `pnpm run build` | exit 0 |
| Run the new test | `pnpm test -- tests/unit/postgres-mail-backfill-customer-links.test.ts` | all pass |
| Full test suite | `pnpm test` | all pass |
| Mail suite (this is mail/db code) | `pnpm run test:mail` | all pass |
| Lint | `pnpm run lint` | exit 0 (eslint `--max-warnings 0`) |

Notes:
- The test runner is **Jest**; `pnpm test` runs `jest --passWithNoTests`, so
  `pnpm test -- <path>` forwards `<path>` to Jest as a filter.
- There is **no** `typecheck` npm script yet (a separate plan 002 adds one). Until
  then, type-check with `npx tsc -b packages/core packages/server` (fast, server
  only) and/or the authoritative `pnpm run build`.

## Scope

**In scope** (the only files you may modify/create):

- `packages/server/src/db/postgres-mail-read-ports.ts` — replace the per-row loop
  in `backfillMessageCustomerLinks` (Step 2).
- `tests/unit/postgres-mail-backfill-customer-links.test.ts` — **create** (Step 3).

Plus, at the very end, the plan index row: `plans/README.md`.

**Out of scope** (do NOT touch, even though they look related):

- The first half of `backfillMessageCustomerLinks` (the message SELECT, customer
  SELECT, and `customerByEmail` map build). Do not change what it selects, the
  filters, the ordering, or the `limit`.
- `normalizeBackfillCustomerLinkLimit`, `firstAddressFromRecipientJson`,
  `normalizeEmailAddress` — leave the matching/normalization logic exactly as-is.
- `tests/setup/kysely-mock.ts` — do **not** add `join` to the mock; the fix is
  written to not need it.
- The public port shape / return type (`{ count: number }`) — clients depend on it.
- Any other `updateTable('email_messages')` call in this file (there are many) —
  only the loop at lines 2248–2269 changes.
- The route/handler and its test (`tests/unit/server-edition-foundation.test.ts`
  "server mail customer-link backfill route …") — it stubs the port and does not
  exercise this function; leave it.

## Git workflow

- Branch: `advisor/009-backfill-customer-links-set-based`
- Commit style: conventional commits, as in this repo's history (e.g.
  `fix(review): keep raw-headers / .eml export out of the mail read bucket`).
  A single commit is fine, e.g.:
  `perf(mail): link backfilled customers in one set-based UPDATE instead of per-row loop`
- Do NOT push or open a PR unless the operator instructs it.

## Steps

### Step 1: Create the branch

```
git checkout -b advisor/009-backfill-customer-links-set-based
```

**Verify**: `git branch --show-current` → `advisor/009-backfill-customer-links-set-based`

### Step 2: Replace the per-row loop with one set-based UPDATE

In `packages/server/src/db/postgres-mail-read-ports.ts`, replace the **exact block
at lines 2248–2269** (shown verbatim in "Current state") with the block below.
Do not change anything above it in the function.

```ts
  const now = new Date();
  const targets: Array<{ id: number; customerId: number; sourceSqliteId: number }> = [];
  for (const message of messages) {
    const sender = firstAddressFromRecipientJson(message.from_json);
    if (!sender) continue;
    const customer = customerByEmail.get(normalizeEmailAddress(sender));
    if (!customer) continue;
    targets.push({
      id: Number(message.id),
      customerId: customer.id,
      sourceSqliteId: customer.sourceSqliteId,
    });
  }
  if (targets.length === 0) return { count: 0 };

  // Single set-based UPDATE joining email_messages against an in-memory
  // (id, customer_id, customer_source_sqlite_id) VALUES list — replaces the
  // former one-UPDATE-per-row loop. The `customer_id IS NULL` guard stays in
  // the WHERE so a row linked concurrently is left untouched. Built by chaining
  // sql template tags (not kyselySql.join) so it also works under the unit-test
  // kysely mock, which provides only the tag and sql.ref.
  let linkRows = kyselySql`(${targets[0].id}::bigint, ${targets[0].customerId}::bigint, ${targets[0].sourceSqliteId}::bigint)`;
  for (let i = 1; i < targets.length; i += 1) {
    const t = targets[i];
    linkRows = kyselySql`${linkRows}, (${t.id}::bigint, ${t.customerId}::bigint, ${t.sourceSqliteId}::bigint)`;
  }
  const updatedRows = await trx
    .updateTable('email_messages')
    .from(kyselySql`(values ${linkRows}) as backfill_links(id, customer_id, customer_source_sqlite_id)`)
    .set({
      customer_id: kyselySql.ref('backfill_links.customer_id'),
      customer_source_sqlite_id: kyselySql.ref('backfill_links.customer_source_sqlite_id'),
      updated_at: now,
    })
    .whereRef('email_messages.id', '=', 'backfill_links.id')
    .where('email_messages.workspace_id', '=', input.workspaceId)
    .where('email_messages.customer_id', 'is', null)
    .returning('email_messages.id')
    .execute();
  return { count: updatedRows.length };
```

Why this is correct (verified by compiling against the pinned Kysely `0.29.2`):
the chain produces exactly this Postgres statement (params shown for 3 rows):
```
update "email_messages"
set "customer_id" = "backfill_links"."customer_id",
    "customer_source_sqlite_id" = "backfill_links"."customer_source_sqlite_id",
    "updated_at" = $1
from (values ($2::bigint, $3::bigint, $4::bigint), ($5::bigint, $6::bigint, $7::bigint), ($8::bigint, $9::bigint, $10::bigint))
     as backfill_links(id, customer_id, customer_source_sqlite_id)
where "email_messages"."id" = "backfill_links"."id"
  and "email_messages"."workspace_id" = $11
  and "email_messages"."customer_id" is null
returning "email_messages"."id"
```
- The `::bigint` casts on the first VALUES row fix the column types (`id`,
  `customer_id`, `customer_source_sqlite_id` are all `bigint` in the
  `email_messages` schema — see `packages/server/src/migrations/0007_core_mail_schema.ts`).
- `email_messages.customer_id IS NULL` is the preserved guard; `email_messages.workspace_id`
  scopes to the workspace exactly as the old `.where('workspace_id', '=', input.workspaceId)` did.
- `updatedRows.length` counts the rows actually updated (rows returned by
  `RETURNING`), which is what `count` meant before.

**Verify** (types compile, and the old loop is gone):
```
npx tsc -b packages/core packages/server ; echo "tsc exit=$?"
grep -n "for (const message of messages)" packages/server/src/db/postgres-mail-read-ports.ts ; echo "grep exit=$?"
```
→ `tsc exit=0` with no errors; the `grep` prints nothing and `grep exit=1`
(the per-row loop over `messages` is removed; a `for` loop over `targets` remains,
which is fine).

### Step 3: Create the unit test

Create `tests/unit/postgres-mail-backfill-customer-links.test.ts` with exactly
this content. It fakes the query-builder chain (modeled on
`tests/unit/workflow-execution-jsonb.test.ts`) and asserts that N matched messages
produce exactly **one** `updateTable('email_messages')` call, and that the
returned `count` matches the rows the (faked) UPDATE returns.

```ts
import { createPostgresEmailMessageReadPort } from '../../packages/server/src';

// PERF-03 regression: backfillCustomerLinks must link all matched messages with
// ONE set-based UPDATE, not one UPDATE per row. We fake the query-builder chain
// and assert exactly one updateTable('email_messages') statement is issued for N
// matched messages, and that the returned count reflects the rows updated.

type Captured = {
  updateCalls: Array<{ table: string }>;
};

function fakeDb(options: {
  messages: Array<{ id: number; from_json: unknown }>;
  customers: Array<{ id: number; source_sqlite_id: number; email: string | null }>;
  updatedRows: Array<{ id: number }>;
  captured: Captured;
}) {
  const { messages, customers, updatedRows, captured } = options;

  const makeSelect = (table: string) => {
    const builder: Record<string, unknown> = {};
    builder.select = () => builder;
    builder.where = () => builder;
    builder.orderBy = () => builder;
    builder.limit = () => builder;
    builder.execute = async () => (table === 'customers' ? customers : messages);
    return builder;
  };

  const makeUpdate = (table: string) => {
    captured.updateCalls.push({ table });
    const builder: Record<string, unknown> = {};
    builder.from = () => builder;
    builder.set = () => builder;
    builder.where = () => builder;
    builder.whereRef = () => builder;
    builder.returning = () => builder;
    builder.execute = async () => updatedRows;
    builder.executeTakeFirst = async () => updatedRows[0];
    return builder;
  };

  const trx = {
    selectFrom: (table: string) => makeSelect(table),
    updateTable: (table: string) => makeUpdate(table),
  };

  return {
    db: {
      transaction: () => ({
        execute: async (cb: (t: typeof trx) => Promise<unknown>) => cb(trx),
      }),
    },
  };
}

const WORKSPACE_ID = '11111111-1111-4111-8111-111111111111';

function fromJson(address: string) {
  return { value: [{ address }] };
}

describe('backfillCustomerLinks issues a single set-based UPDATE', () => {
  test('links N matched messages with exactly one updateTable statement', async () => {
    const captured: Captured = { updateCalls: [] };
    const messages = [
      { id: 1, from_json: fromJson('alice@example.com') },
      { id: 2, from_json: fromJson('bob@example.com') },
      { id: 3, from_json: fromJson('carol@example.com') },
      { id: 4, from_json: fromJson('nomatch@example.com') },
    ];
    const customers = [
      { id: 10, source_sqlite_id: 100, email: 'alice@example.com' },
      { id: 20, source_sqlite_id: 200, email: 'bob@example.com' },
      { id: 30, source_sqlite_id: 300, email: 'carol@example.com' },
    ];
    // Three of the four messages match a customer.
    const updatedRows = [{ id: 1 }, { id: 2 }, { id: 3 }];

    const { db } = fakeDb({ messages, customers, updatedRows, captured });
    const port = createPostgresEmailMessageReadPort({
      db: db as never,
      applyWorkspaceSession: async () => {},
    });

    const result = await port.backfillCustomerLinks!({ workspaceId: WORKSPACE_ID });

    expect(result).toEqual({ count: 3 });
    const emailMessageUpdates = captured.updateCalls.filter((c) => c.table === 'email_messages');
    expect(emailMessageUpdates).toHaveLength(1);
  });

  test('returns { count: 0 } without any UPDATE when no sender matches a customer', async () => {
    const captured: Captured = { updateCalls: [] };
    const { db } = fakeDb({
      messages: [{ id: 1, from_json: fromJson('stranger@example.com') }],
      customers: [{ id: 10, source_sqlite_id: 100, email: 'alice@example.com' }],
      updatedRows: [],
      captured,
    });
    const port = createPostgresEmailMessageReadPort({
      db: db as never,
      applyWorkspaceSession: async () => {},
    });

    const result = await port.backfillCustomerLinks!({ workspaceId: WORKSPACE_ID });

    expect(result).toEqual({ count: 0 });
    expect(captured.updateCalls.filter((c) => c.table === 'email_messages')).toHaveLength(0);
  });
});
```

Why this passes:
- The unit project (`jest.config.cjs`) globs `tests/unit/**/*.test.(ts|tsx)` and
  maps `kysely` → `tests/setup/kysely-mock.ts`. The production code's
  `kyselySql\`…\`` and `kyselySql.ref(...)` resolve to the mock (both supported);
  the fake `.from/.set/.whereRef/.returning` ignore their arguments, so the raw
  fragments are never executed as SQL.
- `applyWorkspaceSession: async () => {}` skips the RLS session step, so the fake
  `trx` needs no executor.
- In test 1, three senders match → `targets.length === 3` → one `updateTable`
  call, and the faked UPDATE returns 3 rows → `count === 3`.
- In test 2, no sender matches → `targets.length === 0` → early
  `return { count: 0 }` **before** any `updateTable` call.

**Verify**:
```
pnpm test -- tests/unit/postgres-mail-backfill-customer-links.test.ts
```
→ both tests pass (2 passed).

### Step 4: Full gates

Run, in order:
```
pnpm install --frozen-lockfile
pnpm run build
pnpm run lint
pnpm test
pnpm run test:mail
```

**Verify**: each command exits 0 / reports all tests passing. If `pnpm run build`
is slow to iterate on, use `npx tsc -b packages/core packages/server` for a faster
server-only typecheck while fixing, then run the full `pnpm run build` once before
committing.

### Step 5: Commit

```
git add packages/server/src/db/postgres-mail-read-ports.ts \
        tests/unit/postgres-mail-backfill-customer-links.test.ts
git commit -m "perf(mail): link backfilled customers in one set-based UPDATE instead of per-row loop"
```

**Verify**: `git show --stat HEAD` lists only the two in-scope files (the
`plans/README.md` index update is a separate commit or amend per your workflow).

## Test plan

- **New test file**: `tests/unit/postgres-mail-backfill-customer-links.test.ts`
  (full content in Step 3). Cases:
  1. Happy path / the regression this plan fixes — N (=3 of 4) messages match a
     customer → the port issues exactly **one** `updateTable('email_messages')`
     statement and returns `{ count: 3 }`.
  2. Edge case — no sender matches any customer → returns `{ count: 0 }` and issues
     **zero** UPDATE statements (early return).
- **Structural pattern to model after**: `tests/unit/workflow-execution-jsonb.test.ts`
  (the `fakeDb(...)` / `db.transaction().execute(cb)` capture harness).
- **Existing backfill tests**: there is **no** existing unit test that exercises
  `backfillMessageCustomerLinks` directly. The route test in
  `tests/unit/server-edition-foundation.test.ts` ("server mail customer-link
  backfill route validates payload …") stubs the port and must keep passing
  unchanged; the SQLite-store test `tests/mail/email-crm-store.test.ts`
  (`backfillCustomerLinksForMessages`) is a different implementation and is
  unaffected.
- **Verification**: `pnpm test` → all pass, including the 2 new tests;
  `pnpm run test:mail` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `grep -n "for (const message of messages)" packages/server/src/db/postgres-mail-read-ports.ts` returns no match (the per-row loop is gone)
- [ ] `grep -n "\.from(kyselySql\`(values" packages/server/src/db/postgres-mail-read-ports.ts` returns exactly one match (the new set-based UPDATE)
- [ ] `npx tsc -b packages/core packages/server` exits 0 (and `pnpm run build` exits 0)
- [ ] `pnpm run lint` exits 0
- [ ] `pnpm test` exits 0; `tests/unit/postgres-mail-backfill-customer-links.test.ts` exists and its 2 tests pass
- [ ] `pnpm run test:mail` exits 0
- [ ] `git status` shows only the 2 in-scope files changed (plus `plans/README.md`)
- [ ] `plans/README.md` status row for plan 009 updated

## STOP conditions

Stop and report back (do not improvise) if:

- The drift check shows `packages/server/src/db/postgres-mail-read-ports.ts`
  changed since `f24fb27` and the loop at lines 2248–2269 no longer matches the
  verbatim "Current state" excerpt (someone else already refactored this
  function). Reconcile against the live code before editing.
- After Step 2, `npx tsc -b packages/core packages/server` reports a TypeScript
  error naming `kyselySql`, `linkRows`, `targets`, or the update chain, and it is
  not fixed by one obvious correction.
- The new test fails with `kyselySql.join is not a function` (or any
  `sql.<method> is not a function`) — that means the production code used a
  `kyselySql` method the unit-test mock does not provide. Use only the template
  tag and `kyselySql.ref` as written in Step 2; do **not** "fix" it by editing
  `tests/setup/kysely-mock.ts` (out of scope).
- The route test in `tests/unit/server-edition-foundation.test.ts` or any
  `tests/mail/*` test starts failing — the change should be behavior-preserving;
  a failure there means something outside this function was affected.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

For whoever owns this code next:

- **Parameter-count ceiling.** The single statement binds ~`3 × targets.length + 2`
  parameters. At the current cap of 5000 (`normalizeBackfillCustomerLinkLimit`
  → `Math.min(value, 5000)`) that is ~15002 params — comfortably under Postgres's
  65535 bound-parameter limit. **If that cap is ever raised above ~21000**, this
  statement would exceed the limit; at that point chunk `targets` into batches
  (e.g. 5000 rows) and run one UPDATE per batch, summing the counts.
- **The `customer_id IS NULL` guard is load-bearing.** It keeps the backfill from
  clobbering a link created concurrently between the SELECT and the UPDATE. Any
  future rewrite must keep it in the `WHERE`.
- **Interaction with `plans/007-*`** (remove inline `require('kysely')`): that plan
  may delete the local `const { sql: kyselySql } = require('kysely')` in this
  function in favor of the file's top-level `import { sql as kyselySql } from 'kysely'`
  (line 29). This plan's code only references the identifier `kyselySql`, so it
  works under either form — no coordination needed, but if both plans land, verify
  `kyselySql` still resolves (it does, from the top-level import).
- **What a reviewer should scrutinize**: (1) the `::bigint` casts remain on the
  first VALUES row (they set the derived column types); (2) the guard
  `email_messages.customer_id IS NULL` is present; (3) `count` is derived from the
  `RETURNING` rows (`updatedRows.length`), not from `targets.length` — those differ
  exactly when a row was linked concurrently.
- **No real-Postgres coverage.** The unit test uses a faked query builder (there is
  no Postgres in the test suite), so it proves "one statement, right count" but not
  that the SQL executes. The SQL was validated by compiling against Kysely `0.29.2`
  (the pinned version) to the statement shown in Step 2; if Kysely is upgraded,
  re-confirm the generated `UPDATE … FROM (VALUES …)` still compiles.
```
