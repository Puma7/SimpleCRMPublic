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

const WORKSPACE = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { to: "/followup", label: "Nachverfolgung", icon: ListChecks },
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
}: {
  to: string
  label: string
  icon: typeof Mail
  exact?: boolean
  badge?: string
}) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const active = exact ? pathname === to : pathname.startsWith(to)

  return (
    <Link
      to={to}
      className={cn(
        "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
          : "text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground",
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active && "text-primary")} />
      <span className="flex-1 truncate">{label}</span>
      {badge ? (
        <span className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] tabular-nums text-muted-foreground">
          {badge}
        </span>
      ) : null}
    </Link>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
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
  const settingsActive = pathname.startsWith("/settings") || pathname.includes("/email/settings")

  return (
    <aside className="flex h-full w-[220px] shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-sidebar-border px-4">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
          S
        </div>
        <div className="min-w-0 leading-tight">
          <p className="truncate text-sm font-semibold text-foreground">SimpleCRM</p>
          <p className="text-[10px] text-muted-foreground">v0.2 Beta</p>
        </div>
      </div>
      <ScrollArea className="flex-1 py-3">
        <nav className="space-y-5 px-2">
          <Section title="Arbeitsfläche">
            {WORKSPACE.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </Section>
          <Section title="Kommunikation">
            {COMMS.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </Section>
          <Section title="Katalog">
            {CATALOG.map((item) => (
              <NavItem key={item.to} {...item} />
            ))}
          </Section>
        </nav>
      </ScrollArea>
      <div className="shrink-0 border-t border-sidebar-border p-2">
        <Link
          to="/email/settings"
          search={{ section: "overview", tab: "accounts", intelligenceTab: "profiles" }}
          className={cn(
            "flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 text-sm font-medium transition-colors",
            settingsActive
              ? "bg-primary text-primary-foreground"
              : "text-sidebar-foreground hover:bg-sidebar-accent",
          )}
        >
          <Settings className="h-4 w-4" />
          Einstellungen
        </Link>
      </div>
    </aside>
  )
}
