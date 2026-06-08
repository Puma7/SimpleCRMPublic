"use client"

import { useEffect, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/components/auth/auth-context"
import { IPCChannels } from "@shared/ipc/channels"
import { hasElectron, invokeIpc } from "@/components/email/types"
import { isValidEmail } from "@/lib/contact-utils"
import {
  createServerAuthClient,
  getRendererTransport,
  ServerAuthClientError,
  type ServerAuthClient,
  type ServerAuthInvitation,
} from "@/services/transport"

const LAST_LOGIN_EMAIL_STORAGE_KEY = "simplecrm:last-login-email"

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, refresh } = useAuth()
  const [username, setUsername] = useState("")
  const [passphrase, setPassphrase] = useState("")
  const [setupPass, setSetupPass] = useState("")
  const [setupPass2, setSetupPass2] = useState("")
  const [setupToken, setSetupToken] = useState("")
  const [setupUsername, setSetupUsername] = useState("")
  const [inviteToken, setInviteToken] = useState("")
  const [invite, setInvite] = useState<ServerAuthInvitation | null>(null)
  const [invitePass, setInvitePass] = useState("")
  const [invitePass2, setInvitePass2] = useState("")
  const [needsSetup, setNeedsSetup] = useState(false)
  const [serverSetupMode, setServerSetupMode] = useState(false)
  const [setupStateResolved, setSetupStateResolved] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isFetchingSetupToken, setIsFetchingSetupToken] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const rememberedEmail = readRememberedLoginEmail()
    if (rememberedEmail) {
      setUsername(rememberedEmail)
    }

    const httpTransportActive = getRendererTransport().kind === "http"
    const serverAuth = getActiveServerAuthClient()
    const pendingInviteToken = getInviteTokenFromLocation()
    if (pendingInviteToken) {
      setSetupStateResolved(true)
      setInviteToken(pendingInviteToken)
      if (httpTransportActive) setServerSetupMode(true)
      if (!serverAuth) {
        setError("Einladungen koennen nur mit konfigurierter Server-URL angenommen werden")
        return
      }
      setServerSetupMode(true)
      void (async () => {
        try {
          const invitation = await serverAuth.getInvitation(pendingInviteToken)
          setInvite(invitation)
          setUsername(invitation.email)
        } catch (err) {
          setError(formatAuthError(err, true))
        }
      })()
      return
    }
    if (httpTransportActive && !serverAuth) {
      setServerSetupMode(true)
      setSetupStateResolved(true)
      setError("Server-URL fehlt. Anmeldung wurde nicht gestartet.")
      return
    }
    if (serverAuth) {
      setServerSetupMode(true)
      void (async () => {
        try {
          const res = await serverAuth.getSetupState()
          setNeedsSetup(res.needsInitialSetup)
        } catch (err) {
          setError(formatAuthError(err, true))
        } finally {
          setSetupStateResolved(true)
        }
      })()
      return
    }
    if (!hasElectron()) {
      setSetupStateResolved(true)
      return
    }
    void (async () => {
      try {
        const res = await invokeIpc(IPCChannels.Auth.GetSetupState, undefined)
        if (res && typeof res === "object" && "needsInitialPassword" in res) {
          setNeedsSetup(Boolean((res as { needsInitialPassword: boolean }).needsInitialPassword))
          if ("setupUsername" in res && typeof (res as { setupUsername?: unknown }).setupUsername === "string") {
            setSetupUsername((res as { setupUsername: string }).setupUsername)
            setUsername((res as { setupUsername: string }).setupUsername)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Setup-Status konnte nicht gelesen werden")
      } finally {
        setSetupStateResolved(true)
      }
    })()
  }, [])

  async function handleAcceptInvite(e: React.FormEvent) {
    e.preventDefault()
    if (invitePass !== invitePass2) {
      setError("Passwoerter stimmen nicht ueberein")
      return
    }
    const serverAuth = getActiveServerAuthClient()
    if (!serverAuth || !inviteToken) {
      setError("Einladung kann in diesem Client nicht angenommen werden")
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      await serverAuth.acceptInvitation(inviteToken, { password: invitePass })
      rememberLoginEmail(invite?.email ?? username)
      await refresh()
      navigate({ to: "/" })
    } catch (err) {
      setError(formatAuthError(err, true))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    if (setupPass !== setupPass2) {
      setError("Passwörter stimmen nicht überein")
      return
    }
    const normalizedSetupUsername = setupUsername.trim()
    if (!normalizedSetupUsername) {
      setError(serverSetupMode ? "E-Mail erforderlich" : "Benutzername erforderlich")
      return
    }
    if (serverSetupMode && !isValidEmail(normalizedSetupUsername)) {
      setError("Bitte geben Sie eine gueltige E-Mail-Adresse ein")
      return
    }
    if (!serverSetupMode && !setupToken.trim()) {
      setError("Setup-Token erforderlich (Einmal-Passwort abrufen)")
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const serverAuth = getActiveServerAuthClient()
      if (serverAuth) {
        const setupEmail = normalizedSetupUsername.toLowerCase()
        await serverAuth.createInitialOwner({
          email: setupEmail,
          password: setupPass,
          displayName: setupEmail,
        })
        rememberLoginEmail(setupEmail)
        const loginResult = await login(setupEmail, setupPass)
        if (loginResult.ok) {
          setNeedsSetup(false)
          setError(null)
          navigate({ to: "/" })
          return
        }
        await refresh()
        setNeedsSetup(false)
        setUsername(setupEmail)
        setError(loginResult.error ?? "Einrichtung abgeschlossen. Bitte mit E-Mail und Passwort anmelden.")
        return
      }
      const res = await invokeIpc(IPCChannels.Auth.SetInitialPassword, {
        passphrase: setupPass,
        setupToken: setupToken.trim(),
        username: normalizedSetupUsername,
      })
      if (res && typeof res === "object" && "success" in res && (res as { success: boolean }).success) {
        const loginResult = await login(normalizedSetupUsername, setupPass)
        if (loginResult.ok) {
          setNeedsSetup(false)
          setError(null)
          navigate({ to: "/" })
          return
        }
        setNeedsSetup(false)
        setUsername(normalizedSetupUsername)
        setError(loginResult.error ?? "Einrichtung abgeschlossen. Bitte mit Benutzername und Passwort anmelden.")
        return
      }
      const err =
        res && typeof res === "object" && "error" in res
          ? String((res as { error?: string }).error)
          : "Einrichtung fehlgeschlagen"
      setError(err)
    } catch (err) {
      setError(formatAuthError(err, serverSetupMode))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleFetchSetupToken() {
    setIsFetchingSetupToken(true)
    setError(null)
    try {
      const res = await invokeIpc(IPCChannels.Auth.GetOneTimeSetupPassword, undefined)
      if (res && typeof res === "object" && "success" in res && (res as { success: boolean }).success) {
        setSetupToken(String((res as { passphrase?: string }).passphrase ?? ""))
        return
      }
      const err =
        res && typeof res === "object" && "error" in res
          ? String((res as { error?: string }).error)
          : "Setup-Token konnte nicht abgerufen werden"
      setError(err)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup-Token konnte nicht abgerufen werden")
    } finally {
      setIsFetchingSetupToken(false)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const normalizedUsername = username.trim()
    if (serverSetupMode && normalizedUsername && !isValidEmail(normalizedUsername)) {
      setError("Bitte geben Sie eine gueltige E-Mail-Adresse ein")
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      const loginIdentity = serverSetupMode ? normalizedUsername.toLowerCase() : normalizedUsername
      const r = await login(loginIdentity, passphrase)
      if (!r.ok) {
        setError(r.error ?? "Anmeldung fehlgeschlagen")
        return
      }
      rememberLoginEmail(loginIdentity)
      navigate({ to: "/" })
    } catch (err) {
      setError(formatAuthError(err, serverSetupMode))
    } finally {
      setIsLoading(false)
    }
  }

  if (!setupStateResolved && !inviteToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>SimpleCRM</CardTitle>
            <CardDescription>Setup-Status wird geladen …</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Bitte einen Moment warten.</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (inviteToken) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Einladung annehmen</CardTitle>
            <CardDescription>
              Setzen Sie Ihr Passwort fuer {invite?.displayName ?? invite?.email ?? "dieses Konto"}.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleAcceptInvite} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="invite-email">E-Mail</Label>
                <Input id="invite-email" type="email" value={invite?.email ?? ""} readOnly />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-pass">Passwort</Label>
                <Input
                  id="invite-pass"
                  type="password"
                  autoComplete="new-password"
                  value={invitePass}
                  onChange={(e) => setInvitePass(e.target.value)}
                  required
                  minLength={10}
                  disabled={!invite}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-pass2">Passwort wiederholen</Label>
                <Input
                  id="invite-pass2"
                  type="password"
                  autoComplete="new-password"
                  value={invitePass2}
                  onChange={(e) => setInvitePass2(e.target.value)}
                  required
                  minLength={10}
                  disabled={!invite}
                />
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={isLoading || !invite}>
                {isLoading ? "..." : "Konto aktivieren"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (needsSetup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Ersteinrichtung</CardTitle>
            <CardDescription>
              {serverSetupMode
                ? "Legen Sie den ersten Server-Owner an. Merken Sie sich E-Mail und Passwort — beides brauchen Sie spaeter zum Anmelden."
                : "Legen Sie Ihr lokales Administratorkonto an. Das Passwort brauchen Sie spaeter zum Anmelden."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSetup} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="setup-username">{serverSetupMode ? "E-Mail" : "Benutzername"}</Label>
                <Input
                  id="setup-username"
                  type={serverSetupMode ? "email" : "text"}
                  autoComplete="username"
                  inputMode={serverSetupMode ? "email" : undefined}
                  value={setupUsername}
                  onChange={(e) => setSetupUsername(e.target.value)}
                  required
                  maxLength={80}
                />
                <p className="text-xs text-muted-foreground">
                  {serverSetupMode
                    ? "Diese E-Mail verwenden Sie spaeter zusammen mit Ihrem Passwort zur Anmeldung am Server."
                    : "Diesen Namen verwenden Sie spaeter zusammen mit Ihrem Passwort zur Anmeldung."}
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-pass">Neues Passwort</Label>
                <Input
                  id="setup-pass"
                  type="password"
                  autoComplete="new-password"
                  value={setupPass}
                  onChange={(e) => setSetupPass(e.target.value)}
                  required
                  minLength={10}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-pass2">Passwort wiederholen</Label>
                <Input
                  id="setup-pass2"
                  type="password"
                  autoComplete="new-password"
                  value={setupPass2}
                  onChange={(e) => setSetupPass2(e.target.value)}
                  required
                  minLength={10}
                />
              </div>
              {!serverSetupMode ? (
                <div className="space-y-2">
                  <Label htmlFor="setup-token">Setup-Token</Label>
                <Input
                  id="setup-token"
                  type="password"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={handleFetchSetupToken}
                  disabled={isFetchingSetupToken || isLoading}
                >
                  {isFetchingSetupToken ? "..." : "Einmal-Passwort abrufen"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Das Token bestätigt nur diese erste Einrichtung und wird über den Button lokal abgerufen.
                </p>
                </div>
              ) : null}
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "…" : serverSetupMode ? "Owner-Konto anlegen" : "Passwort setzen"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Anmelden</CardTitle>
          <CardDescription>
            {serverSetupMode
              ? "Melden Sie sich mit der E-Mail und dem Passwort aus der Ersteinrichtung an."
              : "Melden Sie sich mit dem Benutzernamen und Passwort aus der Ersteinrichtung an."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="space-y-2">
              <Label htmlFor="username">{serverSetupMode ? "E-Mail" : "Benutzername"}</Label>
              <Input
                id="username"
                type={serverSetupMode ? "email" : "text"}
                autoComplete="username"
                inputMode={serverSetupMode ? "email" : undefined}
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="passphrase">Passwort</Label>
              <Input
                id="passphrase"
                type="password"
                autoComplete="current-password"
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "…" : "Anmelden"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function getInviteTokenFromLocation(): string {
  if (typeof window === "undefined") return ""
  return new URLSearchParams(window.location.search).get("invite")?.trim() ?? ""
}

function getActiveServerAuthClient(): ServerAuthClient | null {
  const transport = getRendererTransport()
  if (transport.kind !== "http" || !transport.serverBaseUrl) return null
  return createServerAuthClient({
    baseUrl: transport.serverBaseUrl,
    device: "simplecrm-renderer",
  })
}

function readRememberedLoginEmail(): string {
  if (typeof window === "undefined") return ""
  try {
    return window.localStorage.getItem(LAST_LOGIN_EMAIL_STORAGE_KEY)?.trim() ?? ""
  } catch {
    return ""
  }
}

function rememberLoginEmail(email: string): void {
  const normalized = email.trim()
  if (!normalized || typeof window === "undefined") return
  try {
    window.localStorage.setItem(LAST_LOGIN_EMAIL_STORAGE_KEY, normalized)
  } catch {
    // ignore storage failures (private mode, quota, etc.)
  }
}

function formatAuthError(err: unknown, serverMode: boolean): string {
  if (err instanceof ServerAuthClientError) {
    if (err.code === "invalid_credentials") {
      return serverMode
        ? "E-Mail oder Passwort ist falsch. Verwenden Sie dieselben Zugangsdaten wie bei der Ersteinrichtung."
        : "Benutzername oder Passwort ist falsch."
    }
    if (err.code === "already_configured") {
      return "Die Ersteinrichtung wurde bereits abgeschlossen. Bitte melden Sie sich an."
    }
    if (err.code === "account_locked") {
      return "Konto voruebergehend gesperrt wegen zu vieler Fehlversuche."
    }
    if (err.code === "rate_limited") {
      return "Zu viele Fehlversuche. Bitte kurz warten und es erneut versuchen."
    }
    if (err.code === "validation_error") {
      const fieldMessage = readValidationFieldMessage(err.details, serverMode ? "email" : "username")
      if (fieldMessage) return fieldMessage
    }
    if (err.message) return err.message
  }
  if (err instanceof Error && err.message) return err.message
  return "Anfrage fehlgeschlagen"
}

function readValidationFieldMessage(details: unknown, field: string): string | null {
  if (!details || typeof details !== "object" || !("fields" in details)) return null
  const fields = (details as { fields?: unknown }).fields
  if (!Array.isArray(fields)) return null
  for (const entry of fields) {
    if (!entry || typeof entry !== "object") continue
    const record = entry as { field?: unknown; message?: unknown }
    if (record.field !== field || typeof record.message !== "string") continue
    if (field === "email") return "Bitte geben Sie eine gueltige E-Mail-Adresse ein."
    return record.message
  }
  return null
}
