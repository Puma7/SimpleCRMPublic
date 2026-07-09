"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { Link } from "@tanstack/react-router"
import { IPCChannels } from "@shared/ipc/channels"
import { MAINTENANCE_HARD_RESET_PHRASE } from "@shared/maintenance"
import {
  AlertTriangle,
  Download,
  Loader2,
  RefreshCw,
  ShieldAlert,
  Stethoscope,
  Trash2,
  Wrench,
} from "lucide-react"
import { toast } from "sonner"

import { useAuth } from "@/components/auth/auth-context"
import { hasLocalIpc } from "@/components/email/types"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { isServerClientMode } from "@/lib/runtime-mode"
import { invokeRenderer } from "@/services/transport"

type DoctorCheck = {
  name: string
  status: "ok" | "warn" | "fail"
  message: string
}

type DoctorResult = {
  status: "ok" | "warn" | "fail"
  checks: DoctorCheck[]
}

type MaintenanceStatus = {
  edition?: string
  appVersion?: string
  needsInitialSetup?: boolean
}

function formatBytes(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—"
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

export function MaintenancePanel() {
  const { user, loading: authLoading } = useAuth()
  const serverClientMode = isServerClientMode()
  const desktopStandalone = hasLocalIpc() && !serverClientMode
  const isAdmin = user?.role === "owner" || user?.role === "admin"
  const isOwner = user?.role === "owner"

  const [status, setStatus] = useState<MaintenanceStatus | null>(null)
  const [doctor, setDoctor] = useState<DoctorResult | null>(null)
  const [migrationSummary, setMigrationSummary] = useState<{ pendingCount?: number; appliedCount?: number } | null>(null)
  const [resetPreview, setResetPreview] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [updateStatus, setUpdateStatus] = useState<{ status?: string; error?: string } | null>(null)

  const [acknowledgeDataLoss, setAcknowledgeDataLoss] = useState(false)
  const [confirmPhrase, setConfirmPhrase] = useState("")

  const loadStatus = useCallback(async () => {
    try {
      const next = await invokeRenderer(IPCChannels.Maintenance.GetStatus) as MaintenanceStatus
      setStatus(next)
    } catch (error) {
      console.error(error)
    }
  }, [])

  useEffect(() => {
    if (!authLoading && isAdmin) void loadStatus()
  }, [authLoading, isAdmin, loadStatus])

  const serverUpgradeHint = useMemo(() => (
    `cd docker\nsh ./simplecrm up --build\nsh ./simplecrm doctor`
  ), [])

  if (authLoading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Wartungsmodus wird geladen…
      </div>
    )
  }

  if (!isAdmin) {
    return (
      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Keine Berechtigung</AlertTitle>
        <AlertDescription>
          Wartungsfunktionen sind nur für Owner und Admin verfügbar.
        </AlertDescription>
      </Alert>
    )
  }

  const runDoctor = async () => {
    setBusy("doctor")
    setDoctor(null)
    try {
      const result = await invokeRenderer(IPCChannels.Maintenance.RunDoctor) as DoctorResult
      setDoctor(result)
      toast.success("Diagnose abgeschlossen")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Diagnose fehlgeschlagen")
    } finally {
      setBusy(null)
    }
  }

  const checkMigrations = async () => {
    setBusy("migrations-check")
    try {
      const result = await invokeRenderer(IPCChannels.Maintenance.CheckMigrations) as {
        pendingCount: number
        appliedCount: number
      }
      setMigrationSummary(result)
      toast.success("Migrationsstand geprüft")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Migrationsprüfung fehlgeschlagen")
    } finally {
      setBusy(null)
    }
  }

  const runRepair = async () => {
    setBusy("repair")
    try {
      if (serverClientMode) {
        await invokeRenderer(IPCChannels.Maintenance.RunRepair)
        toast.success("Ausstehende Migrationen wurden angewendet")
        await loadStatus()
      } else {
        const result = await invokeRenderer(IPCChannels.Maintenance.RunRepair) as { message?: string }
        toast.success(result.message ?? "Reparatur abgeschlossen")
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reparatur fehlgeschlagen")
    } finally {
      setBusy(null)
    }
  }

  const loadResetPreview = async () => {
    setBusy("reset-preview")
    try {
      const preview = await invokeRenderer(IPCChannels.Maintenance.PreviewHardReset) as Record<string, unknown>
      setResetPreview(preview)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Reset-Vorschau fehlgeschlagen")
    } finally {
      setBusy(null)
    }
  }

  const executeReset = async () => {
    if (!acknowledgeDataLoss) {
      toast.error("Bitte den vollständigen Datenverlust bestätigen.")
      return
    }
    if (confirmPhrase.trim() !== MAINTENANCE_HARD_RESET_PHRASE) {
      toast.error(`Bitte „${MAINTENANCE_HARD_RESET_PHRASE}" exakt eingeben.`)
      return
    }
    setBusy("reset")
    try {
      const result = await invokeRenderer(IPCChannels.Maintenance.ExecuteHardReset, {
        confirmPhrase: confirmPhrase.trim(),
        acknowledgeDataLoss: true,
      }) as { ok?: boolean; error?: string; success?: boolean }
      if (result.ok === false && result.error) {
        toast.error(result.error)
        return
      }
      toast.success(serverClientMode
        ? "Komplett-Reset abgeschlossen. Bitte erneut einrichten."
        : "Komplett-Reset läuft — App startet neu.")
      if (serverClientMode) {
        window.location.href = "/login"
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Komplett-Reset fehlgeschlagen")
    } finally {
      setBusy(null)
    }
  }

  const checkUpdates = async () => {
    setBusy("update-check")
    try {
      const result = await invokeRenderer(IPCChannels.Maintenance.CheckForUpdates) as {
        success?: boolean
        status?: { status?: string; error?: string }
        error?: string
      }
      setUpdateStatus(result.status ?? { status: result.success ? "not-available" : "error", error: result.error })
      toast.success("Update-Status aktualisiert")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update-Prüfung fehlgeschlagen")
    } finally {
      setBusy(null)
    }
  }

  const installUpdate = async () => {
    setBusy("update-install")
    try {
      await invokeRenderer(IPCChannels.Maintenance.InstallUpdate)
      toast.success("Update wird installiert — App startet neu.")
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Update-Installation fehlgeschlagen")
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Wartung</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Aktualisieren, reparieren oder das System auf Werkseinstellung zurücksetzen — ohne versehentliche Datenverluste.
        </p>
        {status?.appVersion ? (
          <p className="text-xs text-muted-foreground mt-2">Version {status.appVersion}</p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Download className="h-5 w-5" />
            Aktualisieren
          </CardTitle>
          <CardDescription>
            App- und Schema-Updates ohne Datenverlust. Bestehende Kunden, E-Mails und Einstellungen bleiben erhalten.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {desktopStandalone ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="secondary" disabled={busy != null} onClick={() => void checkUpdates()}>
                {busy === "update-check" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
                Nach Updates suchen
              </Button>
              <Button type="button" disabled={busy != null} onClick={() => void installUpdate()}>
                Neustart &amp; Aktualisieren
              </Button>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">
                Die Server-Edition wird auf dem Host aktualisiert (Docker Compose). Daten bleiben in den Volumes erhalten.
              </p>
              <pre className="rounded-md border bg-muted/40 p-3 text-xs overflow-x-auto">{serverUpgradeHint}</pre>
            </div>
          )}
          {updateStatus?.status ? (
            <p className="text-sm text-muted-foreground">Update-Status: {updateStatus.status}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Stethoscope className="h-5 w-5" />
            Reparieren
          </CardTitle>
          <CardDescription>
            Diagnose, Schema-Migrationen und Integritätsprüfungen — alle Daten bleiben erhalten.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {serverClientMode ? (
              <>
                <Button type="button" variant="secondary" disabled={busy != null} onClick={() => void runDoctor()}>
                  {busy === "doctor" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Diagnose (Doctor)
                </Button>
                <Button type="button" variant="secondary" disabled={busy != null} onClick={() => void checkMigrations()}>
                  {busy === "migrations-check" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Migrationen prüfen
                </Button>
              </>
            ) : null}
            <Button type="button" disabled={busy != null} onClick={() => void runRepair()}>
              {busy === "repair" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Wrench className="h-4 w-4 mr-2" />}
              Reparatur starten
            </Button>
          </div>

          {doctor ? (
            <div className="rounded-md border p-3 space-y-2">
              <p className="text-sm font-medium">Diagnose: {doctor.status.toUpperCase()}</p>
              <ul className="text-sm space-y-1">
                {doctor.checks.map((check) => (
                  <li key={check.name} className="flex gap-2">
                    <span className="font-mono text-xs uppercase w-12 shrink-0">{check.status}</span>
                    <span>{check.name}: {check.message}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {migrationSummary ? (
            <p className="text-sm text-muted-foreground">
              Migrationen: {migrationSummary.appliedCount ?? 0} angewendet, {migrationSummary.pendingCount ?? 0} ausstehend
            </p>
          ) : null}

          {!serverClientMode ? (
            <p className="text-sm text-muted-foreground">
              Lokale Backups und Wiederherstellung:{" "}
              <Link to="/email/settings" search={{ tab: "diagnostics" }} className="underline">
                E-Mail → Einstellungen → Diagnose &amp; Backup
              </Link>
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-destructive/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg text-destructive">
            <Trash2 className="h-5 w-5" />
            Neu installieren (Komplett-Reset)
          </CardTitle>
          <CardDescription>
            Löscht alle Anwendungsdaten unwiderruflich und setzt das System auf den Erstinstallationszustand zurück.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!isOwner ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Nur für Owner</AlertTitle>
              <AlertDescription>
                Ein Komplett-Reset kann nur vom Workspace-Owner ausgeführt werden.
              </AlertDescription>
            </Alert>
          ) : (
            <>
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Unwiderruflicher Datenverlust</AlertTitle>
                <AlertDescription>
                  {serverClientMode
                    ? "Alle Workspaces, Benutzer, E-Mails, Anhänge und Geheimnisse werden gelöscht. Erstellen Sie vorher ein Backup."
                    : "Datenbank, Anhänge und Logs auf diesem Rechner werden gelöscht. Erstellen Sie vorher ein Backup unter Diagnose & Backup."}
                </AlertDescription>
              </Alert>

              <Button type="button" variant="outline" disabled={busy != null} onClick={() => void loadResetPreview()}>
                {busy === "reset-preview" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Vorschau laden
              </Button>

              {resetPreview ? (
                <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm space-y-1">
                  {serverClientMode ? (
                    <>
                      <p>Betroffene Tabellen: {String(resetPreview.tableCount ?? "—")}</p>
                      <p>Anhänge: {String(resetPreview.attachmentsRoot ?? "—")}</p>
                    </>
                  ) : (
                    <>
                      <p>Datenbank: {String((resetPreview as any).databasePath ?? "—")} ({formatBytes((resetPreview as any).databaseSizeBytes)})</p>
                      <p>Anhänge: {String((resetPreview as any).paths?.attachmentsPath ?? "—")}</p>
                    </>
                  )}
                </div>
              ) : null}

              <div className="flex items-start gap-2">
                <Checkbox
                  id="maintenance-ack-reset"
                  checked={acknowledgeDataLoss}
                  onCheckedChange={(value) => setAcknowledgeDataLoss(value === true)}
                />
                <Label htmlFor="maintenance-ack-reset" className="text-sm leading-snug">
                  Ich verstehe, dass alle CRM- und E-Mail-Daten unwiderruflich gelöscht werden.
                </Label>
              </div>

              <div className="space-y-2">
                <Label htmlFor="maintenance-reset-phrase">
                  Zur Bestätigung „{MAINTENANCE_HARD_RESET_PHRASE}" eingeben
                </Label>
                <Input
                  id="maintenance-reset-phrase"
                  value={confirmPhrase}
                  onChange={(event) => setConfirmPhrase(event.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>

              <Button
                type="button"
                variant="destructive"
                disabled={busy != null || !acknowledgeDataLoss || confirmPhrase.trim() !== MAINTENANCE_HARD_RESET_PHRASE}
                onClick={() => void executeReset()}
              >
                {busy === "reset" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Komplett-Reset ausführen
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
