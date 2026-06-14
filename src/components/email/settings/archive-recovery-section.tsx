"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { invokeRenderer } from "@/services/transport"
import { type EmailAccount } from "../types"
import { logError } from "../log"

type RecoveryPreview = {
  accountId: number
  count: number
  accountEmail: string
  accountLabel: string
}

export function ArchiveRecoverySection() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [accountId, setAccountId] = useState<number | null>(null)
  const [preview, setPreview] = useState<RecoveryPreview | null>(null)
  const [confirmPhrase, setConfirmPhrase] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const loadAccounts = useCallback(async () => {
    try {
      const list = await invokeRenderer(IPCChannels.Email.ListAccounts) as EmailAccount[]
      setAccounts(list)
      if (list.length > 0 && accountId == null) {
        setAccountId(list[0]!.id)
      }
    } catch (e) {
      logError("archive-recovery: load accounts", e)
      toast.error("Konten konnten nicht geladen werden.")
    }
  }, [accountId])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts])

  const resetConfirmation = () => {
    setPreview(null)
    setConfirmPhrase("")
    setAcknowledged(false)
  }

  const runPreview = async () => {
    if (accountId == null) return
    setLoadingPreview(true)
    resetConfirmation()
    try {
      const r = await invokeRenderer(
        IPCChannels.Email.PreviewRestoreInboxFromArchive,
        accountId,
      ) as
        | ({ success: true } & RecoveryPreview)
        | { success: false; error?: string }
      if (!r.success) {
        toast.error(r.error ?? "Vorschau fehlgeschlagen.")
        return
      }
      setPreview({
        accountId: r.accountId,
        count: r.count,
        accountEmail: r.accountEmail,
        accountLabel: r.accountLabel,
      })
      if (r.count === 0) {
        toast.message("Keine betroffenen Nachrichten gefunden.")
      }
    } catch (e) {
      logError("archive-recovery: preview", e)
      toast.error(e instanceof Error ? e.message : "Vorschau fehlgeschlagen.")
    } finally {
      setLoadingPreview(false)
    }
  }

  const runRestore = async () => {
    if (!preview || accountId == null) return
    if (!acknowledged) {
      toast.error("Bitte die Risiken bestätigen.")
      return
    }
    if (confirmPhrase.trim().toLowerCase() !== preview.accountEmail.trim().toLowerCase()) {
      toast.error("E-Mail-Adresse stimmt nicht mit dem Konto überein.")
      return
    }
    setRestoring(true)
    try {
      const r = await invokeRenderer(
        IPCChannels.Email.RestoreInboxFromArchive,
        {
          accountId: preview.accountId,
          expectedCount: preview.count,
          confirmPhrase: confirmPhrase.trim(),
        },
      ) as
        { success: true; restored: number } | { success: false; error?: string }
      if (!r.success) {
        toast.error(r.error ?? "Wiederherstellung fehlgeschlagen.")
        return
      }
      toast.success(
        r.restored > 0
          ? `${r.restored} Nachricht(en) zurück in den Posteingang geholt.`
          : "Keine Nachrichten geändert.",
      )
      resetConfirmation()
      await runPreview()
    } catch (e) {
      logError("archive-recovery: restore", e)
      toast.error(e instanceof Error ? e.message : "Wiederherstellung fehlgeschlagen.")
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-4">
      <div className="flex gap-2">
        <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
        <div className="space-y-1">
          <p className="text-sm font-medium">Archivierte Posteingangs-Mails zurückholen</p>
          <p className="text-xs text-muted-foreground">
            Setzt bei <strong>einem Konto</strong> SimpleCRM-interne Nachrichten von{" "}
            <code className="text-[10px]">archiviert</code> auf Posteingang zurück, wenn sie
            ursprünglich zum Posteingang gehörten. Betrifft nicht Papierkorb oder Spam.
          </p>
        </div>
      </div>

      {accounts.length === 0 ? (
        <p className="text-sm text-muted-foreground">Kein E-Mail-Konto vorhanden.</p>
      ) : (
        <>
          <div className="space-y-1.5">
            <Label>Konto</Label>
            <Select
              value={accountId != null ? String(accountId) : undefined}
              onValueChange={(v) => {
                setAccountId(Number(v))
                resetConfirmation()
              }}
            >
              <SelectTrigger>
                <SelectValue placeholder="Konto wählen" />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={String(a.id)}>
                    {a.display_name} ({a.email_address})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <Button
            type="button"
            variant="secondary"
            disabled={loadingPreview || accountId == null}
            onClick={() => void runPreview()}
          >
            {loadingPreview ? "Vorschau…" : "1. Vorschau (Anzahl prüfen)"}
          </Button>

          {preview ? (
            <div className="space-y-3 rounded-md border bg-background/80 p-3">
              <p className="text-sm">
                <strong>{preview.count}</strong> Nachricht(en) bei „{preview.accountLabel}" würden
                in den Posteingang zurückgeholt.
              </p>
              {preview.count > 0 ? (
                <>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="ack-recovery"
                      checked={acknowledged}
                      onCheckedChange={(v) => setAcknowledged(v === true)}
                    />
                    <Label htmlFor="ack-recovery" className="text-xs font-normal leading-snug">
                      Ich verstehe, dass diese Aktion nicht rückgängig gemacht wird.
                    </Label>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="confirm-email" className="text-xs">
                      2. Zur Bestätigung die Konto-E-Mail exakt eingeben:{" "}
                      <span className="font-mono">{preview.accountEmail}</span>
                    </Label>
                    <Input
                      id="confirm-email"
                      value={confirmPhrase}
                      onChange={(e) => setConfirmPhrase(e.target.value)}
                      placeholder={preview.accountEmail}
                      autoComplete="off"
                    />
                  </div>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={restoring || !acknowledged || !confirmPhrase.trim()}
                    onClick={() => void runRestore()}
                  >
                    {restoring ? "Wird ausgeführt…" : "3. Wiederherstellen"}
                  </Button>
                </>
              ) : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  )
}
