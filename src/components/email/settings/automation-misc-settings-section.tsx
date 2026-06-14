"use client"

import { useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { invokeRenderer } from "@/services/transport"

export function AutomationMiscSettingsSection() {
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
            onChange={(e) => setTestSecret(e.target.value)}
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
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
