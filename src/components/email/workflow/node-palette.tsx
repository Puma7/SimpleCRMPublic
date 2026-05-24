"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type { WorkflowNodeCatalogEntry } from "@shared/workflow-types"
import { Filter, GitBranch, Plus } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWorkflowEditorStore } from "@/app/email/stores/workflow-editor-store"
import { hasElectron, invokeIpc } from "../types"

function makeNodeId(prefix: string): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${uuid}`
}

export function NodePalette() {
  const [catalog, setCatalog] = useState<WorkflowNodeCatalogEntry[]>([])

  useEffect(() => {
    if (!hasElectron()) return
    void invokeIpc<WorkflowNodeCatalogEntry[]>(IPCChannels.Email.ListWorkflowNodeCatalog).then(
      setCatalog,
    )
  }, [])

  const addCondition = () => {
    const id = makeNodeId("condition")
    const cur = useWorkflowEditorStore.getState().nodes
    const last = cur[cur.length - 1]
    const y = last ? last.position.y + 120 : 120
    useWorkflowEditorStore.getState().setNodes([
      ...cur,
      {
        id,
        type: "condition",
        position: { x: 40, y },
        data: { field: "subject", op: "contains", value: "", caseInsensitive: true },
      },
    ])
  }

  const addLegacyAction = (actionType: string, extra: Record<string, unknown> = {}) => {
    const id = makeNodeId("action")
    const cur = useWorkflowEditorStore.getState().nodes
    const last = cur[cur.length - 1]
    const y = last ? last.position.y + 120 : 120
    useWorkflowEditorStore.getState().setNodes([
      ...cur,
      {
        id,
        type: "action",
        position: { x: 40, y },
        data: { actionType, ...extra },
      },
    ])
  }

  const addRegistryNode = (entry: WorkflowNodeCatalogEntry) => {
    const id = makeNodeId("registry")
    const cur = useWorkflowEditorStore.getState().nodes
    const last = cur[cur.length - 1]
    const y = last ? last.position.y + 120 : 120
    useWorkflowEditorStore.getState().setNodes([
      ...cur,
      {
        id,
        type: "registry",
        position: { x: 40, y },
        data: {
          nodeType: entry.type,
          config: { ...(entry.defaultConfig ?? {}) },
        },
      },
    ])
  }

  const registryOnly = catalog.filter((c) => c.canvasType === "registry")

  return (
    <div className="flex max-h-[420px] w-56 flex-col gap-1.5 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
      <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Hinzufügen
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-8 justify-start gap-2 px-2"
        onClick={addCondition}
      >
        <Filter className="h-3.5 w-3.5 text-amber-500" />
        <span className="text-xs">Bedingung</span>
        <Plus className="ml-auto h-3 w-3 text-muted-foreground" />
      </Button>
      <div className="px-1 pt-1 text-[10px] font-semibold uppercase text-muted-foreground">
        Standard-Aktionen
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 justify-start px-2 text-xs"
        onClick={() => addLegacyAction("tag", { tag: "" })}
      >
        Tag setzen
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 justify-start px-2 text-xs"
        onClick={() => addLegacyAction("mark_seen")}
      >
        Als gelesen
      </Button>
      <ScrollArea className="flex-1">
        <div className="space-y-0.5 pr-1">
          {registryOnly.map((e) => (
            <Button
              key={e.type}
              type="button"
              size="sm"
              variant="ghost"
              className="h-auto min-h-7 w-full justify-start whitespace-normal px-2 py-1 text-left text-xs"
              onClick={() => addRegistryNode(e)}
            >
              <GitBranch className="mr-1 h-3 w-3 shrink-0 text-sky-500" />
              {e.label}
            </Button>
          ))}
        </div>
      </ScrollArea>
    </div>
  )
}
