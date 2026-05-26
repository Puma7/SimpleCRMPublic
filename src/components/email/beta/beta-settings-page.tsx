"use client"

import { useNavigate } from "@tanstack/react-router"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  BETA_INTELLIGENCE_TAB_IDS,
  BETA_SETTINGS_SECTIONS,
  betaSectionWideLayout,
  intelligenceTabLabel,
  renderBetaSectionContent,
  type BetaIntelligenceTab,
  type BetaSettingsSection,
} from "./beta-settings-sections"
import { BetaSettingsOverview } from "./beta-settings-overview"
import { EmailUiModeToggle } from "./email-ui-mode-toggle"
import { emailSettingsSearch } from "@/lib/email-settings-search"

type Props = {
  section: BetaSettingsSection
  intelligenceTab: BetaIntelligenceTab
}

export function BetaSettingsPage({ section, intelligenceTab }: Props) {
  const navigate = useNavigate()
  const activeMeta = BETA_SETTINGS_SECTIONS.find((s) => s.id === section)

  const goSection = (next: BetaSettingsSection, intel?: BetaIntelligenceTab) => {
    void navigate({
      to: "/email/settings",
      search: emailSettingsSearch({
        section: next,
        intelligenceTab: intel ?? intelligenceTab,
      }),
    })
  }

  const groups = [...new Set(BETA_SETTINGS_SECTIONS.map((s) => s.group))]

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-gradient-to-b from-muted/20 to-background">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b bg-background/80 px-5 py-3 backdrop-blur-sm">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-primary">
            Beta
          </p>
          <h1 className="text-lg font-semibold tracking-tight">E-Mail-Einstellungen</h1>
        </div>
        <EmailUiModeToggle />
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <aside className="flex w-60 shrink-0 flex-col border-r bg-card/50">
          <ScrollArea className="flex-1">
            <nav className="space-y-5 p-3">
              {groups.map((group) => (
                <div key={group}>
                  <p className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {group}
                  </p>
                  <div className="space-y-0.5">
                    {BETA_SETTINGS_SECTIONS.filter((s) => s.group === group).map((s) => {
                      const Icon = s.icon
                      const active = s.id === section
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => goSection(s.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors",
                            active
                              ? "bg-primary/10 font-medium text-foreground ring-1 ring-primary/20"
                              : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
                          )}
                        >
                          <Icon className="h-4 w-4 shrink-0" />
                          <span className="truncate">{s.label}</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </nav>
          </ScrollArea>
        </aside>

        <ScrollArea className="flex-1">
          <div
            className={cn(
              "mx-auto w-full p-6 pb-10",
              betaSectionWideLayout(section) ? "max-w-5xl" : "max-w-3xl",
            )}
          >
            {activeMeta && section !== "overview" ? (
              <div className="mb-6">
                <h2 className="text-xl font-semibold tracking-tight">{activeMeta.label}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{activeMeta.description}</p>
              </div>
            ) : null}

            {section === "intelligence" ? (
              <div className="mb-6 flex flex-wrap gap-1 rounded-lg border bg-muted/30 p-1">
                {BETA_INTELLIGENCE_TAB_IDS.map((tab) => (
                  <button
                    key={tab}
                    type="button"
                    onClick={() => goSection("intelligence", tab)}
                    className={cn(
                      "rounded-md px-3 py-1.5 text-sm transition-colors",
                      tab === intelligenceTab
                        ? "bg-background font-medium shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {intelligenceTabLabel(tab)}
                  </button>
                ))}
              </div>
            ) : null}

            {section === "overview" ? (
              <BetaSettingsOverview onOpenSection={goSection} />
            ) : (
              renderBetaSectionContent(section, intelligenceTab)
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
