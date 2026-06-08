"use client"

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { invokeIpc, hasElectron } from "@/components/email/types"
import {
  createServerAuthClient,
  getRendererTransport,
  ServerAuthClientError,
  type ServerAuthClient,
  type ServerAuthSession,
  type ServerAuthUser,
} from "@/services/transport"

export type AuthUser = {
  id: string
  username: string
  displayName: string
  role: string
}

type AuthState = {
  loading: boolean
  authenticated: boolean
  authRequired: boolean
  user: AuthUser | null
  login: (username: string, passphrase: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [serverSessionExpiresAt, setServerSessionExpiresAt] = useState<string | null>(null)

  const applyServerSession = useCallback((session: ServerAuthSession | null) => {
    if (session) {
      setAuthenticated(true)
      setAuthRequired(true)
      setUser(mapServerUser(session.user))
      setServerSessionExpiresAt(session.expiresAt)
    } else {
      setAuthenticated(false)
      setAuthRequired(true)
      setUser(null)
      setServerSessionExpiresAt(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    const transport = getRendererTransport()
    const serverAuth = getServerAuthClient(transport)
    if (transport.kind === "http") {
      if (!serverAuth) {
        applyServerSession(null)
        setLoading(false)
        return
      }
      try {
        const stored = serverAuth.getSession()
        const session = stored && !isExpiring(stored)
          ? stored
          : await serverAuth.refresh()
        applyServerSession(session)
      } catch {
        applyServerSession(null)
      } finally {
        setLoading(false)
      }
      return
    }

    if (!hasElectron()) {
      setAuthenticated(true)
      setAuthRequired(false)
      setUser({ id: "web", username: "web", displayName: "Web", role: "owner" })
      setLoading(false)
      return
    }
    setServerSessionExpiresAt(null)
    try {
      const res = await invokeIpc(IPCChannels.Auth.GetSession, undefined)
      if (res && typeof res === "object" && "authenticated" in res) {
        const r = res as {
          authenticated: boolean
          authRequired?: boolean
          user?: AuthUser
        }
        setAuthenticated(r.authenticated)
        setAuthRequired(r.authRequired ?? false)
        setUser(r.user ?? null)
      }
    } catch {
      setAuthenticated(false)
      setAuthRequired(true)
      setUser(null)
    } finally {
      setLoading(false)
    }
  }, [applyServerSession])

  useEffect(() => {
    void refresh()
  }, [applyServerSession, refresh])

  useEffect(() => {
    if (!authenticated || !serverSessionExpiresAt) return
    const serverAuth = getServerAuthClient()
    if (!serverAuth) return

    const timer = setTimeout(() => {
      void (async () => {
        try {
          applyServerSession(await serverAuth.refresh())
        } catch {
          applyServerSession(null)
        }
      })()
    }, refreshDelayMs(serverSessionExpiresAt))

    return () => clearTimeout(timer)
  }, [applyServerSession, authenticated, serverSessionExpiresAt])

  const login = useCallback(async (username: string, passphrase: string) => {
    const transport = getRendererTransport()
    const serverAuth = getServerAuthClient(transport)
    if (transport.kind === "http") {
      if (!serverAuth) {
        return { ok: false, error: "Server-URL fehlt. Anmeldung wurde nicht gestartet." }
      }
      try {
        const session = await serverAuth.login(username, passphrase)
        applyServerSession(session)
        return { ok: true }
      } catch (error) {
        return {
          ok: false,
          error: formatServerLoginError(error),
        }
      }
    }

    const res = await invokeIpc(IPCChannels.Auth.Login, { username, passphrase })
    if (res && typeof res === "object" && "success" in res && (res as { success: boolean }).success) {
      await refresh()
      return { ok: true }
    }
    const err =
      res && typeof res === "object" && "error" in res
        ? String((res as { error?: string }).error)
        : "Anmeldung fehlgeschlagen"
    return { ok: false, error: err }
  }, [refresh])

  const logout = useCallback(async () => {
    const transport = getRendererTransport()
    const serverAuth = getServerAuthClient(transport)
    if (transport.kind === "http") {
      if (serverAuth) {
        await serverAuth.logout()
      }
    } else if (hasElectron()) {
      await invokeIpc(IPCChannels.Auth.Logout, undefined)
    }
    setAuthenticated(false)
    setUser(null)
    setServerSessionExpiresAt(null)
  }, [])

  const value = useMemo(
    () => ({ loading, authenticated, authRequired, user, login, logout, refresh }),
    [loading, authenticated, authRequired, user, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error("useAuth outside AuthProvider")
  return ctx
}

function getServerAuthClient(transport = getRendererTransport()): ServerAuthClient | null {
  if (transport.kind !== "http" || !transport.serverBaseUrl) return null
  return createServerAuthClient({
    baseUrl: transport.serverBaseUrl,
    device: "simplecrm-renderer",
  })
}

function isExpiring(session: ServerAuthSession): boolean {
  return new Date(session.expiresAt).getTime() <= Date.now() + 30_000
}

function refreshDelayMs(expiresAt: string): number {
  const expiresAtMs = new Date(expiresAt).getTime()
  if (!Number.isFinite(expiresAtMs)) return 0
  return Math.max(0, expiresAtMs - Date.now() - 30_000)
}

function mapServerUser(user: ServerAuthUser): AuthUser {
  return {
    id: user.id,
    username: user.email,
    displayName: user.displayName,
    role: user.role,
  }
}

function formatServerLoginError(error: unknown): string {
  if (error instanceof ServerAuthClientError) {
    if (error.code === "invalid_credentials") {
      return "E-Mail oder Passwort ist falsch. Verwenden Sie dieselben Zugangsdaten wie bei der Ersteinrichtung."
    }
    if (error.code === "account_locked") {
      return "Konto voruebergehend gesperrt wegen zu vieler Fehlversuche."
    }
    if (error.code === "rate_limited") {
      return "Zu viele Fehlversuche. Bitte kurz warten und es erneut versuchen."
    }
    if (error.message) return error.message
  }
  if (error instanceof Error && error.message) return error.message
  return "Anmeldung fehlgeschlagen"
}
