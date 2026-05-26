"use client"

import type { ReactNode } from "react"
import { Link, useRouterState } from "@tanstack/react-router"
import {
  BarChart3,
  CalendarDays,
  CheckSquare,
  FileBox,
  LayoutDashboard,
  ListChecks,
  Mail,
  Package,
  Settings,
  Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useThemeTokens } from "@/components/theme/theme-tokens-provider"
import { emailSettingsSearch } from "@/lib/email-settings-search"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

const WORKSPACE = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/followup", label: "Nachverfolgung", icon: ListChecks, status: "warning" as const },
  { to: "/customers", label: "Kunden", icon: Users, badge: "1.2k" },
  { to: "/deals", label: "Deals", icon: FileBox, badge: "23" },
  { to: "/tasks", label: "Aufgaben", icon: CheckSquare },
] as const

const COMMS = [
  { to: "/email", label: "E-Mail", icon: Mail, badge: "7", exact: true },
  { to: "/calendar", label: "Kalender", icon: CalendarDays },
] as const

const CATALOG = [{ to: "/products", label: "Produkte", icon: Package }] as const

function NavItem({
  to,
  label,
  icon: Icon,
  exact,
  badge,
  status,
  rail,
}: {
  to: string
  label: string
  icon: typeof Mail
  exact?: boolean
  badge?: string
  status?: "warning"
  rail?: boolean
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = exact ? pathname === to : pathname.startsWith(to)

  const link = (
    <Link
      to={to}
      className={cn(
        "flex items-center rounded-lg transition-colors",
        rail ? "justify-center px-2 py-2.5" : "gap-2.5 px-2.5 py-2 text-sm",
        active
          ? cn("bg-sidebar-accent font-medium text-sidebar-accent-foreground beta-nav-active")
          : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
      title={rail ? label : undefined}
    >
      <span className="relative shrink-0">
        <Icon className={cn("h-4 w-4", active && "text-primary")} />
        {status === "warning" ? (
          <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-500 ring-2 ring-sidebar" />
        ) : null}
      </span>
      {!rail ? <span className="flex-1 truncate">{label}</span> : null}
      {!rail && badge ? (
        <span className="rounded-md bg-muted px-1.5 py-0.5 font-label-mono text-[10px] tabular-nums text-muted-foreground">
          {badge}
        </span>
      ) : null}
    </Link>
  )

  if (rail) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{label}</TooltipContent>
      </Tooltip>
    )
  }
  return link
}

function Section({
  title,
  children,
  rail,
}: {
  title: string
  children: ReactNode
  rail?: boolean
}) {
  if (rail) return <div className="space-y-1">{children}</div>
  return (
    <div className="space-y-1">
      <p className="px-2.5 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      {children}
    </div>
  )
}

export function BetaSidebar() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { tokens } = useThemeTokens()
  const rail = tokens.sidebarMode === "rail"
  const settingsActive =
    pathname.startsWith("/settings") || pathname.includes("/email/settings")

  return (
    <TooltipProvider delayDuration={200}>
      <aside
        className={cn(
          "flex h-full shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-[width]",
          rail ? "w-[56px]" : "w-[220px]",
        )}
      >
        <div
          className={cn(
            "flex h-12 shrink-0 items-center border-b border-sidebar-border",
            rail ? "justify-center px-2" : "gap-2 px-4",
          )}
        >
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground crm-glow-button">
            S
          </div>
          {!rail ? (
            <div className="min-w-0 leading-tight">
              <p className="truncate text-sm font-semibold text-foreground">SimpleCRM</p>
              <p className="text-[10px] text-muted-foreground">v0.2 Beta</p>
            </div>
          ) : null}
        </div>
        <ScrollArea className="flex-1 py-3">
          <nav className={cn("space-y-5", rail ? "px-1" : "px-2")}>
            <Section title="Arbeitsfläche" rail={rail}>
              {WORKSPACE.map((item) => (
                <NavItem key={item.to} {...item} rail={rail} />
              ))}
            </Section>
            <Section title="Kommunikation" rail={rail}>
              {COMMS.map((item) => (
                <NavItem key={item.to} {...item} rail={rail} />
              ))}
            </Section>
            <Section title="Katalog" rail={rail}>
              {CATALOG.map((item) => (
                <NavItem key={item.to} {...item} rail={rail} />
              ))}
            </Section>
          </nav>
        </ScrollArea>
        <div className="shrink-0 border-t border-sidebar-border p-2">
          <Link
            to="/email/settings"
            search={emailSettingsSearch({ section: "mailboxes" })}
            className={cn(
              "flex items-center rounded-lg font-medium transition-colors",
              rail ? "justify-center p-2.5" : "gap-2.5 px-2.5 py-2.5 text-sm",
              settingsActive
                ? "bg-primary text-primary-foreground beta-nav-active crm-glow-button"
                : "text-sidebar-foreground hover:bg-sidebar-accent",
            )}
            title={rail ? "Einstellungen" : undefined}
          >
            <Settings className="h-4 w-4 shrink-0" />
            {!rail ? "Einstellungen" : null}
          </Link>
        </div>
      </aside>
    </TooltipProvider>
  )
}
