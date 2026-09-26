"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { invokeRenderer } from "@/services/transport"
import { useAuth } from "@/components/auth/auth-context"

type OAuthAppSettings = { clientId?: string; clientSecret?: string; hasSecret?: boolean }

/** Das Secret kommt nur bei Owner/Admin im Klartext; sonst zeigt hasSecret, dass eines gesetzt ist. */
const HIDDEN_SECRET_PLACEHOLDER = "Gesetzt (nur für Owner/Admin sichtbar)"

/** Globale OAuth-App-Registrierung (Client-ID/Secret) — einmal pro Provider. */
export function OAuthAppsPanel() {
  const { user } = useAuth()
  // Speichern verlangt Owner/Admin (Desktop-IPC und Server-Route).
  const canEdit = user?.role === "owner" || user?.role === "admin"
  const [googleClientId, setGoogleClientId] = useState("")
  const [googleClientSecret, setGoogleClientSecret] = useState("")
  const [googleHasSecret, setGoogleHasSecret] = useState(false)
  const [googleRedirect, setGoogleRedirect] = useState("http://127.0.0.1:1")
  const [msClientId, setMsClientId] = useState("")
  const [msClientSecret, setMsClientSecret] = useState("")
  const [msHasSecret, setMsHasSecret] = useState(false)
  const [msRedirect, setMsRedirect] = useState("http://127.0.0.1:1")

  const load = useCallback(async () => {
    const g = await invokeRenderer(
      IPCChannels.Email.GetGoogleOAuthApp,
    ) as OAuthAppSettings
    setGoogleClientId(g.clientId ?? "")
    setGoogleClientSecret(g.clientSecret ?? "")
    setGoogleHasSecret(g.hasSecret ?? Boolean(g.clientSecret))
    const m = await invokeRenderer(
      IPCChannels.Email.GetMicrosoftOAuthApp,
    ) as OAuthAppSettings
    setMsClientId(m.clientId ?? "")
    setMsClientSecret(m.clientSecret ?? "")
    setMsHasSecret(m.hasSecret ?? Boolean(m.clientSecret))
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">OAuth-Apps (Gmail &amp; Microsoft 365)</h3>
        <p className="text-sm text-muted-foreground">
          Registrieren Sie hier Ihre Anwendung im Google- bzw. Microsoft-Portal (Client-ID und
          Secret). Die Verknüpfung mit einem konkreten Postfach erfolgt unter{" "}
          <strong>Konten → OAuth</strong> pro Konto.
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Gmail und Microsoft 365 nutzen weiterhin <strong>IMAP/POP3</strong> für den Posteingang;
          OAuth ersetzt nicht den Posteingang, sondern Anmeldung und Versand. Reine
          OAuth-Postfächer ohne IMAP/POP3 werden derzeit nicht unterstützt.
        </p>
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Google (Gmail)</h4>
        <div className="space-y-1.5">
          <Label>Client-ID</Label>
          <Input
            value={googleClientId}
            disabled={!canEdit}
            onChange={(e) => setGoogleClientId(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Client-Secret</Label>
          <Input
            type="password"
            value={googleClientSecret}
            placeholder={googleHasSecret && !googleClientSecret ? HIDDEN_SECRET_PLACEHOLDER : undefined}
            disabled={!canEdit}
            onChange={(e) => setGoogleClientSecret(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canEdit}
          onClick={async () => {
            await invokeRenderer(IPCChannels.Email.SetGoogleOAuthApp, {
              clientId: googleClientId,
              clientSecret: googleClientSecret,
            })
            toast.success("Google-App-Daten gespeichert")
          }}
        >
          App-Daten speichern
        </Button>
        <div className="space-y-1.5">
          <Label>Redirect-URI (für Auth-URL)</Label>
          <Input value={googleRedirect} onChange={(e) => setGoogleRedirect(e.target.value)} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            const r = await invokeRenderer(
              IPCChannels.Email.BuildGoogleOAuthUrl,
              googleRedirect.trim(),
            ) as { success: boolean; url?: string; error?: string }
            if (r.success && r.url) {
              await navigator.clipboard.writeText(r.url)
              toast.success("Google-Autorisierungs-URL kopiert")
            } else toast.error(r.error ?? "URL fehlgeschlagen")
          }}
        >
          Google-Auth-URL kopieren
        </Button>
      </div>

      <Separator />

      <div className="space-y-3">
        <h4 className="text-sm font-semibold">Microsoft 365 / Outlook</h4>
        <div className="space-y-1.5">
          <Label>Application (Client) ID</Label>
          <Input
            value={msClientId}
            disabled={!canEdit}
            onChange={(e) => setMsClientId(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label>Client Secret</Label>
          <Input
            type="password"
            value={msClientSecret}
            placeholder={msHasSecret && !msClientSecret ? HIDDEN_SECRET_PLACEHOLDER : undefined}
            disabled={!canEdit}
            onChange={(e) => setMsClientSecret(e.target.value)}
          />
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!canEdit}
          onClick={async () => {
            await invokeRenderer(IPCChannels.Email.SetMicrosoftOAuthApp, {
              clientId: msClientId,
              clientSecret: msClientSecret,
            })
            toast.success("Microsoft-App-Daten gespeichert")
          }}
        >
          App-Daten speichern
        </Button>
        <div className="space-y-1.5">
          <Label>Redirect-URI (für Auth-URL)</Label>
          <Input value={msRedirect} onChange={(e) => setMsRedirect(e.target.value)} />
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={async () => {
            const r = await invokeRenderer(
              IPCChannels.Email.BuildMicrosoftOAuthUrl,
              msRedirect.trim(),
            ) as { success: boolean; url?: string; error?: string }
            if (r.success && r.url) {
              await navigator.clipboard.writeText(r.url)
              toast.success("Microsoft-Auth-URL kopiert")
            } else toast.error(r.error ?? "URL fehlgeschlagen")
          }}
        >
          Microsoft-Auth-URL kopieren
        </Button>
      </div>
    </div>
  )
}
