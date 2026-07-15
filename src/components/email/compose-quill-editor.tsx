"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import Quill from "quill"
import "quill/dist/quill.snow.css"
import "@/styles/compose-quill.css"
import { cn } from "@/lib/utils"
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html"

export type ComposeQuillEditorHandle = {
  /** Focuses the editor and restores a usable cursor position. */
  focus: () => boolean
  /** Latest HTML from the editor DOM (avoids stale React state on save/close). */
  getHtml: () => string
  /** Current non-empty selection as plain text, or null if nothing is selected. */
  getSelectionText: () => string | null
  /** Replaces the current selection with plain text (newlines preserved).
   *  Returns false if there is no active selection to replace. */
  replaceSelectionText: (text: string) => boolean
  /** Inserts plain text at the last known cursor (or current selection start). */
  insertTextAtCursor: (text: string) => boolean
  /** Whether a cursor position or selection is known in the editor. */
  hasKnownCursor: () => boolean
}

type Props = {
  value: string
  onChange: (html: string) => void
  /** Host div classes (e.g. flex-1 for fill-height compose layout). */
  className?: string
}

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

/** React 19–compatible Quill host (react-quill still calls removed findDOMNode). */
export const ComposeQuillEditor = forwardRef<ComposeQuillEditorHandle, Props>(
  function ComposeQuillEditor({ value, onChange, className }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const quillRef = useRef<Quill | null>(null)
    const onChangeRef = useRef(onChange)
    const syncingExternalRef = useRef(false)

    useEffect(() => {
      onChangeRef.current = onChange
    }, [onChange])

    // Remember the last cursor/selection: clicking the AI prompt dropdown steals
    // focus from the editor, which collapses Quill's selection. We capture it on
    // selection-change and reuse it when the transform runs.
    const lastRangeRef = useRef<{ index: number; length: number } | null>(null)

    const syncHtmlFromQuill = () => {
      const quill = quillRef.current
      if (!quill) return
      const html = sanitizeEmailHtml(quill.root.innerHTML)
      onChangeRef.current(
        html === "<p><br></p>" ? "" : html,
      )
    }

    useImperativeHandle(ref, () => ({
      focus: () => {
        const quill = quillRef.current
        if (!quill) return false
        const selection = quill.getSelection()
        quill.focus()
        if (!selection) {
          const index = Math.max(0, quill.getLength() - 1)
          quill.setSelection(index, 0, "api")
          lastRangeRef.current = { index, length: 0 }
        }
        return true
      },
      getHtml: () => {
        const quill = quillRef.current
        if (!quill) return ""
        const html = sanitizeEmailHtml(quill.root.innerHTML)
        return html === "<p><br></p>" ? "" : html
      },
      getSelectionText: () => {
        const quill = quillRef.current
        if (!quill) return null
        const range = quill.getSelection() ?? lastRangeRef.current
        if (!range || range.length <= 0) return null
        const text = quill.getText(range.index, range.length)
        return text.trim() ? text : null
      },
      replaceSelectionText: (text: string) => {
        const quill = quillRef.current
        if (!quill) return false
        const range = quill.getSelection() ?? lastRangeRef.current
        if (!range || range.length <= 0) return false
        quill.deleteText(range.index, range.length, "user")
        quill.insertText(range.index, text, "user")
        // Keep the inserted text selected so the user sees what changed.
        quill.setSelection(range.index, text.length, "user")
        lastRangeRef.current = { index: range.index, length: text.length }
        syncHtmlFromQuill()
        return true
      },
      insertTextAtCursor: (text: string) => {
        const quill = quillRef.current
        if (!quill || !text) return false
        const range = quill.getSelection() ?? lastRangeRef.current
        if (!range) return false
        const insertAt = range.index
        const prefix = insertAt > 0 ? "\n\n" : ""
        const suffix = insertAt < quill.getLength() - 1 ? "\n\n" : ""
        quill.insertText(insertAt, `${prefix}${text}${suffix}`, "user")
        const nextIndex = insertAt + prefix.length + text.length + suffix.length
        quill.setSelection(nextIndex, 0, "user")
        lastRangeRef.current = { index: nextIndex, length: 0 }
        syncHtmlFromQuill()
        return true
      },
      hasKnownCursor: () => {
        const quill = quillRef.current
        if (!quill) return false
        return (quill.getSelection() ?? lastRangeRef.current) != null
      },
    }))

    useEffect(() => {
      const container = containerRef.current
      if (!container) return

      const editorEl = document.createElement("div")
      container.appendChild(editorEl)

      const quill = new Quill(editorEl, {
        theme: "snow",
        modules: {
          toolbar: {
            container: TOOLBAR,
            handlers: {
              image: function imageHandler(this: { quill: Quill }) {
                const input = document.createElement("input")
                input.setAttribute("type", "file")
                input.setAttribute("accept", "image/*")
                input.click()
                input.onchange = () => {
                  const file = input.files?.[0]
                  if (!file) return
                  const reader = new FileReader()
                  reader.onload = () => {
                    const url = reader.result as string
                    const range = this.quill.getSelection(true)
                    this.quill.insertEmbed(range?.index ?? 0, "image", url)
                  }
                  reader.readAsDataURL(file)
                }
              },
            },
          },
        },
        placeholder: "Nachricht verfassen…",
      })
      quillRef.current = quill

      if (value) {
        syncingExternalRef.current = true
        quill.clipboard.dangerouslyPasteHTML(sanitizeEmailHtml(value))
        syncingExternalRef.current = false
      }

      quill.on("text-change", () => {
        if (syncingExternalRef.current) return
        const html = sanitizeEmailHtml(quill.root.innerHTML)
        onChangeRef.current(html === "<p><br></p>" ? "" : html)
      })

      quill.on("selection-change", (range, _oldRange, source) => {
        // Cache cursor/selection before focus moves to a toolbar control
        // (e.g. the AI prompt dropdown) and Quill reports null.
        if (range) {
          lastRangeRef.current = range
          return
        }
        // The user actively deselected (source === 'user'): drop the cache.
        // Programmatic/silent changes (focus stolen by the prompt dropdown)
        // leave the cache intact.
        if (source === "user") lastRangeRef.current = null
      })

      return () => {
        quillRef.current = null
        container.innerHTML = ""
      }
    }, [])

    useEffect(() => {
      const quill = quillRef.current
      if (!quill) return
      const current = quill.root.innerHTML
      const safeValue = sanitizeEmailHtml(value)
      const normalized = safeValue || "<p><br></p>"
      if (current === normalized || (value === "" && current === "<p><br></p>")) return
      syncingExternalRef.current = true
      if (safeValue) {
        quill.clipboard.dangerouslyPasteHTML(safeValue)
      } else {
        quill.setText("")
      }
      syncingExternalRef.current = false
    }, [value])

    return (
      <div
        ref={containerRef}
        className={cn("flex min-h-[12rem] flex-1 flex-col", className)}
      />
    )
  },
)
