"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useNavigate } from "@tanstack/react-router"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import { emailSettingsSearch } from "@/lib/email-settings-search"
import { useAuth } from "@/components/auth/auth-context"
import { isCrmRoutePath } from "@/components/crm-route-access"
import { isServerClientMode } from "@/lib/runtime-mode"

type CommandEntry = {
  id: string
  label: string
  section: string
  shortcut?: string
  keywords?: string
  /** Zielpfad; steuert zugleich die crm.read-Filterung. */
  to: string
  run: () => void
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const RECENT_KEY = "simplecrm:commandRecent"
const MAX_RECENT = 5

function readRecent(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(RECENT_KEY)
    return raw ? (JSON.parse(raw) as string[]) : []
  } catch {
    return []
  }
}

function pushRecent(id: string): void {
  const prev = readRecent().filter((x) => x !== id)
  const next = [id, ...prev].slice(0, MAX_RECENT)
  window.localStorage.setItem(RECENT_KEY, JSON.stringify(next))
}

export function CommandPalette({ open, onOpenChange }: Props) {
  const navigate = useNavigate()
  const { canViewSettings, canViewWorkflows, canReadCrm, capabilitiesReady } = useAuth()
  const [recentIds, setRecentIds] = useState<string[]>([])

  useEffect(() => {
    if (open) setRecentIds(readRecent())
  }, [open])

  const go = useCallback(
    (id: string, to: string, search?: Record<string, unknown>) => {
      pushRecent(id)
      onOpenChange(false)
      void navigate({ to, search } as { to: string; search?: Record<string, unknown> })
    },
    [navigate, onOpenChange],
  )

  const runAction = useCallback(
    (id: string, fn: () => void) => {
      pushRecent(id)
      onOpenChange(false)
      fn()
    },
    [onOpenChange],
  )

  const entries = useMemo<CommandEntry[]>(
    () => [
      {
        id: "nav-dashboard",
        label: "Dashboard",
        section: "Springe zu",
        shortcut: "G D",
        keywords: "start",
        to: "/",
        run: () => go("nav-dashboard", "/"),
      },
      {
        id: "nav-customers",
        label: "Kunden",
        section: "Springe zu",
        shortcut: "G C",
        to: "/customers",
        run: () => go("nav-customers", "/customers"),
      },
      {
        id: "nav-deals",
        label: "Deals",
        section: "Springe zu",
        shortcut: "G L",
        to: "/deals",
        run: () => go("nav-deals", "/deals"),
      },
      {
        id: "nav-tasks",
        label: "Aufgaben",
        section: "Springe zu",
        to: "/tasks",
        run: () => go("nav-tasks", "/tasks"),
      },
      {
        id: "nav-email",
        label: "E-Mail Postfach",
        section: "Springe zu",
        shortcut: "G M",
        to: "/email",
        run: () => go("nav-email", "/email"),
      },
      ...(canViewSettings
        ? [{
            id: "nav-email-settings",
            label: "E-Mail Einstellungen",
            section: "Springe zu",
            to: "/email/settings",
            run: () =>
              go("nav-email-settings", "/email/settings", emailSettingsSearch({ tab: "accounts" })),
          } satisfies CommandEntry]
        : []),
      ...(canViewWorkflows
        ? [{
            id: "nav-workflows",
            label: "E-Mail Workflows",
            section: "Springe zu",
            to: "/email/workflows",
            run: () => go("nav-workflows", "/email/workflows"),
          } satisfies CommandEntry]
        : []),
      {
        id: "nav-calendar",
        label: "Kalender",
        section: "Springe zu",
        to: "/calendar",
        run: () => go("nav-calendar", "/calendar"),
      },
      ...(canViewSettings
        ? [{
            id: "nav-settings",
            label: "Einstellungen",
            section: "Springe zu",
            to: "/settings",
            run: () => go("nav-settings", "/settings"),
          } satisfies CommandEntry]
        : []),
      {
        id: "compose",
        label: "Neue E-Mail verfassen",
        section: "Aktion",
        shortcut: "C",
        to: "/email",
        run: () => go("compose", "/email"),
      },
    ],
    [go, runAction, canViewSettings, canViewWorkflows],
  )

  // Ohne crm.read enden alle CRM-Ziele serverseitig im 403 — sie gehoeren
  // deshalb auch nicht in die Befehlspalette.
  const visibleEntries = useMemo(() => {
    if (!isServerClientMode() || !capabilitiesReady || canReadCrm) return entries
    return entries.filter((entry) => !isCrmRoutePath(entry.to))
  }, [entries, capabilitiesReady, canReadCrm])

  const recentEntries = visibleEntries.filter((e) => recentIds.includes(e.id))
  const sections = ["Kürzlich", "Springe zu", "Aktion"] as const

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      contentClassName="command-palette-glow sm:max-w-lg"
    >
      <CommandInput placeholder="Suche, springe zu, Aktion…" />
      <CommandList className="max-h-[min(360px,50vh)]">
        <CommandEmpty>Keine Treffer.</CommandEmpty>
        {recentEntries.length > 0 ? (
          <CommandGroup heading="Kürzlich">
            {recentEntries.map((item) => (
              <CommandItem key={`recent-${item.id}`} onSelect={item.run}>
                {item.label}
                {item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
              </CommandItem>
            ))}
          </CommandGroup>
        ) : null}
        {sections.filter((s) => s !== "Kürzlich").map((section) => (
          <CommandGroup key={section} heading={section}>
            {visibleEntries
              .filter((e) => e.section === section)
              .map((item) => (
                <CommandItem
                  key={item.id}
                  value={`${item.label} ${item.keywords ?? ""}`}
                  onSelect={item.run}
                >
                  {item.label}
                  {item.shortcut ? <CommandShortcut>{item.shortcut}</CommandShortcut> : null}
                </CommandItem>
              ))}
          </CommandGroup>
        ))}
        <div className="border-t px-3 py-2 text-[10px] text-muted-foreground">
          ↑↓ navigieren · ↵ ausführen · Esc schließen · Strg+K öffnen
        </div>
      </CommandList>
    </CommandDialog>
  )
}

/** Global Strg+K listener — mount once in AppShell. */
export function useCommandPaletteShortcut(onOpen: () => void): void {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault()
        onOpen()
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [onOpen])
}
