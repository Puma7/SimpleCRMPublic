"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { hasElectron, invokeIpc, type EmailAccount } from "../types"
import { useMailWorkspace } from "../workspace-context"

export function OAuthPanel() {
  const { settingsAccountId: accId, setSettingsAccountId: setAccId } = useMailWorkspace()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [googleClientId, setGoogleClientId] = useState("")
  const [googleClientSecret, setGoogleClientSecret] = useState("")
  const [googleRedirect, setGoogleRedirect] = useState("http://127.0.0.1:1")
  const [googleCode, setGoogleCode] = useState("")
  const [msClientId, setMsClientId] = useState("")
  const [msClientSecret, setMsClientSecret] = useState("")
  const [msRedirect, setMsRedirect] = useState("http://127.0.0.1:1")
  const [msCode, setMsCode] = useState("")

  const load = useCallback(async () => {
    if (!hasElectron()) return
    setAccounts(await invokeIpc<EmailAccount[]>(IPCChannels.Email.ListAccounts))
    const g = await invokeIpc<{ clientId?: string; clientSecret?: string }>(
      IPCChannels.Email.GetGoogleOAuthApp,
    )
    setGoogleClientId(g.clientId ?? "")
    setGoogleClientSecret(g.clientSecret ?? "")
    const m = await invokeIpc<{ clientId?: string; clientSecret?: string }>(
      IPCChannels.Email.GetMicrosoftOAuthApp,
    )
    setMsClientId(m.clientId ?? "")
    setMsClientSecret(m.clientSecret ?? "")
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">OAuth (Gmail &amp; Microsoft 365)</h3>
        <p className="text-sm text-muted-foreground">
          Registrieren Sie Ihre App im jeweiligen Provider-Portal. Tragen Sie den Autorisierungscode unten ein,
          um ein Token für das aktive Konto zu speichern.
        </p>
      </div>

      <div className="space-y-1.5">
        <Label>Aktives Konto</Label>
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

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Google (Gmail IMAP/SMTP)</h4>
        <div className="space-y-1.5">
          <Label>Client-ID</Label>
          <Input
            value={googleClientId}
            onChange={(e) => setGoogleClientId(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Client-Secret</Label>
          <Input
            type="password"
            value={googleClientSecret}
            onChange={(e) => setGoogleClientSecret(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={async () => {
              await invokeIpc(IPCChannels.Email.SetGoogleOAuthApp, {
                clientId: googleClientId,
                clientSecret: googleClientSecret,
              })
              toast.success("Google-App-Daten gespeichert")
            }}
          >
            App-Daten speichern
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label>Redirect-URI</Label>
          <Input
            value={googleRedirect}
            onChange={(e) => setGoogleRedirect(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            const r = await invokeIpc<{ success: boolean; url?: string; error?: string }>(
              IPCChannels.Email.BuildGoogleOAuthUrl,
              googleRedirect.trim(),
            )
            if (r.success && r.url) {
              await navigator.clipboard.writeText(r.url)
              toast.success("Autorisierungs-URL kopiert")
            } else toast.error(r.error ?? "URL fehlgeschlagen")
          }}
        >
          Auth-URL kopieren
        </Button>
        <div className="space-y-1.5">
          <Label>Autorisierungscode</Label>
          <Input
            value={googleCode}
            onChange={(e) => setGoogleCode(e.target.value)}
            placeholder="4/…"
          />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            if (accId == null) {
              toast.error("Zuerst ein Konto oben wählen")
              return
            }
            const r = await invokeIpc<{ success: boolean; error?: string }>(
              IPCChannels.Email.FinishGoogleOAuth,
              {
                accountId: accId,
                redirectUri: googleRedirect.trim(),
                code: googleCode.trim(),
              },
            )
            if (r.success) {
              toast.success("Google-Token gespeichert")
              setGoogleCode("")
              await load()
            } else toast.error(r.error ?? "Fehler")
          }}
        >
          OAuth für Konto abschließen
        </Button>
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Microsoft 365 / Outlook</h4>
        <div className="space-y-1.5">
          <Label>Application (Client) ID</Label>
          <Input value={msClientId} onChange={(e) => setMsClientId(e.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label>Client Secret</Label>
          <Input
            type="password"
            value={msClientSecret}
            onChange={(e) => setMsClientSecret(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={async () => {
            await invokeIpc(IPCChannels.Email.SetMicrosoftOAuthApp, {
              clientId: msClientId,
              clientSecret: msClientSecret,
            })
            toast.success("Microsoft-App-Daten gespeichert")
          }}
        >
          App-Daten speichern
        </Button>
        <div className="space-y-1.5">
          <Label>Redirect-URI</Label>
          <Input value={msRedirect} onChange={(e) => setMsRedirect(e.target.value)} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            const r = await invokeIpc<{ success: boolean; url?: string; error?: string }>(
              IPCChannels.Email.BuildMicrosoftOAuthUrl,
              msRedirect.trim(),
            )
            if (r.success && r.url) {
              await navigator.clipboard.writeText(r.url)
              toast.success("Microsoft-Auth-URL kopiert")
            } else toast.error(r.error ?? "URL fehlgeschlagen")
          }}
        >
          Auth-URL kopieren
        </Button>
        <div className="space-y-1.5">
          <Label>Autorisierungscode</Label>
          <Input value={msCode} onChange={(e) => setMsCode(e.target.value)} />
        </div>
        <Button
          type="button"
          size="sm"
          onClick={async () => {
            if (accId == null) {
              toast.error("Zuerst ein Konto oben wählen")
              return
            }
            const r = await invokeIpc<{ success: boolean; error?: string }>(
              IPCChannels.Email.FinishMicrosoftOAuth,
              {
                accountId: accId,
                redirectUri: msRedirect.trim(),
                code: msCode.trim(),
              },
            )
            if (r.success) {
              toast.success("Microsoft-Token gespeichert")
              setMsCode("")
              await load()
            } else toast.error(r.error ?? "Fehler")
          }}
        >
          OAuth für Konto abschließen
        </Button>
      </div>
    </div>
  )
}
