"use client"

import { Link } from "@tanstack/react-router"
import { Lock } from "lucide-react"

/**
 * Steht anstelle jeder CRM-Seite, wenn der Gruppe die CRM-Stufe „Keins"
 * zugewiesen ist. Bewusst ein Hinweis statt einer Weiterleitung: eine
 * Umleitung auf /email waere fuer Nutzer ohne Postfach eine Schleife.
 */
export function CrmAccessNotice() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 bg-background p-8 text-center">
      <Lock className="h-6 w-6 text-muted-foreground" />
      <h1 className="text-lg font-semibold tracking-tight">CRM</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Für diesen Bereich fehlt die Berechtigung „CRM ansehen“. Wenden Sie sich an eine
        Administratorin oder einen Administrator.
      </p>
      <Link
        to="/email"
        className="text-sm font-medium text-primary underline-offset-4 hover:underline"
      >
        Zum E-Mail-Modul
      </Link>
    </div>
  )
}
