# Plan 014: Decompose mail-routes.ts into a route table and per-resource handlers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`)
> — unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**:
> `git diff --stat f24fb27..HEAD -- packages/server/src/api/mail-routes.ts tests/unit/mail-route-table.test.ts`
> If `packages/server/src/api/mail-routes.ts` changed since this plan was
> written, compare the "Current state" excerpts against the live code before
> proceeding; on a mismatch (line numbers moved, dispatch order changed, new
> routes added), treat it as a STOP condition. `tests/unit/mail-route-table.test.ts`
> is created by this plan and is not expected to exist at `f24fb27`.

## Status

- **Priority**: P3
- **Effort**: L
- **Risk**: MED
- **Depends on**: none
- **Category**: tech-debt
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

`packages/server/src/api/mail-routes.ts` is 4701 LOC. Its entry point
`handleMailReadRoute` (line 208) dispatches every `/api/v1/email/…` request by
running 63 sequential, hand-written `if` blocks — 43 `/^…$/.exec(req.path)`
regexes plus 20 exact-string comparisons (`req.path === '…'`) — whose
**relative order is load-bearing**: exact-string routes such as
`/api/v1/email/messages/conversation` and `/api/v1/email/messages/backfill-customer-links`
must be tested *before* the catch-all `…/messages/:id` regex, or they would be
swallowed by it. Adding or reordering a route today means hand-auditing 62
blocks for accidental shadowing. The regex scan itself is microseconds — this is
a **maintainability** problem, not a performance one.

This plan replaces the hand-ordered `if` cascade with a single **ordered
declarative route table** iterated by a tiny in-file matcher. The array order
*is* the dispatch order, so the ordering contract becomes data you can read at a
glance instead of control flow you have to trace. Behavior is preserved
exactly; a new characterization test locks the ordering-sensitive cases so the
refactor is provably behavior-preserving.

Splitting the ~60 handler bodies out into `packages/server/src/api/email/*.ts`
per-resource modules is the natural next step, but it is a large, separate,
mechanical move; combining it with this dispatch rewrite in one change would
multiply review risk. **This plan is Stage 1 (the dispatcher). The file split is
explicitly deferred** — see "Scope · Out of scope" and "Maintenance notes".

## Current state

- `packages/server/src/api/mail-routes.ts` — the mail read-route dispatcher and
  all its handlers (4701 LOC).
  - `handleMailReadRoute(req, ports)` at **line 208** — the function to rewrite.
    Returns `Promise<ApiResponse | null>` (null = "not my route", the caller
    falls through to the next dispatcher).
  - Two of the 63 branches contain **inline** logic (auth + port + method
    dispatch) instead of delegating to a named handler. These must be extracted
    first (Step 2) so every table entry is uniform. They are:
    - `/api/v1/email/accounts` (lines 227–235) — GET lists, POST creates:
      ```ts
      if (req.path === '/api/v1/email/accounts') {
        const principal = requirePrincipal(req);
        if ('status' in principal) return principal;
        if (!ports.emailAccounts) return error(503, 'email_accounts_unavailable', 'Email account API nicht konfiguriert');
        if (req.method === 'POST') return handleEmailAccountCreate(req, ports, principal);
        if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
        const result = await ports.emailAccounts.list({ workspaceId: principal.workspaceId });
        return data(200, sanitizeEmailAccountList(result));
      }
      ```
    - `/api/v1/email/accounts/:id` (lines 269–281) — GET/PATCH/DELETE one account:
      ```ts
      const accountMatch = /^\/api\/v1\/email\/accounts\/([^/]+)$/.exec(req.path);
      if (accountMatch) {
        const principal = requirePrincipal(req);
        if ('status' in principal) return principal;
        const id = positiveIntFromPath(accountMatch[1]);
        if (id === null) return error(400, 'invalid_email_account_id', 'email account id muss eine positive Ganzzahl sein');
        if (!ports.emailAccounts) return error(503, 'email_accounts_unavailable', 'Email account API nicht konfiguriert');
        if (req.method === 'PATCH') return handleEmailAccountUpdate(req, ports, principal, id);
        if (req.method === 'DELETE') return handleEmailAccountDelete(ports, principal, id);
        if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
        const account = await ports.emailAccounts.get({ workspaceId: principal.workspaceId, id });
        return account ? data(200, sanitizeEmailAccount(account)) : error(404, 'email_account_not_found', 'Email account nicht gefunden');
      }
      ```
  - **Every other branch** already has the uniform shape "match → call one named
    handler", in one of three flavors:
    - Exact string, no args: `if (req.path === '/api/v1/email/folder-counts') return handleMailFolderCounts(req, ports);` (line 283)
    - Regex with one capture passed through: `const m = /^\/api\/v1\/email\/messages\/([^/]+)\/snooze$/.exec(req.path); if (m) return handleMessageSnooze(req, ports, m[1]);` (line 432)
    - Regex/string with a **literal** arg baked in: `if (req.path === '/api/v1/email/accounts/test-imap') return handleMailConnectionTest(req, ports, 'imap');` (line 237), and the three OAuth provider captures at lines 212/217/222 that pass `match[1]` as the provider.
  - **Two special tail branches**, in this exact order (lines 517–522):
    ```ts
    const metadata = await handleMailMetadataReadRoute(req, ports);
    if (metadata) return metadata;

    const messageMatch = /^\/api\/v1\/email\/messages\/([^/]+)$/.exec(req.path);
    if (!messageMatch) return null;
    return handleMessageGet(req, ports, messageMatch[1]);
    ```
    `handleMailMetadataReadRoute` is a **delegate**: call it, return its result
    if truthy, otherwise keep going. The generic `…/messages/:id` GET is the
    **last** entry; if nothing matches, the function returns `null`.
- **Ordering-sensitive collisions that MUST be preserved** (these are the whole
  point of the finding — the catch-all `…/messages/([^/]+)$` regex matches any
  single trailing segment, including literal words):
  - `/api/v1/email/messages/conversation` (line 311) — must precede the generic
    `…/messages/:id`.
  - `/api/v1/email/messages/backfill-customer-links` (line 303) — same.
  - The `handleMailMetadataReadRoute` delegate (line 517) — must stay after all
    explicit routes and before the generic `…/messages/:id` fallback.
  - The `…/scheduled-send/retry` (line 372) vs `…/scheduled-send` (line 377)
    pair, and the `…/security/check` (397) vs `…/security` (402) pair: these are
    `$`-anchored so they do not actually overlap, but **preserve their relative
    order anyway** — do not reason about which pairs "really" collide; just keep
    the array order identical to the source order.
- Shared helpers used by the dispatcher, already imported at the top of the file
  (lines 40–47): `data`, `error`, `positiveIntFromPath`, `requirePrincipal` from
  `./types`; `handleMailMetadataReadRoute` from `./mail-metadata-routes`. The
  sanitizers (`sanitizeEmailAccountList`, `sanitizeEmailAccount`) are defined
  later in this same file. You will not need new imports for Step 2 or Step 3.
- Repo convention for this dispatcher family: `packages/server/src/api/server-api.ts`
  chains one `handleXxxRoute(req, ports)` per domain, each returning
  `ApiResponse | null` and falling through on null (lines 90–132). `mail` is
  wired at `server-api.ts:111`: `const mail = await handleMailReadRoute(req, ports); if (mail) return mail;`. **Do not change the exported name or signature of `handleMailReadRoute`** — `server-api.ts` imports it by name (`server-api.ts:11`).
- Test convention: server API behavior is tested through the public entry point
  `createServerApi(ports).handle({ method, path, principal, query?, body? })`.
  The exemplar is `tests/unit/server-email-reporting-api.test.ts` — it builds a
  `ports` object with `auth` + `locks` plus the port under test, then asserts
  `response.status` and `(response.body as any).error.code`. Model the new test
  on it. These unit tests live in `tests/unit/**/*.test.ts` and are picked up by
  the default `jest` `unit` project (see `jest.config.cjs`).

## Commands you will need

| Purpose         | Command                                                             | Expected on success |
|-----------------|--------------------------------------------------------------------|---------------------|
| Install         | `pnpm install --frozen-lockfile`                                   | exit 0              |
| Typecheck/Build | `pnpm run build`                                                   | exit 0, no TS errors |
| Server-only TS  | `npx tsc -b packages/server` (faster; typechecks this package)    | exit 0, no errors   |
| Tests (all)     | `pnpm test`                                                        | all pass            |
| Tests (targeted)| `pnpm test -- tests/unit/mail-route-table.test.ts tests/unit/server-email-reporting-api.test.ts` | all pass |
| Lint            | `pnpm run lint`                                                    | exit 0 (0 warnings) |

There is **no** `typecheck` script in this repo yet; `pnpm run build` (which runs
`tsc -b packages/core packages/server packages/desktop`) is the authoritative
type-check for server code. `pnpm run test:mail` is **not required** for this
plan: the mail coverage ratchet (`jest.mail.config.cjs`) only collects coverage
from `electron/email/**`, and this change touches `packages/server/**` only.

## Scope

**In scope** (the only files you should modify):
- `packages/server/src/api/mail-routes.ts` — extract the two inline branches;
  add the route-table types, the table, and the matcher; rewrite
  `handleMailReadRoute`'s body to iterate the table.
- `tests/unit/mail-route-table.test.ts` (create) — characterization test.

**Out of scope** (do NOT touch, even though they look related):
- Splitting handler bodies into `packages/server/src/api/email/*.ts` modules —
  **deferred to a follow-on stage**; see "Maintenance notes". Doing it here
  balloons the diff and the review risk.
- `packages/server/src/api/mail-metadata-routes.ts` — the metadata dispatcher.
  It stays a delegate called from the table; do not restructure it.
- `packages/server/src/api/server-api.ts` — the wiring is correct; the exported
  name/signature of `handleMailReadRoute` must not change.
- Any handler's **behavior**: error codes, status codes, German messages, auth
  order, port-availability checks, and the exact route order must all be
  byte-for-byte preserved. This is a pure structural refactor.
- The `EMAIL_OAUTH_APP_KEYS` credential-key map (lines 52–67) — it holds config
  *key names*, not secrets; leave it untouched.

## Git workflow

- Branch: `advisor/014-decompose-mail-routes`
- Commit per step (Steps 1–3), conventional-commit style. Examples matching this
  repo's log: `test(mail): characterize mail read-route dispatch ordering`,
  `refactor(mail): extract inline email-account branches into handlers`,
  `refactor(mail): dispatch mail read routes via ordered table`.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Add a characterization test that locks the ordering-sensitive dispatch

Create `tests/unit/mail-route-table.test.ts`. This runs **before** any
refactoring so it is green against the current `if`-cascade and stays green
after. It proves the two true collisions resolve correctly, plus a broad sample
of routes reach a handler at all (not the 404 fallthrough).

Build a `ports` object exactly like the exemplar
(`tests/unit/server-email-reporting-api.test.ts`, lines 108–130): a helper that
returns `{ auth: authPort(), locks: {} as ServerApiPorts['locks'], ...overrides }`.
Import `createServerApi` and the types from `../../packages/server/src`. Use a
`principal = { userId: 'u1', workspaceId: 'w1', role: 'owner' as const }`.

Assert the following, which are **verified against the code at `f24fb27`**:

- `GET /api/v1/email/messages/conversation` with a principal and **no**
  `emailMessages` port → `status === 503`, `error.code === 'email_messages_unavailable'`.
  (If this route were shadowed by the generic `…/messages/:id`, it would instead
  return `400 invalid_email_message_id`, because `positiveIntFromPath('conversation')`
  is `null`. This assertion is the ordering lock.)
- `POST /api/v1/email/messages/backfill-customer-links` with a principal and no
  `emailMessages` port → `status === 503`, `error.code === 'email_messages_unavailable'`.
  (If shadowed by the generic GET handler, a POST returns `405 method_not_allowed`.)
- `GET /api/v1/email/reporting` with a principal and no `emailReporting` port →
  `status === 503`, `error.code === 'email_reporting_unavailable'` (mirrors the
  existing exemplar test, confirms non-`messages` routes still dispatch).
- A `GET /api/v1/email/messages/5/tags` (a metadata sub-route) with a principal
  and no metadata ports returns a non-404 status (it is handled by the
  `handleMailMetadataReadRoute` delegate, proving the delegate still runs). Do
  **not** hard-code its exact code; assert `response.status !== 404`.
- **Record-and-lock the rest**: pick ~8 more representative paths across the
  resource groups (one OAuth `…/oauth/google/app`, one account sub-route
  `…/accounts/5/sync`, one bulk `…/messages/bulk/archive`, one compose
  `…/compose/send`, one scheduled-send `…/messages/5/scheduled-send`, one
  attachment `…/attachments/5`, the generic `…/messages/5`, and the account
  collection `…/accounts`). For each, run it against the **current** code once,
  observe the actual `{status, error.code}`, and encode those observed values as
  the expected assertions. You are locking today's behavior, not inventing it.

Keep every assertion driven through `createServerApi(...).handle(...)` — do not
import the internal handlers (they are not exported).

**Verify**: `pnpm test -- tests/unit/mail-route-table.test.ts` → all assertions
pass against the **unmodified** dispatcher. Commit.

### Step 2: Extract the two inline `accounts` branches into named handlers

So every dispatch branch becomes "match → one handler call", add two module-level
functions next to the other `handleEmailAccount*` handlers (near line 1183), then
replace the inline blocks with calls to them. Move the code verbatim — no logic
change.

```ts
async function handleEmailAccountsCollection(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.emailAccounts) return error(503, 'email_accounts_unavailable', 'Email account API nicht konfiguriert');
  if (req.method === 'POST') return handleEmailAccountCreate(req, ports, principal);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const result = await ports.emailAccounts.list({ workspaceId: principal.workspaceId });
  return data(200, sanitizeEmailAccountList(result));
}

async function handleEmailAccountItem(
  req: ApiRequest,
  ports: ServerApiPorts,
  rawId: string | undefined,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  const id = positiveIntFromPath(rawId);
  if (id === null) return error(400, 'invalid_email_account_id', 'email account id muss eine positive Ganzzahl sein');
  if (!ports.emailAccounts) return error(503, 'email_accounts_unavailable', 'Email account API nicht konfiguriert');
  if (req.method === 'PATCH') return handleEmailAccountUpdate(req, ports, principal, id);
  if (req.method === 'DELETE') return handleEmailAccountDelete(ports, principal, id);
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const account = await ports.emailAccounts.get({ workspaceId: principal.workspaceId, id });
  return account ? data(200, sanitizeEmailAccount(account)) : error(404, 'email_account_not_found', 'Email account nicht gefunden');
}
```

Then, inside `handleMailReadRoute`, replace the inline block at lines 227–235
with `if (req.path === '/api/v1/email/accounts') return handleEmailAccountsCollection(req, ports);`
and the block at lines 269–281 with:
```ts
const accountMatch = /^\/api\/v1\/email\/accounts\/([^/]+)$/.exec(req.path);
if (accountMatch) return handleEmailAccountItem(req, ports, accountMatch[1]);
```
Leave all other branches exactly as they are for now.

**Verify**: `npx tsc -b packages/server` → exit 0; `pnpm run lint` → exit 0;
`pnpm test -- tests/unit/mail-route-table.test.ts tests/unit/server-email-reporting-api.test.ts`
→ all pass (behavior unchanged). Commit.

### Step 3: Replace the `if`-cascade with an ordered route table + matcher

At the top of `mail-routes.ts` (after the imports, before `handleMailReadRoute`),
add the matcher types and helper:

```ts
type MailRouteHandler = (
  req: ApiRequest,
  ports: ServerApiPorts,
  params: string[],
) => Promise<ApiResponse>;

type MailRouteEntry =
  | { kind: 'route'; pattern: RegExp; handler: MailRouteHandler }
  | { kind: 'delegate'; delegate: (req: ApiRequest, ports: ServerApiPorts) => Promise<ApiResponse | null> };
```

Build the ordered table `const MAIL_ROUTES: readonly MailRouteEntry[] = [ … ]`
by transcribing **every** branch of the current `handleMailReadRoute` body
(lines 212–522) **top to bottom, one entry each, in the exact same order**.
Conversion rules — apply mechanically:

- **Exact-string branch** → `{ kind: 'route', pattern: /^<path>$/, handler: (req, ports) => handleX(req, ports) }`. Regex-escape the `/` as `\/`. Example:
  `if (req.path === '/api/v1/email/folder-counts') return handleMailFolderCounts(req, ports);`
  becomes
  `{ kind: 'route', pattern: /^\/api\/v1\/email\/folder-counts$/, handler: (req, ports) => handleMailFolderCounts(req, ports) },`
- **Regex branch, capture passed through** → reuse the same regex; pass `params[0]`:
  `{ kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)\/snooze$/, handler: (req, ports, params) => handleMessageSnooze(req, ports, params[0]) },`
- **Branch with a literal arg** → bake the literal into the closure:
  `{ kind: 'route', pattern: /^\/api\/v1\/email\/accounts\/test-imap$/, handler: (req, ports) => handleMailConnectionTest(req, ports, 'imap') },`
  and the three OAuth entries pass the captured provider: `handler: (req, ports, params) => handleEmailOAuthApp(req, ports, params[0])`.
- **The two extracted branches from Step 2** →
  `{ kind: 'route', pattern: /^\/api\/v1\/email\/accounts$/, handler: (req, ports) => handleEmailAccountsCollection(req, ports) },`
  and (at the original position, after the `inbox-archive-recovery` entry)
  `{ kind: 'route', pattern: /^\/api\/v1\/email\/accounts\/([^/]+)$/, handler: (req, ports, params) => handleEmailAccountItem(req, ports, params[0]) },`
- **The metadata delegate** (original lines 517–518) →
  `{ kind: 'delegate', delegate: (req, ports) => handleMailMetadataReadRoute(req, ports) },`
  placed at its original position (after the `…/attachments/:id` entry, before
  the generic `…/messages/:id` entry).
- **The generic fallback** (original lines 520–522) is the **last** entry:
  `{ kind: 'route', pattern: /^\/api\/v1\/email\/messages\/([^/]+)$/, handler: (req, ports, params) => handleMessageGet(req, ports, params[0]) },`

Then replace the entire body of `handleMailReadRoute` with the table walk:

```ts
export async function handleMailReadRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  for (const entry of MAIL_ROUTES) {
    if (entry.kind === 'delegate') {
      const result = await entry.delegate(req, ports);
      if (result) return result;
      continue;
    }
    const match = entry.pattern.exec(req.path);
    if (match) return entry.handler(req, ports, match.slice(1));
  }
  return null;
}
```

This reproduces the current semantics exactly: first matching `route` wins; a
`delegate` returns its result if truthy else falls through; if nothing matches,
return `null`. Do not add, drop, merge, or reorder entries relative to the
source; do not change any handler.

Sanity self-check before verifying: the original body has **43 regex (`.exec`)
branches + 20 exact-string (`req.path ===`) branches + 1 metadata delegate**, so
the table should have **exactly 63 `route` entries and exactly 1 `delegate`
entry** (64 total). Confirm with:
`grep -c "\.exec(req\.path)" ` (=43) and `grep -c "req\.path ===" ` (=20) on the
*original* `handleMailReadRoute` body before you rewrite it. If your table count
differs from 63+1, you dropped, merged, or duplicated a branch — re-diff against
the original body.

**Verify**:
- `npx tsc -b packages/server` → exit 0.
- `pnpm run lint` → exit 0.
- `pnpm test -- tests/unit/mail-route-table.test.ts tests/unit/server-email-reporting-api.test.ts`
  → all pass (the Step-1 characterization test proves ordering is preserved).
- `pnpm run build` → exit 0.
- `pnpm test` → all pass.
Commit.

## Test plan

- **New file** `tests/unit/mail-route-table.test.ts` (Step 1), modeled
  structurally on `tests/unit/server-email-reporting-api.test.ts`. Cases:
  - Ordering lock A: `GET …/messages/conversation` (no `emailMessages` port) →
    `503 email_messages_unavailable` (not `400 invalid_email_message_id`).
  - Ordering lock B: `POST …/messages/backfill-customer-links` (no
    `emailMessages` port) → `503 email_messages_unavailable` (not `405`).
  - Metadata delegate still runs: `GET …/messages/5/tags` → `status !== 404`.
  - Non-`messages` route still dispatches: `GET …/reporting` →
    `503 email_reporting_unavailable`.
  - ~8 recorded-and-locked representative routes across OAuth / account
    sub-routes / bulk / compose / scheduled-send / attachments / generic
    `messages/:id` / account collection.
- No existing test is deleted or weakened. `tests/unit/server-email-reporting-api.test.ts`
  is an additional regression signal (it already drives `handleMailReadRoute`).
- Verification: `pnpm test` → all pass, including the new test file. The new
  test must be green in Step 1 (before refactor) and remain green in Step 3.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm run build` exits 0 (server type-checks clean).
- [ ] `pnpm run lint` exits 0 (0 warnings).
- [ ] `pnpm test` exits 0; `tests/unit/mail-route-table.test.ts` exists and passes.
- [ ] `handleMailReadRoute` no longer contains a chain of `if`/`.exec` branches:
      `grep -c "\.exec(req.path)" packages/server/src/api/mail-routes.ts` returns a
      count reflecting only the `MAIL_ROUTES` regexes as *data* (no `.exec(` calls
      remain inside `handleMailReadRoute` except the single one in the loop body).
- [ ] The `MAIL_ROUTES` table has 63 `route` entries and 1 `delegate` entry
      (from 43 regex + 20 exact-string branches + 1 delegate in the original).
- [ ] The exported name/signature of `handleMailReadRoute` is unchanged
      (`git diff f24fb27 -- packages/server/src/api/server-api.ts` is empty).
- [ ] No files outside the in-scope list are modified (`git status`).
- [ ] `plans/README.md` status row for plan 014 updated.

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts — e.g.
  `handleMailReadRoute` is not at line 208, the two inline `accounts` blocks are
  gone or restructured, or new `/api/v1/email/…` routes exist that this plan does
  not enumerate (the codebase drifted since `f24fb27`).
- The Step-1 characterization test cannot be made green against the *unmodified*
  code (means your `ports` setup or expected codes are wrong — do not proceed to
  refactor on a red baseline).
- After Step 3, the characterization test or any existing test that was passing
  now fails — the route order or a handler binding was changed. Revert Step 3 and
  re-transcribe; do not "fix" tests to match new behavior.
- Your `MAIL_ROUTES` count is not 63 routes + 1 delegate and you cannot reconcile
  it against the original branch list.
- Completing the change appears to require editing any out-of-scope file
  (`server-api.ts`, `mail-metadata-routes.ts`, a handler's behavior).

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **The array order of `MAIL_ROUTES` is the routing contract.** When adding a
  route, insert it at the position that preserves precedence — any exact-string
  or more-specific route that could be shadowed by `…/messages/([^/]+)$` (or any
  other broad `([^/]+)` capture) must appear **above** it. The characterization
  test in `tests/unit/mail-route-table.test.ts` guards the known collisions; add
  a new assertion there whenever you add a route that competes with an existing
  pattern.
- **A reviewer should scrutinize**: that the table is a faithful, order-preserving
  transcription of the old cascade (diff the old function against the table
  entry-by-entry), that no handler body changed, and that the 62+1 count holds.
- **Deferred follow-on (Stage 2, a separate plan):** split the ~60 handler bodies
  out of `mail-routes.ts` into per-resource modules under
  `packages/server/src/api/email/` (e.g. `accounts-routes.ts`,
  `messages-routes.ts`, `compose-routes.ts`, `attachments-routes.ts`,
  `oauth-routes.ts`, `security-routes.ts`). Recommended safe order for that work:
  (1) move a resource's handlers + their private sanitizers into a new module and
  re-export them; (2) update the corresponding `MAIL_ROUTES` closures to import
  from the new module; (3) verify build+lint+test after **each** resource. Because
  Stage 1 already funnels all dispatch through the table, Stage 2 only moves
  function bodies and adjusts imports — the table entries barely change. Shared
  helpers (`data`, `error`, `positiveIntFromPath`, `requirePrincipal`) already
  live in `./types` and can be imported by the new modules. Watch for sanitizers
  currently private to `mail-routes.ts` that become shared across modules; hoist
  those into a small `email/sanitizers.ts`. This was deferred to keep the
  dispatch rewrite reviewable on its own.
