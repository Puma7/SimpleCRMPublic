"use client"

import { useEffect, useState } from "react"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { useAuth } from "./auth-context"
import { IPCChannels } from "@shared/ipc/channels"
import { hasElectron, invokeIpc } from "@/components/email/types"

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, authenticated, authRequired } = useAuth()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [needsSetup, setNeedsSetup] = useState(false)

  useEffect(() => {
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
