# Plan 011: Render sanitized email HTML in a sandboxed iframe instead of the app DOM

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in the `README.md` of the directory this plan lives in (`plans/README.md`)
> — unless a reviewer dispatched you and told you they maintain the index
> (the advisor maintains `plans/README.md` for this batch, so do NOT create
> or edit it unless asked).
>
> **Drift check (run first)**: `git diff --stat f24fb27..HEAD -- src/components/email/message-viewer.tsx src/components/email/email-html-frame.tsx tests/unit/email-html-frame.test.tsx`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `f24fb27`, 2026-07-10

## Why this matters

The email message viewer sanitizes an untrusted `body_html` with DOMPurify and
then injects it straight into the privileged renderer DOM via
`dangerouslySetInnerHTML`. DOMPurify is today the **only** barrier between
attacker-controlled email markup and the Electron renderer / server-client
session (which holds an access token in memory). A future DOMPurify mutation-XSS
(mXSS) bypass — a known, recurring class of vulnerability — would execute script
in that trusted context. Separately, inline CSS / `<style>` blocks survive
sanitization, so a crafted email can paint clickjacking overlays *inside the
trusted app chrome*. This is defense-in-depth hardening, not a live exploit:
moving the rendered body into a `<iframe sandbox>` with a restrictive CSP means
that even if DOMPurify is bypassed, the payload runs (a) with no script
permission, (b) in an opaque origin with no access to the parent DOM, tokens, or
cookies, and (c) visually boxed so overlays cannot cover the real UI. DOMPurify
stays as the inner layer.

## Current state

Files involved:

- `src/components/email/message-viewer.tsx` — the message reader. Computes the
  sanitized body and injects it into the app DOM. This is the file to change.
- `shared/email-html-remote-images.ts` — `blockRemoteImagesInHtml()` /
  `htmlHasRemoteResources()`; replaces remote image/style URLs with local
  placeholders for the privacy toggle. **Do not change** — keep calling it.
- `src/components/email/external-link-confirm-dialog.tsx` — `useExternalLinkConfirm()`
  returns `{ handleBodyLinkClick, dialog }`; today `handleBodyLinkClick` is wired
  to the body `<div>`'s `onClick` to intercept link clicks and open a confirm
  dialog. This interception cannot reach content inside a script-less,
  cross-origin iframe (see Step 3 + Maintenance notes). **Do not change** the
  hook; you only stop wiring `handleBodyLinkClick` to the body.
- `src/components/lab/svelte-lab-frame.tsx` — the repo's one existing `<iframe>`
  usage; use it as the JSX/prop exemplar (note: it uses `src`, not `srcDoc`, and
  a *looser* sandbox than we need — do NOT copy its sandbox value).

### The sanitize step — `message-viewer.tsx:399-416` (keep as-is; it is the inner layer)

```tsx
  const sanitizedHtml = useMemo(() => {
    if (!selectedMessage?.body_html) return ""
    const clean = DOMPurify.sanitize(selectedMessage.body_html, {
      USE_PROFILES: { html: true },
      FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "link"],
      FORBID_ATTR: [
        "onerror", "onload", "onclick", "onmouseover",
        "onfocus", "onblur", "onchange", "onsubmit",
      ],
    })
    return loadRemoteImages ? clean : blockRemoteImagesInHtml(clean)
  }, [selectedMessage?.body_html, loadRemoteImages])
```

`loadRemoteImages` is the existing state that the remote-image toggle flips
(`message-viewer.tsx:264`, `:1361`, `:1377`). When it is `false`, remote URLs are
already rewritten to placeholders by `blockRemoteImagesInHtml`. When it is `true`,
raw remote URLs are kept — so the iframe CSP must *also* permit remote image loads
in that case, or opted-in images silently break.

### The vulnerable injection — `message-viewer.tsx:1443-1448` (this is what you replace)

```tsx
                    <div
                      role="document"
                      className="prose prose-sm dark:prose-invert max-w-none rounded-md border bg-background p-3 [&_a]:cursor-pointer [&_a]:break-all [&_a]:text-primary [&_a]:underline"
                      dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
                      onClick={handleBodyLinkClick}
                    />
```

This lives inside the `{htmlView && selectedMessage.body_html ? ( ... ) : ( ... )}`
branch that starts at `message-viewer.tsx:1347`. The plaintext branch (the `else`,
`:1450-1477`, a `<pre>`) is unaffected and must stay unchanged.

### The hook destructure — `message-viewer.tsx:278`

```tsx
  const { handleBodyLinkClick, dialog: externalLinkDialog } = useExternalLinkConfirm()
```

`externalLinkDialog` is also rendered near the end of the component
(`message-viewer.tsx:1771`, `{externalLinkDialog}`). After this change
`handleBodyLinkClick` is no longer used; leaving it destructured will fail lint
(`--max-warnings 0`, `@typescript-eslint/no-unused-vars`). You will drop only
`handleBodyLinkClick` from the destructure and keep `dialog: externalLinkDialog`.

### The helper text — `message-viewer.tsx:1349-1352` (must be updated to stay truthful)

```tsx
                    <p className="text-[10px] text-muted-foreground">
                      HTML-Ansicht: Skripte und Formulare sind blockiert. Externe Bilder nur nach
                      explizitem Laden. Links öffnen nach Bestätigung im Standard-Browser.
                    </p>
```

The last sentence ("Links öffnen nach Bestätigung im Standard-Browser") becomes
false after this change — links inside a fully-sandboxed iframe are inert. Update
it (Step 2).

### Print path — `message-viewer.tsx:690-745` (verify it still works; do NOT rewire it)

`handlePrintMessageOnly` reads `sanitizedHtml` and writes it into a *separate*
`window.open` document that already has its own restrictive CSP
(`message-viewer.tsx:717`). It does not depend on the in-DOM body `<div>`, so it
keeps working as long as the `sanitizedHtml` useMemo stays. Keep `sanitizedHtml`.

### Repo conventions to match

- Component files: `"use client"` directive first line, named `export function`,
  `type Props = { ... }`, double-quoted imports, no semicolons (see
  `src/components/email/external-link-confirm-dialog.tsx` and
  `src/components/lab/svelte-lab-frame.tsx`).
- Frontend tests: Jest + `@testing-library/react`, jsdom, in `tests/unit/`,
  filename `*.test.tsx`. **Structural exemplar: `tests/unit/email-module-layout.test.tsx`.**
  `@testing-library/jest-dom` matchers are globally available
  (`tests/setup/jest.setup.ts` imports it), but plain matchers
  (`.toBeNull()`, `.toBe(true)`, `.toContain()`) are sufficient here.

## Commands you will need

| Purpose   | Command                                             | Expected on success            |
|-----------|-----------------------------------------------------|--------------------------------|
| Install   | `pnpm install --frozen-lockfile`                    | exit 0                         |
| Lint      | `pnpm run lint`                                      | exit 0 (eslint, --max-warnings 0) |
| Typecheck | `npx tsc -p tsconfig.json --noEmit`                 | exit 0, no errors (no `typecheck` script exists yet) |
| Test (new)| `pnpm test -- tests/unit/email-html-frame.test.tsx` | all pass                       |
| Test (all)| `pnpm test`                                         | all pass                       |
| Mail tests| `pnpm run test:mail`                                | all pass (unchanged — regression gate; this renderer file is not in the mail suite) |
| Build     | `pnpm run build`                                     | exit 0                         |

Package manager is **pnpm** (CI uses `pnpm install --frozen-lockfile`, see
`.github/workflows/ci.yml`). Do not substitute npm/yarn.

## Suggested executor toolkit

- After the code change, use the `verify` skill (if available) to drive the app
  and confirm the HTML view renders inside an iframe and that remote-image
  opt-in still loads images (see Step 4 verification). Do not rely on tests
  alone for the visual/layout behavior.

## Scope

**In scope** (the only files you should modify or create):

- `src/components/email/message-viewer.tsx` (modify)
- `src/components/email/email-html-frame.tsx` (create)
- `tests/unit/email-html-frame.test.tsx` (create)

**Out of scope** (do NOT touch, even though they look related):

- `shared/email-html-remote-images.ts` — remote-image blocking logic; keep
  calling it unchanged. Changing it risks the compose/outbound sanitizer that
  also imports it.
- `src/components/email/external-link-confirm-dialog.tsx` — the confirm-dialog
  hook. Leave it intact; a proper replacement for in-frame link opening is a
  deferred follow-up (Maintenance notes), not this plan.
- `electron/main.js` / any Electron main-process file — adding a
  `setWindowOpenHandler` to reinstate gated link opening is the deferred
  follow-up; not in this plan.
- The plaintext (`<pre>`) body branch and the print path — must keep working but
  need no edits.

## Git workflow

- Branch: `advisor/011-email-html-iframe-sandbox`
- Commit per logical unit; conventional-commit style (example from this repo's
  `git log`: `fix(review): keep raw-headers / .eml export out of the mail read bucket`).
  Suggested messages: `feat(mail): render email HTML in a sandboxed iframe`,
  `test(mail): assert email body renders in a sandboxed iframe`.
- Do NOT push or open a PR.

## Steps

### Step 1: Create the sandboxed iframe component

Create `src/components/email/email-html-frame.tsx`. It receives the
already-sanitized HTML (the DOMPurify output — the inner layer stays in
`message-viewer.tsx`) plus whether the user opted into remote content, and wraps
it in a full HTML document rendered through a fully-restricted `<iframe>`.

Requirements the component must satisfy (they are asserted by the Step 3 tests):

- Renders exactly one `<iframe>`.
- The iframe uses `srcDoc` (React prop; emits the `srcdoc` attribute). The body
  HTML must live inside `srcDoc`, never as live DOM in the parent tree.
- `sandbox=""` — the empty token list is the maximum-restriction sandbox: no
  `allow-scripts`, no `allow-same-origin`, no `allow-popups`, no
  `allow-top-navigation`, no `allow-forms`. Do NOT add any `allow-*` token.
- The srcDoc document embeds a restrictive CSP `<meta>` whose `img-src`/`font-src`
  depend on `allowRemote`, so the remote-image toggle still works.
- `referrerPolicy="no-referrer"`.

Write exactly this file:

```tsx
"use client"

import { useMemo } from "react"

type Props = {
  /** DOMPurify-sanitized (and, when remote is blocked, placeholder-rewritten) HTML body. */
  html: string
  /** True once the user opted into remote content — CSP then permits remote image/font loads. */
  allowRemote: boolean
  className?: string
  title?: string
}

// Defense-in-depth CSP applied *inside* the sandboxed document. `style-src
// 'unsafe-inline'` is required because email HTML relies on inline styles; that
// is safe here because the iframe is an isolated, script-less, opaque-origin box.
const CSP_BLOCKED =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:;"
const CSP_REMOTE =
  "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data: https:; media-src data: https:;"

// Emails render on white (like every standalone mail client) regardless of app
// theme, so dark-mode chrome does not bleed through transparent regions.
const BASE_STYLE =
  "html,body{margin:0;padding:12px;background:#ffffff;color:#111827;" +
  "font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;" +
  "font-size:14px;line-height:1.55;word-break:break-word;overflow-wrap:anywhere}" +
  "img{max-width:100%;height:auto}a{color:#1d4ed8}"

export function EmailHtmlFrame({ html, allowRemote, className, title = "E-Mail-Inhalt" }: Props) {
  const srcDoc = useMemo(() => {
    const csp = allowRemote ? CSP_REMOTE : CSP_BLOCKED
    return (
      `<!doctype html><html><head>` +
      `<meta charset="utf-8">` +
      `<meta http-equiv="Content-Security-Policy" content="${csp}">` +
      `<style>${BASE_STYLE}</style>` +
      `</head><body>${html}</body></html>`
    )
  }, [html, allowRemote])

  return (
    <iframe
      title={title}
      srcDoc={srcDoc}
      sandbox=""
      referrerPolicy="no-referrer"
      className={className}
    />
  )
}
```

**Verify**: `npx tsc -p tsconfig.json --noEmit` → exit 0, no errors.

### Step 2: Swap the injection for the iframe in `message-viewer.tsx`

1. Add the import (place it with the other `./`-relative email imports near the
   top, e.g. just after the `MessageAiSuggestions` import at
   `message-viewer.tsx:85`):

   ```tsx
   import { EmailHtmlFrame } from "./email-html-frame"
   ```

2. At `message-viewer.tsx:278`, drop the now-unused `handleBodyLinkClick`:

   ```tsx
   const { dialog: externalLinkDialog } = useExternalLinkConfirm()
   ```

3. Replace the body `<div>` at `message-viewer.tsx:1443-1448` with:

   ```tsx
                    <EmailHtmlFrame
                      html={sanitizedHtml}
                      allowRemote={loadRemoteImages}
                      title={selectedMessage.subject || "E-Mail-Inhalt"}
                      className="h-[min(70vh,900px)] w-full rounded-md border bg-white"
                    />
   ```

4. Update the helper text at `message-viewer.tsx:1349-1352` so it no longer
   claims links open after confirmation:

   ```tsx
                    <p className="text-[10px] text-muted-foreground">
                      HTML-Ansicht: Wird isoliert in einer Sandbox (iframe) ohne Skripte,
                      Formulare oder aktive Links angezeigt. Externe Bilder werden nur nach
                      explizitem Laden angezeigt.
                    </p>
   ```

Leave the `sanitizedHtml` useMemo (`:399-416`), the plaintext branch
(`:1450-1477`), `handlePrintMessageOnly` (`:690-745`), and `{externalLinkDialog}`
(`:1771`) untouched.

**Verify**:
- `npx tsc -p tsconfig.json --noEmit` → exit 0.
- `pnpm run lint` → exit 0 (confirms no unused `handleBodyLinkClick`).
- `git grep -n "dangerouslySetInnerHTML" src/components/email/message-viewer.tsx`
  → no matches.

### Step 3: Add the isolation test

Create `tests/unit/email-html-frame.test.tsx`, modeled structurally on
`tests/unit/email-module-layout.test.tsx` (import the component, `render`, query
`container`). It must assert the body is rendered *in an iframe, not injected into
the main tree*, and that the sandbox is strict.

```tsx
import { render } from '@testing-library/react';

import { EmailHtmlFrame } from '../../src/components/email/email-html-frame';

describe('EmailHtmlFrame', () => {
  test('renders the body inside an iframe, not as live DOM in the parent tree', () => {
    const html = '<p id="body-marker">Hallo Welt</p><script>window.__pwned=1</script>';
    const { container } = render(<EmailHtmlFrame html={html} allowRemote={false} />);

    const iframe = container.querySelector('iframe');
    expect(iframe).not.toBeNull();

    // The body must NOT be injected into the parent document.
    expect(container.querySelector('#body-marker')).toBeNull();
    expect(container.querySelector('script')).toBeNull();

    // It must live inside the iframe's srcdoc string instead.
    const srcdoc = iframe!.getAttribute('srcdoc') ?? '';
    expect(srcdoc).toContain('id="body-marker"');
  });

  test('sandbox grants neither scripts nor same-origin', () => {
    const { container } = render(<EmailHtmlFrame html="<p>x</p>" allowRemote={false} />);
    const iframe = container.querySelector('iframe')!;

    expect(iframe.hasAttribute('sandbox')).toBe(true);
    const sandbox = iframe.getAttribute('sandbox') ?? '';
    expect(sandbox).not.toContain('allow-scripts');
    expect(sandbox).not.toContain('allow-same-origin');
  });

  test('embeds a restrictive CSP and blocks remote images by default', () => {
    const { container } = render(<EmailHtmlFrame html="<p>x</p>" allowRemote={false} />);
    const srcdoc = container.querySelector('iframe')!.getAttribute('srcdoc') ?? '';

    expect(srcdoc).toContain('Content-Security-Policy');
    expect(srcdoc).toContain("default-src 'none'");
    expect(srcdoc).toContain('img-src data:');
    // Remote schemes are not permitted when the user has not opted in.
    expect(srcdoc).not.toContain('https:');
  });

  test('permits remote image loads once the user opts in', () => {
    const { container } = render(<EmailHtmlFrame html="<p>x</p>" allowRemote />);
    const srcdoc = container.querySelector('iframe')!.getAttribute('srcdoc') ?? '';

    expect(srcdoc).toContain('img-src data: https:');
  });
});
```

**Verify**: `pnpm test -- tests/unit/email-html-frame.test.tsx` → all 4 tests pass.

### Step 4: Full verification + manual layout/behavior check

Run the full gates, then drive the app to confirm the runtime behavior the tests
cannot cover (layout, remote-image opt-in, print).

**Verify**:
- `pnpm run lint` → exit 0
- `npx tsc -p tsconfig.json --noEmit` → exit 0
- `pnpm test` → all pass (including the 4 new tests)
- `pnpm run test:mail` → all pass (unchanged)
- `pnpm run build` → exit 0
- Manual (via the `run`/`verify` skill or a dev build): open an HTML email, click
  "HTML anzeigen". Confirm (a) the body renders inside a bordered box on white,
  (b) "Einmal laden" still reveals remote images (CSP switches to the remote
  variant), (c) "Drucken" still produces the print window with the body, (d) the
  email content does not overlap or cover the app toolbar/sidebar.

## Test plan

- New test file `tests/unit/email-html-frame.test.tsx` (unit / jsdom project),
  4 cases:
  1. **Isolation (the core regression this plan fixes)**: body HTML — including a
     `<script>` — is present only inside the iframe `srcdoc`, and neither
     `#body-marker` nor `<script>` appears as live DOM in the parent container.
  2. **Strict sandbox**: the `sandbox` attribute exists and contains neither
     `allow-scripts` nor `allow-same-origin`.
  3. **CSP + remote blocked by default**: srcdoc contains a `default-src 'none'`
     CSP with `img-src data:` and no remote scheme.
  4. **Remote opt-in**: with `allowRemote`, the CSP permits `img-src data: https:`.
- Structural pattern to copy: `tests/unit/email-module-layout.test.tsx`.
- Verification: `pnpm test -- tests/unit/email-html-frame.test.tsx` → all pass;
  then `pnpm test` → whole suite still green.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc -p tsconfig.json --noEmit` exits 0
- [ ] `pnpm run lint` exits 0
- [ ] `pnpm test` exits 0; the 4 new tests in `tests/unit/email-html-frame.test.tsx` exist and pass
- [ ] `pnpm run test:mail` exits 0
- [ ] `pnpm run build` exits 0
- [ ] `git grep -n "dangerouslySetInnerHTML" src/components/email/message-viewer.tsx` returns no matches
- [ ] `src/components/email/email-html-frame.tsx` renders an `<iframe>` with `sandbox=""` (no `allow-scripts`, no `allow-same-origin`)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated (unless the advisor owns the index)

## STOP conditions

Stop and report back (do not improvise) if:

- The code at the locations in "Current state" doesn't match the excerpts — e.g.
  the `dangerouslySetInnerHTML` is no longer at `message-viewer.tsx:1443-1448`, the
  sanitize memo has changed, or line `:278` differs (the codebase has drifted).
- Removing `handleBodyLinkClick` does NOT resolve to a clean lint — i.e.
  `handleBodyLinkClick` turns out to be referenced somewhere else you did not
  expect. Investigate before deleting.
- The manual check shows the HTML body no longer renders at all (blank iframe),
  or remote-image opt-in no longer loads images — the CSP variant switching is
  likely wrong; report rather than loosening the sandbox.
- Making links clickable again appears to require touching `electron/main.js`,
  `external-link-confirm-dialog.tsx`, or adding any `allow-*` sandbox token.
  That is a deliberately deferred follow-up (see Maintenance notes) — do not pull
  it into this plan. Inert links in the HTML view are the accepted, documented
  outcome of this change.
- Any step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

For the human/agent who owns this code after the change lands:

- **Reviewer focus**: confirm the iframe `sandbox` attribute has NO tokens (an
  accidental `allow-scripts` or `allow-same-origin` re-opens the exact hole this
  plan closes). Confirm DOMPurify is still applied to `body_html` before it
  reaches the iframe (the iframe is the *outer* layer, not a replacement for
  sanitization).
- **Behavior change (accepted, documented)**: links inside the HTML view are now
  inert — the previous per-link "confirm, then open in the default browser"
  dialog (`useExternalLinkConfirm`) is no longer reachable for body links, because
  a script-less, cross-origin sandboxed iframe cannot forward clicks to the React
  tree. The helper text was updated to say so. The `useExternalLinkConfirm` hook
  is still imported for its `dialog` (now effectively dead for this path); a
  follow-up can remove it or, preferably, reinstate gated link opening via an
  Electron `webContents.setWindowOpenHandler` in `electron/main.js` combined with
  `sandbox="allow-popups"` + anchor rewriting to `target="_blank"` — that handler
  would validate URLs with `parseExternalMailLink` (`shared/email-external-url.ts`)
  and call `shell.openExternal` (as `electron/ipc/update.ts:80` already does).
  That is a separate plan.
- **Layout change (accepted, documented)**: a cross-origin sandboxed iframe cannot
  be auto-sized to its content (the parent cannot read the child's scrollHeight),
  so the body now lives in a fixed-height (`h-[min(70vh,900px)]`) box that scrolls
  internally, and emails render on white regardless of app theme. If a future
  change needs content-height auto-fit, it must either accept `allow-same-origin`
  (which weakens this hardening and needs security sign-off) or use a `postMessage`
  resize handshake (which needs `allow-scripts` inside the frame — same caveat).
- **Print path**: `handlePrintMessageOnly` still consumes `sanitizedHtml`
  directly and opens its own CSP-scoped window; it is independent of the iframe.
  If `sanitizedHtml` is ever removed or renamed, update both the print path and
  `EmailHtmlFrame`'s caller together.
- **Remote-content CSP**: the `allowRemote` → CSP mapping in `EmailHtmlFrame` is
  the second gate behind `blockRemoteImagesInHtml`. If the remote-image policy
  model changes (e.g. per-domain allow-lists), keep the CSP `img-src` in sync so
  opted-in images actually load.
