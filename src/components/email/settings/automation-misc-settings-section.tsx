"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { invokeRenderer } from "@/services/transport"

type Props = {
  /** settings.manage — ohne die Stufe lehnt der PATCH ab. */
  canEdit?: boolean
  /** Nur Admins sehen und aendern das Secret im Klartext (sonst maskiert). */
  canEditSecret?: boolean
}

export function AutomationMiscSettingsSection({ canEdit = true, canEditSecret = true }: Props) {
  const [webhookSecret, setWebhookSecret] = useState("")
  const [maxMb, setMaxMb] = useState("25")
  const [testSecret, setTestSecret] = useState("")

  useEffect(() => {
    void invokeRenderer(
      IPCChannels.Email.GetEmailMiscSettings,
    ).then((s) => {
      const settings = s as { webhookSecret: string; maxAttachmentMb: string }
      setWebhookSecret(settings.webhookSecret ?? "")
      setMaxMb(settings.maxAttachmentMb ?? "25")
    })
  }, [])

  return (
    <div className="space-y-4 rounded-lg border p-4">
      <div>
        <h3 className="text-sm font-semibold">Webhook & Anhänge</h3>
        <p className="text-xs text-muted-foreground">
          Gehört zur Workflow-Automatisierung (webhook.incoming, Anhang-Limits).
        </p>
      </div>
      <div className="space-y-3 text-sm">
        <div className="space-y-1.5">
          <Label htmlFor="automation-webhook-secret">Webhook-Secret (Workflow-Trigger webhook.incoming)</Label>
          {/* Nicht-Admins bekommen den Wert nur maskiert geliefert; ein Schreiben
              lehnt der Server ab, sobald er vom Maskenwert abweicht. */}
          <Input
            id="automation-webhook-secret"
            value={webhookSecret}
            disabled={!canEdit || !canEditSecret}
            onChange={(e) => setWebhookSecret(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="automation-max-attachment-mb">Max. Anhang-Größe (MB)</Label>
          <Input
            id="automation-max-attachment-mb"
            type="number"
            min={1}
            max={100}
            value={maxMb}
            disabled={!canEdit}
            onChange={(e) => setMaxMb(e.target.value)}
          />
        </div>
        <Button
          type="button"
          size="sm"
          disabled={!canEdit}
          onClick={() => {
            void invokeRenderer(IPCChannels.Email.SetEmailMiscSettings, {
              webhookSecret,
              maxAttachmentMb: parseInt(maxMb, 10) || 25,
            }).then(() => toast.success("Gespeichert"))
          }}
        >
          Speichern
        </Button>
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Input
            className="h-8 w-[140px] text-xs"
            placeholder="Test-Secret"
            value={testSecret}
            disabled={!canEdit}
            onChange={(e) => setTestSecret(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!canEdit}
            onClick={() => {
              void invokeRenderer(
                IPCChannels.Email.FireWebhookWorkflow,
                { secret: testSecret, body: { test: true } },
              ).then((r) => {
                const result = r as { success: boolean; fired: number; error?: string }
                if (result.success) toast.success(`${result.fired} Workflow(s) ausgelöst`)
                else toast.error(result.error ?? "Webhook fehlgeschlagen")
              })
            }}
          >
            Webhook testen
          </Button>
        </div>
      </div>
    </div>
  )
}
