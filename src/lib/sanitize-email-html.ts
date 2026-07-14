import DOMPurify from "dompurify"

/** Sanitize rich text before it enters an editor, application preview, or mail payload. */
export function sanitizeEmailHtml(html: string): string {
  return DOMPurify.sanitize(html, { USE_PROFILES: { html: true } })
}
