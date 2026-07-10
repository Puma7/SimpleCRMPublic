"use client"

import { useCallback, useState } from "react"
import { Outlet, useRouterState } from "@tanstack/react-router"
import { ThemeProvider } from "next-themes"
import Titlebar from "@/components/ui/titlebar"
import { MainNav } from "@/components/main-nav"
import { UpdateStatusDisplay } from "@/components/update-status-display"
import { ErrorBoundary } from "@/components/error-boundary"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { Toaster as RadixToaster } from "@/components/ui/toaster"
import {
  CommandPalette,
  useCommandPaletteShortcut,
} from "@/components/theme/command-palette"
import { cn } from "@/lib/utils"
import { isElectron } from "@/lib/electron-utils"
import { AuthProvider } from "@/components/auth/auth-context"
import { AuthGate } from "@/components/auth/auth-gate"

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

function isPublicPortalPath(pathname: string): boolean {
  return pathname.startsWith("/portal/")
}

function AppChrome({ openPalette }: { openPalette: () => void }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  if (isPublicPortalPath(pathname)) {
    // No titlebar / nav / update banner on the public customer portal.
    return (
      <div className="flex h-screen min-h-0 flex-col overflow-y-auto bg-background font-sans antialiased">
        <ErrorBoundary>
          <Outlet />
        </ErrorBoundary>
      </div>
    )
  }
  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden font-sans antialiased">
      {/* The custom titlebar only carries Electron window controls (min/max/close);
          in a plain browser those are dead buttons, so render it only in Electron. */}
      {isElectron() && <Titlebar />}
      <MainNav onOpenCommandPalette={openPalette} />
      <UpdateStatusDisplay />
      <AppMain />
    </div>
  )
}

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  useCommandPaletteShortcut(openPalette)

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <AuthProvider>
        <AuthGate>
          <AppChrome openPalette={openPalette} />
          <SonnerToaster richColors closeButton position="bottom-right" />
          <RadixToaster />
          <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
        </AuthGate>
      </AuthProvider>
    </ThemeProvider>
  )
}
