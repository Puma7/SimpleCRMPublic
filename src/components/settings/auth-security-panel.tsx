"use client"

import { useCallback, useEffect, useState } from "react"
import { Shield } from "lucide-react"
import { AlertCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { useAuth } from "@/components/auth/auth-context"
import {
  createServerAuthClient,
  getRendererTransport,
  type ServerAuthSecuritySettings,
} from "@/services/transport"

export function AuthSecurityPanel() {
  const { user } = useAuth()
  const [settings, setSettings] = useState<ServerAuthSecuritySettings>({
    captchaEnabled: false,
    pinKeypadEnabled: false,
    mfaEnabled: false,
    mfaTotpEnabled: true,
    mfaEmailEnabled: false,
  })
  const [captchaProviderConfigured, setCaptchaProviderConfigured] = useState(false)
  const [currentUser, setCurrentUser] = useState({
    loginPinEnabled: false,
    mfaEnabled: false,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const load = useCallback(async () => {
    const transport = getRendererTransport()
    if (transport.kind !== "http" || !transport.serverBaseUrl) return
    const session = createServerAuthClient({ baseUrl: transport.serverBaseUrl }).getSession()
    const accessToken = session?.tokens.accessToken
    if (!accessToken) return
    const client = createServerAuthClient({ baseUrl: transport.serverBaseUrl })
    const response = await client.getSecuritySettings(accessToken)
    setSettings(response.settings)
    setCaptchaProviderConfigured(response.captchaProviderConfigured)
    setCurrentUser(response.currentUser)
  }, [])

  useEffect(() => {
    void load().catch((err) => {
      setError(err instanceof Error ? err.message : "Einstellungen konnten nicht geladen werden")
    })
  }, [load])

  async function save() {
    const transport = getRendererTransport()
    if (transport.kind !== "http" || !transport.serverBaseUrl) return
    const session = createServerAuthClient({ baseUrl: transport.serverBaseUrl }).getSession()
    const accessToken = session?.tokens.accessToken
    if (!accessToken) return
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const client = createServerAuthClient({ baseUrl: transport.serverBaseUrl })
      const response = await client.patchSecuritySettings(accessToken, settings)
      setSettings(response.settings)
      setCurrentUser(response.currentUser)
      setSaved(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen")
    } finally {
      setBusy(false)
    }
  }

  if (!user || (user.role !== "owner" && user.role !== "admin")) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Login-Sicherheit</CardTitle>
          <CardDescription>Nur Owner und Admins koennen diese Einstellungen bearbeiten.</CardDescription>
        </CardHeader>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shield className="h-5 w-5" />
          Login-Sicherheit
        </CardTitle>
        <CardDescription>
          Drei optionale Schutzstufen fuer die oeffentliche Anmeldung. PIN und Zweitfaktor gelten nur fuer Konten,
          bei denen Sie in der Benutzerverwaltung explizit hinterlegt wurden.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <SettingToggle
          id="captcha-enabled"
          label="CAPTCHA vor Login"
          description={
            captchaProviderConfigured
              ? "Neue Besucher muessen zuerst Cloudflare Turnstile bestehen."
              : "Aktivierung moeglich, sobald TURNSTILE_SITE_KEY und TURNSTILE_SECRET_KEY auf dem Server gesetzt sind."
          }
          checked={settings.captchaEnabled}
          disabled={!captchaProviderConfigured || busy}
          onCheckedChange={(checked) => setSettings((current) => ({ ...current, captchaEnabled: checked }))}
        />
        <SettingToggle
          id="pin-keypad-enabled"
          label="PIN-Tastenfeld statt Login-Button"
          description="Aktiviert das Tastenfeld fuer Konten mit hinterlegtem 6-stelligen Login-PIN. Konten ohne PIN melden sich weiter mit dem normalen Button an."
          checked={settings.pinKeypadEnabled}
          disabled={busy}
          onCheckedChange={(checked) => setSettings((current) => ({ ...current, pinKeypadEnabled: checked }))}
        />
        {settings.pinKeypadEnabled && !currentUser.loginPinEnabled ? (
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              Ihr eigenes Konto hat noch keinen Login-PIN. Sie koennen die Funktion aktivieren und sich weiter
              normal anmelden, sollten aber unter Benutzer einen PIN fuer Ihr Konto hinterlegen, wenn auch Admins
              den PIN-Schutz nutzen sollen.
            </AlertDescription>
          </Alert>
        ) : null}
        <SettingToggle
          id="mfa-enabled"
          label="Zweitfaktor-Authentifizierung"
          description="Erfordert einen zusaetzlichen Code nur fuer Konten, bei denen Authenticator oder E-Mail-2FA aktiviert wurde."
          checked={settings.mfaEnabled}
          disabled={busy}
          onCheckedChange={(checked) => setSettings((current) => ({ ...current, mfaEnabled: checked }))}
        />
        {settings.mfaEnabled ? (
          <div className="space-y-4 rounded-lg border p-4">
            <SettingToggle
              id="mfa-totp-enabled"
              label="Authenticator-App (TOTP)"
              description="Google Authenticator, Authy und aehnliche Apps."
              checked={settings.mfaTotpEnabled}
              disabled={busy}
              onCheckedChange={(checked) => setSettings((current) => ({ ...current, mfaTotpEnabled: checked }))}
            />
            <SettingToggle
              id="mfa-email-enabled"
              label="E-Mail-Code"
              description="Versendet einen 6-stelligen Code per Einladungs-SMTP des Servers."
              checked={settings.mfaEmailEnabled}
              disabled={busy}
              onCheckedChange={(checked) => setSettings((current) => ({ ...current, mfaEmailEnabled: checked }))}
            />
          </div>
        ) : null}
        {error ? <p className="text-sm text-destructive">{error}</p> : null}
        {saved ? <p className="text-sm text-muted-foreground">Gespeichert.</p> : null}
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? "Speichern …" : "Speichern"}
        </Button>
      </CardContent>
    </Card>
  )
}

function SettingToggle(props: {
  id: string
  label: string
  description: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label htmlFor={props.id}>{props.label}</Label>
        <p className="text-sm text-muted-foreground">{props.description}</p>
      </div>
      <Switch
        id={props.id}
        checked={props.checked}
        disabled={props.disabled}
        onCheckedChange={props.onCheckedChange}
      />
    </div>
  )
}
