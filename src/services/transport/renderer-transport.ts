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
    const boundFetch = fetchImpl

    const sendOnce = async (requestSpec: HttpRequestSpec): Promise<Response> => {
      // Read the token per attempt (not once per invocation) so a retry after a
      // refresh actually carries the new bearer token.
      const token = await getAccessToken(options.getAccessToken)
      const url = buildUrl(baseUrl, requestSpec.path, requestSpec.query)
      const headers: Record<string, string> = {
        Accept: requestSpec.responseType === "blob" ? "application/octet-stream, application/json" : "application/json",
      }
      if (token) headers.Authorization = `Bearer ${token}`

      const init: RequestInit = {
        method: requestSpec.method,
        headers,
      }

      if (requestSpec.body !== undefined) {
        headers["Content-Type"] = "application/json"
        init.body = JSON.stringify(requestSpec.body)
      }

      return boundFetch(url, init)
    }

    const fetchHttp = async (requestSpec: HttpRequestSpec): Promise<{ body: unknown; response: Response }> => {
      // Self-heal a stale/expired access token on THIS request only: on a 401,
      // refresh the session once (single-flight) and replay just this request.
      // Retrying per-request — instead of the whole invocation — means a
      // multi-request transform never re-issues an earlier sub-request that
      // already mutated state. A 401 is rejected before any server-side write,
      // so replaying the single failed request is safe.
      let response = await sendOnce(requestSpec)
      if (
        !response.ok &&
        response.status === 401 &&
        canAutoRefresh &&
        (await refreshServerSessionOnce(baseUrl, boundFetch))
      ) {
        response = await sendOnce(requestSpec)
      }

      const body = response.ok && requestSpec.responseType === "blob"
        ? await response.blob()
        : await parseResponseBody(response)
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

// Single-flight token refresh: a burst of concurrent 401s (e.g. the inbox
// firing several requests at once) shares ONE /auth/refresh round-trip instead
// of stampeding the endpoint. Resolves true when a fresh session was stored.
let serverSessionRefreshInFlight: Promise<boolean> | null = null
function refreshServerSessionOnce(baseUrl: string, fetchImpl: FetchLike): Promise<boolean> {
  if (!serverSessionRefreshInFlight) {
    serverSessionRefreshInFlight = (async () => {
      try {
        const client = createServerAuthClient({
          baseUrl,
          device: "simplecrm-renderer",
          fetchImpl,
        })
        const session = await client.refresh()
        return session !== null
      } catch {
        // refresh() clears the stored session on a 401 (refresh token dead);
        // report failure so the original 401 surfaces and the app re-auths.
        return false
      } finally {
        serverSessionRefreshInFlight = null
      }
    })()
  }
  return serverSessionRefreshInFlight
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
