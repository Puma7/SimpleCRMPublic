"use client"

import { useMatchRoute, useNavigate } from "@tanstack/react-router"
import { useMailWorkspace } from "../workspace-context"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function EmailUiModeToggle({ className }: { className?: string }) {
  const { emailUiMode, setEmailUiMode } = useMailWorkspace()
  const navigate = useNavigate()
  const onSettings = !!useMatchRoute({ to: "/email/settings", fuzzy: false })

  const select = (mode: "classic" | "beta") => {
    setEmailUiMode(mode)
    if (!onSettings) return
    if (mode === "beta") {
      void navigate({
        to: "/email/settings",
        search: { section: "overview", intelligenceTab: "profiles", tab: "accounts" },
      })
    } else {
      void navigate({
        to: "/email/settings",
        search: { tab: "accounts", section: "overview", intelligenceTab: "profiles" },
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
        variant={emailUiMode === "classic" ? "secondary" : "ghost"}
        className="h-7 px-2.5 text-xs"
        onClick={() => select("classic")}
      >
        Klassisch
      </Button>
      <Button
        type="button"
        size="sm"
        variant={emailUiMode === "beta" ? "secondary" : "ghost"}
        className="h-7 px-2.5 text-xs"
        onClick={() => select("beta")}
      >
        Beta
      </Button>
    </div>
  )
}
