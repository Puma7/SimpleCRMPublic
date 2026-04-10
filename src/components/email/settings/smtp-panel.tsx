"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { hasElectron, invokeIpc, type EmailAccount } from "../types"

export function SmtpPanel() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [accId, setAccId] = useState<number | null>(null)
  const [smtpHost, setSmtpHost] = useState("")
  const [smtpPort, setSmtpPort] = useState("587")
  const [smtpTls, setSmtpTls] = useState(true)
  const [smtpUser, setSmtpUser] = useState("")
  const [smtpImapAuth, setSmtpImapAuth] = useState(true)
  const [smtpPass, setSmtpPass] = useState("")
  const [sentFolder, setSentFolder] = useState("Sent")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const load = useCallback(async () => {
    if (!hasElectron()) return
    const list = await invokeIpc<EmailAccount[]>(IPCChannels.Email.ListAccounts)
    setAccounts(list)
  }, [])

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
      setSentFolder(a.sent_folder_path || "Sent")
    }
  }, [accId, accounts])

  const saveSmtp = async () => {
    if (!hasElectron() || accId == null) return
    setSaving(true)
    try {
      await invokeIpc(IPCChannels.Email.UpdateAccount, {
        id: accId,
        smtpHost: smtpHost.trim() || null,
        smtpPort: parseInt(smtpPort, 10) || 587,
        smtpTls,
        smtpUsername: smtpUser.trim() || null,
        smtpUseImapAuth: smtpImapAuth,
        smtpPassword: smtpPass || undefined,
        sentFolderPath: sentFolder.trim() || null,
      })
      toast.success("SMTP gespeichert.")
      setSmtpPass("")
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler")
    } finally {
      setSaving(false)
    }
  }

  const testSmtp = async () => {
    if (!hasElectron()) return
    const user = smtpImapAuth
      ? accounts.find((x) => x.id === accId)?.imap_username || ""
      : smtpUser
    if (!smtpPass) {
      toast.error("Bitte SMTP-Passwort zum Testen eingeben.")
      return
    }
    setTesting(true)
    try {
      const r = await invokeIpc<{ success: boolean; error?: string }>(
        IPCChannels.Email.TestSmtp,
        {
          host: smtpHost.trim(),
          port: parseInt(smtpPort, 10) || 587,
          secure: smtpTls && (parseInt(smtpPort, 10) || 587) === 465,
          user,
          password: smtpPass,
        },
      )
      if (r.success) toast.success("SMTP OK")
      else toast.error(r.error ?? "Fehler")
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">SMTP (Versand)</h3>
        <p className="text-sm text-muted-foreground">
          Pro Konto. Ohne separates Passwort wird das IMAP-Passwort genutzt, wenn „Wie IMAP" aktiv ist.
        </p>
      </div>

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
              {a.display_name} ({a.email_address})
            </option>
          ))}
        </select>
      </div>

      {accId != null ? (
        <>
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
            <Switch
              checked={smtpImapAuth}
              onCheckedChange={setSmtpImapAuth}
              id="smtp-same"
            />
            <Label htmlFor="smtp-same">SMTP-Anmeldung wie IMAP</Label>
          </div>
          {!smtpImapAuth ? (
            <div className="space-y-1.5">
              <Label>SMTP-Benutzername</Label>
              <Input value={smtpUser} onChange={(e) => setSmtpUser(e.target.value)} />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label>SMTP-Passwort (leer = unverändert)</Label>
            <Input
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              autoComplete="new-password"
            />
          </div>
          <div className="space-y-1.5">
            <Label>IMAP Sent-Ordner (für Kopie nach Versand)</Label>
            <Input
              value={sentFolder}
              onChange={(e) => setSentFolder(e.target.value)}
              placeholder="Sent"
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => void testSmtp()}
              disabled={testing}
            >
              {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Test
            </Button>
            <Button type="button" onClick={() => void saveSmtp()} disabled={saving}>
              {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Speichern
            </Button>
          </div>
        </>
      ) : null}
    </div>
  )
}
