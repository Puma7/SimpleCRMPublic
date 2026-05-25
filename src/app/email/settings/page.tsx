"use client"

import { useEffect } from "react"
import { useSearch } from "@tanstack/react-router"
import { SettingsPanelsPage } from "@/components/email/settings-panels"
import { BetaSettingsPage } from "@/components/email/beta/beta-settings-page"
import { useMailWorkspace, type SettingsTab } from "@/components/email/workspace-context"

export default function EmailSettingsPage() {
  const { tab, section, intelligenceTab } = useSearch({ from: "/email/settings" })
  const { setSettingsTab, emailUiMode } = useMailWorkspace()

  useEffect(() => {
    setSettingsTab(tab as SettingsTab)
  }, [tab, setSettingsTab])

  if (emailUiMode === "beta") {
    return <BetaSettingsPage section={section} intelligenceTab={intelligenceTab} />
  }

  return <SettingsPanelsPage />
}
