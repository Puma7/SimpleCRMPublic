"use client"

import { useCallback, useEffect, useState } from "react"
import { IPCChannels } from "@shared/ipc/channels"
import type { AutomationApiSettings, AutomationScope } from "@shared/automation-api"
import { AUTOMATION_SCOPES } from "@shared/automation-api"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { hasElectron, invokeIpc } from "../types"

export function AutomationPanel() {
  const [imapDeleteOptIn, setImapDeleteOptIn] = useState(false)
  const [httpAllowlist, setHttpAllowlist] = useState("")
  const [apiSettings, setApiSettings] = useState<AutomationApiSettings | null>(null)
  const [apiEnabled, setApiEnabled] = useState(false)
  const [apiPort, setApiPort] = useState("3847")
  const [apiBindLan, setApiBindLan] = useState(false)
  const [apiScopes, setApiScopes] = useState<AutomationScope[]>([...AUTOMATION_SCOPES])
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!hasElectron()) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const wf = await invokeIpc<{ imapDeleteOptIn: boolean; httpAllowlist: string }>(
        IPCChannels.Email.GetWorkflowAutomationSettings,
      )
      setImapDeleteOptIn(wf.imapDeleteOptIn)
      setHttpAllowlist(wf.httpAllowlist)

      const api = await invokeIpc<AutomationApiSettings>(IPCChannels.Automation.GetSettings)
      setApiSettings(api)
      setApiEnabled(api.enabled)
      setApiPort(String(api.port))
      setApiBindLan(api.bindLan)
      if (api.scopes.length) setApiScopes(api.scopes)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const saveWorkflowOpts = async () => {
    if (!hasElectron()) return
    await invokeIpc(IPCChannels.Email.SetWorkflowAutomationSettings, {
      imapDeleteOptIn,
      httpAllowlist,
    })
    toast.success("Workflow-Optionen gespeichert.")
  }

  const saveApiOpts = async () => {
    if (!hasElectron()) return
    const port = parseInt(apiPort, 10)
    await invokeIpc(IPCChannels.Automation.SetSettings, {
      enabled: apiEnabled,
      port: Number.isFinite(port) ? port : 3847,
      bindLan: apiBindLan,
    })
    toast.success("API-Einstellungen gespeichert. Server wurde neu gestartet.")
    await load()
  }

  const generateKey = async () => {
    if (!hasElectron()) return
    const res = await invokeIpc<{ success: boolean; key?: string }>(
      IPCChannels.Automation.GenerateApiKey,
      { scopes: apiScopes },
    )
    if (res.key) {
      setGeneratedKey(res.key)
      toast.success("Neuer API-Key erzeugt — jetzt kopieren.")
      await load()
    }
  }

  const revokeKey = async () => {
    if (!hasElectron()) return
    if (!window.confirm("API-Key wirklich widerrufen? Externe Tools verlieren den Zugriff.")) return
    await invokeIpc(IPCChannels.Automation.RevokeApiKey)
    setGeneratedKey(null)
    toast.success("API-Key widerrufen.")
    await load()
  }

  const toggleScope = (scope: AutomationScope, checked: boolean) => {
    setApiScopes((prev) => {
      if (checked) return prev.includes(scope) ? prev : [...prev, scope]
      return prev.filter((s) => s !== scope)
    })
  }

  const baseUrl =
    apiEnabled && apiPort
      ? `http://${apiBindLan ? "0.0.0.0" : "127.0.0.1"}:${apiPort}/api/v1`
      : ""

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Externe API (n8n, Make, Skripte)</h3>
          <p className="text-sm text-muted-foreground">
            Lokale REST-API im Electron-Main-Prozess. Standard nur{" "}
            <code className="rounded bg-muted px-1">127.0.0.1</code> — für n8n auf dem gleichen
            Rechner.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="api-enabled">Automation-API aktiv</Label>
            <p className="text-xs text-muted-foreground">
              Ohne Aktivierung antwortet der Server nicht (außer Health-Check).
            </p>
          </div>
          <Switch
            id="api-enabled"
            checked={apiEnabled}
            disabled={loading}
            onCheckedChange={setApiEnabled}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="api-port">Port</Label>
            <Input
              id="api-port"
              value={apiPort}
              disabled={loading}
              onChange={(e) => setApiPort(e.target.value)}
            />
          </div>
          <div className="flex items-center gap-2 pt-6">
            <Switch
              id="api-bind-lan"
              checked={apiBindLan}
              disabled={loading}
              onCheckedChange={setApiBindLan}
            />
            <Label htmlFor="api-bind-lan" className="text-sm font-normal">
              LAN-Bindung (0.0.0.0) — nur mit Firewall absichern
            </Label>
          </div>
        </div>

        {baseUrl ? (
          <p className="text-xs text-muted-foreground">
            Basis-URL: <code className="rounded bg-muted px-1">{baseUrl}</code> · OpenAPI:{" "}
            <code className="rounded bg-muted px-1">{baseUrl}/openapi.json</code>
          </p>
        ) : null}

        <div className="space-y-2 rounded-lg border p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Berechtigungen (Scopes)
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {AUTOMATION_SCOPES.map((scope) => (
              <label key={scope} className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={apiScopes.includes(scope)}
                  onCheckedChange={(c) => toggleScope(scope, c === true)}
                />
                {scope}
              </label>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => void saveApiOpts()} disabled={loading}>
            API-Einstellungen speichern
          </Button>
          <Button type="button" onClick={() => void generateKey()} disabled={loading}>
            API-Key erzeugen
          </Button>
          {apiSettings?.hasApiKey ? (
            <Button type="button" variant="destructive" onClick={() => void revokeKey()}>
              Key widerrufen ({apiSettings.keyPreview})
            </Button>
          ) : null}
        </div>

        {generatedKey ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <p className="font-medium text-amber-800 dark:text-amber-200">Neuer Key (einmalig)</p>
            <code className="mt-1 block break-all text-xs">{generatedKey}</code>
            <p className="mt-2 text-xs text-muted-foreground">
              In n8n: HTTP Request → Authentication → Header Auth →{" "}
              <code>Authorization: Bearer …</code>
            </p>
          </div>
        ) : null}
      </section>

      <section className="space-y-4 border-t pt-6">
        <div>
          <h3 className="text-base font-semibold">Workflow-Automatisierung (intern)</h3>
          <p className="text-sm text-muted-foreground">
            Optionen für IMAP-Löschung und ausgehende HTTP-Knoten in SimpleCRM-Workflows.
          </p>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="imap-delete-opt-in">IMAP-Löschung auf dem Server</Label>
            <p className="text-xs text-muted-foreground">
              Erlaubt den Workflow-Knoten „Auf Server löschen“. Ohne Opt-in schlägt die Aktion fehl.
            </p>
          </div>
          <Switch
            id="imap-delete-opt-in"
            checked={imapDeleteOptIn}
            disabled={loading}
            onCheckedChange={setImapDeleteOptIn}
          />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="http-allowlist">HTTP-Allowlist (Hosts)</Label>
          <p className="text-xs text-muted-foreground">
            Kommagetrennte Hostnamen (z. B. api.example.com, hooks.zapier.com). Leer = alle HTTP-Knoten
            blockiert.
          </p>
          <Input
            id="http-allowlist"
            value={httpAllowlist}
            disabled={loading}
            onChange={(e) => setHttpAllowlist(e.target.value)}
            placeholder="api.example.com, hooks.zapier.com"
          />
        </div>

        <Button type="button" onClick={() => void saveWorkflowOpts()} disabled={loading}>
          Workflow-Optionen speichern
        </Button>
      </section>
    </div>
  )
}
