"use client"

import { useEffect, useRef } from "react"
import Quill from "quill"
import "quill/dist/quill.snow.css"
import "@/styles/compose-quill.css"

type Props = {
  value: string
  onChange: (html: string) => void
}

/** React 19–compatible Quill host (react-quill still calls removed findDOMNode). */
export function ComposeQuillEditor({ value, onChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const quillRef = useRef<Quill | null>(null)
  const onChangeRef = useRef(onChange)
  const syncingExternalRef = useRef(false)

  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const editorEl = document.createElement("div")
    container.appendChild(editorEl)

    const quill = new Quill(editorEl, { theme: "snow" })
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

  return <div ref={containerRef} />
}
