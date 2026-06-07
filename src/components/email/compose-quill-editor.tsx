"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import Quill from "quill"
import "quill/dist/quill.snow.css"
import "@/styles/compose-quill.css"
import { cn } from "@/lib/utils"

export type ComposeQuillEditorHandle = {
  /** Latest HTML from the editor DOM (avoids stale React state on save/close). */
  getHtml: () => string
  /** Current non-empty selection as plain text, or null if nothing is selected. */
  getSelectionText: () => string | null
  /** Replaces the current selection with plain text (newlines preserved).
   *  Returns false if there is no active selection to replace. */
  replaceSelectionText: (text: string) => boolean
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

    // Remember the last real selection: clicking the AI prompt dropdown steals
    // focus from the editor, which collapses Quill's selection. We capture it on
    // selection-change and reuse it when the transform runs.
    const lastSelectionRef = useRef<{ index: number; length: number } | null>(null)

    useImperativeHandle(ref, () => ({
      getHtml: () => {
        const quill = quillRef.current
        if (!quill) return ""
        const html = quill.root.innerHTML
        return html === "<p><br></p>" ? "" : html
      },
      getSelectionText: () => {
        const quill = quillRef.current
        if (!quill) return null
        const range = quill.getSelection() ?? lastSelectionRef.current
        if (!range || range.length <= 0) return null
        const text = quill.getText(range.index, range.length)
        return text.trim() ? text : null
      },
      replaceSelectionText: (text: string) => {
        const quill = quillRef.current
        if (!quill) return false
        const range = quill.getSelection() ?? lastSelectionRef.current
        if (!range || range.length <= 0) return false
        quill.deleteText(range.index, range.length, "user")
        quill.insertText(range.index, text, "user")
        // Keep the inserted text selected so the user sees what changed.
        quill.setSelection(range.index, text.length, "user")
        lastSelectionRef.current = { index: range.index, length: text.length }
        onChangeRef.current(
          quill.root.innerHTML === "<p><br></p>" ? "" : quill.root.innerHTML,
        )
        return true
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
        quill.clipboard.dangerouslyPasteHTML(value)
        syncingExternalRef.current = false
      }

      quill.on("text-change", () => {
        if (syncingExternalRef.current) return
        const html = quill.root.innerHTML
        onChangeRef.current(html === "<p><br></p>" ? "" : html)
      })

      quill.on("selection-change", (range, _oldRange, source) => {
        // Cache the last non-empty selection before focus moves to a toolbar
        // control (e.g. the AI prompt dropdown) and Quill reports null.
        if (range && range.length > 0) {
          lastSelectionRef.current = range
          return
        }
        // The user actively moved the cursor or deselected (source === 'user'):
        // drop the cached range so a later AI transform doesn't reuse a stale
        // selection. Programmatic/silent changes (focus stolen by the prompt
        // dropdown) leave the cache intact, which is the entire point.
        if (source === "user") lastSelectionRef.current = null
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
      const normalized = value || "<p><br></p>"
      if (current === normalized || (value === "" && current === "<p><br></p>")) return
      syncingExternalRef.current = true
      if (value) {
        quill.clipboard.dangerouslyPasteHTML(value)
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
