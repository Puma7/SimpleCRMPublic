"use client"

import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

type Props = {
  eyebrow?: string
  breadcrumbs?: { label: string; muted?: boolean }[]
  title: string
  actions?: ReactNode
  tabs?: ReactNode
  className?: string
}

export function ContextBar({
  eyebrow,
  breadcrumbs = [],
  title,
  actions,
  tabs,
  className,
}: Props) {
  return (
    <div
      className={cn(
        "shrink-0 border-b border-border/60 bg-card/30 px-4 py-3 beta-accent-bar",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {eyebrow ? (
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {eyebrow}
            </p>
          ) : null}
          {breadcrumbs.length > 0 ? (
            <nav className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {breadcrumbs.map((c, i) => (
                <span key={`${c.label}-${i}`} className="flex items-center gap-1">
                  {i > 0 ? <span>/</span> : null}
                  <span className={cn(!c.muted && i === breadcrumbs.length - 1 && "text-foreground")}>
                    {c.label}
                  </span>
                </span>
              ))}
            </nav>
          ) : null}
          <h1 className="font-display-serif text-xl font-semibold tracking-tight text-foreground">
            {title}
          </h1>
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
      {tabs ? <div className="mt-3">{tabs}</div> : null}
    </div>
  )
}
