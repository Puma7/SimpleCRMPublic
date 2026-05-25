"use client"

import { MailShell } from "@/components/email/mail-shell"
import { BetaMailShell } from "@/components/email/beta/beta-mail-shell"
import { useUiTheme } from "@/components/beta/ui-theme-provider"

export default function EmailPage() {
  const { theme } = useUiTheme()
  if (theme === "beta") return <BetaMailShell />
  return <MailShell />
}
