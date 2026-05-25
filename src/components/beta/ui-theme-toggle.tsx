"use client"

import { useUiTheme } from "./ui-theme-provider"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { UiTheme } from "@/lib/ui-theme"

export function UiThemeToggle({
  className,
  value: controlledValue,
  onChange: controlledOnChange,
}: {
  className?: string
  /** Optional controlled mode (e.g. BetaTopbar local sync). */
  value?: UiTheme
  onChange?: (t: UiTheme) => void
}) {
  const { theme: contextTheme, setTheme } = useUiTheme()
  const value = controlledValue ?? contextTheme
  const onChange = controlledOnChange ?? setTheme

  const select = (t: UiTheme) => onChange(t)

  return (
    <div
      className={cn(
        "inline-flex items-center rounded-lg border border-border/80 bg-muted/40 p-0.5 text-xs",
        className,
      )}
      role="group"
      aria-label="Oberfläche"
    >
      <Button
        type="button"
        size="sm"
        variant={value === "classic" ? "secondary" : "ghost"}
        className="h-7 px-2.5 text-xs"
        onClick={() => select("classic")}
      >
        Klassisch
      </Button>
      <Button
        type="button"
        size="sm"
        variant={value === "beta" ? "secondary" : "ghost"}
        className="h-7 px-2.5 text-xs"
        onClick={() => select("beta")}
      >
        Beta v0.2
      </Button>
    </div>
  )
}
