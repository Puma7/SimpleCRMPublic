"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Mail, Pencil, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { getRendererTransport, invokeRenderer } from "@/services/transport"
import { type EmailAccount } from "../types"
import { logError } from "../log"
import { useMailWorkspace } from "../workspace-context"
import { AccountForm } from "./account-form"

export function AccountsPanel() {
  const serverClientMode = getRendererTransport().kind === "http"
  const { accountsRevision, bumpAccountsRevision, setSettingsAccountId } = useMailWorkspace()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editAccount, setEditAccount] = useState<EmailAccount | null>(null)
  const [imapDeleteOptIn, setImapDeleteOptIn] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const list = await invokeRenderer(IPCChannels.Email.ListAccounts) as EmailAccount[]
      setAccounts(list)
      const wf = await invokeRenderer(IPCChannels.Email.GetWorkflowAutomationSettings) as { imapDeleteOptIn: boolean }
      setImapDeleteOptIn(wf.imapDeleteOptIn)
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
    const scopeLabel = serverClientMode ? "serverseitigen" : "lokalen"
    const ok = window.confirm(
      `Konto „${account.display_name}“ (${account.email_address}) wirklich löschen? Alle ${scopeLabel} Nachrichten dieses Kontos werden entfernt.`,
    )
    if (!ok) return
    try {
      await invokeRenderer(IPCChannels.Email.DeleteAccount, account.id)
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
          Verwalten Sie IMAP- und POP3-Konten. Im Postfach wählen Sie oben ein Konto oder{" "}
          <strong>Alle Konten</strong> (Shared Inbox für viele Shops).
        </p>
      </div>

      <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
        <div className="space-y-1">
          <Label htmlFor="imap-delete-opt-in">IMAP-Löschung auf dem Server (Workflows)</Label>
          <p className="text-xs text-muted-foreground">
            Erlaubt dem Workflow-Knoten „Auf Server löschen“. Der Papierkorb im Postfach ist davon
            unabhängig (nur SimpleCRM-interne Ausblendung).
          </p>
        </div>
        <Switch
          id="imap-delete-opt-in"
          checked={imapDeleteOptIn}
          onCheckedChange={(v) => {
            setImapDeleteOptIn(v)
            void invokeRenderer(IPCChannels.Email.SetWorkflowAutomationSettings, {
              imapDeleteOptIn: v,
            }).then(() => toast.success("Gespeichert"))
          }}
        />
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
