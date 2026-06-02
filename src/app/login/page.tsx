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
  const [needsSetup, setNeedsSetup] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!hasElectron()) return
    void (async () => {
      const res = await invokeIpc(IPCChannels.Auth.GetSetupState, undefined)
      if (res && typeof res === "object" && "needsInitialPassword" in res) {
        setNeedsSetup(Boolean((res as { needsInitialPassword: boolean }).needsInitialPassword))
      }
    })()
  }, [])

  async function handleSetup(e: React.FormEvent) {
    e.preventDefault()
    if (setupPass !== setupPass2) {
      setError("Passwörter stimmen nicht überein")
      return
    }
    setIsLoading(true)
    setError(null)
    const res = await invokeIpc(IPCChannels.Auth.SetInitialPassword, {
      passphrase: setupPass,
      setupToken: setupToken.trim() || undefined,
    })
    setIsLoading(false)
    if (res && typeof res === "object" && "success" in res && (res as { success: boolean }).success) {
      setNeedsSetup(false)
      setError(null)
      return
    }
    const err =
      res && typeof res === "object" && "error" in res
        ? String((res as { error?: string }).error)
        : "Einrichtung fehlgeschlagen"
    setError(err)
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setIsLoading(true)
    setError(null)
    const r = await login(username.trim(), passphrase)
    setIsLoading(false)
    if (!r.ok) {
      setError(r.error ?? "Anmeldung fehlgeschlagen")
      return
    }
    navigate({ to: "/" })
  }

  if (needsSetup) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Ersteinrichtung</CardTitle>
            <CardDescription>
              Legen Sie das Administrator-Passwort fest (min. 10 Zeichen). Optional: Setup-Token aus
              der Erstinstallation.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSetup} className="space-y-4">
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
                <Label htmlFor="setup-token">Setup-Token (optional)</Label>
                <Input
                  id="setup-token"
                  type="password"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                />
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
            Lokales Benutzerkonto für dieses SimpleCRM (Profil + Audit, kein Cloud-Login).
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
              <Label htmlFor="passphrase">Passphrase</Label>
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
