"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { getRendererTransport, invokeRenderer } from "@/services/transport"
import { hasLocalIpc, type EmailAccount } from "../types"

type Props = {
  onCreated: () => void
  editAccount?: EmailAccount | null
  onCancelEdit?: () => void
}

export function AccountForm({ onCreated, editAccount, onCancelEdit }: Props) {
  const serverClientMode = getRendererTransport().kind === "http"
  const vacationTestAvailable = serverClientMode || hasLocalIpc()
  const [protocol, setProtocol] = useState<"imap" | "pop3">("imap")
  const [displayName, setDisplayName] = useState("")
  const [emailAddress, setEmailAddress] = useState("")
  const [imapHost, setImapHost] = useState("")
  const [imapPort, setImapPort] = useState("993")
  const [imapTls, setImapTls] = useState(true)
  const [imapUsername, setImapUsername] = useState("")
  const [imapPassword, setImapPassword] = useState("")
  const [pop3Host, setPop3Host] = useState("")
  const [pop3Port, setPop3Port] = useState("995")
  const [pop3Tls, setPop3Tls] = useState(true)
  const [imapSyncSeenOnOpen, setImapSyncSeenOnOpen] = useState(true)
  const [vacationEnabled, setVacationEnabled] = useState(false)
  const [vacationSubject, setVacationSubject] = useState("")
  const [vacationBodyText, setVacationBodyText] = useState("")
  const [requestReadReceipt, setRequestReadReceipt] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testingPop3, setTestingPop3] = useState(false)
  const [testingVacation, setTestingVacation] = useState(false)
  const [saving, setSaving] = useState(false)
  const [testFeedback, setTestFeedback] = useState<string | null>(null)
  const isEdit = editAccount != null

  const editAccountId = editAccount?.id ?? null

  useEffect(() => {
    if (!editAccount) return
    setProtocol((editAccount.protocol as "imap" | "pop3") || "imap")
    setDisplayName(editAccount.display_name)
    setEmailAddress(editAccount.email_address)
    setImapHost(editAccount.imap_host)
    setImapPort(String(editAccount.imap_port))
    setImapTls(Boolean(editAccount.imap_tls))
    setImapUsername(editAccount.imap_username)
    setImapPassword("")
    setPop3Host(editAccount.pop3_host ?? "")
    setPop3Port(String(editAccount.pop3_port ?? 995))
    setPop3Tls(editAccount.pop3_tls == null ? true : Boolean(editAccount.pop3_tls))
    setImapSyncSeenOnOpen(editAccount.imap_sync_seen_on_open !== 0)
    setVacationEnabled((editAccount.vacation_enabled ?? 0) === 1)
    setVacationSubject(editAccount.vacation_subject ?? "")
    setVacationBodyText(editAccount.vacation_body_text ?? "")
    setRequestReadReceipt((editAccount.request_read_receipt ?? 0) === 1)
    // Re-init only when switching accounts (by id), not when the parent
    // passes a fresh list object after save with the same id.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- editAccount identity is editAccountId
  }, [editAccountId])

  const handleTestImap = async () => {
    if (!imapHost.trim() || !imapUsername.trim()) {
      const msg = "Bitte IMAP-Host und Benutzername ausfüllen."
      setTestFeedback(msg)
      toast.error(msg)
      return
    }
    if (!isEdit && !imapPassword) {
      const msg = "Bitte Passwort eingeben (neues Konto)."
      setTestFeedback(msg)
      toast.error(msg)
      return
    }
    setTesting(true)
    setTestFeedback("IMAP-Verbindung wird getestet …")
    const loadingId = toast.loading("IMAP-Verbindung wird getestet …")
    try {
      const result = await invokeRenderer(
        IPCChannels.Email.TestImap,
        {
          ...(isEdit && editAccount ? { accountId: editAccount.id } : {}),
          imapHost: imapHost.trim(),
          imapPort: parseInt(imapPort, 10) || 993,
          imapTls,
          imapUsername: imapUsername.trim(),
          imapPassword,
        },
      ) as { success: boolean; error?: string }
      if (result.success) {
        const msg = "IMAP-Verbindung erfolgreich."
        setTestFeedback(msg)
        toast.success(msg, { id: loadingId })
      } else {
        const msg = result.error ?? "Verbindung fehlgeschlagen."
        setTestFeedback(msg)
        toast.error(msg, { id: loadingId })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Verbindung fehlgeschlagen."
      setTestFeedback(msg)
      toast.error(msg, { id: loadingId })
    } finally {
      setTesting(false)
    }
  }

  const handleTestPop3 = async () => {
    const host = pop3Host.trim()
    if (!host || !imapUsername.trim()) {
      const msg = "Bitte POP3-Host und Benutzer ausfüllen."
      setTestFeedback(msg)
      toast.error(msg)
      return
    }
    if (!isEdit && !imapPassword) {
      const msg = "Bitte Passwort eingeben (neues Konto)."
      setTestFeedback(msg)
      toast.error(msg)
      return
    }
    setTestingPop3(true)
    setTestFeedback("POP3-Verbindung wird getestet …")
    const loadingId = toast.loading("POP3-Verbindung wird getestet …")
    try {
      const result = await invokeRenderer(
        IPCChannels.Email.TestPop3,
        {
          ...(isEdit && editAccount ? { accountId: editAccount.id } : {}),
          host,
          port: parseInt(pop3Port, 10) || 995,
          tls: pop3Tls,
          user: imapUsername.trim(),
          password: imapPassword,
        },
      ) as { success: boolean; error?: string }
      if (result.success) {
        const msg = "POP3-Verbindung erfolgreich."
        setTestFeedback(msg)
        toast.success(msg, { id: loadingId })
      } else {
        const msg = result.error ?? "POP3 fehlgeschlagen."
        setTestFeedback(msg)
        toast.error(msg, { id: loadingId })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "POP3 fehlgeschlagen."
      setTestFeedback(msg)
      toast.error(msg, { id: loadingId })
    } finally {
      setTestingPop3(false)
    }
  }

  const handleSaveAccount = async () => {
    if (
      !displayName.trim() ||
      !emailAddress.trim() ||
      !imapHost.trim() ||
      !imapUsername.trim() ||
      (!isEdit && !imapPassword)
    ) {
      toast.error(
        isEdit
          ? "Bitte Pflichtfelder ausfüllen. Passwort nur bei Änderung."
          : "Bitte alle Felder inkl. Passwort ausfüllen.",
      )
      return
    }
    setSaving(true)
    try {
      if (isEdit && editAccount) {
        await invokeRenderer(IPCChannels.Email.UpdateAccount, {
          id: editAccount.id,
          displayName: displayName.trim(),
          emailAddress: emailAddress.trim(),
          imapHost: imapHost.trim(),
          imapPort: parseInt(imapPort, 10) || 993,
          imapTls,
          imapUsername: imapUsername.trim(),
          ...(imapPassword ? { imapPassword } : {}),
          protocol,
          pop3Host: pop3Host.trim() || null,
          pop3Port: parseInt(pop3Port, 10) || 995,
          pop3Tls,
          imapSyncSeenOnOpen: protocol === "imap" ? imapSyncSeenOnOpen : false,
          vacationEnabled,
          vacationSubject: vacationSubject.trim() || null,
          vacationBodyText: vacationBodyText.trim() || null,
          requestReadReceipt,
        })
        toast.success("Konto aktualisiert.")
        setImapPassword("")
        onCreated()
        // Deliberately do NOT call onCancelEdit() here: that would clear the
        // master-detail's editAccount and blank the panel until the user
        // clicks the account again. After an update the user wants to stay on
        // the form with their values visible plus the success toast. The reset
        // is correct on create (the form re-mounts for the next new account).
      } else {
        const res = await invokeRenderer(IPCChannels.Email.CreateAccount, {
          displayName: displayName.trim(),
          emailAddress: emailAddress.trim(),
          imapHost: imapHost.trim(),
          imapPort: parseInt(imapPort, 10) || 993,
          imapTls,
          imapUsername: imapUsername.trim(),
          imapPassword,
          protocol,
          pop3Host: pop3Host.trim() || null,
          pop3Port: parseInt(pop3Port, 10) || 995,
          pop3Tls,
          imapSyncSeenOnOpen: protocol === "imap" ? imapSyncSeenOnOpen : false,
        }) as { id?: number }
        if (res.id != null) {
          toast.success("Konto gespeichert.")
          setImapPassword("")
          onCreated()
        }
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div>
        <h4 className="text-sm font-semibold">
          {isEdit ? "Konto bearbeiten" : "Neues Konto anlegen"}
        </h4>
        <p className="text-xs text-muted-foreground">
          IMAP oder POP3. Zugangsdaten werden{" "}
          {serverClientMode ? "verschlüsselt in der Serverdatenbank" : "im System-Schlüsselbund"} gespeichert.
          {isEdit ? " Passwort leer lassen, um es nicht zu ändern." : null}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Protokoll</Label>
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={protocol === "imap" ? "default" : "outline"}
            onClick={() => setProtocol("imap")}
          >
            IMAP
          </Button>
          <Button
            type="button"
            size="sm"
            variant={protocol === "pop3" ? "default" : "outline"}
            onClick={() => setProtocol("pop3")}
          >
            POP3
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="acc-display">Anzeigename</Label>
          <Input
            id="acc-display"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acc-addr">E-Mail-Adresse</Label>
          <Input
            id="acc-addr"
            type="email"
            value={emailAddress}
            onChange={(e) => setEmailAddress(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="acc-host">
          {protocol === "pop3" ? "Server (IMAP-Fallback)" : "IMAP-Server"}
        </Label>
        <Input
          id="acc-host"
          value={imapHost}
          onChange={(e) => setImapHost(e.target.value)}
        />
      </div>

      {protocol === "pop3" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="pop-host">POP3-Server</Label>
            <Input
              id="pop-host"
              value={pop3Host}
              onChange={(e) => setPop3Host(e.target.value)}
              placeholder="Leer = wie oben"
            />
          </div>
          <div className="flex gap-2">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="pop-port">POP3-Port</Label>
              <Input
                id="pop-port"
                value={pop3Port}
                onChange={(e) => setPop3Port(e.target.value)}
              />
            </div>
            <div className="flex items-end gap-2 pb-2">
              <Switch id="pop-tls" checked={pop3Tls} onCheckedChange={setPop3Tls} />
              <Label htmlFor="pop-tls" className="cursor-pointer text-sm font-normal">
                TLS
              </Label>
            </div>
          </div>
        </div>
      ) : null}

      <div className="flex gap-2">
        <div className="flex-1 space-y-1.5">
          <Label htmlFor="acc-port">Port</Label>
          <Input
            id="acc-port"
            value={imapPort}
            onChange={(e) => setImapPort(e.target.value)}
          />
        </div>
        <div className="flex items-end gap-2 pb-2">
          <Switch id="acc-tls" checked={imapTls} onCheckedChange={setImapTls} />
          <Label htmlFor="acc-tls" className="cursor-pointer text-sm font-normal">
            TLS
          </Label>
        </div>
      </div>

      {protocol === "imap" ? (
        <div className="flex items-start gap-3 rounded-md border bg-muted/30 px-3 py-2.5">
          <Switch
            id="acc-sync-seen"
            checked={imapSyncSeenOnOpen}
            onCheckedChange={setImapSyncSeenOnOpen}
          />
          <div className="space-y-0.5">
            <Label htmlFor="acc-sync-seen" className="cursor-pointer text-sm font-normal">
              Beim Öffnen als gelesen auf dem IMAP-Server markieren
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Beim Abruf liest SimpleCRM den Server-Status (gelesen/ungelesen). Beim
              Öffnen einer Mail hier können Sie optional auch den Server-Status setzen.
              POP3 unterstützt keinen Gelesen-Status auf dem Server.
            </p>
          </div>
        </div>
      ) : (
        <p className="text-[11px] text-muted-foreground">
          POP3 hat keinen Gelesen-Status auf dem Server; SimpleCRM zeigt den Status intern an.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="acc-user">Benutzername</Label>
          <Input
            id="acc-user"
            value={imapUsername}
            onChange={(e) => setImapUsername(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="acc-pass">Passwort</Label>
          <Input
            id="acc-pass"
            type="password"
            value={imapPassword}
            onChange={(e) => setImapPassword(e.target.value)}
            placeholder={isEdit ? "Leer = gespeichertes Passwort beim Test" : undefined}
          />
        </div>
      </div>

      {isEdit ? (
        <div className="space-y-3 rounded-md border bg-muted/20 p-3">
          <div className="flex items-start gap-3">
            <Switch
              id="acc-read-receipt"
              checked={requestReadReceipt}
              onCheckedChange={setRequestReadReceipt}
            />
            <div className="space-y-0.5">
              <Label htmlFor="acc-read-receipt" className="cursor-pointer text-sm font-normal">
                Lesebestätigung anfordern
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Fügt beim Senden den Header „Disposition-Notification-To“ hinzu (wenn der Empfänger
                unterstützt).
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Switch
              id="acc-vacation"
              checked={vacationEnabled}
              onCheckedChange={setVacationEnabled}
            />
            <div className="space-y-0.5">
              <Label htmlFor="acc-vacation" className="cursor-pointer text-sm font-normal">
                Abwesenheitsantwort (automatisch)
              </Label>
              <p className="text-[11px] text-muted-foreground">
                Sendet pro Absender höchstens einmal in 24 Stunden eine automatische Antwort
                auf eingehende Mails (keine Antworten an Mailer-Daemon oder Auto-Mails).
              </p>
            </div>
          </div>
          {vacationEnabled ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="acc-vacation-subject">Betreff</Label>
                <Input
                  id="acc-vacation-subject"
                  value={vacationSubject}
                  onChange={(e) => setVacationSubject(e.target.value)}
                  placeholder="Abwesenheit: Automatische Antwort"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="acc-vacation-body">Nachrichtentext</Label>
                <Textarea
                  id="acc-vacation-body"
                  rows={4}
                  value={vacationBodyText}
                  onChange={(e) => setVacationBodyText(e.target.value)}
                  placeholder="Vielen Dank für Ihre Nachricht. Ich bin derzeit nicht erreichbar …"
                />
              </div>
              {isEdit && editAccount ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={testingVacation || !vacationTestAvailable}
                  onClick={() => {
                    if (!vacationTestAvailable) return
                    void (async () => {
                      setTestingVacation(true)
                      try {
                        const r = await invokeRenderer(
                          IPCChannels.Email.TestVacationAutoReply,
                          editAccount.id,
                        ) as { success: boolean; error?: string }
                        if (r.success) {
                          toast.success(
                            `Testmail an ${editAccount.email_address} gesendet (siehe Aktivitätslog).`,
                          )
                        } else {
                          toast.error(r.error ?? "Test fehlgeschlagen")
                        }
                      } catch (e) {
                        toast.error(e instanceof Error ? e.message : String(e))
                      } finally {
                        setTestingVacation(false)
                      }
                    })()
                  }}
                >
                  {testingVacation ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : null}
                  Abwesenheit testen
                </Button>
              ) : null}
            </>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 pt-1">
        {protocol === "imap" ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void handleTestImap()}
            disabled={testing}
          >
            {testing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            IMAP testen
          </Button>
        ) : (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => void handleTestPop3()}
            disabled={testingPop3}
          >
            {testingPop3 ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            POP3 testen
          </Button>
        )}
        {testFeedback ? (
          <p
            className={`w-full text-sm ${
              testFeedback.includes("erfolgreich")
                ? "text-green-600 dark:text-green-400"
                : testFeedback.includes("wird getestet")
                  ? "text-muted-foreground"
                  : "text-destructive"
            }`}
            role="status"
          >
            {testFeedback}
          </p>
        ) : null}
        {isEdit && onCancelEdit ? (
          <Button type="button" size="sm" variant="ghost" onClick={onCancelEdit}>
            Abbrechen
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSaveAccount()}
          disabled={saving}
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {isEdit ? "Aktualisieren" : "Speichern"}
        </Button>
      </div>
    </div>
  )
}
