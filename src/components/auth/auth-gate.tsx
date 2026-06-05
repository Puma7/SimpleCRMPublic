"use client"

import { useEffect, useState } from "react"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { useAuth } from "./auth-context"
import { IPCChannels } from "@shared/ipc/channels"
import { hasElectron, invokeIpc } from "@/components/email/types"
import { createServerAuthClient, getRendererTransport } from "@/services/transport"

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, authenticated, authRequired } = useAuth()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [needsSetup, setNeedsSetup] = useState(false)

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
    if (needsSetup && pathname !== "/login") {
      navigate({ to: "/login" })
      return
    }
    if (authRequired && !authenticated && pathname !== "/login") {
      navigate({ to: "/login" })
    }
  }, [loading, authRequired, authenticated, pathname, navigate, needsSetup])

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
