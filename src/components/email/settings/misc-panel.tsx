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
import { hasElectron, invokeIpc, type EmailAccount } from "../types"
import { logError } from "../log"

type RecoveryPreview = {
  accountId: number
  count: number
  accountEmail: string
  accountLabel: string
}

export function MiscPanel() {
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [accountId, setAccountId] = useState<number | null>(null)
  const [preview, setPreview] = useState<RecoveryPreview | null>(null)
  const [confirmPhrase, setConfirmPhrase] = useState("")
  const [acknowledged, setAcknowledged] = useState(false)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [restoring, setRestoring] = useState(false)

  const loadAccounts = useCallback(async () => {
    if (!hasElectron()) return
    try {
      const list = await invokeIpc<EmailAccount[]>(IPCChannels.Email.ListAccounts)
      setAccounts(list)
      if (list.length > 0 && accountId == null) {
        setAccountId(list[0]!.id)
      }
    } catch (e) {
      logError("misc-panel: load accounts", e)
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
    if (!hasElectron() || accountId == null) return
    setLoadingPreview(true)
    resetConfirmation()
    try {
      const r = await invokeIpc<
        | ({ success: true } & RecoveryPreview)
        | { success: false; error?: string }
      >(IPCChannels.Email.PreviewRestoreInboxFromArchive, accountId)
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
      logError("misc-panel: preview", e)
      toast.error(e instanceof Error ? e.message : "Vorschau fehlgeschlagen.")
    } finally {
      setLoadingPreview(false)
    }
  }

  const runRestore = async () => {
    if (!hasElectron() || !preview || accountId == null) return
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
      const r = await invokeIpc<
        { success: true; restored: number } | { success: false; error?: string }
      >(IPCChannels.Email.RestoreInboxFromArchive, {
        accountId: preview.accountId,
        expectedCount: preview.count,
        confirmPhrase: confirmPhrase.trim(),
      })
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
      logError("misc-panel: restore", e)
      toast.error(e instanceof Error ? e.message : "Wiederherstellung fehlgeschlagen.")
    } finally {
      setRestoring(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Sonstiges</h3>
        <p className="text-sm text-muted-foreground">
          Spezialwerkzeuge für Ausnahmefälle. Nur verwenden, wenn Sie die Auswirkungen verstehen —
          Änderungen betreffen viele Nachrichten auf einmal.
        </p>
      </div>

      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 space-y-4">
        <div className="flex gap-2">
          <AlertTriangle className="h-5 w-5 shrink-0 text-destructive" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Archivierte Posteingangs-Mails zurückholen</p>
            <p className="text-xs text-muted-foreground">
              Setzt bei <strong>einem Konto</strong> lokale Nachrichten von{" "}
              <code className="text-[10px]">archiviert</code> auf Posteingang zurück, wenn sie
              ursprünglich zum Posteingang gehörten (z. B. nach fehlerhafter Workflow-Archivierung).
              Betrifft <strong>nicht</strong> Papierkorb, Spam oder bewusst archivierte Sendungen
              aus anderen Ordnern. Änderung nur lokal in SimpleCRM — nicht automatisch auf dem
              IMAP-Server.
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
                        Ich verstehe, dass diese Aktion nicht rückgängig gemacht wird und viele Mails
                        wieder im Posteingang erscheinen können.
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

      <div className="space-y-3 rounded-lg border p-4">
        <h3 className="text-sm font-semibold">E-Mail-Erweiterungen</h3>
        <MiscAdvancedSettings />
      </div>
    </div>
  )
}

function MiscAdvancedSettings() {
  const [webhookSecret, setWebhookSecret] = useState("")
  const [maxMb, setMaxMb] = useState("25")
  const [testSecret, setTestSecret] = useState("")

  useEffect(() => {
    if (!hasElectron()) return
    void invokeIpc<{ webhookSecret: string; maxAttachmentMb: string }>(
      IPCChannels.Email.GetEmailMiscSettings,
    ).then((s) => {
      setWebhookSecret(s.webhookSecret ?? "")
      setMaxMb(s.maxAttachmentMb ?? "25")
    })
  }, [])

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1.5">
        <Label>Webhook-Secret (Workflow-Trigger webhook.incoming)</Label>
        <Input value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)} />
      </div>
      <div className="space-y-1.5">
        <Label>Max. Anhang-Größe (MB)</Label>
        <Input
          type="number"
          min={1}
          max={100}
          value={maxMb}
          onChange={(e) => setMaxMb(e.target.value)}
        />
      </div>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          void invokeIpc(IPCChannels.Email.SetEmailMiscSettings, {
            webhookSecret,
            maxAttachmentMb: parseInt(maxMb, 10) || 25,
          }).then(() => toast.success("Gespeichert"))
        }}
      >
        Erweiterte Einstellungen speichern
      </Button>
      <div className="flex flex-wrap gap-2 border-t pt-3">
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={() => {
            void invokeIpc<{ success: boolean; count: number }>(
              IPCChannels.Email.BackfillCustomerLinks,
              { limit: 500 },
            ).then((r) => toast.success(`${r.count} Verknüpfungen gesetzt`))
          }}
        >
          Kunden-Links nachziehen
        </Button>
        <Input
          className="h-8 w-[140px] text-xs"
          placeholder="Test-Secret"
          value={testSecret}
          onChange={(e) => setTestSecret(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => {
            void invokeIpc<{ success: boolean; fired: number; error?: string }>(
              IPCChannels.Email.FireWebhookWorkflow,
              { secret: testSecret, body: { test: true } },
            ).then((r) => {
              if (r.success) toast.success(`${r.fired} Workflow(s) ausgelöst`)
              else toast.error(r.error ?? "Webhook fehlgeschlagen")
            })
          }}
        >
          Webhook testen
        </Button>
      </div>
    </div>
  )
}
