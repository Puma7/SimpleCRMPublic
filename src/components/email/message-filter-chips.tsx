"use client"

import { cn } from "@/lib/utils"
import { useMailWorkspace, type MessageListFilter } from "./workspace-context"

const CHIPS: { id: MessageListFilter; label: string }[] = [
  { id: "all", label: "Alle" },
  { id: "unread", label: "Ungelesen" },
  { id: "attachment", label: "Mit Anhang" },
  { id: "customer", label: "Vom Kunden" },
  { id: "workflow", label: "Workflow betroffen" },
]

export function MessageFilterChips({ className }: { className?: string }) {
  const { messageListFilter, setMessageListFilter } = useMailWorkspace()

  return (
    <div className={cn("flex flex-wrap gap-1.5", className)} role="group" aria-label="Filter">
      {CHIPS.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => setMessageListFilter(chip.id)}
          className={cn(
            "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
            messageListFilter === chip.id
              ? "border-primary/50 bg-primary/15 text-primary crm-glow-button"
              : "border-border/60 bg-muted/20 text-muted-foreground hover:bg-muted/40 hover:text-foreground",
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  )
}
