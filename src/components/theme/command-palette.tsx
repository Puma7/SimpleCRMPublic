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
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command"
import { useUiTheme } from "@/components/beta/ui-theme-provider"
import { useThemeTokens } from "./theme-tokens-provider"
type CommandEntry = {
  id: string
  label: string
  section: string
  shortcut?: string
  keywords?: string
  run: () => void
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenTweaks?: () => void
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

export function CommandPalette({ open, onOpenChange, onOpenTweaks }: Props) {
  const navigate = useNavigate()
  const { setTheme } = useUiTheme()
  const { patchTokens } = useThemeTokens()
  const [recentIds, setRecentIds] = useState<string[]>([])

  useEffect(() => {
    if (open) setRecentIds(readRecent())
  }, [open])

  const go = useCallback(
    (id: string, to: string, search?: Record<string, string>) => {
      pushRecent(id)
      onOpenChange(false)
      void navigate({ to, search })
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
      { id: "nav-dashboard", label: "Dashboard", section: "Springe zu", shortcut: "G D", keywords: "start", run: () => go("nav-dashboard", "/") },
      { id: "nav-customers", label: "Kunden", section: "Springe zu", shortcut: "G C", run: () => go("nav-customers", "/customers") },
      { id: "nav-deals", label: "Deals", section: "Springe zu", shortcut: "G L", run: () => go("nav-deals", "/deals") },
      { id: "nav-tasks", label: "Aufgaben", section: "Springe zu", run: () => go("nav-tasks", "/tasks") },
      { id: "nav-email", label: "E-Mail Postfach", section: "Springe zu", shortcut: "G M", run: () => go("nav-email", "/email") },
      { id: "nav-email-settings", label: "E-Mail Einstellungen", section: "Springe zu", run: () => go("nav-email-settings", "/email/settings", { section: "mailboxes", tab: "accounts", intelligenceTab: "profiles" }) },
      { id: "nav-workflows", label: "E-Mail Workflows", section: "Springe zu", run: () => go("nav-workflows", "/email/workflows") },
      { id: "nav-calendar", label: "Kalender", section: "Springe zu", run: () => go("nav-calendar", "/calendar") },
      { id: "nav-settings", label: "Einstellungen", section: "Springe zu", run: () => go("nav-settings", "/settings") },
      {
        id: "compose",
        label: "Neue E-Mail verfassen",
        section: "Aktion",
        shortcut: "C",
        run: () => go("compose", "/email"),
      },
      {
        id: "theme-beta",
        label: "Oberfläche: Beta v0.2",
        section: "Theme",
        run: () => runAction("theme-beta", () => setTheme("beta")),
      },
      {
        id: "theme-classic",
        label: "Oberfläche: Klassisch",
        section: "Theme",
        run: () => runAction("theme-classic", () => setTheme("classic")),
      },
      {
        id: "theme-dark",
        label: "Farbmodus: Dunkel",
        section: "Theme",
        run: () => runAction("theme-dark", () => patchTokens({ colorMode: "dark" })),
      },
      {
        id: "theme-light",
        label: "Farbmodus: Hell",
        section: "Theme",
        run: () => runAction("theme-light", () => patchTokens({ colorMode: "light" })),
      },
      {
        id: "open-tweaks",
        label: "Design-Tweaks öffnen",
        section: "Theme",
        run: () => runAction("open-tweaks", () => onOpenTweaks?.()),
      },
    ],
    [go, runAction, setTheme, patchTokens, onOpenTweaks],
  )

  const recentEntries = entries.filter((e) => recentIds.includes(e.id))
  const sections = ["Kürzlich", "Springe zu", "Aktion", "Theme"] as const

  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Befehlspalette"
      description="Springen, Aktionen, Theme"
      className="command-palette-glow"
    >
      <CommandInput placeholder="Suche, springe zu, Aktion…" />
      <CommandList>
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
            {entries
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
      </CommandList>
      <CommandSeparator />
      <p className="px-3 py-2 text-[10px] text-muted-foreground">
        ↑↓ navigieren · ↵ ausführen · Esc schließen · Strg+K öffnen
      </p>
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
