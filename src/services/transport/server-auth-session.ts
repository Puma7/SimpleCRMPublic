export const SERVER_AUTH_SESSION_STORAGE_KEY = "simplecrm.serverAuthSession.v1"
export const SERVER_ACCESS_TOKEN_STORAGE_KEY = "simplecrm.accessToken"

export type ServerAuthUser = {
  id: string
  workspaceId: string
  email: string
  displayName: string
  role: string
}

export type ServerTokenPair = {
  accessToken: string
  refreshToken: string
  expiresInSeconds: number
}

export type ServerAuthSession = {
  user: ServerAuthUser
  tokens: ServerTokenPair
  savedAt: string
  expiresAt: string
}

export type BrowserStorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">

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
  storage: BrowserStorageLike | null = getPersistentStorage(),
  accessTokenStorage: BrowserStorageLike | null = getAccessTokenStorage(),
): void {
  storage?.setItem(SERVER_AUTH_SESSION_STORAGE_KEY, JSON.stringify(session))
  accessTokenStorage?.setItem(SERVER_ACCESS_TOKEN_STORAGE_KEY, session.tokens.accessToken)
}

export function readServerAuthSession(
  storage: BrowserStorageLike | null = getPersistentStorage(),
): ServerAuthSession | null {
  const raw = storage?.getItem(SERVER_AUTH_SESSION_STORAGE_KEY)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw)
    return isServerAuthSession(parsed) ? parsed : null
  } catch {
    return null
  }
}

export function clearServerAuthSession(
  storage: BrowserStorageLike | null = getPersistentStorage(),
  accessTokenStorage: BrowserStorageLike | null = getAccessTokenStorage(),
): void {
  storage?.removeItem(SERVER_AUTH_SESSION_STORAGE_KEY)
  accessTokenStorage?.removeItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)
}

export function getServerAccessToken(
  storage: BrowserStorageLike | null = getPersistentStorage(),
  accessTokenStorage: BrowserStorageLike | null = getAccessTokenStorage(),
): string | null {
  const accessToken = accessTokenStorage?.getItem(SERVER_ACCESS_TOKEN_STORAGE_KEY)
  if (accessToken) return accessToken
  return readServerAuthSession(storage)?.tokens.accessToken ?? null
}

export function getServerRefreshToken(
  storage: BrowserStorageLike | null = getPersistentStorage(),
): string | null {
  return readServerAuthSession(storage)?.tokens.refreshToken ?? null
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

function isServerAuthSession(value: unknown): value is ServerAuthSession {
  if (!isRecord(value) || !isRecord(value.user) || !isRecord(value.tokens)) return false
  return (
    typeof value.user.id === "string" &&
    typeof value.user.workspaceId === "string" &&
    typeof value.user.email === "string" &&
    typeof value.user.displayName === "string" &&
    typeof value.user.role === "string" &&
    typeof value.tokens.accessToken === "string" &&
    typeof value.tokens.refreshToken === "string" &&
    typeof value.tokens.expiresInSeconds === "number" &&
    typeof value.savedAt === "string" &&
    typeof value.expiresAt === "string"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
