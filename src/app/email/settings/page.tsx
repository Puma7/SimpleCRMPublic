"use client"

import { Link } from "@tanstack/react-router"
import { ArrowLeft, Settings } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { MailWorkspaceProvider } from "@/components/email/workspace-context"
import { SettingsPanelsPage } from "@/components/email/settings-dialog"
import { hasElectron } from "@/components/email/types"

export default function EmailSettingsPage() {
  if (!hasElectron()) {
    return (
      <div className="container max-w-2xl py-10">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Settings className="h-5 w-5" />
              E-Mail-Einstellungen
            </CardTitle>
            <CardDescription>Nur in der Desktop-App verfügbar.</CardDescription>
          </CardHeader>
          <CardContent />
        </Card>
      </div>
    )
  }

  return (
    <MailWorkspaceProvider>
      <div className="container space-y-4 py-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/email">
              <ArrowLeft className="mr-2 h-4 w-4" />
              Posteingang
            </Link>
          </Button>
          <div className="flex items-center gap-2">
            <Settings className="h-5 w-5 text-primary" />
            <h1 className="text-xl font-semibold tracking-tight">
              E-Mail-Einstellungen
            </h1>
          </div>
        </div>
        <SettingsPanelsPage />
      </div>
    </MailWorkspaceProvider>
  )
}
