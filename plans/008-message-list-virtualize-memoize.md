# Plan 008: Virtualize and memoize the email message list

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
> `git diff --stat f24fb27..HEAD -- src/components/email/message-list.tsx src/components/email/message-row.tsx tests/unit/message-row.test.tsx package.json pnpm-lock.yaml`
> If any listed file changed since this plan was written (commit `f24fb27`),
> compare the "Current state" excerpts below against the live code before
> proceeding; on a mismatch, treat it as a STOP condition. (`message-row.tsx`
> and `message-row.test.tsx` do not exist yet — you create them here.)

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The mail message list (`src/components/email/message-list.tsx`) renders every
loaded row with heavy inline JSX (an expand `Button`, a `Checkbox`, priority
dots, attachment/lock badges, a draggable row body) directly inside
`visibleMessages.map(...)`. There is no `React.memo` boundary per row and no
windowing — the whole list lives in a Radix `ScrollArea`, so **all** rows stay
mounted in the DOM. The page grows without bound: `PAGE_SIZE = 100`
(`src/components/email/hooks/use-email-messages.ts:16`) and the "Weitere laden"
button appends another 100 rows each press, so a busy mailbox reaches several
hundred mounted rows. Because the row JSX is inline and the per-render helpers
`selectableIds` (a `filter().map()` every render) and `accountLabel` (an
`accounts.find()` per row) are recomputed on every render, a single selection
toggle, thread expand, or "mark seen" re-runs the render work for **every** row
and keeps hundreds of DOM nodes live. On large folders this makes selection and
scrolling visibly janky.

After this plan: each row is an isolated `React.memo` component that only
re-renders when *its own* inputs change; the list is windowed with
`@tanstack/react-virtual` so only the visible rows (plus a small overscan) are
mounted; and the derived arrays are memoized so the stable callbacks that feed
the memoized rows keep a stable identity. Toggling one row's selection then
re-renders one row and touches a bounded number of DOM nodes instead of the
whole list.

## Current state

Files involved (roles):

- `src/components/email/message-list.tsx` — the `MessageList` component. Owns the
  list render, selection state (`selectedIds`), thread expand state
  (`expandedThreads`, `threadChildren`), the `scrollToMessageId` effect, and the
  `visibleMessages.map(...)` that renders every row inline. **This is the file
  the finding is about; most edits happen here.**
- `src/components/email/message-row.tsx` — **new** file (created in Step 3): the
  extracted, `React.memo`-wrapped single-row component.
- `src/components/email/hooks/use-email-messages.ts` — the `useEmailMessages`
  hook; defines `PAGE_SIZE = 100` (line 16) and appends on `loadMore`. **Read-only
  context for this plan; not modified** (its excerpt below is background only).
- `src/components/email/types.ts` — exports `EmailMessage`, `EmailAccount`,
  `formatMessageFrom`, `formatFrom`, `ConversationLockRecord`. Imported by the new
  row file; not modified.
- `src/components/ui/scroll-area.tsx` — the shared Radix `ScrollArea` wrapper.
  **Out of scope** (see Scope); the list stops using it (reason in Step 4).
- `tests/unit/message-row.test.tsx` — **new** unit test (created in Step 5).

### The two hot per-render helpers the finding names (`message-list.tsx:160-213`)

```tsx
  const showAccount = isAllAccountsScope(selectedAccountId)
  const accountLabel = (id: number) =>
    accounts.find((a) => a.id === id)?.display_name ?? `Konto ${id}`
```

```tsx
  const isMessageSelectable = (m: EmailMessage) =>
    mailView === "drafts" || mailView === "scheduled_send"
      ? m.uid < 0 && m.folder_kind === "draft"
      : m.uid >= 0 || Boolean(m.pop3_uidl)

  const selectableIds = visibleMessages.filter(isMessageSelectable).map((m) => m.id)
```

`accountLabel` runs `accounts.find(...)` once per rendered row (via
`accountLabel(m.account_id)` at line 818). `selectableIds` rebuilds a fresh array
on **every** render, and — critically — it is a dependency of the `toggleCheckbox`
and `toggleAllLoaded` `useCallback`s (`message-list.tsx:224-260`):

```tsx
  const toggleCheckbox = useCallback(
    (id: number, checked: boolean, shiftKey: boolean) => {
      /* … uses selectableIds.indexOf / .slice … */
    },
    [selectableIds, toggleOne],
  )
```

Because `selectableIds` is a new array each render, `toggleCheckbox` also gets a
new identity each render. Passing that callback into a `React.memo` row would
defeat the memo (the prop reference changes every render). **Memoizing
`selectableIds` (Step 2) is therefore a prerequisite for the row memo (Step 3) to
actually help** — do the steps in order.

### Already-memoized derived data you must NOT duplicate (`message-list.tsx:133-159`)

`visibleMessages` and `threadGroups` are already `useMemo`d — reuse them, do not
recompute:

```tsx
  const visibleMessages = useMemo(() => {
    if (listDisplayMode !== "thread") return messages
    /* … dedupe by threadKey … */
    return out
  }, [messages, listDisplayMode])
  // …
  const threadGroups = useMemo(() => {
    const map = new Map<string, EmailMessage[]>()
    for (const m of messages) { /* … group by threadKey … */ }
    return map
  }, [messages])
```

### The `scrollToMessageId` effect — DOM query today (`message-list.tsx:171-178`)

```tsx
  useEffect(() => {
    if (scrollToMessageId == null) return
    const el = document.querySelector(`[data-message-id="${scrollToMessageId}"]`)
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ block: "nearest" })
      onScrolledToMessage?.()
    }
  }, [scrollToMessageId, messages, onScrolledToMessage])
```

This uses `querySelector('[data-message-id="…"]')`. **Once rows are windowed, the
target row may not be mounted**, so the query returns `null` and the scroll never
happens. Step 4 rewrites this to use the virtualizer's `scrollToIndex`. Note the
current semantics: `onScrolledToMessage?.()` is called **only when the element is
found** — so an unmatched id stays pending and retries when `messages` changes.
Preserve that (only clear when the target index is found). `data-message-id` is
referenced **only** inside this file (verified: the effect above + the row button
at line 720); nothing external depends on it.

### The inline row map — what gets extracted (`message-list.tsx:635-845`)

The render region (verified excerpt, structure only):

```tsx
      <ScrollArea className="flex-1">
        {loading ? ( /* Loader2 spinner */ ) : visibleMessages.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Keine Nachrichten.</p>
        ) : (
          <ul className="divide-y">
            {selectableIds.length > 0 ? (
              <li className="flex items-center gap-2 border-b bg-muted/20 px-3 py-1.5">
                {/* "select all loaded" Checkbox + "Auswahl" DropdownMenu */}
              </li>
            ) : null}
            {visibleMessages.map((m) => {
              const isDraft = m.folder_kind === "draft"
              const blocked = !!m.outbound_hold
              const unread = !m.seen_local && m.uid >= 0
              const open = mailView === "inbox" && !m.done_local && m.uid >= 0
              const active = selectedMessage?.id === m.id
              const canSelect = isMessageSelectable(m)
              const checked = selectedIds.has(m.id)
              const tKey = threadKey(m)
              const threadIdForExpand = m.thread_id?.trim() ?? ""
              const localSiblings = threadGroups.get(tKey) ?? []
              const hasLocalSiblings = localSiblings.length > 1
              const isThreadRoot =
                listDisplayMode === "thread" && (threadIdForExpand.length > 0 || hasLocalSiblings)
              const expanded = expandedThreads.has(tKey)
              const children = threadChildren[tKey] ?? (expanded ? localSiblings : [])
              const lock = conversationLocks[m.id]
              const lockOwner = lock?.displayName?.trim() || lock?.email?.trim() || lock?.userId
              return (
                <li key={m.id}>
                  {/* thread-expand Button | spacer, Checkbox | spacer, and the
                     draggable <button data-message-id={m.id}> with the grid of
                     from-line / date / subject / snoozed-until / account label,
                     then the expanded-children buttons */}
                </li>
              )
            })}
          </ul>
        )}
        {hasMore && !loading && !searchQuery.trim() ? (
          <div className="border-t p-2">
            <Button /* "Weitere laden" -> loadMore?.() */ />
          </div>
        ) : null}
      </ScrollArea>
```

The two helper functions defined at module scope in this file:
`threadKey(m)` (`message-list.tsx:75-90`) and `formatListDateTime(iso)`
(`message-list.tsx:92-103`). `threadKey` stays (still used by the two memos and
by the parent per-row computation). `formatListDateTime` is used **only** inside
the row/children JSX (verified: lines 801, 813, 838) — Step 3 moves it into the
new row file.

The drag handler on the row body reads `selectedIds` and `visibleMessages`
(`message-list.tsx:723-735`):

```tsx
                      onDragStart={(e) => {
                        if (m.uid < 0 || bulkBusy) return
                        const dragIds =
                          selectedIds.has(m.id) && selectedIds.size > 1
                            ? visibleMessages
                                .filter((vm) => selectedIds.has(vm.id) && vm.uid >= 0)
                                .map((vm) => vm.id)
                            : [m.id]
                        setMailDragData(e.dataTransfer, dragIds)
                      }}
```

`selectedIds` is a `Set` that changes identity on every toggle, so it must **not**
be passed as a row prop (that would break the memo for every row). Step 3 replaces
this with a stable `buildDragIds(id)` callback that reads refs.

### The thread-expand click — inline async closure (`message-list.tsx:670-690`)

```tsx
                        onClick={async (e) => {
                          e.stopPropagation()
                          const next = new Set(expandedThreads)
                          if (expanded) next.delete(tKey)
                          else {
                            next.add(tKey)
                            if (!threadChildren[tKey] && threadIdForExpand) {
                              const rows = await invokeRenderer(IPCChannels.Email.ListThreadMessages, {
                                threadId: threadIdForExpand,
                                limit: 50,
                              })
                              if (Array.isArray(rows)) {
                                setThreadChildren((prev) => ({ ...prev, [tKey]: rows as EmailMessage[] }))
                              }
                            }
                          }
                          setExpandedThreads(next)
                        }}
```

This closure captures `expandedThreads`, `threadChildren`, `expanded`, `tKey`,
`threadIdForExpand`. Step 3 lifts it to a stable `toggleThreadExpand(tKey,
threadIdForExpand)` `useCallback` that reads `expandedThreads`/`threadChildren`
via refs (so its deps are `[]` and its identity never changes).

### Background: PAGE_SIZE and append (`hooks/use-email-messages.ts:16`, read-only)

```ts
const PAGE_SIZE = 100
```

`loadMore` calls `loadMessages(..., { append: true })`, which concatenates the
next page onto `messages` (`hooks/use-email-messages.ts:230-235`). This is why the
list grows unbounded; do not change it — virtualization is what makes an unbounded
list cheap.

### Repo conventions to match

- **Memoized/extracted components exist elsewhere but no `React.memo` is used yet**
  in `src/` (verified: `grep -rn "React.memo" src` → none). You are introducing the
  first one; that is fine — `React` is already imported for hooks. Use the named
  form `React.memo(function MessageRow(props) { … })` so the component shows a name
  in React DevTools and stack traces.
- **Component test convention**: unit/component tests live in `tests/unit/` as
  `*.test.tsx`, run under the jest `unit` project (`jsdom`), and use
  `@testing-library/react`. Model the new test on
  `tests/unit/kanban-card.test.tsx` (`tests/unit/kanban-card.test.tsx:1-83`): plain
  `render(<Component {...props} />)` + `screen.getByText/getByRole`, mocking any
  portal-based Radix child (Select/DropdownMenu) with `jest.mock`. `MessageRow`
  needs none of those mocks — it only uses `Button`, `Checkbox`, and lucide icons,
  which render inline in jsdom.
- **`@tanstack` is already in the dependency tree** (`@tanstack/react-router`,
  `@tanstack/react-table` — `package.json:99-100`), so adding
  `@tanstack/react-virtual` is in-ecosystem.

## Commands you will need

| Purpose        | Command                                                          | Expected on success         |
|----------------|------------------------------------------------------------------|-----------------------------|
| Install        | `pnpm install --frozen-lockfile`                                 | exit 0                      |
| Add dependency | `pnpm add @tanstack/react-virtual`                               | exit 0; updates lockfile    |
| Typecheck      | `npx tsc -p tsconfig.json --noEmit`                              | exit 0, no errors           |
| Test (new)     | `pnpm test -- tests/unit/message-row.test.tsx`                   | all pass (the new suite)    |
| Test (all)     | `pnpm test`                                                      | all pass                    |
| Lint           | `pnpm run lint`                                                  | exit 0 (eslint, 0 warnings) |
| Build          | `pnpm run build`                                                 | exit 0                      |

Notes:
- This repo runs tests with **jest** (`package.json` → `"test": "jest
  --passWithNoTests"`), invoked via **pnpm** in CI (`.github/workflows/ci.yml`).
  The new test lands in `tests/unit/`, which the jest `unit` project matches
  (`jest.config.cjs` → `testMatch: ['<rootDir>/tests/unit/**/*.test.(ts|tsx)']`,
  `testEnvironment: 'jsdom'`).
- There is **no** `typecheck` npm script yet (a later plan, 002, adds one). Until
  then, type-check with `npx tsc -p tsconfig.json --noEmit`.
- `pnpm run test:mail` covers the **electron main-process** mail modules
  (`jest.mail.config.cjs`, matches `tests/mail/**`). It does **not** exercise this
  renderer component and is **not** a required gate for this plan. Do not add the
  new test under `tests/mail/`.
- `pnpm add` rewrites `pnpm-lock.yaml`. **Commit the updated lockfile** — CI runs
  `pnpm install --frozen-lockfile` and fails if `package.json` and the lockfile
  disagree.

## Suggested executor toolkit

- `@tanstack/react-virtual` docs for the `useVirtualizer` API (dynamic row
  measurement via `measureElement`, `scrollToIndex`): https://tanstack.com/virtual/latest
  Read the "Dynamic" / "fixed" examples before Step 4 — the row heights vary
  (expanded threads are taller), so measurement matters.
- Standard Edit + jest workflow otherwise.

## Scope

**In scope** (the only files you should modify or create):
- `src/components/email/message-list.tsx` (modify)
- `src/components/email/message-row.tsx` (create)
- `tests/unit/message-row.test.tsx` (create)
- `package.json` (modify — adds `@tanstack/react-virtual`)
- `pnpm-lock.yaml` (modify — regenerated by `pnpm add`)

**Out of scope** (do NOT touch, even though they look related):
- `src/components/email/hooks/use-email-messages.ts` — pagination/append behavior
  is correct; virtualization makes the long list cheap without changing the data
  layer. Do not change `PAGE_SIZE` or the append merge.
- `src/components/ui/scroll-area.tsx` — a **shared** primitive used across the app.
  The list stops importing it (Step 4 uses a native scroll `<div>`), but do not
  modify the primitive itself.
- `src/components/email/workspace-context.tsx` and `src/components/email/types.ts`
  — read-only here; the row consumes their exports unchanged.
- `src/components/email/mail-shell.tsx` — the only consumer of `<MessageList>`
  (`mail-shell.tsx:403`); its props (`scrollToMessageId`, `onScrolledToMessage`,
  etc.) do **not** change, so this file needs no edits. If you find yourself
  wanting to change its props, STOP — the public interface must stay the same.
- `plans/README.md` — the advisor maintains the index; do not create or edit it.

## Git workflow

- Branch: `advisor/008-message-list-virtualize-memoize` (create from `main` at `f24fb27`).
- Commit style: conventional commits, matching `git log` (e.g.
  `perf(mail): virtualize and memoize the email message list`). One commit per
  step, or one for the whole change, is fine.
- Do **not** push or open a PR (no operator instruction to do so).

## Steps

Do the steps in order. Steps 2 and 3 are behavior-preserving refactors that leave
the list fully working (still `.map()`, still `ScrollArea`); Step 4 is the one
behavioral change (windowing). This ordering keeps the app runnable after every
step.

### Step 1: Add the `@tanstack/react-virtual` dependency

Run `pnpm add @tanstack/react-virtual`. Confirm it lands in `package.json`
`dependencies` (a `3.x` version — the stable line, compatible with the repo's
React 19). Do not hand-edit `pnpm-lock.yaml`; let `pnpm` generate it.

**Verify**: `git diff package.json` shows `@tanstack/react-virtual` added under
`dependencies`, and `pnpm install --frozen-lockfile` → exit 0 (lockfile and
manifest agree). If `pnpm add` reports an **unmet React peer dependency** for
React 19, STOP and report (see STOP conditions).

### Step 2: Memoize `selectableIds`, `isMessageSelectable`, and `accountLabel`

All edits in `src/components/email/message-list.tsx`. Behavior is unchanged; only
identities stabilize.

**2a. Wrap `isMessageSelectable` in `useCallback`.** Replace (`message-list.tsx:205-208`):

```tsx
  const isMessageSelectable = (m: EmailMessage) =>
    mailView === "drafts" || mailView === "scheduled_send"
      ? m.uid < 0 && m.folder_kind === "draft"
      : m.uid >= 0 || Boolean(m.pop3_uidl)
```

with:

```tsx
  const isMessageSelectable = useCallback(
    (m: EmailMessage) =>
      mailView === "drafts" || mailView === "scheduled_send"
        ? m.uid < 0 && m.folder_kind === "draft"
        : m.uid >= 0 || Boolean(m.pop3_uidl),
    [mailView],
  )
```

**2b. Memoize `selectableIds`.** Replace (`message-list.tsx:210`):

```tsx
  const selectableIds = visibleMessages.filter(isMessageSelectable).map((m) => m.id)
```

with:

```tsx
  const selectableIds = useMemo(
    () => visibleMessages.filter(isMessageSelectable).map((m) => m.id),
    [visibleMessages, isMessageSelectable],
  )
```

**2c. Memoize `accountLabel`.** Replace (`message-list.tsx:161-162`):

```tsx
  const accountLabel = (id: number) =>
    accounts.find((a) => a.id === id)?.display_name ?? `Konto ${id}`
```

with:

```tsx
  const accountLabel = useCallback(
    (id: number) => accounts.find((a) => a.id === id)?.display_name ?? `Konto ${id}`,
    [accounts],
  )
```

`useCallback` and `useMemo` are already imported (`message-list.tsx:3`).

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0. `pnpm run lint` → exit 0.
`pnpm run build` → exit 0. The list still renders identically (no runtime change).

### Step 3: Extract a `React.memo` row into `src/components/email/message-row.tsx`

Create `src/components/email/message-row.tsx`. Move `formatListDateTime`
(`message-list.tsx:92-103`) into it and export the memoized `MessageRow`. The
component must render exactly what the current `<li>` body renders
(`message-list.tsx:657-843`), but driven entirely by props (no `useMailWorkspace`,
no `selectedIds`, no `threadGroups`) so the shallow prop compare is meaningful.

Target file shape:

```tsx
"use client"

import React from "react"
import { ChevronDown, Lock, Paperclip } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { cn } from "@/lib/utils"
import { setMailDragData } from "./mail-drag"
import {
  formatFrom,
  formatMessageFrom,
  type ConversationLockRecord,
  type EmailAccount,
  type EmailMessage,
  type MailView,
} from "./types"

/** Compact date+time so the column stays readable when the list pane is narrow. */
export function formatListDateTime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export type MessageRowProps = {
  message: EmailMessage
  accounts: EmailAccount[]
  active: boolean
  checked: boolean
  canSelect: boolean
  bulkBusy: boolean
  unread: boolean
  open: boolean
  isDraft: boolean
  blocked: boolean
  showAccount: boolean
  accountLabelText: string
  mailView: MailView
  isThreadRoot: boolean
  expanded: boolean
  /** Sibling/thread rows to show when expanded; a STABLE empty array when not. */
  childrenRows: EmailMessage[]
  lock: ConversationLockRecord | undefined
  tKey: string
  threadIdForExpand: string
  onOpen: (m: EmailMessage) => void | Promise<void>
  onToggleCheckbox: (id: number, checked: boolean, shiftKey: boolean) => void
  onToggleExpand: (tKey: string, threadIdForExpand: string) => void
  buildDragIds: (id: number) => number[]
}

export const MessageRow = React.memo(function MessageRow({
  message: m,
  accounts,
  active,
  checked,
  canSelect,
  bulkBusy,
  unread,
  open,
  isDraft,
  blocked,
  showAccount,
  accountLabelText,
  mailView,
  isThreadRoot,
  expanded,
  childrenRows,
  lock,
  tKey,
  threadIdForExpand,
  onOpen,
  onToggleCheckbox,
  onToggleExpand,
  buildDragIds,
}: MessageRowProps) {
  const lockOwner = lock?.displayName?.trim() || lock?.email?.trim() || lock?.userId
  return (
    <div className="border-b">
      <div
        className={cn(
          "flex w-full items-start gap-1 transition-colors hover:bg-muted/60",
          active && "bg-muted",
        )}
      >
        {isThreadRoot ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="mt-2 h-6 w-6 shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              void onToggleExpand(tKey, threadIdForExpand)
            }}
          >
            <ChevronDown
              className={cn("h-4 w-4 transition-transform", expanded && "rotate-180")}
            />
          </Button>
        ) : (
          <div className="w-6 shrink-0" />
        )}
        {canSelect ? (
          <div className="flex shrink-0 items-center py-3 pl-2">
            <Checkbox
              checked={checked}
              disabled={bulkBusy}
              onCheckedChange={(v) => onToggleCheckbox(m.id, v === true, false)}
              aria-label={`Nachricht ${m.id} auswählen`}
              onClick={(e) => {
                e.stopPropagation()
                if (e.shiftKey) {
                  e.preventDefault()
                  onToggleCheckbox(m.id, true, true)
                }
              }}
            />
          </div>
        ) : (
          <div className="w-8 shrink-0" />
        )}
        <button
          type="button"
          data-message-id={m.id}
          draggable={m.uid >= 0 && !bulkBusy}
          disabled={bulkBusy}
          onDragStart={(e) => {
            if (m.uid < 0 || bulkBusy) return
            setMailDragData(e.dataTransfer, buildDragIds(m.id))
          }}
          onClick={(e) => {
            if (bulkBusy) return
            if (canSelect && (e.shiftKey || e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              if (e.shiftKey) onToggleCheckbox(m.id, true, true)
              else onToggleCheckbox(m.id, !checked, false)
              return
            }
            void onOpen(m)
          }}
          className="min-w-0 flex-1 px-2 py-2.5 text-left disabled:cursor-not-allowed disabled:opacity-60"
        >
          {/* COPY the inner grid VERBATIM from message-list.tsx:751-822
             (the priority dot, from-line, Paperclip/Lock badges + date,
             subject, snoozed-until, and the account label). Two substitutions:
               - formatMessageFrom(m, accounts)  ->  keep as-is (accounts is a prop)
               - {accountLabel(m.account_id)}     ->  {accountLabelText}
             lockOwner is computed above; keep the Lock aria-label using it. */}
        </button>
      </div>
      {expanded && childrenRows.length > 0
        ? childrenRows
            .filter((c) => c.id !== m.id)
            .map((c) => (
              <button
                key={c.id}
                type="button"
                className="flex w-full border-t border-muted/40 py-2 pl-12 pr-3 text-left text-xs hover:bg-muted/40"
                onClick={() => void onOpen(c)}
              >
                <span className="truncate font-medium">{formatFrom(c.from_json)}</span>
                <span className="mx-2 text-muted-foreground">·</span>
                <span className="truncate text-muted-foreground">
                  {formatListDateTime(c.date_received)}
                </span>
              </button>
            ))
        : null}
    </div>
  )
})
```

The border change is deliberate: the old list used `<ul className="divide-y">` to
draw separators between `<li>`s. After windowing (Step 4) rows are absolutely
positioned and `divide-y` no longer applies, so the separator moves onto the row
wrapper as `border-b` (already in the shape above).

Now wire the parent (`message-list.tsx`) — still using `.map()`, no windowing yet:

**3a.** Delete the local `formatListDateTime` (`message-list.tsx:92-103`) and add
`import { MessageRow } from "./message-row"` near the other `./` imports. Both
`formatFrom` AND `formatMessageFrom` move into the row and become unused in
`message-list.tsx`; drop each one from the `./types` import there once unused
(check with `grep -n "formatFrom\|formatMessageFrom" message-list.tsx`). `pnpm
run lint` runs `eslint --max-warnings 0`, so a leftover unused import FAILS the
Step 3 lint verify — remove every import that is no longer referenced.

**3b.** Add refs + stable callbacks in the component body (place them after the
existing `pendingFolderSelectIdsRef` ref, ~`message-list.tsx:181`):

```tsx
  const selectedIdsRef = useRef(selectedIds)
  const visibleMessagesRef = useRef(visibleMessages)
  const expandedThreadsRef = useRef(expandedThreads)
  const threadChildrenRef = useRef(threadChildren)
  useEffect(() => { selectedIdsRef.current = selectedIds }, [selectedIds])
  useEffect(() => { visibleMessagesRef.current = visibleMessages }, [visibleMessages])
  useEffect(() => { expandedThreadsRef.current = expandedThreads }, [expandedThreads])
  useEffect(() => { threadChildrenRef.current = threadChildren }, [threadChildren])

  const buildDragIds = useCallback((id: number): number[] => {
    const sel = selectedIdsRef.current
    if (sel.has(id) && sel.size > 1) {
      return visibleMessagesRef.current
        .filter((vm) => sel.has(vm.id) && vm.uid >= 0)
        .map((vm) => vm.id)
    }
    return [id]
  }, [])

  const toggleThreadExpand = useCallback(
    async (tKey: string, threadIdForExpand: string) => {
      const isExpanded = expandedThreadsRef.current.has(tKey)
      setExpandedThreads((prev) => {
        const next = new Set(prev)
        if (isExpanded) next.delete(tKey)
        else next.add(tKey)
        return next
      })
      if (!isExpanded && !threadChildrenRef.current[tKey] && threadIdForExpand) {
        const rows = await invokeRenderer(IPCChannels.Email.ListThreadMessages, {
          threadId: threadIdForExpand,
          limit: 50,
        })
        if (Array.isArray(rows)) {
          setThreadChildren((prev) => ({ ...prev, [tKey]: rows as EmailMessage[] }))
        }
      }
    },
    [],
  )
```

`buildDragIds` and `toggleThreadExpand` now have empty dependency arrays, so their
identity is stable for the lifetime of the component — memoized rows never
re-render just because these changed.

**3c.** Add a module-scope stable empty array (top of the file, after the imports):

```tsx
const NO_CHILDREN: EmailMessage[] = []
```

**3d.** Replace the inline `.map` body (`message-list.tsx:635-845`, the
`{visibleMessages.map((m) => { … })}` block) so each iteration computes the row's
props and renders `<MessageRow>`:

```tsx
            {visibleMessages.map((m) => {
              const tKey = threadKey(m)
              const threadIdForExpand = m.thread_id?.trim() ?? ""
              const localSiblings = threadGroups.get(tKey) ?? NO_CHILDREN
              const hasLocalSiblings = localSiblings.length > 1
              const expanded = expandedThreads.has(tKey)
              return (
                <MessageRow
                  key={m.id}
                  message={m}
                  accounts={accounts}
                  active={selectedMessage?.id === m.id}
                  checked={selectedIds.has(m.id)}
                  canSelect={isMessageSelectable(m)}
                  bulkBusy={bulkBusy}
                  unread={!m.seen_local && m.uid >= 0}
                  open={mailView === "inbox" && !m.done_local && m.uid >= 0}
                  isDraft={m.folder_kind === "draft"}
                  blocked={!!m.outbound_hold}
                  showAccount={showAccount}
                  accountLabelText={showAccount ? accountLabel(m.account_id) : ""}
                  mailView={mailView}
                  isThreadRoot={
                    listDisplayMode === "thread" &&
                    (threadIdForExpand.length > 0 || hasLocalSiblings)
                  }
                  expanded={expanded}
                  childrenRows={threadChildren[tKey] ?? (expanded ? localSiblings : NO_CHILDREN)}
                  lock={conversationLocks[m.id]}
                  tKey={tKey}
                  threadIdForExpand={threadIdForExpand}
                  onOpen={onOpen}
                  onToggleCheckbox={toggleCheckbox}
                  onToggleExpand={toggleThreadExpand}
                  buildDragIds={buildDragIds}
                />
              )
            })}
```

Keep the surrounding `<ul className="divide-y">`, the "select all loaded" `<li>`
header, the `ScrollArea`, and the "Weitere laden" footer exactly as they are for
this step — only the `.map` body changes. (`<MessageRow>` renders its own `<div>`,
not an `<li>`; that is fine inside the `<ul>` for now and gets cleaned up in Step
4. The double border from `divide-y` + `border-b` is a transient cosmetic overlap
that Step 4 removes; if you prefer, you may drop `divide-y` from the `<ul>` now.)

Why the props are shaped this way: the parent computes each row's booleans
(`active`, `checked`, `unread`, …) and passes primitives + stable callbacks, so
`React.memo`'s shallow compare re-renders only the rows whose own inputs changed.
`childrenRows` falls back to the module-scope `NO_CHILDREN` (not a fresh `[]`) so
collapsed rows keep a stable reference and the memo holds.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0. `pnpm run lint` → exit 0.
`pnpm run build` → exit 0. Manually (or trust the Step 5 test) the list renders
the same: selection checkboxes, thread expand/collapse, drag, and open-on-click all
still work.

### Step 4: Window the list with `useVirtualizer`

All edits in `src/components/email/message-list.tsx`. This is the one behavioral
change. Replace the Radix `ScrollArea` around the list with a native scroll
container so the virtualizer has a direct scroll element (integrating
`react-virtual` with Radix's internal viewport is fiddly and would require
touching the shared `scroll-area.tsx`, which is out of scope).

**4a.** Add the import: `import { useVirtualizer } from "@tanstack/react-virtual"`.
Remove the now-unused `import { ScrollArea } from "@/components/ui/scroll-area"`
(`message-list.tsx:35`).

**4b.** Add a scroll-container ref and the virtualizer in the component body,
**after the callbacks and after the `visibleMessages` useMemo, before the
`return`** (≈ line 468–513). The virtualizer must be declared BEFORE any effect
that references it:

```tsx
  const scrollParentRef = useRef<HTMLDivElement>(null)
  const rowVirtualizer = useVirtualizer({
    count: visibleMessages.length,
    getScrollElement: () => scrollParentRef.current,
    estimateSize: () => 68,
    overscan: 8,
    getItemKey: (index) => visibleMessages[index].id,
  })
```

**4c.** **MOVE** the `scrollToMessageId` effect: DELETE it from its current
location (`message-list.tsx:171-178`) and re-add the rewritten version
**immediately after the `rowVirtualizer` declaration from 4b**. It references
`rowVirtualizer`, so leaving it at line 171 (above the `const rowVirtualizer` at
~468) is a use-before-declaration — TypeScript TS2448 + a runtime
temporal-dead-zone error, and the Step 4 typecheck would fail. Rewritten to use
the virtualizer instead of `document.querySelector`:

```tsx
  useEffect(() => {
    if (scrollToMessageId == null) return
    const index = visibleMessages.findIndex((m) => m.id === scrollToMessageId)
    if (index < 0) return
    rowVirtualizer.scrollToIndex(index, { align: "nearest" })
    onScrolledToMessage?.()
  }, [scrollToMessageId, visibleMessages, rowVirtualizer, onScrolledToMessage])
```

This preserves the original semantics: `onScrolledToMessage` fires only when the
target is present in the loaded list; an id not yet loaded stays pending and
retries when `visibleMessages` changes.

**4d.** Replace the render region (the whole `<ScrollArea className="flex-1">…
</ScrollArea>` block, `message-list.tsx:592-862`) with a native scroll `<div>` that
keeps the "select all" header and the "Weitere laden" footer in normal flow, and
absolutely positions the windowed rows inside a spacer sized to the total height:

```tsx
      <div ref={scrollParentRef} className="flex-1 overflow-y-auto">
        {loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lädt…
          </p>
        ) : visibleMessages.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Keine Nachrichten.</p>
        ) : (
          <>
            {selectableIds.length > 0 ? (
              <div className="flex items-center gap-2 border-b bg-muted/20 px-3 py-1.5">
                {/* COPY the existing "select all loaded" Checkbox + "Auswahl"
                   DropdownMenu VERBATIM from message-list.tsx:604-632
                   (was inside the <li>). */}
              </div>
            ) : null}
            <div
              style={{ height: `${rowVirtualizer.getTotalSize()}px`, position: "relative", width: "100%" }}
            >
              {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                const m = visibleMessages[virtualRow.index]
                const tKey = threadKey(m)
                const threadIdForExpand = m.thread_id?.trim() ?? ""
                const localSiblings = threadGroups.get(tKey) ?? NO_CHILDREN
                const hasLocalSiblings = localSiblings.length > 1
                const expanded = expandedThreads.has(tKey)
                return (
                  <div
                    key={virtualRow.key}
                    data-index={virtualRow.index}
                    ref={rowVirtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <MessageRow
                      message={m}
                      accounts={accounts}
                      active={selectedMessage?.id === m.id}
                      checked={selectedIds.has(m.id)}
                      canSelect={isMessageSelectable(m)}
                      bulkBusy={bulkBusy}
                      unread={!m.seen_local && m.uid >= 0}
                      open={mailView === "inbox" && !m.done_local && m.uid >= 0}
                      isDraft={m.folder_kind === "draft"}
                      blocked={!!m.outbound_hold}
                      showAccount={showAccount}
                      accountLabelText={showAccount ? accountLabel(m.account_id) : ""}
                      mailView={mailView}
                      isThreadRoot={
                        listDisplayMode === "thread" &&
                        (threadIdForExpand.length > 0 || hasLocalSiblings)
                      }
                      expanded={expanded}
                      childrenRows={threadChildren[tKey] ?? (expanded ? localSiblings : NO_CHILDREN)}
                      lock={conversationLocks[m.id]}
                      tKey={tKey}
                      threadIdForExpand={threadIdForExpand}
                      onOpen={onOpen}
                      onToggleCheckbox={toggleCheckbox}
                      onToggleExpand={toggleThreadExpand}
                      buildDragIds={buildDragIds}
                    />
                  </div>
                )
              })}
            </div>
          </>
        )}
        {hasMore && !loading && !searchQuery.trim() ? (
          <div className="border-t p-2">
            {/* COPY the existing "Weitere laden" Button VERBATIM from
               message-list.tsx:850-859. */}
          </div>
        ) : null}
      </div>
```

Key points:
- `ref={rowVirtualizer.measureElement}` + `data-index` gives **per-row measured
  heights**, so an expanded thread (taller row) is measured correctly and later
  rows shift down. `estimateSize` is only the pre-measurement guess.
- The header and footer are **outside** the absolutely-positioned spacer, in normal
  flow, so they scroll with the list exactly as before.
- The `<ul>/<li>` wrappers are gone; separators come from each `MessageRow`'s
  `border-b` (added in Step 3).
- The `.map()` block you added in Step 3d is now replaced by this virtualized
  version — there should be exactly one place that renders `<MessageRow>`.

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0. `pnpm run lint` → exit 0.
`pnpm run build` → exit 0. Then confirm the render integrity items in the Test plan
manually if you can run the app (the automated suite only covers the row).

### Step 5: Add a `MessageRow` unit test

Create `tests/unit/message-row.test.tsx`, modeled on
`tests/unit/kanban-card.test.tsx`. Test the extracted row in isolation (jsdom
cannot measure heights, so do **not** try to render the full virtualized
`MessageList` — the virtualizer needs real layout; the row is the testable unit).

Cover:
1. Renders the sender/subject and the account label when `showAccount` is true.
2. Clicking the row body (plain click) calls `onOpen` with the message.
3. Toggling the checkbox calls `onToggleCheckbox`.
4. **Memoization holds**: re-rendering with identical props does not re-run the
   row body (assert via a spy, or via `rerender` with the same props leaving the
   DOM node identity intact) — the regression this plan is about.

Example structure:

```tsx
import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { MessageRow, type MessageRowProps } from '@/components/email/message-row';
import type { EmailMessage } from '@/components/email/types';

const baseMessage = {
  id: 42,
  account_id: 1,
  folder_id: 1,
  uid: 10,
  subject: 'Rechnung 2026',
  snippet: null,
  date_received: '2026-07-01T09:30:00.000Z',
  from_json: JSON.stringify({ value: [{ name: 'Acme', address: 'billing@acme.test' }] }),
  body_text: null,
  body_html: null,
  seen_local: 0,
} as unknown as EmailMessage;

function makeProps(overrides: Partial<MessageRowProps> = {}): MessageRowProps {
  return {
    message: baseMessage,
    accounts: [],
    active: false,
    checked: false,
    canSelect: true,
    bulkBusy: false,
    unread: true,
    open: false,
    isDraft: false,
    blocked: false,
    showAccount: true,
    accountLabelText: 'Konto 1',
    mailView: 'inbox',
    isThreadRoot: false,
    expanded: false,
    childrenRows: [],
    lock: undefined,
    tKey: 'm:42',
    threadIdForExpand: '',
    onOpen: jest.fn(),
    onToggleCheckbox: jest.fn(),
    onToggleExpand: jest.fn(),
    buildDragIds: jest.fn(() => [42]),
    ...overrides,
  };
}

describe('MessageRow', () => {
  test('renders subject and account label', () => {
    render(<MessageRow {...makeProps()} />);
    expect(screen.getByText('Rechnung 2026')).toBeTruthy();
    expect(screen.getByText('Konto 1')).toBeTruthy();
  });

  test('plain click opens the message', async () => {
    const onOpen = jest.fn();
    render(<MessageRow {...makeProps({ onOpen })} />);
    await userEvent.click(screen.getByText('Rechnung 2026'));
    expect(onOpen).toHaveBeenCalledWith(baseMessage);
  });

  test('checkbox toggles selection', async () => {
    const onToggleCheckbox = jest.fn();
    render(<MessageRow {...makeProps({ onToggleCheckbox })} />);
    await userEvent.click(screen.getByRole('checkbox', { name: /Nachricht 42 auswählen/ }));
    expect(onToggleCheckbox).toHaveBeenCalledWith(42, true, false);
  });

  test('does not re-render when the same props are passed again (memo holds)', () => {
    const props = makeProps();
    const { rerender } = render(<MessageRow {...props} />);
    const node = screen.getByText('Rechnung 2026');
    rerender(<MessageRow {...props} />);
    // Same DOM node instance => React.memo skipped the re-render.
    expect(screen.getByText('Rechnung 2026')).toBe(node);
  });
});
```

Adjust selectors/assertions to the exact copied JSX (e.g. `formatMessageFrom`
renders `Acme <billing@acme.test>` for the from-line; the `getByText` above targets
the subject, which is unambiguous). If a Radix child needs a portal that jsdom
can't mount, mock it as in `kanban-card.test.tsx` — but the row uses only `Button`
and `Checkbox`, which render inline, so no mocks should be needed.

**Verify**: `pnpm test -- tests/unit/message-row.test.tsx` → all tests pass.

## Test plan

- **New file**: `tests/unit/message-row.test.tsx`, modeled structurally on
  `tests/unit/kanban-card.test.tsx`.
- **Cases**: (1) renders subject + account label; (2) plain click → `onOpen`;
  (3) checkbox → `onToggleCheckbox(id, true, false)`; (4) memo holds — same props
  on re-render keep the same DOM node.
- **Why not test the virtualized list**: `useVirtualizer` needs real element
  heights and a `ResizeObserver`, which jsdom does not provide (heights read as 0),
  so a full `MessageList` render would window zero or all rows unreliably.
  Virtualization behavior is covered by the manual/e2e render-integrity checks
  below, not by a jsdom unit test.
- **Render-integrity checks (manual, if you can run the app** via `pnpm run
  electron:dev` **or the existing dev flow)**: with a folder of a few hundred
  messages —
  1. Scrolling is smooth and the DOM contains only ~visible rows (inspect: far
     fewer `[data-message-id]` nodes than `visibleMessages.length`).
  2. Toggling one row's checkbox does not visibly reflow others; selection count
     updates.
  3. Shift-click range select and Ctrl/Cmd-click toggle still work.
  4. Expanding a thread row grows that row and pushes later rows down (dynamic
     measurement); collapsing restores it.
  5. Selecting a message that is off-screen (e.g. via the adjacent-message advance
     after archiving) scrolls it into view (`scrollToIndex`).
  6. Dragging a row (or a multi-selection) still sets the drag payload and drops
     onto a folder/category.
- **Full suite**: `pnpm test` → all pass (no existing suite regressed).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `pnpm install --frozen-lockfile` exits 0 (lockfile and `package.json` agree).
- [ ] `git grep -n "@tanstack/react-virtual" package.json` shows the dependency.
- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0 (no type errors).
- [ ] `pnpm run lint` exits 0 (eslint, `--max-warnings 0`).
- [ ] `pnpm test -- tests/unit/message-row.test.tsx` passes; the new tests exist.
- [ ] `pnpm test` exits 0 (no existing suite regressed).
- [ ] `pnpm run build` exits 0.
- [ ] `git grep -n "useVirtualizer" src/components/email/message-list.tsx` matches
      (windowing is present).
- [ ] `git grep -n "React.memo" src/components/email/message-row.tsx` matches
      (row is memoized).
- [ ] `git grep -n "ScrollArea" src/components/email/message-list.tsx` returns
      **nothing** (the unused import was removed).
- [ ] `git status --porcelain` shows only the five in-scope paths changed
      (`message-list.tsx`, `message-row.tsx`, `message-row.test.tsx`,
      `package.json`, `pnpm-lock.yaml`) — no other files.
- [ ] `plans/README.md` status row for plan 008 updated **only if** the advisor did
      not tell you they maintain it (for this plan, they do — leave it).

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the cited locations does not match the "Current state" excerpts —
  e.g. `selectableIds`/`accountLabel` are already memoized, the row map body was
  restructured, the `scrollToMessageId` effect no longer uses
  `document.querySelector`, or `<MessageList>` no longer wraps rows in
  `ScrollArea` (the file drifted since `f24fb27`).
- `pnpm add @tanstack/react-virtual` reports an **unmet/incompatible React peer
  dependency** (the repo is on React 19; if the resolved `react-virtual` version
  refuses React 19, do not force it — report the version and the peer range).
- After Step 4, virtualization misbehaves in a way you cannot resolve within the
  plan: rows overlap or collapse to zero height, expanded threads clip their
  children, `scrollToIndex` scrolls to the wrong row, or drag-and-drop stops
  producing a payload. These are the plan's known-risky interactions
  (dynamic measurement, `scrollToMessageId`, drag). Do **not** paper over them by
  re-introducing the non-windowed list under a flag — report what broke.
- Making it work appears to require editing an out-of-scope file — especially
  `src/components/ui/scroll-area.tsx` (to expose its viewport ref) or
  `src/components/email/mail-shell.tsx` (to change `<MessageList>` props). If you
  believe the ScrollArea viewport approach is necessary, STOP and report rather
  than modifying the shared primitive.
- Any verification command fails twice after a reasonable fix attempt.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **Reviewer focus**:
  1. Confirm every prop passed to `<MessageRow>` is either a primitive, a
     stable-identity callback (`onOpen` from props; `toggleCheckbox` — which is
     stable only because `selectableIds` is now memoized; `toggleThreadExpand` and
     `buildDragIds` — empty-dep `useCallback`s reading refs), or a stable-reference
     value (`accounts`, `NO_CHILDREN`, a `threadGroups`/`threadChildren` array). A
     freshly-allocated array or inline arrow slipping into the props list silently
     defeats the memo for **all** rows — the exact regression this plan fixes.
  2. Confirm `childrenRows` falls back to the module-scope `NO_CHILDREN`, never
     `[]` inline.
  3. Confirm dynamic measurement is wired: each windowed row `<div>` has both
     `data-index` and `ref={rowVirtualizer.measureElement}`.
- **Known tradeoff introduced here**: the message list no longer uses the Radix
  `ScrollArea` (custom thin scrollbar); it uses a native `overflow-y-auto` div so
  the virtualizer has a direct scroll element. If preserving the styled scrollbar
  matters, the alternative is to keep `ScrollArea` and point `getScrollElement` at
  its viewport (`[data-radix-scroll-area-viewport]`, resolved via a container ref)
  — but that couples the list to Radix internals; it was deliberately avoided here.
- **Interactions to revisit later**:
  - If a "jump to message / search result" feature is added that targets a message
    **not** in the loaded page, `scrollToIndex` can't reach it (index `< 0`) — that
    path must first load the page containing the target (as the current pending-retry
    behavior implies), then scroll.
  - If row height becomes much more variable (e.g. inline previews), revisit
    `estimateSize` (currently `68`) to reduce first-paint shift before measurement.
  - `overscan: 8` trades a few extra mounted rows for smoother fast-scroll; tune if
    profiling shows either jank (raise) or memory pressure (lower).
- **Deferred out of this plan**: the data-layer growth (`PAGE_SIZE`/append in
  `use-email-messages.ts`) is intentionally unchanged — windowing makes the long
  in-memory list cheap to render, but it does not cap memory. If mailboxes reach
  many thousands of loaded rows, a windowed **data** fetch (virtual paging /
  `overscan`-driven load) is a separate follow-up.
