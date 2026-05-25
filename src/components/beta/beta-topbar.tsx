"use client"

import { Search, Sun } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { UiThemeToggle } from "./ui-theme-toggle"

type Props = {
  breadcrumbs?: { label: string; muted?: boolean }[]
  children?: React.ReactNode
}

export function BetaTopbar({ breadcrumbs = [], children }: Props) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border/80 bg-card/50 px-4 backdrop-blur-sm">
      <nav className="flex min-w-0 items-center gap-1.5 text-sm">
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
      <div className="relative mx-2 hidden max-w-md flex-1 md:block">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
        <Input
          className="h-9 border-border/60 bg-muted/30 pl-9 text-sm"
          placeholder="Suche, springe zu, Aktion… (Strg+K demnächst)"
          readOnly
        />
      </div>
      <div className="ml-auto flex items-center gap-2">
        {children}
        <Button type="button" size="icon" variant="ghost" className="h-8 w-8" title="Design (folgt)">
          <Sun className="h-4 w-4" />
        </Button>
        <UiThemeToggle />
        <div
          className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/20 text-xs font-semibold text-primary"
          title="Profil"
        >
          U
        </div>
      </div>
    </header>
  )
}
