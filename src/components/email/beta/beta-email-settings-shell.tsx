"use client"

import { Link, useNavigate } from "@tanstack/react-router"
import {
  AtSign,
  BookOpen,
  BrainCircuit,
  Download,
  ShieldCheck,
  Sparkles,
  Type,
  Users,
  Workflow,
  Wrench,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { ScrollArea } from "@/components/ui/scroll-area"
import { BetaAccountsSettings } from "./beta-accounts-settings"
import {
  BETA_INTELLIGENCE_TAB_IDS,
  intelligenceTabLabel,
  renderBetaSectionContent,
  type BetaIntelligenceTab,
  type BetaSettingsSection,
} from "./beta-settings-sections"
import { BetaSettingsOverview } from "./beta-settings-overview"

type NavItem = {
  id: BetaSettingsSection | "workflows-link"
  label: string
  icon: typeof AtSign
  group: string
  external?: boolean
}

const NAV: NavItem[] = [
  { id: "overview", label: "Übersicht", icon: AtSign, group: "Start" },
  { id: "mailboxes", label: "Konten", icon: AtSign, group: "E-Mail" },
  { id: "delivery", label: "SMTP & KI", icon: BrainCircuit, group: "E-Mail" },
  { id: "intelligence", label: "KI & Wissen", icon: Sparkles, group: "E-Mail" },
  { id: "workflows-link", label: "Workflows", icon: Workflow, group: "E-Mail", external: true },
  { id: "automation", label: "Automatisierung", icon: Workflow, group: "E-Mail" },
  { id: "team", label: "Team & Vorlagen", icon: Users, group: "Team" },
  { id: "privacy", label: "DSGVO-Export", icon: Download, group: "Compliance" },
  { id: "advanced", label: "Erweitert", icon: Wrench, group: "System" },
]

type Props = {
  section: BetaSettingsSection
  intelligenceTab: BetaIntelligenceTab
}

export function BetaEmailSettingsShell({ section, intelligenceTab }: Props) {
  const navigate = useNavigate()
  const groups = [...new Set(NAV.map((n) => n.group))]

  const go = (id: BetaSettingsSection, intel?: BetaIntelligenceTab) => {
    void navigate({
      to: "/email/settings",
      search: { section: id, intelligenceTab: intel ?? intelligenceTab, tab: "accounts" },
    })
  }

  const showAccountsMasterDetail = section === "mailboxes"

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden">
      <aside className="flex w-52 shrink-0 flex-col border-r border-border/60 bg-card/20">
        <div className="border-b border-border/60 px-3 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Konfiguration
          </p>
          <p className="text-sm font-semibold">E-Mail</p>
        </div>
        <ScrollArea className="flex-1">
          <nav className="space-y-4 p-2">
            {groups.map((group) => (
              <div key={group}>
                <p className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {group}
                </p>
                <div className="space-y-0.5">
                  {NAV.filter((n) => n.group === group).map((item) => {
                    const Icon = item.icon
                    const active =
                      !item.external &&
                      (item.id === section ||
                        (item.id === "delivery" && section === "intelligence"))
                    if (item.external) {
                      return (
                        <Link
                          key={item.id}
                          to="/email/workflows"
                          className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                        >
                          <Icon className="h-4 w-4" />
                          {item.label}
                        </Link>
                      )
                    }
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => go(item.id as BetaSettingsSection)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm transition-colors",
                          active
                            ? "bg-primary/15 font-medium text-primary"
                            : "text-muted-foreground hover:bg-muted/40 hover:text-foreground",
                        )}
                      >
                        <Icon className="h-4 w-4 shrink-0" />
                        {item.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </ScrollArea>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        {showAccountsMasterDetail ? (
          <BetaAccountsSettings />
        ) : (
          <ScrollArea className="flex-1">
            <div className="mx-auto max-w-4xl p-6">
              {section === "intelligence" ? (
                <div className="mb-4 flex flex-wrap gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">
                  {BETA_INTELLIGENCE_TAB_IDS.map((tab) => (
                    <button
                      key={tab}
                      type="button"
                      onClick={() => go("intelligence", tab)}
                      className={cn(
                        "rounded-md px-3 py-1.5 text-sm",
                        tab === intelligenceTab
                          ? "bg-background font-medium shadow-sm"
                          : "text-muted-foreground",
                      )}
                    >
                      {intelligenceTabLabel(tab)}
                    </button>
                  ))}
                </div>
              ) : null}
              {section === "overview" ? (
                <BetaSettingsOverview onOpenSection={go} />
              ) : (
                renderBetaSectionContent(section, intelligenceTab)
              )}
            </div>
          </ScrollArea>
        )}
      </div>
    </div>
  )
}
