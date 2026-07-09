import type { InvokeChannel } from "@shared/ipc/channels"
import type { InferPayload, InferResult } from "@shared/ipc/types"
import { buildHttpInvocation, type HttpRequestSpec } from "./channel-http-registry"
import { createServerAuthClient } from "./server-auth-client"
import { getServerAccessToken } from "./server-auth-session"

type InvokeArgs<C extends InvokeChannel> = InferPayload<C> extends undefined
  ? []
  : InferPayload<C> extends any[]
    ? InferPayload<C>
    : [InferPayload<C>]

type ElectronInvokeApi = {
  invoke: (channel: InvokeChannel, ...args: any[]) => Promise<any>
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** How many times a 429 is transparently retried before the error surfaces. */
const MAX_RATE_LIMIT_RETRIES = 2
/** Longest we're willing to wait for a 429 window to reset before we stop
 *  retrying and surface the error instead. */
const RATE_LIMIT_RETRY_CAP_MS = 2000

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * How long to back off before replaying a 429, or `null` = don't retry. When
 * the server's `Retry-After` says the window won't reset for longer than the
 * cap, retrying would just hammer a still-closed bucket (amplifying the storm),
 * so we surface the 429 instead. Only transient bursts (no/short Retry-After)
 * are retried.
 */
function rateLimitBackoffMs(response: Response, attempt: number): number | null {
  const headerSeconds = Number(response.headers?.get?.("Retry-After"))
  const serverMs = Number.isFinite(headerSeconds) && headerSeconds > 0 ? headerSeconds * 1000 : 0
  if (serverMs > RATE_LIMIT_RETRY_CAP_MS) return null
  const base = Math.min(serverMs || (attempt + 1) * 400, RATE_LIMIT_RETRY_CAP_MS)
  return base + Math.floor(Math.random() * 250)
}

export type RendererTransportKind = "ipc" | "http"

export type RendererTransport = {
  kind: RendererTransportKind
  serverBaseUrl?: string
  invoke: {
    <C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InferResult<C>>
    (channel: InvokeChannel, ...args: any[]): Promise<any>
  }
}

export type DeployConfigLike = {
  mode?: "standalone" | "server-client" | "server-install"
  server?: {
    baseUrl?: string
  }
} | null

export type HttpRendererTransportOptions = {
  baseUrl: string
  fetchImpl?: FetchLike
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>
}

export type ServerPgpAttachmentDecryptResult = {
  filename: string
  contentType: string | null
  contentBase64: string
  sizeBytes: number
  status: "decrypted"
}

export type ServerPgpAttachmentVerifyResult = {
  valid: boolean
  status: string
  fingerprint?: string
}

export class RendererTransportError extends Error {
  readonly status?: number
  readonly code?: string
  readonly details?: unknown

  constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
    super(message)
    this.name = "RendererTransportError"
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

let configuredTransport: RendererTransport | null = null

export function configureRendererTransport(transport: RendererTransport | null): void {
  configuredTransport = transport
}

export function configureRendererTransportFromDeployConfig(config: DeployConfigLike): RendererTransport {
  if (config?.mode === "server-client" && config.server?.baseUrl) {
    const transport = createHttpRendererTransport({ baseUrl: config.server.baseUrl })
    configureRendererTransport(transport)
    return transport
  }

  const transport = createIpcRendererTransport()
  configureRendererTransport(transport)
  return transport
}

export function resetRendererTransportForTests(): void {
  configuredTransport = null
}

export function getRendererTransport(): RendererTransport {
  if (configuredTransport) return configuredTransport
  return createIpcRendererTransport()
}

export async function invokeRenderer<C extends InvokeChannel>(
  channel: C,
  ...args: InvokeArgs<C>
): Promise<InferResult<C>>
export async function invokeRenderer(channel: InvokeChannel, ...args: any[]): Promise<any>
export async function invokeRenderer(channel: InvokeChannel, ...args: any[]): Promise<any> {
  return getRendererTransport().invoke(channel, ...args)
}

export async function uploadServerComposeAttachment(input: {
  draftMessageId: number
  filename: string
  contentBase64: string
  contentType?: string
}): Promise<{ path: string; filename: string; sizeBytes: number }> {
  const transport = getRendererTransport()
  if (transport.kind !== "http" || !transport.serverBaseUrl) {
    throw new RendererTransportError("Server attachment upload requires HTTP transport", {
      code: "http_transport_required",
    })
  }
  const fetchImpl = globalThis.fetch?.bind(globalThis)
  if (!fetchImpl) {
    throw new RendererTransportError("Fetch API is not available", {
      code: "fetch_unavailable",
    })
  }
  const token = await getAccessToken(undefined)
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetchImpl(
    buildUrl(
      transport.serverBaseUrl,
      `/api/v1/email/messages/${input.draftMessageId}/compose-attachments`,
      undefined,
    ),
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        filename: input.filename,
        contentBase64: input.contentBase64,
        ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
      }),
    },
  )
  const body = await parseResponseBody(response)
  if (!response.ok) throw httpError(response, body)
  const result = unwrapData(body)
  if (!isRecord(result) || typeof result.path !== "string") {
    throw new RendererTransportError("Invalid compose attachment upload response", {
      code: "invalid_response",
      details: result,
    })
  }
  return {
    path: result.path,
    filename: typeof result.filename === "string" ? result.filename : input.filename,
    sizeBytes: typeof result.sizeBytes === "number" ? result.sizeBytes : 0,
  }
}

export async function decryptServerPgpAttachment(input: {
  attachmentId: number
  passphrase: string
}): Promise<ServerPgpAttachmentDecryptResult> {
  const result = await postServerJson<ServerPgpAttachmentDecryptResult>(
    `/api/v1/pgp/attachments/${input.attachmentId}/decrypt`,
    { passphrase: input.passphrase },
  )
  if (!isRecord(result) || typeof result.contentBase64 !== "string" || typeof result.filename !== "string") {
    throw new RendererTransportError("Invalid PGP attachment decrypt response", {
      code: "invalid_response",
      details: result,
    })
  }
  return {
    filename: result.filename,
    contentType: typeof result.contentType === "string" ? result.contentType : null,
    contentBase64: result.contentBase64,
    sizeBytes: typeof result.sizeBytes === "number" ? result.sizeBytes : 0,
    status: result.status === "decrypted" ? result.status : "decrypted",
  }
}

export async function verifyServerPgpAttachment(input: {
  attachmentId: number
  signatureAttachmentId?: number
  signatureBase64?: string
  signerEmail?: string
}): Promise<ServerPgpAttachmentVerifyResult> {
  const result = await postServerJson<ServerPgpAttachmentVerifyResult>(
    `/api/v1/pgp/attachments/${input.attachmentId}/verify`,
    {
      ...(input.signatureAttachmentId === undefined ? {} : { signatureAttachmentId: input.signatureAttachmentId }),
      ...(input.signatureBase64 === undefined ? {} : { signatureBase64: input.signatureBase64 }),
      ...(input.signerEmail === undefined ? {} : { signerEmail: input.signerEmail }),
    },
  )
  if (!isRecord(result) || typeof result.valid !== "boolean" || typeof result.status !== "string") {
    throw new RendererTransportError("Invalid PGP attachment verify response", {
      code: "invalid_response",
      details: result,
    })
  }
  return {
    valid: result.valid,
    status: result.status,
    ...(typeof result.fingerprint === "string" ? { fingerprint: result.fingerprint } : {}),
  }
}

export function createIpcRendererTransport(api: ElectronInvokeApi | undefined = getElectronApi()): RendererTransport {
  const invoke = async (channel: InvokeChannel, ...args: any[]): Promise<any> => {
    if (!api?.invoke) {
      throw new RendererTransportError("Electron IPC transport is not available", {
        code: "ipc_unavailable",
      })
    }
    return api.invoke(channel, ...args)
  }

  return {
    kind: "ipc",
    invoke,
  }
}

export function createHttpRendererTransport(options: HttpRendererTransportOptions): RendererTransport {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis)
  const serverAuth = createServerAuthClient({
    baseUrl,
    device: "simplecrm-renderer",
  })

  const invoke = async (channel: InvokeChannel, ...args: any[]): Promise<any> => {
    if (!fetchImpl) {
      throw new RendererTransportError("Fetch API is not available", {
        code: "fetch_unavailable",
      })
    }

    let token = await getAccessToken(options.getAccessToken)

    const fetchHttp = async (
      requestSpec: HttpRequestSpec,
      retriedAfterRefresh = false,
      rateRetries = 0,
    ): Promise<{ body: unknown; response: Response }> => {
      const url = buildUrl(baseUrl, requestSpec.path, requestSpec.query)
      const headers: Record<string, string> = {
        Accept: requestSpec.responseType === "blob" ? "application/octet-stream, application/json" : "application/json",
      }
      const activeToken = await getAccessToken(options.getAccessToken) ?? token
      if (activeToken) headers.Authorization = `Bearer ${activeToken}`

      const init: RequestInit = {
        method: requestSpec.method,
        headers,
      }

      if (requestSpec.body !== undefined) {
        headers["Content-Type"] = "application/json"
        init.body = JSON.stringify(requestSpec.body)
      }

      const response = await fetchImpl(url, init)

      // A 429 is rejected by the rate limiter BEFORE the handler runs, so no
      // side effect happened and any method is safe to replay. Back off briefly
      // (honoring Retry-After, capped) and retry a couple times so a transient
      // burst — e.g. the chatty mailbox fan-out or rapid spam-marking — self-
      // heals instead of surfacing an error or degrading the viewer to its
      // snippet. A sustained overload still surfaces after the retries.
      if (response.status === 429 && rateRetries < MAX_RATE_LIMIT_RETRIES) {
        const backoff = rateLimitBackoffMs(response, rateRetries)
        if (backoff !== null) {
          await delay(backoff)
          return fetchHttp(requestSpec, retriedAfterRefresh, rateRetries + 1)
        }
      }

      const body = response.ok && requestSpec.responseType === "blob"
        ? await response.blob()
        : await parseResponseBody(response)

      if (response.status === 401 && !retriedAfterRefresh) {
        const refreshed = await serverAuth.refresh()
        if (refreshed) {
          token = refreshed.tokens.accessToken
          return fetchHttp(requestSpec, true)
        }
      }

      if (!response.ok) {
        throw httpError(response, body)
      }

      return { body, response }
    }

    const fetchJson = async (requestSpec: HttpRequestSpec): Promise<unknown> => {
      return (await fetchHttp(requestSpec)).body
    }

    const spec = buildHttpInvocation(channel, args)
    const { body, response } = await fetchHttp(spec)

    return spec.transform ? await spec.transform(body, { fetchJson, response }) : unwrapData(body)
  }

  return {
    kind: "http",
    serverBaseUrl: baseUrl,
    invoke,
  }
}

function getElectronApi(): ElectronInvokeApi | undefined {
  return typeof window === "undefined" ? undefined : window.electronAPI
}

async function postServerJson<T>(path: string, bodyValue: Record<string, unknown>): Promise<T> {
  const transport = getRendererTransport()
  if (transport.kind !== "http" || !transport.serverBaseUrl) {
    throw new RendererTransportError("Server request requires HTTP transport", {
      code: "http_transport_required",
    })
  }
  const fetchImpl = globalThis.fetch?.bind(globalThis)
  if (!fetchImpl) {
    throw new RendererTransportError("Fetch API is not available", {
      code: "fetch_unavailable",
    })
  }
  const token = await getAccessToken(undefined)
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  }
  if (token) headers.Authorization = `Bearer ${token}`

  const response = await fetchImpl(
    buildUrl(transport.serverBaseUrl, path, undefined),
    {
      method: "POST",
      headers,
      body: JSON.stringify(bodyValue),
    },
  )
  const responseBody = await parseResponseBody(response)
  if (!response.ok) throw httpError(response, responseBody)
  return unwrapData(responseBody) as T
}

async function getAccessToken(
  provider: HttpRendererTransportOptions["getAccessToken"],
): Promise<string | null | undefined> {
  if (provider) return provider()
  return getServerAccessToken()
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RendererTransportError("Server URL must use http or https", {
      code: "invalid_base_url",
    })
  }
  return url.toString().replace(/\/+$/, "")
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: Record<string, string | number | boolean | null | undefined> | undefined,
): string {
  const url = new URL(`${baseUrl}${path.startsWith("/") ? path : `/${path}`}`)
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined || value === null || value === "") continue
    url.searchParams.set(key, String(value))
  }
  return url.toString()
}

async function parseResponseBody(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text.trim()) return undefined
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function httpError(response: Response, body: unknown): RendererTransportError {
  const apiError = getApiError(body)
  return new RendererTransportError(
    apiError?.message ?? `HTTP request failed with status ${response.status}`,
    {
      status: response.status,
      code: apiError?.code ?? "http_error",
      details: apiError?.details ?? body,
    },
  )
}

function getApiError(body: unknown): { code?: string; message?: string; details?: unknown } | null {
  if (!isRecord(body) || !isRecord(body.error)) return null
  return body.error as { code?: string; message?: string; details?: unknown }
}

function unwrapData(body: unknown): unknown {
  if (isRecord(body) && "data" in body) return body.data
  return body
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
