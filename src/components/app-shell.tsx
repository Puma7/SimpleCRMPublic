"use client"

import { Outlet, useRouterState } from "@tanstack/react-router"
import { ThemeProvider } from "next-themes"
import Titlebar from "@/components/ui/titlebar"
import { MainNav } from "@/components/main-nav"
import { UpdateStatusDisplay } from "@/components/update-status-display"
import { ErrorBoundary } from "@/components/error-boundary"
import { Toaster } from "@/components/ui/sonner"
import { BetaAppShell } from "@/components/beta/beta-app-shell"
import { useUiTheme } from "@/components/beta/ui-theme-provider"
import { cn } from "@/lib/utils"

function AppMain() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isEmailModule = pathname.startsWith("/email")

  return (
    <main
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        isEmailModule ? "overflow-hidden" : "overflow-y-auto",
      )}
    >
      <ErrorBoundary>
        <Outlet />
      </ErrorBoundary>
    </main>
  )
}

function betaBreadcrumbs(pathname: string): { label: string; muted?: boolean }[] {
  if (pathname.startsWith("/email/settings")) {
    return [
      { label: "Einstellungen", muted: true },
      { label: "E-Mail", muted: true },
      { label: "Konten" },
    ]
  }
  if (pathname.startsWith("/email")) {
    return [
      { label: "Kommunikation", muted: true },
      { label: "E-Mail" },
    ]
  }
  if (pathname.startsWith("/customers")) return [{ label: "Arbeitsfläche", muted: true }, { label: "Kunden" }]
  if (pathname.startsWith("/deals")) return [{ label: "Arbeitsfläche", muted: true }, { label: "Deals" }]
  if (pathname.startsWith("/tasks")) return [{ label: "Arbeitsfläche", muted: true }, { label: "Aufgaben" }]
  if (pathname === "/" || pathname === "") return [{ label: "Dashboard" }]
  return [{ label: "SimpleCRM" }]
}

export function AppShell() {
  const { theme } = useUiTheme()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isBeta = theme === "beta"

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden font-sans antialiased">
        <Titlebar />
        {isBeta ? (
          <BetaAppShell breadcrumbs={betaBreadcrumbs(pathname)}>
            <UpdateStatusDisplay />
            <AppMain />
          </BetaAppShell>
        ) : (
          <>
            <MainNav />
            <UpdateStatusDisplay />
            <AppMain />
          </>
        )}
        <Toaster richColors closeButton position="bottom-right" />
      </div>
    </ThemeProvider>
  )
}
