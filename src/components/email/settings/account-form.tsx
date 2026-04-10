"use client"

import { useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { hasElectron, invokeIpc } from "../types"

type Props = {
  onCreated: () => void
}

export function AccountForm({ onCreated }: Props) {
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
  const [testing, setTesting] = useState(false)
  const [testingPop3, setTestingPop3] = useState(false)
  const [saving, setSaving] = useState(false)

  const handleTestImap = async () => {
    if (!hasElectron()) return
    setTesting(true)
    try {
      const result = await invokeIpc<{ success: boolean; error?: string }>(
        IPCChannels.Email.TestImap,
        {
          imapHost: imapHost.trim(),
          imapPort: parseInt(imapPort, 10) || 993,
          imapTls,
          imapUsername: imapUsername.trim(),
          imapPassword,
        },
      )
      if (result.success) toast.success("IMAP-Verbindung erfolgreich.")
      else toast.error(result.error ?? "Verbindung fehlgeschlagen.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Verbindung fehlgeschlagen.")
    } finally {
      setTesting(false)
    }
  }

  const handleTestPop3 = async () => {
    if (!hasElectron()) return
    const host = pop3Host.trim() || imapHost.trim()
    if (!host || !imapUsername.trim() || !imapPassword) {
      toast.error("POP3-Host, Benutzer und Passwort ausfüllen.")
      return
    }
    setTestingPop3(true)
    try {
      const result = await invokeIpc<{ success: boolean; error?: string }>(
        IPCChannels.Email.TestPop3,
        {
          host,
          port: parseInt(pop3Port, 10) || 995,
          tls: pop3Tls,
          user: imapUsername.trim(),
          password: imapPassword,
        },
      )
      if (result.success) toast.success("POP3-Verbindung erfolgreich.")
      else toast.error(result.error ?? "POP3 fehlgeschlagen.")
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "POP3 fehlgeschlagen.")
    } finally {
      setTestingPop3(false)
    }
  }

  const handleSaveAccount = async () => {
    if (!hasElectron()) return
    if (
      !displayName.trim() ||
      !emailAddress.trim() ||
      !imapHost.trim() ||
      !imapUsername.trim() ||
      !imapPassword
    ) {
      toast.error("Bitte alle Felder inkl. Passwort ausfüllen.")
      return
    }
    setSaving(true)
    try {
      const res = await invokeIpc<{ id?: number }>(IPCChannels.Email.CreateAccount, {
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
      })
      if (res.id != null) {
        toast.success("Konto gespeichert.")
        setImapPassword("")
        setDisplayName("")
        setEmailAddress("")
        setImapHost("")
        setImapUsername("")
        setPop3Host("")
        onCreated()
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
        <h4 className="text-sm font-semibold">Neues Konto anlegen</h4>
        <p className="text-xs text-muted-foreground">
          IMAP oder POP3. Zugangsdaten werden im System-Schlüsselbund gespeichert.
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
          />
        </div>
      </div>

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
        <Button
          type="button"
          size="sm"
          onClick={() => void handleSaveAccount()}
          disabled={saving}
        >
          {saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Speichern
        </Button>
      </div>
    </div>
  )
}
