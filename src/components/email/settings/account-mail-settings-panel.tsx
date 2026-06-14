"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import {
  previewAccountTicketCode,
  type AccountMailSettings,
} from "@shared/account-mail-settings"
import { toast } from "sonner"
import { Info, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { invokeRenderer } from "@/services/transport"
import { useMailWorkspace } from "../workspace-context"
import type { EmailAccount } from "../types"

function accountLabel(a: EmailAccount): string {
  return a.display_name?.trim() || a.email_address
}

export function AccountMailSettingsPanel() {
  const {
    settingsAccountId,
    setSettingsAccountId,
    accountsRevision,
  } = useMailWorkspace()
  const [accounts, setAccounts] = useState<EmailAccount[]>([])
  const [settings, setSettings] = useState<AccountMailSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [backendReady, setBackendReady] = useState(true)

  const accId = settingsAccountId

  const loadAccounts = useCallback(async () => {
    try {
      const list = await invokeRenderer(IPCChannels.Email.ListAccounts) as EmailAccount[]
      setAccounts(list)
      if (list.length > 0 && (accId == null || !list.some((a) => a.id === accId))) {
        setSettingsAccountId(list[0]!.id)
      }
    } catch (e) {
      console.error(e)
      toast.error("Konten konnten nicht geladen werden.")
    }
  }, [accId, setSettingsAccountId])

  const loadSettings = useCallback(async () => {
    if (accId == null) {
      setSettings(null)
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const s = await invokeRenderer(IPCChannels.Email.GetAccountMailSettings, {
        accountId: accId,
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
  }, [accId])

  useEffect(() => {
    void loadAccounts()
  }, [loadAccounts, accountsRevision])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const selectedAccount = accounts.find((a) => a.id === accId) ?? null

  const ticketPreview = useMemo(() => {
    if (!settings) return null
    return previewAccountTicketCode(settings)
  }, [settings])

  const patch = (partial: Partial<AccountMailSettings>) => {
    setSettings((prev) => (prev ? { ...prev, ...partial } : prev))
  }

  const save = async () => {
    if (!settings || accId == null || saving) return
    setSaving(true)
    try {
      const saved = await invokeRenderer(IPCChannels.Email.SetAccountMailSettings, {
        ...settings,
        accountId: accId,
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

  if (accounts.length === 0) {
    return (
      <div className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Individuelle Kontoeinstellungen</h3>
          <p className="text-sm text-muted-foreground">
            Legen Sie zuerst unter <strong>Konten &amp; Versand → Konten</strong> ein Mailkonto an.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Individuelle Kontoeinstellungen</h3>
        <p className="text-sm text-muted-foreground">
          Ticket-Nummern und Thread-Zuordnung sind pro Postfach getrennt. Kategorien, globale
          Textbausteine und die gemeinsame Arbeitslogik gelten instanzweit für alle Konten.
        </p>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertTitle>Global vs. Konto-Override</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>
            <Badge variant="secondary" className="mr-2 align-middle">
              Global
            </Badge>
            Einträge ohne Konto-Zuordnung sind in der Ansicht{" "}
            <strong>Alle Konten</strong> sichtbar — z. B. Textbausteine, KI-Prompts, Wissensbasis
            und Automationen unter ihren jeweiligen Tabs.
          </p>
          <p>
            <Badge variant="outline" className="mr-2 align-middle">
              Konto-Override
            </Badge>
            Ein kontospezifischer Eintrag mit gleichem <strong>Override-Key</strong> ersetzt den
            globalen Eintrag nur für das gewählte Postfach. Ohne Override-Key ergänzt der Eintrag
            das Konto, ohne den globalen Eintrag zu verbergen.
          </p>
          <p>
            <Badge className="mr-2 align-middle">Nur dieses Konto</Badge>
            Ticket-Präfix, Nummernkreis, Auffüllung und Thread-Namespace unten gelten ausschließlich
            für das ausgewählte Postfach — auch wenn zwei Shops dieselbe laufende Nummer „1“
            verwenden.
          </p>
        </AlertDescription>
      </Alert>

      <div className="space-y-2">
        <Label htmlFor="account-mail-settings-account">Postfach</Label>
        <Select
          value={accId != null ? String(accId) : undefined}
          onValueChange={(v) => setSettingsAccountId(Number(v))}
        >
          <SelectTrigger id="account-mail-settings-account">
            <SelectValue placeholder="Konto wählen" />
          </SelectTrigger>
          <SelectContent>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={String(a.id)}>
                {accountLabel(a)} ({a.email_address})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {selectedAccount ? (
          <p className="text-xs text-muted-foreground">
            Einstellungen für <strong>{selectedAccount.email_address}</strong>. Signatur und
            SMTP/IMAP konfigurieren Sie unter <strong>Konten &amp; Versand → Konten</strong>.
          </p>
        ) : null}
      </div>

      {!backendReady && !loading ? (
        <Alert variant="destructive">
          <AlertTitle>Backend noch nicht angebunden</AlertTitle>
          <AlertDescription>
            Die Speicher-API für Kontoeinstellungen ist in dieser Umgebung noch nicht verfügbar.
            Die Felder werden angezeigt, sobald <code>email:get-account-mail-settings</code> erreichbar
            ist.
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
              <p className="text-sm text-muted-foreground">
                Neue ausgehende Mails erhalten den Betreff{" "}
                <code className="rounded bg-muted px-1">[PRÄFIX-NUMMER]</code>. Antworten und
                Weiterleitungen behalten die Ticket-Nummer der Ursprungsnachricht.
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ticket-prefix">Ticket-Präfix (Buchstabenkombi)</Label>
                  <Input
                    id="ticket-prefix"
                    value={settings.ticketPrefix}
                    maxLength={12}
                    className="font-mono uppercase"
                    onChange={(e) => patch({ ticketPrefix: e.target.value.toUpperCase() })}
                  />
                  <p className="text-xs text-muted-foreground">
                    2–12 Zeichen, Buchstaben und Ziffern. Muss instanzweit eindeutig sein.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="ticket-next-number">Nächste Nummer (Nummernkreis)</Label>
                  <Input
                    id="ticket-next-number"
                    type="number"
                    min={1}
                    value={settings.ticketNextNumber}
                    onChange={(e) =>
                      patch({ ticketNextNumber: Math.max(1, Number(e.target.value) || 1) })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Wird beim Versand atomisch hochgezählt. Bereits vergebene Nummern ändern sich
                    nicht rückwirkend.
                  </p>
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
                        ticketNumberPadding: Math.min(
                          12,
                          Math.max(1, Number(e.target.value) || 1),
                        ),
                      })
                    }
                  />
                  <p className="text-xs text-muted-foreground">
                    Führende Nullen, z. B. 6 Stellen → <code>000042</code>.
                  </p>
                </div>

                <div className="space-y-2">
                  <Label>Vorschau nächster Ticket-Code</Label>
                  <div className="rounded-md border bg-muted/40 px-3 py-2 font-mono text-sm">
                    {ticketPreview ? `[${ticketPreview}]` : "—"}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Nur zur Orientierung — der tatsächliche Code wird beim Senden vergeben.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Thread-Namespace</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Trennt Konversations-Threads pro Postfach, auch wenn zwei Konten zufällig dieselbe
                Ticket-Nummer vergeben. Der Namespace wird intern für Thread-Auflösung verwendet.
              </p>
              <div className="space-y-2">
                <Label htmlFor="thread-namespace">Namespace-Kennung</Label>
                <Input
                  id="thread-namespace"
                  value={settings.threadNamespace}
                  maxLength={64}
                  className="font-mono text-sm"
                  onChange={(e) => patch({ threadNamespace: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">
                  Empfehlung: kurzer, eindeutiger Name — oft identisch zum Ticket-Präfix in
                  Kleinbuchstaben.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Overrides in den Ressourcen-Tabs</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <p>
                Kontospezifische Textbausteine, KI-Prompts und Wissensbasen verwalten Sie in den
                jeweiligen Tabs mit dem Filter <strong>Gültigkeitsbereich</strong>. Unter{" "}
                <strong>Konten → KI</strong> weisen Sie Wissens-Kontexte (eingehend/ausgehend/allgemein)
                pro Postfach zu.
              </p>
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
