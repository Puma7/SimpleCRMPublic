"use client"

import { useMemo } from "react"
import { Link, useMatchRoute } from "@tanstack/react-router"
import { BarChart3, FlaskConical, Inbox, Settings, ShieldAlert, Workflow } from "lucide-react"
import { cn } from "@/lib/utils"
import { emailSettingsSearch } from "@/lib/email-settings-search"
import { isServerClientMode } from "@/lib/runtime-mode"
import { useAuth } from "@/components/auth/auth-context"

const SVELTE_LAB_ENABLED = import.meta.env.VITE_ENABLE_SVELTE_LAB === "true"

export function EmailSubNav() {
  const matchRoute = useMatchRoute()
  const { canViewSettings, canViewWorkflows, authRequired } = useAuth()
  // Personal account settings (password change) must stay reachable even without
  // settings.view — support templates intentionally omit that capability.
  const canOpenEmailSettings = canViewSettings || authRequired

  const items = useMemo(() => {
    const list = [
      { to: "/email" as const, label: "Postfach", icon: Inbox, exact: true as const },
      ...(canViewWorkflows
        ? [{ to: "/email/workflows" as const, label: "Workflows", icon: Workflow, exact: false as const }]
        : []),
      { to: "/email/reporting" as const, label: "Auswertung", icon: BarChart3, exact: false as const },
      // DMARC-Auswertung ist Server-Edition-only (kein Electron-IPC-Handler):
      // im Desktop-Modus ausblenden, damit der Aufruf nicht ins Leere läuft.
      ...(isServerClientMode()
        ? [{ to: "/email/dmarc" as const, label: "DMARC", icon: ShieldAlert, exact: false as const }]
        : []),
      ...(canOpenEmailSettings
        ? [{
            to: "/email/settings" as const,
            label: canViewSettings ? "Einstellungen" : "Konto",
            icon: Settings,
            exact: false as const,
            settingsTab: canViewSettings ? ("accounts" as const) : ("appUsers" as const),
          }]
        : []),
      ...(SVELTE_LAB_ENABLED
        ? [
            {
              to: "/email/svelte-lab" as const,
              label: "Svelte Lab",
              icon: FlaskConical,
              exact: false as const,
            },
          ]
        : []),
    ]
    return list
  }, [canOpenEmailSettings, canViewSettings, canViewWorkflows])

  return (
    <div className="border-b bg-muted/30">
      <nav className="flex h-11 items-stretch gap-0 px-2" aria-label="E-Mail-Bereiche">
        {items.map(({ to, label, icon: Icon, exact, settingsTab }) => {
          const active = exact
            ? !!matchRoute({ to: "/email", fuzzy: false })
            : !!matchRoute({ to, fuzzy: false })

          return (
            <Link
              key={to}
              to={to}
              search={to === "/email/settings" ? emailSettingsSearch({ tab: settingsTab ?? "accounts" }) : undefined}
              className={cn(
                "relative flex items-center gap-2 rounded-t-md px-4 text-sm font-medium transition-colors",
                active
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
              {active ? (
                <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary" />
              ) : null}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
