"use client"

import { AppMonacoEditor } from "@/components/shared/app-monaco-editor"

type Props = {
  value: string
  onChange: (value: string) => void
  height?: string
}

export function ExpertJsonEditor({ value, onChange, height = "200px" }: Props) {
  return (
    <div className="overflow-hidden rounded-md border" style={{ height }}>
      <AppMonacoEditor
        height={height}
        defaultLanguage="json"
        theme="vs-dark"
        value={value}
        onChange={(v) => onChange(v ?? "")}
        loadingFallback={
          <textarea
            className="min-h-[120px] w-full rounded-md border-0 bg-background p-2 font-mono text-xs"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        }
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
  )
}
