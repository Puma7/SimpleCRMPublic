"use client"

import { useEffect, useState } from "react"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { useAuth } from "./auth-context"
import { IPCChannels } from "@shared/ipc/channels"
import { hasElectron, invokeIpc } from "@/components/email/types"
import { createServerAuthClient, getRendererTransport } from "@/services/transport"

/**
 * Paths the auth gate must let through unauthenticated. The customer portal
 * (Phase 5/6 of the returns suite) is the only such surface today; the portal
 * token in the URL is the credential the server uses to resolve a workspace.
 */
function isPublicPath(pathname: string): boolean {
  return pathname.startsWith("/portal/")
}

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, authenticated, authRequired } = useAuth()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [needsSetup, setNeedsSetup] = useState(false)
  const isPublic = isPublicPath(pathname)

  useEffect(() => {
    const transport = getRendererTransport()
    if (transport.kind === "http") {
      if (!transport.serverBaseUrl) {
        setNeedsSetup(false)
        return
      }
      let cancelled = false
      const authClient = createServerAuthClient({
        baseUrl: transport.serverBaseUrl,
        device: "simplecrm-renderer",
      })
      void (async () => {
        try {
          const res = await authClient.getSetupState()
          if (!cancelled) setNeedsSetup(res.needsInitialSetup)
        } catch {
          if (!cancelled) setNeedsSetup(false)
        }
      })()
      return () => {
        cancelled = true
      }
    }
    if (!hasElectron()) return
    void (async () => {
      const res = await invokeIpc(IPCChannels.Auth.GetSetupState, undefined)
      if (res && typeof res === "object" && "needsInitialPassword" in res) {
        setNeedsSetup(Boolean((res as { needsInitialPassword: boolean }).needsInitialPassword))
      }
    })()
  }, [])

  useEffect(() => {
    if (loading) return
    if (isPublic) return
    if (needsSetup && pathname !== "/login") {
      navigate({ to: "/login" })
      return
    }
    if (authRequired && !authenticated && pathname !== "/login") {
      navigate({ to: "/login" })
    }
  }, [loading, authRequired, authenticated, pathname, navigate, needsSetup, isPublic])

  // Public paths bypass the loading spinner so customers don't see a blank
  // screen while we resolve a session they don't have.
  if (isPublic) {
    return <>{children}</>
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Laden…
      </div>
    )
  }

  if ((needsSetup || (authRequired && !authenticated)) && pathname !== "/login") {
    return null
  }

  return <>{children}</>
}
