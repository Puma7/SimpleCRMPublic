"use client"

import { useMemo, useState } from "react"
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
  Search,
  Users,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

type PaletteItem = {
  id: string
  category: WorkflowNodeCategory | "standard"
  label: string
  description?: string
  icon: LucideIcon
  searchText: string
  onAdd: () => void
}

function normalizeSearch(s: string): string {
  return s.trim().toLocaleLowerCase("de")
}

function matchesQuery(item: PaletteItem, query: string): boolean {
  if (!query) return true
  return item.searchText.includes(query)
}

export function NodePalette() {
  const { registryEntries } = useWorkflowNodeCatalog()
  const [searchQuery, setSearchQuery] = useState("")
  const query = normalizeSearch(searchQuery)

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

  const allItems = useMemo((): PaletteItem[] => {
    const standard: PaletteItem[] = [
      {
        id: "condition",
        category: "standard",
        label: "Bedingung",
        description: "Wenn Betreff, Absender, Text …",
        icon: Filter,
        searchText: normalizeSearch(
          "bedingung condition filter wenn if subject absender",
        ),
        onAdd: addCondition,
      },
      {
        id: "legacy-tag",
        category: "standard",
        label: "Tag setzen",
        icon: Mail,
        searchText: normalizeSearch("tag setzen label standard aktion"),
        onAdd: () => addLegacyAction("tag", { tag: "" }),
      },
      {
        id: "legacy-mark_seen",
        category: "standard",
        label: "Als gelesen",
        icon: Mail,
        searchText: normalizeSearch("als gelesen mark seen gelesen standard"),
        onAdd: () => addLegacyAction("mark_seen"),
      },
    ]

    const registry: PaletteItem[] = registryEntries.map((e) => {
      const catLabel = WORKFLOW_CATEGORY_LABELS[e.category]
      return {
        id: e.type,
        category: e.category,
        label: e.label,
        description: e.description,
        icon: categoryIcon(e.category),
        searchText: normalizeSearch(
          `${e.label} ${e.type} ${e.description ?? ""} ${catLabel}`,
        ),
        onAdd: () => addRegistryNode(e),
      }
    })

    return [...standard, ...registry]
  }, [registryEntries])

  const filtered = useMemo(
    () => allItems.filter((item) => matchesQuery(item, query)),
    [allItems, query],
  )

  const grouped = useMemo(() => {
    const order: (WorkflowNodeCategory | "standard")[] = [
      "standard",
      ...WORKFLOW_REGISTRY_CATEGORY_ORDER,
    ]
    const map = new Map<WorkflowNodeCategory | "standard", PaletteItem[]>()
    for (const item of filtered) {
      const list = map.get(item.category) ?? []
      list.push(item)
      map.set(item.category, list)
    }
    return order
      .filter((c) => map.has(c))
      .map((category) => ({
        category,
        label:
          category === "standard"
            ? "Basis"
            : WORKFLOW_CATEGORY_LABELS[category],
        items: map.get(category) ?? [],
      }))
  }, [filtered])

  const categoryCount = grouped.reduce((n, g) => n + g.items.length, 0)

  return (
    <div className="flex h-[min(70vh,28rem)] w-64 min-h-0 flex-col overflow-hidden rounded-lg border bg-background/95 p-2 shadow-lg backdrop-blur">
      <div className="shrink-0 px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        Hinzufügen
      </div>

      <div className="relative shrink-0 pb-2">
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          className="h-8 pl-8 text-xs"
          placeholder="Knoten suchen…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Workflow-Knoten suchen"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-0.5">
        {registryEntries.length === 0 && !query ? (
          <p className="px-1 py-2 text-[11px] text-muted-foreground">
            Erweiterte Knoten werden geladen…
          </p>
        ) : categoryCount === 0 ? (
          <p className="px-1 py-4 text-center text-[11px] text-muted-foreground">
            Kein Knoten für „{searchQuery.trim()}“.
          </p>
        ) : (
          <div className="space-y-2 pb-1">
            {grouped.map(({ category, label, items }) => (
              <div key={category}>
                <div className="sticky top-0 z-[1] bg-background/95 px-1 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur-sm">
                  {label}
                </div>
                <div className="space-y-0.5">
                  {items.map((item) => {
                    const Icon = item.icon
                    return (
                      <Button
                        key={item.id}
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-auto min-h-7 w-full justify-start gap-1.5 whitespace-normal px-2 py-1 text-left text-xs"
                        onClick={item.onAdd}
                        title={item.description}
                      >
                        <Icon
                          className={`h-3 w-3 shrink-0 ${
                            item.category === "standard" && item.id === "condition"
                              ? "text-amber-500"
                              : "text-violet-500"
                          }`}
                        />
                        <span className="min-w-0 flex-1">{item.label}</span>
                        <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                      </Button>
                    )
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
