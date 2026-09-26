import { getRendererTransport, type RendererTransport } from "./renderer-transport"
import { getServerAccessToken, onServerAccessTokenChange } from "./server-auth-session"

const SERVER_EVENT_ACCESS_PROTOCOL_PREFIX = "simplecrm.access-token."
const DEFAULT_RECONNECT_DELAY_MS = 5000

export type ServerEvent = {
  type: string
  workspaceId: string
  entityType: string
  entityId: string
  actorUserId?: string | null
  occurredAt: string
  sequence?: number
  payload?: Record<string, unknown> | null
}

export type ServerEventSubscription = {
  unsubscribe(): void
}

export type ServerEventSubscriptionOptions = {
  transport?: RendererTransport
  WebSocketImpl?: typeof WebSocket
  getAccessToken?: () => string | null | undefined | Promise<string | null | undefined>
  since?: number
  reconnectDelayMs?: number
  onEvent(event: ServerEvent): void
  onError?(error: unknown): void
}

export function subscribeServerEvents(options: ServerEventSubscriptionOptions): ServerEventSubscription {
  const transport = options.transport ?? getRendererTransport()
  if (transport.kind !== "http" || !transport.serverBaseUrl) return noopSubscription()

  const WebSocketCtor = options.WebSocketImpl ?? globalThis.WebSocket
  if (!WebSocketCtor) return noopSubscription()

  let closed = false
  let socket: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let connectAttempt = 0
  let since = options.since
  const reconnectDelayMs = normalizeReconnectDelay(options.reconnectDelayMs)

  const clearReconnect = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
  }

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== null) return
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      void connect()
    }, reconnectDelayMs)
  }

  const connect = async () => {
    const attempt = ++connectAttempt
    try {
      const token = await (options.getAccessToken
        ? options.getAccessToken()
        : getServerAccessToken(undefined, undefined, transport.serverBaseUrl))
      if (closed || attempt !== connectAttempt) return
      const url = buildServerEventWebSocketUrl(transport.serverBaseUrl!, since)
      const protocols = buildServerEventProtocols(token)
      socket = protocols.length > 0
        ? new WebSocketCtor(url, protocols)
        : new WebSocketCtor(url)
      socket.onmessage = (message) => {
        try {
          const event = JSON.parse(String(message.data)) as ServerEvent
          if (typeof event.sequence === "number") since = event.sequence
          options.onEvent(event)
        } catch (error) {
          options.onError?.(error)
        }
      }
      socket.onerror = (event) => {
        options.onError?.(event)
      }
      socket.onclose = () => {
        socket = null
        scheduleReconnect()
      }
    } catch (error) {
      if (attempt !== connectAttempt) return
      options.onError?.(error)
      scheduleReconnect()
    }
  }

  // The server authorizes the socket with the access token it was opened with and
  // rejects it once that token is rotated or expires. Reconnect with the new token
  // (and the replay cursor) as soon as the session is refreshed.
  const reconnectWithCurrentToken = () => {
    if (closed) return
    clearReconnect()
    const previous = socket
    socket = null
    if (previous) {
      // Detach first: the replaced socket must neither deliver late frames nor
      // schedule a second reconnect from its close.
      previous.onmessage = null
      previous.onerror = null
      previous.onclose = null
      previous.close()
    }
    void connect()
  }
  const stopTokenListener = options.getAccessToken
    ? () => undefined
    : onServerAccessTokenChange(reconnectWithCurrentToken)

  void connect()

  return {
    unsubscribe() {
      closed = true
      stopTokenListener()
      clearReconnect()
      socket?.close()
      socket = null
    },
  }
}

export function buildServerEventWebSocketUrl(baseUrl: string, since?: number): string {
  const url = new URL(baseUrl)
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:"
  url.pathname = "/api/v1/events"
  url.search = ""
  if (typeof since === "number" && Number.isSafeInteger(since) && since >= 0) {
    url.searchParams.set("since", String(since))
  }
  return url.toString()
}

export function buildServerEventProtocols(token: string | null | undefined): string[] {
  const value = token?.trim()
  return value ? [`${SERVER_EVENT_ACCESS_PROTOCOL_PREFIX}${value}`] : []
}

function normalizeReconnectDelay(value: number | undefined): number {
  if (!Number.isFinite(value) || value === undefined || value < 250) return DEFAULT_RECONNECT_DELAY_MS
  return Math.min(value, 60_000)
}

function noopSubscription(): ServerEventSubscription {
  return {
    unsubscribe() {
      /* no-op */
    },
  }
}
