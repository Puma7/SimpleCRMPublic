"use client"

import { useEffect } from "react"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { SettingsPanelsPage } from "@/components/email/settings-panels"
import { emailSettingsSearch } from "@/lib/email-settings-search"
import { useMailWorkspace, type SettingsTab } from "@/components/email/workspace-context"

export default function EmailSettingsPage() {
  const { tab } = useSearch({ from: "/email/settings" })
  const navigate = useNavigate()
  const { setSettingsTab } = useMailWorkspace()

  useEffect(() => {
    setSettingsTab(tab as SettingsTab)
  }, [tab, setSettingsTab])

  useEffect(() => {
    if (typeof window === "undefined") return
    const params = new URLSearchParams(window.location.search)
    if (!params.has("section")) return
    void navigate({
      to: "/email/settings",
      search: emailSettingsSearch({ tab: tab as SettingsTab }),
      replace: true,
    })
  }, [tab, navigate])

  return <SettingsPanelsPage />
}
