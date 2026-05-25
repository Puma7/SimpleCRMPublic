"use client"

import { Bell, PanelLeft, Search, Sun } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { UiThemeToggle } from "./ui-theme-toggle"
import { useThemeTokens } from "@/components/theme/theme-tokens-provider"
import { cn } from "@/lib/utils"

type Props = {
  breadcrumbs?: { label: string; muted?: boolean }[]
  children?: React.ReactNode
  onOpenCommandPalette?: () => void
  onOpenTweaks?: () => void
}

export function BetaTopbar({
  breadcrumbs = [],
  children,
  onOpenCommandPalette,
  onOpenTweaks,
}: Props) {
  const { patchTokens, tokens } = useThemeTokens()

  const toggleSidebar = () => {
    patchTokens({
      sidebarMode: tokens.sidebarMode === "rail" ? "full" : "rail",
    })
  }

  const toggleColorMode = () => {
    patchTokens({ colorMode: tokens.colorMode === "dark" ? "light" : "dark" })
  }

  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/80 bg-card/50 px-4 backdrop-blur-sm crm-panel-shadow">
      <Button
        type="button"
        size="icon"
        variant="ghost"
        className="h-8 w-8 shrink-0"
        title="Sidebar schmal/voll"
        onClick={toggleSidebar}
      >
        <PanelLeft className="h-4 w-4" />
      </Button>
      <nav className="hidden min-w-0 items-center gap-1.5 text-sm sm:flex">
        {breadcrumbs.map((crumb, i) => (
          <span key={`${crumb.label}-${i}`} className="flex items-center gap-1.5">
            {i > 0 ? <span className="text-muted-foreground/60">/</span> : null}
            <span
              className={
                crumb.muted || i < breadcrumbs.length - 1
                  ? "text-muted-foreground"
                  : "font-medium text-foreground"
              }
            >
              {crumb.label}
            </span>
          </span>
        ))}
      </nav>
      <button
        type="button"
        className="relative mx-2 hidden max-w-md flex-1 md:block"
        onClick={onOpenCommandPalette}
      >
        <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="h-9 cursor-pointer border-border/60 bg-muted/30 pl-9 text-sm"
          placeholder="Suche, springe zu, Aktion…"
          readOnly
          onFocus={onOpenCommandPalette}
        />
        <kbd className="pointer-events-none absolute right-2 top-2 rounded border bg-background px-1.5 text-[10px] text-muted-foreground">
          Strg+K
        </kbd>
      </button>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="relative h-8 w-8"
          title="Benachrichtigungen"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-primary shadow-[var(--crm-glow-accent)]" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title="Farbmodus"
          onClick={toggleColorMode}
        >
          <Sun className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-8 w-8"
          title="Design-Tweaks"
          onClick={onOpenTweaks}
        >
          <span className="text-xs font-bold text-primary">T</span>
        </Button>
        <UiThemeToggle />
        <div
          className={cn(
            "flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold text-primary-foreground",
            "bg-gradient-to-br from-[var(--crm-primary)] to-[var(--crm-accent)]",
          )}
          title="Profil"
        >
          U
        </div>
      </div>
    </header>
  )
}
