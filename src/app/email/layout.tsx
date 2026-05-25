"use client"

import { Outlet } from "@tanstack/react-router"
import { Mail } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmailSubNav } from "@/components/email/email-sub-nav"
import { MailWorkspaceProvider } from "@/components/email/workspace-context"
import { useHasElectron } from "@/components/email/use-has-electron"

export default function EmailModuleLayout() {
  const electronReady = useHasElectron()

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
      <div className="flex h-[calc(100vh-4rem)] min-h-0 flex-col overflow-hidden bg-background">
        <EmailSubNav />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </MailWorkspaceProvider>
  )
}
