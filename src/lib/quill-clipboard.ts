import type Quill from "quill"
import { sanitizeEmailHtml } from "./sanitize-email-html"

/**
 * Quill's copy/cut handler exports getSemanticHTML(), independently of the
 * editor's sanitized root.innerHTML change handler. Sanitize at that boundary
 * while leaving plain text, selection and cut deletion to Quill.
 */
export function sanitizeQuillClipboard(quill: Pick<Quill, "clipboard">): void {
  const onCopy = quill.clipboard.onCopy.bind(quill.clipboard)
  quill.clipboard.onCopy = (range, isCut) => {
    const content = onCopy(range, isCut)
    return { ...content, html: sanitizeEmailHtml(content.html) }
  }
}
