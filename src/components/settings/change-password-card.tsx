"use client"

import { useState } from "react"
import { AlertCircle, CheckCircle2 } from "lucide-react"
import { IPCChannels } from "@shared/ipc/channels"
import { invokeRenderer, RendererTransportError } from "@/services/transport"
import { useAuth } from "@/components/auth/auth-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

const MIN_PASSWORD_LENGTH = 10

// Self-service password change for the currently signed-in user. Only shown
// when a real login session is active (authRequired) — the synthetic local
// bootstrap owner has no password to change here.
export function ChangePasswordCard() {
  const { authRequired, user } = useAuth()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  if (!authRequired || !user) return null

  const submit = async () => {
    setError(null)
    setDone(false)
    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`Das neue Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`)
      return
    }
    if (newPassword !== confirmPassword) {
      setError("Die Passwörter stimmen nicht überein.")
      return
    }
    if (newPassword === currentPassword) {
      setError("Das neue Passwort muss sich vom aktuellen unterscheiden.")
      return
    }
    setBusy(true)
    try {
      const result = (await invokeRenderer(IPCChannels.Auth.ChangePassword, {
        currentPassword,
        newPassword,
      })) as { success: boolean; error?: string } | undefined
      if (result && result.success === false) {
        setError(result.error || "Passwort konnte nicht geändert werden.")
        return
      }
      setDone(true)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch (e) {
      setError(describeError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Mein Passwort ändern</CardTitle>
        <CardDescription>
          Ändern Sie das Passwort für Ihren eigenen Zugang. Sie benötigen dazu Ihr aktuelles Passwort.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="own-current-password">Aktuelles Passwort</Label>
          <Input
            id="own-current-password"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="own-new-password">Neues Passwort</Label>
          <Input
            id="own-new-password"
            type="password"
            autoComplete="new-password"
            placeholder={`Mindestens ${MIN_PASSWORD_LENGTH} Zeichen`}
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="own-confirm-password">Neues Passwort bestätigen</Label>
          <Input
            id="own-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        {done ? (
          <Alert>
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>Passwort wurde geändert.</AlertDescription>
          </Alert>
        ) : null}
        <Button
          type="button"
          disabled={
            busy ||
            !currentPassword ||
            newPassword.length < MIN_PASSWORD_LENGTH ||
            !confirmPassword
          }
          onClick={() => void submit()}
        >
          Passwort ändern
        </Button>
      </CardContent>
    </Card>
  )
}

function describeError(e: unknown): string {
  if (e instanceof RendererTransportError) return e.message
  return e instanceof Error ? e.message : "Passwort konnte nicht geändert werden."
}
