"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Mail, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { hasElectron, invokeIpc, type EmailAccount } from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"
import { AccountForm } from "./account-form"

export function AccountsPanel() {
  const { accountsRevision, bumpAccountsRevision, setSettingsAccountId } = useMailWorkspace()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editAccount, setEditAccount] = useState<EmailAccount | null>(null)

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
  }, [load, accountsRevision])

  const handleDelete = async (account: EmailAccount) => {
    if (!hasElectron()) return
    const ok = window.confirm(
      `Konto „${account.display_name}“ (${account.email_address}) wirklich löschen? Alle lokalen Nachrichten dieses Kontos werden entfernt.`,
    )
    if (!ok) return
    try {
      await invokeIpc(IPCChannels.Email.DeleteAccount, account.id)
      toast.success("Konto gelöscht.")
      if (selectedId === account.id) {
        setSelectedId(null)
        setEditAccount(null)
      }
      bumpAccountsRevision()
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen.")
    }
  }

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
                    "flex items-center gap-2 px-3 py-2 text-sm",
                    selectedId === a.id && "bg-muted/60",
                  )}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => {
                      setSelectedId(a.id)
                      setSettingsAccountId(a.id)
                    }}
                  >
                    <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{a.display_name}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {a.email_address} · {(a.protocol || "imap").toUpperCase()} ·{" "}
                        {a.imap_host}:{a.imap_port}
                      </div>
                    </div>
                  </button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0"
                    title="Bearbeiten"
                    onClick={() => {
                      setSelectedId(a.id)
                      setSettingsAccountId(a.id)
                      setEditAccount(a)
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    className="h-8 w-8 shrink-0 text-destructive"
                    title="Löschen"
                    onClick={() => void handleDelete(a)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
      </div>

      <AccountForm
        editAccount={editAccount}
        onCancelEdit={() => setEditAccount(null)}
        onCreated={() => {
          bumpAccountsRevision()
          void load()
        }}
      />
    </div>
  )
}
