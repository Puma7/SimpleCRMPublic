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
  clearCaptchaChallenge,
  LoginCaptchaGate,
  readCaptchaChallenge,
  storeCaptchaChallenge,
} from "@/components/auth/login-captcha-gate"
import { LoginMfaStep } from "@/components/auth/login-mfa-step"
import { LoginPinKeypad } from "@/components/auth/login-pin-keypad"
import {
  createServerAuthClient,
  getRendererTransport,
  ServerAuthClientError,
  type ServerAuthClient,
  type ServerAuthInvitation,
  type ServerLoginConfig,
} from "@/services/transport"
import {
  getPasswordTooShortMessage,
  isPasswordLengthValid,
  MIN_PASSWORD_LENGTH,
} from "@shared/auth-password-policy"
import type { AuthMfaMethod } from "@shared/auth-login-security"

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
  const [loginConfig, setLoginConfig] = useState<ServerLoginConfig | null>(null)
  const [loginConfigResolved, setLoginConfigResolved] = useState(false)
  const [captchaPassed, setCaptchaPassed] = useState(false)
  const [loginPin, setLoginPin] = useState("")
  const [loginPinRequired, setLoginPinRequired] = useState(false)
  const [mfaChallengeToken, setMfaChallengeToken] = useState<string | null>(null)
  const [mfaMethod, setMfaMethod] = useState<AuthMfaMethod | null>(null)

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

  useEffect(() => {
    setLoginPin("")
    setLoginPinRequired(false)
  }, [username])

  useEffect(() => {
    if (needsSetup || inviteToken) {
      setLoginConfigResolved(true)
      return
    }
    const serverAuth = getActiveServerAuthClient()
    if (!serverAuth) {
      setLoginConfigResolved(true)
      return
    }
    let cancelled = false
    setLoginConfigResolved(false)
    void (async () => {
      try {
        const config = await serverAuth.getLoginConfig()
        if (cancelled) return
        setLoginConfig(config)
        const storedChallenge = readCaptchaChallenge()
        setCaptchaPassed(!config.captcha.enabled || Boolean(storedChallenge))
      } catch {
        if (!cancelled) {
          setLoginConfig({
            captcha: { enabled: false, provider: null, siteKey: null },
            pinKeypad: { enabled: false },
            mfa: { enabled: false, methods: [] },
            user: null,
          })
          setCaptchaPassed(true)
        }
      } finally {
        if (!cancelled) setLoginConfigResolved(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [needsSetup, inviteToken])

  async function handleCaptchaVerify(token: string) {
    const serverAuth = getActiveServerAuthClient()
    if (!serverAuth) return
    setIsLoading(true)
    setError(null)
    try {
      const challenge = await serverAuth.verifyCaptcha(token)
      storeCaptchaChallenge(challenge)
      setCaptchaPassed(true)
    } catch (err) {
      setError(formatAuthError(err, serverSetupMode))
    } finally {
      setIsLoading(false)
    }
  }

  async function performServerLogin(pinValue?: string) {
    const serverAuth = getActiveServerAuthClient()
    if (!serverAuth) {
      setError("Server-URL fehlt. Anmeldung wurde nicht gestartet.")
      return
    }
    const normalizedUsername = username.trim()
    const loginIdentity = serverSetupMode ? normalizedUsername.toLowerCase() : normalizedUsername
    const captchaChallenge = readCaptchaChallenge()
    let result
    try {
      result = await serverAuth.loginAdvanced({
        email: loginIdentity,
        password: passphrase,
        pin: pinValue,
        captchaChallenge: captchaChallenge || undefined,
      })
    } finally {
      if (captchaChallenge) {
        clearCaptchaChallenge()
        setCaptchaPassed(false)
      }
    }
    if (result.kind === "mfa_required") {
      setLoginPinRequired(false)
      setMfaChallengeToken(result.mfaChallengeToken)
      setMfaMethod(result.mfaMethod)
      setLoginPin("")
      return
    }
    if (result.kind === "pin_required") {
      if (result.captchaChallenge) {
        storeCaptchaChallenge(result.captchaChallenge)
        setCaptchaPassed(true)
      }
      setLoginPinRequired(true)
      setLoginPin("")
      return
    }
    setLoginPinRequired(false)
    await refresh()
    rememberLoginEmail(loginIdentity)
    navigate({ to: "/" })
  }

  async function handleMfaSubmit(code: string) {
    const serverAuth = getActiveServerAuthClient()
    if (!serverAuth || !mfaChallengeToken) return
    setIsLoading(true)
    setError(null)
    try {
      await serverAuth.verifyMfa({ mfaChallengeToken, code })
      const loginIdentity = serverSetupMode ? username.trim().toLowerCase() : username.trim()
      rememberLoginEmail(loginIdentity)
      setMfaChallengeToken(null)
      setMfaMethod(null)
      await refresh()
      navigate({ to: "/" })
    } catch (err) {
      setError(formatAuthError(err, serverSetupMode))
    } finally {
      setIsLoading(false)
    }
  }

  async function handleAcceptInvite(e: React.FormEvent) {
    e.preventDefault()
    if (invitePass !== invitePass2) {
      setError("Passwoerter stimmen nicht ueberein")
      return
    }
    if (!isPasswordLengthValid(invitePass)) {
      setError(getPasswordTooShortMessage())
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
    if (!isPasswordLengthValid(setupPass)) {
      setError(getPasswordTooShortMessage())
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
    if (!setupToken.trim()) {
      setError(serverSetupMode
        ? "Initial-Setup-Token erforderlich (steht in INITIAL_SETUP_TOKEN auf dem Server)"
        : "Setup-Token erforderlich (Einmal-Passwort abrufen)")
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
          setupToken: setupToken.trim(),
        })
        rememberLoginEmail(setupEmail)
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
    if (loginPinRequired) {
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      if (serverSetupMode && getActiveServerAuthClient()) {
        await performServerLogin()
        return
      }
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

  const invitePasswordReady = Boolean(
    invite
    && isPasswordLengthValid(invitePass)
    && invitePass === invitePass2,
  )
  const setupPasswordReady = isPasswordLengthValid(setupPass) && setupPass === setupPass2
  const setupUsernameReady = setupUsername.trim().length > 0
  const setupTokenReady = serverSetupMode || setupToken.trim().length > 0
  const setupFormReady = setupUsernameReady && setupPasswordReady && setupTokenReady

  async function handlePinComplete(pinValue: string) {
    const normalizedUsername = username.trim()
    if (serverSetupMode && normalizedUsername && !isValidEmail(normalizedUsername)) {
      setError("Bitte geben Sie eine gueltige E-Mail-Adresse ein")
      return
    }
    setIsLoading(true)
    setError(null)
    try {
      await performServerLogin(pinValue)
    } catch (err) {
      setError(formatAuthError(err, serverSetupMode))
      setLoginPin("")
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
            <form onSubmit={handleAcceptInvite} className="space-y-4" noValidate>
              <div className="space-y-2">
                <Label htmlFor="invite-email">E-Mail</Label>
                <Input id="invite-email" type="email" value={invite?.email ?? ""} readOnly />
              </div>
              <div className="space-y-2">
                <Label htmlFor="invite-pass">Neues Passwort</Label>
                <Input
                  id="invite-pass"
                  type="password"
                  autoComplete="new-password"
                  value={invitePass}
                  onChange={(e) => setInvitePass(e.target.value)}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
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
                  minLength={MIN_PASSWORD_LENGTH}
                  disabled={!invite}
                />
                <p className="text-xs text-muted-foreground">
                  Mindestens {MIN_PASSWORD_LENGTH} Zeichen. Beide Felder muessen uebereinstimmen.
                </p>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={isLoading || !invitePasswordReady}>
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
                  minLength={MIN_PASSWORD_LENGTH}
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
                  minLength={MIN_PASSWORD_LENGTH}
                />
                <p className="text-xs text-muted-foreground">
                  Mindestens {MIN_PASSWORD_LENGTH} Zeichen. Beide Felder muessen uebereinstimmen.
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup-token">
                  {serverSetupMode ? "Initial-Setup-Token" : "Setup-Token"}
                </Label>
                <Input
                  id="setup-token"
                  type="password"
                  value={setupToken}
                  onChange={(e) => setSetupToken(e.target.value)}
                  autoComplete="off"
                />
                {serverSetupMode ? (
                  <p className="text-xs text-muted-foreground">
                    Wert aus der Server-Umgebungsvariable INITIAL_SETUP_TOKEN. Ohne dieses Token kann kein Owner-Konto angelegt werden.
                  </p>
                ) : (
                  <>
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
                      Das Token bestaetigt nur diese erste Einrichtung und wird ueber den Button lokal abgerufen.
                    </p>
                  </>
                )}
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
              <Button type="submit" className="w-full" disabled={isLoading || !setupFormReady}>
                {isLoading ? "…" : serverSetupMode ? "Owner-Konto anlegen" : "Passwort setzen"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!loginConfigResolved) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Anmelden</CardTitle>
            <CardDescription>Sicherheitseinstellungen werden geladen …</CardDescription>
          </CardHeader>
        </Card>
      </div>
    )
  }

  if (mfaChallengeToken && mfaMethod) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <LoginMfaStep
          method={mfaMethod}
          busy={isLoading}
          error={error}
          onSubmit={handleMfaSubmit}
          onCancel={() => {
            setMfaChallengeToken(null)
            setMfaMethod(null)
            setLoginPin("")
            setError(null)
          }}
        />
      </div>
    )
  }

  if (loginConfig?.captcha.enabled && !captchaPassed) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <LoginCaptchaGate
          config={loginConfig}
          busy={isLoading}
          error={error}
          onVerify={handleCaptchaVerify}
        />
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
                onChange={(e) => {
                  setPassphrase(e.target.value)
                  setLoginPin("")
                  setLoginPinRequired(false)
                }}
                required
              />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {loginPinRequired ? (
              <LoginPinKeypad
                value={loginPin}
                onChange={setLoginPin}
                onComplete={(pinValue) => {
                  void handlePinComplete(pinValue)
                }}
                disabled={isLoading || !username.trim() || !passphrase}
              />
            ) : (
              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? "…" : "Anmelden"}
              </Button>
            )}
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
    if (err.code === "captcha_required" || err.code === "captcha_failed") {
      return "CAPTCHA-Bestaetigung erforderlich. Bitte erneut bestaetigen."
    }
    if (err.code === "mfa_code_invalid" || err.code === "mfa_challenge_invalid") {
      return "Sicherheitscode ist ungueltig oder abgelaufen."
    }
    if (err.code === "validation_error") {
      const passwordMessage = readValidationFieldMessage(err.details, "password")
      if (passwordMessage) return passwordMessage
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
    if (field === "password") {
      if (record.message.includes("mindestens")) return getPasswordTooShortMessage()
      return record.message
    }
    return record.message
  }
  return null
}
