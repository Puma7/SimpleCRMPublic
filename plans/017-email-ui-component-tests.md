# Plan 017: Add component/interaction tests for the highest-value email UI

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`),
> unless a reviewer dispatched you and told you they maintain the index.
>
> **Drift check (run first)**: `git diff --stat f24fb27..HEAD -- tests/unit/message-addresses-block.test.tsx tests/unit/message-filter-chips.test.tsx tests/unit/external-link-confirm-dialog.test.tsx tests/unit/compose-quill-editor.test.tsx jest.server.config.cjs server-coverage-baseline.json`
> The four `tests/unit/*.test.tsx` files do **not** exist at `f24fb27` (this plan
> creates them) — no output for them is normal. `jest.server.config.cjs` and
> `server-coverage-baseline.json` are created by **plan 003** (this plan depends
> on it): they will show as added in the diff once 003 has landed. That is the
> expected dependency, not drift.
>
> **Secondary drift check (code under test)**: this plan hand-writes tests
> against four source components that it does **not** modify. Run
> `git diff --stat f24fb27..HEAD -- src/components/email/compose-quill-editor.tsx src/components/email/message-addresses-block.tsx src/components/email/message-filter-chips.tsx src/components/email/external-link-confirm-dialog.tsx shared/email-sender-trust.ts shared/email-external-url.ts tests/unit/mail-settings-server-client-ui.test.tsx`.
> If any of those changed since `f24fb27`, compare the "Current state" excerpts
> below against the live code before writing the tests; on a mismatch (a renamed
> export, changed German label, changed toolbar array, etc.), treat it as a STOP
> condition and adjust the assertions to the live text rather than guessing.

## Status

- **Priority**: P3
- **Effort**: M
- **Risk**: LOW
- **Depends on**: plans/003-server-edition-coverage-ratchet.md
- **Category**: tests
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

`src/components/email/**` is **96 files** — the message viewer, the compose Quill
editor, the settings dialog and ~10 settings panels, plus many dialogs — and only
a handful of `.tsx` render tests touch any of it
(`tests/unit/mail-settings-server-client-ui.test.tsx`,
`tests/unit/email-module-layout.test.tsx`,
`tests/unit/apply-workflow-menu-server-client.test.tsx`). The root Jest coverage
allowlist (`jest.config.cjs` → `collectCoverageFrom`) lists **none** of
`src/components/email/**`, so no coverage floor applies to this tree at all;
regressions in the most security- and workflow-critical email UI go completely
unmeasured. This plan adds render/interaction tests for the highest-value
components — the compose editor, a message-viewer sub-component that drives fraud
detection, the message-list filter control, and the external-link security gate —
following the exact pattern of the existing passing email `.tsx` tests, and folds
`src/components/email/**` into the ratcheted coverage floor that plan 003
introduces so this area can no longer silently erode. It deliberately covers a
**top handful** of components, not all 96 — the coverage ratchet then lets that
floor rise as more tests are added later.

## Current state

### Files this plan creates (none exist at `f24fb27`)

- `tests/unit/message-addresses-block.test.tsx`
- `tests/unit/message-filter-chips.test.tsx`
- `tests/unit/external-link-confirm-dialog.test.tsx`
- `tests/unit/compose-quill-editor.test.tsx`

### Files this plan modifies (both created by plan 003 — must be present)

- `jest.server.config.cjs` — plan 003's dedicated coverage config; this plan
  appends `src/components/email/**` to its `collectCoverageFrom`.
- `server-coverage-baseline.json` — plan 003's committed ratchet baseline; this
  plan regenerates it so it reflects the widened coverage scope.

### The test conventions to match — exemplar files (read but do not modify)

The repo's email `.tsx` tests live in `tests/unit/*.test.tsx`, use
`@testing-library/react` + jsdom (the `unit` Jest project), the `@/` path alias
(`@/components/...`, `@/services/...`), and `jest-dom` matchers such as
`toBeInTheDocument` (registered globally by `tests/setup/jest.setup.ts`, which
does `import '@testing-library/jest-dom';`). **Primary exemplar to mirror:**
`tests/unit/mail-settings-server-client-ui.test.tsx`. Its top of file:

```
tests/unit/mail-settings-server-client-ui.test.tsx:1
  import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
  ...
  import { AccountForm } from '@/components/email/settings/account-form';
  ...
  jest.mock('sonner', () => ({ toast: { error: jest.fn(), success: jest.fn() } }));
```

**Second exemplar** — how to mock a module dependency with a `mock`-prefixed
outer variable (jest hoists `jest.mock` above imports; the factory may only
reference variables whose name begins with `mock`):
`tests/unit/apply-workflow-menu-server-client.test.tsx:12`
(`let mockOpenMenu: (() => void) | null = null;` referenced inside
`jest.mock('@/components/ui/dropdown-menu', ...)`).

Jest config facts (from `jest.config.cjs`, do not change):
- `moduleNameMapper`: `'^@/(.*)$' → '<rootDir>/src/$1'`,
  `'^@shared/(.*)$' → '<rootDir>/shared/$1'`.
- `unit` project: `testEnvironment: 'jsdom'`,
  `testMatch: ['<rootDir>/tests/unit/**/*.test.(ts|tsx)']`,
  `setupFilesAfterEnv: ['<rootDir>/tests/setup/jest.setup.ts']`.
- There is **no** `moduleNameMapper` entry for `\.css$`. A component that imports
  a CSS file directly (only `compose-quill-editor.tsx` among the four targets
  does) must have those CSS imports mocked in its test, or ts-jest will try to
  parse the CSS as TypeScript and fail. Step 4 handles this.

### Target 1 — `src/components/email/message-addresses-block.tsx` (134 lines)

A pure message-viewer sub-component. Renders the sender, recipients, and a
suspicious-sender alert. Key excerpts:

```
src/components/email/message-addresses-block.tsx:43
  export function MessageAddressesBlock({ message, accounts, onShowCorrespondentHistory }: Props) {
```
```
src/components/email/message-addresses-block.tsx:76-97
  <span className="font-medium text-muted-foreground">Von:</span>
  {senderDisplayName ? (<span ...>{senderDisplayName}</span>) : null}
  <span ... title="Tatsächliche Absenderadresse">{senderAddress}</span>
```
```
src/components/email/message-addresses-block.tsx:103-107
  {trust.level === "suspicious" && trust.reason ? (
    <p className="text-xs font-medium text-destructive" role="alert">
      Verdacht auf verschleierten Absender: {trust.reason}
    </p>
  ) : null}
```
```
src/components/email/message-addresses-block.tsx:108-110
  <RecipientLine label="An" value={to} />
  <RecipientLine label="Cc" value={cc} />
  <RecipientLine label="Bcc" value={bcc} />
```
```
src/components/email/message-addresses-block.tsx:127-131
  {message.ticket_code ? (
    <p ...>Ticket: <span className="font-mono">{message.ticket_code}</span></p>
  ) : null}
```
`trust` comes from `analyzeSenderTrust(effectiveFromJson)`
(`shared/email-sender-trust.ts:57`). It returns `{ level: 'suspicious', reason }`
when the display name **contains an email address that differs from the real From
address** — e.g. name `"service@paypal.com"`, address `"attacker@evil.example"`
(see `shared/email-sender-trust.ts:65-76`). Recipient lines are rendered by
`recipientFieldFromJson(json)` (`shared/email-recipient-parse.ts:37`), which turns
`{"value":[{"address":"team@firma.de"}]}` into the string `"team@firma.de"`.
`EmailMessage` is a type in `src/components/email/types.ts:77` (fields include
`id, account_id, folder_id, uid, subject, snippet, date_received, from_json,
to_json, cc_json, bcc_json, body_text, body_html, seen_local, folder_kind,
ticket_code`).

### Target 2 — `src/components/email/message-filter-chips.tsx` (42 lines)

Message-list filter control. Reads `useMailWorkspace()` and renders five chips:

```
src/components/email/message-filter-chips.tsx:6-16
  const CHIPS: { id: MessageListFilter; label: string; title?: string }[] = [
    { id: "all", label: "Alle" },
    { id: "unread", label: "Ungelesen" },
    { id: "attachment", label: "Mit Anhang" },
    { id: "customer", label: "Kundenverknüpft", title: ... },
    { id: "workflow", label: "Workflow betroffen" },
  ]
```
```
src/components/email/message-filter-chips.tsx:18-29
  export function MessageFilterChips({ className }: { className?: string }) {
    const { messageListFilter, setMessageListFilter } = useMailWorkspace()
    return (
      <div ... role="group" aria-label="Filter">
        {CHIPS.map((chip) => (
          <button ... aria-label={`Filter: ${chip.label}`} ...
            onClick={() => setMessageListFilter(chip.id)} ...>
```
`useMailWorkspace` (`src/components/email/workspace-context.tsx:439`) throws if
used outside its provider, so the test mocks the whole module.

### Target 3 — `src/components/email/external-link-confirm-dialog.tsx` (95 lines)

The security gate for opening links in a mail body. Exports a **hook**
`useExternalLinkConfirm()` returning `{ handleBodyLinkClick, dialog }`:

```
src/components/email/external-link-confirm-dialog.tsx:20-30
  export function useExternalLinkConfirm() {
    const [pendingUrl, setPendingUrl] = useState<string | null>(null)
    const requestOpen = useCallback((href: string) => {
      const parsed = parseExternalMailLink(href)
      if (!parsed.ok) {
        toast.error("Dieser Link kann aus Sicherheitsgründen nicht geöffnet werden.")
        return
      }
      setPendingUrl(parsed.url)
    }, [])
```
```
src/components/email/external-link-confirm-dialog.tsx:32-43
  const handleBodyLinkClick = useCallback((event) => {
    const anchor = (event.target as HTMLElement).closest("a[href]")
    if (!anchor) return
    const href = anchor.getAttribute("href")
    if (!href) return
    event.preventDefault(); event.stopPropagation(); requestOpen(href)
  }, [requestOpen])
```
```
src/components/email/external-link-confirm-dialog.tsx:45-60
  const confirmOpen = useCallback(async () => {
    if (!pendingUrl) return
    try {
      if (hasLocalIpc()) { await invokeIpc(...) }
      else { openExternalUrlInBrowser(pendingUrl) }
    } catch (e) { toast.error(...) } finally { setPendingUrl(null) }
  }, [pendingUrl])
```
The dialog renders a Radix `AlertDialog` (open when `pendingUrl != null`) with
title **"Link im Browser öffnen?"**, the URL in a `<p>`, a cancel button
**"Abbrechen"** and an action button **"Im Browser öffnen"** whose `onClick`
calls `confirmOpen` (lines 62-92). In jsdom with no `window.electronAPI`,
`hasLocalIpc()` (`src/components/email/types.ts:181`) returns `false`, so
`confirmOpen` takes the browser branch and calls `openExternalUrlInBrowser`
(imported from `./external-link-open`). `parseExternalMailLink`
(`shared/email-external-url.ts:15`) rejects `javascript:` URLs (`ok:false`) and
accepts `https:` URLs, returning `{ ok:true, url: <href> }`.

### Target 4 — `src/components/email/compose-quill-editor.tsx` (207 lines)

The compose editor: a React-19–compatible host around Quill.

```
src/components/email/compose-quill-editor.tsx:1-7
  "use client"
  import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
  import Quill from "quill"
  import "quill/dist/quill.snow.css"
  import "@/styles/compose-quill.css"
  import { cn } from "@/lib/utils"
```
```
src/components/email/compose-quill-editor.tsx:30-40
  const TOOLBAR = [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ indent: "-1" }, { indent: "+1" }],
    ["blockquote", "code-block"],
    ["link", "image"],
    [{ color: [] }, { background: [] }],
    [{ align: [] }],
    ["clean"],
  ]
```
```
src/components/email/compose-quill-editor.tsx:67-73  (imperative handle)
  getHtml: () => {
    const quill = quillRef.current
    if (!quill) return ""
    const html = quill.root.innerHTML
    return html === "<p><br></p>" ? "" : html
  },
```
```
src/components/email/compose-quill-editor.tsx:124-164  (mount)
  const quill = new Quill(editorEl, {
    theme: "snow",
    modules: { toolbar: { container: TOOLBAR, handlers: { image: ... } } },
    placeholder: "Nachricht verfassen…",
  })
  quillRef.current = quill
  ...
  quill.on("text-change", () => {
    if (syncingExternalRef.current) return
    const html = quill.root.innerHTML
    onChangeRef.current(html === "<p><br></p>" ? "" : html)
  })
```
The component imports two CSS files and the `quill` package directly. The test
(Step 4) mocks the `quill` module with a controllable fake and mocks both CSS
imports, then asserts the React wiring: the constructor options (placeholder +
toolbar), that `text-change` forwards `root.innerHTML` to `onChange` (empty
`<p><br></p>` becoming `""`), and that the `getHtml()` handle delegates to the
mock's `root.innerHTML`. This is the correct unit boundary and does not depend on
Quill actually rendering in jsdom.

### Plan 003's coverage config this plan extends (`jest.server.config.cjs`)

Plan 003 creates this file with (see plans/003, Step 1):

```
collectCoverageFrom: [
  'packages/server/src/**/*.ts',
  '!packages/server/src/**/*.d.ts',
],
```

It spreads the base `jest.config.cjs` (keeping its `unit` + `integration`
projects), sets `collectCoverage: true`, `coverageReporters: [..., 'json-summary']`,
`coverageDirectory: coverage/server`, and `coverageThreshold: {}` (no hard gate —
the floor is the ratchet script `scripts/check-server-coverage-ratchet.mjs`
against `server-coverage-baseline.json`). Because `collectCoverageFrom` forces
Jest (v8 provider) to report **every** matching file — including files no test
imports, which show as 0% — appending `src/components/email/**/*.tsx` makes all 96
email component files count toward the ratcheted floor. The email `.tsx` tests run
in the `unit` (jsdom) project, so the files they exercise are instrumented.

## Commands you will need

| Purpose   | Command                                             | Expected on success |
|-----------|-----------------------------------------------------|---------------------|
| Install   | `pnpm install --frozen-lockfile`                    | exit 0              |
| Targeted test | `pnpm test -- tests/unit/<file>.test.tsx`       | that suite passes   |
| All tests | `pnpm test`                                         | all suites pass     |
| Lint      | `pnpm run lint`                                     | exit 0 (eslint, `--max-warnings 0`) |
| Server+email coverage (plan 003) | `pnpm run test:server:coverage` | Jest passes; writes `coverage/server/coverage-summary.json` |
| Regenerate baseline (plan 003)   | `pnpm run test:server:coverage:update-baseline` | writes `server-coverage-baseline.json`, exit 0 |
| Ratchet check (plan 003)         | `node scripts/check-server-coverage-ratchet.mjs` | prints "Server coverage meets baseline", exit 0 |
| Typecheck | `npx tsc -p tsconfig.json --noEmit`                 | exit 0, no errors   |

Package manager is **pnpm** (see `.github/workflows/ci.yml`). Do not substitute
npm/yarn. There is no `typecheck` script yet (plan 002 adds it); use the `tsc`
command above. `pnpm test` is `jest --passWithNoTests`; `pnpm test -- <path>`
filters to a file across the `unit`/`integration` projects.

## Suggested executor toolkit

- No special skills required — this is four Jest `.tsx` test files plus a one-line
  config edit and a baseline regeneration.
- Before writing each test, open the primary exemplar
  `tests/unit/mail-settings-server-client-ui.test.tsx` and copy its imports,
  `jest.mock('sonner', ...)` shape, `beforeEach`/`afterEach` reset structure, and
  assertion style (`screen.getByText`, `findByText`, `fireEvent.click`).

## Scope

**In scope** (the only files you may create or modify):

- `tests/unit/message-addresses-block.test.tsx` (create)
- `tests/unit/message-filter-chips.test.tsx` (create)
- `tests/unit/external-link-confirm-dialog.test.tsx` (create)
- `tests/unit/compose-quill-editor.test.tsx` (create)
- `jest.server.config.cjs` (edit — append two globs; created by plan 003)
- `server-coverage-baseline.json` (regenerate + commit; created by plan 003)

**Out of scope** (do NOT touch, even though they look related):

- Any file under `src/components/email/**` — you are testing these components, not
  changing them. If a test only passes after editing the component, STOP (the
  test is wrong, or you found a real bug to report, not silently patch).
- `shared/email-sender-trust.ts`, `shared/email-external-url.ts`,
  `shared/email-recipient-parse.ts`, `src/components/email/types.ts` — real
  helpers the components use; read for accurate assertions, do not modify.
- `jest.config.cjs` — the base config and its 90% `collectCoverageFrom` allowlist
  are read only. Do **not** add `src/components/email/**` there; that gate is a
  hard 90% threshold and four tests won't meet it. The email fold-in goes into
  plan 003's `jest.server.config.cjs` ratchet, which has no hard threshold.
- `scripts/check-server-coverage-ratchet.mjs` — plan 003's script; do not edit.
- The other ~92 email components and the remaining settings panels — out of scope
  by design (top handful only; the ratchet lets the floor rise later).

## Git workflow

- Branch: `advisor/017-email-ui-component-tests`
- Commit style: Conventional Commits (repo convention — e.g. from `git log`:
  `fix(review): keep raw-headers / .eml export out of the mail read bucket`).
  Suggested messages:
  - `test(mail): render tests for message addresses block and filter chips`
  - `test(mail): interaction tests for external-link gate and compose editor`
  - `test(mail): fold src/components/email into the server coverage ratchet`
  One commit per step or a single squashed commit is fine, **except** the
  regenerated `server-coverage-baseline.json` (Step 5) must be committed.
- Do NOT push or open a PR unless the operator explicitly instructs it.

## Steps

Steps 1–4 add tests and are independent of plan 003. Step 5 requires plan 003 to
have landed. If `jest.server.config.cjs` does not exist when you reach Step 5, do
Steps 1–4, then STOP and report that plan 003 must land first (see STOP conditions).

### Step 1: Test the message-addresses block (message-viewer fraud highlighting)

Create `tests/unit/message-addresses-block.test.tsx` with exactly this content:

```tsx
import { render, screen } from '@testing-library/react';

import { MessageAddressesBlock } from '@/components/email/message-addresses-block';
import type { EmailMessage } from '@/components/email/types';

function message(overrides: Partial<EmailMessage> = {}): EmailMessage {
  return {
    id: 1,
    account_id: 1,
    folder_id: 1,
    uid: 1,
    subject: 'Hallo',
    snippet: null,
    date_received: '2026-01-02T10:00:00.000Z',
    from_json: JSON.stringify({ value: [{ name: 'Anna Kundin', address: 'anna@kunde.de' }] }),
    to_json: JSON.stringify({ value: [{ address: 'team@firma.de' }] }),
    cc_json: null,
    bcc_json: null,
    body_text: null,
    body_html: null,
    seen_local: 1,
    folder_kind: 'inbox',
    ...overrides,
  } as EmailMessage;
}

describe('MessageAddressesBlock', () => {
  test('renders sender name, real address, recipients and ticket code', () => {
    render(<MessageAddressesBlock message={message({ ticket_code: 'T-42' })} />);

    expect(screen.getByText('Von:')).toBeInTheDocument();
    expect(screen.getByText('Anna Kundin')).toBeInTheDocument();
    expect(screen.getByText('anna@kunde.de')).toBeInTheDocument();
    expect(screen.getByText('team@firma.de')).toBeInTheDocument();
    expect(screen.getByText('T-42')).toBeInTheDocument();
    // A trustworthy sender must not raise the spoofing alert.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('flags a spoofed sender whose display name hides a different address', () => {
    render(
      <MessageAddressesBlock
        message={message({
          from_json: JSON.stringify({
            value: [{ name: 'service@paypal.com', address: 'attacker@evil.example' }],
          }),
        })}
      />,
    );

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/Verdacht auf verschleierten Absender/);
    // The real (dangerous) address is surfaced verbatim.
    expect(screen.getByText('attacker@evil.example')).toBeInTheDocument();
  });
});
```

**Verify**: `pnpm test -- tests/unit/message-addresses-block.test.tsx` → the suite
passes (2 tests). If a `getByText` fails on an ambiguity or a whitespace mismatch,
open the live component and match the exact rendered text before retrying (do not
change the component).

### Step 2: Test the message-list filter chips (interaction)

Create `tests/unit/message-filter-chips.test.tsx` with exactly this content:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';

const mockSetMessageListFilter = jest.fn();

jest.mock('@/components/email/workspace-context', () => ({
  useMailWorkspace: () => ({
    messageListFilter: 'all',
    setMessageListFilter: mockSetMessageListFilter,
  }),
}));

import { MessageFilterChips } from '@/components/email/message-filter-chips';

describe('MessageFilterChips', () => {
  beforeEach(() => {
    mockSetMessageListFilter.mockClear();
  });

  test('renders the five filter chips inside a labelled group', () => {
    render(<MessageFilterChips />);

    expect(screen.getByRole('group', { name: 'Filter' })).toBeInTheDocument();
    for (const label of ['Alle', 'Ungelesen', 'Mit Anhang', 'Kundenverknüpft', 'Workflow betroffen']) {
      expect(screen.getByRole('button', { name: `Filter: ${label}` })).toBeInTheDocument();
    }
  });

  test('clicking a chip sets that filter on the workspace', () => {
    render(<MessageFilterChips />);

    fireEvent.click(screen.getByRole('button', { name: 'Filter: Ungelesen' }));
    expect(mockSetMessageListFilter).toHaveBeenCalledWith('unread');

    fireEvent.click(screen.getByRole('button', { name: 'Filter: Workflow betroffen' }));
    expect(mockSetMessageListFilter).toHaveBeenCalledWith('workflow');
  });
});
```

Note: the `jest.mock` factory references `mockSetMessageListFilter` — this is
allowed only because its name begins with `mock` (jest hoists `jest.mock` above
the imports). The `import { MessageFilterChips }` line is placed **after** the
`jest.mock` call on purpose so the mock is registered first.

**Verify**: `pnpm test -- tests/unit/message-filter-chips.test.tsx` → the suite
passes (2 tests).

### Step 3: Test the external-link security gate (interaction)

Create `tests/unit/external-link-confirm-dialog.test.tsx` with exactly this
content:

```tsx
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';

import { useExternalLinkConfirm } from '@/components/email/external-link-confirm-dialog';

const mockOpenExternal = jest.fn();

jest.mock('sonner', () => ({
  toast: { error: jest.fn(), success: jest.fn() },
}));

jest.mock('@/components/email/external-link-open', () => ({
  openExternalUrlInBrowser: (...args: unknown[]) => mockOpenExternal(...args),
}));

function Harness() {
  const { handleBodyLinkClick, dialog } = useExternalLinkConfirm();
  return (
    <div>
      {/* eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events */}
      <div onClick={handleBodyLinkClick}>
        <a href="https://example.com/path">Sichere Adresse</a>
        <a href="javascript:alert(1)">Boese Adresse</a>
      </div>
      {dialog}
    </div>
  );
}

describe('useExternalLinkConfirm', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    delete (window as any).electronAPI;
  });

  test('rejects an unsafe javascript: link with a toast and no dialog', () => {
    render(<Harness />);

    fireEvent.click(screen.getByText('Boese Adresse'));

    expect(toast.error).toHaveBeenCalledWith(
      'Dieser Link kann aus Sicherheitsgründen nicht geöffnet werden.',
    );
    expect(screen.queryByText('Link im Browser öffnen?')).not.toBeInTheDocument();
  });

  test('confirms a safe https link and opens it in the browser', async () => {
    render(<Harness />);

    fireEvent.click(screen.getByText('Sichere Adresse'));

    // Dialog shows the exact URL for the user to verify.
    expect(screen.getByText('Link im Browser öffnen?')).toBeInTheDocument();
    expect(screen.getByText('https://example.com/path')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Im Browser öffnen' }));

    await waitFor(() =>
      expect(mockOpenExternal).toHaveBeenCalledWith('https://example.com/path'),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
```

If the Radix `AlertDialog` throws or fails to render in jsdom (rare, but Radix
occasionally needs pointer-capture shims), fall back to mocking the UI primitive
with plain pass-through elements — mirror the dropdown-menu mock in
`tests/unit/apply-workflow-menu-server-client.test.tsx:26`. Add at the top of the
test file:

```tsx
jest.mock('@/components/ui/alert-dialog', () => ({
  AlertDialog: ({ open, children }: any) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: any) => <div>{children}</div>,
  AlertDialogHeader: ({ children }: any) => <div>{children}</div>,
  AlertDialogFooter: ({ children }: any) => <div>{children}</div>,
  AlertDialogTitle: ({ children }: any) => <h2>{children}</h2>,
  AlertDialogDescription: ({ children }: any) => <div>{children}</div>,
  AlertDialogCancel: ({ children, ...p }: any) => <button {...p}>{children}</button>,
  AlertDialogAction: ({ children, ...p }: any) => <button {...p}>{children}</button>,
}));
```

Use this fallback only if the un-mocked dialog does not work after one honest
attempt; the assertions above are unchanged.

**Verify**: `pnpm test -- tests/unit/external-link-confirm-dialog.test.tsx` → the
suite passes (2 tests).

### Step 4: Test the compose Quill editor (mocked Quill + CSS)

Create `tests/unit/compose-quill-editor.test.tsx` with exactly this content:

```tsx
import { createRef } from 'react';
import { act, render } from '@testing-library/react';

const mockQuillInstances: Array<{
  root: HTMLDivElement;
  options: any;
  handlers: Record<string, (...a: any[]) => void>;
}> = [];

jest.mock('quill/dist/quill.snow.css', () => ({}));
jest.mock('@/styles/compose-quill.css', () => ({}));

jest.mock('quill', () => {
  class MockQuill {
    root = document.createElement('div');
    handlers: Record<string, (...a: any[]) => void> = {};
    clipboard = {
      dangerouslyPasteHTML: (html: string) => {
        this.root.innerHTML = html;
      },
    };
    constructor(_el: HTMLElement, public options: any) {
      this.root.innerHTML = '<p><br></p>';
      mockQuillInstances.push(this);
    }
    on(evt: string, cb: (...a: any[]) => void) {
      this.handlers[evt] = cb;
    }
    getSelection() {
      return null;
    }
    getText() {
      return '';
    }
    getLength() {
      return 1;
    }
    setText() {
      this.root.innerHTML = '<p><br></p>';
    }
    deleteText() {}
    insertText() {}
    setSelection() {}
  }
  return { __esModule: true, default: MockQuill };
});

import {
  ComposeQuillEditor,
  type ComposeQuillEditorHandle,
} from '@/components/email/compose-quill-editor';

const EXPECTED_TOOLBAR = [
  [{ header: [1, 2, 3, false] }],
  ['bold', 'italic', 'underline', 'strike'],
  [{ list: 'ordered' }, { list: 'bullet' }],
  [{ indent: '-1' }, { indent: '+1' }],
  ['blockquote', 'code-block'],
  ['link', 'image'],
  [{ color: [] }, { background: [] }],
  [{ align: [] }],
  ['clean'],
];

describe('ComposeQuillEditor', () => {
  beforeEach(() => {
    mockQuillInstances.length = 0;
  });

  test('mounts Quill with the compose toolbar and placeholder', () => {
    render(<ComposeQuillEditor value="" onChange={jest.fn()} />);

    expect(mockQuillInstances).toHaveLength(1);
    const inst = mockQuillInstances[0]!;
    expect(inst.options.placeholder).toBe('Nachricht verfassen…');
    expect(inst.options.modules.toolbar.container).toEqual(EXPECTED_TOOLBAR);
  });

  test('forwards editor changes to onChange, normalizing empty content to ""', () => {
    const onChange = jest.fn();
    render(<ComposeQuillEditor value="" onChange={onChange} />);
    const inst = mockQuillInstances[0]!;

    inst.root.innerHTML = '<p>Hallo Welt</p>';
    act(() => inst.handlers['text-change']!());
    expect(onChange).toHaveBeenCalledWith('<p>Hallo Welt</p>');

    inst.root.innerHTML = '<p><br></p>';
    act(() => inst.handlers['text-change']!());
    expect(onChange).toHaveBeenLastCalledWith('');
  });

  test('getHtml() handle returns editor HTML and "" for the empty placeholder', () => {
    const ref = createRef<ComposeQuillEditorHandle>();
    render(<ComposeQuillEditor value="" onChange={jest.fn()} ref={ref} />);
    const inst = mockQuillInstances[0]!;

    inst.root.innerHTML = '<p>Text</p>';
    expect(ref.current!.getHtml()).toBe('<p>Text</p>');

    inst.root.innerHTML = '<p><br></p>';
    expect(ref.current!.getHtml()).toBe('');
  });
});
```

Why the mock is correct: the component does `import Quill from "quill"` and calls
`new Quill(editorEl, { placeholder, modules: { toolbar: { container: TOOLBAR }}})`;
the `text-change` listener reads `quill.root.innerHTML` and forwards it (or `""`
for `<p><br></p>`) to `onChange`; and the `getHtml` handle applies the same
normalization. The `MockQuill` captures the constructor `options` and the
`text-change` callback so the test can drive them deterministically without a real
DOM editor. The two `jest.mock('...css', () => ({}))` calls stop ts-jest from
trying to compile the CSS imports as TypeScript.

**Verify**: `pnpm test -- tests/unit/compose-quill-editor.test.tsx` → the suite
passes (3 tests). If the default import of the mocked `quill` module comes through
as `undefined` (esModule interop edge), confirm the mock returns
`{ __esModule: true, default: MockQuill }` exactly as above before retrying.

### Step 5: Fold `src/components/email/**` into plan 003's coverage ratchet

**Precondition**: `jest.server.config.cjs` and `server-coverage-baseline.json`
exist (plan 003 has landed). If not, STOP (see STOP conditions).

In `jest.server.config.cjs`, extend the `collectCoverageFrom` array so it also
covers the email components. Change:

```js
  collectCoverageFrom: [
    'packages/server/src/**/*.ts',
    '!packages/server/src/**/*.d.ts',
  ],
```

to:

```js
  collectCoverageFrom: [
    'packages/server/src/**/*.ts',
    '!packages/server/src/**/*.d.ts',
    'src/components/email/**/*.tsx',
    '!src/components/email/**/*.d.ts',
  ],
```

Then regenerate and commit the baseline (its numbers will **drop**, because ~96
mostly-untested email files are now counted — this is expected and correct; the
ratchet only ever moves the floor **up** from here):

```
pnpm run test:server:coverage:update-baseline
git add jest.server.config.cjs server-coverage-baseline.json
```

**Verify**:
- `node -e "const c=require('./jest.server.config.cjs'); process.exit(c.collectCoverageFrom.includes('src/components/email/**/*.tsx') ? 0 : 1)"`
  → exit 0 (the glob is present).
- `node scripts/check-server-coverage-ratchet.mjs` → exit 0, prints
  `Server coverage meets baseline: { … }` (the just-regenerated baseline equals
  the current snapshot).
- `git status --porcelain server-coverage-baseline.json` → shows it staged;
  `git status --porcelain coverage/` → shows nothing (coverage output is
  `.gitignore`d).

### Step 6: Full local gate

Run the checks CI will run, on the whole tree:

```
pnpm run lint
pnpm test
npx tsc -p tsconfig.json --noEmit
```

Each exits 0; `pnpm test` reports the four new suites (9 new tests total) passing
alongside the existing suites.

**Verify**: all three commands exit 0. `pnpm test` output includes
`message-addresses-block`, `message-filter-chips`, `external-link-confirm-dialog`,
and `compose-quill-editor` among the passing suites.

## Test plan

- **`tests/unit/message-addresses-block.test.tsx`** (Step 1) — renders
  `MessageAddressesBlock`. Cases: (a) a trustworthy message shows sender name,
  real address, the `An` recipient, and ticket code, with **no** `role="alert"`;
  (b) a spoofed sender (display name embeds a different email address) raises the
  `role="alert"` "Verdacht auf verschleierten Absender" and surfaces the real
  address. Guards the fraud-detection highlighting.
- **`tests/unit/message-filter-chips.test.tsx`** (Step 2) — renders
  `MessageFilterChips` with `useMailWorkspace` mocked. Cases: (a) all five chips
  render inside the `role="group"` labelled "Filter"; (b) clicking a chip calls
  `setMessageListFilter` with the correct id (`unread`, `workflow`).
- **`tests/unit/external-link-confirm-dialog.test.tsx`** (Step 3) — drives the
  `useExternalLinkConfirm` hook via a harness. Cases: (a) an unsafe
  `javascript:` link is rejected with the security toast and no dialog;
  (b) a safe `https:` link opens the confirm dialog showing the URL, and
  confirming calls `openExternalUrlInBrowser` with that URL. Guards the
  link-safety gate.
- **`tests/unit/compose-quill-editor.test.tsx`** (Step 4) — renders
  `ComposeQuillEditor` with `quill` and its CSS mocked. Cases: (a) Quill is
  constructed with the compose toolbar and German placeholder; (b) `text-change`
  forwards HTML to `onChange`, normalizing `<p><br></p>` to `""`;
  (c) the `getHtml()` handle returns the editor HTML and `""` for empty.
- Structural pattern for all four: `tests/unit/mail-settings-server-client-ui.test.tsx`
  (imports, `jest.mock('sonner', ...)`, `beforeEach` resets, `screen`/`fireEvent`
  assertions) and, for module mocking, `tests/unit/apply-workflow-menu-server-client.test.tsx`.
- Coverage integration (Step 5): `src/components/email/**` is added to plan 003's
  ratchet scope and the baseline regenerated, so this tree now has an enforced,
  ratcheting floor in CI.
- Verification: `pnpm test` → all suites pass, including the four new files
  (9 new tests).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `tests/unit/message-addresses-block.test.tsx`, `tests/unit/message-filter-chips.test.tsx`, `tests/unit/external-link-confirm-dialog.test.tsx`, and `tests/unit/compose-quill-editor.test.tsx` all exist and each passes via `pnpm test -- tests/unit/<file>.test.tsx`
- [ ] `pnpm test` exits 0 with all suites passing (the four new suites among them)
- [ ] `pnpm run lint` exits 0 (no eslint warnings — `--max-warnings 0`)
- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `jest.server.config.cjs` `collectCoverageFrom` includes `'src/components/email/**/*.tsx'` and `'!src/components/email/**/*.d.ts'`
- [ ] `node scripts/check-server-coverage-ratchet.mjs` exits 0 and prints `Server coverage meets baseline`
- [ ] `server-coverage-baseline.json` regenerated and staged; `coverage/` is not staged (`git status --porcelain coverage/` empty)
- [ ] No files outside the six in-scope paths are modified (`git status`); in particular no file under `src/components/email/**` and not `jest.config.cjs`
- [ ] `plans/README.md` status row for plan 017 updated (unless a reviewer owns the index)

## STOP conditions

Stop and report back (do not improvise) if:

- The secondary drift check shows a target component or a helper drifted since
  `f24fb27` and the "Current state" excerpt no longer matches — e.g. `TOOLBAR` in
  `compose-quill-editor.tsx` changed, the "Nachricht verfassen…" placeholder or
  the "Link im Browser öffnen?"/"Im Browser öffnen" labels changed, the
  `role="alert"` "Verdacht auf verschleierten Absender" wording changed, or a
  tested export was renamed. Adjust assertions to the live text only if the change
  is a trivial rename; otherwise stop and report.
- A test only passes after editing a file under `src/components/email/**` (or any
  out-of-scope source). Either your test is wrong (fix the test) or you found a
  real component bug — report it; do not patch the component to make a test green.
- **Step 5 precondition unmet**: `jest.server.config.cjs` or
  `server-coverage-baseline.json` does not exist (plan 003 has not landed).
  Complete Steps 1–4, commit them, then STOP and report that Step 5 needs plan 003.
- The regenerated `server-coverage-baseline.json` has every metric `0`/`null`, or
  the ratchet reports the summary has no `total` — that signals mis-instrumentation
  (the email glob didn't match or the config didn't load the base projects), not
  genuine zero coverage. Do not commit it; report it.
- Any single verification command fails twice after one honest fix attempt (for
  the Radix dialog specifically, the fallback mock in Step 3 counts as that
  attempt).

## Maintenance notes

For the human/agent who owns this after it lands:

- **Raising the floor**: as more email component tests are added, run
  `pnpm run test:server:coverage:update-baseline` and commit the higher
  `server-coverage-baseline.json`. The baseline should only ever move up; a PR
  that lowers it means coverage regressed and should be scrutinized.
- **Scope of plan 003's config**: after this plan, `jest.server.config.cjs` is no
  longer server-only — its `collectCoverageFrom` also covers
  `src/components/email/**`. Its `text-summary`/`json-summary` numbers are the
  union of `packages/server/src` and the email components. Keep that in mind when
  reading the ratchet output; the config name still says "server" for continuity
  with plan 003.
- **Reviewer focus**: confirm no file under `src/components/email/**` was modified
  (these tests must characterize existing behavior, not change it); confirm
  `jest.config.cjs`'s 90% allowlist/threshold was **not** touched; confirm the
  four new tests assert on stable user-facing text/roles (German labels, `role`)
  rather than CSS classes; and confirm `coverage/` was not committed.
- **The Quill mock (Step 4)** tests the React host wiring, not Quill's own
  rendering. If the compose editor is migrated off Quill or the imperative handle
  (`getHtml`/`getSelectionText`/`insertTextAtCursor`) changes shape, this test's
  mock and assertions must be revisited.
- **Follow-up deferred (intentional)**: this plan covers a top handful of the 96
  email components (compose editor, one message-viewer sub-component, the filter
  chips, the link gate). The message viewer proper (`message-viewer.tsx`, ~1774
  lines), the settings dialog/panels beyond those in
  `mail-settings-server-client-ui.test.tsx`, and the compose/metadata dialogs
  remain untested — the ratchet now prevents backsliding while that work happens
  incrementally.
