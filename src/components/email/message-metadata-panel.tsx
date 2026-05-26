"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Copy, Pencil, Trash2, X } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CustomerCombobox } from "@/components/customer-combobox"
import {
  hasElectron,
  invokeIpc,
  type CategoryRow,
  type EmailMessage,
  type InternalNote,
  type TeamMember,
} from "./types"
import { correspondentEmailForMessage } from "@shared/email-correspondent"
import { cn } from "@/lib/utils"
import { useMailWorkspace } from "./workspace-context"

type Props = {
  teamMembers: TeamMember[]
  categories: CategoryRow[]
  messageTags: string[]
  internalNotes: InternalNote[]
  reloadNotes: () => void | Promise<void>
  reloadTags: () => void | Promise<void>
  refreshCurrentMessage: () => void | Promise<void>
  /** Fills resizable column (Postfach); default fixed w-72 for inline viewer split. */
  fillWidth?: boolean
}

function categoryPathLabel(categories: CategoryRow[], id: number): string {
  const parts: string[] = []
  let cur = categories.find((c) => c.id === id)
  while (cur) {
    parts.unshift(cur.name)
    cur =
      cur.parent_id != null
        ? categories.find((c) => c.id === cur!.parent_id)
        : undefined
  }
  return parts.join(" / ")
}

export function MessageMetadataPanel({
  teamMembers,
  categories,
  messageTags,
  internalNotes,
  reloadNotes,
  reloadTags,
  refreshCurrentMessage,
  fillWidth = false,
}: Props) {
  const { selectedMessage, selectedAccountId, setSelectedMessage } = useMailWorkspace()
  const [newNote, setNewNote] = useState("")
  const [editingNoteId, setEditingNoteId] = useState<number | null>(null)
  const [editingNoteBody, setEditingNoteBody] = useState("")
  const [newTag, setNewTag] = useState("")
  const [messageCategoryId, setMessageCategoryId] = useState<number | null>(null)
  const [conversation, setConversation] = useState<EmailMessage[]>([])
  const [security, setSecurity] = useState<{
    authSpf: string | null
    authDkim: string | null
    authDmarc: string | null
    authArc: string | null
    rspamdScore: number | null
    rspamdAction: string | null
    rspamdSymbols: string | null
    securityCheckedAt: string | null
    authError: string | null
    rspamdError: string | null
  } | null>(null)
  const [securityLoading, setSecurityLoading] = useState(false)

  useEffect(() => {
    if (!selectedMessage || !hasElectron()) {
      setMessageCategoryId(null)
      return
    }
    void invokeIpc<{ categoryId: number | null }>(
      IPCChannels.Email.GetMessageCategory,
      selectedMessage.id,
    )
      .then((r) => setMessageCategoryId(r.categoryId))
      .catch(() => setMessageCategoryId(null))
  }, [selectedMessage?.id])

  useEffect(() => {
    if (!selectedMessage || !hasElectron()) {
      setSecurity(null)
      return
    }
    setSecurityLoading(true)
    void invokeIpc<{
      success: boolean
      authSpf?: string | null
      authDkim?: string | null
      authDmarc?: string | null
      authArc?: string | null
      rspamdScore?: number | null
      rspamdAction?: string | null
      rspamdSymbols?: string | null
      securityCheckedAt?: string | null
      authError?: string | null
      rspamdError?: string | null
    }>(IPCChannels.Email.GetMessageSecurity, selectedMessage.id)
      .then((r) => {
        if (r.success) {
          setSecurity({
            authSpf: r.authSpf ?? null,
            authDkim: r.authDkim ?? null,
            authDmarc: r.authDmarc ?? null,
            authArc: r.authArc ?? null,
            rspamdScore: r.rspamdScore ?? null,
            rspamdAction: r.rspamdAction ?? null,
            rspamdSymbols: r.rspamdSymbols ?? null,
            securityCheckedAt: r.securityCheckedAt ?? null,
            authError: r.authError ?? null,
            rspamdError: r.rspamdError ?? null,
          })
        } else setSecurity(null)
      })
      .catch(() => setSecurity(null))
      .finally(() => setSecurityLoading(false))
  }, [selectedMessage?.id])

  const correspondentEmail = selectedMessage
    ? correspondentEmailForMessage(selectedMessage)
    : null

  useEffect(() => {
    if (!selectedMessage || selectedAccountId == null) {
      setConversation([])
      return
    }
    const hasTicketOrCustomer =
      Boolean(selectedMessage.ticket_code?.trim()) ||
      (selectedMessage.customer_id != null && selectedMessage.customer_id > 0)
    if (!correspondentEmail && !hasTicketOrCustomer) {
      setConversation([])
      return
    }
    void invokeIpc<EmailMessage[]>(IPCChannels.Email.ListConversationMessages, {
      accountId: selectedAccountId,
      messageId: selectedMessage.id,
      correspondentEmail: correspondentEmail ?? undefined,
      ticketCode: correspondentEmail ? undefined : selectedMessage.ticket_code,
      customerId: correspondentEmail ? undefined : selectedMessage.customer_id,
      limit: 50,
    })
      .then(setConversation)
      .catch(() => setConversation([]))
  }, [
    selectedMessage?.id,
    selectedMessage?.ticket_code,
    selectedMessage?.customer_id,
    correspondentEmail,
    selectedAccountId,
  ])

  if (!selectedMessage) return null

  const assignedMember = teamMembers.find((t) => t.id === selectedMessage.assigned_to)

  return (
    <aside
      className={cn(
        "flex h-full min-h-0 min-w-0 flex-col border-l bg-muted/10",
        fillWidth ? "w-full" : "w-72 shrink-0",
      )}
    >
      <div className="shrink-0 border-b px-4 py-3">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Details
        </h3>
      </div>

      <ScrollArea className="flex-1">
        <div className="space-y-5 p-4">
          <div className="space-y-1.5">
            <Label className="text-xs">Nachrichten-ID</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 rounded border bg-muted/50 px-2 py-1 font-mono text-xs">
                {selectedMessage.id}
              </code>
              <Button
                type="button"
                size="icon"
                variant="outline"
                className="h-8 w-8 shrink-0"
                aria-label="ID kopieren"
                onClick={() => {
                  void navigator.clipboard.writeText(String(selectedMessage.id))
                  toast.success("Nachrichten-ID kopiert")
                }}
              >
                <Copy className="h-3.5 w-3.5" />
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Für Workflow-Tests (Dry-Run) im Bereich Workflows → Erweitert.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Zuweisung</Label>
            <Select
              value={selectedMessage.assigned_to ?? "none"}
              onValueChange={async (v) => {
                const tid = v === "none" ? null : v
                await invokeIpc(IPCChannels.Email.AssignMessage, {
                  messageId: selectedMessage.id,
                  teamMemberId: tid,
                })
                await refreshCurrentMessage()
                const name =
                  tid == null
                    ? "— niemand —"
                    : teamMembers.find((t) => t.id === tid)?.display_name ?? tid
                toast.success(`Zugewiesen: ${name}`)
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Agent" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— niemand —</SelectItem>
                {teamMembers.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.display_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {assignedMember ? (
              <p className="text-[10px] text-muted-foreground">
                Aktuell: <span className="font-medium text-foreground">{assignedMember.display_name}</span>
              </p>
            ) : (
              <p className="text-[10px] text-muted-foreground">Aktuell: nicht zugewiesen</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Kategorie</Label>
            <Select
              value={messageCategoryId != null ? String(messageCategoryId) : "none"}
              onValueChange={async (v) => {
                const categoryId = v === "none" ? null : parseInt(v, 10)
                await invokeIpc(IPCChannels.Email.SetMessageCategory, {
                  messageId: selectedMessage.id,
                  categoryId: Number.isFinite(categoryId) ? categoryId : null,
                })
                setMessageCategoryId(categoryId)
                toast.success(
                  categoryId == null
                    ? "Kategorie entfernt"
                    : `Kategorie: ${categoryPathLabel(categories, categoryId)}`,
                )
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue placeholder="Kategorie" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— keine —</SelectItem>
                {categories.map((c) => (
                  <SelectItem key={c.id} value={String(c.id)}>
                    {categoryPathLabel(categories, c.id)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Neue Kategorien: Seitenleiste → Kategorien → Verwalten.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Kunde</Label>
            <CustomerCombobox
              value={selectedMessage.customer_id ?? undefined}
              placeholder="Kunde suchen…"
              onValueChange={async (v) => {
                const cid = v ? parseInt(v, 10) : null
                await invokeIpc(IPCChannels.Email.LinkCustomer, {
                  messageId: selectedMessage.id,
                  customerId: Number.isFinite(cid) ? cid : null,
                })
                await refreshCurrentMessage()
                toast.success("Verknüpfung gespeichert")
              }}
            />
            {selectedMessage.customer_id ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-0 text-xs text-muted-foreground"
                onClick={async () => {
                  await invokeIpc(IPCChannels.Email.LinkCustomer, {
                    messageId: selectedMessage.id,
                    customerId: null,
                  })
                  await refreshCurrentMessage()
                  toast.success("Kundenverknüpfung entfernt")
                }}
              >
                Verknüpfung entfernen
              </Button>
            ) : null}
          </div>

          {selectedMessage.archived ? (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-xs text-amber-900 dark:text-amber-200">
              <p className="font-medium">Im Archiv</p>
              <p className="mt-1 text-[11px] text-muted-foreground">
                Eingehende Workflows können neue Mails automatisch archivieren
                (Einstellungen → Workflows). Nutzen Sie „Aus Archiv“ in der
                Toolbar, um die Nachricht wieder im Posteingang zu sehen.
              </p>
            </div>
          ) : null}

          <div className="space-y-1.5">
            <Label className="text-xs">Tags</Label>
            {messageTags.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {messageTags.map((t) => (
                  <span
                    key={t}
                    className="inline-flex items-center gap-0.5 rounded-full bg-primary/10 pl-2 pr-1 py-0.5 text-[10px] font-medium text-primary"
                  >
                    {t}
                    <button
                      type="button"
                      className="rounded-full p-0.5 hover:bg-primary/20"
                      aria-label={`Tag ${t} entfernen`}
                      onClick={async () => {
                        await invokeIpc(IPCChannels.Email.RemoveMessageTag, {
                          messageId: selectedMessage.id,
                          tag: t,
                        })
                        await reloadTags()
                        toast.success("Tag entfernt")
                      }}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Keine Tags.</p>
            )}
            <div className="flex gap-1">
              <Input
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="Neuer Tag…"
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && newTag.trim()) {
                    void (async () => {
                      await invokeIpc(IPCChannels.Email.AddMessageTag, {
                        messageId: selectedMessage.id,
                        tag: newTag.trim(),
                      })
                      setNewTag("")
                      await reloadTags()
                      toast.success("Tag hinzugefügt")
                    })()
                  }
                }}
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="h-8 shrink-0"
                disabled={!newTag.trim()}
                onClick={async () => {
                  await invokeIpc(IPCChannels.Email.AddMessageTag, {
                    messageId: selectedMessage.id,
                    tag: newTag.trim(),
                  })
                  setNewTag("")
                  await reloadTags()
                  toast.success("Tag hinzugefügt")
                }}
              >
                +
              </Button>
            </div>
          </div>

          <div className="space-y-1.5 rounded-md border bg-muted/20 p-2">
            <div className="flex items-center justify-between gap-2">
              <Label className="text-xs">Mail-Sicherheit</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 text-[10px]"
                disabled={securityLoading}
                onClick={() => {
                  if (!selectedMessage) return
                  void (async () => {
                    setSecurityLoading(true)
                    try {
                      await invokeIpc(IPCChannels.Email.RunMailSecurityCheck, selectedMessage.id)
                      const r = await invokeIpc<{
                        success: boolean
                        authSpf?: string | null
                        authDkim?: string | null
                        authDmarc?: string | null
                        authArc?: string | null
                        rspamdScore?: number | null
                        rspamdAction?: string | null
                        rspamdSymbols?: string | null
                        securityCheckedAt?: string | null
                        authError?: string | null
                        rspamdError?: string | null
                      }>(IPCChannels.Email.GetMessageSecurity, selectedMessage.id)
                      if (r.success) {
                        setSecurity({
                          authSpf: r.authSpf ?? null,
                          authDkim: r.authDkim ?? null,
                          authDmarc: r.authDmarc ?? null,
                          authArc: r.authArc ?? null,
                          rspamdScore: r.rspamdScore ?? null,
                          rspamdAction: r.rspamdAction ?? null,
                          rspamdSymbols: r.rspamdSymbols ?? null,
                          securityCheckedAt: r.securityCheckedAt ?? null,
                          authError: r.authError ?? null,
                          rspamdError: r.rspamdError ?? null,
                        })
                      }
                      toast.success("Prüfung abgeschlossen")
                    } catch {
                      toast.error("Sicherheitsprüfung fehlgeschlagen")
                    } finally {
                      setSecurityLoading(false)
                    }
                  })()
                }}
              >
                Erneut prüfen
              </Button>
            </div>
            {securityLoading && !security ? (
              <p className="text-[10px] text-muted-foreground">Lädt…</p>
            ) : security?.securityCheckedAt ? (
              <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-[10px]">
                <dt className="text-muted-foreground">SPF</dt>
                <dd className="font-mono">{security.authSpf ?? "—"}</dd>
                <dt className="text-muted-foreground">DKIM</dt>
                <dd className="font-mono">{security.authDkim ?? "—"}</dd>
                <dt className="text-muted-foreground">DMARC</dt>
                <dd className="font-mono">{security.authDmarc ?? "—"}</dd>
                <dt className="text-muted-foreground">ARC</dt>
                <dd className="font-mono">{security.authArc ?? "—"}</dd>
                {security.rspamdScore != null ? (
                  <>
                    <dt className="text-muted-foreground">Rspamd</dt>
                    <dd className="font-mono">
                      {security.rspamdScore}
                      {security.rspamdAction ? ` (${security.rspamdAction})` : ""}
                    </dd>
                  </>
                ) : null}
              </dl>
            ) : (
              <p className="text-[10px] text-muted-foreground">
                Noch nicht geprüft (läuft normalerweise beim Sync).
              </p>
            )}
            {security?.authSpf === "temperror" ||
            security?.authDkim === "temperror" ||
            security?.authDmarc === "temperror" ? (
              <p className="mt-1 text-[10px] text-muted-foreground">
                <strong>temperror</strong> = DNS-Abfrage für SPF/DKIM/DMARC ist fehlgeschlagen (kein
                App-Bug). Netzwerk/VPN/DNS prüfen und erneut testen.
              </p>
            ) : null}
            {security?.authArc === "fail" ? (
              <p className="mt-1 text-[10px] text-muted-foreground">
                <strong>ARC fail</strong> ist bei normaler Post ohne Weiterleitungskette häufig — oft
                unkritisch.
              </p>
            ) : null}
            {security?.authError || security?.rspamdError ? (
              <p className="mt-1 text-[10px] text-amber-700 dark:text-amber-400">
                {[security.authError, security.rspamdError].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>

          {conversation.length > 0 ? (
            <div className="space-y-1.5">
              <Label className="text-xs">
                {correspondentEmail
                  ? `Alle Mails mit ${correspondentEmail}`
                  : "Kommunikation (Ticket/Kunde)"}
              </Label>
              <p className="text-[10px] text-muted-foreground">
                {correspondentEmail
                  ? "Posteingang, Gesendet, Archiv — unabhängig vom CRM-Kunden."
                  : "Weitere Nachrichten zum Ticket oder verknüpften Kunden."}
              </p>
              <ul className="max-h-48 space-y-0.5 overflow-y-auto rounded border bg-background p-1 text-xs">
                {conversation.map((m) => {
                  const active = m.id === selectedMessage.id
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        disabled={active}
                        className={`w-full rounded px-2 py-1.5 text-left transition-colors ${
                          active
                            ? "bg-primary/10 text-primary"
                            : "hover:bg-muted"
                        }`}
                        onClick={() => {
                          if (!active) setSelectedMessage(m)
                        }}
                      >
                        <p className="font-medium line-clamp-1">{m.subject || "(Ohne Betreff)"}</p>
                        <p className="text-[10px] text-muted-foreground">
                          {m.date_received
                            ? new Date(m.date_received).toLocaleString("de-DE")
                            : "—"}
                          {m.ticket_code ? ` · ${m.ticket_code}` : ""}
                        </p>
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          ) : correspondentEmail ? (
            <p className="text-xs text-muted-foreground">
              Keine weiteren Nachrichten mit {correspondentEmail} in diesem Konto.
            </p>
          ) : null}

          {selectedMessage.imap_thread_id ? (
            <div className="space-y-1">
              <Label className="text-xs">IMAP-Thread</Label>
              <p className="break-all font-mono text-[10px] text-muted-foreground">
                {selectedMessage.imap_thread_id}
              </p>
            </div>
          ) : null}

          <div className="space-y-2">
            <Label className="text-xs">Interne Notizen</Label>
            {internalNotes.length === 0 ? (
              <p className="text-xs text-muted-foreground">Noch keine Notizen.</p>
            ) : (
              <ul className="space-y-1">
                {internalNotes.map((n) => (
                  <li
                    key={n.id}
                    className="rounded bg-background px-2 py-1.5 text-xs shadow-sm"
                  >
                    {editingNoteId === n.id ? (
                      <div className="space-y-1">
                        <Textarea
                          value={editingNoteBody}
                          onChange={(e) => setEditingNoteBody(e.target.value)}
                          className="min-h-[60px] text-xs"
                        />
                        <div className="flex gap-1">
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 flex-1"
                            onClick={async () => {
                              const r = await invokeIpc<{ success: boolean; error?: string }>(
                                IPCChannels.Email.UpdateInternalNote,
                                { noteId: n.id, body: editingNoteBody },
                              )
                              if (!r.success) {
                                toast.error(r.error ?? "Speichern fehlgeschlagen")
                                return
                              }
                              setEditingNoteId(null)
                              await reloadNotes()
                              toast.success("Notiz gespeichert")
                            }}
                          >
                            Speichern
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-7"
                            onClick={() => setEditingNoteId(null)}
                          >
                            Abbrechen
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap">{n.body}</p>
                        <div className="mt-1 flex gap-1">
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            aria-label="Notiz bearbeiten"
                            onClick={() => {
                              setEditingNoteId(n.id)
                              setEditingNoteBody(n.body)
                            }}
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive"
                            aria-label="Notiz löschen"
                            onClick={async () => {
                              await invokeIpc(IPCChannels.Email.DeleteInternalNote, n.id)
                              await reloadNotes()
                              toast.success("Notiz gelöscht")
                            }}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <Textarea
              value={newNote}
              onChange={(e) => setNewNote(e.target.value)}
              placeholder="Notiz hinzufügen…"
              className="min-h-[70px] text-sm"
            />
            <Button
              type="button"
              size="sm"
              className="w-full"
              onClick={async () => {
                if (!newNote.trim()) return
                await invokeIpc(IPCChannels.Email.AddInternalNote, {
                  messageId: selectedMessage.id,
                  body: newNote,
                })
                setNewNote("")
                await reloadNotes()
                toast.success("Notiz hinzugefügt")
              }}
            >
              Speichern
            </Button>
          </div>
        </div>
      </ScrollArea>
    </aside>
  )
}
