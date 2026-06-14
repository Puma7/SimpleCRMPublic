"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  previewAccountTicketCode,
  type AccountMailSettings,
} from "@shared/account-mail-settings"
import { toast } from "sonner"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { invokeRenderer } from "@/services/transport"
import { useMailWorkspace } from "../workspace-context"

type Props = {
  accountId: number
}

export function AccountAdvancedPanel({ accountId }: Props) {
  const { accountsRevision } = useMailWorkspace()
  const [settings, setSettings] = useState<AccountMailSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [backendReady, setBackendReady] = useState(true)

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const s = await invokeRenderer(IPCChannels.Email.GetAccountMailSettings, {
        accountId,
      }) as AccountMailSettings
      setSettings(s)
      setBackendReady(true)
    } catch (e) {
      console.error(e)
      setSettings(null)
      setBackendReady(false)
      toast.error("Kontoeinstellungen konnten nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [accountId])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings, accountsRevision])

  const ticketPreview = useMemo(() => {
    if (!settings) return null
    return previewAccountTicketCode(settings)
  }, [settings])

  const patch = (partial: Partial<AccountMailSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev))
  }

  const save = async () => {
    if (!settings || saving) return
    setSaving(true)
    try {
      const saved = await invokeRenderer(IPCChannels.Email.SetAccountMailSettings, {
        ...settings,
        accountId,
      }) as AccountMailSettings
      setSettings(saved)
      toast.success("Kontoeinstellungen gespeichert.")
    } catch (e) {
      console.error(e)
      toast.error(e instanceof Error ? e.message : "Speichern fehlgeschlagen.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h3 className="text-base font-semibold">Erweitert</h3>
        <p className="text-sm text-muted-foreground">
          Ticket-Nummern und Thread-Namespace gelten nur für dieses Postfach. Signatur, SMTP und
          IMAP finden Sie in den anderen Konten-Tabs.
        </p>
      </div>

      {!backendReady && !loading ? (
        <Alert variant="destructive">
          <AlertTitle>Backend noch nicht angebunden</AlertTitle>
          <AlertDescription>
            Die Speicher-API für Kontoeinstellungen ist in dieser Umgebung noch nicht verfügbar.
          </AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Lade Kontoeinstellungen…
        </div>
      ) : settings ? (
        <>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Ticket-Nummern</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ticket-prefix">Ticket-Präfix</Label>
                  <Input
                    id="ticket-prefix"
                    value={settings.ticketPrefix}
                    maxLength={12}
                    className="font-mono uppercase"
                    onChange={(e) => patch({ ticketPrefix: e.target.value.toUpperCase() })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ticket-next-number">Nächste Nummer</Label>
                  <Input
                    id="ticket-next-number"
                    type="number"
                    min={1}
                    value={settings.ticketNextNumber}
                    onChange={(e) =>
                      patch({ ticketNextNumber: Math.max(1, Number(e.target.value) || 1) })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ticket-padding">Auffüllung (Stellen)</Label>
                  <Input
                    id="ticket-padding"
                    type="number"
                    min={1}
                    max={12}
                    value={settings.ticketNumberPadding}
                    onChange={(e) =>
                      patch({
                        ticketNumberPadding: Math.min(12, Math.max(1, Number(e.target.value) || 1)),
                      })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>Vorschau</Label>
                  <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
                    {ticketPreview ? `[${ticketPreview}]` : "—"}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Thread-Namespace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <Label htmlFor="thread-namespace">Namespace-Kennung</Label>
              <Input
                id="thread-namespace"
                value={settings.threadNamespace}
                maxLength={64}
                className="font-mono text-sm"
                onChange={(e) => patch({ threadNamespace: e.target.value })}
              />
            </CardContent>
          </Card>

          <Button type="button" onClick={() => void save()} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Speichern…
              </>
            ) : (
              "Speichern"
            )}
          </Button>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">Keine Einstellungen für dieses Konto.</p>
      )}
    </div>
  )
}
