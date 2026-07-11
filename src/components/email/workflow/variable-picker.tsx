"use client"

import { useMemo, useState } from "react"
import { Braces } from "lucide-react"
import type { WorkflowVariableInfo } from "@shared/workflow-variables"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

type Props = {
  variables: WorkflowVariableInfo[]
  /** 'value' setzt den reinen Namen (variableRef-Felder); 'template' fügt {{name}} ein. */
  mode: "value" | "template"
  onPick: (text: string) => void
  triggerTitle?: string
}

/**
 * Einfüge-Hilfe für Workflow-Variablen: zeigt, welche Variablen an dieser
 * Stelle verfügbar sind (Kontext + vorgelagerte Knoten), mit Erklärung und
 * Beispiel — niemand muss sich Variablennamen merken.
 */
export function VariablePicker({ variables, mode, onPick, triggerTitle }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return variables
    return variables.filter(
      (v) =>
        v.name.toLowerCase().includes(q) ||
        v.label.toLowerCase().includes(q) ||
        v.source.toLowerCase().includes(q),
    )
  }, [variables, query])

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 gap-1 px-2 text-[11px]"
          title={triggerTitle ?? "Verfügbare Variablen anzeigen und einfügen"}
        >
          <Braces className="h-3 w-3" />
          Variablen
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-2">
        <Input
          className="mb-2 h-8 text-sm"
          placeholder="Variable suchen…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoFocus
        />
        <div className="max-h-72 space-y-1 overflow-y-auto">
          {filtered.length === 0 ? (
            <p className="px-1 py-2 text-xs text-muted-foreground">
              Keine passende Variable gefunden.
            </p>
          ) : (
            filtered.map((v) => (
              <button
                key={`${v.sourceNodeId ?? "ctx"}:${v.name}`}
                type="button"
                className="w-full rounded-md border px-2 py-1.5 text-left transition-colors hover:bg-accent"
                onClick={() => {
                  onPick(mode === "template" ? `{{${v.name}}}` : v.name)
                  setOpen(false)
                }}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <code className="text-[11px] font-semibold">{v.name}</code>
                  <span className="shrink-0 text-[10px] text-muted-foreground">
                    {v.source === "context" ? "immer verfügbar" : `aus „${v.source}“`}
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">{v.label}</p>
                {v.example ? (
                  <p className="truncate text-[10px] text-muted-foreground/80">z. B. {v.example}</p>
                ) : null}
              </button>
            ))
          )}
        </div>
        {mode === "template" ? (
          <p className="mt-2 border-t pt-1.5 text-[10px] text-muted-foreground">
            Fügt <code>{"{{Name}}"}</code> ein — der Platzhalter wird beim Ausführen durch den
            echten Wert ersetzt.
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  )
}
