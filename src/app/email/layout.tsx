"use client"

import { Outlet, useRouterState } from "@tanstack/react-router"
import { Mail } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmailSubNav } from "@/components/email/email-sub-nav"
import { BetaEmailSubnav } from "@/components/email/beta/beta-email-subnav"
import { MailWorkspaceProvider } from "@/components/email/workspace-context"
import { useHasElectron } from "@/components/email/use-has-electron"
import { useUiTheme } from "@/components/beta/ui-theme-provider"

export default function EmailModuleLayout() {
  const electronReady = useHasElectron()
  const { theme } = useUiTheme()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const isBeta = theme === "beta"
  const isInbox = pathname === "/email" || pathname === "/email/"
  const isSettings = pathname.startsWith("/email/settings")
  const showBetaSubnav = isBeta && !isInbox && !isSettings

  if (!electronReady) {
    return (
      <div className="container max-w-2xl py-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              E-Mail
            </CardTitle>
            <CardDescription>
              Das E-Mail-Modul ist nur in der Desktop-App (Electron) verfügbar. Bitte starten Sie
              SimpleCRM mit{" "}
              <code className="rounded bg-muted px-1">npm run electron:dev</code>.
            </CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    )
  }

  return (
    <MailWorkspaceProvider>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        {!isBeta ? <EmailSubNav /> : null}
        {showBetaSubnav ? <BetaEmailSubnav /> : null}
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </MailWorkspaceProvider>
  )
}
