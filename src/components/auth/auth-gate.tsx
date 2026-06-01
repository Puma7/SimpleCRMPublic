"use client"

import { useEffect } from "react"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { useAuth } from "./auth-context"

export function AuthGate({ children }: { children: React.ReactNode }) {
  const { loading, authenticated, authRequired } = useAuth()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })

  useEffect(() => {
    if (loading) return
    if (authRequired && !authenticated && pathname !== "/login") {
      navigate({ to: "/login" })
    }
  }, [loading, authRequired, authenticated, pathname, navigate])

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Laden…
      </div>
    )
  }

  if (authRequired && !authenticated && pathname !== "/login") {
    return null
  }

  return <>{children}</>
}
