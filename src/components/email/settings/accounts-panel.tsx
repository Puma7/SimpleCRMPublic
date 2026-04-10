"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Mail } from "lucide-react"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { hasElectron, invokeIpc, type EmailAccount } from "../types"
import { logError } from "../log"
import { AccountForm } from "./account-form"

export function AccountsPanel() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const load = useCallback(async () => {
    if (!hasElectron()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const list = await invokeIpc<EmailAccount[]>(IPCChannels.Email.ListAccounts)
      setAccounts(list)
    } catch (e) {
      logError("accounts-panel: load", e)
      toast.error("Konten konnten nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Konten</h3>
        <p className="text-sm text-muted-foreground">
          Verwalten Sie Ihre IMAP- und POP3-Konten. Das aktive Konto wird in der Seitenleiste der Inbox ausgewählt.
        </p>
      </div>

      <div className="rounded-lg border">
        <div className="border-b px-3 py-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Vorhandene Konten
        </div>
        <ScrollArea className="max-h-[200px]">
          {loading ? (
            <div className="p-4 text-sm text-muted-foreground">Lädt…</div>
          ) : accounts.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground">Noch keine Konten angelegt.</div>
          ) : (
            <ul className="divide-y">
              {accounts.map((a) => (
                <li
                  key={a.id}
                  className={cn(
                    "flex items-center gap-3 px-3 py-2 text-sm",
                    selectedId === a.id && "bg-muted/60",
                  )}
                  onClick={() => setSelectedId(a.id)}
                >
                  <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{a.display_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {a.email_address} · {(a.protocol || "imap").toUpperCase()} ·{" "}
                      {a.imap_host}:{a.imap_port}
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>

      <AccountForm onCreated={load} />
    </div>
  )
}
