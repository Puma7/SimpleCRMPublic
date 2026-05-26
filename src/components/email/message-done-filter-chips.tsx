"use client"

import { cn } from "@/lib/utils"
import { useMailWorkspace, type MessageDoneFilter } from "./workspace-context"

const CHIPS: { id: MessageDoneFilter; label: string }[] = [
  { id: "open", label: "Unerledigt" },
  { id: "done", label: "Erledigt" },
  { id: "all", label: "Alle" },
]

export function MessageDoneFilterChips({ className }: { className?: string }) {
  const { messageDoneFilter, setMessageDoneFilter } = useMailWorkspace()

  return (
    <div
      className={cn("flex flex-wrap items-center gap-1.5", className)}
      role="group"
      aria-label="Erledigung"
    >
      <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        Erledigung
      </span>
      {CHIPS.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => setMessageDoneFilter(chip.id)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            messageDoneFilter === chip.id
              ? "border-emerald-600/40 bg-emerald-500/15 text-emerald-900 dark:text-emerald-100"
              : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}
