/** Legacy keys are retained only so one upgrade can remove old bearer tokens. */
export const SERVER_AUTH_SESSION_STORAGE_KEY = "simplecrm.serverAuthSession.v1"
export const SERVER_ACCESS_TOKEN_STORAGE_KEY = "simplecrm.accessToken"
export const SERVER_CSRF_TOKEN_STORAGE_KEY = "simplecrm.serverCsrf.v1"

export type ServerAuthUser = {
  id: string
  workspaceId: string
  email: string
  displayName: string
  role: string
}

/** Refresh tokens are HttpOnly cookies and are intentionally absent here. */
export type ServerTokenPair = {
  accessToken: string
  expiresInSeconds: number
}

export type ServerAuthSession = {
  user: ServerAuthUser
  tokens: ServerTokenPair
  savedAt: string
  expiresAt: string
}

export type BrowserStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

type StoredServerCsrfToken = {
  version: 1
  origin: string
  token: string
}

let activeSession: ServerAuthSession | null = null
let activeSessionOrigin: string | null = null

export function buildServerAuthSession(input: {
  user: ServerAuthUser
  tokens: ServerTokenPair
  now?: Date
}): ServerAuthSession {
  const now = input.now ?? new Date()
  return {
    user: input.user,
    tokens: input.tokens,
    savedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + input.tokens.expiresInSeconds * 1000).toISOString(),
  }
}

export function saveServerAuthSession(
  session: ServerAuthSession,
  csrfToken: string,
  storage: BrowserStorageLike | null = getPersistentStorage(),
  accessTokenStorage: BrowserStorageLike | null = getAccessTokenStorage(),
  serverUrl?: string | null,
): void {
  activeSession = session
  activeSessionOrigin = normalizeServerOrigin(serverUrl)
  // Remove tokens written by pre-cookie releases as soon as a new session is accepted.
  storage?.removeItem(SERVER_AUTH_SESSION_STORAGE_KEY)
  accessTokenStorage?.removeItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)
  saveServerCsrfToken(csrfToken, storage, serverUrl)
}

export function readServerAuthSession(
  _storage: BrowserStorageLike | null = getPersistentStorage(),
  serverUrl?: string | null,
): ServerAuthSession | null {
  return sessionMatchesOrigin(serverUrl) ? activeSession : null
}

export function clearServerAuthSession(
  storage: BrowserStorageLike | null = getPersistentStorage(),
  accessTokenStorage: BrowserStorageLike | null = getAccessTokenStorage(),
  serverUrl?: string | null,
): void {
  if (sessionMatchesOrigin(serverUrl)) {
    activeSession = null
    activeSessionOrigin = null
    storage?.removeItem(SERVER_AUTH_SESSION_STORAGE_KEY)
    accessTokenStorage?.removeItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)
  }
  clearServerCsrfToken(storage, serverUrl)
}

export function getServerAccessToken(
  _storage: BrowserStorageLike | null = getPersistentStorage(),
  _accessTokenStorage: BrowserStorageLike | null = getAccessTokenStorage(),
  serverUrl?: string | null,
): string | null {
  return sessionMatchesOrigin(serverUrl) ? activeSession?.tokens.accessToken ?? null : null
}

export function readServerCsrfToken(
  storage: BrowserStorageLike | null = getPersistentStorage(),
  serverUrl?: string | null,
): string | null {
  const raw = storage?.getItem(SERVER_CSRF_TOKEN_STORAGE_KEY)?.trim()
  if (!raw) return null
  const origin = normalizeServerOrigin(serverUrl)
  if (origin === null) return raw
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!isRecord(parsed)) return null
    return parsed.version === 1
      && parsed.origin === origin
      && typeof parsed.token === "string"
      && parsed.token.trim()
      ? parsed.token.trim()
      : null
  } catch {
    return null
  }
}

export function saveServerCsrfToken(
  csrfToken: string,
  storage: BrowserStorageLike | null = getPersistentStorage(),
  serverUrl?: string | null,
): void {
  const normalized = csrfToken.trim()
  if (!normalized) {
    clearServerCsrfToken(storage, serverUrl)
    return
  }
  const origin = normalizeServerOrigin(serverUrl)
  const value: string | StoredServerCsrfToken = origin === null
    ? normalized
    : { version: 1, origin, token: normalized }
  storage?.setItem(
    SERVER_CSRF_TOKEN_STORAGE_KEY,
    typeof value === "string" ? value : JSON.stringify(value),
  )
}

/** Read a pre-cookie refresh token once; callers remove it only after successful migration. */
export function readLegacyServerRefreshToken(
  storage: BrowserStorageLike | null = getPersistentStorage(),
): string | null {
  const raw = storage?.getItem(SERVER_AUTH_SESSION_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    if (!isRecord(parsed) || !isRecord(parsed.tokens)) return null
    const token = parsed.tokens.refreshToken
    return typeof token === "string" && token.trim() ? token.trim() : null
  } catch {
    return null
  }
}

function getPersistentStorage(): BrowserStorageLike | null {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function getAccessTokenStorage(): BrowserStorageLike | null {
  if (typeof window === "undefined") return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}

function sessionMatchesOrigin(serverUrl: string | null | undefined): boolean {
  const requestedOrigin = normalizeServerOrigin(serverUrl)
  return requestedOrigin === null || activeSessionOrigin === null || requestedOrigin === activeSessionOrigin
}

function clearServerCsrfToken(
  storage: BrowserStorageLike | null,
  serverUrl: string | null | undefined,
): void {
  const origin = normalizeServerOrigin(serverUrl)
  if (origin === null) {
    storage?.removeItem(SERVER_CSRF_TOKEN_STORAGE_KEY)
    return
  }
  const raw = storage?.getItem(SERVER_CSRF_TOKEN_STORAGE_KEY)?.trim()
  if (!raw) return
  try {
    const parsed: unknown = JSON.parse(raw)
    if (isRecord(parsed) && parsed.version === 1 && parsed.origin !== origin) return
  } catch {
    // Legacy unscoped CSRF values must not survive an origin-aware clear.
  }
  storage?.removeItem(SERVER_CSRF_TOKEN_STORAGE_KEY)
}

function normalizeServerOrigin(serverUrl: string | null | undefined): string | null {
  if (!serverUrl?.trim()) return null
  try {
    return new URL(serverUrl).origin
  } catch {
    return `invalid:${serverUrl.trim()}`
  }
}
