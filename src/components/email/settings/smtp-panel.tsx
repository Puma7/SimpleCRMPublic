"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { invokeRenderer } from "@/services/transport"
import { type EmailAccount } from "../types"
import { useMailWorkspace } from "../workspace-context"

type SmtpPanelProps = {
  /** Wenn gesetzt: festes Konto, kein Konto-Dropdown (Konten-Detail). */
  embeddedAccountId?: number | null
}

export function SmtpPanel({ embeddedAccountId }: SmtpPanelProps) {
  const {
    settingsAccountId: workspaceAccId,
    setSettingsAccountId: setAccId,
    accountsRevision,
    bumpAccountsRevision,
  } = useMailWorkspace()
  const embedded = embeddedAccountId != null
  const accId = embedded ? embeddedAccountId : workspaceAccId
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [smtpHost, setSmtpHost] = useState("")
  const [smtpPort, setSmtpPort] = useState("587")
  const [smtpTls, setSmtpTls] = useState(true)
  const [smtpUser, setSmtpUser] = useState("")
  const [smtpImapAuth, setSmtpImapAuth] = useState(true)
  const [smtpPass, setSmtpPass] = useState("")
  const [sentFolder, setSentFolder] = useState("Sent")
  const [syncSent, setSyncSent] = useState(false)
  const [syncArchive, setSyncArchive] = useState(false)
  const [syncSpam, setSyncSpam] = useState(false)
  const [archiveFolder, setArchiveFolder] = useState("")
  const [spamFolder, setSpamFolder] = useState("")
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)

  const load = useCallback(async () => {
    try {
      const list = await invokeRenderer(IPCChannels.Email.ListAccounts) as EmailAccount[]
      setAccounts(list)
    } catch (e) {
      // silent — handled centrally via AccountsPanel's toast on list failure
      console.error("[email] smtp-panel: load accounts", e)
    }
  }, [])

  // Re-run on mount AND whenever the account list is mutated elsewhere.
  useEffect(() => {
    void load()
  }, [load, accountsRevision])

  useEffect(() => {
    const a = accounts.find((x) => x.id === accId)
    if (a) {
      setSmtpHost(a.smtp_host || a.imap_host || "")
      setSmtpPort(String(a.smtp_port ?? 587))
      setSmtpTls((a.smtp_tls ?? 1) === 1)
      setSmtpUser(a.smtp_username || "")
      setSmtpImapAuth((a.smtp_use_imap_auth ?? 1) === 1)
      setSentFolder(a.sent_folder_path || "Sent")
      setSyncSent((a.imap_sync_sent ?? 0) === 1)
      setSyncArchive((a.imap_sync_archive ?? 0) === 1)
      setSyncSpam((a.imap_sync_spam ?? 0) === 1)
      setArchiveFolder(a.sync_archive_folder_path || "")
      setSpamFolder(a.sync_spam_folder_path || "")
    }
  }, [accId, accounts])

  const saveSmtp = async () => {
    if (accId == null) return
    setSaving(true)
    try {
      await invokeRenderer(IPCChannels.Email.UpdateAccount, {
        id: accId,
        smtpHost: smtpHost.trim() || null,
        smtpPort: parseInt(smtpPort, 10) || 587,
        smtpTls,
        smtpUsername: smtpUser.trim() || null,
        smtpUseImapAuth: smtpImapAuth,
        smtpPassword: smtpPass || undefined,
        sentFolderPath: sentFolder.trim() || null,
        syncSpamFolderPath: spamFolder.trim() || null,
        syncArchiveFolderPath: archiveFolder.trim() || null,
        imapSyncSent: syncSent,
        imapSyncArchive: syncArchive,
        imapSyncSpam: syncSpam,
      })
      toast.success("SMTP gespeichert.")
      setSmtpPass("")
      // Bump the shared revision so every consumer (inbox sidebar, OAuth
      // panel, accounts panel) sees the updated smtp_* columns.
      bumpAccountsRevision()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Fehler")
    } finally {
      setSaving(false)
    }
  }

  const testSmtp = async () => {
    const user = smtpImapAuth
      ? accounts.find((x) => x.id === accId)?.imap_username || ""
      : smtpUser
    if (!smtpPass && !smtpImapAuth && accId == null) {
      toast.error("Bitte SMTP-Passwort zum Testen eingeben oder Konto wählen.")
      return
    }
    setTesting(true)
    try {
      const r = await invokeRenderer(
        IPCChannels.Email.TestSmtp,
        {
          ...(accId != null ? { accountId: accId } : {}),
          host: smtpHost.trim(),
          port: parseInt(smtpPort, 10) || 587,
          secure: smtpTls && (parseInt(smtpPort, 10) || 587) === 465,
          user,
          password: smtpPass || undefined,
          smtpUseImapAuth: smtpImapAuth,
        },
      ) as { success: boolean; error?: string }
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

      {!embedded ? (
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
      ) : null}

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
          {(accounts.find((x) => x.id === accId)?.protocol || "imap") === "imap" ? (
            <div className="space-y-3 rounded-md border bg-muted/20 p-3">
              <p className="text-xs font-medium">IMAP-Ordner vom Server synchronisieren</p>
              <p className="text-xs text-muted-foreground">
                Zusätzlich zum Posteingang (INBOX). Leere Pfad-Felder = automatische Erkennung
                (\\Sent, \\Archive, \\Junk).
              </p>
              <div className="flex items-center gap-2">
                <Switch checked={syncSent} onCheckedChange={setSyncSent} id="sync-sent" />
                <Label htmlFor="sync-sent" className="font-normal text-sm">
                  Gesendet-Ordner lesen
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch checked={syncArchive} onCheckedChange={setSyncArchive} id="sync-arch" />
                <Label htmlFor="sync-arch" className="font-normal text-sm">
                  Archiv-Ordner lesen
                </Label>
              </div>
              {syncArchive ? (
                <Input
                  value={archiveFolder}
                  onChange={(e) => setArchiveFolder(e.target.value)}
                  placeholder="Archive (optional)"
                  className="h-9"
                />
              ) : null}
              <div className="flex items-center gap-2">
                <Switch checked={syncSpam} onCheckedChange={setSyncSpam} id="sync-spam" />
                <Label htmlFor="sync-spam" className="font-normal text-sm">
                  Spam/Junk-Ordner lesen
                </Label>
              </div>
              {syncSpam ? (
                <Input
                  value={spamFolder}
                  onChange={(e) => setSpamFolder(e.target.value)}
                  placeholder="Spam (optional)"
                  className="h-9"
                />
              ) : null}
            </div>
          ) : null}
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
