"use client"

import type { ReactNode } from "react"
import { BetaSidebar } from "./beta-sidebar"
import { BetaTopbar } from "./beta-topbar"

type Props = {
  breadcrumbs?: { label: string; muted?: boolean }[]
  topbarExtra?: ReactNode
  onOpenCommandPalette?: () => void
  onOpenTweaks?: () => void
  children: ReactNode
}

/** App-Rahmen für Beta-Theme: vertikale Sidebar + Topbar. */
export function BetaAppShell({
  breadcrumbs,
  topbarExtra,
  onOpenCommandPalette,
  onOpenTweaks,
  children,
}: Props) {
  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <BetaSidebar />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <BetaTopbar
          breadcrumbs={breadcrumbs}
          onOpenCommandPalette={onOpenCommandPalette}
          onOpenTweaks={onOpenTweaks}
        >
          {topbarExtra}
        </BetaTopbar>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  )
}
