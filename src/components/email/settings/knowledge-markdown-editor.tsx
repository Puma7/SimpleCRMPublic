"use client"

import { AppMonacoEditor } from "@/components/shared/app-monaco-editor"

type Props = {
  value: string
  onChange: (value: string) => void
  height?: string
}

export function KnowledgeMarkdownEditor({
  value,
  onChange,
  height = "min(360px, calc(100vh - 14rem))",
}: Props) {
  return (
    <div className="overflow-hidden rounded-md border" style={{ height }}>
      <AppMonacoEditor
        height={height}
        defaultLanguage="markdown"
        theme="vs"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        loadingFallback={
          <textarea
            className="min-h-[280px] w-full rounded-md border-0 bg-background p-3 font-mono text-sm"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
        }
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
  )
}
