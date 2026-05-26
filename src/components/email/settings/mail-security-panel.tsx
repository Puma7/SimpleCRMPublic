"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { hasElectron, invokeIpc } from "../types"

type MailSecuritySettings = {
  mailauthEnabled: boolean
  rspamdEnabled: boolean
  rspamdUrl: string
  rspamdTimeoutMs: number
  rspamdSpamScore: number
  autoSpamDmarcFail: boolean
  autoSpamSpfFail: boolean
  autoSpamRspamd: boolean
  senderWhitelist: string
  senderBlacklist: string
  spamScoreThreshold: number
}

export function MailSecurityPanel() {
  const [s, setS] = useState<MailSecuritySettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [testingRspamd, setTestingRspamd] = useState(false)

  const load = useCallback(async () => {
    if (!hasElectron()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      setS(await invokeIpc<MailSecuritySettings>(IPCChannels.Email.GetMailSecuritySettings))
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

  const patch = (partial: Partial<MailSecuritySettings>) => {
    setS((prev) => (prev ? { ...prev, ...partial } : prev))
  }

  const save = async () => {
    if (!hasElectron() || !s) return
    try {
      await invokeIpc(IPCChannels.Email.SetMailSecuritySettings, s)
      toast.success("Mail-Sicherheit gespeichert.")
      await load()
    } catch (e) {
      console.error(e)
      toast.error("Speichern fehlgeschlagen.")
    }
  }

  const testRspamd = async () => {
    if (!hasElectron() || !s) return
    setTestingRspamd(true)
    try {
      const r = await invokeIpc<{ success: boolean; message?: string; error?: string }>(
        IPCChannels.Email.TestRspamdConnection,
        { rspamdUrl: s.rspamdUrl, rspamdTimeoutMs: s.rspamdTimeoutMs },
      )
      if (r.success) toast.success(r.message ?? "Rspamd OK")
      else toast.error(r.error ?? "Rspamd nicht erreichbar")
    } finally {
      setTestingRspamd(false)
    }
  }

  if (loading || !s) {
    return <p className="text-sm text-muted-foreground">Lädt…</p>
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-base font-semibold">Mail-Sicherheit</h3>
        <p className="text-sm text-muted-foreground">
          <strong>P2 mailauth</strong> prüft SPF, DKIM, DMARC und ARC auf gespeicherten RFC822-Headern
          (ohne eigenen MTA). <strong>P3 Rspamd</strong> ist optional über HTTP (typisch localhost:11333).
          Läuft automatisch vor eingehenden Workflows.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="text-sm font-medium">P2 — mailauth (Node, MIT)</h4>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">mailauth bei neuen Mails</Label>
          <Switch
            checked={s.mailauthEnabled}
            onCheckedChange={(on) => patch({ mailauthEnabled: on })}
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Nutzt Header + Body aus der lokalen DB. Ergebnisse: Workflow-Variablen{" "}
          <code className="text-xs">auth.spf</code>, <code className="text-xs">auth.dkim</code>,{" "}
          <code className="text-xs">auth.dmarc</code>, <code className="text-xs">auth.arc</code>.
          Bei <strong>temperror</strong> konnte mailauth die Absender-Domains per DNS nicht prüfen
          (Internet/VPN/Firewall/DNS) — die Prüfung läuft trotzdem, liefert dann aber kein verlässliches
          pass/fail.
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="text-sm font-medium">P3 — Rspamd (optional)</h4>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Rspamd-Check aktiv</Label>
          <Switch checked={s.rspamdEnabled} onCheckedChange={(on) => patch({ rspamdEnabled: on })} />
        </div>
        <div className="grid gap-2">
          <Label className="text-xs">Controller-URL</Label>
          <Input
            value={s.rspamdUrl}
            onChange={(e) => patch({ rspamdUrl: e.target.value })}
            placeholder="http://127.0.0.1:11333"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label className="text-xs">Timeout (ms)</Label>
            <Input
              type="number"
              value={String(s.rspamdTimeoutMs)}
              onChange={(e) => patch({ rspamdTimeoutMs: parseInt(e.target.value, 10) || 8000 })}
            />
          </div>
          <div className="grid gap-2">
            <Label className="text-xs">Spam ab Score</Label>
            <Input
              type="number"
              step="0.5"
              value={String(s.rspamdSpamScore)}
              onChange={(e) => patch({ rspamdSpamScore: parseFloat(e.target.value) || 15 })}
            />
          </div>
        </div>
        <Button type="button" size="sm" variant="outline" disabled={testingRspamd} onClick={() => void testRspamd()}>
          {testingRspamd ? "Teste…" : "Rspamd-Verbindung testen"}
        </Button>
        <p className="text-[11px] text-muted-foreground">
          Variable <code className="text-xs">rspamd.score</code> / <code className="text-xs">rspamd.action</code> in
          Workflows. Rspamd-Scores sind nicht 1:1 mit der KI-Spam-Skala (1–100).
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="text-sm font-medium">Absender-Listen (vor Workflows)</h4>
        <div className="grid gap-2">
          <Label className="text-xs">Whitelist (kommagetrennt)</Label>
          <Input
            value={s.senderWhitelist}
            onChange={(e) => patch({ senderWhitelist: e.target.value })}
            placeholder="@vertrauenswuerdig.de, noreply@shop.de"
          />
        </div>
        <div className="grid gap-2">
          <Label className="text-xs">Blacklist (kommagetrennt)</Label>
          <Input
            value={s.senderBlacklist}
            onChange={(e) => patch({ senderBlacklist: e.target.value })}
            placeholder="spam.net, @betrug.example"
          />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Blacklist → sofort Spam, Workflows werden übersprungen. Whitelist/Blacklist im Workflow-Knoten
          „Absender-Filter“ bleibt zusätzlich möglich (inkl. PayPal/Amazon-Voreinstellungen).
        </p>
      </div>

      <div className="space-y-3 rounded-lg border p-4">
        <h4 className="text-sm font-medium">Automatische Spam-Markierung</h4>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Bei DMARC fail</Label>
          <Switch
            checked={s.autoSpamDmarcFail}
            onCheckedChange={(on) => patch({ autoSpamDmarcFail: on })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Bei SPF fail</Label>
          <Switch
            checked={s.autoSpamSpfFail}
            onCheckedChange={(on) => patch({ autoSpamSpfFail: on })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-sm">Bei Rspamd-Score ≥ Schwelle</Label>
          <Switch checked={s.autoSpamRspamd} onCheckedChange={(on) => patch({ autoSpamRspamd: on })} />
        </div>
        <div className="grid gap-2">
          <Label className="text-xs">KI-Spam-Schwelle (Workflow 1–100)</Label>
          <Input
            type="number"
            min={1}
            max={100}
            value={String(s.spamScoreThreshold)}
            onChange={(e) => patch({ spamScoreThreshold: parseInt(e.target.value, 10) || 70 })}
          />
        </div>
      </div>

      <Button type="button" onClick={() => void save()}>
        Speichern
      </Button>
    </div>
  )
}
