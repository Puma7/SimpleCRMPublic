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
// `navigate-to 'none'` blocks the sandboxed frame from navigating itself on a
// link click (an empty `sandbox` still lets `<a href>` navigate the frame's own
// browsing context, which would fetch the remote URL and leak the click). Anchors
// are ALSO neutralized during sanitization (Step 2), so this is defense-in-depth
// for the case where a browser ignores `navigate-to`.
const CSP_BLOCKED =
  "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; navigate-to 'none';"
const CSP_REMOTE =
  "default-src 'none'; img-src data: https: http:; style-src 'unsafe-inline'; font-src data: https:; media-src data: https:; navigate-to 'none';"

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
