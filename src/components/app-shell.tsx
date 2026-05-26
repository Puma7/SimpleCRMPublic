"use client"

import { useCallback, useState } from "react"
import { Outlet, useRouterState } from "@tanstack/react-router"
import { ThemeProvider } from "next-themes"
import Titlebar from "@/components/ui/titlebar"
import { MainNav } from "@/components/main-nav"
import { UpdateStatusDisplay } from "@/components/update-status-display"
import { ErrorBoundary } from "@/components/error-boundary"
import { Toaster } from "@/components/ui/sonner"
import {
  CommandPalette,
  useCommandPaletteShortcut,
} from "@/components/theme/command-palette"
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

export function AppShell() {
  const [paletteOpen, setPaletteOpen] = useState(false)
  const openPalette = useCallback(() => setPaletteOpen(true), [])
  useCommandPaletteShortcut(openPalette)

  return (
    <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden font-sans antialiased">
        <Titlebar />
        <MainNav onOpenCommandPalette={openPalette} />
        <UpdateStatusDisplay />
        <AppMain />
        <Toaster richColors closeButton position="bottom-right" />
        <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} />
      </div>
    </ThemeProvider>
  )
}
