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

export default function LoginPage() {
  const navigate = useNavigate()
  const { login } = useAuth()
  const [username, setUsername] = useState("")
  const [passphrase, setPassphrase] = useState("")
  const [setupPass, setSetupPass] = useState("")
  const [setupPass2, setSetupPass2] = useState("")
  const [setupToken, setSetupToken] = useState("")
  const [setupUsername, setSetupUsername] = useState("")
  const [needsSetup, setNeedsSetup] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isFetchingSetupToken, setIsFetchingSetupToken] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
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
    if (!setupToken.trim()) {
      setError("Setup-Token erforderlich (Einmal-Passwort abrufen)")
      return
    }
    setIsLoading(true)
    setError(null)
    try {
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

  if (needsSetup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Ersteinrichtung</CardTitle>
            <CardDescription>
              Legen Sie Ihr lokales Administratorkonto an. Das Passwort brauchen Sie später zum Anmelden.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSetup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="setup-username">Benutzername</Label>
                <Input
                  id="setup-username"
                  autoComplete="username"
                  value={setupUsername}
                  onChange={(e) => setSetupUsername(e.target.value)}
                  required
                  maxLength={80}
                />
                <p className="text-xs text-muted-foreground">
                  Diesen Namen verwenden Sie später zusammen mit Ihrem Passwort zur Anmeldung.
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
            Melden Sie sich mit dem Benutzernamen und Passwort aus der Ersteinrichtung an.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Benutzername</Label>
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
