import type { ApiRequest, ApiResponse, AuthSecurityWorkspaceSettings, ServerApiPorts } from './types';
import {
  data,
  error,
  getStringField,
  requireAdmin,
  requirePrincipal,
} from './http';
import { authSessionData } from './auth-session-cookie';

export async function handleAuthSecurityRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (req.path === '/api/v1/auth/login-config') {
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleLoginConfig(req, ports);
  }
  if (req.path === '/api/v1/auth/captcha-verify') {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleCaptchaVerify(req, ports);
  }
  if (req.path === '/api/v1/auth/mfa/verify') {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleMfaVerify(req, ports);
  }
  if (req.path === '/api/v1/auth/security-settings') {
    if (req.method === 'GET') return handleGetSecuritySettings(req, ports);
    if (req.method === 'PATCH') return handlePatchSecuritySettings(req, ports);
    return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  }
  const totpSetupMatch = req.path.match(/^\/api\/v1\/auth\/users\/([^/]+)\/mfa\/totp\/setup$/);
  if (totpSetupMatch) {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleTotpSetup(req, ports, decodeURIComponent(totpSetupMatch[1] ?? ''));
  }
  const totpConfirmMatch = req.path.match(/^\/api\/v1\/auth\/users\/([^/]+)\/mfa\/totp\/confirm$/);
  if (totpConfirmMatch) {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleTotpConfirm(req, ports, decodeURIComponent(totpConfirmMatch[1] ?? ''));
  }
  const emailMfaMatch = req.path.match(/^\/api\/v1\/auth\/users\/([^/]+)\/mfa\/email$/);
  if (emailMfaMatch) {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleEnableEmailMfa(req, ports, decodeURIComponent(emailMfaMatch[1] ?? ''));
  }
  const disableMfaMatch = req.path.match(/^\/api\/v1\/auth\/users\/([^/]+)\/mfa$/);
  if (disableMfaMatch) {
    if (req.method !== 'DELETE') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleDisableMfa(req, ports, decodeURIComponent(disableMfaMatch[1] ?? ''));
  }
  return null;
}

async function handleLoginConfig(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (!ports.loginSecurity) {
    return data(200, {
      captcha: { enabled: false, provider: null, siteKey: null },
      pinKeypad: { enabled: false },
      mfa: { enabled: false, methods: [] },
      user: null,
    });
  }
  const config = await ports.loginSecurity.getLoginConfig();
  return data(200, config);
}

async function handleCaptchaVerify(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (!ports.loginSecurity) {
    return error(503, 'login_security_unavailable', 'Login-Sicherheit ist nicht konfiguriert');
  }
  const token = getStringField(req.body, 'token');
  if (!token) return error(400, 'validation_error', 'token ist erforderlich');
  const result = await ports.loginSecurity.verifyCaptcha({
    token,
    ip: req.ip ?? '0.0.0.0',
  });
  if (!result.ok) {
    return error(403, 'captcha_failed', 'CAPTCHA konnte nicht bestaetigt werden', { code: result.code });
  }
  return data(200, { challenge: result.challenge });
}

async function handleMfaVerify(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (!ports.loginSecurity) {
    return error(503, 'login_security_unavailable', 'Login-Sicherheit ist nicht konfiguriert');
  }
  const mfaChallengeToken = getStringField(req.body, 'mfaChallengeToken');
  const code = getStringField(req.body, 'code');
  const device = getStringField(req.body, 'device')?.trim() || undefined;
  if (!mfaChallengeToken || !code) {
    return error(400, 'validation_error', 'mfaChallengeToken und code sind erforderlich');
  }
  const result = await ports.loginSecurity.completeMfaLogin({
    mfaChallengeToken,
    code,
    device,
    ip: req.ip ?? '0.0.0.0',
  });
  if (!result.ok) {
    const status = result.code === 'user_disabled' ? 403 : 401;
    return error(status, result.code, 'Zweiter Faktor konnte nicht bestaetigt werden');
  }
  await ports.audit?.record({
    workspaceId: result.user.workspaceId,
    actorUserId: result.user.id,
    action: 'auth.login_succeeded',
    entityType: 'user',
    entityId: result.user.id,
    metadata: {
      email: result.user.email,
      ip: req.ip ?? '0.0.0.0',
      device: device ?? null,
      mfaMethod: 'verified',
    },
  });
  return authSessionData(req, 200, {
    user: publicUser(result.user),
  }, result.tokens);
}

async function handleGetSecuritySettings(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.loginSecurity) {
    return error(503, 'login_security_unavailable', 'Login-Sicherheit ist nicht konfiguriert');
  }
  const settings = await ports.loginSecurity.getWorkspaceSettings(principal.workspaceId);
  const loginConfig = await ports.loginSecurity.getLoginConfig();
  const users = await ports.auth.listUsers?.({ workspaceId: principal.workspaceId });
  const actor = users?.find((row) => row.id === principal.userId);
  return data(200, {
    settings,
    captchaProviderConfigured: loginConfig.captcha.provider === 'turnstile',
    currentUser: {
      loginPinEnabled: Boolean(actor?.loginPinEnabled),
      mfaEnabled: Boolean(actor?.mfaEnabled),
    },
  });
}

async function handlePatchSecuritySettings(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.loginSecurity) {
    return error(503, 'login_security_unavailable', 'Login-Sicherheit ist nicht konfiguriert');
  }
  const existing = await ports.loginSecurity.getWorkspaceSettings(principal.workspaceId);
  const parsed = parseSecuritySettingsBody(req.body, existing);
  if ('response' in parsed) return parsed.response;
  const settings = await ports.loginSecurity.setWorkspaceSettings(
    principal.workspaceId,
    parsed.values,
  );
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'auth.security_settings_updated',
    entityType: 'workspace',
    entityId: principal.workspaceId,
    metadata: settings,
  });
  const users = await ports.auth.listUsers?.({ workspaceId: principal.workspaceId });
  const actor = users?.find((row) => row.id === principal.userId);
  return data(200, {
    settings,
    currentUser: {
      loginPinEnabled: Boolean(actor?.loginPinEnabled),
      mfaEnabled: Boolean(actor?.mfaEnabled),
    },
  });
}

async function handleTotpSetup(
  req: ApiRequest,
  ports: ServerApiPorts,
  userId: string,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal) && principal.userId !== userId) {
    return error(403, 'forbidden', 'Adminrechte erforderlich');
  }
  if (!ports.loginSecurity || !ports.auth.findUserByEmail) {
    return error(503, 'login_security_unavailable', 'Login-Sicherheit ist nicht konfiguriert');
  }
  const user = await ports.auth.findUserByEmail(
    await lookupUserEmail(ports, principal.workspaceId, userId) ?? '',
  );
  if (!user || user.workspaceId !== principal.workspaceId || user.id !== userId) {
    return error(404, 'user_not_found', 'Benutzer nicht gefunden');
  }
  const setup = await ports.loginSecurity.beginTotpSetup({
    workspaceId: principal.workspaceId,
    userId,
    email: user.email,
  });
  return data(200, setup);
}

async function handleTotpConfirm(
  req: ApiRequest,
  ports: ServerApiPorts,
  userId: string,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal) && principal.userId !== userId) {
    return error(403, 'forbidden', 'Adminrechte erforderlich');
  }
  if (!ports.loginSecurity) {
    return error(503, 'login_security_unavailable', 'Login-Sicherheit ist nicht konfiguriert');
  }
  const secret = getStringField(req.body, 'secret');
  const code = getStringField(req.body, 'code');
  if (!secret || !code) {
    return error(400, 'validation_error', 'secret und code sind erforderlich');
  }
  const ok = await ports.loginSecurity.confirmTotpSetup({
    workspaceId: principal.workspaceId,
    userId,
    secret,
    code,
  });
  if (!ok) return error(400, 'mfa_setup_failed', 'Authenticator-Code konnte nicht bestaetigt werden');
  return data(200, { enabled: true, method: 'totp' });
}

async function handleEnableEmailMfa(
  req: ApiRequest,
  ports: ServerApiPorts,
  userId: string,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal) && principal.userId !== userId) {
    return error(403, 'forbidden', 'Adminrechte erforderlich');
  }
  if (!ports.loginSecurity) {
    return error(503, 'login_security_unavailable', 'Login-Sicherheit ist nicht konfiguriert');
  }
  await ports.loginSecurity.enableEmailMfa({
    workspaceId: principal.workspaceId,
    userId,
  });
  return data(200, { enabled: true, method: 'email' });
}

async function handleDisableMfa(
  req: ApiRequest,
  ports: ServerApiPorts,
  userId: string,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal) && principal.userId !== userId) {
    return error(403, 'forbidden', 'Adminrechte erforderlich');
  }
  if (!ports.loginSecurity) {
    return error(503, 'login_security_unavailable', 'Login-Sicherheit ist nicht konfiguriert');
  }
  await ports.loginSecurity.disableUserMfa({
    workspaceId: principal.workspaceId,
    userId,
  });
  return data(200, { enabled: false });
}

function parseSecuritySettingsBody(
  body: unknown,
  existing?: AuthSecurityWorkspaceSettings,
): { values: AuthSecurityWorkspaceSettings } | { response: ApiResponse } {
  const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
  const values: AuthSecurityWorkspaceSettings = {
    captchaEnabled: readOptionalBoolean(record, 'captchaEnabled', existing?.captchaEnabled ?? false),
    pinKeypadEnabled: readOptionalBoolean(record, 'pinKeypadEnabled', existing?.pinKeypadEnabled ?? false),
    mfaEnabled: readOptionalBoolean(record, 'mfaEnabled', existing?.mfaEnabled ?? false),
    mfaTotpEnabled: readOptionalBoolean(record, 'mfaTotpEnabled', existing?.mfaTotpEnabled ?? true),
    mfaEmailEnabled: readOptionalBoolean(record, 'mfaEmailEnabled', existing?.mfaEmailEnabled ?? false),
  };
  return { values };
}

function readOptionalBoolean(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  if (!Object.prototype.hasOwnProperty.call(record, key)) return fallback;
  return parseOptionalBoolean(record[key], fallback);
}

function parseOptionalBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return fallback;
}

async function lookupUserEmail(
  ports: ServerApiPorts,
  workspaceId: string,
  userId: string,
): Promise<string | null> {
  if (!ports.auth.listUsers) return null;
  const users = await ports.auth.listUsers({ workspaceId });
  return users.find((user) => user.id === userId)?.email ?? null;
}

function publicUser(user: {
  id: string;
  workspaceId: string;
  email: string;
  displayName: string;
  publicName?: string | null;
  role: 'owner' | 'admin' | 'user';
}) {
  return {
    id: user.id,
    workspaceId: user.workspaceId,
    email: user.email,
    displayName: user.displayName,
    // Carry publicName so {{user.publicName}} resolves after an MFA login too,
    // matching the password-login session (auth-routes publicUser).
    ...(user.publicName === undefined ? {} : { publicName: user.publicName }),
    role: user.role,
  };
}
