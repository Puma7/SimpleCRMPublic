import type { InvokeChannel } from "@shared/ipc/channels"
import type { InferPayload, InferResult } from "@shared/ipc/types"
import type { HttpRequestSpec } from "./channel-http-registry"
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
 * The HTTP route registry (`channel-http-registry`, ~6.6k LOC) is only needed
 * by the HTTP transport. The desktop/Electron edition uses the IPC transport
 * and never touches it, so we load the registry lazily via dynamic import() —
 * this keeps it out of the renderer's entry bundle as its own async chunk,
 * fetched once on the first HTTP invocation. See plans/018.
 */
type ChannelHttpRegistryModule = typeof import("./channel-http-registry")
let channelHttpRegistryPromise: Promise<ChannelHttpRegistryModule> | null = null
function loadChannelHttpRegistry(): Promise<ChannelHttpRegistryModule> {
  if (!channelHttpRegistryPromise) {
    // Clear the cached promise if the dynamic import() REJECTS, so a single
    // failed chunk load (e.g. a transient network error) does not permanently
    // poison every later HTTP invocation — the next call retries the import.
    channelHttpRegistryPromise = import("./channel-http-registry").catch((err) => {
      channelHttpRegistryPromise = null
      throw err
    })
  }
  return channelHttpRegistryPromise
}

/**
 * How long to back off before replaying a 429, or `null` = don't retry.
 *
 * Only the global pre-handler limiter sets `Retry-After`, and its 429s are safe
 * to replay: the request is rejected before the handler runs (no side effect)
 * and the fixed window reopens on a timer. Route-level limiters (e.g. the public
 * returns-portal limiter) return a 429 WITHOUT the header; replaying those just
 * hammers a bucket that won't reopen inside our short window, so we require the
 * header's presence before retrying. When it says the window won't reset within
 * the cap, we also surface the 429 rather than amplify a sustained overload.
 */
function rateLimitBackoffMs(response: Response, _attempt: number): number | null {
  const rawHeader = response.headers?.get?.("Retry-After")
  if (rawHeader == null || rawHeader === "") return null
  const headerSeconds = Number(rawHeader)
  if (!Number.isFinite(headerSeconds) || headerSeconds <= 0) return null
  const serverMs = headerSeconds * 1000
  if (serverMs > RATE_LIMIT_RETRY_CAP_MS) return null
  const base = Math.min(serverMs, RATE_LIMIT_RETRY_CAP_MS)
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
  const { body } = await authorizedServerFetch(
    transport.serverBaseUrl,
    `/api/v1/email/messages/${input.draftMessageId}/compose-attachments`,
    {
      method: "POST",
      body: JSON.stringify({
        filename: input.filename,
        contentBase64: input.contentBase64,
        ...(input.contentType === undefined ? {} : { contentType: input.contentType }),
      }),
    },
  )
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
    // Thread the caller-supplied fetch (tests, custom deployments) into the
    // refresh client too, so the 401 self-heal uses the same transport as the
    // request that failed rather than falling back to globalThis.fetch.
    ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
  })
  // Only self-heal an expired access token when we own the token source
  // (default, storage-backed). A caller that supplies its own getAccessToken
  // opts out, so we never fight a custom provider's lifecycle.
  const canAutoRefresh = options.getAccessToken === undefined

  const invoke = async (channel: InvokeChannel, ...args: any[]): Promise<any> => {
    if (!fetchImpl) {
      throw new RendererTransportError("Fetch API is not available", {
        code: "fetch_unavailable",
      })
    }
    let token = await getAccessToken(options.getAccessToken, baseUrl)

    const fetchHttp = async (
      requestSpec: HttpRequestSpec,
      retriedAfterRefresh = false,
      rateRetries = 0,
    ): Promise<{ body: unknown; response: Response }> => {
      const url = buildUrl(baseUrl, requestSpec.path, requestSpec.query)
      const headers: Record<string, string> = {
        Accept: requestSpec.responseType === "blob" ? "application/octet-stream, application/json" : "application/json",
      }
      const activeToken = await getAccessToken(options.getAccessToken, baseUrl) ?? token
      if (activeToken) headers.Authorization = `Bearer ${activeToken}`

      const init: RequestInit = {
        method: requestSpec.method,
        headers,
        credentials: "include",
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

      if (response.status === 401 && !retriedAfterRefresh && canAutoRefresh) {
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

    const { buildHttpInvocation } = await loadChannelHttpRegistry()
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

// Authenticated one-shot server request that self-heals an expired access
// token: on a 401, refresh the session once and replay with the fresh bearer
// token. Shared by the sibling helpers (postServerJson, attachment upload) so
// they get the same self-heal as the invoke() transport instead of throwing on
// a stale token. Throws httpError on a non-ok response (after the retry).
async function authorizedServerFetch(
  baseUrl: string,
  path: string,
  init: { method: string; body?: string },
): Promise<{ body: unknown; response: Response }> {
  const fetchImpl = globalThis.fetch?.bind(globalThis)
  if (!fetchImpl) {
    throw new RendererTransportError("Fetch API is not available", {
      code: "fetch_unavailable",
    })
  }
  const url = buildUrl(baseUrl, path, undefined)
  const send = async (token: string | null | undefined): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: "application/json",
      "Content-Type": "application/json",
    }
    if (token) headers.Authorization = `Bearer ${token}`
    return fetchImpl(url, {
      method: init.method,
      headers,
      credentials: "include",
      ...(init.body === undefined ? {} : { body: init.body }),
    })
  }

  let response = await send(await getAccessToken(undefined, baseUrl))
  if (response.status === 401) {
    const serverAuth = createServerAuthClient({ baseUrl, device: "simplecrm-renderer" })
    const refreshed = await serverAuth.refresh()
    if (refreshed) response = await send(refreshed.tokens.accessToken)
  }

  const body = await parseResponseBody(response)
  if (!response.ok) throw httpError(response, body)
  return { body, response }
}

async function postServerJson<T>(path: string, bodyValue: Record<string, unknown>): Promise<T> {
  const transport = getRendererTransport()
  if (transport.kind !== "http" || !transport.serverBaseUrl) {
    throw new RendererTransportError("Server request requires HTTP transport", {
      code: "http_transport_required",
    })
  }
  const { body } = await authorizedServerFetch(transport.serverBaseUrl, path, {
    method: "POST",
    body: JSON.stringify(bodyValue),
  })
  return unwrapData(body) as T
}

async function getAccessToken(
  provider: HttpRendererTransportOptions["getAccessToken"],
  baseUrl: string,
): Promise<string | null | undefined> {
  if (provider) return provider()
  return getServerAccessToken(undefined, undefined, baseUrl)
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
