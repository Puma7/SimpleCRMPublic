import type { AuthMfaMethod } from "@shared/auth-login-security"
import {
  buildServerAuthSession,
  clearServerAuthSession,
  getServerAccessToken,
  getServerRefreshToken,
  readServerAuthSession,
  saveServerAuthSession,
  type BrowserStorageLike,
  type ServerAuthSession,
  type ServerAuthUser,
  type ServerTokenPair,
} from "./server-auth-session"

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

export type ServerAuthClientOptions = {
  baseUrl: string
  device?: string
  fetchImpl?: FetchLike
  storage?: BrowserStorageLike | null
  accessTokenStorage?: BrowserStorageLike | null
  now?: () => Date
}

export type ServerLoginConfig = {
  captcha: {
    enabled: boolean
    provider: "turnstile" | null
    siteKey: string | null
  }
  pinKeypad: {
    enabled: boolean
  }
  mfa: {
    enabled: boolean
    methods: AuthMfaMethod[]
  }
  user: {
    pinRequired: boolean
    mfaRequired: boolean
    mfaMethod: AuthMfaMethod | null
  } | null
}

export type ServerLoginResult =
  | { kind: "session"; session: ServerAuthSession }
  | {
      kind: "mfa_required"
      mfaMethod: AuthMfaMethod
      mfaChallengeToken: string
    }

export type ServerAuthSecuritySettings = {
  captchaEnabled: boolean
  pinKeypadEnabled: boolean
  mfaEnabled: boolean
  mfaTotpEnabled: boolean
  mfaEmailEnabled: boolean
}

export type ServerAuthClient = {
  getSetupState(): Promise<ServerAuthSetupState>
  getLoginConfig(email?: string): Promise<ServerLoginConfig>
  verifyCaptcha(token: string): Promise<string>
  createInitialOwner(input: ServerInitialOwnerInput): Promise<ServerAuthSession>
  getInvitation(token: string): Promise<ServerAuthInvitation>
  acceptInvitation(token: string, input: ServerInvitationAcceptInput): Promise<ServerAuthSession>
  login(email: string, password: string): Promise<ServerAuthSession>
  loginAdvanced(input: {
    email: string
    password: string
    pin?: string
    captchaChallenge?: string
  }): Promise<ServerLoginResult>
  verifyMfa(input: { mfaChallengeToken: string; code: string }): Promise<ServerAuthSession>
  getSecuritySettings(accessToken: string): Promise<{
    settings: ServerAuthSecuritySettings
    captchaProviderConfigured: boolean
    currentUser: {
      loginPinEnabled: boolean
      mfaEnabled: boolean
    }
  }>
  patchSecuritySettings(
    accessToken: string,
    settings: ServerAuthSecuritySettings,
  ): Promise<{
    settings: ServerAuthSecuritySettings
    currentUser: {
      loginPinEnabled: boolean
      mfaEnabled: boolean
    }
  }>
  beginUserTotpSetup(
    accessToken: string,
    userId: string,
  ): Promise<{ secret: string; otpauthUri: string }>
  confirmUserTotpSetup(
    accessToken: string,
    userId: string,
    input: { secret: string; code: string },
  ): Promise<{ enabled: boolean; method: "totp" }>
  enableUserEmailMfa(accessToken: string, userId: string): Promise<{ enabled: boolean; method: "email" }>
  disableUserMfa(accessToken: string, userId: string): Promise<{ enabled: boolean }>
  refresh(): Promise<ServerAuthSession | null>
  logout(): Promise<{ revoked: boolean }>
  getSession(): ServerAuthSession | null
}

export type ServerAuthSetupState = {
  needsInitialSetup: boolean
}

export type ServerInitialOwnerInput = {
  email: string
  password: string
  displayName?: string
  workspaceName?: string
  setupToken: string
}

export type ServerAuthInvitation = {
  id: string
  email: string
  displayName: string
  role: ServerAuthUser["role"]
  expiresAt: string
  acceptedAt?: string | null
  revokedAt?: string | null
}

export type ServerInvitationAcceptInput = {
  password: string
}

type AuthResponseBody = {
  user: ServerAuthUser
  tokens: ServerTokenPair
}

type LoginResponseBody = AuthResponseBody | {
  mfaRequired: true
  mfaMethod: AuthMfaMethod
  mfaChallengeToken: string
}

export class ServerAuthClientError extends Error {
  readonly status?: number
  readonly code?: string
  readonly details?: unknown

  constructor(message: string, options: { status?: number; code?: string; details?: unknown } = {}) {
    super(message)
    this.name = "ServerAuthClientError"
    this.status = options.status
    this.code = options.code
    this.details = options.details
  }
}

export function createServerAuthClient(options: ServerAuthClientOptions): ServerAuthClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis)

  return {
    async getSetupState(): Promise<ServerAuthSetupState> {
      return request<ServerAuthSetupState>(fetchImpl, baseUrl, "/api/v1/auth/setup-state", {
        method: "GET",
      })
    },

    async getLoginConfig(email?: string): Promise<ServerLoginConfig> {
      const query = email?.trim() ? `?email=${encodeURIComponent(email.trim().toLowerCase())}` : ""
      return request<ServerLoginConfig>(fetchImpl, baseUrl, `/api/v1/auth/login-config${query}`, {
        method: "GET",
      })
    },

    async verifyCaptcha(token: string): Promise<string> {
      const body = await request<{ challenge: string }>(fetchImpl, baseUrl, "/api/v1/auth/captcha-verify", {
        method: "POST",
        body: { token },
      })
      return body.challenge
    },

    async createInitialOwner(input: ServerInitialOwnerInput): Promise<ServerAuthSession> {
      const body = await request<AuthResponseBody>(fetchImpl, baseUrl, "/api/v1/auth/initial-setup", {
        method: "POST",
        body: {
          email: input.email,
          password: input.password,
          displayName: input.displayName ?? input.email,
          workspaceName: input.workspaceName ?? "SimpleCRM",
          initialSetupToken: input.setupToken,
          ...(options.device ? { device: options.device } : {}),
        },
      })
      const session = buildServerAuthSession({
        user: body.user,
        tokens: body.tokens,
        now: options.now?.(),
      })
      saveServerAuthSession(session, options.storage, options.accessTokenStorage)
      return session
    },

    async getInvitation(token: string): Promise<ServerAuthInvitation> {
      return request<ServerAuthInvitation>(
        fetchImpl,
        baseUrl,
        `/api/v1/auth/invitations/${encodeURIComponent(token)}`,
        { method: "GET" },
      )
    },

    async acceptInvitation(token: string, input: ServerInvitationAcceptInput): Promise<ServerAuthSession> {
      const body = await request<AuthResponseBody>(
        fetchImpl,
        baseUrl,
        `/api/v1/auth/invitations/${encodeURIComponent(token)}/accept`,
        {
          method: "POST",
          body: {
            password: input.password,
            ...(options.device ? { device: options.device } : {}),
          },
        },
      )
      const session = buildServerAuthSession({
        user: body.user,
        tokens: body.tokens,
        now: options.now?.(),
      })
      saveServerAuthSession(session, options.storage, options.accessTokenStorage)
      return session
    },

    async login(email: string, password: string): Promise<ServerAuthSession> {
      const result = await this.loginAdvanced({ email, password })
      if (result.kind !== "session") {
        throw new ServerAuthClientError("Zweiter Faktor erforderlich", { code: "mfa_required" })
      }
      return result.session
    },

    async loginAdvanced(input): Promise<ServerLoginResult> {
      const body = await request<LoginResponseBody>(fetchImpl, baseUrl, "/api/v1/auth/login", {
        method: "POST",
        body: {
          email: input.email,
          password: input.password,
          ...(input.pin ? { pin: input.pin } : {}),
          ...(input.captchaChallenge ? { captchaChallenge: input.captchaChallenge } : {}),
          ...(options.device ? { device: options.device } : {}),
        },
      })
      if ("mfaRequired" in body && body.mfaRequired) {
        return {
          kind: "mfa_required",
          mfaMethod: body.mfaMethod,
          mfaChallengeToken: body.mfaChallengeToken,
        }
      }
      if (!("user" in body) || !("tokens" in body)) {
        throw new ServerAuthClientError("Ungueltige Login-Antwort", { code: "invalid_login_response" })
      }
      const session = buildServerAuthSession({
        user: body.user,
        tokens: body.tokens,
        now: options.now?.(),
      })
      saveServerAuthSession(session, options.storage, options.accessTokenStorage)
      return { kind: "session", session }
    },

    async verifyMfa(input): Promise<ServerAuthSession> {
      const body = await request<AuthResponseBody>(fetchImpl, baseUrl, "/api/v1/auth/mfa/verify", {
        method: "POST",
        body: {
          mfaChallengeToken: input.mfaChallengeToken,
          code: input.code,
          ...(options.device ? { device: options.device } : {}),
        },
      })
      const session = buildServerAuthSession({
        user: body.user,
        tokens: body.tokens,
        now: options.now?.(),
      })
      saveServerAuthSession(session, options.storage, options.accessTokenStorage)
      return session
    },

    async getSecuritySettings(accessToken) {
      return request(fetchImpl, baseUrl, "/api/v1/auth/security-settings", {
        method: "GET",
        accessToken,
      })
    },

    async patchSecuritySettings(accessToken, settings) {
      return request(fetchImpl, baseUrl, "/api/v1/auth/security-settings", {
        method: "PATCH",
        accessToken,
        body: settings,
      })
    },

    async beginUserTotpSetup(accessToken, userId) {
      return request(fetchImpl, baseUrl, `/api/v1/auth/users/${encodeURIComponent(userId)}/mfa/totp/setup`, {
        method: "POST",
        accessToken,
      })
    },

    async confirmUserTotpSetup(accessToken, userId, input) {
      return request(fetchImpl, baseUrl, `/api/v1/auth/users/${encodeURIComponent(userId)}/mfa/totp/confirm`, {
        method: "POST",
        accessToken,
        body: input,
      })
    },

    async enableUserEmailMfa(accessToken, userId) {
      return request(fetchImpl, baseUrl, `/api/v1/auth/users/${encodeURIComponent(userId)}/mfa/email`, {
        method: "POST",
        accessToken,
      })
    },

    async disableUserMfa(accessToken, userId) {
      return request(fetchImpl, baseUrl, `/api/v1/auth/users/${encodeURIComponent(userId)}/mfa`, {
        method: "DELETE",
        accessToken,
      })
    },

    async refresh(): Promise<ServerAuthSession | null> {
      const refreshToken = getServerRefreshToken(options.storage)
      if (!refreshToken) return null
      try {
        const body = await request<AuthResponseBody>(fetchImpl, baseUrl, "/api/v1/auth/refresh", {
          method: "POST",
          body: { refreshToken },
        })
        const session = buildServerAuthSession({
          user: body.user,
          tokens: body.tokens,
          now: options.now?.(),
        })
        saveServerAuthSession(session, options.storage, options.accessTokenStorage)
        return session
      } catch (error) {
        if (error instanceof ServerAuthClientError && error.status === 401) {
          clearServerAuthSession(options.storage, options.accessTokenStorage)
        }
        throw error
      }
    },

    async logout(): Promise<{ revoked: boolean }> {
      const refreshToken = getServerRefreshToken(options.storage)
      if (!refreshToken) {
        clearServerAuthSession(options.storage, options.accessTokenStorage)
        return { revoked: false }
      }
      try {
        const accessToken = getServerAccessToken(options.storage, options.accessTokenStorage)
        return await request<{ revoked: boolean }>(fetchImpl, baseUrl, "/api/v1/auth/logout", {
          method: "POST",
          body: { refreshToken },
          accessToken,
        })
      } finally {
        clearServerAuthSession(options.storage, options.accessTokenStorage)
      }
    },

    getSession(): ServerAuthSession | null {
      return readServerAuthSession(options.storage)
    },
  }
}

async function request<T>(
  fetchImpl: FetchLike | undefined,
  baseUrl: string,
  path: string,
  options: {
    method: "GET" | "POST" | "PATCH" | "DELETE"
    body?: unknown
    accessToken?: string | null
  },
): Promise<T> {
  if (!fetchImpl) {
    throw new ServerAuthClientError("Fetch API is not available", {
      code: "fetch_unavailable",
    })
  }
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  }
  if (options.accessToken) headers.Authorization = `Bearer ${options.accessToken}`
  const response = await fetchImpl(new URL(path, baseUrl).toString(), {
    method: options.method,
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
  })
  const body = await parseResponseBody(response)
  if (!response.ok) {
    throw authError(response, body)
  }
  return unwrapData<T>(body)
}

function normalizeBaseUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ServerAuthClientError("Server URL must use http or https", {
      code: "invalid_base_url",
    })
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

function unwrapData<T>(body: unknown): T {
  if (isRecord(body) && "data" in body) return body.data as T
  return body as T
}

function authError(response: Response, body: unknown): ServerAuthClientError {
  const apiError = getApiError(body)
  return new ServerAuthClientError(
    apiError?.message ?? `HTTP auth request failed with status ${response.status}`,
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value)
}
