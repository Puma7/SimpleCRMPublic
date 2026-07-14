"use client"

import { useEffect, useRef } from "react"
import Quill from "quill"
import "quill/dist/quill.snow.css"
import "@/styles/compose-quill.css"
import { SIGNATURE_QUILL_TOOLBAR } from "@shared/signature-quill-toolbar"
import { cn } from "@/lib/utils"
import { sanitizeEmailHtml } from "@/lib/sanitize-email-html"

type Props = {
  value: string
  onChange: (html: string) => void
  className?: string
  placeholder?: string
}

/** Compact Quill editor for HTML email signatures (settings). */
export function SignatureQuillEditor({
  value,
  onChange,
  className,
  placeholder = "Signatur verfassen…",
}: Props) {
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

    const quill = new Quill(editorEl, {
      theme: "snow",
      modules: { toolbar: SIGNATURE_QUILL_TOOLBAR },
      placeholder,
    })
    quillRef.current = quill

    if (value) {
      syncingExternalRef.current = true
      quill.clipboard.dangerouslyPasteHTML(sanitizeEmailHtml(value))
      syncingExternalRef.current = false
    }

    quill.on("text-change", () => {
      if (syncingExternalRef.current) return
      const html = quill.root.innerHTML
      onChangeRef.current(html === "<p><br></p>" ? "" : sanitizeEmailHtml(html))
    })

    return () => {
      quillRef.current = null
      container.innerHTML = ""
    }
  }, [placeholder])

  useEffect(() => {
    const quill = quillRef.current
    if (!quill) return
    const current = quill.root.innerHTML
    const normalized = value || "<p><br></p>"
    if (current === normalized || (value === "" && current === "<p><br></p>")) return
    syncingExternalRef.current = true
    if (value) {
      quill.clipboard.dangerouslyPasteHTML(sanitizeEmailHtml(value))
    } else {
      quill.setText("")
    }
    syncingExternalRef.current = false
  }, [value])

  return (
    <div
      ref={containerRef}
      className={cn("compose-quill min-h-[8rem] rounded-md border bg-background", className)}
    />
  )
}
