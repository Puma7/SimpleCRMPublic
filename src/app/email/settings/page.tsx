"use client"

import { useCallback, useEffect, useState } from "react"
import { Link } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { toast } from "sonner"
import { ArrowLeft, Loader2 } from "lucide-react"

type Account = {
  id: number
  display_name: string
  email_address: string
  imap_host: string
  imap_port: number
  imap_username: string
  smtp_host?: string | null
  smtp_port?: number | null
  smtp_tls?: number | null
  smtp_username?: string | null
  smtp_use_imap_auth?: number | null
}

type Canned = { id: number; title: string; body: string }
type Prompt = { id: number; label: string; user_template: string; target: string }

export default function EmailSettingsPage() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [accId, setAccId] = useState<number | null>(null)
  const [smtpHost, setSmtpHost] = useState("")
  const [smtpPort, setSmtpPort] = useState("587")
  const [smtpTls, setSmtpTls] = useState(true)
  const [smtpUser, setSmtpUser] = useState("")
  const [smtpImapAuth, setSmtpImapAuth] = useState(true)
  const [smtpPass, setSmtpPass] = useState("")
  const [savingSmtp, setSavingSmtp] = useState(false)
  const [testingSmtp, setTestingSmtp] = useState(false)

  const [aiBase, setAiBase] = useState("https://api.openai.com/v1")
  const [aiModel, setAiModel] = useState("gpt-4o-mini")
  const [aiKey, setAiKey] = useState("")
  const [canned, setCanned] = useState<Canned[]>([])
  const [prompts, setPrompts] = useState<Prompt[]>([])

  const hasElectron =
    typeof window !== "undefined" &&
    window.electronAPI &&
    typeof (window.electronAPI as { invoke?: unknown }).invoke === "function"

  const load = useCallback(async () => {
    if (!hasElectron) return
    const list = (await (window.electronAPI as { invoke: (c: string) => Promise<Account[]> }).invoke(
      IPCChannels.Email.ListAccounts,
    )) as Account[]
    setAccounts(list)
    const s = (await (window.electronAPI as { invoke: (c: string) => Promise<{ baseUrl: string; model: string }> }).invoke(
      IPCChannels.Email.GetAiSettings,
    )) as { baseUrl: string; model: string }
    setAiBase(s.baseUrl)
    setAiModel(s.model)
    setCanned(
      (await (window.electronAPI as { invoke: (c: string) => Promise<Canned[]> }).invoke(IPCChannels.Email.ListCannedResponses)) as Canned[],
    )
    setPrompts(
      (await (window.electronAPI as { invoke: (c: string) => Promise<Prompt[]> }).invoke(IPCChannels.Email.ListAiPrompts)) as Prompt[],
    )
  }, [hasElectron])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const a = accounts.find((x) => x.id === accId)
    if (a) {
      setSmtpHost(a.smtp_host || a.imap_host || "")
      setSmtpPort(String(a.smtp_port ?? 587))
      setSmtpTls((a.smtp_tls ?? 1) === 1)
      setSmtpUser(a.smtp_username || "")
      setSmtpImapAuth((a.smtp_use_imap_auth ?? 1) === 1)
    }
  }, [accId, accounts])

  const saveSmtp = async () => {
    if (!hasElectron || accId == null) return
    setSavingSmtp(true)
    try {
      await (window.electronAPI as { invoke: (c: string, p: unknown) => Promise<unknown> }).invoke(IPCChannels.Email.UpdateAccount, {
        id: accId,
        smtpHost: smtpHost.trim() || null,
        smtpPort: parseInt(smtpPort, 10) || 587,
        smtpTls,
        smtpUsername: smtpUser.trim() || null,
        smtpUseImapAuth: smtpImapAuth,
        smtpPassword: smtpPass || undefined,
      })
      toast.success("SMTP gespeichert.")
      setSmtpPass("")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler")
    } finally {
      setSavingSmtp(false)
    }
  }

  const testSmtp = async () => {
    if (!hasElectron) return
    const user = smtpImapAuth ? accounts.find((x) => x.id === accId)?.imap_username || "" : smtpUser
    if (!smtpPass) {
      toast.error("Bitte SMTP-Passwort zum Testen eingeben.")
      return
    }
    setTestingSmtp(true)
    try {
      const r = (await (window.electronAPI as { invoke: (c: string, p: unknown) => Promise<{ success: boolean; error?: string }> }).invoke(
        IPCChannels.Email.TestSmtp,
        {
          host: smtpHost.trim(),
          port: parseInt(smtpPort, 10) || 587,
          secure: smtpTls && (parseInt(smtpPort, 10) || 587) === 465,
          user,
          password: smtpPass,
        },
      )) as { success: boolean; error?: string }
      if (r.success) toast.success("SMTP OK")
      else toast.error(r.error ?? "Fehler")
    } finally {
      setTestingSmtp(false)
    }
  }

  const saveAi = async () => {
    if (!hasElectron) return
    await (window.electronAPI as { invoke: (c: string, p: unknown) => Promise<unknown> }).invoke(IPCChannels.Email.SetAiSettings, {
      baseUrl: aiBase,
      model: aiModel,
    })
    if (aiKey.trim()) {
      await (window.electronAPI as { invoke: (c: string, k: string) => Promise<unknown> }).invoke(IPCChannels.Email.SetAiApiKey, aiKey.trim())
      setAiKey("")
    }
    toast.success("KI-Einstellungen gespeichert.")
  }

  if (!hasElectron) {
    return (
      <div className="container py-10">
        <p>Nur Desktop.</p>
      </div>
    )
  }

  return (
    <div className="container max-w-3xl space-y-6 py-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/email">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Zurück
        </Link>
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>SMTP (Versand)</CardTitle>
          <CardDescription>Pro Konto. Ohne separates Passwort wird das IMAP-Passwort genutzt, wenn „Wie IMAP“ aktiv ist.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Konto</Label>
            <select
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={accId ?? ""}
              onChange={(e) => setAccId(e.target.value ? parseInt(e.target.value, 10) : null)}
            >
              <option value="">— wählen —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.display_name}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label>SMTP-Host</Label>
            <Input value={smtpHost} onChange={(e) => setSmtpHost(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <Label>Port</Label>
              <Input value={smtpPort} onChange={(e) => setSmtpPort(e.target.value)} />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Switch checked={smtpTls} onCheckedChange={setSmtpTls} id="smtp-tls" />
              <Label htmlFor="smtp-tls">TLS (465 = SSL)</Label>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Switch checked={smtpImapAuth} onCheckedChange={setSmtpImapAuth} id="smtp-same" />
            <Label htmlFor="smtp-same">SMTP-Anmeldung wie IMAP</Label>
          </div>
          {!smtpImapAuth ? (
            <div className="space-y-1.5">
              <Label>SMTP-Benutzername</Label>
              <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>SMTP-Passwort (nur zum Speichern/Test, leer = unverändert)</Label>
            <Input type="password" value={smtpPass} onChange={(e) => setSmtpPass(e.target.value)} autoComplete="new-password" />
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" onClick={() => void testSmtp()} disabled={testingSmtp || accId == null}>
              {testingSmtp ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              Test
            </Button>
            <Button type="button" onClick={() => void saveSmtp()} disabled={savingSmtp || accId == null}>
              Speichern
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>KI (OpenAI-kompatibel)</CardTitle>
          <CardDescription>API-Key im Schlüsselbund. Basis-URL z. B. OpenAI oder kompatible Proxy.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-1.5">
            <Label>Base URL</Label>
            <Input value={aiBase} onChange={(e) => setAiBase(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Modell</Label>
            <Input value={aiModel} onChange={(e) => setAiModel(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>API-Key setzen</Label>
            <Input type="password" value={aiKey} onChange={(e) => setAiKey(e.target.value)} placeholder="sk-…" />
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void saveAi()}>
              Speichern
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                void (window.electronAPI as { invoke: (c: string) => Promise<unknown> })
                  .invoke(IPCChannels.Email.ClearAiApiKey)
                  .then(() => toast.success("API-Key entfernt"))
              }
            >
              Key löschen
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Textbausteine</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {canned.map((c) => (
            <div key={c.id} className="space-y-2 rounded border p-3">
              <Input
                defaultValue={c.title}
                id={`ct-${c.id}`}
                onBlur={async (e) => {
                  const body = (document.getElementById(`cb-${c.id}`) as HTMLTextAreaElement).value
                  await (window.electronAPI as { invoke: (c: string, p: unknown) => Promise<unknown> }).invoke(
                    IPCChannels.Email.SaveCannedResponse,
                    { id: c.id, title: e.target.value, body },
                  )
                }}
              />
              <Textarea defaultValue={c.body} id={`cb-${c.id}`} className="min-h-[80px] font-mono text-sm" />
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await (window.electronAPI as { invoke: (c: string, p: unknown) => Promise<unknown> }).invoke(
                IPCChannels.Email.SaveCannedResponse,
                { title: "Neu", body: "" },
              )
              await load()
            }}
          >
            Neuer Baustein
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>KI-Prompts (Composer)</CardTitle>
          <CardDescription>Platzhalter: {"{{text}}"}, {"{{customer.name}}"} …</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {prompts.map((p) => (
            <div key={p.id} className="space-y-2 rounded border p-3">
              <Input defaultValue={p.label} id={`pl-${p.id}`} />
              <Textarea defaultValue={p.user_template} id={`pt-${p.id}`} className="min-h-[100px] font-mono text-sm" />
              <Button
                type="button"
                size="sm"
                onClick={async () => {
                  const label = (document.getElementById(`pl-${p.id}`) as HTMLInputElement).value
                  const userTemplate = (document.getElementById(`pt-${p.id}`) as HTMLTextAreaElement).value
                  await (window.electronAPI as { invoke: (c: string, x: unknown) => Promise<unknown> }).invoke(
                    IPCChannels.Email.SaveAiPrompt,
                    { id: p.id, label, userTemplate },
                  )
                  toast.success("Gespeichert")
                }}
              >
                Speichern
              </Button>
            </div>
          ))}
          <Button
            type="button"
            variant="secondary"
            onClick={async () => {
              await (window.electronAPI as { invoke: (c: string, p: unknown) => Promise<unknown> }).invoke(
                IPCChannels.Email.SaveAiPrompt,
                { label: "Neu", userTemplate: "{{text}}" },
              )
              await load()
            }}
          >
            Neuer Prompt
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
