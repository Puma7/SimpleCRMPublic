"use client"

import { useCallback, useEffect, useState, type ReactNode } from "react"
import { Link } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { Loader2, Mail, RefreshCw, Send, Workflow, Settings, Search, Trash2, Archive, RotateCcw } from "lucide-react"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type EmailAccount = {
  id: number
  display_name: string
  email_address: string
  imap_host: string
  imap_port: number
  imap_tls: number
  imap_username: string
  keytar_account_key: string
  created_at: string
  updated_at: string
}

type EmailMessage = {
  id: number
  account_id: number
  folder_id: number
  uid: number
  subject: string | null
  snippet: string | null
  date_received: string | null
  from_json: string | null
  body_text: string | null
  body_html: string | null
  seen_local: number
  archived?: number
  outbound_hold?: number
  outbound_block_reason?: string | null
  ticket_code?: string | null
  customer_id?: number | null
  folder_kind?: string
}

type MailView = "inbox" | "sent" | "archived" | "drafts"

type CategoryRow = { id: number; parent_id: number | null; name: string; sort_order: number }
type CatCount = { categoryId: number; count: number }
type CustomerOpt = { id: number; name: string; customerNumber?: string | null }
type Canned = { id: number; title: string; body: string }
type AiPrompt = { id: number; label: string; user_template: string }

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

function firstAddress(fromJson: string | null): string {
  if (!fromJson) return ""
  try {
    const parsed = JSON.parse(fromJson) as { value?: { address?: string }[] }
    return parsed?.value?.[0]?.address ?? ""
  } catch {
    return ""
  }
}

function formatFrom(fromJson: string | null): string {
  if (!fromJson) return "—"
  try {
    const parsed = JSON.parse(fromJson) as { value?: { name?: string; address?: string }[] }
    const v = parsed?.value?.[0]
    if (v?.name && v?.address) return `${v.name} <${v.address}>`
    if (v?.address) return v.address
    return fromJson
  } catch {
    return fromJson
  }
}

function applyCannedTemplate(body: string, customerId: number | null, customers: CustomerOpt[]): string {
  let c: CustomerOpt | undefined
  if (customerId) c = customers.find((x) => x.id === customerId)
  return body
    .replace(/\{\{customer\.name\}\}/g, c?.name ?? "")
    .replace(/\{\{customer\.firstName\}\}/g, "")
    .replace(/\{\{customer\.email\}\}/g, "")
}

export default function EmailPage() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
  const [mailView, setMailView] = useState<MailView>("inbox")
  const [categoryFilterId, setCategoryFilterId] = useState<number | null>(null)
  const [categories, setCategories] = useState<CategoryRow[]>([])
  const [catCounts, setCatCounts] = useState<CatCount[]>([])
  const [searchQ, setSearchQ] = useState("")
  const [messages, setMessages] = useState<EmailMessage[]>([])
  const [selectedMessage, setSelectedMessage] = useState<EmailMessage | null>(null)
  const [loadingAccounts, setLoadingAccounts] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [loadingMessages, setLoadingMessages] = useState(false)

  const [displayName, setDisplayName] = useState("")
  const [emailAddress, setEmailAddress] = useState("")
  const [imapHost, setImapHost] = useState("")
  const [imapPort, setImapPort] = useState("993")
  const [imapTls, setImapTls] = useState(true)
  const [imapUsername, setImapUsername] = useState("")
  const [imapPassword, setImapPassword] = useState("")
  const [testing, setTesting] = useState(false)
  const [saving, setSaving] = useState(false)

  const [composeOpen, setComposeOpen] = useState(false)
  const [composeDraftId, setComposeDraftId] = useState<number | null>(null)
  const [composeReplyToId, setComposeReplyToId] = useState<number | null>(null)
  const [composeTo, setComposeTo] = useState("")
  const [composeCc, setComposeCc] = useState("")
  const [composeSubject, setComposeSubject] = useState("")
  const [composeBody, setComposeBody] = useState("")
  const [composeSending, setComposeSending] = useState(false)
  const [messageTags, setMessageTags] = useState<string[]>([])
  const [internalNotes, setInternalNotes] = useState<{ id: number; body: string; created_at: string }[]>([])
  const [newNote, setNewNote] = useState("")
  const [customers, setCustomers] = useState<CustomerOpt[]>([])
  const [cannedList, setCannedList] = useState<Canned[]>([])
  const [aiPrompts, setAiPrompts] = useState<AiPrompt[]>([])

  const hasElectron =
    typeof window !== "undefined" &&
    window.electronAPI &&
    typeof (window.electronAPI as { invoke?: unknown }).invoke === "function"

  const invoke = <T,>(channel: string, ...args: unknown[]) =>
    (window.electronAPI as { invoke: (c: string, ...a: unknown[]) => Promise<T> }).invoke(channel, ...args)

  const loadAccounts = useCallback(async () => {
    if (!hasElectron) return
    setLoadingAccounts(true)
    try {
      const list = await invoke<EmailAccount[]>(IPCChannels.Email.ListAccounts)
      setAccounts(list)
      setSelectedAccountId((prev) => (prev === null && list.length > 0 ? list[0]!.id : prev))
    } catch (e) {
      console.error(e)
      toast.error("Konten konnten nicht geladen werden.")
    } finally {
      setLoadingAccounts(false)
    }
  }, [hasElectron])

  const loadCategories = useCallback(
    async (accountId: number) => {
      if (!hasElectron) return
      try {
        const cats = await invoke<CategoryRow[]>(IPCChannels.Email.ListCategories)
        setCategories(cats)
        const counts = await invoke<CatCount[]>(IPCChannels.Email.CategoryCounts, accountId)
        setCatCounts(counts)
      } catch {
        setCategories([])
        setCatCounts([])
      }
    },
    [hasElectron],
  )

  const loadMessages = useCallback(
    async (accountId: number, view: MailView, catId: number | null, query: string) => {
      if (!hasElectron) return
      setLoadingMessages(true)
      try {
        let list: EmailMessage[]
        if (query.trim()) {
          list = await invoke<EmailMessage[]>(IPCChannels.Email.SearchMessages, {
            accountId,
            query: query.trim(),
            limit: 150,
          })
        } else {
          list = await invoke<EmailMessage[]>(IPCChannels.Email.ListMessagesByView, {
            accountId,
            view,
            limit: 250,
            categoryId: view === "inbox" ? catId : null,
          })
        }
        setMessages(list)
        setSelectedMessage(null)
      } catch (e) {
        console.error(e)
        toast.error("Nachrichten konnten nicht geladen werden.")
      } finally {
        setLoadingMessages(false)
      }
    },
    [hasElectron],
  )

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  useEffect(() => {
    if (selectedAccountId != null) {
      void loadCategories(selectedAccountId)
      void loadMessages(selectedAccountId, mailView, categoryFilterId, searchQ)
    } else {
      setMessages([])
    }
  }, [selectedAccountId, mailView, categoryFilterId, searchQ, loadMessages, loadCategories])

  useEffect(() => {
    if (!hasElectron) return
    void (async () => {
      try {
        const dd = await invoke<CustomerOpt[]>(IPCChannels.Db.GetCustomersDropdown)
        setCustomers(dd)
      } catch {
        setCustomers([])
      }
    })()
  }, [hasElectron])

  useEffect(() => {
    if (!hasElectron || !composeOpen) return
    void (async () => {
      try {
        setCannedList(await invoke<Canned[]>(IPCChannels.Email.ListCannedResponses))
        setAiPrompts(await invoke<AiPrompt[]>(IPCChannels.Email.ListAiPrompts))
      } catch {
        setCannedList([])
        setAiPrompts([])
      }
    })()
  }, [hasElectron, composeOpen])

  const handleTestImap = async () => {
    if (!hasElectron) return
    setTesting(true)
    try {
      const result = (await invoke<{ success: boolean; error?: string }>(IPCChannels.Email.TestImap, {
        imapHost: imapHost.trim(),
        imapPort: parseInt(imapPort, 10) || 993,
        imapTls,
        imapUsername: imapUsername.trim(),
        imapPassword,
      })) as { success: boolean; error?: string }
      if (result.success) toast.success("IMAP-Verbindung erfolgreich.")
      else toast.error(result.error ?? "Verbindung fehlgeschlagen.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verbindung fehlgeschlagen.")
    } finally {
      setTesting(false)
    }
  }

  const handleSaveAccount = async () => {
    if (!hasElectron) return
    if (!displayName.trim() || !emailAddress.trim() || !imapHost.trim() || !imapUsername.trim() || !imapPassword) {
      toast.error("Bitte alle Felder inkl. Passwort ausfüllen.")
      return
    }
    setSaving(true)
    try {
      const res = (await invoke<{ success: boolean; id?: number }>(IPCChannels.Email.CreateAccount, {
        displayName: displayName.trim(),
        emailAddress: emailAddress.trim(),
        imapHost: imapHost.trim(),
        imapPort: parseInt(imapPort, 10) || 993,
        imapTls,
        imapUsername: imapUsername.trim(),
        imapPassword,
      })) as { id?: number }
      if (res.id != null) {
        toast.success("Konto gespeichert.")
        setImapPassword("")
        await loadAccounts()
        setSelectedAccountId(res.id)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen.")
    } finally {
      setSaving(false)
    }
  }

  const handleSync = async () => {
    if (!hasElectron || selectedAccountId == null) return
    setSyncing(true)
    try {
      const result = await invoke<{ success: boolean; fetched?: number; error?: string }>(
        IPCChannels.Email.SyncAccount,
        selectedAccountId,
      )
      if (result.success) {
        toast.success(`Synchronisation abgeschlossen (${result.fetched ?? 0} neue/aktualisierte Nachrichten).`)
        await loadMessages(selectedAccountId, mailView, categoryFilterId, searchQ)
        await loadCategories(selectedAccountId)
      } else toast.error(result.error ?? "Sync fehlgeschlagen.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync fehlgeschlagen.")
    } finally {
      setSyncing(false)
    }
  }

  useEffect(() => {
    if (!hasElectron || !selectedMessage) {
      setMessageTags([])
      setInternalNotes([])
      return
    }
    void (async () => {
      try {
        setMessageTags(await invoke<string[]>(IPCChannels.Email.ListMessageTags, selectedMessage.id))
        setInternalNotes(await invoke<{ id: number; body: string; created_at: string }[]>(IPCChannels.Email.ListInternalNotes, selectedMessage.id))
      } catch {
        setMessageTags([])
        setInternalNotes([])
      }
    })()
  }, [hasElectron, selectedMessage?.id])

  const openMessage = async (m: EmailMessage) => {
    if (!hasElectron) {
      setSelectedMessage(m)
      return
    }
    try {
      const full = await invoke<EmailMessage | null>(IPCChannels.Email.GetMessage, m.id)
      setSelectedMessage(full ?? m)
    } catch {
      setSelectedMessage(m)
    }
  }

  const startCompose = async (replyTo: EmailMessage | null) => {
    if (!hasElectron || selectedAccountId == null) return
    const m = replyTo
    const toAddr = m ? firstAddress(m.from_json) : ""
    const subj =
      m && m.subject
        ? m.subject.toLowerCase().startsWith("re:")
          ? m.subject
          : `Re: ${m.subject}`
        : ""
    const quoted =
      m &&
      `\n\n---\nAm ${m.date_received ? new Date(m.date_received).toLocaleString("de-DE") : "?"} schrieb ${formatFrom(m.from_json)}:\n${(m.body_text || m.snippet || "").trim()}`
    try {
      const res = (await invoke<{ id?: number }>(IPCChannels.Email.CreateComposeDraft, {
        accountId: selectedAccountId,
        subject: subj,
        bodyText: quoted || "",
        to: toAddr,
      })) as { id?: number }
      if (res.id != null) {
        setComposeDraftId(res.id)
        setComposeReplyToId(m?.id ?? null)
        setComposeTo(toAddr)
        setComposeCc("")
        setComposeSubject(subj)
        setComposeBody(quoted || "")
        setComposeOpen(true)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Entwurf konnte nicht angelegt werden.")
    }
  }

  const saveComposeDraft = async () => {
    if (!hasElectron || composeDraftId == null) return
    try {
      await invoke(IPCChannels.Email.UpdateComposeDraft, {
        messageId: composeDraftId,
        subject: composeSubject,
        bodyText: composeBody,
        to: composeTo,
        cc: composeCc || undefined,
      })
    } catch {
      /* ignore */
    }
  }

  const handleSendCompose = async () => {
    if (!hasElectron || composeDraftId == null || selectedAccountId == null) return
    setComposeSending(true)
    try {
      await saveComposeDraft()
      const r = await invoke<{ success: boolean; error?: string }>(IPCChannels.Email.SendCompose, {
        accountId: selectedAccountId,
        draftMessageId: composeDraftId,
        subject: composeSubject,
        bodyText: composeBody,
        to: composeTo,
        cc: composeCc || undefined,
        inReplyToMessageId: composeReplyToId,
      })
      if (!r.success) {
        toast.error(r.error ?? "Versand fehlgeschlagen")
        return
      }
      toast.success("E-Mail gesendet.")
      setComposeOpen(false)
      setComposeDraftId(null)
      setComposeReplyToId(null)
      if (selectedAccountId != null) {
        await loadMessages(selectedAccountId, mailView, categoryFilterId, searchQ)
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Versand fehlgeschlagen.")
    } finally {
      setComposeSending(false)
    }
  }

  const countForCategory = (id: number) => catCounts.find((c) => c.categoryId === id)?.count ?? 0

  const categoryTree = (() => {
    const roots = categories.filter((c) => c.parent_id == null).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    const children = (pid: number) =>
      categories.filter((c) => c.parent_id === pid).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name))
    const render = (nodes: CategoryRow[], depth: number): ReactNode[] =>
      nodes.flatMap((n) => [
        <button
          key={n.id}
          type="button"
          className={cn(
            "flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm hover:bg-muted/80",
            categoryFilterId === n.id && "bg-muted font-medium",
          )}
          style={{ paddingLeft: 8 + depth * 12 }}
          onClick={() => {
            setCategoryFilterId(n.id)
            setMailView("inbox")
            setSearchQ("")
          }}
        >
          <span>{n.name}</span>
          <span className="text-xs text-muted-foreground">{countForCategory(n.id)}</span>
        </button>,
        ...render(children(n.id), depth + 1),
      ])
    return render(roots, 0)
  })()

  if (!hasElectron) {
    return (
      <div className="container max-w-2xl py-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              E-Mail
            </CardTitle>
            <CardDescription>
              Das E-Mail-Modul ist nur in der Desktop-App (Electron) verfügbar. Bitte starten Sie SimpleCRM mit{" "}
              <code className="rounded bg-muted px-1">npm run electron:dev</code>.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  return (
    <div className="container flex min-h-[calc(100vh-8rem)] flex-col gap-4 py-6">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">E-Mail</h1>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/email/workflows">
                <Workflow className="mr-2 h-4 w-4" />
                Workflows
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link to="/email/settings">
                <Settings className="mr-2 h-4 w-4" />
                SMTP &amp; KI
              </Link>
            </Button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          IMAP-Sync, Kategorien, Tickets [SCR-…], SMTP-Versand, Workflows, interne Notizen, Textbausteine und KI (OpenAI-kompatibel).
        </p>
      </div>

      <div className="grid flex-1 gap-4 xl:grid-cols-[200px_minmax(280px,320px)_1fr]">
        <Card className="h-fit xl:sticky xl:top-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Ordner</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            {(
              [
                ["inbox", "Posteingang"],
                ["sent", "Gesendet"],
                ["archived", "Archiv"],
                ["drafts", "Entwürfe"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={cn(
                  "w-full rounded-md px-2 py-1.5 text-left hover:bg-muted/80",
                  mailView === v && "bg-muted font-medium",
                )}
                onClick={() => {
                  setMailView(v)
                  setCategoryFilterId(null)
                  setSearchQ("")
                }}
              >
                {label}
              </button>
            ))}
            <Separator className="my-2" />
            <p className="text-xs font-medium text-muted-foreground">Kategorien</p>
            <button
              type="button"
              className={cn(
                "w-full rounded-md px-2 py-1 text-left text-sm hover:bg-muted/80",
                categoryFilterId === null && mailView === "inbox" && "bg-muted",
              )}
              onClick={() => setCategoryFilterId(null)}
            >
              Alle
            </button>
            {categoryTree}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Neues IMAP-Konto</CardTitle>
              <CardDescription>Zugangsdaten im Schlüsselbund.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="em-display">Anzeigename</Label>
                <Input id="em-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="em-addr">E-Mail-Adresse</Label>
                <Input id="em-addr" type="email" value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="em-host">IMAP-Server</Label>
                <Input id="em-host" value={imapHost} onChange={(e) => setImapHost(e.target.value)} />
              </div>
              <div className="flex gap-2">
                <div className="flex-1 space-y-1.5">
                  <Label htmlFor="em-port">Port</Label>
                  <Input id="em-port" value={imapPort} onChange={(e) => setImapPort(e.target.value)} />
                </div>
                <div className="flex items-end gap-2 pb-2">
                  <Switch id="em-tls" checked={imapTls} onCheckedChange={setImapTls} />
                  <Label htmlFor="em-tls" className="cursor-pointer text-sm font-normal">
                    TLS
                  </Label>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="em-user">IMAP-Benutzername</Label>
                <Input id="em-user" value={imapUsername} onChange={(e) => setImapUsername(e.target.value)} autoComplete="off" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="em-pass">Passwort</Label>
                <Input id="em-pass" type="password" value={imapPassword} onChange={(e) => setImapPassword(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" variant="secondary" size="sm" onClick={() => void handleTestImap()} disabled={testing}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  IMAP testen
                </Button>
                <Button type="button" size="sm" onClick={() => void handleSaveAccount()} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Speichern
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Konten</CardTitle>
            </CardHeader>
            <CardContent>
              {loadingAccounts ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch kein Konto.</p>
              ) : (
                <ScrollArea className="h-[140px] pr-2">
                  <ul className="space-y-1">
                    {accounts.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedAccountId(a.id)}
                          className={cn(
                            "w-full rounded-md border px-3 py-2 text-left text-sm",
                            selectedAccountId === a.id ? "border-primary bg-primary/5" : "border-transparent hover:bg-muted/80",
                          )}
                        >
                          <div className="font-medium">{a.display_name}</div>
                          <div className="text-xs text-muted-foreground">{a.email_address}</div>
                        </button>
                      </li>
                    ))}
                  </ul>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        </div>

        <Card className="flex min-h-[520px] flex-col">
          <CardHeader className="space-y-3 pb-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Nachrichten</CardTitle>
              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" variant="secondary" onClick={() => void startCompose(null)} disabled={selectedAccountId == null}>
                  <Send className="mr-2 h-4 w-4" />
                  Neu
                </Button>
                <Button type="button" size="sm" variant="secondary" onClick={() => void startCompose(selectedMessage)} disabled={selectedAccountId == null || !selectedMessage}>
                  <Send className="mr-2 h-4 w-4" />
                  Antworten
                </Button>
                <Button type="button" size="sm" variant="outline" onClick={() => void handleSync()} disabled={selectedAccountId == null || syncing}>
                  {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                  Sync
                </Button>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input className="pl-8" placeholder="Suche…" value={searchQ} onChange={(e) => setSearchQ(e.target.value)} />
              </div>
            </div>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-0 overflow-hidden p-0">
            <div className="grid flex-1 grid-cols-1 gap-0 md:grid-cols-[minmax(200px,260px)_1fr] md:divide-x">
              <ScrollArea className="h-[440px] md:h-[560px]">
                <div className="p-2">
                  {loadingMessages ? (
                    <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Lädt…
                    </p>
                  ) : messages.length === 0 ? (
                    <p className="p-2 text-sm text-muted-foreground">Keine Einträge.</p>
                  ) : (
                    <ul className="space-y-0.5">
                      {messages.map((m) => (
                        <li key={m.id}>
                          <button
                            type="button"
                            onClick={() => void openMessage(m)}
                            className={cn(
                              "w-full rounded-md px-2 py-2 text-left text-sm hover:bg-muted/80",
                              selectedMessage?.id === m.id && "bg-muted",
                              !m.seen_local && m.uid >= 0 && "font-semibold",
                            )}
                          >
                            <div className="line-clamp-1">{m.subject || "(Ohne Betreff)"}</div>
                            <div className="line-clamp-1 text-xs text-muted-foreground">{formatFrom(m.from_json)}</div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </ScrollArea>
              <div className="min-h-[200px] flex-1 p-4">
                {selectedMessage ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {selectedMessage.uid >= 0 ? (
                        <>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              await invoke(IPCChannels.Email.SoftDeleteMessage, selectedMessage.id)
                              toast.success("Ausgeblendet (soft)")
                              if (selectedAccountId) await loadMessages(selectedAccountId, mailView, categoryFilterId, searchQ)
                              setSelectedMessage(null)
                            }}
                          >
                            <Trash2 className="mr-1 h-4 w-4" />
                            Ausblenden
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              await invoke(IPCChannels.Email.RestoreMessage, selectedMessage.id)
                              toast.success("Wiederhergestellt")
                              if (selectedAccountId) await loadMessages(selectedAccountId, mailView, categoryFilterId, searchQ)
                            }}
                          >
                            <RotateCcw className="mr-1 h-4 w-4" />
                            Wiederherstellen
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            onClick={async () => {
                              await invoke(IPCChannels.Email.SetMessageArchived, {
                                messageId: selectedMessage.id,
                                archived: !selectedMessage.archived,
                              })
                              toast.success(selectedMessage.archived ? "Wieder im Posteingang sichtbar" : "Archiviert")
                              const full = await invoke<EmailMessage | null>(IPCChannels.Email.GetMessage, selectedMessage.id)
                              setSelectedMessage(full ?? selectedMessage)
                              if (selectedAccountId) await loadMessages(selectedAccountId, mailView, categoryFilterId, searchQ)
                            }}
                          >
                            <Archive className="mr-1 h-4 w-4" />
                            {selectedMessage.archived ? "Aus Archiv" : "Archivieren"}
                          </Button>
                        </>
                      ) : null}
                    </div>
                    {selectedMessage.archived ? (
                      <p className="text-xs font-medium text-amber-700 dark:text-amber-400">Archiviert</p>
                    ) : null}
                    {selectedMessage.ticket_code ? (
                      <p className="text-xs text-muted-foreground">Ticket: {selectedMessage.ticket_code}</p>
                    ) : null}
                    {messageTags.length > 0 ? <p className="text-xs text-muted-foreground">Tags: {messageTags.join(", ")}</p> : null}
                    <div className="flex flex-wrap items-end gap-2">
                      <div className="min-w-[200px] flex-1 space-y-1">
                        <Label className="text-xs">Kunde verknüpfen</Label>
                        <Select
                          value={selectedMessage.customer_id ? String(selectedMessage.customer_id) : "none"}
                          onValueChange={async (v) => {
                            const cid = v === "none" ? null : parseInt(v, 10)
                            await invoke(IPCChannels.Email.LinkCustomer, { messageId: selectedMessage.id, customerId: cid })
                            const full = await invoke<EmailMessage | null>(IPCChannels.Email.GetMessage, selectedMessage.id)
                            setSelectedMessage(full ?? selectedMessage)
                            toast.success("Verknüpfung gespeichert")
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder="Kunde" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— keiner —</SelectItem>
                            {customers.map((c) => (
                              <SelectItem key={c.id} value={String(c.id)}>
                                {c.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <h2 className="text-lg font-semibold leading-tight">{selectedMessage.subject || "(Ohne Betreff)"}</h2>
                    <p className="text-sm text-muted-foreground">{formatFrom(selectedMessage.from_json)}</p>
                    {selectedMessage.date_received ? (
                      <p className="text-xs text-muted-foreground">{new Date(selectedMessage.date_received).toLocaleString("de-DE")}</p>
                    ) : null}
                    <Separator />
                    <div>
                      <p className="mb-1 text-xs font-medium">Interne Notizen</p>
                      <ul className="mb-2 space-y-1 text-sm">
                        {internalNotes.map((n) => (
                          <li key={n.id} className="rounded bg-muted/50 px-2 py-1">
                            {n.body}
                          </li>
                        ))}
                      </ul>
                      <Textarea value={newNote} onChange={(e) => setNewNote(e.target.value)} placeholder="Notiz…" className="min-h-[60px] text-sm" />
                      <Button
                        type="button"
                        size="sm"
                        className="mt-1"
                        onClick={async () => {
                          if (!newNote.trim()) return
                          await invoke(IPCChannels.Email.AddInternalNote, { messageId: selectedMessage.id, body: newNote })
                          setNewNote("")
                          setInternalNotes(await invoke(IPCChannels.Email.ListInternalNotes, selectedMessage.id))
                        }}
                      >
                        Notiz speichern
                      </Button>
                    </div>
                    <Separator />
                    <ScrollArea className="h-[min(280px,40vh)]">
                      <pre className="whitespace-pre-wrap font-sans text-sm">
                        {selectedMessage.body_text?.trim() ||
                          (selectedMessage.body_html ? stripHtmlToText(selectedMessage.body_html) : "") ||
                          selectedMessage.snippet ||
                          "—"}
                      </pre>
                    </ScrollArea>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nachricht wählen.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {composeOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
            <CardHeader>
              <CardTitle>Nachricht</CardTitle>
              <CardDescription>Textbausteine und KI unter „SMTP &amp; KI“ pflegen. Versand nach Outbound-Workflow.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Select
                  onValueChange={(id) => {
                    const c = cannedList.find((x) => x.id === parseInt(id, 10))
                    if (c) setComposeBody((prev) => prev + applyCannedTemplate(c.body, selectedMessage?.customer_id ?? null, customers))
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="Textbaustein" />
                  </SelectTrigger>
                  <SelectContent>
                    {cannedList.map((c) => (
                      <SelectItem key={c.id} value={String(c.id)}>
                        {c.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  onValueChange={async (id) => {
                    const pid = parseInt(id, 10)
                    try {
                      const r = await invoke<{ success: boolean; text?: string; error?: string }>(IPCChannels.Email.AiTransformText, {
                        promptId: pid,
                        text: composeBody,
                        customerId: selectedMessage?.customer_id ?? null,
                      })
                      if (r.success && r.text) setComposeBody(r.text)
                      else toast.error(r.error ?? "KI-Fehler")
                    } catch (e) {
                      toast.error(e instanceof Error ? e.message : "KI-Fehler")
                    }
                  }}
                >
                  <SelectTrigger className="w-[180px]">
                    <SelectValue placeholder="KI auf Text" />
                  </SelectTrigger>
                  <SelectContent>
                    {aiPrompts.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>An</Label>
                <Input value={composeTo} onChange={(e) => setComposeTo(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Cc</Label>
                <Input value={composeCc} onChange={(e) => setComposeCc(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Betreff</Label>
                <Input value={composeSubject} onChange={(e) => setComposeSubject(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Text</Label>
                <Textarea className="min-h-[160px]" value={composeBody} onChange={(e) => setComposeBody(e.target.value)} />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="secondary" onClick={() => void saveComposeDraft().then(() => toast.success("Gespeichert"))}>
                  Entwurf
                </Button>
                <Button type="button" onClick={() => void handleSendCompose()} disabled={composeSending}>
                  {composeSending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Senden
                </Button>
                <Button type="button" variant="ghost" onClick={() => setComposeOpen(false)}>
                  Schließen
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}
    </div>
  )
}
