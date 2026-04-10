"use client"

import { Filter, GitBranch, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useWorkflowEditorStore } from "@/app/email/stores/workflow-editor-store"

// `crypto.randomUUID()` is available in modern Electron renderer processes
// (Chromium) and all recent browsers. Falls back to a timestamp+random suffix
// for the unlikely case it's missing.
function makeNodeId(prefix: string): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${uuid}`
}

export function NodePalette() {
  const addNode = (type: "condition" | "action") => {
    const id = makeNodeId(type)
    const cur = useWorkflowEditorStore.getState().nodes
    const last = cur[cur.length - 1]
    const y = last ? last.position.y + 120 : 120
    const n =
      type === "condition"
        ? {
            id,
            type: "condition" as const,
            position: { x: 40, y },
            data: { field: "subject", op: "contains", value: "", caseInsensitive: true },
          }
        : {
            id,
            type: "action" as const,
            position: { x: 40, y },
            data: { actionType: "tag", tag: "" },
          }
    useWorkflowEditorStore.getState().setNodes([...cur, n])
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
      <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Hinzufügen
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 justify-start gap-2 px-2"
        onClick={() => addNode("condition")}
      >
        <Filter className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs">Bedingung</span>
        <Plus className="ml-auto h-3 w-3 text-muted-foreground" />
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 justify-start gap-2 px-2"
        onClick={() => addNode("action")}
      >
        <GitBranch className="h-3.5 w-3.5 text-sky-500" />
        <span className="text-xs">Aktion</span>
        <Plus className="ml-auto h-3 w-3 text-muted-foreground" />
      </Button>
    </div>
  )
}
