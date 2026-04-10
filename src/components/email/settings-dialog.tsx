"use client"

import type { ReactElement } from "react"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsContent } from "@/components/ui/tabs"
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

type NavProps = {
  current: SettingsTab
  onSelect: (t: SettingsTab) => void
}

function SettingsNav({ current, onSelect }: NavProps) {
  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/40">
      <div className="border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          E-Mail-Einstellungen
        </p>
      </div>
      <nav className="flex-1 space-y-0.5 p-2">
        {SETTINGS_TABS.map((t) => {
          const Icon = t.icon
          const active = t.id === current
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
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
  )
}

/**
 * Panels are rendered inside shadcn `Tabs` / `TabsContent` so that
 * switching tabs does NOT unmount the hidden panels. Without this,
 * every tab switch would re-fire IPC calls to load accounts, SMTP,
 * canned responses etc. — painfully slow and needlessly noisy.
 */
function SettingsPanels({ current }: { current: SettingsTab }) {
  return (
    <Tabs value={current} className="w-full">
      {SETTINGS_TABS.map((t) => (
        <TabsContent
          key={t.id}
          value={t.id}
          className="mt-0 data-[state=inactive]:hidden"
          forceMount
        >
          <div className="mx-auto max-w-2xl p-6">{t.render()}</div>
        </TabsContent>
      ))}
    </Tabs>
  )
}

export function SettingsDialog() {
  const { settingsOpen, setSettingsOpen, settingsTab, setSettingsTab } = useMailWorkspace()

  return (
    <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
      <DialogContent className="max-w-5xl gap-0 overflow-hidden p-0 sm:h-[min(85vh,720px)]">
        <DialogTitle className="sr-only">E-Mail-Einstellungen</DialogTitle>
        <div className="flex h-full min-h-0">
          <SettingsNav current={settingsTab} onSelect={setSettingsTab} />
          <ScrollArea className="flex-1">
            <SettingsPanels current={settingsTab} />
          </ScrollArea>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Render-only variant used by the /email/settings route (no dialog chrome). */
export function SettingsPanelsPage() {
  const { settingsTab, setSettingsTab } = useMailWorkspace()

  return (
    <div className="flex h-[calc(100vh-8rem)] overflow-hidden rounded-lg border bg-background">
      <SettingsNav current={settingsTab} onSelect={setSettingsTab} />
      <ScrollArea className="flex-1">
        <SettingsPanels current={settingsTab} />
      </ScrollArea>
    </div>
  )
}
