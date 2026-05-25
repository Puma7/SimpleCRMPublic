"use client"

import { useEffect } from "react"
import { useSearch } from "@tanstack/react-router"
import { SettingsPanelsPage } from "@/components/email/settings-panels"
import { BetaEmailSettingsShell } from "@/components/email/beta/beta-email-settings-shell"
import { useMailWorkspace, type SettingsTab } from "@/components/email/workspace-context"
import { useUiTheme } from "@/components/beta/ui-theme-provider"
import type { BetaIntelligenceTab, BetaSettingsSection } from "@/components/email/beta/beta-settings-sections"

export default function EmailSettingsPage() {
  const { tab, section, intelligenceTab } = useSearch({ from: "/email/settings" })
  const { setSettingsTab } = useMailWorkspace()
  const { theme } = useUiTheme()

  useEffect(() => {
    setSettingsTab(tab as SettingsTab)
  }, [tab, setSettingsTab])

  if (theme === "beta") {
    return (
      <BetaEmailSettingsShell
        section={(section ?? "mailboxes") as BetaSettingsSection}
        intelligenceTab={(intelligenceTab ?? "profiles") as BetaIntelligenceTab}
      />
    )
  }

  return <SettingsPanelsPage />
}
