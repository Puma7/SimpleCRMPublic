export type DeployMode = "standalone" | "server-client" | "server-install"

export type DeployConfig = {
  version: 1
  mode: DeployMode
  selectedAt: string
  server?: {
    baseUrl: string
    lastLoginUsername?: string
  }
  serverInstall?: {
    composeProjectName?: string
    installDir?: string
  }
}

export type DeployConfigResult =
  | { status: "missing" }
  | { status: "invalid"; error: string }
  | { status: "ok"; config: DeployConfig }

export type SaveDeployConfigPayload = {
  mode: DeployMode
  server?: {
    baseUrl?: string
    lastLoginUsername?: string
  }
  serverInstall?: {
    composeProjectName?: string
    installDir?: string
  }
}

export type SaveDeployConfigResult =
  | { success: true; config: DeployConfig }
  | { success: false; error?: string }

export const BROWSER_DEPLOY_CONFIG_STORAGE_KEY = "simplecrm.deployConfig.v1"

const serverUrlSearchParams = ["simplecrmServer", "serverUrl", "server"]
const serverUserSearchParams = ["simplecrmUser", "username"]

export function getBrowserDeployConfig(): DeployConfigResult {
  if (typeof window === "undefined") return { status: "missing" }

  const queryConfig = deployConfigFromUrl(window.location.href)
  if (queryConfig.status === "ok") {
    persistBrowserDeployConfig(queryConfig.config)
    return queryConfig
  }
  if (queryConfig.status === "invalid") return queryConfig

  const stored = readStoredBrowserDeployConfig()
  if (stored) return stored

  return { status: "missing" }
}

export function saveBrowserDeployConfig(payload: SaveDeployConfigPayload): SaveDeployConfigResult {
  try {
    const config = normalizeDeployConfigPayload(payload)
    persistBrowserDeployConfig(config)
    return { success: true, config }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Deploy-Modus konnte nicht gespeichert werden.",
    }
  }
}

export function clearBrowserDeployConfig(): void {
  browserStorage()?.removeItem(BROWSER_DEPLOY_CONFIG_STORAGE_KEY)
}

function deployConfigFromUrl(href: string): DeployConfigResult {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return { status: "missing" }
  }

  const baseUrl = firstSearchParam(url.searchParams, serverUrlSearchParams)
  if (!baseUrl) return { status: "missing" }

  const result = savePayloadWithoutPersisting({
    mode: "server-client",
    server: {
      baseUrl,
      lastLoginUsername: firstSearchParam(url.searchParams, serverUserSearchParams) ?? undefined,
    },
  })
  return result.success ? { status: "ok", config: result.config } : { status: "invalid", error: result.error ?? "ungueltige Server-URL" }
}

function readStoredBrowserDeployConfig(): DeployConfigResult | null {
  const raw = browserStorage()?.getItem(BROWSER_DEPLOY_CONFIG_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    const result = normalizeDeployConfig(parsed)
    return { status: "ok", config: result }
  } catch (error) {
    return {
      status: "invalid",
      error: error instanceof Error ? error.message : "Browser-Deploy-Config ist ungueltig.",
    }
  }
}

function savePayloadWithoutPersisting(payload: SaveDeployConfigPayload): SaveDeployConfigResult {
  try {
    return { success: true, config: normalizeDeployConfigPayload(payload) }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Deploy-Modus konnte nicht gespeichert werden.",
    }
  }
}

function normalizeDeployConfigPayload(payload: SaveDeployConfigPayload): DeployConfig {
  const mode = normalizeMode(payload.mode)
  return normalizeDeployConfig({
    version: 1,
    mode,
    selectedAt: new Date().toISOString(),
    ...(mode === "server-client"
      ? {
          server: {
            baseUrl: payload.server?.baseUrl,
            lastLoginUsername: payload.server?.lastLoginUsername,
          },
        }
      : {}),
    ...(mode === "server-install"
      ? {
          serverInstall: {
            composeProjectName: payload.serverInstall?.composeProjectName,
            installDir: payload.serverInstall?.installDir,
          },
        }
      : {}),
  })
}

function normalizeDeployConfig(value: unknown): DeployConfig {
  if (!isRecord(value)) throw new Error("Deploy-Config muss ein Objekt sein.")
  if (value.version !== 1) throw new Error("Deploy-Config-Version wird nicht unterstuetzt.")

  const mode = normalizeMode(value.mode)
  const selectedAt = typeof value.selectedAt === "string" && value.selectedAt.trim()
    ? value.selectedAt.trim()
    : new Date().toISOString()

  if (mode === "server-client") {
    if (!isRecord(value.server)) throw new Error("Server-Konfiguration ist erforderlich.")
    return {
      version: 1,
      mode,
      selectedAt,
      server: {
        baseUrl: normalizeServerBaseUrl(value.server.baseUrl),
        ...(optionalString(value.server.lastLoginUsername)
          ? { lastLoginUsername: optionalString(value.server.lastLoginUsername) }
          : {}),
      },
    }
  }

  if (mode === "server-install") {
    return {
      version: 1,
      mode,
      selectedAt,
      serverInstall: {
        ...(isRecord(value.serverInstall) && optionalString(value.serverInstall.composeProjectName)
          ? { composeProjectName: optionalString(value.serverInstall.composeProjectName) }
          : {}),
        ...(isRecord(value.serverInstall) && optionalString(value.serverInstall.installDir)
          ? { installDir: optionalString(value.serverInstall.installDir) }
          : {}),
      },
    }
  }

  return { version: 1, mode, selectedAt }
}

function normalizeMode(value: unknown): DeployMode {
  if (value === "standalone" || value === "server-client" || value === "server-install") return value
  throw new Error("mode muss standalone, server-client oder server-install sein.")
}

function normalizeServerBaseUrl(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw new Error("Server-URL ist erforderlich.")
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new Error("Server-URL ist ungueltig.")
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Server-URL muss http oder https verwenden.")
  }
  return url.toString().replace(/\/+$/, "")
}

function persistBrowserDeployConfig(config: DeployConfig): void {
  browserStorage()?.setItem(BROWSER_DEPLOY_CONFIG_STORAGE_KEY, JSON.stringify(config))
}

function firstSearchParam(params: URLSearchParams, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = params.get(key)?.trim()
    if (value) return value
  }
  return null
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function browserStorage(): Storage | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
