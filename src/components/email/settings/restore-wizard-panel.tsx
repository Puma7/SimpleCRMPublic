"use client"

import { useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { AlertTriangle, FolderOpen, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { hasElectron, invokeIpc } from "../types"

const CONFIRM_PHRASE = "WIEDERHERSTELLEN"

type Preview = {
  path: string
  previewToken: string
  schemaGeneration?: number
  schemaGenerationLabel?: string
  currentSchemaGeneration: number
  exportedAt?: string
  hasAttachments: boolean
  accountEmails: string[]
  warnings: string[]
}

export function RestoreWizardPanel() {
  const [zipPath, setZipPath] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [confirmPhrase, setConfirmPhrase] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const [createPreBackup, setCreatePreBackup] = useState(true)
  const [picking, setPicking] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const pickZip = async () => {
    if (!hasElectron()) return
    setPicking(true)
    try {
      const r = await invokeIpc<{ ok: true; path: string } | { ok: false; error: string }>(
        IPCChannels.Email.PickLocalMailBackupZip,
      )
      if (r.ok) {
        setZipPath(r.path)
        setPreview(null)
        setConfirmPhrase("")
        setAcknowledged(false)
      } else if (r.error !== "Abgebrochen") {
        toast.error(r.error)
      }
    } finally {
      setPicking(false)
    }
  }

  const runPreview = async () => {
    if (!hasElectron() || !zipPath) return
    setPreviewing(true)
    setPreview(null)
    try {
      const r = await invokeIpc<
        | ({ ok: true } & Preview)
        | { ok: false; error: string }
      >(IPCChannels.Email.PreviewRestoreLocalMailBackup, { zipPath })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      setPreview({
        path: r.path,
        previewToken: r.previewToken,
        schemaGeneration: r.schemaGeneration,
        schemaGenerationLabel: r.schemaGenerationLabel,
        currentSchemaGeneration: r.currentSchemaGeneration,
        exportedAt: r.exportedAt,
        hasAttachments: r.hasAttachments,
        accountEmails: r.accountEmails,
        warnings: r.warnings,
      })
    } finally {
      setPreviewing(false)
    }
  }

  const runRestore = async () => {
    if (!hasElectron() || !preview || !zipPath) return
    if (!acknowledged) {
      toast.error("Bitte die Risiken bestätigen.")
      return
    }
    if (confirmPhrase.trim() !== CONFIRM_PHRASE) {
      toast.error(`Bitte „${CONFIRM_PHRASE}“ eingeben.`)
      return
    }
    setRestoring(true)
    try {
      const r = await invokeIpc<
        | { ok: true; preBackupPath?: string }
        | { ok: false; error: string }
      >(IPCChannels.Email.RestoreLocalMailBackup, {
        zipPath,
        previewToken: preview.previewToken,
        confirmPhrase: confirmPhrase.trim(),
        createPreBackup,
      })
      if (!r.ok) {
        toast.error(r.error)
        return
      }
      toast.success(
        r.preBackupPath
          ? `Wiederherstellung läuft — App startet neu. Sicherung: ${r.preBackupPath}`
          : "Wiederherstellung läuft — App startet neu.",
      )
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-4">
      <div className="flex gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Vollbackup wiederherstellen</p>
          <p className="text-xs text-muted-foreground">
            Ersetzt <code className="text-[10px]">database.sqlite</code> und{" "}
            <code className="text-[10px]">email-attachments/</code> in Ihrem lokalen
            SimpleCRM-Datenordner. Betrifft CRM- und Mail-Daten. Passwörter/API-Keys müssen danach
            ggf. neu gesetzt werden.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={picking} onClick={() => void pickZip()}>
          {picking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderOpen className="mr-2 h-4 w-4" />}
          ZIP wählen…
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          disabled={!zipPath || previewing}
          onClick={() => void runPreview()}
        >
          {previewing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Vorschau prüfen
        </Button>
      </div>

      {zipPath ? (
        <p className="truncate text-xs font-mono text-muted-foreground">{zipPath}</p>
      ) : null}

      {preview ? (
        <div className="space-y-3 rounded-md border bg-background/80 p-3 text-sm">
          {preview.exportedAt ? (
            <p>
              Export:{" "}
              <span className="text-muted-foreground">
                {new Date(preview.exportedAt).toLocaleString("de-DE")}
              </span>
            </p>
          ) : null}
          <p>
            Schema: {preview.schemaGeneration ?? "—"} ({preview.schemaGenerationLabel ?? "?"}) ·
            App: {preview.currentSchemaGeneration}
          </p>
          <p>Anhänge im Backup: {preview.hasAttachments ? "ja" : "nein"}</p>
          {preview.accountEmails.length > 0 ? (
            <p>Konten im Backup: {preview.accountEmails.join(", ")}</p>
          ) : null}
          <ul className="list-inside list-disc text-xs text-muted-foreground">
            {preview.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <Checkbox
              id="pre-backup"
              checked={createPreBackup}
              onCheckedChange={(v) => setCreatePreBackup(v === true)}
            />
            <Label htmlFor="pre-backup" className="text-xs font-normal">
              Automatisches Sicherheits-Backup vor Restore (empfohlen)
            </Label>
          </div>

          <div className="flex items-start gap-2">
            <Checkbox
              id="restore-ack"
              checked={acknowledged}
              onCheckedChange={(v) => setAcknowledged(v === true)}
            />
            <Label htmlFor="restore-ack" className="text-xs font-normal leading-snug">
              Ich verstehe, dass die aktuelle lokale Datenbank überschrieben wird und die App
              danach neu startet.
            </Label>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">
              Zur Bestätigung <strong>{CONFIRM_PHRASE}</strong> eingeben
            </Label>
            <Input
              value={confirmPhrase}
              onChange={(e) => setConfirmPhrase(e.target.value)}
              className="h-9 font-mono text-sm"
              autoComplete="off"
            />
          </div>

          <Button
            type="button"
            variant="destructive"
            size="sm"
            disabled={restoring}
            onClick={() => void runRestore()}
          >
            {restoring ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Jetzt wiederherstellen
          </Button>
        </div>
      ) : null}
    </div>
  )
}
