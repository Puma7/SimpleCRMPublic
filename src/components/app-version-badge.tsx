import { cn } from "@/lib/utils"

// Inlined at build time by Vite (see the `define` block in vite.config.ts).
// They are `undefined` when the module is evaluated outside a Vite build
// (e.g. under jest), so every read is guarded with a `typeof` check.
declare const __SIMPLECRM_APP_VERSION__: string | undefined
declare const __SIMPLECRM_GIT_SHA__: string | undefined

const VERSION =
  typeof __SIMPLECRM_APP_VERSION__ !== "undefined" ? __SIMPLECRM_APP_VERSION__ : "dev"
const GIT_SHA =
  typeof __SIMPLECRM_GIT_SHA__ !== "undefined" ? __SIMPLECRM_GIT_SHA__ : ""

/**
 * Always-visible app version label shown next to the brand in the top nav.
 *
 * The version is the single source of truth from `package.json`; the optional
 * short git SHA pins the exact build. Both are inlined at build time, so this
 * works identically for the Electron and the server/web edition without any
 * runtime/IPC wiring. The SHA is surfaced in the tooltip (it is empty for
 * builds without a `.git` directory, e.g. the Docker images).
 */
export function AppVersionBadge({ className }: { className?: string }) {
  const label = `v${VERSION}`
  const title = GIT_SHA ? `SimpleCRM ${label} · build ${GIT_SHA}` : `SimpleCRM ${label}`
  return (
    <span
      title={title}
      data-testid="app-version"
      className={cn(
        "select-none text-xs font-medium tabular-nums text-muted-foreground",
        className,
      )}
    >
      {label}
    </span>
  )
}
