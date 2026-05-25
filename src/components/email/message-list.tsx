"use client"

import { Loader2, Paperclip, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { isAllAccountsScope } from "./account-scope"
import { formatFrom, type EmailAccount, type EmailMessage } from "./types"
import { useMailWorkspace } from "./workspace-context"

type Props = {
  messages: EmailMessage[]
  accounts: EmailAccount[]
  loading: boolean
  onOpen: (m: EmailMessage) => void | Promise<void>
}

/** Compact date+time so the column stays readable when the list pane is narrow. */
function formatListDateTime(iso: string | null): string {
  if (!iso) return ""
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function MessageList({ messages, accounts, loading, onOpen }: Props) {
  const { searchQuery, setSearchQuery, selectedMessage, selectedAccountId } =
    useMailWorkspace()
  const showAccount = isAllAccountsScope(selectedAccountId)
  const accountLabel = (id: number) =>
    accounts.find((a) => a.id === id)?.display_name ?? `Konto ${id}`

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
                      <div className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-0.5">
                        <span
                          className={cn(
                            "truncate text-xs",
                            unread ? "font-semibold" : "text-muted-foreground",
                          )}
                        >
                          {formatFrom(m.from_json)}
                        </span>
                        <time
                          dateTime={m.date_received ?? undefined}
                          className="row-span-2 shrink-0 self-start whitespace-nowrap text-[10px] tabular-nums text-muted-foreground"
                          title={
                            m.date_received
                              ? new Date(m.date_received).toLocaleString("de-DE")
                              : undefined
                          }
                        >
                          {formatListDateTime(m.date_received)}
                        </time>
                        <div
                          className={cn(
                            "truncate text-sm",
                            unread && "font-semibold",
                          )}
                        >
                          {m.subject || "(Ohne Betreff)"}
                        </div>
                        {m.snippet ? (
                          <div className="col-span-2 line-clamp-1 text-xs text-muted-foreground">
                            {m.snippet}
                          </div>
                        ) : null}
                        <div className="col-span-2 flex items-center gap-1.5 pt-0.5">
                          {m.has_attachments ? (
                            <Paperclip className="h-3 w-3 text-muted-foreground" />
                          ) : null}
                          {showAccount ? (
                            <span className="rounded bg-muted px-1 text-[9px] font-medium text-muted-foreground">
                              {accountLabel(m.account_id)}
                            </span>
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
