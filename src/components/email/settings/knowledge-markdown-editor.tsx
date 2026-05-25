"use client"

import { lazy, Suspense } from "react"
import { Loader2 } from "lucide-react"

const MonacoEditor = lazy(async () => {
  const mod = await import("@monaco-editor/react")
  return { default: mod.default }
})

type Props = {
  value: string
  onChange: (value: string) => void
  height?: string
}

export function KnowledgeMarkdownEditor({ value, onChange, height = "360px" }: Props) {
  return (
    <Suspense
      fallback={
        <textarea
          className="min-h-[280px] w-full rounded-md border bg-background p-3 font-mono text-sm"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          spellCheck={false}
        />
      }
    >
      <div className="overflow-hidden rounded-md border" style={{ height }}>
        <MonacoEditor
          height={height}
          defaultLanguage="markdown"
          theme="vs"
          value={value}
          onChange={(v) => onChange(v ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            padding: { top: 12 },
          }}
        />
      </div>
    </Suspense>
  )
}
