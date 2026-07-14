"use client"

import { useEffect, useMemo, useState } from "react"
import { AlertTriangle, Database, HardDrive, Loader2, Server } from "lucide-react"
import { IPCChannels } from "@shared/ipc/channels"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import {
  configureRendererTransportFromDeployConfig,
  getBrowserDeployConfig,
  saveBrowserDeployConfig,
  type DeployConfig,
  type DeployConfigResult,
  type DeployMode,
  type SaveDeployConfigResult,
} from "@/services/transport"

type GateState =
  | { status: "loading" }
  | { status: "ready"; config: DeployConfig | null }
  | { status: "needs-setup"; reason: "missing" | "invalid"; error?: string }
  | { status: "failed"; error: string }

const modes: Array<{
  id: DeployMode
  label: string
  detail: string
  icon: typeof Database
}> = [
  {
    id: "standalone",
    label: "Lokal",
    detail: "Embedded PostgreSQL auf diesem Rechner.",
    icon: Database,
  },
  {
    id: "server-client",
    label: "Server verbinden",
    detail: "Thin Client gegen eine SimpleCRM Server-URL.",
    icon: Server,
  },
  {
    id: "server-install",
    label: "Server installieren",
    detail: "Server-Setup fuer Docker Compose vorbereiten.",
    icon: HardDrive,
  },
]

export function DeploySetupGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<GateState>({ status: "loading" })

  useEffect(() => {
    const invoke = window.electronAPI?.invoke
    if (!invoke) {
      const result = getBrowserDeployConfig()
      if (result.status === "ok") {
        configureRendererTransportFromDeployConfig(result.config)
        setState({ status: "ready", config: result.config })
      } else if (result.status === "invalid") {
        configureRendererTransportFromDeployConfig(null)
        setState({ status: "needs-setup", reason: "invalid", error: result.error })
      } else {
        configureRendererTransportFromDeployConfig(null)
        setState({ status: "needs-setup", reason: "missing" })
      }
      return
    }
    let cancelled = false
    void invoke(IPCChannels.Setup.GetDeployConfig)
      .then((result: DeployConfigResult) => {
        if (cancelled) return
        if (result.status === "ok") {
          configureRendererTransportFromDeployConfig(result.config)
          setState({ status: "ready", config: result.config })
        } else if (result.status === "invalid") {
          configureRendererTransportFromDeployConfig(null)
          setState({ status: "needs-setup", reason: "invalid", error: result.error })
        } else {
          configureRendererTransportFromDeployConfig(null)
          setState({ status: "needs-setup", reason: "missing" })
        }
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setState({
          status: "failed",
          error: error instanceof Error ? error.message : String(error ?? "unknown error"),
        })
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === "loading") {
    return <SetupFrame><LoadingState /></SetupFrame>
  }

  if (state.status === "failed") {
    return (
      <SetupFrame>
        <SetupMessage
          tone="error"
          title="Setup konnte nicht gelesen werden"
          detail={state.error}
        />
      </SetupFrame>
    )
  }

  if (state.status === "needs-setup") {
    return (
      <SetupFrame>
        <DeployModeWizard
          browserOnly={!window.electronAPI?.invoke}
          invalidConfigError={state.reason === "invalid" ? state.error : undefined}
          onSaved={(config) => setState({ status: "ready", config })}
        />
      </SetupFrame>
    )
  }

  if (state.config?.mode === "server-install") {
    return (
      <SetupFrame>
        <PendingModeState config={state.config} />
      </SetupFrame>
    )
  }

  return <>{children}</>
}

function DeployModeWizard({
  browserOnly,
  invalidConfigError,
  onSaved,
}: {
  browserOnly: boolean
  invalidConfigError?: string
  onSaved: (config: DeployConfig) => void
}) {
  const [mode, setMode] = useState<DeployMode>(browserOnly ? "server-client" : "standalone")
  const [baseUrl, setBaseUrl] = useState("")
  const [username, setUsername] = useState("")
  const [installDir, setInstallDir] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const selectedMode = useMemo(() => modes.find((item) => item.id === mode) ?? modes[0], [mode])

  async function save() {
    const invoke = window.electronAPI?.invoke
    setError(null)
    if (!invoke) {
      if (mode !== "server-client") {
        setError("Dieser Modus ist nur in der Desktop-App verfuegbar.")
        return
      }
      const result = saveBrowserDeployConfig(buildPayload())
      if (!result.success) {
        setError(result.error ?? "Deploy-Modus konnte nicht gespeichert werden.")
        return
      }
      configureRendererTransportFromDeployConfig(result.config)
      onSaved(result.config)
      return
    }
    setSaving(true)
    setError(null)
    const payload = buildPayload()
    try {
      const result = await invoke(IPCChannels.Setup.SaveDeployConfig, payload) as SaveDeployConfigResult
      if (!result.success) {
        setError(result.error ?? "Deploy-Modus konnte nicht gespeichert werden.")
        return
      }
      configureRendererTransportFromDeployConfig(result.config)
      onSaved(result.config)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError ?? "unknown error"))
    } finally {
      setSaving(false)
    }
  }

  function buildPayload() {
    return {
      mode,
      ...(mode === "server-client" ? {
        server: {
          baseUrl,
          ...(username.trim() ? { lastLoginUsername: username } : {}),
        },
      } : {}),
      ...(mode === "server-install" ? {
        serverInstall: {
          ...(installDir.trim() ? { installDir } : {}),
        },
      } : {}),
    }
  }

  return (
    <div className="w-full max-w-4xl px-6 py-10">
      <div className="mb-8">
        <p className="text-sm font-medium text-muted-foreground">SimpleCRM Setup</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-normal text-foreground">
          Betriebsmodus auswaehlen
        </h1>
      </div>

      {invalidConfigError ? (
        <div className="mb-5 flex items-start gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4" />
          <span>{invalidConfigError}</span>
        </div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-3" role="radiogroup" aria-label="Betriebsmodus">
        {modes.map((item) => {
          const Icon = item.icon
          const active = item.id === mode
          return (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={active}
              disabled={browserOnly && item.id !== "server-client"}
              className={cn(
                "flex min-h-28 flex-col items-start justify-between rounded-md border bg-background p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                active
                  ? "border-primary bg-primary/5 text-foreground"
                  : "border-border hover:border-primary/50",
              )}
              onClick={() => setMode(item.id)}
            >
              <Icon className="h-5 w-5" />
              <span>
                <span className="block text-sm font-semibold">{item.label}</span>
                <span className="mt-1 block text-sm leading-5 text-muted-foreground">{item.detail}</span>
              </span>
            </button>
          )
        })}
      </div>

      {mode === "server-client" ? (
        <div className="mt-6 grid gap-4 rounded-md border border-border p-4 md:grid-cols-2">
          <div className="space-y-2 md:col-span-2">
            <Label htmlFor="server-url">Server-URL</Label>
            <Input
              id="server-url"
              placeholder="https://crm.example.com"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="server-user">Benutzername</Label>
            <Input
              id="server-user"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
            />
          </div>
        </div>
      ) : null}

      {mode === "server-install" ? (
        <div className="mt-6 rounded-md border border-border p-4">
          <Label htmlFor="install-dir">Installationsordner</Label>
          <Input
            id="install-dir"
            className="mt-2"
            placeholder="/opt/simplecrm"
            value={installDir}
            onChange={(event) => setInstallDir(event.target.value)}
          />
        </div>
      ) : null}

      {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}

      <div className="mt-8 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Ausgewaehlt: {selectedMode.label}
        </p>
        <Button onClick={save} disabled={saving || (mode === "server-client" && !baseUrl.trim())}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Speichern
        </Button>
      </div>
    </div>
  )
}

function PendingModeState({ config }: { config: DeployConfig }) {
  const target = config.mode === "server-client" ? config.server?.baseUrl : config.serverInstall?.installDir
  return (
    <div className="w-full max-w-2xl px-6 py-10">
      <SetupMessage
        tone="warn"
        title="Modus gespeichert"
        detail={target ? `${config.mode}: ${target}` : config.mode}
      />
    </div>
  )
}

function LoadingState() {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      Setup wird geladen...
    </div>
  )
}

function SetupMessage({
  tone,
  title,
  detail,
}: {
  tone: "error" | "warn"
  title: string
  detail: string
}) {
  return (
    <div className={cn(
      "rounded-md border p-4",
      tone === "error" ? "border-destructive/40 bg-destructive/5" : "border-border bg-background",
    )}>
      <div className="flex items-start gap-3">
        <AlertTriangle className={cn("mt-0.5 h-5 w-5", tone === "error" ? "text-destructive" : "text-amber-600")} />
        <div>
          <h1 className="text-lg font-semibold tracking-normal">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{detail}</p>
        </div>
      </div>
    </div>
  )
}

function SetupFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background text-foreground">
      {children}
    </div>
  )
}
