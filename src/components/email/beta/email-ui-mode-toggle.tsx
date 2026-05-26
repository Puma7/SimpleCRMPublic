"use client"

import { useMatchRoute, useNavigate } from "@tanstack/react-router"
import { useUiTheme } from "@/components/beta/ui-theme-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { emailSettingsSearch } from "@/lib/email-settings-search"

export function EmailUiModeToggle({ className }: { className?: string }) {
  const { theme, setTheme } = useUiTheme()
  const navigate = useNavigate()
  const matchRoute = useMatchRoute()
  const onSettings = !!matchRoute({ to: "/email/settings", fuzzy: false })

  const select = (mode: "classic" | "beta") => {
    setTheme(mode)
    if (!onSettings) return
    if (mode === "beta") {
      void navigate({
        to: "/email/settings",
        search: emailSettingsSearch({ section: "mailboxes" }),
      })
    } else {
      void navigate({
        to: "/email/settings",
        search: emailSettingsSearch({ tab: "accounts", section: "overview" }),
      })
    }
  }

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border bg-muted/40 p-0.5 text-xs",
        className,
      )}
      role="group"
      aria-label="Oberflächenmodus"
    >
      <Button
        type="button"
        size="sm"
        variant={theme === "classic" ? "secondary" : "ghost"}
        className="h-7 px-2.5 text-xs"
        onClick={() => select("classic")}
      >
        Klassisch
      </Button>
      <Button
        type="button"
        size="sm"
        variant={theme === "beta" ? "secondary" : "ghost"}
        className="h-7 px-2.5 text-xs"
        onClick={() => select("beta")}
      >
        Beta v0.2
      </Button>
    </div>
  )
}
