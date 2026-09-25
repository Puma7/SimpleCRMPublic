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
import { isServerClientMode } from "@/lib/runtime-mode"
import { guessSmtpHostFromImapHost } from "@shared/mail-host-hints"
import { mailEndpointKey, type EmailAccount } from "../types"
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
  const [importingInbox, setImportingInbox] = useState(false)
  const [imapDeleteOptIn, setImapDeleteOptIn] = useState(false)
  const storedAccount = accounts.find((x) => x.id === accId)
  // The server and the desktop IPC refuse an SMTP endpoint change (host, port,
  // TLS) without the password SMTP logs in with, so the stored one never reaches
  // a different server. With "wie IMAP" that is the IMAP password. Switching
  // "wie IMAP" counts as such a change: it needs the password of the new login source.
  const credentialsRequired = storedAccount != null && smtpHost.trim() !== ""
    && (
      mailEndpointKey(smtpHost, parseInt(smtpPort, 10) || 587, smtpTls)
        !== mailEndpointKey(storedAccount.smtp_host ?? "", storedAccount.smtp_port ?? 587, (storedAccount.smtp_tls ?? 1) === 1)
      || smtpImapAuth !== ((storedAccount.smtp_use_imap_auth ?? 1) === 1)
    )
  const requiredPasswordLabel = smtpImapAuth ? "IMAP-Passwort" : "SMTP-Passwort"
  // Desktop: with "wie IMAP" the OAuth token would win over the IMAP password, so
  // the IPC drops the OAuth link when the change is saved with the IMAP password.
  const oauthLinkReplaced = credentialsRequired && smtpImapAuth && !isServerClientMode()
    && Boolean(storedAccount?.oauth_provider && storedAccount?.oauth_refresh_keytar_key)

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
      const stored = a.smtp_host?.trim() ?? ""
      setSmtpHost(stored || guessSmtpHostFromImapHost(a.imap_host) || "")
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
      setImapDeleteOptIn((a.imap_delete_opt_in ?? 0) === 1)
    }
  }, [accId, accounts])

  const saveSmtp = async () => {
    if (accId == null) return
    const host = smtpHost.trim()
    if (!host) {
      toast.error("Bitte SMTP-Host eintragen (z. B. smtp.ionos.de).")
      return
    }
    if (credentialsRequired && !smtpPass) {
      toast.error(`Zugangsdaten bei Serverwechsel neu eingeben: Bitte das ${requiredPasswordLabel} eingeben.`)
      return
    }
    setSaving(true)
    try {
      const res = await invokeRenderer(IPCChannels.Email.UpdateAccount, {
        id: accId,
        smtpHost: host,
        smtpPort: parseInt(smtpPort, 10) || 587,
        smtpTls,
        smtpUsername: smtpUser.trim() || null,
        smtpUseImapAuth: smtpImapAuth,
        ...(credentialsRequired && smtpImapAuth
          ? { imapPassword: smtpPass }
          : { smtpPassword: smtpPass || undefined }),
        sentFolderPath: sentFolder.trim() || null,
        syncSpamFolderPath: spamFolder.trim() || null,
        syncArchiveFolderPath: archiveFolder.trim() || null,
        imapSyncSent: syncSent,
        imapSyncArchive: syncArchive,
        imapSyncSpam: syncSpam,
        imapDeleteOptIn,
      }) as { success?: boolean; error?: string } | undefined
      // The desktop IPC answers a refused update with success: false instead of throwing.
      if (res?.success === false) {
        toast.error(res.error ?? "Fehler")
        return
      }
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
    const host = smtpHost.trim()
    if (!host) {
      toast.error("Bitte SMTP-Host eintragen (z. B. smtp.ionos.de).")
      return
    }
    const user = smtpImapAuth
      ? accounts.find((x) => x.id === accId)?.imap_username || ""
      : smtpUser
    if (!smtpPass && !smtpImapAuth && accId == null) {
      toast.error("Bitte SMTP-Passwort zum Testen eingeben oder Konto wählen.")
      return
    }
    // Server edition: without a new password the server deliberately tests the
    // STORED host/port/TLS and login (mail-connection-test.ts), not these form
    // values, so a success would not cover the changes.
    const loginChanged = storedAccount != null && (
      smtpImapAuth !== ((storedAccount.smtp_use_imap_auth ?? 1) === 1)
      || (!smtpImapAuth && smtpUser.trim() !== (storedAccount.smtp_username ?? "").trim())
    )
    if (isServerClientMode() && !smtpPass && (credentialsRequired || loginChanged)) {
      toast.error(
        `SMTP-Server, Port, TLS oder Anmeldung geändert: Ohne Passwort prüft der Server nur die gespeicherten Werte. Bitte das ${requiredPasswordLabel} eingeben, um die neuen Werte zu testen.`,
      )
      return
    }
    setTesting(true)
    try {
      const r = await invokeRenderer(
        IPCChannels.Email.TestSmtp,
        {
          ...(accId != null ? { accountId: accId } : {}),
          host,
          port: parseInt(smtpPort, 10) || 587,
          secure: smtpTls && (parseInt(smtpPort, 10) || 587) === 465,
          tls: smtpTls,
          user,
          password: smtpPass || undefined,
          smtpUseImapAuth: smtpImapAuth,
        },
      ) as { success: boolean; error?: string }
      if (r.success) toast.success("SMTP-Verbindung und Versand OK")
      else toast.error(r.error ?? "Fehler")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "SMTP-Test fehlgeschlagen.")
    } finally {
      setTesting(false)
    }
  }

  const importFullInbox = async () => {
    if (!accId) {
      toast.error("Bitte zuerst ein Konto auswählen.")
      return
    }
    setImportingInbox(true)
    try {
      await invokeRenderer(IPCChannels.Email.ImportFullInbox, accId)
      toast.success("Voll-Import gestartet. Ältere Nachrichten werden im Hintergrund nachgeladen.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import fehlgeschlagen.")
    } finally {
      setImportingInbox(false)
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
            <Input
              value={smtpHost}
              onChange={(e) => setSmtpHost(e.target.value)}
              placeholder="z. B. smtp.ionos.de"
            />
            <p className="text-xs text-muted-foreground">
              Separater SMTP-Server — nicht der IMAP-Host (z. B. smtp.ionos.de statt imap.ionos.de).
            </p>
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
            <Label htmlFor="smtp-pass">
              {credentialsRequired
                ? `${requiredPasswordLabel} (erforderlich, Server geändert)`
                : "SMTP-Passwort (leer = unverändert)"}
            </Label>
            <Input
              id="smtp-pass"
              type="password"
              value={smtpPass}
              onChange={(e) => setSmtpPass(e.target.value)}
              autoComplete="new-password"
              required={credentialsRequired}
              aria-invalid={credentialsRequired && !smtpPass ? true : undefined}
            />
            {credentialsRequired ? (
              <p className="text-xs text-muted-foreground">
                Server, Port, TLS oder Anmeldung geändert: Das gespeicherte Passwort wird nicht an
                einen anderen Server gesendet. Bitte erneut eingeben.
              </p>
            ) : null}
            {oauthLinkReplaced ? (
              <p className="text-xs text-muted-foreground">
                Beim Speichern wird die OAuth-Verknüpfung dieses Kontos durch dieses Passwort ersetzt.
              </p>
            ) : null}
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
              {isServerClientMode() ? (
              <div className="border-t pt-3">
                <p className="text-xs font-medium">Bereits gelesene Mails nachladen</p>
                <p className="mb-2 text-xs text-muted-foreground">
                  Holt ältere, bereits gelesene Nachrichten aus dem Posteingang nach, die beim ersten
                  Abruf übersprungen wurden (z. B. beim Wechsel von einem anderen System). Läuft im
                  Hintergrund und löst keine Workflows aus.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={importingInbox || !accId}
                  onClick={() => void importFullInbox()}
                >
                  {importingInbox ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Vollständigen Posteingang importieren
                </Button>
              </div>
              ) : null}
              <div className="flex items-center justify-between gap-4 border-t pt-3">
                <div className="space-y-1">
                  <Label htmlFor="imap-delete-account" className="text-xs font-medium">
                    IMAP-Löschung auf dem Server (dieses Konto)
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Erlaubt den Workflow-Knoten „Auf Server löschen" für Nachrichten dieses Postfachs.
                    Globaler Fallback unter Automatisierung bleibt möglich.
                  </p>
                </div>
                <Switch
                  id="imap-delete-account"
                  checked={imapDeleteOptIn}
                  onCheckedChange={setImapDeleteOptIn}
                />
              </div>
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
