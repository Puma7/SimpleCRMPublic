"use client"

import { Link, useMatchRoute } from "@tanstack/react-router"
import { BarChart3, FlaskConical, Inbox, Settings, Workflow } from "lucide-react"
import { cn } from "@/lib/utils"
import { useMailWorkspace } from "./workspace-context"
import { EmailUiModeToggle } from "./beta/email-ui-mode-toggle"

const SVELTE_LAB_ENABLED = import.meta.env.VITE_ENABLE_SVELTE_LAB === "true"

const ITEMS = [
  { to: "/email" as const, label: "Postfach", icon: Inbox, exact: true },
  { to: "/email/workflows" as const, label: "Workflows", icon: Workflow, exact: false },
  { to: "/email/reporting" as const, label: "Auswertung", icon: BarChart3, exact: false },
  { to: "/email/settings" as const, label: "Einstellungen", icon: Settings, exact: false },
  ...(SVELTE_LAB_ENABLED
    ? [
        {
          to: "/email/svelte-lab" as const,
          label: "Svelte Lab",
          icon: FlaskConical,
          exact: false,
        },
      ]
    : []),
] as const

export function EmailSubNav() {
  const matchRoute = useMatchRoute()
  const { emailUiMode } = useMailWorkspace()
  const onSettings = !!matchRoute({ to: "/email/settings", fuzzy: false })

  return (
    <div
      className={cn(
        "border-b",
        emailUiMode === "beta" ? "border-primary/20 bg-primary/5" : "bg-muted/30",
      )}
    >
      <nav
        className="flex h-11 items-stretch gap-0 px-2"
        aria-label="E-Mail-Bereiche"
      >
        {ITEMS.map(({ to, label, icon: Icon, exact }) => {
          const active = exact
            ? !!matchRoute({ to: "/email", fuzzy: false })
            : !!matchRoute({ to, fuzzy: false })

          return (
            <Link
              key={to}
              to={to}
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
        <div className="ml-auto flex items-center gap-2 self-center pr-2">
          {emailUiMode === "beta" ? (
            <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
              Beta
            </span>
          ) : null}
          <EmailUiModeToggle />
        </div>
      </nav>
    </div>
  )
}
