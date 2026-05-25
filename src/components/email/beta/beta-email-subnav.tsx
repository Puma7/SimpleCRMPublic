"use client"

import { Link, useMatchRoute } from "@tanstack/react-router"
import { BarChart3, Inbox, Settings, Workflow } from "lucide-react"
import { cn } from "@/lib/utils"

const ITEMS = [
  { to: "/email" as const, label: "Postfach", icon: Inbox, exact: true },
  { to: "/email/workflows" as const, label: "Workflows", icon: Workflow },
  { to: "/email/reporting" as const, label: "Auswertung", icon: BarChart3 },
  { to: "/email/settings" as const, label: "Einstellungen", icon: Settings },
] as const

export function BetaEmailSubnav({ embedded }: { embedded?: boolean }) {
  const matchRoute = useMatchRoute()

  const nav = (
      <nav className="flex flex-wrap gap-1" aria-label="E-Mail-Bereiche">
        {ITEMS.map(({ to, label, icon: Icon, exact }) => {
          const active = exact
            ? !!matchRoute({ to: "/email", fuzzy: false })
            : !!matchRoute({ to, fuzzy: false })
          return (
            <Link
              key={to}
              to={to}
              search={
                to === "/email/settings"
                  ? { section: "mailboxes", tab: "accounts", intelligenceTab: "profiles" }
                  : undefined
              }
              className={cn(
                "inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          )
        })}
      </nav>
  )

  if (embedded) return nav

  return (
    <div className="flex shrink-0 flex-col border-b border-border/60 bg-card/30 px-3 py-2">
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        Kommunikation
      </p>
      {nav}
    </div>
  )
}
