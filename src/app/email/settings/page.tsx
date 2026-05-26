"use client"

import { useEffect } from "react"
import { useSearch } from "@tanstack/react-router"
import { SettingsPanelsPage } from "@/components/email/settings-panels"
import { useMailWorkspace, type SettingsTab } from "@/components/email/workspace-context"

export default function EmailSettingsPage() {
  const { tab } = useSearch({ from: "/email/settings" })
  const { setSettingsTab } = useMailWorkspace()

  useEffect(() => {
    setSettingsTab(tab as SettingsTab)
  }, [tab, setSettingsTab])

  return <SettingsPanelsPage />
}
