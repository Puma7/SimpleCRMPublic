"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Shield } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { hasElectron, invokeIpc } from "../types"

type MailSecuritySettings = {
  senderWhitelist: string
  senderBlacklist: string
  spamScoreThreshold: string
  useBuiltinTrustedSenders: boolean
  autoBlacklistBeforeWorkflow: boolean
}

export function MailSecurityPanel() {
  const [settings, setSettings] = useState<MailSecuritySettings>({
    senderWhitelist: "",
    senderBlacklist: "",
    spamScoreThreshold: "70",
    useBuiltinTrustedSenders: true,
    autoBlacklistBeforeWorkflow: true,
  })
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hasElectron()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const s = await invokeIpc<MailSecuritySettings>(IPCChannels.Email.GetMailSecuritySettings)
      setSettings(s)
    } catch (e) {
      console.error(e)
      toast.error("Mail-Sicherheit konnte nicht geladen werden.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const save = async () => {
    if (!hasElectron()) return
    await invokeIpc(IPCChannels.Email.SetMailSecuritySettings, settings)
    toast.success("Mail-Sicherheit gespeichert.")
  }

  const patch = (partial: Partial<MailSecuritySettings>) => {
    setSettings((prev) => ({ ...prev, ...partial }))
  }

  return (
    <div className="space-y-8">
      <div>
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <Shield className="h-4 w-4" />
          Mail-Sicherheit
        </h3>
        <p className="text-sm text-muted-foreground">
          Statische Prüfungen <strong>vor</strong> Workflow- und KI-Knoten: Absender-Listen,
          Schwellwert für KI-Spam-Scores. Weitere Stufen (Authentifizierung, Phishing, Anhänge)
          sind geplant — siehe{" "}
          <code className="rounded bg-muted px-1 text-xs">docs/MAIL_SECURITY.md</code>.
        </p>
      </div>

      <section className="space-y-4 rounded-lg border p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Absender &amp; Spam (aktiv)
        </p>

        <div className="space-y-1.5">
          <Label htmlFor="sender-whitelist">Absender-Whitelist</Label>
          <p className="text-xs text-muted-foreground">
            Kommagetrennt: E-Mail oder Domain (z. B. paypal.com, buchhaltung@firma.de). Diese Mails
            überspringen die KI-Spam-Prüfung im Standard-Workflow (Kante „whitelist“).
          </p>
          <Input
            id="sender-whitelist"
            value={settings.senderWhitelist}
            disabled={loading}
            onChange={(e) => patch({ senderWhitelist: e.target.value })}
            placeholder="paypal.com, amazon.de"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="sender-blacklist">Absender-Blacklist</Label>
          <p className="text-xs text-muted-foreground">
            Absender, die sofort als Spam behandelt werden (vor der KI), wenn „Auto-Spam“ aktiv ist.
          </p>
          <Input
            id="sender-blacklist"
            value={settings.senderBlacklist}
            disabled={loading}
            onChange={(e) => patch({ senderBlacklist: e.target.value })}
            placeholder="spam.example.com"
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="spam-threshold">Spam-Schwellwert (1–100)</Label>
          <p className="text-xs text-muted-foreground">
            Grenzwert für den Workflow-Knoten „Schwellwert“ nach „KI-Spam-Wahrscheinlichkeit“ (z. B.
            70 = ab 70 als Spam markieren), sofern „Globalen Schwellwert nutzen“ aktiv ist.
          </p>
          <Input
            id="spam-threshold"
            type="number"
            min={1}
            max={100}
            value={settings.spamScoreThreshold}
            disabled={loading}
            onChange={(e) => patch({ spamScoreThreshold: e.target.value })}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="builtin-trusted">Bekannte Absender (PayPal, Amazon, …)</Label>
            <p className="text-xs text-muted-foreground">
              Eingebaute Liste vertrauenswürdiger Domains — wie Whitelist, ohne Eintrag in Ihrer
              Liste.
            </p>
          </div>
          <Switch
            id="builtin-trusted"
            checked={settings.useBuiltinTrustedSenders}
            disabled={loading}
            onCheckedChange={(v) => patch({ useBuiltinTrustedSenders: v })}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-md border p-3">
          <div className="space-y-1">
            <Label htmlFor="auto-blacklist">Blacklist → sofort Spam (vor Workflows)</Label>
            <p className="text-xs text-muted-foreground">
              Treffer auf die Blacklist markieren die Mail lokal als Spam, bevor Workflows laufen.
            </p>
          </div>
          <Switch
            id="auto-blacklist"
            checked={settings.autoBlacklistBeforeWorkflow}
            disabled={loading}
            onCheckedChange={(v) => patch({ autoBlacklistBeforeWorkflow: v })}
          />
        </div>

        <Button type="button" onClick={() => void save()} disabled={loading}>
          Speichern
        </Button>
      </section>

      <section className="space-y-3 rounded-lg border border-dashed p-4 opacity-90">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Geplant (statisch, vor Workflows)
        </p>
        <ul className="list-disc space-y-1.5 pl-5 text-sm text-muted-foreground">
          <li>
            <strong>SPF / DKIM / DMARC</strong> — z. B. Bibliothek{" "}
            <code className="text-xs">mailauth</code> auf gespeicherten RFC-Headern
          </li>
          <li>
            <strong>Anti-Spoofing / Betrug</strong> — Display-Name vs. From-Domain, Reply-To-Abweichung
          </li>
          <li>
            <strong>URL-Reputation</strong> — Phishing-Links (lokale Listen, optional Rspamd/ClamAV
            als Dienst)
          </li>
          <li>
            <strong>Anhänge</strong> — ClamAV o. Ä. (nur mit lokalem Scanner-Daemon)
          </li>
          <li>
            <strong>Tracker</strong> — Erkennung von Tracking-Pixeln/Links im HTML-Body (heuristisch)
          </li>
        </ul>
      </section>
    </div>
  )
}
