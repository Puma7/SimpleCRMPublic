"use client"

import { useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { hasElectron, invokeIpc } from "../types"

type ExportResult = { ok: true; path: string } | { ok: false; error: string }

export function ExportPanel() {
  const [running, setRunning] = useState(false)

  const run = async (skipAttachments: boolean) => {
    if (!hasElectron()) return
    setRunning(true)
    try {
      const r = await invokeIpc<ExportResult>(
        IPCChannels.Email.EmailGdprExport,
        skipAttachments ? { skipAttachments: true } : undefined,
      )
      if (r.ok) {
        toast.success(
          skipAttachments ? `Export (ohne Anhänge): ${r.path}` : `Export: ${r.path}`,
        )
      } else if (r.error !== "Abgebrochen") {
        toast.error(r.error ?? "Export fehlgeschlagen")
      }
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Datenexport (DSGVO-Hilfe)</h3>
        <p className="text-sm text-muted-foreground">
          ZIP mit Metadaten (ohne Passwörter/Keytar-Einträge). Der Ordner „attachments" enthält gespeicherte Anhänge.
          Kein vollständiges Rohmail-Archiv.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="secondary"
          disabled={running}
          onClick={() => void run(false)}
        >
          {running ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          ZIP mit Anhängen…
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={running}
          onClick={() => void run(true)}
        >
          ZIP nur Metadaten…
        </Button>
      </div>
    </div>
  )
}
