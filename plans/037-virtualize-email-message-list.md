# Plan 037: Window and memoize the email message list (supersedes plan 008)

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update this plan's row in
> `plans/README.md` (section "Runde 2") AND tick its checkbox in
> `plans/MASTERPLAN.md`.
>
> **Drift check (run first)**:
> `git diff --stat 9e0491e3..HEAD -- src/components/email/message-list.tsx src/components/email/message-row.tsx tests/unit/message-list-bulk-restore-errors.test.tsx tests/unit/workflow-codex-review-regressions.test.ts package.json pnpm-lock.yaml`
> If any listed file changed since this plan was written, compare the
> "Current state" excerpts against the live code; on a mismatch, STOP.
> (`message-row.tsx` does not exist yet.)

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: perf
- **Planned at**: commit `9e0491e3`, 2026-09-27
- **Supersedes**: `plans/008-message-list-virtualize-memoize.md` (BLOCKED on the
  dependency; its excerpts no longer match — do NOT follow 008).

**Corrections to the audit brief** (verified at HEAD): there is **no arrow-key
keyboard navigation** in the list — keyboard handling is only `Escape` (clear
selection) and `/` (focus search) on `window` (`message-list.tsx:244-260`), plus
Shift/Ctrl-click range/toggle selection. The "load more" trigger is a **button**
("Weitere laden"), not an intersection observer. Plan 008's
`scrollToIndex(index, { align: "nearest" })` is invalid: `@tanstack/virtual-core`
3.17 accepts only `'start' | 'center' | 'end' | 'auto'`.

## Why this matters

`MessageList` renders every loaded message inline inside `visibleMessages.map`
with no memo boundary and no windowing, inside a Radix `ScrollArea`. Pages append
(`PAGE_SIZE = 100`, `src/components/email/hooks/use-email-messages.ts:17`) and an
ACL reconcile may re-query up to `MAX_ACL_RECONCILE_ROWS = 1000` rows
(`src/components/email/hooks/reconcile-visible-messages.ts:34`), so 1000 mounted
rows are realistic. Every checkbox toggle, thread expand or selection change
re-renders every row. After this plan only the ~visible rows (+ overscan) are
mounted and a toggle re-renders one row.

## Current state

- `src/components/email/message-list.tsx` (1079 lines) — the only file with list logic.
  - Module helpers: `threadKey` (:90), `formatListDateTime` (:108),
    `renderHighlighted` (:121). The last two are used **only** inside the row JSX.
  - `showAccount`/`accountLabel` (:197-199) — `accountLabel` is a fresh closure
    doing `accounts.find` per row.
  - `scrollToMessageId` effect (:214-221) uses
    `document.querySelector('[data-message-id="…"]')` + `scrollIntoView`, and calls
    `onScrolledToMessage?.()` **only when the element is found** (pending id retries
    when `messages` changes). With windowing the row may not be mounted.
  - `isMessageSelectable` (:262-265) and `selectableIds` (:267, a fresh array each
    render) — `selectableIds` is a dep of `toggleCheckbox` (:281-307) and
    `toggleAllLoaded` (:309-317), so those callbacks change identity every render.
  - Render region (:764-1060):
    ```tsx
    <ScrollArea className="flex-1">
      {loading ? (<p …><Loader2 …/>Lädt…</p>)
       : visibleMessages.length === 0 ? (<p …>Keine Nachrichten.</p>)
       : (<ul className="divide-y">
            {selectableIds.length > 0 ? (<li …>{/* "Alle geladenen auswählen" Checkbox + "Auswahl" DropdownMenu */}</li>) : null}
            {visibleMessages.map((m) => { … return (<li key={m.id}> … </li>) })}   // :807-1043
          </ul>)}
      {hasMore && !loading ? (<div className="border-t p-2"><Button …>{loadingMore ? "Lädt…" : "Weitere laden"}</Button></div>) : null}
    </ScrollArea>
    ```
  - Row body (:808-1041) computes per row: `isDraft, blocked, unread, open, active,
    canSelect, checked, tKey, threadIdForExpand, localSiblings, hasLocalSiblings,
    serverThreadCount (m.thread_message_count), isThreadRoot, expanded, children,
    lock, lockOwner`. It renders a `w-7` column (Checkbox with Shift-click range,
    thread-expand `Button` with an inline async closure calling
    `invokeRenderer(IPCChannels.Email.ListThreadMessages, { threadId, limit: 50 })`
    at :865-888), then the draggable `<button data-message-id={m.id}>` whose
    `onDragStart` (:900-912) reads `selectedIds`/`visibleMessages` and calls
    `setMailDragData(e.dataTransfer, dragIds)` (drag to sidebar folders/categories;
    drop side is `mail-sidebar.tsx` via `readMailDragData`, untouched), the priority
    dot, from-line (`formatMessageFrom`), `m.approval_state === "pending"` badge,
    `<SentProvenanceBadges message={m} />`, Paperclip/Lock icons, date, subject with
    search highlighting (`searchActive`, `searchNeedles`), search snippet,
    snoozed-until, account label, and expanded child buttons (`pl-8`).
- `tests/unit/message-list-bulk-restore-errors.test.tsx` renders the full
  `MessageList` in jsdom (2 trashed rows) and only clicks the header checkbox
  "Alle geladenen auswählen" and the bulk button "Wiederherstellen" — both stay
  outside the windowed area, so it must keep passing unchanged.
- `tests/unit/workflow-codex-review-regressions.test.ts:62,69-70` reads the
  **source text** of `message-list.tsx` and asserts
  `expect(list).toContain('m.approval_state === "pending"')` and
  `not.toContain('!serverClientMode && m.approval_state')`. Moving the row JSX
  moves that string, so this guard must be re-pointed to `message-row.tsx`.
- jsdom facts (verified in `@tanstack/virtual-core@3.17.11` source, the dep of
  `@tanstack/react-virtual@3.14.13`): the scroll element size comes from
  `offsetWidth/offsetHeight`; `calculateRange` returns **no items when the viewport
  height is 0** (always the case in jsdom); `measureElement` falls back to
  `offsetHeight`; `scrollTo` is called optionally (`scrollElement?.scrollTo?.(…)`).
  Peer deps allow React 19. So tests must stub `HTMLElement.prototype.offsetHeight`.
- Renderer dependencies live in the **root** `package.json` (`react ^19.2.7`,
  `@tanstack/react-router`, `@tanstack/react-table`); `packages/desktop/package.json`
  has no renderer deps. No `React.memo` exists in `src/` yet.
- `src/components/ui/scroll-area.tsx` is a shared Radix wrapper — do not modify.

## Commands you will need

Prefix every command with `export PATH=/opt/node24/bin:$PATH;`.

| Purpose | Command | Expected |
|---|---|---|
| Install | `pnpm install` | exit 0 |
| Add dependency | `pnpm add @tanstack/react-virtual@^3.14.13` (repo root) | exit 0, lockfile updated |
| Typecheck (all) | `pnpm run typecheck` | exit 0 |
| Lint | `pnpm run lint` | exit 0, 0 warnings |
| Focused test | `pnpm exec jest tests/unit/message-list-virtualization.test.tsx tests/unit/message-list-bulk-restore-errors.test.tsx tests/unit/workflow-codex-review-regressions.test.ts` | all pass |
| Unit | `pnpm run test:unit` | all pass |
| UI coverage ratchet | `pnpm run test:ui:coverage:check` | pass |
| Build | `pnpm run build` | exit 0 |

## Scope

**In scope**: `package.json`, `pnpm-lock.yaml`,
`src/components/email/message-list.tsx`, `src/components/email/message-row.tsx`
(create), `tests/unit/message-list-virtualization.test.tsx` (create),
`tests/unit/workflow-codex-review-regressions.test.ts` (re-point one read),
`CHANGELOG.md`.

**Out of scope**: `use-email-messages.ts` / `reconcile-visible-messages.ts`
(paging is correct; windowing makes it cheap), `src/components/ui/scroll-area.tsx`,
`mail-shell.tsx` (`<MessageList>` props stay identical), `mail-sidebar.tsx`
(drop targets), `mail-drag.ts`.

## Git workflow

Branch `advisor/037-virtualize-email-message-list`. German commit messages,
e.g. `Mail-Liste: Zeilen memoisieren und nur sichtbare Zeilen rendern`. Do not push.

## Steps

### Step 1: Add the dependency

`pnpm add @tanstack/react-virtual@^3.14.13` in the repo root. If pnpm refuses
because of `minimumReleaseAge`, or reports an unmet React peer, STOP.

**Verify**: `git diff package.json` shows `"@tanstack/react-virtual"` under
`dependencies`; `pnpm install --frozen-lockfile` → exit 0.

### Step 2: Stabilize derived values in `message-list.tsx` (no behavior change)

- `isMessageSelectable` → `useCallback(…, [mailView])`.
- `selectableIds` → `useMemo(() => visibleMessages.filter(isMessageSelectable).map((m) => m.id), [visibleMessages, isMessageSelectable])`.
- Replace `accountLabel` with a memoized `Map`:
  `const accountLabels = useMemo(() => new Map(accounts.map((a) => [a.id, a.display_name])), [accounts])`
  and compute `accountLabels.get(id) ?? \`Konto ${id}\`` at the call site.
- Add refs mirroring state for stable callbacks (update them in `useEffect`):
  `selectedIdsRef`, `visibleMessagesRef`, `expandedThreadsRef`, `threadChildrenRef`.
- Add `buildDragIds = useCallback((id) => …, [])` reproducing :900-910 exactly
  (multi-selection containing `id` and size > 1 → selected visible rows with
  `uid >= 0`; else `[id]`), reading the refs.
- Add `toggleThreadExpand = useCallback(async (tKey, threadIdForExpand) => …, [])`
  reproducing :865-888: read `expandedThreadsRef.current.has(tKey)`; update
  `setExpandedThreads` with a functional updater; when expanding and
  `!threadChildrenRef.current[tKey] && threadIdForExpand`, fetch via
  `invokeRenderer(IPCChannels.Email.ListThreadMessages, { threadId, limit: 50 })`
  and merge with `setThreadChildren((prev) => ({ ...prev, [tKey]: rows }))`.
- Module-scope `const NO_CHILDREN: EmailMessage[] = []`.

**Verify**: `pnpm run typecheck` → exit 0; focused tests (existing two) pass.

### Step 3: Extract `MessageRow` into `src/components/email/message-row.tsx`

Create the file (`"use client"`). Move `formatListDateTime` and
`renderHighlighted` into it (export `formatListDateTime`). Export
`export const MessageRow = React.memo(function MessageRow(props: MessageRowProps) { … })`.
The body is the **verbatim** JSX of the current `<li>` content (:837-1041),
wrapped in `<div className="border-b">` instead of `<li>` (separators moved from
the parent's `divide-y`). Props — primitives or stable references only:

```ts
export type MessageRowProps = {
  message: EmailMessage; accounts: EmailAccount[]; mailView: MailView
  active: boolean; checked: boolean; canSelect: boolean; bulkBusy: boolean
  unread: boolean; open: boolean; isDraft: boolean; blocked: boolean
  showAccount: boolean; accountLabelText: string
  searchActive: boolean; searchNeedles: string[]   // memoized in parent (:202)
  isThreadRoot: boolean; expanded: boolean
  childrenRows: EmailMessage[]                     // NO_CHILDREN when collapsed
  lock: ConversationLockRecord | undefined
  tKey: string; threadIdForExpand: string
  onOpen: (m: EmailMessage) => void | Promise<void>
  onToggleCheckbox: (id: number, checked: boolean, shiftKey: boolean) => void
  onToggleExpand: (tKey: string, threadIdForExpand: string) => void | Promise<void>
  buildDragIds: (id: number) => number[]
}
```

Substitutions inside the copied JSX: `toggleCheckbox` → `onToggleCheckbox`;
the expand `onClick` → `e.stopPropagation(); void onToggleExpand(tKey, threadIdForExpand)`;
`onDragStart` → `if (m.uid < 0 || bulkBusy) return; setMailDragData(e.dataTransfer, buildDragIds(m.id))`;
`accountLabel(m.account_id)` → `accountLabelText`; `children` → `childrenRows`.
Keep `data-message-id={m.id}`, all German strings, and the literal
`m.approval_state === "pending"`. Move the now row-only imports (`Lock`,
`Paperclip`, `formatFrom`, `formatMessageFrom`, `setMailDragData`,
`SentProvenanceBadges`, `OUTBOUND_HOLD_FALLBACK_REASON`,
`highlightNeedlesInText`, `splitHighlighted`, `ReactNode`) and delete them from
`message-list.tsx` when unused (lint has `--max-warnings 0`).
Check `ConversationLockRecord` is exported from `./types`
(`grep -n "ConversationLockRecord" src/components/email/types.ts`); if not,
derive the type from `useMailWorkspace().conversationLocks` values.

In the parent, keep the `.map` for now and render `<MessageRow key={m.id} … />`
with the per-row values computed exactly as today (including the
`serverThreadCount` rule for `isThreadRoot`; `childrenRows =
threadChildren[tKey] ?? (expanded ? localSiblings : NO_CHILDREN)`;
`localSiblings = threadGroups.get(tKey) ?? NO_CHILDREN`).

Re-point the source guard: in
`tests/unit/workflow-codex-review-regressions.test.ts:62` read
`src/components/email/message-row.tsx` for the two `list` assertions (keep them
otherwise identical).

**Verify**: typecheck, lint, focused tests → pass.
`grep -n "approval_state === \"pending\"" src/components/email/message-row.tsx` → 1 match.

### Step 4: Window the list with `useVirtualizer`

In `message-list.tsx`: import `useVirtualizer` from `@tanstack/react-virtual`;
remove the `ScrollArea` import. After `visibleMessages`/callbacks are declared:

```tsx
const scrollParentRef = useRef<HTMLDivElement>(null)
const rowVirtualizer = useVirtualizer({
  count: visibleMessages.length,
  getScrollElement: () => scrollParentRef.current,
  estimateSize: () => 64,
  overscan: 8,
  getItemKey: (index) => visibleMessages[index]?.id ?? index,
})
```

**Move** the `scrollToMessageId` effect below this declaration (TDZ otherwise)
and rewrite it:

```tsx
useEffect(() => {
  if (scrollToMessageId == null) return
  const index = visibleMessages.findIndex((m) => m.id === scrollToMessageId)
  if (index < 0) return            // stays pending until the row is loaded
  rowVirtualizer.scrollToIndex(index, { align: "auto" })
  onScrolledToMessage?.()
}, [scrollToMessageId, visibleMessages, rowVirtualizer, onScrolledToMessage])
```

Replace `<ScrollArea className="flex-1">…</ScrollArea>` with
`<div ref={scrollParentRef} data-message-list-scroll className="min-h-0 flex-1 overflow-y-auto">`
containing: loading / empty states unchanged; the "select all" header as a
`<div>` (same classes/children as the old `<li>`); a spacer
`<div style={{ height: rowVirtualizer.getTotalSize(), position: "relative", width: "100%" }}>`
mapping `rowVirtualizer.getVirtualItems()` to
`<div key={v.key} data-index={v.index} ref={rowVirtualizer.measureElement} style={{ position: "absolute", top: 0, left: 0, width: "100%", transform: \`translateY(${v.start}px)\` }}>`
around `<MessageRow …/>`; then the unchanged "Weitere laden" footer. Exactly one
place renders `<MessageRow>`. Measured heights handle expanded threads.

**Verify**: typecheck, lint, focused tests pass; `grep -n "ScrollArea" src/components/email/message-list.tsx` → no match.

### Step 5: Add `tests/unit/message-list-virtualization.test.tsx`

Copy the mock scaffolding from `message-list-bulk-restore-errors.test.tsx`
(sonner, `@/services/transport`, `workspace-context` with `mailView: 'inbox'`).
Additionally `jest.mock('../../src/components/email/sent-provenance', () => ({ SentProvenanceBadges: jest.fn(() => null), SentProvenanceLine: () => null }))`
as a per-row render counter. In `beforeAll` stub layout and restore in `afterAll`:

```ts
const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight')
Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true,
  get() { return this.hasAttribute('data-index') ? 64 : this.hasAttribute('data-message-list-scroll') ? 640 : 0 } })
```

(also stub `offsetWidth` → 400). Build 1000 inbox messages (`uid = id`,
`seen_local: 0`). Cases:
1. **Perf check**: after render, `container.querySelectorAll('[data-message-id]').length`
   is `> 0` and `<= 40` (640/64 = 10 visible + 8 overscan each side).
2. **Memo**: record `SentProvenanceBadges` call count after mount; click the
   checkbox `Nachricht 1 auswählen`; the count increases by **at most 2**.
3. **scrollToMessageId**: render with `scrollToMessageId={900}` and an
   `onScrolledToMessage` mock → called once; with `9999` → not called.
4. **Selection**: click row 1 checkbox, Shift-click row 3 checkbox → the bulk
   bar shows `3 ausgewählt`.
5. **Drag**: fire `dragStart` on the row button of a selected message with a fake
   `dataTransfer` (`{ setData: jest.fn(), effectAllowed: '' }`) when two rows are
   selected → `setData` received both ids (inspect `mail-drag.ts` for the MIME
   type `application/x-simplecrm-mail` and payload shape).
6. **Thread expand**: `listDisplayMode: 'thread'`, two messages with the same
   `thread_id` and `thread_message_count: 2`; clicking the expand button calls
   `mockInvoke` with `IPCChannels.Email.ListThreadMessages`.

**Verify**: focused test command → all pass (6 new tests).

### Step 6: Full gates + CHANGELOG

Add under `[Unreleased]` → `### Changed`: `- **Beide Editionen:** Die
Nachrichtenliste rendert nur noch die sichtbaren Zeilen; Auswahl, Aufklappen und
Scrollen bleiben auch mit 1.000 geladenen Mails flüssig.`

**Verify**: `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:unit`,
`pnpm run test:ui:coverage:check`, `pnpm run build` → all pass.

## Test plan

New `tests/unit/message-list-virtualization.test.tsx` (6 cases above), pattern
`tests/unit/message-list-bulk-restore-errors.test.tsx`. Existing
`message-list-bulk-restore-errors.test.tsx` passes unchanged; the codex source
guard passes against `message-row.tsx`. Manual (if the app can run:
`xvfb-run --auto-servernum pnpm run electron:dev`): scroll a large folder, expand
a thread, drag a multi-selection onto a sidebar folder, archive → next message
scrolls into view.

## Done criteria

- [ ] `pnpm install --frozen-lockfile` exit 0; `@tanstack/react-virtual` in root `package.json`
- [ ] `pnpm run typecheck`, `pnpm run lint`, `pnpm run test:unit`, `pnpm run build` exit 0
- [ ] `pnpm run test:ui:coverage:check` passes
- [ ] `grep -n "useVirtualizer" src/components/email/message-list.tsx` matches; `grep -n "React.memo" src/components/email/message-row.tsx` matches; `grep -n "ScrollArea\|document.querySelector" src/components/email/message-list.tsx` → nothing
- [ ] `git status` shows only in-scope files
- [ ] Row in `plans/README.md` (Runde 2) updated, checkbox in `plans/MASTERPLAN.md` ticked

## STOP conditions

- `message-list.tsx` excerpts (line ranges above, `ScrollArea`, the
  `querySelector` effect, inline row map) do not match HEAD.
- `pnpm add` fails (release-age policy, peer conflict, proxy) — report; do not
  hand-edit the lockfile or vendor the package.
- The virtualization test cannot mount rows even with the `offsetHeight` stub
  (library behavior differs from the facts above) — report the version and what
  `getVirtualItems()` returned.
- Rows overlap / expanded thread children are clipped / drag stops producing a
  payload / `scrollToIndex` lands on the wrong row, and you cannot fix it within
  `message-list.tsx` + `message-row.tsx`.
- A fix appears to need `mail-shell.tsx`, `scroll-area.tsx` or the paging hook.

## Maintenance notes

- Reviewer: every `<MessageRow>` prop must be a primitive, a stable callback
  (`onOpen` from props, `toggleCheckbox` — stable only because `selectableIds` is
  memoized, `toggleThreadExpand`/`buildDragIds` with `[]` deps), or a stable
  reference (`accounts`, `searchNeedles`, `NO_CHILDREN`, cached thread arrays).
  An inline `[]` or arrow in the props silently defeats the memo for all rows.
- Tradeoff: native scrollbar instead of the Radix styled one.
- `mailView`/`searchActive` changes re-render all mounted rows — fine (bounded).
- Deferred: the in-memory list still grows with "Weitere laden"; a windowed data
  fetch is a separate topic.
