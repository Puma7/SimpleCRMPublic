"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, HelpCircle } from "lucide-react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  createServerAuthClient,
  getRendererTransport,
  invokeRenderer,
  RendererTransportError,
} from "@/services/transport"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

const MIN_PASSWORD_LENGTH = 10

type UserRow = {
  id: string
  username: string
  display_name: string
  role: string
  is_active: number
  login_pin_enabled?: boolean
  mfa_enabled?: boolean
  mfa_method?: "totp" | "email" | null
}

export function UsersPanel() {
  const [users, setUsers] = useState<UserRow[]>([])
  const [username, setUsername] = useState("")
  const [displayName, setDisplayName] = useState("")
  const [password, setPassword] = useState("")
  const [loginPin, setLoginPin] = useState("")
  const [inviteLink, setInviteLink] = useState("")
  const [inviteDelivery, setInviteDelivery] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const serverClientMode = getRendererTransport().kind === "http"

  const strength = useMemo(() => evaluatePassword(password), [password])

  const load = useCallback(async () => {
    const rows = await invokeRenderer(IPCChannels.Auth.ListUsers, undefined)
    if (Array.isArray(rows)) setUsers(rows as UserRow[])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const createUser = async () => {
    setError(null)
    const email = username.trim()
    if (!email) {
      setError("Benutzername / E-Mail ist erforderlich.")
      return
    }
    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`Das Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben.`)
      return
    }
    setBusy(true)
    try {
      await invokeRenderer(IPCChannels.Auth.SaveUser, {
        username: email,
        displayName: displayName.trim() || email,
        role: "agent",
        passphrase: password,
        ...(serverClientMode && loginPin.trim() ? { loginPin: loginPin.trim() } : {}),
      })
      setUsername("")
      setDisplayName("")
      setPassword("")
      setLoginPin("")
      await load()
    } catch (e) {
      setError(describeUserSaveError(e))
    } finally {
      setBusy(false)
    }
  }

  const createInvite = async () => {
    setError(null)
    if (!username.trim()) {
      setError("Benutzername / E-Mail ist erforderlich.")
      return
    }
    setBusy(true)
    try {
      const result = await invokeRenderer(IPCChannels.Auth.CreateInvite, {
        username: username.trim(),
        displayName: displayName.trim() || username.trim(),
        role: "agent",
        expiresInDays: 7,
      }) as { acceptPath?: string; token?: string; delivery?: unknown }
      const link = buildInviteLink(result.acceptPath, result.token)
      setInviteLink(link)
      setInviteDelivery(inviteDeliveryMessage(result.delivery))
      if (link && typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(link).catch(() => undefined)
      }
      setPassword("")
    } catch (e) {
      setError(describeUserSaveError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Benutzer</CardTitle>
        <CardDescription>
          Konten fuer Anmeldung, Rollen und Audit.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <ul className="space-y-2 text-sm">
          {users.map((u) => (
            <li key={u.id} className="space-y-2 border-b py-2">
              <div className="flex justify-between gap-2">
                <span>
                  {u.display_name} ({u.username}) — {u.role}
                </span>
                <span className="text-muted-foreground">{u.is_active ? "aktiv" : "inaktiv"}</span>
              </div>
              {serverClientMode ? (
                <UserSecurityActions user={u} disabled={busy} onChanged={() => void load()} />
              ) : null}
            </li>
          ))}
        </ul>
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label>Benutzername / E-Mail</Label>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" />
          </div>
          <div>
            <Label>Anzeigename</Label>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <div className="flex items-center gap-1.5">
              <Label htmlFor="new-user-password">Passwort</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Hilfe zum Passwort"
                    className="text-muted-foreground hover:text-foreground"
                  >
                    <HelpCircle className="h-4 w-4" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-72 text-sm" align="start">
                  <p className="font-medium">Passwort für die Anmeldung</p>
                  <p className="mt-1 text-muted-foreground">
                    Dieses Passwort nutzt der Benutzer, um sich anzumelden.
                  </p>
                  <p className="mt-2 font-medium">Mindestanforderung</p>
                  <ul className="mt-1 list-disc pl-4 text-muted-foreground">
                    <li>Mindestens {MIN_PASSWORD_LENGTH} Zeichen</li>
                    <li>Empfohlen: Groß-/Kleinbuchstaben, Ziffern und Sonderzeichen mischen</li>
                  </ul>
                </PopoverContent>
              </Popover>
            </div>
            <Input
              id="new-user-password"
              type="password"
              value={password}
              autoComplete="new-password"
              onChange={(e) => setPassword(e.target.value)}
            />
            <PasswordStrengthMeter password={password} strength={strength} />
          </div>
          {serverClientMode ? (
            <div className="sm:col-span-2">
              <Label htmlFor="new-user-login-pin">Login-PIN (optional)</Label>
              <Input
                id="new-user-login-pin"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={loginPin}
                onChange={(e) => setLoginPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="6 Ziffern"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Nur noetig, wenn in den Login-Sicherheitseinstellungen das PIN-Tastenfeld aktiviert ist.
              </p>
            </div>
          ) : null}
        </div>
        {error ? (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          type="button"
          disabled={busy || !username.trim() || password.length < MIN_PASSWORD_LENGTH}
          onClick={() => void createUser()}
        >
          Benutzer anlegen
        </Button>
        {serverClientMode ? (
          <div className="space-y-2">
            <Button type="button" variant="outline" disabled={busy || !username.trim()} onClick={() => void createInvite()}>
              Einladungslink erstellen
            </Button>
            {inviteLink ? (
              <div className="space-y-1">
                <Label htmlFor="auth-invite-link">Einladungslink</Label>
                <Input id="auth-invite-link" readOnly value={inviteLink} onFocus={(event) => event.currentTarget.select()} />
                {inviteDelivery ? (
                  <p className="text-sm text-muted-foreground">{inviteDelivery}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

type PasswordStrength = {
  score: 0 | 1 | 2 | 3 | 4
  meetsMinimum: boolean
}

function UserSecurityActions(props: {
  user: UserRow
  disabled?: boolean
  onChanged: () => void
}) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [totpOpen, setTotpOpen] = useState(false)
  const [totpSecret, setTotpSecret] = useState("")
  const [totpUri, setTotpUri] = useState("")
  const [totpCode, setTotpCode] = useState("")

  function getClient() {
    const transport = getRendererTransport()
    if (transport.kind !== "http" || !transport.serverBaseUrl) {
      throw new Error("Server-Modus ist nicht aktiv")
    }
    const session = createServerAuthClient({ baseUrl: transport.serverBaseUrl }).getSession()
    const accessToken = session?.tokens.accessToken
    if (!accessToken) throw new Error("Nicht angemeldet")
    return createServerAuthClient({ baseUrl: transport.serverBaseUrl })
  }

  async function beginTotp() {
    setError(null)
    setBusy(true)
    try {
      const client = getClient()
      const session = client.getSession()
      const setup = await client.beginUserTotpSetup(session!.tokens.accessToken, props.user.id)
      setTotpSecret(setup.secret)
      setTotpUri(setup.otpauthUri)
      setTotpCode("")
      setTotpOpen(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authenticator-Setup fehlgeschlagen")
    } finally {
      setBusy(false)
    }
  }

  async function confirmTotp() {
    setError(null)
    setBusy(true)
    try {
      const client = getClient()
      const session = client.getSession()
      await client.confirmUserTotpSetup(session!.tokens.accessToken, props.user.id, {
        secret: totpSecret,
        code: totpCode.trim(),
      })
      setTotpOpen(false)
      props.onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Authenticator konnte nicht aktiviert werden")
    } finally {
      setBusy(false)
    }
  }

  async function enableEmailMfa() {
    setError(null)
    setBusy(true)
    try {
      const client = getClient()
      const session = client.getSession()
      await client.enableUserEmailMfa(session!.tokens.accessToken, props.user.id)
      props.onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "E-Mail-2FA konnte nicht aktiviert werden")
    } finally {
      setBusy(false)
    }
  }

  async function disableMfa() {
    setError(null)
    setBusy(true)
    try {
      const client = getClient()
      const session = client.getSession()
      await client.disableUserMfa(session!.tokens.accessToken, props.user.id)
      props.onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : "2FA konnte nicht deaktiviert werden")
    } finally {
      setBusy(false)
    }
  }

  const securityBits = [
    props.user.login_pin_enabled ? "PIN" : null,
    props.user.mfa_enabled
      ? props.user.mfa_method === "email"
        ? "2FA E-Mail"
        : "2FA App"
      : null,
  ].filter(Boolean)

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Login-Sicherheit: {securityBits.length > 0 ? securityBits.join(", ") : "keine Zusatzfaktoren"}
      </p>
      <div className="flex flex-wrap gap-2">
        {!props.user.mfa_enabled ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={props.disabled || busy}
              onClick={() => void beginTotp()}
            >
              Authenticator einrichten
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={props.disabled || busy}
              onClick={() => void enableEmailMfa()}
            >
              E-Mail-2FA aktivieren
            </Button>
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={props.disabled || busy}
            onClick={() => void disableMfa()}
          >
            2FA deaktivieren
          </Button>
        )}
      </div>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <Dialog open={totpOpen} onOpenChange={setTotpOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Authenticator einrichten</DialogTitle>
            <DialogDescription>
              Secret in der Authenticator-App hinterlegen und den 6-stelligen Code bestaetigen.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 text-sm">
            <div>
              <Label htmlFor={`totp-secret-${props.user.id}`}>Secret</Label>
              <Input id={`totp-secret-${props.user.id}`} readOnly value={totpSecret} />
            </div>
            <div>
              <Label htmlFor={`totp-uri-${props.user.id}`}>otpauth-URI</Label>
              <Input id={`totp-uri-${props.user.id}`} readOnly value={totpUri} />
            </div>
            <div>
              <Label htmlFor={`totp-code-${props.user.id}`}>Bestaetigungscode</Label>
              <Input
                id={`totp-code-${props.user.id}`}
                inputMode="numeric"
                maxLength={6}
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setTotpOpen(false)}>
              Abbrechen
            </Button>
            <Button
              type="button"
              disabled={busy || totpCode.length !== 6}
              onClick={() => void confirmTotp()}
            >
              Aktivieren
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

const STRENGTH_LABELS = ["", "Schwach", "Okay", "Gut", "Stark"] as const
const STRENGTH_COLORS = ["", "bg-red-500", "bg-orange-500", "bg-yellow-500", "bg-green-500"] as const

function evaluatePassword(password: string): PasswordStrength {
  const length = password.length
  const meetsMinimum = length >= MIN_PASSWORD_LENGTH
  const variety = [/[a-z]/, /[A-Z]/, /[0-9]/, /[^a-zA-Z0-9]/].filter((re) => re.test(password)).length

  let score = 0
  if (length >= MIN_PASSWORD_LENGTH) score += 1
  if (length >= 14) score += 1
  if (variety >= 3) score += 1
  if (variety >= 4 || length >= 20) score += 1
  if (!meetsMinimum) score = Math.min(score, 1)

  return { score: Math.min(score, 4) as PasswordStrength["score"], meetsMinimum }
}

function PasswordStrengthMeter({ password, strength }: { password: string; strength: PasswordStrength }) {
  if (!password) return null
  return (
    <div className="mt-2 space-y-1">
      <div className="flex gap-1" aria-hidden="true">
        {[1, 2, 3, 4].map((segment) => (
          <div
            key={segment}
            className={cn(
              "h-1.5 flex-1 rounded-full transition-colors",
              segment <= strength.score ? STRENGTH_COLORS[strength.score] : "bg-muted",
            )}
          />
        ))}
      </div>
      <p className={cn("text-xs", strength.meetsMinimum ? "text-muted-foreground" : "text-destructive")}>
        {strength.meetsMinimum
          ? `Passwortqualität: ${STRENGTH_LABELS[strength.score]}`
          : `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen erforderlich`}
      </p>
    </div>
  )
}

function describeUserSaveError(e: unknown): string {
  if (e instanceof RendererTransportError) {
    const fieldMessages = extractFieldMessages(e.details)
    if (fieldMessages.length > 0) return fieldMessages.join(" ")
    if (e.code === "auth_user_duplicate_email") return "Diese E-Mail ist bereits vergeben."
    return e.message
  }
  return e instanceof Error ? e.message : "Benutzer konnte nicht angelegt werden."
}

function extractFieldMessages(details: unknown): string[] {
  if (!details || typeof details !== "object") return []
  const fields = (details as { fields?: unknown }).fields
  if (!Array.isArray(fields)) return []
  return fields
    .map((field) =>
      field && typeof field === "object" && typeof (field as { message?: unknown }).message === "string"
        ? (field as { message: string }).message
        : "",
    )
    .filter(Boolean)
}

function buildInviteLink(acceptPath: string | undefined, token: string | undefined): string {
  const path = acceptPath ?? (token ? `/login?invite=${encodeURIComponent(token)}` : "")
  if (!path) return ""
  if (typeof window === "undefined") return path
  try {
    return new URL(path, window.location.origin).toString()
  } catch {
    return path
  }
}

function inviteDeliveryMessage(delivery: unknown): string {
  if (!delivery || typeof delivery !== "object") {
    return ""
  }
  const status = "status" in delivery ? delivery.status : undefined
  if (status === "sent") {
    const recipient = "recipient" in delivery && typeof delivery.recipient === "string" ? delivery.recipient : ""
    return recipient ? `E-Mail an ${recipient} versendet.` : "Einladungs-E-Mail versendet."
  }
  if (status === "failed") {
    return "Einladung erstellt, E-Mail-Versand fehlgeschlagen."
  }
  if (status === "not_configured") {
    return "SMTP fuer Einladungen ist nicht konfiguriert; Link wurde kopiert."
  }
  return ""
}
