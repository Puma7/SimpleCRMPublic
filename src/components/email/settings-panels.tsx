"use client"

import type { ReactElement } from "react"
import { useNavigate } from "@tanstack/react-router"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  AtSign,
  BookOpen,
  BrainCircuit,
  Download,
  KeyRound,
  Send,
  Sparkles,
  Type,
  Users,
  Wrench,
  Workflow,
  ShieldCheck,
} from "lucide-react"
import { emailSettingsSearch } from "@/lib/email-settings-search"
import { type SettingsTab, useMailWorkspace } from "./workspace-context"
import { AccountsMasterDetailSettings } from "./settings/accounts-master-detail"
import { SmtpPanel } from "./settings/smtp-panel"
import { OAuthPanel } from "./settings/oauth-panel"
import { AiPanel } from "./settings/ai-panel"
import { TeamPanel } from "./settings/team-panel"
import { CannedPanel } from "./settings/canned-panel"
import { PromptsPanel } from "./settings/prompts-panel"
import { ExportPanel } from "./settings/export-panel"
import { KnowledgePanel } from "./settings/knowledge-panel"
import { AutomationPanel } from "./settings/automation-panel"
import { MailSecurityPanel } from "./settings/mail-security-panel"
import { MiscPanel } from "./settings/misc-panel"

type TabDef = {
  id: SettingsTab
  label: string
  icon: typeof AtSign
  render: () => ReactElement
  fullBleed?: boolean
}

const TAB_DEFS: TabDef[] = [
  {
    id: "accounts",
    label: "Konten",
    icon: AtSign,
    fullBleed: true,
    render: () => <AccountsMasterDetailSettings />,
  },
  { id: "smtp", label: "SMTP", icon: Send, render: () => <SmtpPanel /> },
  { id: "oauth", label: "OAuth", icon: KeyRound, render: () => <OAuthPanel /> },
  { id: "ai", label: "KI", icon: BrainCircuit, render: () => <AiPanel /> },
  { id: "knowledge", label: "Wissensbasis", icon: BookOpen, render: () => <KnowledgePanel /> },
  {
    id: "mailSecurity",
    label: "Mail-Sicherheit",
    icon: ShieldCheck,
    render: () => <MailSecurityPanel />,
  },
  {
    id: "automation",
    label: "Automatisierung",
    icon: Workflow,
    render: () => <AutomationPanel />,
  },
  { id: "prompts", label: "KI-Prompts", icon: Sparkles, render: () => <PromptsPanel /> },
  { id: "team", label: "Team", icon: Users, render: () => <TeamPanel /> },
  { id: "canned", label: "Textbausteine", icon: Type, render: () => <CannedPanel /> },
  { id: "export", label: "Datenschutz-Export", icon: Download, render: () => <ExportPanel /> },
  { id: "misc", label: "Sonstiges", icon: Wrench, render: () => <MiscPanel /> },
]

export const SETTINGS_TAB_IDS = TAB_DEFS.map((t) => t.id)

export const SETTINGS_GROUPS: { label: string; tabIds: SettingsTab[] }[] = [
  { label: "Konten & Versand", tabIds: ["accounts", "smtp", "oauth"] },
  {
    label: "KI & Automation",
    tabIds: ["ai", "knowledge", "mailSecurity", "automation", "prompts"],
  },
  { label: "Team & Vorlagen", tabIds: ["team", "canned"] },
  { label: "Datenschutz", tabIds: ["export"] },
  { label: "Sonstiges", tabIds: ["misc"] },
]

function SettingsPanels({ current }: { current: SettingsTab }) {
  const active = TAB_DEFS.find((t) => t.id === current) ?? TAB_DEFS[0]!
  const wide = current === "knowledge" || current === "prompts"
  return (
    <div
      className={cn(
        "mx-auto w-full p-6",
        wide ? "max-w-5xl" : "max-w-2xl",
      )}
    >
      {active.render()}
    </div>
  )
}

type NavProps = {
  current: SettingsTab
  onSelect: (t: SettingsTab) => void
}

function SettingsNav({ current, onSelect }: NavProps) {
  const tabById = new Map(TAB_DEFS.map((t) => [t.id, t]))

  return (
    <aside className="flex w-56 shrink-0 flex-col border-r bg-muted/40">
      <div className="border-b px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          E-Mail-Einstellungen
        </p>
      </div>
      <nav className="flex-1 space-y-4 overflow-y-auto p-2">
        {SETTINGS_GROUPS.map((group) => (
          <div key={group.label}>
            <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.tabIds.map((id) => {
                const t = tabById.get(id)
                if (!t) return null
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
                    <Icon className="h-4 w-4 shrink-0" />
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </nav>
    </aside>
  )
}

export function SettingsPanelsPage() {
  const { settingsTab, setSettingsTab } = useMailWorkspace()
  const navigate = useNavigate()
  const active = TAB_DEFS.find((t) => t.id === settingsTab) ?? TAB_DEFS[0]!

  const selectTab = (tab: SettingsTab) => {
    setSettingsTab(tab)
    void navigate({ to: "/email/settings", search: emailSettingsSearch({ tab }) })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <header className="flex h-12 shrink-0 items-center border-b px-4">
        <h1 className="text-lg font-semibold tracking-tight">Einstellungen</h1>
      </header>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <SettingsNav current={settingsTab} onSelect={selectTab} />
        {active.fullBleed ? (
          active.render()
        ) : (
          <ScrollArea className="flex-1">
            <SettingsPanels current={settingsTab} />
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
