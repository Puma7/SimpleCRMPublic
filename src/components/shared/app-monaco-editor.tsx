"use client"

import { useEffect, useState, type ReactNode } from "react"
import type { EditorProps } from "@monaco-editor/react"
import { Loader2 } from "lucide-react"

import "@/lib/monaco-environment"

type Props = EditorProps & {
  loadingFallback?: ReactNode
}

let loaderConfigured = false

async function configureMonacoLoader(): Promise<void> {
  if (loaderConfigured) return
  const [{ loader }, monaco] = await Promise.all([
    import("@monaco-editor/react"),
    import("monaco-editor"),
  ])
  loader.config({ monaco })
  loaderConfigured = true
}

/**
 * Monaco via local `monaco-editor` bundle (no CDN). Avoids `React.lazy` +
 * `@monaco-editor/react` prebundle fetch failures in Vite dev.
 */
export function AppMonacoEditor({ loadingFallback, ...editorProps }: Props) {
  const [Editor, setEditor] = useState<typeof import("@monaco-editor/react").default | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await configureMonacoLoader()
        const mod = await import("@monaco-editor/react")
        if (!cancelled) setEditor(() => mod.default)
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Monaco konnte nicht geladen werden.")
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (error) {
    return (
      <p className="p-3 text-sm text-destructive" role="alert">
        {error}
      </p>
    )
  }

  if (!Editor) {
    return (
      loadingFallback ?? (
        <div className="flex h-full min-h-[120px] items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Editor wird geladen…
        </div>
      )
    )
  }

  return <Editor {...editorProps} />
}
