"use client"

import { Outlet } from "@tanstack/react-router"
import { Mail } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { EmailSubNav } from "@/components/email/email-sub-nav"
import { MailWorkspaceProvider } from "@/components/email/workspace-context"
import { useHasElectron } from "@/components/email/use-has-electron"
import { getRendererTransport } from "@/services/transport"

export default function EmailModuleLayout() {
  const electronReady = useHasElectron()
  const serverClientMode =
    typeof window !== "undefined" && getRendererTransport().kind === "http"

  if (!electronReady && !serverClientMode) {
    return (
      <div className="container max-w-2xl py-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5" />
              E-Mail
            </CardTitle>
            <CardDescription>
              Das E-Mail-Modul benoetigt die Desktop-App oder eine verbundene
              SimpleCRM-Serverinstanz. Bitte starten Sie SimpleCRM mit{" "}
              <code className="rounded bg-muted px-1">npm run electron:dev</code> oder verbinden
              Sie den Browser mit dem Server-Client-Modus.
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
        <EmailSubNav />
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet />
        </div>
      </div>
    </MailWorkspaceProvider>
  )
}
