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

  const refresh = useCallback(async () => {
    if (!hasElectron()) {
      setAuthenticated(true)
      setAuthRequired(false)
      setUser({ id: "web", username: "web", displayName: "Web", role: "owner" })
      setLoading(false)
      return
    }
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
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const login = useCallback(async (username: string, passphrase: string) => {
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
    if (hasElectron()) {
      await invokeIpc(IPCChannels.Auth.Logout, undefined)
    }
    setAuthenticated(false)
    setUser(null)
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
