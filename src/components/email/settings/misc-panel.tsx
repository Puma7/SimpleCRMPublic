"use client"

import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { IPCChannels } from "@shared/ipc/channels"
import { getRendererTransport, invokeRenderer } from "@/services/transport"
import { logError } from "../log"
import { SnoozeSettingsSection } from "./snooze-settings-section"

export function MiscPanel() {
  // The thread backfill is a server-edition feature (Postgres reference resolver);
  // there is no local IPC/SQLite handler, so only surface it in server-client mode.
  const serverClientMode = getRendererTransport().kind === "http"
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

      {serverClientMode ? (
        <div className="space-y-3 rounded-lg border p-4">
          <h3 className="text-sm font-semibold">Threads nachziehen</h3>
          <p className="text-xs text-muted-foreground">
            Verthreadet bereits synchronisierte Alt-Mails nachträglich über
            Message-ID / In-Reply-To / References (einmaliger Batch). Neu
            synchronisierte Mails werden bereits automatisch verthreadet.
          </p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => {
              void invokeRenderer(
                IPCChannels.Email.BackfillThreads,
                { limit: 5000 },
              ).then((r) => {
                const result = r as { scanned: number; threaded: number }
                toast.success(`${result.threaded} von ${result.scanned} Mails verthreadet`)
              }).catch((e) => {
                logError("misc-panel: thread-backfill", e)
                toast.error("Thread-Backfill fehlgeschlagen.")
              })
            }}
          >
            Threads nachziehen
          </Button>
        </div>
      ) : null}
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
