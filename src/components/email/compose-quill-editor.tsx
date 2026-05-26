"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react"
import Quill from "quill"
import "quill/dist/quill.snow.css"
import "@/styles/compose-quill.css"

export type ComposeQuillEditorHandle = {
  /** Latest HTML from the editor DOM (avoids stale React state on save/close). */
  getHtml: () => string
}

type Props = {
  value: string
  onChange: (html: string) => void
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
  function ComposeQuillEditor({ value, onChange }, ref) {
    const containerRef = useRef<HTMLDivElement>(null)
    const quillRef = useRef<Quill | null>(null)
    const onChangeRef = useRef(onChange)
    const syncingExternalRef = useRef(false)

    useEffect(() => {
      onChangeRef.current = onChange
    }, [onChange])

    useImperativeHandle(ref, () => ({
      getHtml: () => {
        const quill = quillRef.current
        if (!quill) return ""
        const html = quill.root.innerHTML
        return html === "<p><br></p>" ? "" : html
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

    return <div ref={containerRef} className="min-h-[280px]" />
  },
)
