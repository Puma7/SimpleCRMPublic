"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { CheckCircle2, Plus, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { getRendererTransport, invokeRenderer } from "@/services/transport"
import type { EmailAccount } from "../types"
import { useMailWorkspace } from "../workspace-context"
import { AccountForm } from "./account-form"
import { SmtpPanel } from "./smtp-panel"
import { OAuthAccountLinkPanel } from "./oauth-account-link-panel"
import { ReplySuggestionSettingsSection } from "./reply-suggestion-settings-section"
import { AccountSignaturesSection } from "./account-signatures-section"
import { AccountKnowledgeSlots } from "./account-knowledge-slots"
import { AccountAdvancedPanel } from "./account-advanced-panel"
import { AccountsShippingHint } from "./accounts-shipping-hint"

type AccountTab = "imap" | "smtp" | "oauth" | "signature" | "ki" | "erweitert"

const TABS: { id: AccountTab; label: string }[] = [
  { id: "imap", label: "IMAP / POP3" },
  { id: "smtp", label: "SMTP" },
  { id: "oauth", label: "OAuth" },
  { id: "signature", label: "Signatur" },
  { id: "ki", label: "KI" },
  { id: "erweitert", label: "Erweitert" },
]

function accountInitials(a: EmailAccount): string {
  const n = a.display_name?.trim() || a.email_address
  const parts = n.split(/\s+/)
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase()
  return n.slice(0, 2).toUpperCase()
}

/** Konten: Liste + Detail mit IMAP/SMTP/OAuth/KI pro Postfach. */
export function AccountsMasterDetailSettings() {
  const serverClientMode = getRendererTransport().kind === "http"
  const {
    bumpAccountsRevision,
    setSettingsAccountId,
    settingsAccountId,
    settingsAccountsSubTab,
    setSettingsAccountsSubTab,
    accountsRevision,
  } = useMailWorkspace()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [editAccount, setEditAccount] = useState<EmailAccount | null>(null)
  const [tab, setTab] = useState<AccountTab>("imap")
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await invokeRenderer(IPCChannels.Email.ListAccounts) as EmailAccount[]
      setAccounts(list)
      if (list.length > 0 && selectedId == null) {
        const preferred =
          settingsAccountId != null
            ? list.find((a) => a.id === settingsAccountId) ?? list[0]!
            : list[0]!
        setSelectedId(preferred.id)
        setEditAccount(preferred)
        if (settingsAccountId == null) {
          setSettingsAccountId(preferred.id)
        }
        return
      }
      // After a save the edit view stays open. The form keys off editAccount,
      // so a stale reference would let a later remount (tab switch / select +
      // back) revert the form to pre-save values — and a second save would
      // then overwrite the DB with those stale fields. Re-bind editAccount to
      // the freshly-loaded row whenever the selected id is still in the list.
      if (selectedId != null) {
        const refreshed = list.find((a) => a.id === selectedId)
        if (refreshed) setEditAccount(refreshed)
      }
    } catch {
      toast.error("Konten konnten nicht geladen werden.")
    }
  }, [selectedId, setSettingsAccountId, settingsAccountId])

  useEffect(() => {
    void load()
  }, [load, accountsRevision])

  useEffect(() => {
    if (settingsAccountId == null || accounts.length === 0) return
    const match = accounts.find((a) => a.id === settingsAccountId)
    if (!match) return
    setSelectedId(match.id)
    setEditAccount(match)
    setCreating(false)
    setSettingsAccountId(null)
  }, [settingsAccountId, accounts, setSettingsAccountId])

  useEffect(() => {
    if (!settingsAccountsSubTab) return
    setTab(settingsAccountsSubTab)
    setSettingsAccountsSubTab(null)
  }, [settingsAccountsSubTab, setSettingsAccountsSubTab])

  const selectAccount = (a: EmailAccount) => {
    setSelectedId(a.id)
    setEditAccount(a)
    setCreating(false)
    setSettingsAccountId(a.id)
  }

  const handleDelete = async (a: EmailAccount) => {
    const scopeLabel = serverClientMode ? "serverseitigen" : "lokalen"
    const ok = window.confirm(
      `Konto „${a.display_name || a.email_address}“ (${a.email_address}) wirklich löschen? Alle ${scopeLabel} Nachrichten dieses Kontos werden entfernt.`,
    )
    if (!ok) return
    try {
      await invokeRenderer(IPCChannels.Email.DeleteAccount, a.id)
      toast.success("Konto gelöscht.")
      setSelectedId(null)
      setEditAccount(null)
      setCreating(false)
      bumpAccountsRevision()
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Löschen fehlgeschlagen.")
    }
  }

  const selected = accounts.find((a) => a.id === selectedId) ?? editAccount

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <div className="flex w-[280px] shrink-0 flex-col border-r bg-muted/20">
        <div className="flex items-center justify-between gap-2 border-b px-3 py-3">
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
        <div className="space-y-2 border-t p-3">
          <AccountsShippingHint />
          <p className="text-[10px] leading-relaxed text-muted-foreground">
            {serverClientMode
              ? "Passwörter liegen verschlüsselt im Server-Secret-Store und werden nicht an den Client zurückgegeben."
              : "Passwörter liegen im OS-Schlüsselbund (Keytar), nicht in der Datenbank."}
          </p>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {creating || selected ? (
          <>
            <div className="flex shrink-0 items-center justify-between gap-2 border-b px-4 py-3">
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
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-2 text-destructive hover:text-destructive"
                  onClick={() => void handleDelete(selected)}
                >
                  <Trash2 className="h-4 w-4" />
                  Konto löschen
                </Button>
              ) : null}
            </div>
            {!creating ? (
              <div className="flex shrink-0 gap-1 border-b px-4">
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
                  <div className="max-w-xl space-y-4">
                    <AccountsShippingHint />
                    <AccountForm
                      key="new-account"
                      onCreated={() => {
                        bumpAccountsRevision()
                        void load()
                        setCreating(false)
                      }}
                    />
                  </div>
                ) : tab === "imap" ? (
                  <AccountForm
                    key={`edit-${editAccount?.id ?? "none"}`}
                    editAccount={editAccount}
                    onCreated={() => {
                      bumpAccountsRevision()
                      void load()
                    }}
                    onSaved={(updated) => setEditAccount(updated)}
                    onCancelEdit={() => setEditAccount(null)}
                  />
                ) : tab === "smtp" && selectedId != null ? (
                  <SmtpPanel embeddedAccountId={selectedId} />
                ) : tab === "oauth" && selectedId != null ? (
                  <OAuthAccountLinkPanel
                    accountId={selectedId}
                    emailAddress={selected?.email_address}
                  />
                ) : tab === "signature" && selectedId != null ? (
                  <div className="max-w-3xl">
                    <AccountSignaturesSection embeddedAccountId={selectedId} />
                  </div>
                ) : tab === "ki" && selectedId != null ? (
                  <div className="max-w-3xl space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Kontospezifische KI-Antwortvorschläge. Globale Voreinstellungen (Profile,
                      Modelle) unter Einstellungen → KI.
                    </p>
                    <ReplySuggestionSettingsSection accountId={selectedId} />
                    <AccountKnowledgeSlots accountId={selectedId} />
                  </div>
                ) : tab === "erweitert" && selectedId != null ? (
                  <AccountAdvancedPanel accountId={selectedId} />
                ) : null}
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
