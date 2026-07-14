"use client"

import { useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { getRendererTransport } from "@/services/transport"
import { hasLocalIpc, invokeIpc } from "../types"

type ExportResult = { ok: true; path: string } | { ok: false; error: string }
type ServerExportResult = { ok: true; blob: Blob; filename: string; contentType?: string | null }

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

function exportErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Export fehlgeschlagen"
}

export function ExportPanel() {
  const [running, setRunning] = useState(false)
  const [includeSensitiveTracking, setIncludeSensitiveTracking] = useState(false)
  const transport = getRendererTransport()
  const isServerExport = transport.kind === "http" && Boolean(transport.serverBaseUrl)

  const run = async (skipAttachments: boolean) => {
    if (!hasLocalIpc() && transport.kind !== "http") return
    setRunning(true)
    try {
      if (transport.kind === "http" && transport.serverBaseUrl) {
        const result = await transport.invoke(
          IPCChannels.Email.EmailGdprExport,
          skipAttachments || includeSensitiveTracking
            ? {
                ...(skipAttachments ? { skipAttachments: true } : {}),
                ...(includeSensitiveTracking ? { includeSensitiveTracking: true } : {}),
              }
            : undefined,
        ) as ServerExportResult
        downloadBlob(
          result.blob,
          result.filename,
        )
        toast.success(skipAttachments ? "Export ohne Anhaenge heruntergeladen." : "Export heruntergeladen.")
        return
      }

      if (transport.kind === "http") {
        toast.error("Server-URL fehlt. Export wurde nicht gestartet.")
        return
      }

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
    } catch (error) {
      toast.error(exportErrorMessage(error))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-base font-semibold">Datenexport (DSGVO-Hilfe)</h3>
        <p className="text-sm text-muted-foreground">
          ZIP mit Metadaten (ohne Passwörter/Secret-Einträge). Der Ordner „attachments" enthält gespeicherte Anhänge.
          Kein vollständiges Rohmail-Archiv. Technische Vollbackups laufen im Standalone-Modus lokal und im Servermodus über den Serverbetrieb. Siehe Tab{" "}
          <strong>Diagnose</strong>.
        </p>
      </div>
      {isServerExport ? (
        <div className="flex items-start gap-2">
          <Checkbox
            id="gdpr-export-sensitive-tracking"
            checked={includeSensitiveTracking}
            disabled={running}
            onCheckedChange={(checked) => setIncludeSensitiveTracking(checked === true)}
          />
          <Label htmlFor="gdpr-export-sensitive-tracking" className="text-sm font-normal leading-5">
            Sensible Tracking-Rohdaten einschließen (entschlüsselte IP-Adressen, User-Agents und Klickziele; nur für Admins).
          </Label>
        </div>
      ) : null}
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
