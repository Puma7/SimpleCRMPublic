"use client"

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Info } from "lucide-react"
import { useMailWorkspace } from "../workspace-context"

/** @deprecated Ticket/Namespace moved to Konten → Erweitert. */
export function AccountMailSettingsPanel() {
  const { setSettingsTab } = useMailWorkspace()

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Konto-Details</h3>
        <p className="text-sm text-muted-foreground">
          Ticket-Nummern und Thread-Namespace sind jetzt direkt unter dem jeweiligen Postfach.
        </p>
      </div>
      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Umgezogen nach Konten → Erweitert</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            Öffnen Sie <strong>Konten &amp; Versand → Konten</strong>, wählen Sie ein Postfach und
            den Tab <strong>Erweitert</strong>.
          </p>
          <button
            type="button"
            className="text-sm font-medium text-primary underline-offset-4 hover:underline"
            onClick={() => setSettingsTab("accounts")}
          >
            Zu Konten wechseln
          </button>
        </AlertDescription>
      </Alert>
    </div>
  )
}
