"use client"

import { useCallback, useEffect, useState } from "react"
import { Copy, KeyRound, Loader2, Trash2 } from "lucide-react"
import { IPCChannels } from "@shared/ipc/channels"
import type { AutomationApiSettings, AutomationScope } from "@shared/automation-api"
import { AUTOMATION_SCOPES } from "@shared/automation-api"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import {
  getRendererTransport,
  invokeRenderer,
  isAutomationApiKeyRefreshEvent,
  subscribeServerEvents,
} from "@/services/transport"
import { AutomationMiscSettingsSection } from "./automation-misc-settings-section"
import { AutoReplySettingsSection } from "./auto-reply-settings-section"
import { hasLocalIpc, invokeIpc } from "../types"

type ServerAutomationApiKey = {
  id: string
  label: string
  scopes: AutomationScope[]
  lastUsedAt?: string | null
  revokedAt?: string | null
  createdAt?: string | null
  secretConfigured?: boolean | null
}

type ServerAutomationApiSettings = AutomationApiSettings & {
  keys?: ServerAutomationApiKey[]
}

export function AutomationPanel() {
  const rendererTransport = getRendererTransport()
  const serverClientMode = rendererTransport.kind === "http"
  const [imapDeleteOptIn, setImapDeleteOptIn] = useState(false)
  const [httpAllowlist, setHttpAllowlist] = useState("")
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(false)
  // null = Backend bietet das Tageslimit nicht an (die Server-Edition setzt
  // es noch nicht durch) → Feld ausblenden und beim Speichern weglassen.
  const [autoReplyMaxPerDay, setAutoReplyMaxPerDay] = useState<string | null>("1")
  const [apiSettings, setApiSettings] = useState<AutomationApiSettings | null>(null)
  const [apiEnabled, setApiEnabled] = useState(false)
  const [apiPort, setApiPort] = useState("3847")
  const [apiBindLan, setApiBindLan] = useState(false)
  const [apiScopes, setApiScopes] = useState<AutomationScope[]>([...AUTOMATION_SCOPES])
  const [serverKeyLabel, setServerKeyLabel] = useState("n8n / Make")
  const [serverKeys, setServerKeys] = useState<ServerAutomationApiKey[]>([])
  const [revokingKeyId, setRevokingKeyId] = useState<string | null>(null)
  const [generatedKey, setGeneratedKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (!serverClientMode && !hasLocalIpc()) {
        setApiSettings(null)
        setServerKeys([])
        return
      }

      const wf = await invokeRenderer(IPCChannels.Email.GetWorkflowAutomationSettings) as {
        imapDeleteOptIn: boolean
        httpAllowlist: string
        autoReplyEnabled: boolean
        autoReplyMaxPerSenderPerDay?: number
      }
      setImapDeleteOptIn(wf.imapDeleteOptIn)
      setHttpAllowlist(wf.httpAllowlist)
      setAutoReplyEnabled(wf.autoReplyEnabled === true)
      setAutoReplyMaxPerDay(
        typeof wf.autoReplyMaxPerSenderPerDay === "number"
          ? String(wf.autoReplyMaxPerSenderPerDay)
          : null,
      )

      if (serverClientMode) {
        const api = await invokeRenderer(
          IPCChannels.Automation.GetSettings,
        ) as ServerAutomationApiSettings
        setApiSettings(api)
        setServerKeys(api.keys ?? [])
        setApiEnabled(api.enabled)
        if (api.scopes.length) setApiScopes(api.scopes)
      } else if (hasLocalIpc()) {
        const api = await invokeIpc<AutomationApiSettings>(IPCChannels.Automation.GetSettings)
        setApiSettings(api)
        setServerKeys([])
        setApiEnabled(api.enabled)
        setApiPort(String(api.port))
        setApiBindLan(api.bindLan)
        if (api.scopes.length) setApiScopes(api.scopes)
      } else {
        setApiSettings(null)
        setServerKeys([])
      }
    } finally {
      setLoading(false)
    }
  }, [serverClientMode])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (!serverClientMode) return
    const subscription = subscribeServerEvents({
      onEvent(event) {
        if (isAutomationApiKeyRefreshEvent(event)) void load()
      },
    })
    return () => subscription.unsubscribe()
  }, [load, serverClientMode])

  const saveWorkflowOpts = async () => {
    if (!serverClientMode && !hasLocalIpc()) return
    const payload: {
      imapDeleteOptIn: boolean
      httpAllowlist: string
      autoReplyEnabled: boolean
      autoReplyMaxPerSenderPerDay?: number
    } = { imapDeleteOptIn, httpAllowlist, autoReplyEnabled }
    if (autoReplyMaxPerDay !== null) {
      const maxPerDay = Math.min(50, Math.max(1, parseInt(autoReplyMaxPerDay, 10) || 1))
      payload.autoReplyMaxPerSenderPerDay = maxPerDay
      setAutoReplyMaxPerDay(String(maxPerDay))
    }
    await invokeRenderer(IPCChannels.Email.SetWorkflowAutomationSettings, payload)
    toast.success("Workflow-Optionen gespeichert.")
  }

  const saveApiOpts = async () => {
    if (!hasLocalIpc()) return
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
    if (apiScopes.length === 0) {
      toast.error("Mindestens einen Scope auswählen.")
      return
    }
    if (serverClientMode) {
      const label = serverKeyLabel.trim()
      if (!label) {
        toast.error("Bitte einen Namen für den Server-Key angeben.")
        return
      }
      const res = await invokeRenderer(IPCChannels.Automation.GenerateApiKey, {
        label,
        scopes: apiScopes,
      }) as { success: boolean; key?: string; error?: string }
      if (!res.success) {
        toast.error(res.error ?? "API-Key konnte nicht erzeugt werden.")
        return
      }
      if (res.key) {
        setGeneratedKey(res.key)
        toast.success("Neuer Server-API-Key erzeugt.")
        await load()
      }
      return
    }

    if (!hasLocalIpc()) return
    const res = await invokeIpc<{ success: boolean; key?: string; error?: string }>(
      IPCChannels.Automation.GenerateApiKey,
      { scopes: apiScopes },
    )
    if (!res.success) {
      toast.error(res.error ?? "API-Key konnte nicht erzeugt werden.")
      return
    }
    if (res.key) {
      setGeneratedKey(res.key)
      toast.success("Neuer API-Key erzeugt — jetzt kopieren.")
      await load()
    }
  }

  const revokeKey = async (key?: ServerAutomationApiKey) => {
    if (serverClientMode) {
      if (!key) return
      if (!window.confirm(`API-Key "${key.label}" wirklich widerrufen? Externe Tools verlieren den Zugriff.`)) return
      setRevokingKeyId(key.id)
      try {
        await invokeRenderer(IPCChannels.Automation.RevokeApiKey, { id: key.id })
        setGeneratedKey(null)
        toast.success("Server-API-Key widerrufen.")
        await load()
      } finally {
        setRevokingKeyId(null)
      }
      return
    }

    if (!hasLocalIpc()) return
    if (!window.confirm("API-Key wirklich widerrufen? Externe Tools verlieren den Zugriff.")) return
    await invokeIpc(IPCChannels.Automation.RevokeApiKey)
    setGeneratedKey(null)
    toast.success("API-Key widerrufen.")
    await load()
  }

  const copyGeneratedKey = async () => {
    if (!generatedKey || typeof navigator === "undefined" || !navigator.clipboard) return
    await navigator.clipboard.writeText(generatedKey)
    toast.success("API-Key kopiert.")
  }

  const toggleScope = (scope: AutomationScope, checked: boolean) => {
    setApiScopes((prev) => {
      if (checked) return prev.includes(scope) ? prev : [...prev, scope]
      return prev.filter((s) => s !== scope)
    })
  }

  const serverBaseUrl = serverClientMode && rendererTransport.serverBaseUrl
    ? `${rendererTransport.serverBaseUrl}/api/v1`
    : ""
  const baseUrl =
    !serverClientMode && apiEnabled && apiPort
      ? `http://${apiBindLan ? "0.0.0.0" : "127.0.0.1"}:${apiPort}/api/v1`
      : ""

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        <div>
          <h3 className="text-base font-semibold">Externe API (n8n, Make, Skripte)</h3>
          <p className="text-sm text-muted-foreground">
            {serverClientMode
              ? "Server-REST-API für externe Automationen. API-Keys gelten für den aktuellen Workspace."
              : "Lokale REST-API im Electron-Main-Prozess. Standard nur 127.0.0.1 für n8n auf dem gleichen Rechner."}
          </p>
        </div>

        {serverClientMode ? (
          <div className="space-y-2 rounded-lg border p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-1">
                <Label>Server-API aktiv</Label>
                <p className="text-xs text-muted-foreground">
                  Die Automation-Routen laufen über die verbundene SimpleCRM-Serverinstanz.
                </p>
              </div>
              <span className="rounded-md border px-2 py-1 text-xs text-muted-foreground">
                Servermodus
              </span>
            </div>
            {serverBaseUrl ? (
              <p className="text-xs text-muted-foreground">
                Basis-URL: <code className="rounded bg-muted px-1">{serverBaseUrl}</code>
              </p>
            ) : null}
          </div>
        ) : (
          <>
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
          </>
        )}

        {serverClientMode ? (
          <div className="space-y-1.5">
            <Label htmlFor="server-api-key-label">Key-Name</Label>
            <Input
              id="server-api-key-label"
              value={serverKeyLabel}
              disabled={loading}
              onChange={(event) => setServerKeyLabel(event.target.value)}
              placeholder="n8n Produktion"
            />
          </div>
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
          {!serverClientMode ? (
            <Button type="button" variant="outline" onClick={() => void saveApiOpts()} disabled={loading}>
              API-Einstellungen speichern
            </Button>
          ) : null}
          <Button type="button" onClick={() => void generateKey()} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            API-Key erzeugen
          </Button>
          {!serverClientMode && apiSettings?.hasApiKey ? (
            <Button type="button" variant="destructive" onClick={() => void revokeKey()}>
              Key widerrufen ({apiSettings.keyPreview})
            </Button>
          ) : null}
        </div>

        {serverClientMode ? (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Aktive Server-Keys
            </p>
            {serverKeys.length ? (
              <div className="divide-y rounded-lg border">
                {serverKeys.map((key) => (
                  <div key={key.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="truncate text-sm font-medium">{key.label}</p>
                        <code className="rounded bg-muted px-1 text-[11px] text-muted-foreground">
                          {key.id.slice(0, 8)}
                        </code>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {key.scopes.map((scope) => (
                          <span key={scope} className="rounded-md border px-2 py-0.5 text-[11px] text-muted-foreground">
                            {scope}
                          </span>
                        ))}
                      </div>
                      {key.createdAt ? (
                        <p className="text-xs text-muted-foreground">
                          Erstellt: {new Date(key.createdAt).toLocaleString()}
                        </p>
                      ) : null}
                    </div>
                    <Button
                      type="button"
                      variant="destructive"
                      size="sm"
                      onClick={() => void revokeKey(key)}
                      disabled={loading || revokingKeyId === key.id}
                    >
                      {revokingKeyId === key.id ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                      Widerrufen
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Noch kein aktiver API-Key.
              </p>
            )}
          </div>
        ) : null}

        {generatedKey ? (
          <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <div className="flex items-center justify-between gap-3">
              <p className="font-medium text-amber-800 dark:text-amber-200">Neuer Key (einmalig)</p>
              <Button type="button" variant="outline" size="sm" onClick={() => void copyGeneratedKey()}>
                <Copy className="h-4 w-4" />
                Kopieren
              </Button>
            </div>
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
            IMAP-Löschung und HTTP-Knoten. Absender-Listen, mailauth, Rspamd und Spam-Schwellen:{" "}
            <strong>Einstellungen → Mail-Sicherheit</strong>.
          </p>
        </div>

        <AutoReplySettingsSection
          enabled={autoReplyEnabled}
          onEnabledChange={setAutoReplyEnabled}
          maxPerDay={autoReplyMaxPerDay}
          onMaxPerDayChange={setAutoReplyMaxPerDay}
          disabled={loading}
        />

        <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
          <div className="space-y-1">
            <Label htmlFor="imap-delete-opt-in">IMAP-Löschung (globaler Fallback)</Label>
            <p className="text-xs text-muted-foreground">
              Standard-Opt-in, wenn das Konto unter Konten → SMTP keinen eigenen Schalter gesetzt hat.
              Pro Postfach: <strong>Konten → SMTP</strong>.
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

      <AutomationMiscSettingsSection />
    </div>
  )
}
