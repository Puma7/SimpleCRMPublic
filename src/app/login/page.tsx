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
import { createServerAuthClient, getRendererTransport, type ServerAuthClient, type ServerAuthInvitation } from "@/services/transport"

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
  const [isLoading, setIsLoading] = useState(false)
  const [isFetchingSetupToken, setIsFetchingSetupToken] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const httpTransportActive = getRendererTransport().kind === "http"
    const serverAuth = getActiveServerAuthClient()
    const pendingInviteToken = getInviteTokenFromLocation()
    if (pendingInviteToken) {
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
          setError(err instanceof Error ? err.message : "Einladung konnte nicht gelesen werden")
        }
      })()
      return
    }
    if (httpTransportActive && !serverAuth) {
      setServerSetupMode(true)
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
          setError(err instanceof Error ? err.message : "Setup-Status konnte nicht gelesen werden")
        }
      })()
      return
    }
    if (!hasElectron()) return
    void (async () => {
      const res = await invokeIpc(IPCChannels.Auth.GetSetupState, undefined)
      if (res && typeof res === "object" && "needsInitialPassword" in res) {
        setNeedsSetup(Boolean((res as { needsInitialPassword: boolean }).needsInitialPassword))
        if ("setupUsername" in res && typeof (res as { setupUsername?: unknown }).setupUsername === "string") {
          setSetupUsername((res as { setupUsername: string }).setupUsername)
          setUsername((res as { setupUsername: string }).setupUsername)
        }
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
      await refresh()
      navigate({ to: "/" })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Einladung konnte nicht angenommen werden")
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
      setError("Benutzername erforderlich")
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
        await serverAuth.createInitialOwner({
          email: normalizedSetupUsername,
          password: setupPass,
          displayName: normalizedSetupUsername,
        })
        await refresh()
        setNeedsSetup(false)
        setError(null)
        navigate({ to: "/" })
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
      setError(err instanceof Error ? err.message : "Einrichtung fehlgeschlagen")
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
    setIsLoading(true)
    setError(null)
    try {
      const r = await login(username.trim(), passphrase)
      if (!r.ok) {
        setError(r.error ?? "Anmeldung fehlgeschlagen")
        return
      }
      navigate({ to: "/" })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Anmeldung fehlgeschlagen")
    } finally {
      setIsLoading(false)
    }
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
                <Input id="invite-email" value={invite?.email ?? ""} readOnly />
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
                ? "Legen Sie den ersten Server-Owner an. Das Passwort brauchen Sie spaeter zum Anmelden."
                : "Legen Sie Ihr lokales Administratorkonto an. Das Passwort brauchen Sie spaeter zum Anmelden."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSetup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="setup-username">{serverSetupMode ? "E-Mail" : "Benutzername"}</Label>
                <Input
                  id="setup-username"
                  autoComplete="username"
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
                {isLoading ? "…" : "Passwort setzen"}
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
              ? "Melden Sie sich mit E-Mail und Passwort am SimpleCRM-Server an."
              : "Melden Sie sich mit dem Benutzernamen und Passwort aus der Ersteinrichtung an."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">{serverSetupMode ? "E-Mail" : "Benutzername"}</Label>
              <Input
                id="username"
                autoComplete="username"
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
