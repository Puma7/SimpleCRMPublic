"use client"

import { Loader2, Plus, Workflow } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

export type WorkflowRow = {
  id: number
  name: string
  trigger: string
  enabled: number
  priority: number
}

type Props = {
  rows: WorkflowRow[]
  selectedId: number | null
  loading: boolean
  onSelect: (id: number) => void
  onCreate: () => void
}

export function WorkflowList({ rows, selectedId, loading, onSelect, onCreate }: Props) {
  return (
    <aside className="flex h-full min-h-0 flex-col border-r bg-muted/20">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Workflows
        </h3>
        <Button type="button" size="sm" onClick={onCreate} className="h-7 gap-1.5">
          <Plus className="h-3.5 w-3.5" />
          Neu
        </Button>
      </div>
      <ScrollArea className="flex-1">
        {loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Lädt…
          </p>
        ) : rows.length === 0 ? (
          <p className="p-4 text-center text-sm text-muted-foreground">Noch keine Workflows.</p>
        ) : (
          <ul className="space-y-0.5 p-2">
            {rows.map((w) => (
              <li key={w.id}>
                <button
                  type="button"
                  onClick={() => onSelect(w.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm transition-colors hover:bg-muted",
                    selectedId === w.id && "bg-muted font-medium",
                  )}
                >
                  <Workflow className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate">{w.name}</div>
                    <div className="truncate text-[10px] text-muted-foreground">
                      {w.trigger} · P{w.priority} {w.enabled ? "" : "· inaktiv"}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}
      </ScrollArea>
    </aside>
  )
}
