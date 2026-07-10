# Plan 005: Guard the email list load against stale/racing responses

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
> `git diff --stat f24fb27..HEAD -- src/components/email/hooks/use-email-messages.ts tests/unit/use-email-messages-stale-load.test.tsx`
> If any listed file changed since this plan was written (commit `f24fb27`),
> compare the "Current state" excerpts below against the live code before
> proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The mail workspace loads the message list by awaiting an IPC/HTTP round-trip
(`invokeRenderer(IPCChannels.Email.ListMessagesByView, …)` or `SearchMessages`)
and then calling `setMessages(list)`. The load effect re-fires on **eight**
inputs (account, view, category, search, sort, list-filter, done-filter, and the
`loadMessages` identity). When a user switches account/view faster than a
request completes, an **earlier** request can resolve **after** a later one and
overwrite the list with the wrong account's messages. Nothing checks that the
in-flight request is still the current one, and there is no `AbortController`.
The primary load path does **not** schedule the 800 ms silent reconcile (only
the optimistic mutation paths do), so the stale list persists until the user
navigates again. The result is a user briefly (or lastingly) seeing account A's
mail under account B — a correctness bug and a data-confidentiality surprise in
a shared-inbox app. This plan makes the **latest-started** load always win,
regardless of the order in which the network responses arrive, and adds a
regression test that reproduces the out-of-order race.

## Current state

Files involved (roles):

- `src/components/email/hooks/use-email-messages.ts` — the `useEmailMessages`
  hook. Owns the `messages` state, the `loadMessages` callback (the awaited
  load), and the `useEffect` that fires `loadMessages` whenever the workspace
  inputs change. This is the **only** file with the bug.
- `src/components/email/workspace-context.tsx` — provides `useMailWorkspace()`,
  which returns `selectedAccountId`, `mailView`, `categoryFilterId`,
  `searchQuery`, `selectedMessage`, `setSelectedMessage`, `listSortMode`,
  `messageListFilter`, `messageDoneFilter`, `bumpCategoryAssignmentRevision`.
  The hook reads all of these. (Read-only context for this plan; not modified.)
- `src/services/transport` (module, imported as `@/services/transport`) —
  exports `invokeRenderer(channel, payload)`, the IPC/HTTP transport the hook
  awaits. Mocked in the test.
- `tests/unit/use-email-messages-stale-load.test.tsx` — **new** regression test
  (create in Step 2).

### The refs block — where the new counter goes (`use-email-messages.ts:65-78`)

```ts
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedMessageIdRef = useRef<number | null>(null)
  const messagesRef = useRef<EmailMessage[]>([])
  const offsetRef = useRef(0)
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const loadMessagesRef = useRef<(
    accountScope: MailAccountScope,
    view: MailView,
    catId: number | null,
    query: string,
    sort: MessageListSortMode,
    listFilter: MessageListFilter,
    opts?: LoadMessagesOpts,
  ) => Promise<void>>(async () => {})
```

The file already uses `useRef` extensively for cross-call bookkeeping
(`offsetRef`, `reconcileTimerRef`, `messagesRef`, …). The fix follows that same
convention — a `useRef` request counter — rather than introducing an
`AbortController` (the transport takes no abort signal, so a counter is the
lighter, in-idiom choice).

### The buggy load — awaits then writes unconditionally (`use-email-messages.ts:172-286`)

```ts
  const loadMessages = useCallback(
    async (
      accountScope: MailAccountScope,
      view: MailView,
      catId: number | null,
      query: string,
      sort: MessageListSortMode,
      listFilter: MessageListFilter,
      opts?: LoadMessagesOpts,
    ) => {
      const append = opts?.append ?? false
      const silent = opts?.silent ?? false
      const offset = append ? offsetRef.current : silent ? 0 : 0
      const keepId = opts?.preserveSelection ? selectedMessageIdRef.current ?? undefined : undefined
      if (append) setLoadingMore(true)
      else if (!silent) setLoadingMessages(true)
      try {
        let list: EmailMessage[]
        const doneFilter = view === "inbox" ? messageDoneFilter : undefined
        if (query.trim() && view !== "trash") {
          const res = await invokeRenderer(IPCChannels.Email.SearchMessages, {
            /* …payload… */
          }) as { messages: EmailMessage[]; searchMode: "fts" | "like" | "regex"; hasMore?: boolean }
          list = res.messages
          if (!silent) {
            /* …searchMode toasts… */
          }
          setHasMore(Boolean(res.hasMore))
        } else {
          list = await invokeRenderer(IPCChannels.Email.ListMessagesByView, {
            /* …payload… */
          }) as EmailMessage[]
          setHasMore(list.length >= PAGE_SIZE)
        }
        if (append) {
          /* …merge-append into prev… */
        } else if (silent && keepId != null) {
          /* …silent reconcile merge… */
        } else {
          setMessages(list)          // <-- line 252: unconditional overwrite; the bug
          offsetRef.current = list.length
        }
        /* …selection bookkeeping… */
      } catch (e) {
        logError("use-email-messages: load", e)
        if (!silent) toast.error("Nachrichten konnten nicht geladen werden.")
      } finally {
        setLoadingMessages(false)
        setLoadingMore(false)
      }
    },
    [setSelectedMessage, messageDoneFilter, selectMessageById],
  )
```

The two `await invokeRenderer(...)` calls are the only suspension points. After
either resolves there is **no** check that this invocation is still the current
one before `setMessages`, `setHasMore`, the searchMode toast, and (in `finally`)
the loading-flag resets run.

### The effect that re-fires the load on eight inputs (`use-email-messages.ts:292-315`)

```ts
  useEffect(() => {
    offsetRef.current = 0
    if (selectedAccountId != null) {
      void loadMessages(
        selectedAccountId,
        mailView,
        categoryFilterId,
        debouncedSearchQ,
        listSortMode,
        messageListFilter,
      )
    } else {
      setMessages([])
    }
  }, [
    selectedAccountId,
    mailView,
    categoryFilterId,
    debouncedSearchQ,
    listSortMode,
    messageListFilter,
    messageDoneFilter,
    loadMessages,
  ])
```

There is **no cleanup function** here, so switching account does not cancel the
prior in-flight `loadMessages`; both requests stay live and race. This is the
mechanism the regression test exploits.

### Repo test convention — exemplar to copy

Hook tests live in `tests/unit/` and use `renderHook` from
`@testing-library/react`, mocking transport and any context via `jest.mock`.
Model the new test on `tests/unit/use-deal-products.test.tsx`
(`tests/unit/use-deal-products.test.tsx:1-40`):

```ts
import { renderHook, waitFor } from '@testing-library/react';
import { useDealProducts } from '@/hooks/useDealProducts';
import { IPCChannels } from '@shared/ipc/channels';

const mockInvokeRenderer = jest.fn();
jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
}));
```

Note the jest hoisting rule already relied on there: a `jest.mock` factory may
only reference outer variables whose names begin with `mock`, and it must read
them **inside a function** (called later), never at factory-eval time. Follow
that exactly (`mockInvokeRenderer`, `mockWorkspace`).

`sonner` is mocked as an object in several suites — e.g.
`tests/unit/export-button.test.tsx:15`. The hook calls `toast.error`,
`toast.info`, and `toast.success`, so mock all three.

`MailAccountScope` is `number | 'all'` (`shared/mail-account-scope.ts:2`);
account ids in the test are plain numbers.

## Commands you will need

| Purpose   | Command                                                                 | Expected on success        |
|-----------|-------------------------------------------------------------------------|----------------------------|
| Install   | `pnpm install --frozen-lockfile`                                        | exit 0                     |
| Typecheck | `npx tsc -p tsconfig.json --noEmit`                                     | exit 0, no errors          |
| Test (new)| `pnpm test -- tests/unit/use-email-messages-stale-load.test.tsx`        | all pass (the new suite)   |
| Test (all)| `pnpm test`                                                             | all pass                   |
| Lint      | `pnpm run lint`                                                         | exit 0 (eslint, 0 warnings)|
| Build     | `pnpm run build`                                                        | exit 0                     |

Notes:
- This repo runs tests with **jest** (see `package.json` `"test": "jest --passWithNoTests"`),
  invoked via **pnpm** in CI (`.github/workflows/ci.yml`). The new test file is
  under `tests/unit/`, which the jest `unit` project matches
  (`jest.config.cjs` → `testMatch: ['<rootDir>/tests/unit/**/*.test.(ts|tsx)']`,
  `testEnvironment: 'jsdom'`).
- There is **no** `typecheck` npm script yet (a later plan, 002, adds one). Until
  then, type-check with `npx tsc -p tsconfig.json --noEmit`.
- `pnpm run test:mail` (jest config `jest.mail.config.cjs`) only matches
  `tests/mail/**` and covers the **electron main-process** mail modules; it does
  **not** exercise this renderer hook and is **not** a required gate for this
  plan. Do not add the new test under `tests/mail/`.

## Suggested executor toolkit

(No special skills required. Standard Edit + jest workflow.)

## Scope

**In scope** (the only files you should modify):
- `src/components/email/hooks/use-email-messages.ts`
- `tests/unit/use-email-messages-stale-load.test.tsx` (create)

**Out of scope** (do NOT touch, even though they look related):
- `src/components/email/workspace-context.tsx` — the context is correct; the fix
  is entirely inside the hook. Changing the context risks the whole mail UI.
- The silent-reconcile logic (`scheduleSilentReconcile`, the `silent && keepId`
  merge branch), the append/`loadMore` merge, and the selection bookkeeping —
  keep their behavior. The request-id guard is additive; do not rewrite these.
- Any change to IPC channels, payload shapes, or `src/services/transport` — the
  transport intentionally takes no abort signal; the counter approach needs none.
- `plans/README.md` — the advisor maintains the index; do not create or edit it.

## Git workflow

- Branch: `advisor/005-email-list-stale-load-guard` (create from `main` at `f24fb27`).
- Commit style: conventional commits, matching `git log` (e.g.
  `fix(mail): guard email list load against stale/racing responses`). One commit
  for the fix + test is fine; or one per step.
- Do **not** push or open a PR (no operator instruction to do so).

## Steps

### Step 1: Add a request-id guard to `loadMessages`

All edits are in `src/components/email/hooks/use-email-messages.ts`. The idea:
every call to `loadMessages` claims a monotonically increasing sequence number;
after each `await`, and in `catch`/`finally`, it bails (or skips state writes) if
its sequence number is no longer the latest. Because the load effect always
starts a new call after the old one, the **latest-started** call is the only one
allowed to touch state — so a stale earlier response can never overwrite a newer
one, no matter the resolve order.

**1a. Declare the counter ref.** Immediately after the `offsetRef` declaration
(`use-email-messages.ts:68`), add:

```ts
  const offsetRef = useRef(0)
  const loadSeqRef = useRef(0)
```

**1b. Claim a sequence number at the top of `loadMessages`.** Just after the
`keepId` line (currently `use-email-messages.ts:185`) and before the
`if (append) setLoadingMore(true)` line, add:

```ts
      const keepId = opts?.preserveSelection ? selectedMessageIdRef.current ?? undefined : undefined
      const requestSeq = ++loadSeqRef.current
      if (append) setLoadingMore(true)
```

**1c. Bail after the search-branch await.** Change (currently at
`use-email-messages.ts:205-206`):

```ts
          list = res.messages
          if (!silent) {
```

to:

```ts
          list = res.messages
          if (requestSeq !== loadSeqRef.current) return
          if (!silent) {
```

**1d. Bail after the list-branch await.** Change (currently at
`use-email-messages.ts:227-228`):

```ts
          }) as EmailMessage[]
          setHasMore(list.length >= PAGE_SIZE)
```

to:

```ts
          }) as EmailMessage[]
          if (requestSeq !== loadSeqRef.current) return
          setHasMore(list.length >= PAGE_SIZE)
```

**1e. Guard the catch toast and the finally resets.** Change (currently at
`use-email-messages.ts:277-283`):

```ts
      } catch (e) {
        logError("use-email-messages: load", e)
        if (!silent) toast.error("Nachrichten konnten nicht geladen werden.")
      } finally {
        setLoadingMessages(false)
        setLoadingMore(false)
      }
```

to:

```ts
      } catch (e) {
        logError("use-email-messages: load", e)
        if (!silent && requestSeq === loadSeqRef.current) {
          toast.error("Nachrichten konnten nicht geladen werden.")
        }
      } finally {
        if (requestSeq === loadSeqRef.current) {
          setLoadingMessages(false)
          setLoadingMore(false)
        }
      }
```

Why the `finally` is guarded: a bare `return` inside `try` still runs `finally`.
If a stale call cleared `loadingMessages`/`loadingMore`, it would hide the
spinner while the newer, still-in-flight call is loading. Only the current call
resets the flags. (The `logError` call stays unguarded — logging a stale
failure is harmless; only the user-facing toast is suppressed for stale calls.)

Leave every other branch (`append` merge, `silent && keepId` reconcile, the
`setMessages(list)` else, and the selection bookkeeping) exactly as-is — the two
new `return` guards sit *before* them, so they only ever run for the current call.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0, no errors. Then
`pnpm run lint` → exit 0.

### Step 2: Add the regression test

Create `tests/unit/use-email-messages-stale-load.test.tsx` with the content
below. It renders `useEmailMessages`, starts a load for account 1, switches to
account 2 (starting a second load), then resolves the **account-2** (later)
response first and the **account-1** (earlier) response last — the out-of-order
race. The list must end as account 2's data.

```tsx
import { renderHook, act, waitFor } from '@testing-library/react';
import { IPCChannels } from '@shared/ipc/channels';
import { useEmailMessages } from '@/components/email/hooks/use-email-messages';

// --- transport mock: return a deferred promise per ListMessagesByView call,
// keyed by the account id in the payload, so the test controls resolve order.
const mockInvokeRenderer = jest.fn();
const listDeferreds = new Map<number, (value: unknown) => void>();

jest.mock('@/services/transport', () => ({
  invokeRenderer: (...args: unknown[]) => mockInvokeRenderer(...args),
}));

jest.mock('sonner', () => ({
  toast: Object.assign(jest.fn(), {
    error: jest.fn(),
    info: jest.fn(),
    success: jest.fn(),
  }),
}));

// --- workspace mock: a single mutable object read at call time (name starts
// with `mock` so the jest.mock factory may close over it).
const mockWorkspace: Record<string, unknown> = {
  selectedAccountId: 1,
  mailView: 'inbox',
  categoryFilterId: null,
  searchQuery: '',
  selectedMessage: null,
  setSelectedMessage: jest.fn(),
  listSortMode: 'date_desc',
  messageListFilter: 'all',
  messageDoneFilter: 'open',
  bumpCategoryAssignmentRevision: jest.fn(),
};

jest.mock('@/components/email/workspace-context', () => ({
  useMailWorkspace: () => mockWorkspace,
}));

describe('useEmailMessages — stale/racing list load', () => {
  beforeEach(() => {
    mockInvokeRenderer.mockReset();
    listDeferreds.clear();
    mockWorkspace.selectedAccountId = 1;
    // Every ListMessagesByView call returns a promise the test resolves later,
    // keyed by the account id in the payload.
    mockInvokeRenderer.mockImplementation((channel: unknown, payload: any) => {
      if (channel === IPCChannels.Email.ListMessagesByView) {
        return new Promise((resolve) => {
          listDeferreds.set(payload.accountId as number, resolve);
        });
      }
      // GetMessage / anything else the hook may call during selection.
      return Promise.resolve(null);
    });
  });

  test('the later-started load wins even if the earlier one resolves last', async () => {
    const { result, rerender } = renderHook(() => useEmailMessages());

    // Account 1's load is now in flight (pending deferred).
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));

    // User switches to account 2 -> a second load starts, also pending.
    act(() => {
      mockWorkspace.selectedAccountId = 2;
    });
    rerender();
    await waitFor(() => expect(listDeferreds.has(2)).toBe(true));

    // Account 2 (the later request) resolves FIRST.
    await act(async () => {
      listDeferreds.get(2)!([{ id: 20 } as unknown]);
    });
    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toEqual([20]),
    );

    // Account 1 (the earlier request) resolves LAST — it is stale and must NOT
    // overwrite account 2's list.
    await act(async () => {
      listDeferreds.get(1)!([{ id: 10 } as unknown]);
    });

    expect(result.current.messages.map((m) => m.id)).toEqual([20]);
  });

  test('a normal single load still populates the list', async () => {
    const { result } = renderHook(() => useEmailMessages());
    await waitFor(() => expect(listDeferreds.has(1)).toBe(true));

    await act(async () => {
      listDeferreds.get(1)!([{ id: 1 }, { id: 2 }] as unknown[]);
    });

    await waitFor(() =>
      expect(result.current.messages.map((m) => m.id)).toEqual([1, 2]),
    );
    expect(result.current.loadingMessages).toBe(false);
  });
});
```

Key points if something misbehaves:
- The hook casts the IPC result to `EmailMessage[]` and, on the primary path,
  calls `setMessages(list)` directly, so minimal `{ id }` objects are sufficient
  message shapes for this test.
- `searchQuery` is `''`, so the hook takes the `ListMessagesByView` branch (not
  `SearchMessages`) — the primary load path named in the finding.
- `mockWorkspace` is mutated then `rerender()`ed; the mocked `useMailWorkspace`
  returns the same object reference, so the hook re-reads the new
  `selectedAccountId` and the load effect re-fires (the effect has no cleanup, so
  account 1's request stays pending — that is the race being tested).
- Do not use fake timers; the debounce timer only re-sets `debouncedSearchQ` to
  the same `''` value and never triggers an extra load.

**Verify**: `pnpm test -- tests/unit/use-email-messages-stale-load.test.tsx` →
both tests pass.

### Step 3: Confirm the guard is what makes it pass (sanity check, optional)

Temporarily revert only the two `return` guards from Step 1c/1d, re-run
`pnpm test -- tests/unit/use-email-messages-stale-load.test.tsx`, and confirm the
first test now **fails** (messages end as `[10]`). Re-apply the guards so the
test passes again. This proves the test actually exercises the bug rather than
passing vacuously. (Skip if you are confident; the Done criteria do not require
it.)

**Verify**: with guards applied, `pnpm test -- tests/unit/use-email-messages-stale-load.test.tsx` → both pass.

## Test plan

- New file: `tests/unit/use-email-messages-stale-load.test.tsx`, modeled
  structurally on `tests/unit/use-deal-products.test.tsx`.
- Cases:
  1. **Out-of-order race (the regression):** account-2 (later) load resolves
     first, account-1 (earlier) load resolves last; the final list is account
     2's `[20]`, never `[10]`.
  2. **Happy path:** a single account-1 load populates `[1, 2]` and clears
     `loadingMessages`.
- Verification: `pnpm test -- tests/unit/use-email-messages-stale-load.test.tsx`
  → all pass (2 new tests). Then the full suite `pnpm test` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0 (no type errors).
- [ ] `pnpm run lint` exits 0 (eslint, `--max-warnings 0`).
- [ ] `pnpm test -- tests/unit/use-email-messages-stale-load.test.tsx` passes; the
      two new tests exist and pass.
- [ ] `pnpm test` exits 0 (no existing suite regressed).
- [ ] `pnpm run build` exits 0.
- [ ] `git grep -n "loadSeqRef" src/components/email/hooks/use-email-messages.ts`
      shows the declaration plus the guards (i.e. the fix is present).
- [ ] `git status --porcelain` shows only
      `src/components/email/hooks/use-email-messages.ts` and
      `tests/unit/use-email-messages-stale-load.test.tsx` changed — no other files.
- [ ] `plans/README.md` status row for plan 005 updated **only if** the advisor
      did not tell you they maintain it (for this plan, they do — leave it).

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the cited locations does not match the "Current state" excerpts —
  e.g. `loadMessages` no longer calls `setMessages(list)` unconditionally in the
  else branch, the load effect gained a cleanup/abort, or the line anchors moved
  substantially (the file drifted since `f24fb27`).
- `useMailWorkspace` no longer returns the fields the hook destructures, or the
  hook's import path for it changed — the test mock would then be wrong.
- After applying Step 1, the first regression test still fails (messages end as
  `[10]`) — that means the guard is not on the actual write path; re-read the
  branch structure rather than adding more guards blindly.
- Any verification command fails twice after a reasonable fix attempt.
- The fix appears to require touching an out-of-scope file (e.g.
  `workspace-context.tsx` or `src/services/transport`).

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **Reviewer focus:** confirm the two `return` guards sit *after* each
  `await invokeRenderer(...)` and *before* any `setMessages`/`setHasMore`/toast,
  and that `finally` only resets the loading flags for the current sequence. A
  guard placed too late (after `setMessages`) would not fix the bug; too early
  (before the await) would be a no-op.
- **Interactions:** any future refactor that splits `loadMessages` into separate
  functions per branch, adds pagination prefetch, or introduces an
  `AbortController` on the transport must preserve the "latest-started wins"
  invariant. If an `AbortController` is later added to `invokeRenderer`, it can
  supersede the counter — but until then the counter is the source of truth.
- **Deferred out of this plan:** the silent-reconcile scheduling gap noted in the
  audit (the primary load path does not schedule the 800 ms reconcile) is *not*
  fixed here — the request-id guard already prevents the stale overwrite, so the
  reconcile is unnecessary for correctness on this path. If a product decision
  later wants the primary path to also reconcile, that is a separate change.
- The `loadSeqRef` counter is process-lifetime monotonic and never reset; at
  ~2^53 loads it would overflow `Number` precision — not a practical concern.
