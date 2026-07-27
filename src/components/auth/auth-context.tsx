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
import { expandUserGroupCapabilities } from "@shared/user-capabilities"
import {
  EMPTY_MAIL_PERMISSION_REPORT,
  hasMailPermission,
  hasMailPermissionForAccount,
  parseMailPermissionReport,
  type MailPermissionReport,
} from "@/components/auth/mail-permissions"
import { invokeIpc, hasElectron } from "@/components/email/types"
import {
  createServerAuthClient,
  getRendererTransport,
  invokeRenderer,
  isMailAclRefreshEvent,
  ServerAuthClientError,
  subscribeServerEvents,
  type ServerAuthClient,
  type ServerAuthSession,
  type ServerAuthUser,
} from "@/services/transport"

export type AuthUser = {
  id: string
  username: string
  displayName: string
  publicName?: string | null
  role: string
}

type AuthState = {
  loading: boolean
  authenticated: boolean
  authRequired: boolean
  user: AuthUser | null
  /** Owners/admins hold every capability; other roles gain group-granted ones. */
  hasCapability: (capability: string) => boolean
  /** Desktop always true; server edition requires crm.read (or admin/owner). */
  canReadCrm: boolean
  /** Desktop always true; server edition requires crm.write (or admin/owner). */
  canWriteCrm: boolean
  /** Desktop always true; server edition requires settings.view (or admin/owner). */
  canViewSettings: boolean
  /** Desktop always true; server edition requires settings.manage (or admin/owner). */
  canManageSettings: boolean
  /**
   * false, solange die Gruppenrechte der Server-Edition noch geladen werden.
   * Gates, die bei fehlendem Recht umleiten oder Inhalte ersetzen, muessen darauf
   * warten — sonst greifen sie im ersten Render faelschlich.
   */
  capabilitiesReady: boolean
  /** Desktop always true; server edition requires users.manage (or admin/owner). */
  canManageUsers: boolean
  /** Desktop always true; server edition requires workflows.view (or admin/owner). */
  canViewWorkflows: boolean
  /**
   * Haelt der Nutzer diese Mail-Berechtigung IRGENDWO? Die Mail-ACL ist von den
   * Capability-Stufen unabhaengig — `settings.manage` sagt nichts darueber, ob
   * jemand ein Postfach anlegen darf. Im Desktop und waehrend des Ladens true,
   * damit kein Gate im ersten Render faelschlich zuschlaegt.
   */
  hasMailPermission: (permission: string) => boolean
  /** Dieselbe Frage fuer ein konkretes Konto. */
  hasMailPermissionForAccount: (permission: string, accountId: number | string | null | undefined) => boolean
  /** false, solange der Mail-Rechte-Bericht der Server-Edition noch laedt. */
  mailPermissionsReady: boolean
  login: (username: string, passphrase: string) => Promise<{ ok: boolean; error?: string }>
  logout: () => Promise<void>
  refresh: (options?: { force?: boolean }) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)
  const [authRequired, setAuthRequired] = useState(false)
  const [user, setUser] = useState<AuthUser | null>(null)
  const [capabilities, setCapabilities] = useState<readonly string[]>([])
  // Fuer WELCHEN Nutzer die geladene Capability-Liste gilt. Bewusst kein
  // ready-Flag: das wurde im unauthentifizierten Zweig auf true gesetzt und war
  // beim ersten Login eines gewoehnlichen Server-Nutzers im Render VOR dem
  // Ladeeffekt noch true — Gates sahen "fertig geladen mit leerer Liste" und
  // leiteten z. B. die Einstellungsseite sofort auf den Konto-Tab um. An die
  // User-Id gebunden ist der Zustand beim Sitzungswechsel sofort korrekt.
  const [capabilitiesUserId, setCapabilitiesUserId] = useState<string | null>(null)
  // Die Mail-ACL ist ein von den Capabilities UNABHAENGIGES System. Ohne diesen
  // Bericht bietet die Oberflaeche Konto-, SMTP-, OAuth- und Signatur-Aktionen
  // an, die mail.account.manage verlangen und sonst garantiert im 403 enden.
  const [mailPermissions, setMailPermissions] = useState<MailPermissionReport>(
    EMPTY_MAIL_PERMISSION_REPORT,
  )
  const [mailPermissionsUserId, setMailPermissionsUserId] = useState<string | null>(null)
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

  const refresh = useCallback(async (options?: { force?: boolean }) => {
    const transport = getRendererTransport()
    const serverAuth = getServerAuthClient(transport)
    if (transport.kind === "http") {
      if (!serverAuth) {
        applyServerSession(null)
        setLoading(false)
        return
      }
      try {
        // force bypasses the cached session so callers that just changed
        // server-side user data (e.g. the signed-in user's public name) get a
        // fresh /auth/refresh instead of the stale cached publicName.
        const stored = serverAuth.getSession()
        const session = stored && !options?.force && !isExpiring(stored)
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

  // Load group-granted capabilities for non-admin users (server edition only).
  // Owners/admins hold all implicitly, so the fetch is skipped for them.
  // Also reload on email_acl.changed — group membership/permission updates publish
  // that event, and nav gates must reflect the new capability set without re-login.
  useEffect(() => {
    if (!authenticated || !user || getRendererTransport().kind !== "http") {
      setCapabilities([])
      setCapabilitiesUserId(null)
      setMailPermissions(EMPTY_MAIL_PERMISSION_REPORT)
      setMailPermissionsUserId(null)
      return
    }
    // Owner/Admin halten alle Rechte implizit — fuer sie entfaellt der Abruf,
    // NICHT aber das Event-Abo: email_acl.changed ist zugleich das Signal fuer
    // Herabstufung/Deaktivierung des eigenen Kontos.
    const adminRole = user.role === "owner" || user.role === "admin"
    if (adminRole) {
      setCapabilities([])
      setCapabilitiesUserId(null)
    }
    let cancelled = false
    let debounceTimer: ReturnType<typeof setTimeout> | null = null

    const loadCapabilities = async () => {
      try {
        const res = await invokeRenderer(IPCChannels.Auth.ListCapabilities, undefined) as
          { capabilities?: string[] } | null
        if (!cancelled && res && Array.isArray(res.capabilities)) setCapabilities(res.capabilities)
      } catch {
        if (!cancelled) setCapabilities([])
      } finally {
        if (!cancelled) setCapabilitiesUserId(user.id)
      }
    }

    // Auch fuer Owner/Admins abrufen: die Antwort meldet ihnen unrestricted und
    // spart jede Sonderbehandlung im Renderer.
    const loadMailPermissions = async () => {
      try {
        const res = await invokeRenderer(IPCChannels.Auth.ListMailPermissions, undefined)
        if (!cancelled) setMailPermissions(parseMailPermissionReport(res))
      } catch {
        // Fail closed: lieber ein Bedienelement zu wenig als eines, das 403 liefert.
        if (!cancelled) setMailPermissions(EMPTY_MAIL_PERMISSION_REPORT)
      } finally {
        if (!cancelled) setMailPermissionsUserId(user.id)
      }
    }

    if (!adminRole) {
      // Vor JEDEM Abruf zuruecksetzen — bei einem Nutzerwechsel gilt die alte
      // Liste nicht mehr.
      setCapabilitiesUserId(null)
      void loadCapabilities()
    }
    setMailPermissionsUserId(null)
    void loadMailPermissions()
    const subscription = subscribeServerEvents({
      onEvent: (event) => {
        if (!isMailAclRefreshEvent(event)) return
        // NUR selbstadressierte Ereignisse: Owner/Admins und konto-begrenzte
        // Delegationsmanager bekommen auch Peer-Invalidierungen zugestellt.
        // Auf jede davon die eigene Sitzung zu erneuern wuerde bei jedem
        // Zuweisungs- oder Filter-Fanout das Refresh-Token rotieren und einen
        // auth.refresh_rotated-Audit-Eintrag erzeugen. Fremde ACL-Ereignisse
        // gehen die fachlichen Refresh-Handler etwas an, nicht die Sitzung.
        const targetUserId = (event.payload as { targetUserId?: unknown } | undefined)?.targetUserId
        if (typeof targetUserId === "string" && targetUserId !== user.id) return
        if (debounceTimer) clearTimeout(debounceTimer)
        debounceTimer = setTimeout(() => {
          // Der Server veroeffentlicht ein selbstadressiertes email_acl.changed
          // auch bei Rollenwechsel, Deaktivierung und Loeschung (auth-routes).
          // Nur die Capability-Liste nachzuladen wuerde die alte Rolle stehen
          // lassen — ein herabgestufter Admin behielte bis zum naechsten
          // Token-Refresh alle Gates. Deshalb die Sitzung neu einlesen; schlaegt
          // das fehl, raeumt refresh() den Auth-State ab.
          void refresh({ force: true })
          if (!adminRole) {
            setCapabilitiesUserId(null)
            void loadCapabilities()
          }
          // Eine ACL-Aenderung ist genau das Signal, dass sich die eigenen
          // Mail-Rechte verschoben haben koennen.
          setMailPermissionsUserId(null)
          void loadMailPermissions()
        }, 250)
      },
    })
    return () => {
      cancelled = true
      if (debounceTimer) clearTimeout(debounceTimer)
      subscription.unsubscribe()
    }
  }, [authenticated, user, refresh])

  // Abgeleitet statt gespeichert: „fertig" heisst entweder „hier gibt es nichts
  // zu laden" (Desktop, abgemeldet, Owner/Admin) oder „die geladene Liste gehoert
  // zu GENAU diesem Nutzer".
  const capabilitiesReady = useMemo(() => {
    if (!authenticated || !user || getRendererTransport().kind !== "http") return true
    if (user.role === "owner" || user.role === "admin") return true
    return capabilitiesUserId === user.id
  }, [authenticated, user, capabilitiesUserId])

  // Genau wie serverseitig in requireCapability defensiv expandieren: die
  // gespeicherten Grants halten pro Modul nur die HOECHSTE Stufe
  // (normalizeStoredUserGroupPermissions), und `email_settings.manage` ist ein
  // akzeptiertes Legacy-Alias. Ein exakter String-Vergleich wuerde einem
  // crm.write-Inhaber crm.read absprechen — und seit die Navigation danach
  // gefiltert wird, waere das nicht mehr nur ein 403, sondern eine
  // verschwundene Oberflaeche. Der aktuelle Produktionspfad liefert die Liste
  // bereits expandiert; diese Zeile haelt den Client davon unabhaengig.
  const expandedCapabilities = useMemo(
    () => expandUserGroupCapabilities(capabilities),
    [capabilities],
  )

  const hasCapability = useCallback((capability: string): boolean => {
    if (!user) return false
    if (user.role === "owner" || user.role === "admin") return true
    return expandedCapabilities.includes(capability)
  }, [user, expandedCapabilities])

  const canReadCrm = useMemo(() => {
    // Capability model is server-edition only; desktop remains unrestricted.
    if (getRendererTransport().kind !== "http") return true
    return hasCapability("crm.read")
  }, [hasCapability, authenticated, user, expandedCapabilities])

  const canWriteCrm = useMemo(() => {
    // Capability model is server-edition only; desktop remains unrestricted.
    if (getRendererTransport().kind !== "http") return true
    return hasCapability("crm.write")
  }, [hasCapability, authenticated, user, expandedCapabilities])

  const canViewSettings = useMemo(() => {
    if (getRendererTransport().kind !== "http") return true
    return hasCapability("settings.view")
  }, [hasCapability, authenticated, user, expandedCapabilities])

  const canManageSettings = useMemo(() => {
    if (getRendererTransport().kind !== "http") return true
    return hasCapability("settings.manage")
  }, [hasCapability, authenticated, user, expandedCapabilities])

  const canManageUsers = useMemo(() => {
    if (getRendererTransport().kind !== "http") return true
    return hasCapability("users.manage")
  }, [hasCapability, authenticated, user, expandedCapabilities])

  const canViewWorkflows = useMemo(() => {
    if (getRendererTransport().kind !== "http") return true
    return hasCapability("workflows.view")
  }, [hasCapability, authenticated, user, expandedCapabilities])

  const mailPermissionsReady = useMemo(() => {
    if (!authenticated || !user || getRendererTransport().kind !== "http") return true
    return mailPermissionsUserId === user.id
  }, [authenticated, user, mailPermissionsUserId])

  const mailPermissionContext = useMemo(() => ({
    serverClientMode: getRendererTransport().kind === "http",
    ready: mailPermissionsReady,
    report: mailPermissions,
  }), [mailPermissionsReady, mailPermissions])

  const hasMailPermissionFn = useCallback(
    (permission: string) => hasMailPermission(mailPermissionContext, permission),
    [mailPermissionContext],
  )

  const hasMailPermissionForAccountFn = useCallback(
    (permission: string, accountId: number | string | null | undefined) =>
      hasMailPermissionForAccount(mailPermissionContext, permission, accountId),
    [mailPermissionContext],
  )

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
    setCapabilities([])
    setServerSessionExpiresAt(null)
  }, [])

  const value = useMemo(
    () => ({
      loading,
      authenticated,
      authRequired,
      user,
      hasCapability,
      canReadCrm,
      canWriteCrm,
      canViewSettings,
      canManageSettings,
      capabilitiesReady,
      canManageUsers,
      canViewWorkflows,
      hasMailPermission: hasMailPermissionFn,
      hasMailPermissionForAccount: hasMailPermissionForAccountFn,
      mailPermissionsReady,
      login,
      logout,
      refresh,
    }),
    [
      loading,
      authenticated,
      authRequired,
      user,
      hasCapability,
      canReadCrm,
      canWriteCrm,
      canViewSettings,
      canManageSettings,
      capabilitiesReady,
      canManageUsers,
      canViewWorkflows,
      hasMailPermissionFn,
      hasMailPermissionForAccountFn,
      mailPermissionsReady,
      login,
      logout,
      refresh,
    ],
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
    publicName: user.publicName ?? null,
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
