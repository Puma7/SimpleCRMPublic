"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Switch } from "@/components/ui/switch"
import { toast } from "sonner"
import { Loader2, Mail, RefreshCw } from "lucide-react"
import { cn } from "@/lib/utils"

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
}

function stripHtmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
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

export default function EmailPage() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)
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

  const hasElectron =
    typeof window !== "undefined" &&
    window.electronAPI &&
    typeof (window.electronAPI as { invoke?: unknown }).invoke === "function"

  const loadAccounts = useCallback(async () => {
    if (!hasElectron) return
    setLoadingAccounts(true)
    try {
      const list = (await (window.electronAPI as { invoke: (c: string) => Promise<EmailAccount[]> }).invoke(
        IPCChannels.Email.ListAccounts,
      )) as EmailAccount[]
      setAccounts(list)
      setSelectedAccountId((prev) => (prev === null && list.length > 0 ? list[0]!.id : prev))
    } catch (e) {
      console.error(e)
      toast.error("Konten konnten nicht geladen werden.")
    } finally {
      setLoadingAccounts(false)
    }
  }, [hasElectron])

  const loadMessages = useCallback(
    async (accountId: number) => {
      if (!hasElectron) return
      setLoadingMessages(true)
      try {
        const list = (await (window.electronAPI as { invoke: (c: string, p: unknown) => Promise<EmailMessage[]> }).invoke(
          IPCChannels.Email.ListMessages,
          { accountId, folderPath: "INBOX", limit: 200 },
        )) as EmailMessage[]
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
      void loadMessages(selectedAccountId)
    } else {
      setMessages([])
    }
  }, [selectedAccountId, loadMessages])

  const handleTestImap = async () => {
    if (!hasElectron) return
    setTesting(true)
    try {
      const result = (await (window.electronAPI as { invoke: (c: string, p: unknown) => Promise<{ success: boolean; error?: string }> }).invoke(
        IPCChannels.Email.TestImap,
        {
          imapHost: imapHost.trim(),
          imapPort: parseInt(imapPort, 10) || 993,
          imapTls,
          imapUsername: imapUsername.trim(),
          imapPassword,
        },
      )) as { success: boolean; error?: string }
      if (result.success) {
        toast.success("IMAP-Verbindung erfolgreich.")
      } else {
        toast.error(result.error ?? "Verbindung fehlgeschlagen.")
      }
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
      const res = (await (window.electronAPI as { invoke: (c: string, p: unknown) => Promise<{ success: boolean; id?: number }> }).invoke(
        IPCChannels.Email.CreateAccount,
        {
          displayName: displayName.trim(),
          emailAddress: emailAddress.trim(),
          imapHost: imapHost.trim(),
          imapPort: parseInt(imapPort, 10) || 993,
          imapTls,
          imapUsername: imapUsername.trim(),
          imapPassword,
        },
      )) as { success: boolean; id?: number }
      if (res.success && res.id != null) {
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
      const result = (await (window.electronAPI as { invoke: (c: string, id: number) => Promise<{ success: boolean; fetched?: number; error?: string }> }).invoke(
        IPCChannels.Email.SyncAccount,
        selectedAccountId,
      ))
      if (result.success) {
        toast.success(`Synchronisation abgeschlossen (${result.fetched ?? 0} neue/aktualisierte Nachrichten).`)
        await loadMessages(selectedAccountId)
      } else {
        toast.error(result.error ?? "Sync fehlgeschlagen.")
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sync fehlgeschlagen.")
    } finally {
      setSyncing(false)
    }
  }

  const openMessage = async (m: EmailMessage) => {
    if (!hasElectron) {
      setSelectedMessage(m)
      return
    }
    try {
      const full = (await (window.electronAPI as { invoke: (c: string, id: number) => Promise<EmailMessage | null> }).invoke(
        IPCChannels.Email.GetMessage,
        m.id,
      )) as EmailMessage | null
      setSelectedMessage(full ?? m)
    } catch {
      setSelectedMessage(m)
    }
  }

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
        <h1 className="text-2xl font-semibold tracking-tight">E-Mail</h1>
        <p className="text-sm text-muted-foreground">
          IMAP-Postfächer anbinden, INBOX synchronisieren und Nachrichten lesen. SMTP, Workflows und KI folgen in weiteren Versionen.
        </p>
      </div>

      <div className="grid flex-1 gap-4 lg:grid-cols-[minmax(280px,340px)_1fr]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Neues IMAP-Konto</CardTitle>
              <CardDescription>Zugangsdaten werden im System-Schlüsselbund gespeichert.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="em-display">Anzeigename</Label>
                <Input id="em-display" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Support" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="em-addr">E-Mail-Adresse</Label>
                <Input id="em-addr" type="email" value={emailAddress} onChange={(e) => setEmailAddress(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="em-host">IMAP-Server</Label>
                <Input id="em-host" value={imapHost} onChange={(e) => setImapHost(e.target.value)} placeholder="imap.example.com" />
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
                <Input
                  id="em-pass"
                  type="password"
                  value={imapPassword}
                  onChange={(e) => setImapPassword(e.target.value)}
                  autoComplete="new-password"
                />
              </div>
              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" variant="secondary" size="sm" onClick={() => void handleTestImap()} disabled={testing}>
                  {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Verbindung testen
                </Button>
                <Button type="button" size="sm" onClick={() => void handleSaveAccount()} disabled={saving}>
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                  Konto speichern
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
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Lädt…
                </div>
              ) : accounts.length === 0 ? (
                <p className="text-sm text-muted-foreground">Noch kein Konto angelegt.</p>
              ) : (
                <ScrollArea className="h-[180px] pr-3">
                  <ul className="space-y-1">
                    {accounts.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedAccountId(a.id)}
                          className={cn(
                            "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
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

        <Card className="flex min-h-[480px] flex-col">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <div>
              <CardTitle className="text-base">Posteingang (INBOX)</CardTitle>
              <CardDescription>
                {selectedAccountId != null
                  ? accounts.find((a) => a.id === selectedAccountId)?.email_address ?? ""
                  : "Konto auswählen"}
              </CardDescription>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => void handleSync()} disabled={selectedAccountId == null || syncing}>
              {syncing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              <span className="ml-2">Synchronisieren</span>
            </Button>
          </CardHeader>
          <CardContent className="flex flex-1 flex-col gap-0 overflow-hidden p-0">
            <div className="grid flex-1 grid-cols-1 gap-0 md:grid-cols-[minmax(200px,280px)_1fr] md:divide-x">
              <ScrollArea className="h-[420px] md:h-[520px]">
                <div className="p-2">
                  {loadingMessages ? (
                    <p className="flex items-center gap-2 p-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Lädt Nachrichten…
                    </p>
                  ) : messages.length === 0 ? (
                    <p className="p-2 text-sm text-muted-foreground">
                      Keine Nachrichten. Konto wählen und „Synchronisieren“ ausführen.
                    </p>
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
                              !m.seen_local && "font-semibold",
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
                    <div>
                      <h2 className="text-lg font-semibold leading-tight">{selectedMessage.subject || "(Ohne Betreff)"}</h2>
                      <p className="text-sm text-muted-foreground">{formatFrom(selectedMessage.from_json)}</p>
                      {selectedMessage.date_received ? (
                        <p className="text-xs text-muted-foreground">
                          {new Date(selectedMessage.date_received).toLocaleString("de-DE")}
                        </p>
                      ) : null}
                    </div>
                    <Separator />
                    <ScrollArea className="h-[min(360px,50vh)]">
                      <pre className="whitespace-pre-wrap font-sans text-sm">
                        {selectedMessage.body_text?.trim() ||
                          (selectedMessage.body_html ? stripHtmlToText(selectedMessage.body_html) : "") ||
                          selectedMessage.snippet ||
                          "—"}
                      </pre>
                    </ScrollArea>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nachricht aus der Liste wählen.</p>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
