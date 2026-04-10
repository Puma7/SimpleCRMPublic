"use client"

import type { ReactElement } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  AtSign,
  BrainCircuit,
  Download,
  KeyRound,
  Send,
  Sparkles,
  Type,
  Users,
} from "lucide-react"
import { type SettingsTab, useMailWorkspace } from "./workspace-context"
import { AccountsPanel } from "./settings/accounts-panel"
import { SmtpPanel } from "./settings/smtp-panel"
import { OAuthPanel } from "./settings/oauth-panel"
import { AiPanel } from "./settings/ai-panel"
import { TeamPanel } from "./settings/team-panel"
import { CannedPanel } from "./settings/canned-panel"
import { PromptsPanel } from "./settings/prompts-panel"
import { ExportPanel } from "./settings/export-panel"

type TabDef = {
  id: SettingsTab
  label: string
  icon: typeof AtSign
  render: () => ReactElement
}

export const SETTINGS_TABS: TabDef[] = [
  { id: "accounts", label: "Konten", icon: AtSign, render: () => <AccountsPanel /> },
  { id: "smtp", label: "SMTP", icon: Send, render: () => <SmtpPanel /> },
  { id: "oauth", label: "OAuth", icon: KeyRound, render: () => <OAuthPanel /> },
  { id: "ai", label: "KI", icon: BrainCircuit, render: () => <AiPanel /> },
  { id: "team", label: "Team", icon: Users, render: () => <TeamPanel /> },
  { id: "canned", label: "Textbausteine", icon: Type, render: () => <CannedPanel /> },
  { id: "prompts", label: "KI-Prompts", icon: Sparkles, render: () => <PromptsPanel /> },
  { id: "export", label: "Export", icon: Download, render: () => <ExportPanel /> },
]

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen, settingsTab, setSettingsTab } = useMailWorkspace()

  const activeTab = SETTINGS_TABS.find((t) => t.id === settingsTab) ?? SETTINGS_TABS[0]!

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-5xl gap-0 overflow-hidden p-0 sm:h-[min(85vh,720px)]">
        <DialogTitle className="sr-only">E-Mail-Einstellungen</DialogTitle>
        <div className="flex h-full min-h-0">
          {/* Left rail */}
          <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/40">
            <div className="border-b px-4 py-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                E-Mail-Einstellungen
              </p>
            </div>
            <nav className="flex-1 space-y-0.5 p-2">
              {SETTINGS_TABS.map((t) => {
                const Icon = t.icon
                const active = t.id === settingsTab
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setSettingsTab(t.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                      active
                        ? "bg-background font-medium shadow-sm"
                        : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {t.label}
                  </button>
                )
              })}
            </nav>
          </aside>

          {/* Right content */}
          <ScrollArea className="flex-1">
            <div className="mx-auto max-w-2xl p-6">{activeTab.render()}</div>
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Render-only variant used by the /email/settings route (no dialog chrome). */
export function SettingsPanelsPage() {
  const { settingsTab, setSettingsTab } = useMailWorkspace()
  const activeTab = SETTINGS_TABS.find((t) => t.id === settingsTab) ?? SETTINGS_TABS[0]!

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-lg border bg-background">
      <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/40">
        <div className="border-b px-4 py-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            E-Mail-Einstellungen
          </p>
        </div>
        <nav className="flex-1 space-y-0.5 p-2">
          {SETTINGS_TABS.map((t) => {
            const Icon = t.icon
            const active = t.id === settingsTab
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSettingsTab(t.id)}
                className={cn(
                  "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm transition-colors",
                  active
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-background/60 hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" />
                {t.label}
              </button>
            )
          })}
        </nav>
      </aside>
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-2xl p-6">{activeTab.render()}</div>
      </ScrollArea>
    </div>
  )
}
