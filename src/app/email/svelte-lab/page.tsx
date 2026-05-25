"use client"

import { FlaskConical } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { SvelteLabFrame } from "@/components/lab/svelte-lab-frame"

const LAB_URL =
  (import.meta.env.VITE_SVELTE_LAB_URL as string | undefined)?.trim() ||
  "http://127.0.0.1:5174"

export default function EmailSvelteLabPage() {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto p-4">
      <Card className="mb-4 shrink-0">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <FlaskConical className="h-5 w-5" />
            Svelte Lab (Beta)
          </CardTitle>
          <CardDescription>
            Experimentierbereich mit <code className="text-xs">@xyflow/svelte</code>. Läuft in
            einem eigenen Dev-Server ({LAB_URL}) — unabhängig vom React-Workflow-Editor (
            <code className="text-xs">@xyflow/react</code> v12). Zum Abschalten:{" "}
            <code className="text-xs">VITE_ENABLE_SVELTE_LAB=false</code> oder Variable entfernen.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Terminal: <code className="rounded bg-muted px-1">npm run svelte-lab:dev</code> (neben{" "}
          <code className="rounded bg-muted px-1">npm run electron:dev</code>).
        </CardContent>
      </Card>
      <SvelteLabFrame />
    </div>
  )
}
