"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { AlertCircle, CheckCircle2, Plus, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { hasElectron, invokeIpc, type EmailAccount } from "../types"
import { useMailWorkspace } from "../workspace-context"
import { AccountForm } from "../settings/account-form"
import { SmtpPanel } from "../settings/smtp-panel"
import { OAuthPanel } from "../settings/oauth-panel"
import { AiPanel } from "../settings/ai-panel"

type AccountTab = "imap" | "smtp" | "oauth" | "ki" | "sync"

const TABS: { id: AccountTab; label: string }[] = [
  { id: "imap", label: "IMAP / POP3" },
  { id: "smtp", label: "SMTP" },
  { id: "oauth", label: "OAuth" },
  { id: "ki", label: "KI" },
  { id: "sync", label: "Sync" },
]

function accountInitials(a: EmailAccount): string {
  const n = a.display_name?.trim() || a.email_address
  const parts = n.split(/\s+/)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return n.slice(0, 2).toUpperCase()
}

export function BetaAccountsSettings() {
  const { bumpAccountsRevision, setSettingsAccountId, accountsRevision } = useMailWorkspace()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editAccount, setEditAccount] = useState<EmailAccount | null>(null)
  const [tab, setTab] = useState<AccountTab>("imap")
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    if (!hasElectron()) return
    try {
      const list = await invokeIpc<EmailAccount[]>(IPCChannels.Email.ListAccounts)
      setAccounts(list)
      if (list.length > 0 && selectedId == null) {
        setSelectedId(list[0]!.id)
        setEditAccount(list[0]!)
        setSettingsAccountId(list[0]!.id)
      }
    } catch {
      toast.error("Konten konnten nicht geladen werden.")
    }
  }, [selectedId, setSettingsAccountId])

  useEffect(() => {
    void load()
  }, [load, accountsRevision])

  const selectAccount = (a: EmailAccount) => {
    setSelectedId(a.id)
    setEditAccount(a)
    setCreating(false)
    setSettingsAccountId(a.id)
  }

  const selected = accounts.find((a) => a.id === selectedId) ?? editAccount

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex w-[280px] shrink-0 flex-col border-r border-border/60 bg-card/20">
        <div className="flex items-center justify-between gap-2 border-b border-border/60 px-3 py-3">
          <p className="text-xs text-muted-foreground">
            <span className="font-semibold text-foreground">{accounts.length}</span> verbunden
          </p>
          <Button
            type="button"
            size="sm"
            className="h-7 gap-1 text-xs"
            onClick={() => {
              setCreating(true)
              setSelectedId(null)
              setEditAccount(null)
            }}
          >
            <Plus className="h-3 w-3" />
            Konto
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <ul className="space-y-1 p-2">
            {accounts.map((a) => {
              const active = a.id === selectedId && !creating
              const proto = (a.protocol ?? "imap").toUpperCase()
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => selectAccount(a)}
                    className={cn(
                      "flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2.5 text-left transition-colors",
                      active
                        ? "border-primary/40 bg-primary/10"
                        : "border-transparent hover:bg-muted/40",
                    )}
                  >
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold">
                      {accountInitials(a)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{a.email_address}</p>
                      <p className="text-[10px] text-muted-foreground">{proto}</p>
                    </div>
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
                  </button>
                </li>
              )
            })}
          </ul>
        </ScrollArea>
        <p className="border-t border-border/60 p-3 text-[10px] leading-relaxed text-muted-foreground">
          Passwörter liegen im OS-Schlüsselbund (Keytar), nicht in der Datenbank.
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {creating || selected ? (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">
                  {creating ? "Neues Postfach" : selected?.email_address}
                </h2>
                {!creating && selected ? (
                  <p className="text-xs text-green-600 dark:text-green-400">
                    {((selected.protocol ?? "imap") as string).toUpperCase()} · synchron
                  </p>
                ) : null}
              </div>
              {!creating && selected ? (
                <Button type="button" size="sm" variant="outline" className="h-8 gap-1.5 text-xs">
                  <RefreshCw className="h-3.5 w-3.5" />
                  Jetzt syncen
                </Button>
              ) : null}
            </div>
            {!creating ? (
              <div className="flex shrink-0 gap-1 border-b border-border/60 px-4">
                {TABS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setTab(t.id)}
                    className={cn(
                      "border-b-2 px-3 py-2 text-xs font-medium transition-colors",
                      tab === t.id
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            ) : null}
            <ScrollArea className="flex-1">
              <div className="p-4">
                {creating ? (
                  <AccountForm
                    onCreated={() => {
                      bumpAccountsRevision()
                      void load()
                      setCreating(false)
                    }}
                  />
                ) : tab === "imap" ? (
                  <AccountForm
                    editAccount={editAccount}
                    onCreated={() => {
                      bumpAccountsRevision()
                      void load()
                    }}
                    onCancelEdit={() => setEditAccount(null)}
                  />
                ) : tab === "smtp" ? (
                  <SmtpPanel />
                ) : tab === "oauth" ? (
                  <OAuthPanel />
                ) : tab === "ki" ? (
                  <div className="max-w-3xl">
                    <p className="mb-4 text-sm text-muted-foreground">
                      KI-Profil für Composer und Workflows (kontoweit nutzbar über Standard-Profil
                      und Prompt-Zuweisung).
                    </p>
                    <AiPanel />
                  </div>
                ) : (
                  <div className="max-w-xl space-y-3 text-sm text-muted-foreground">
                    <p className="flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 text-primary" />
                      Sync-Optionen (IDLE, Intervall, initiale Tiefe) folgen in einer späteren
                      Version — aktuell über Konto-Formular und Workflow-Einstellungen.
                    </p>
                  </div>
                )}
              </div>
            </ScrollArea>
          </>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Postfach wählen oder neues Konto anlegen.
          </div>
        )}
      </div>
    </div>
  )
}
