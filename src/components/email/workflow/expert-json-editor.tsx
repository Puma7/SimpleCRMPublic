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

export function ExpertJsonEditor({ value, onChange, height = "200px" }: Props) {
  return (
    <Suspense
      fallback={
        <textarea
          className="min-h-[120px] w-full rounded-md border bg-background p-2 font-mono text-xs"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      }
    >
      <div className="overflow-hidden rounded-md border" style={{ height }}>
        <MonacoEditor
          height={height}
          defaultLanguage="json"
          theme="vs-dark"
          value={value}
          onChange={(v) => onChange(v ?? "")}
          options={{
            minimap: { enabled: false },
            fontSize: 12,
            lineNumbers: "off",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
          }}
        />
      </div>
    </Suspense>
  )
}
