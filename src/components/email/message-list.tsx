"use client"

import { Loader2, Paperclip, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { formatFrom, type EmailMessage } from "./types"
import { useMailWorkspace } from "./workspace-context"

type Props = {
  messages: EmailMessage[]
  loading: boolean
  onOpen: (m: EmailMessage) => void | Promise<void>
}

function formatDate(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  const today = new Date()
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })
  }
  const diffDays = Math.floor((today.getTime() - d.getTime()) / 86400000)
  if (diffDays < 7) {
    return d.toLocaleDateString("de-DE", { weekday: "short" })
  }
  return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })
}

export function MessageList({ messages, loading, onOpen }: Props) {
  const { searchQuery, setSearchQuery, selectedMessage } = useMailWorkspace()

  return (
    <section className="flex h-full min-h-0 flex-col border-r">
      <div className="shrink-0 border-b bg-background p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            className="h-9 pl-8"
            placeholder="Nachrichten durchsuchen…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Lädt…
          </p>
        ) : messages.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Keine Nachrichten.</p>
        ) : (
          <ul className="divide-y">
            {messages.map((m) => {
              const unread = !m.seen_local && m.uid >= 0
              const active = selectedMessage?.id === m.id
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => void onOpen(m)}
                    className={cn(
                      "w-full px-3 py-2.5 text-left transition-colors hover:bg-muted/60",
                      active && "bg-muted",
                    )}
                  >
                    <div className="flex items-start gap-2">
                      <div
                        className={cn(
                          "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                          unread ? "bg-primary" : "bg-transparent",
                        )}
                      />
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              "truncate text-xs",
                              unread ? "font-semibold" : "text-muted-foreground",
                            )}
                          >
                            {formatFrom(m.from_json)}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground">
                            {formatDate(m.date_received)}
                          </span>
                        </div>
                        <div
                          className={cn(
                            "truncate text-sm",
                            unread && "font-semibold",
                          )}
                        >
                          {m.subject || "(Ohne Betreff)"}
                        </div>
                        {m.snippet ? (
                          <div className="line-clamp-1 text-xs text-muted-foreground">
                            {m.snippet}
                          </div>
                        ) : null}
                        <div className="flex items-center gap-1.5 pt-0.5">
                          {m.has_attachments ? (
                            <Paperclip className="h-3 w-3 text-muted-foreground" />
                          ) : null}
                          {m.ticket_code ? (
                            <span className="rounded bg-primary/10 px-1 text-[9px] font-medium text-primary">
                              {m.ticket_code}
                            </span>
                          ) : null}
                          {m.archived ? (
                            <span className="rounded bg-amber-500/10 px-1 text-[9px] font-medium text-amber-700 dark:text-amber-400">
                              Archiv
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </ScrollArea>
    </section>
  )
}
