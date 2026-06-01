"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { ClipboardCopy, FileSearch, HardDriveDownload, Loader2, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { hasElectron, invokeIpc } from "../types"

type DiagnosticsReport = {
  collectedAt: string
  schemaGeneration: number
  schemaGenerationLabel: string
  sizes: { databaseBytes: number | null; attachmentsBytes: number }
  messages: {
    total: number
    pendingPostProcess: number
    outboundHold: number
    byFolderKind: Record<string, number>
  }
  workflows: {
    runsLast24h: number
    runsBlockedLast24h: number
    runsErrorLast24h: number
  }
  notices: { imapAuth: number; uidValidity: number }
  syncInfo: { totalKeys: number; prefixes: Record<string, number> }
  background: {
    cronScheduled: boolean
    cronTickInFlight: boolean
    syncInFlightAccountIds: number[]
    idleImapAccountIds: number[]
  }
  accounts: {
    id: number
    email: string
    protocol: string
    inboxLastSyncedAt: string | null
  }[]
}

function formatBytes(n: number | null): string {
  if (n == null) return "—"
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

export function DiagnosticsPanel() {
  const [report, setReport] = useState<DiagnosticsReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [backupRunning, setBackupRunning] = useState(false)
  const [verifyRunning, setVerifyRunning] = useState(false)

  const load = useCallback(async () => {
    if (!hasElectron()) return
    setLoading(true)
    try {
      const r = await invokeIpc<DiagnosticsReport>(IPCChannels.Email.GetMailDiagnostics)
      setReport(r)
    } catch {
      toast.error("Diagnose konnte nicht geladen werden.")
      setReport(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const copyJson = async () => {
    if (!report) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2))
      toast.success("Diagnose in Zwischenablage kopiert.")
    } catch {
      toast.error("Kopieren fehlgeschlagen.")
    }
  }

  const runVerify = async () => {
    if (!hasElectron()) return
    setVerifyRunning(true)
    try {
      const r = await invokeIpc<
        | {
            ok: true
            path: string
            schemaGeneration?: number
            schemaGenerationLabel?: string
            exportedAt?: string
            hasAttachments: boolean
          }
        | { ok: false; error: string }
      >(IPCChannels.Email.VerifyLocalMailBackup)
      if (r.ok) {
        const parts = [
          `Backup OK: ${r.path}`,
          r.schemaGenerationLabel
            ? `Schema ${r.schemaGeneration} (${r.schemaGenerationLabel})`
            : null,
          r.exportedAt
            ? `Export: ${new Date(r.exportedAt).toLocaleString("de-DE")}`
            : null,
          r.hasAttachments ? "mit Anhängen" : "ohne Anhänge",
        ].filter(Boolean)
        toast.success(parts.join(" · "))
      } else if (r.error !== "Abgebrochen") {
        toast.error(r.error)
      }
    } finally {
      setVerifyRunning(false)
    }
  }

  const runBackup = async () => {
    if (!hasElectron()) return
    setBackupRunning(true)
    try {
      const r = await invokeIpc<{ ok: true; path: string } | { ok: false; error: string }>(
        IPCChannels.Email.ExportLocalMailBackup,
      )
      if (r.ok) {
        toast.success(`Vollbackup gespeichert: ${r.path}`)
      } else if (r.error !== "Abgebrochen") {
        toast.error(r.error)
      }
    } finally {
      setBackupRunning(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Diagnose & Backup</h3>
        <p className="text-sm text-muted-foreground">
          Support-Übersicht für Sync, Datenbank und Workflows. Vollbackup enthält{" "}
          <code className="text-xs">database.sqlite</code> und Anhänge —{" "}
          <strong>ohne</strong> Passwörter/OAuth aus dem Schlüsselbund. Restore: siehe{" "}
          <code className="text-xs">docs/MAIL_BETA_PHASE3_PLAN.md</code>.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={() => void load()}>
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          Aktualisieren
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!report}
          onClick={() => void copyJson()}
        >
          <ClipboardCopy className="mr-2 h-4 w-4" />
          JSON kopieren
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={backupRunning}
          onClick={() => void runBackup()}
        >
          {backupRunning ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <HardDriveDownload className="mr-2 h-4 w-4" />
          )}
          Vollbackup (ZIP)…
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={verifyRunning}
          onClick={() => void runVerify()}
        >
          {verifyRunning ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <FileSearch className="mr-2 h-4 w-4" />
          )}
          Backup prüfen…
        </Button>
      </div>

      {!report && !loading ? (
        <p className="text-sm text-muted-foreground">Keine Diagnosedaten.</p>
      ) : null}

      {report ? (
        <div className="space-y-4 rounded-lg border bg-muted/20 p-4 text-sm">
          <p className="text-xs text-muted-foreground">
            Stand: {new Date(report.collectedAt).toLocaleString("de-DE")} · Schema{" "}
            {report.schemaGeneration} ({report.schemaGenerationLabel})
          </p>

          <section>
            <h4 className="font-medium">Speicher</h4>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              <li>Datenbank: {formatBytes(report.sizes.databaseBytes)}</li>
              <li>Anhänge: {formatBytes(report.sizes.attachmentsBytes)}</li>
            </ul>
          </section>

          <section>
            <h4 className="font-medium">Nachrichten</h4>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              <li>Gesamt: {report.messages.total}</li>
              <li>Post-Process ausstehend: {report.messages.pendingPostProcess}</li>
              <li>Outbound-Hold: {report.messages.outboundHold}</li>
            </ul>
          </section>

          <section>
            <h4 className="font-medium">Sync (Hintergrund)</h4>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              <li>Cron aktiv: {report.background.cronScheduled ? "ja" : "nein"}</li>
              <li>Cron-Tick läuft: {report.background.cronTickInFlight ? "ja" : "nein"}</li>
              <li>Sync läuft für Konten:{" "}
                {report.background.syncInFlightAccountIds.length
                  ? report.background.syncInFlightAccountIds.join(", ")
                  : "—"}
              </li>
              <li>IMAP IDLE verbunden:{" "}
                {report.background.idleImapAccountIds.length
                  ? report.background.idleImapAccountIds.join(", ")
                  : "—"}
              </li>
            </ul>
          </section>

          <section>
            <h4 className="font-medium">Hinweise</h4>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              <li>Auth-Fehler (Banner): {report.notices.imapAuth}</li>
              <li>UIDVALIDITY: {report.notices.uidValidity}</li>
            </ul>
          </section>

          <section>
            <h4 className="font-medium">Workflows (24 h)</h4>
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              <li>Läufe: {report.workflows.runsLast24h}</li>
              <li>Blockiert: {report.workflows.runsBlockedLast24h}</li>
              <li>Fehler: {report.workflows.runsErrorLast24h}</li>
            </ul>
          </section>

          <section>
            <h4 className="font-medium">Konten</h4>
            <ul className="mt-1 space-y-1 text-muted-foreground">
              {report.accounts.map((a) => (
                <li key={a.id}>
                  #{a.id} {a.email} ({a.protocol}) — INBOX zuletzt:{" "}
                  {a.inboxLastSyncedAt
                    ? new Date(a.inboxLastSyncedAt).toLocaleString("de-DE")
                    : "nie"}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h4 className="font-medium">sync_info ({report.syncInfo.totalKeys} Keys)</h4>
            <pre className="mt-1 max-h-32 overflow-auto rounded bg-background p-2 text-[10px]">
              {JSON.stringify(report.syncInfo.prefixes, null, 2)}
            </pre>
          </section>
        </div>
      ) : null}
    </div>
  )
}
