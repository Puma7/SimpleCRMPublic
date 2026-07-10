# Plan 004: Reject invalid productId/reasonId in return items instead of silently dropping them

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`) —
> unless a reviewer dispatched you and told you they maintain the index (for
> this plan, the advisor maintains `plans/README.md`; do **not** create or edit
> it).
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- packages/server/src/api/returns-routes.ts tests/unit/returns-routes.test.ts tests/unit/returns-public-portal.test.ts`
> If any listed file changed since this plan was written (commit `f24fb27`),
> compare the "Current state" excerpts below against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The Returns API accepts line items each of which may link to a product
(`productId`) and a return reason (`reasonId`). When a client sends an
**invalid** id — a negative number, a non-integer, or a string like `"abc"` —
the server today does **not** reject it. Instead it silently discards the link
and creates the return as if the id were absent. That produces a return item
with no product/reason association even though the caller clearly intended one,
so downstream reporting (the "Retourengründe" analytics) and product-level
return tracking quietly lose data with no error surfaced to the caller. Every
other id field on the same request (top-level `customerId`, `emailMessageId`,
`jtlKauftrag`) correctly returns HTTP 400 on an invalid value; the per-item ids
are the sole exception. The same buggy parser also serves the **unauthenticated
public returns portal**, so an anonymous customer's typo is silently swallowed
there too. This plan makes an invalid per-item id return 400 (mirroring the
top-level fields), while a truly-absent id and a valid id keep working exactly
as before.

## Current state

Files involved (roles):

- `packages/server/src/api/returns-routes.ts` — all returns endpoints. Contains
  `parseItems` (the buggy per-item parser, shared by the authenticated create
  and the public portal create), the correct top-level `customerId` handling in
  `parseCreateBody`, and the shared helper `parseOptionalPositiveIntField`.
- `tests/unit/returns-routes.test.ts` — unit tests for the **authenticated**
  `handleReturnsRoute` (POST `/api/v1/returns`).
- `tests/unit/returns-public-portal.test.ts` — unit tests for the
  **unauthenticated** `handlePublicPortalRoute` (POST
  `/api/v1/portal/returns/:token`).

### The shared helper — three-way return value (`returns-routes.ts:429-433`)

```ts
function parseOptionalPositiveIntField(value: unknown, _fieldName: string): number | undefined | null {
  if (value === undefined || value === null) return null;                       // ABSENT
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value; // VALID
  return undefined;                                                             // INVALID
}
```

So the return value encodes three distinct outcomes: `null` = the field was
absent (or explicit JSON `null`), a positive `number` = a valid id, and
`undefined` = the field was **present but invalid** (negative, zero,
non-integer, or a non-number such as a string).

### The correct pattern — top-level `customerId` (`returns-routes.ts:264-267`, `:280`)

`parseCreateBody` uses the helper correctly: it 400s when the value is invalid
(`=== undefined` while the raw input was non-null), and treats `null` as absent.

```ts
  const customerId = parseOptionalPositiveIntField(body.customerId, 'customerId');
  if (customerId === undefined && body.customerId != null) {
    return { ok: false, code: 'invalid_customer_id', message: 'customerId muss eine positive Ganzzahl sein' };
  }
```

...and later, when building the input, `null` (absent) is dropped:

```ts
      ...(customerId === null ? {} : { customerId }),
```

`emailMessageId` (`:268-271`) and `jtlKauftrag` (`:272-275`) follow the same
shape, with codes `invalid_email_message_id` and `invalid_jtl_kauftrag`.

### The bug — `parseItems` collapses invalid into absent (`returns-routes.ts:355-363`)

```ts
    items.push({
      productId: parseOptionalPositiveIntField(raw.productId, 'productId') ?? undefined,
      reasonId: parseOptionalPositiveIntField(raw.reasonId, 'reasonId') ?? undefined,
      sku: nullableTrimmedString(raw.sku, MAX_TEXT_LEN),
      productName: nullableTrimmedString(raw.productName, MAX_TEXT_LEN),
      quantity: Math.floor(quantity),
      condition,
      notes: nullableTrimmedString(raw.notes, MAX_NOTES_LEN),
    });
```

The `?? undefined` collapses the helper's `null` (absent) **and** `undefined`
(invalid) into the same `undefined`, so an invalid id is accepted as "absent"
and the link is dropped with no 400. This is inside the `for (const raw of value)`
loop of `parseItems` (`returns-routes.ts:328-366`), whose surrounding validation
(quantity at `:339-342`, condition at `:343-354`) already returns
`{ ok: false, code, message }` on bad input — the same `ParseFailure` shape you
must return for the ids.

### Both call sites share `parseItems`

- Authenticated: `parseCreateBody` (`:261`) → `parseItems(body.items)` → used by
  `handleCreateReturn` → POST `/api/v1/returns`.
- Public/unauthenticated: `parsePortalCreateBody` (`:695`) →
  `parseItems(body.items)` → used by `handlePortalCreate` → POST
  `/api/v1/portal/returns/:token`.

Both funnel a `ParseFailure` straight to `error(400, parsed.code, parsed.message)`
(see `:208` and `:645`), so returning a `ParseFailure` from `parseItems` yields a
400 on **both** paths automatically.

### The target field type (`packages/server/src/api/types.ts:4358-4366`)

```ts
export type ReturnItemMutationInput = {
  productId?: number | null;
  reasonId?: number | null;
  ...
};
```

`productId`/`reasonId` are optional; the code currently emits `undefined` for
absent, and you must keep emitting `undefined` for absent so the existing
"normalized payload" test (below) stays green.

### Repo conventions to match

- **Parse-then-fail pattern**: parsing helpers return either a success object or
  a `ParseFailure = { ok: false; code: string; message: string }` (defined at
  `returns-routes.ts:254`). Bad input becomes a `ParseFailure`; the route turns
  it into `error(400, code, message)`. German user-facing messages, snake_case
  `code`. Mirror the top-level `invalid_customer_id` block exactly — do not
  invent a different validation style.
- **Error-code naming**: top-level id fields use `invalid_customer_id`,
  `invalid_email_message_id`, `invalid_jtl_kauftrag`. Use `invalid_product_id`
  and `invalid_reason_id` for the per-item ids — consistent with that scheme.
- **Test layout**: unit tests live in `tests/unit/*.test.ts`, import server code
  by relative path (e.g. `from '../../packages/server/src/api/returns-routes'`),
  and use `describe`/`test` + `expect`. The two exemplar files you will edit
  already exercise these exact handlers with hand-built fake ports — model your
  new tests on the tests already in them (the authenticated "rejects empty items
  and invalid quantities" test and the portal "POST without items responds 400"
  test are the closest structural matches).

## Commands you will need

| Purpose   | Command                                                                                               | Expected on success |
|-----------|-------------------------------------------------------------------------------------------------------|---------------------|
| Install   | `pnpm install --frozen-lockfile`                                                                      | exit 0              |
| Typecheck | `pnpm run build` (there is **no** `typecheck` script yet; the build's first step, `tsc -b packages/…`, type-checks the server package) | exit 0, no TS errors |
| Tests     | `pnpm test -- tests/unit/returns-routes.test.ts tests/unit/returns-public-portal.test.ts`             | all pass            |
| Full test | `pnpm test`                                                                                           | all pass            |
| Lint      | `pnpm run lint`                                                                                       | exit 0 (eslint, `--max-warnings 0`) |

Notes: CI runs on **Node 24** with pnpm (`.github/workflows/ci.yml`; steps:
`pnpm install --frozen-lockfile` → `pnpm run lint` → `pnpm test` → `pnpm run
build`). `pnpm test` runs jest; the `tests/unit/**` files run in the `unit`
project. Do **not** add any dependency — `pnpm install --frozen-lockfile` must
stay valid (the lockfile must not change). ts-jest type-checks the test files, so
`pnpm test` also catches type errors in the tests you add.

## Scope

**In scope** (the only files you may modify):

- `packages/server/src/api/returns-routes.ts` (modify — the `parseItems` fix)
- `tests/unit/returns-routes.test.ts` (modify — add the authenticated test)
- `tests/unit/returns-public-portal.test.ts` (modify — add the portal test)

**Out of scope** (do NOT touch, even though they look related):

- `parseOptionalPositiveIntField` (`returns-routes.ts:429-433`) — it already
  returns the correct three-way value (`null`/number/`undefined`). Do **not**
  change it; the bug is only in how `parseItems` consumes it.
- The top-level `customerId`/`emailMessageId`/`jtlKauftrag` blocks in
  `parseCreateBody` — they are already correct; you are copying their shape, not
  editing them.
- `packages/server/src/api/types.ts` — `ReturnItemMutationInput.productId?:
  number | null` already permits `undefined`; no type change is needed.
- `packages/server/src/db/postgres-returns-port.ts` and any DB layer — the fix is
  purely in the API parser.
- `package.json` / `pnpm-lock.yaml` — no new dependency.

## Git workflow

- Branch: `advisor/004-returns-item-id-validation` (create off `main`).
- Commit per logical unit; conventional-commit messages, e.g.
  `fix(returns): reject invalid item productId/reasonId instead of dropping the link`
  and `test(returns): cover invalid item id rejection on auth + portal paths`.
  (Example style from this repo's `git log`: `fix(review): keep raw-headers /
  .eml export out of the mail read bucket`.)
- Do **not** push or open a PR.

## Steps

### Step 1: Validate per-item `productId`/`reasonId` in `parseItems`

In `packages/server/src/api/returns-routes.ts`, inside the `for (const raw of
value)` loop of `parseItems`, insert two validation blocks **immediately before**
the `items.push({` call (i.e. after the existing `condition` / `INVALID` check at
`:348-354`), and change the two id lines in the pushed object to use the new
locals. The resulting loop body (from the condition check onward) should read:

```ts
    if (condition === 'INVALID') {
      return {
        ok: false,
        code: 'invalid_condition',
        message: `condition muss einer der Werte ${CONDITION_VALUES.join(', ')} oder null sein`,
      };
    }
    const productId = parseOptionalPositiveIntField(raw.productId, 'productId');
    if (productId === undefined && raw.productId != null) {
      return { ok: false, code: 'invalid_product_id', message: 'productId muss eine positive Ganzzahl sein' };
    }
    const reasonId = parseOptionalPositiveIntField(raw.reasonId, 'reasonId');
    if (reasonId === undefined && raw.reasonId != null) {
      return { ok: false, code: 'invalid_reason_id', message: 'reasonId muss eine positive Ganzzahl sein' };
    }
    items.push({
      productId: productId ?? undefined,
      reasonId: reasonId ?? undefined,
      sku: nullableTrimmedString(raw.sku, MAX_TEXT_LEN),
      productName: nullableTrimmedString(raw.productName, MAX_TEXT_LEN),
      quantity: Math.floor(quantity),
      condition,
      notes: nullableTrimmedString(raw.notes, MAX_NOTES_LEN),
    });
```

Why this is correct and behavior-preserving for the non-bug cases:

- **Invalid** (`raw.productId` is `"abc"`, `-5`, `0`, `1.5`, etc.): the helper
  returns `undefined` and `raw.productId != null` is true → returns a
  `ParseFailure` → the route emits 400. This is the fix.
- **Absent** (`raw.productId` is missing or JSON `null`): the helper returns
  `null`, the guard's `=== undefined` is false, so no error; then `null ??
  undefined` yields `undefined` — the exact value pushed today.
- **Valid** (a positive integer): the helper returns the number, no error, and
  `number ?? undefined` is the number — unchanged.

Do not alter `parseOptionalPositiveIntField`, the quantity check, or the
condition check. This mirrors the top-level `customerId` block at `:264-267`
(the redundant-looking `&& raw.productId != null` is kept for parity with that
exemplar and is harmless).

**Verify**: `pnpm run build` → exit 0 (server package type-checks; no TS errors).

### Step 2: Add the authenticated-path test

In `tests/unit/returns-routes.test.ts`, add a new `test(...)` inside the existing
`describe('handleReturnsRoute', ...)` block (place it right after the existing
`'POST /api/v1/returns rejects empty items and invalid quantities'` test at
`:240-263`). Use the file's existing helpers `makeReturnsPort`, `makeBaseRequest`,
and `ServerApiPorts` (already imported). It must assert both a 400 with the right
code **and** that the create port was never called for the invalid payloads, and
that valid + truly-absent ids still succeed:

```ts
  test('POST /api/v1/returns rejects an invalid item productId/reasonId instead of dropping the link', async () => {
    const harness = makeReturnsPort();
    const ports: ServerApiPorts = { auth: {} as never, returns: harness.port };

    const badProduct = await handleReturnsRoute(
      makeBaseRequest({ method: 'POST', body: { items: [{ quantity: 1, productId: 'abc' }] } }),
      ports,
    );
    expect(badProduct?.status).toBe(400);
    expect((badProduct?.body as { error: { code: string } }).error.code).toBe('invalid_product_id');

    const badReason = await handleReturnsRoute(
      makeBaseRequest({ method: 'POST', body: { items: [{ quantity: 1, reasonId: -5 }] } }),
      ports,
    );
    expect(badReason?.status).toBe(400);
    expect((badReason?.body as { error: { code: string } }).error.code).toBe('invalid_reason_id');

    // Neither invalid payload reached the create port.
    expect(harness.createCalls).toHaveLength(0);

    // Valid id forwarded; truly-absent id still normalizes to undefined.
    const ok = await handleReturnsRoute(
      makeBaseRequest({ method: 'POST', body: { items: [{ quantity: 1, productId: 5, reasonId: 3 }] } }),
      ports,
    );
    expect(ok?.status).toBe(201);
    expect(harness.createCalls).toHaveLength(1);
    expect(harness.createCalls[0]!.input.input.items).toEqual([
      { productId: 5, reasonId: 3, sku: null, productName: null, quantity: 1, condition: null, notes: null },
    ]);
  });
```

**Verify**: `pnpm test -- tests/unit/returns-routes.test.ts` → all pass
(including this new test).

### Step 3: Add the public-portal-path test

In `tests/unit/returns-public-portal.test.ts`, add a new `test(...)` inside the
existing `describe('public portal dispatcher', ...)` block (place it right after
the `'POST without items responds 400 (validation runs after token resolves)'`
test at `:141-153`). Reuse the file's `makeReturnsPort`, `makePortalSettings`,
`req`, `TOKEN`, and `WS_ID` helpers (all already defined). The file's
`beforeEach(resetPortalRateLimitersForTests)` (`:64-66`) already resets the rate
limiter, and two POSTs are well under the 10/hour create limit, so rate limiting
will not interfere:

```ts
  test('POST rejects an invalid item productId/reasonId (does not silently drop the link)', async () => {
    const ports: ServerApiPorts = {
      auth: {} as never,
      returns: makeReturnsPort(),
      returnsPortalSettings: makePortalSettings({ ok: true, workspaceId: WS_ID, enabled: true }),
    };

    const badProduct = await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}`, { method: 'POST', body: { items: [{ quantity: 1, productId: 'abc' }] } }),
      ports,
    );
    expect(badProduct?.status).toBe(400);
    expect((badProduct?.body as { error: { code: string } }).error.code).toBe('invalid_product_id');

    const badReason = await handlePublicPortalRoute(
      req(`/api/v1/portal/returns/${TOKEN}`, { method: 'POST', body: { items: [{ quantity: 1, reasonId: -5 }] } }),
      ports,
    );
    expect(badReason?.status).toBe(400);
    expect((badReason?.body as { error: { code: string } }).error.code).toBe('invalid_reason_id');
  });
```

**Verify**: `pnpm test -- tests/unit/returns-public-portal.test.ts` → all pass
(including this new test).

## Test plan

New tests (2 total, one per file), covering the bug on both call sites:

- `tests/unit/returns-routes.test.ts` (authenticated POST `/api/v1/returns`):
  - `productId: 'abc'` → 400 `invalid_product_id`.
  - `reasonId: -5` → 400 `invalid_reason_id`.
  - The create port is never called for either invalid payload.
  - Regression guard: `productId: 5, reasonId: 3` → 201, forwarded verbatim; and
    truly-absent ids still normalize to `undefined`.
  - Model after the existing `'POST /api/v1/returns rejects empty items and
    invalid quantities'` test.
- `tests/unit/returns-public-portal.test.ts` (unauthenticated POST
  `/api/v1/portal/returns/:token`):
  - `productId: 'abc'` → 400 `invalid_product_id`.
  - `reasonId: -5` → 400 `invalid_reason_id`.
  - Model after the existing `'POST without items responds 400'` test.

Do **not** modify the existing `'POST /api/v1/returns forwards a normalized
payload and audits the create'` test (`returns-routes.test.ts:265-313`): it uses
a valid `reasonId: 3` and absent `productId`, so it must stay green unchanged
after the fix. If it fails, the fix is wrong — see STOP conditions.

Verification: `pnpm test -- tests/unit/returns-routes.test.ts
tests/unit/returns-public-portal.test.ts` → all pass, including the 2 new tests.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm run build` exits 0 (server package type-checks; no TS errors).
- [ ] `pnpm test -- tests/unit/returns-routes.test.ts tests/unit/returns-public-portal.test.ts` passes; the 2 new tests exist and pass.
- [ ] `pnpm test` exits 0 (no existing test regressed — in particular the "normalized payload" test still passes).
- [ ] `pnpm run lint` exits 0.
- [ ] `grep -n "invalid_product_id\|invalid_reason_id" packages/server/src/api/returns-routes.ts` returns 2 matches (both new guards).
- [ ] `grep -n "parseOptionalPositiveIntField(raw.productId" packages/server/src/api/returns-routes.ts` no longer appears on the same line as `?? undefined` (the inline collapse is gone; it is now assigned to a local and validated first).
- [ ] `git status` shows only the 3 in-scope files changed (plus your `plans/README.md` status-row edit, unless the advisor owns it). `pnpm-lock.yaml` and `package.json` are unchanged.
- [ ] `plans/README.md` status row for plan 004 updated (unless a reviewer told you they maintain it).

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts — e.g.
  `parseItems` no longer contains the `?? undefined` inline lines, or
  `parseOptionalPositiveIntField` already returns something other than the
  three-way `null`/number/`undefined` (the codebase drifted since `f24fb27`).
- The existing `'POST /api/v1/returns forwards a normalized payload…'` test
  (`returns-routes.test.ts:265-313`) fails after your change — that means the
  absent/valid cases are no longer preserved; the fix must keep absent → `undefined`
  and valid → the number.
- Implementing the fix appears to require editing an out-of-scope file
  (`parseOptionalPositiveIntField`, `types.ts`, the DB port, or `package.json`).
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

For the human/agent who owns this code next:

- **Single choke point**: `parseItems` is the one parser shared by the
  authenticated create and the public portal create, so this one fix closes both
  paths. If a third caller of `parseItems` is added later, it inherits the
  validation for free — keep it that way rather than re-parsing ids at the new
  call site.
- **What a reviewer should scrutinize**: that absent (`null`/missing) still maps
  to `undefined` in the pushed item (not to `null`), matching
  `ReturnItemMutationInput` and the downstream DB port's expectations; and that
  the new codes `invalid_product_id`/`invalid_reason_id` follow the existing
  `invalid_*` scheme any API consumers may switch on.
- **Follow-up deliberately deferred**: this plan does not add server-side
  existence checks (that a given `productId`/`reasonId` actually exists in the
  workspace) — it only validates the id's *shape*. Referential validation, if
  wanted, belongs in the DB port, not the request parser, and is out of scope
  here to keep the change low-risk.
- **Typecheck**: once plan 002 adds a `pnpm run typecheck` script, swap the
  build-based typecheck in "Commands you will need" and "Done criteria" for it.
