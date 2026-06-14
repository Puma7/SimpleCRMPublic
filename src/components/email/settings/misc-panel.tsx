"use client"

import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { IPCChannels } from "@shared/ipc/channels"
import { invokeRenderer } from "@/services/transport"
import { logError } from "../log"
import { SnoozeSettingsSection } from "./snooze-settings-section"

export function MiscPanel() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Sonstiges</h3>
        <p className="text-sm text-muted-foreground">
          Wartungswerkzeuge und Kunden-Verknüpfungen. Archiv-Wiederherstellung:{" "}
          <strong>Diagnose</strong>. Snooze-Zeiten: eigener Tab <strong>Snooze</strong>. Webhook &
          Anhänge: <strong>Automatisierung</strong>.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">Kunden-Links</h3>
        <p className="text-xs text-muted-foreground">
          Verknüpft E-Mail-Adressen in Nachrichten mit CRM-Kunden (Batch).
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            void invokeRenderer(
              IPCChannels.Email.BackfillCustomerLinks,
              { limit: 500 },
            ).then((r) => {
              const result = r as { count: number }
              toast.success(`${result.count} Verknüpfungen gesetzt`)
            }).catch((e) => {
              logError("misc-panel: backfill", e)
              toast.error("Nachziehen fehlgeschlagen.")
            })
          }}
        >
          Kunden-Links nachziehen
        </Button>
      </div>
    </div>
  )
}

export function SnoozePanel() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Snooze</h3>
        <p className="text-sm text-muted-foreground">
          Vordefinierte „Später erinnern"-Zeiten in der Posteingangs-Ansicht (global für alle Konten).
        </p>
      </div>
      <SnoozeSettingsSection />
    </div>
  )
}
