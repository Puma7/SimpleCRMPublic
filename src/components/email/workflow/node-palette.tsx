"use client"

import type { WorkflowNodeCatalogEntry, WorkflowNodeCategory } from "@shared/workflow-types"
import {
  WORKFLOW_REGISTRY_CATEGORY_ORDER,
  WORKFLOW_CATEGORY_LABELS,
} from "@shared/workflow-ui-labels"
import {
  BrainCircuit,
  Code2,
  Filter,
  GitBranch,
  Mail,
  Plug,
  Plus,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useWorkflowEditorStore } from "@/app/email/stores/workflow-editor-store"
import { useWorkflowNodeCatalog } from "./use-workflow-node-catalog"

function makeNodeId(prefix: string): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${prefix}-${uuid}`
}

const CATEGORY_ICONS: Partial<Record<WorkflowNodeCategory, LucideIcon>> = {
  logic: GitBranch,
  email: Mail,
  crm: Users,
  ai: BrainCircuit,
  code: Code2,
  integration: Plug,
}

function categoryIcon(category: WorkflowNodeCategory): LucideIcon {
  return CATEGORY_ICONS[category] ?? GitBranch
}

function groupRegistryByCategory(entries: WorkflowNodeCatalogEntry[]) {
  const groups = new Map<WorkflowNodeCategory, WorkflowNodeCatalogEntry[]>()
  for (const e of entries) {
    const list = groups.get(e.category) ?? []
    list.push(e)
    groups.set(e.category, list)
  }
  for (const [, list] of groups) {
    list.sort((a, b) => a.label.localeCompare(b.label, "de"))
  }
  return WORKFLOW_REGISTRY_CATEGORY_ORDER.filter((c) => groups.has(c)).map((category) => ({
    category,
    entries: groups.get(category) ?? [],
  }))
}

export function NodePalette() {
  const { registryEntries } = useWorkflowNodeCatalog()
  const grouped = groupRegistryByCategory(registryEntries)

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
          label: entry.label,
          config: { ...(entry.defaultConfig ?? {}) },
        },
      },
    ])
  }

  return (
    <div className="flex max-h-[min(420px,70vh)] w-56 flex-col gap-1.5 rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
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
      <ScrollArea className="min-h-0 flex-1">
        <div className="space-y-2 pr-1">
          {grouped.map(({ category, entries }) => {
            const Icon = categoryIcon(category)
            return (
              <div key={category}>
                <div className="px-1 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {WORKFLOW_CATEGORY_LABELS[category]}
                </div>
                <div className="space-y-0.5">
                  {entries.map((e) => (
                    <Button
                      key={e.type}
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-auto min-h-7 w-full justify-start gap-1.5 whitespace-normal px-2 py-1 text-left text-xs"
                      onClick={() => addRegistryNode(e)}
                      title={e.description}
                    >
                      <Icon className="h-3 w-3 shrink-0 text-violet-500" />
                      {e.label}
                    </Button>
                  ))}
                </div>
              </div>
            )
          })}
          {grouped.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-muted-foreground">
              Erweiterte Knoten werden geladen…
            </p>
          ) : null}
        </div>
      </ScrollArea>
    </div>
  )
}
