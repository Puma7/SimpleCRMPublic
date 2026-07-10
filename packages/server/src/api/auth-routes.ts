import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
} from '@simplecrm/core';
import {
  calculateLoginPenalty,
  shouldResetFailureCounterAfterSuccess,
} from '../auth';
import type { ApiRequest, ApiResponse, ServerApiPorts } from './types';
import {
  data,
  error,
  getStringField,
  requireAdmin,
  requirePrincipal,
} from './http';
import { timingSafeEqual } from 'node:crypto';

const DEFAULT_AUDIT_LIMIT = 100;
const MAX_AUDIT_LIMIT = 500;

export async function handleAuthRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (req.path === '/api/v1/auth/setup-state') {
    return handleSetupState(req, ports);
  }
  if (req.path === '/api/v1/auth/initial-setup') {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleInitialSetup(req, ports);
  }
  if (req.path === '/api/v1/auth/login' && req.method === 'POST') {
    return handleLogin(req, ports);
  }
  if (req.path === '/api/v1/auth/refresh' && req.method === 'POST') {
    return handleRefresh(req, ports);
  }
  if (req.path === '/api/v1/auth/logout' && req.method === 'POST') {
    return handleLogout(req, ports);
  }
  if (req.path === '/api/v1/auth/invitations') {
    if (req.method === 'POST') return handleCreateInvitation(req, ports);
    return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  }
  const invitationAcceptMatch = req.path.match(/^\/api\/v1\/auth\/invitations\/([^/]+)\/accept$/);
  if (invitationAcceptMatch) {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleAcceptInvitation(req, ports, decodeURIComponent(invitationAcceptMatch[1] ?? ''));
  }
  const invitationMatch = req.path.match(/^\/api\/v1\/auth\/invitations\/([^/]+)$/);
  if (invitationMatch) {
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleGetInvitation(req, ports, decodeURIComponent(invitationMatch[1] ?? ''));
  }
  if (req.path === '/api/v1/auth/change-password') {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return handleChangePassword(req, ports);
  }
  if (req.path === '/api/v1/auth/users') {
    if (req.method === 'GET') return handleListUsers(req, ports);
    if (req.method === 'POST') return handleSaveUser(req, ports);
    return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  }
  const userMatch = req.path.match(/^\/api\/v1\/auth\/users\/([^/]+)$/);
  if (userMatch) {
    const userId = decodeURIComponent(userMatch[1] ?? '');
    if (req.method === 'PATCH') return handleSaveUser(req, ports, userId);
    if (req.method === 'DELETE') return handleDeleteUser(req, ports, userId);
    return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  }
  if (req.path === '/api/v1/auth/audit-log') {
    return handleAuditLog(req, ports);
  }
  if (req.path === '/api/v1/auth/audit-chain/verify') {
    return handleAuditChainVerify(req, ports);
  }
  return null;
}

async function handleSetupState(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  if (!ports.auth.getInitialSetupState) {
    return error(503, 'auth_setup_unavailable', 'Initiales Server-Setup ist nicht konfiguriert');
  }
  const state = await ports.auth.getInitialSetupState();
  return data(200, {
    needsInitialSetup: state.needsInitialSetup,
  });
}

async function handleInitialSetup(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (!ports.auth.createInitialOwner) {
    return error(503, 'auth_setup_unavailable', 'Initiales Server-Setup ist nicht konfiguriert');
  }

  const tokenCheck = verifyInitialSetupToken(req, ports.initialSetupToken);
  if (tokenCheck) return tokenCheck;

  const parsed = parseInitialSetupBody(req.body);
  if ('response' in parsed) return parsed.response;

  const created = await ports.auth.createInitialOwner(parsed.values);
  if (!created.ok) {
    return error(409, 'already_configured', 'Initiales Server-Setup wurde bereits abgeschlossen');
  }

  await ports.audit?.record({
    workspaceId: created.user.workspaceId,
    actorUserId: created.user.id,
    action: 'auth.initial_owner_created',
    entityType: 'user',
    entityId: created.user.id,
    metadata: {
      email: created.user.email,
      workspaceName: parsed.values.workspaceName,
      device: parsed.values.device ?? null,
    },
  });

  return data(201, {
    user: publicUser(created.user),
    tokens: created.tokens,
  });
}

async function handleLogin(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const email = getStringField(req.body, 'email')?.trim().toLowerCase();
  const password = getStringField(req.body, 'password');
  const pin = getStringField(req.body, 'pin') ?? undefined;
  const captchaChallenge = getStringField(req.body, 'captchaChallenge') ?? undefined;
  const device = getStringField(req.body, 'device')?.trim() || undefined;
  const ip = req.ip ?? '0.0.0.0';

  if (!email || !password) {
    return error(400, 'validation_error', 'email und password sind erforderlich');
  }

  const existingLock = await ports.auth.checkLoginLock?.({ email, ip });
  if (existingLock && existingLock.kind !== 'none') {
    const locked = existingLock.kind === 'permanent';
    return error(
      locked ? 423 : 429,
      locked ? 'account_locked' : 'rate_limited',
      'Zu viele Fehlversuche',
      { penalty: existingLock },
    );
  }

  const user = await ports.auth.findUserByEmail(email);
  if (user?.disabledAt) {
    return error(403, 'user_disabled', 'Benutzer ist deaktiviert');
  }

  const loginConfig = ports.loginSecurity
    ? await ports.loginSecurity.getLoginConfig(email)
    : null;
  if (loginConfig?.captcha.enabled && ports.loginSecurity) {
    if (!ports.loginSecurity.assertCaptchaChallenge({ challenge: captchaChallenge, ip })) {
      return error(403, 'captcha_required', 'CAPTCHA-Bestaetigung erforderlich');
    }
  }

  const workspaceSettings = user && ports.loginSecurity
    ? await ports.loginSecurity.getWorkspaceSettings(user.workspaceId)
    : null;

  const verified = user ? await ports.auth.verifyPassword(password, user.passwordHash) : false;
  if (!user || !verified) {
    const failedAttempts = await ports.auth.recordFailedLogin({
      email,
      ip,
      userId: user?.id,
    });
    const penalty = calculateLoginPenalty(failedAttempts);
    if (user) {
      await ports.audit?.record({
        workspaceId: user.workspaceId,
        actorUserId: user.id,
        action: 'auth.login_failed',
        entityType: 'user',
        entityId: user.id,
        metadata: {
          email,
          ip,
          failedAttempts,
          penaltyKind: penalty.kind,
        },
      });
    }
    const locked = penalty.kind === 'permanent';
    return error(locked ? 423 : 401, locked ? 'account_locked' : 'invalid_credentials', 'Ungültige Zugangsdaten', {
      failedAttempts,
      penalty,
    });
  }

  if (workspaceSettings && ports.loginSecurity) {
    const pinOk = await ports.loginSecurity.assertLoginPin({
      user,
      workspaceSettings,
      pin,
    });
    if (!pinOk) {
      const failedAttempts = await ports.auth.recordFailedLogin({ email, ip, userId: user.id });
      const penalty = calculateLoginPenalty(failedAttempts);
      return error(401, 'invalid_credentials', 'Ungültige Zugangsdaten', {
        failedAttempts,
        penalty,
      });
    }
  }

  const mfaStep = workspaceSettings && ports.loginSecurity
    ? await ports.loginSecurity.beginMfaIfRequired({ user, workspaceSettings, device })
    : { kind: 'complete' as const };
  if (mfaStep.kind === 'mfa_delivery_failed') {
    return error(
      503,
      'mfa_delivery_failed',
      'Der Anmeldecode konnte nicht per E-Mail versendet werden. Bitte den Administrator kontaktieren.',
    );
  }
  if (mfaStep.kind === 'mfa_required') {
    return data(200, {
      mfaRequired: true,
      mfaMethod: mfaStep.mfaMethod,
      mfaChallengeToken: mfaStep.mfaChallengeToken,
    });
  }

  await ports.auth.recordSuccessfulLogin({ userId: user.id, email, ip });
  const tokens = await ports.auth.issueTokenPair({ user, device });
  await ports.audit?.record({
    workspaceId: user.workspaceId,
    actorUserId: user.id,
    action: 'auth.login_succeeded',
    entityType: 'user',
    entityId: user.id,
    metadata: {
      email,
      ip,
      device: device ?? null,
    },
  });
  return data(200, {
    user: publicUser(user),
    tokens,
    resetFailureCounter: shouldResetFailureCounterAfterSuccess(),
  });
}

async function handleRefresh(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const refreshToken = getStringField(req.body, 'refreshToken')?.trim();
  if (!refreshToken) {
    return error(400, 'validation_error', 'refreshToken ist erforderlich');
  }

  const rotated = await ports.auth.rotateRefreshToken({ refreshToken });
  if (!rotated) {
    return error(401, 'invalid_refresh_token', 'Refresh-Token ist ungültig oder widerrufen');
  }

  await ports.audit?.record({
    workspaceId: rotated.user.workspaceId,
    actorUserId: rotated.user.id,
    action: 'auth.refresh_rotated',
    entityType: 'user',
    entityId: rotated.user.id,
    metadata: {},
  });

  return data(200, {
    user: publicUser(rotated.user),
    tokens: rotated.tokens,
  });
}

async function handleListUsers(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.auth.listUsers) return error(503, 'auth_users_unavailable', 'Benutzerverwaltung ist nicht konfiguriert');
  const rows = await ports.auth.listUsers({ workspaceId: principal.workspaceId });
  return data(200, rows.map(publicAdminUser));
}

async function handleSaveUser(
  req: ApiRequest,
  ports: ServerApiPorts,
  pathUserId?: string,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.auth.saveUser) return error(503, 'auth_users_unavailable', 'Benutzerverwaltung ist nicht konfiguriert');

  const parsed = parseUserSaveBody(req.body, pathUserId);
  if ('response' in parsed) return parsed.response;

  const { loginPin, ...saveValues } = parsed.values;
  const result = await ports.auth.saveUser({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    ...saveValues,
  });
  if (!result.ok) {
    if (result.code === 'not_found') return error(404, 'auth_user_not_found', 'Benutzer nicht gefunden');
    if (result.code === 'duplicate_email') return error(409, 'auth_user_duplicate_email', 'E-Mail ist bereits vergeben');
    if (result.code === 'password_required') return error(400, 'validation_error', 'Passwort ist fuer neue Benutzer erforderlich');
    return error(409, 'last_owner_required', 'Mindestens ein aktiver Owner muss erhalten bleiben');
  }

  if (loginPin !== undefined && ports.loginSecurity) {
    await ports.loginSecurity.setUserPin({
      workspaceId: principal.workspaceId,
      userId: result.user.id,
      pin: loginPin,
    });
  }

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: parsed.values.id ? 'auth.user_updated' : 'auth.user_created',
    entityType: 'user',
    entityId: result.user.id,
    metadata: {
      email: result.user.email,
      role: result.user.role,
      isActive: result.user.disabledAt === null,
      passwordChanged: Boolean(parsed.values.password),
      loginPinChanged: loginPin !== undefined,
    },
  });

  const refreshed = await ports.auth.listUsers?.({ workspaceId: principal.workspaceId });
  const savedUser = refreshed?.find((row) => row.id === result.user.id) ?? result.user;
  return data(parsed.values.id ? 200 : 201, publicAdminUser(savedUser));
}

async function handleDeleteUser(
  req: ApiRequest,
  ports: ServerApiPorts,
  id: string,
): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.auth.deleteUser) return error(503, 'auth_users_unavailable', 'Benutzerverwaltung ist nicht konfiguriert');
  if (id === principal.userId) return error(409, 'cannot_delete_self', 'Sie koennen sich nicht selbst loeschen');

  const result = await ports.auth.deleteUser({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    id,
  });
  if (!result.ok) {
    if (result.code === 'not_found') return error(404, 'auth_user_not_found', 'Benutzer nicht gefunden');
    return error(409, 'last_owner_required', 'Mindestens ein aktiver Owner muss erhalten bleiben');
  }

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'auth.user_deleted',
    entityType: 'user',
    entityId: id,
    metadata: {},
  });
  return data(200, { deleted: true, id });
}

async function handleChangePassword(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!ports.auth.changePassword) {
    return error(503, 'auth_change_password_unavailable', 'Passwortaenderung ist nicht konfiguriert');
  }

  const currentPassword = getStringField(req.body, 'currentPassword');
  const newPassword = getStringField(req.body, 'newPassword');
  if (!currentPassword || !newPassword) {
    return error(400, 'validation_error', 'currentPassword und newPassword sind erforderlich');
  }
  if (newPassword.length < 10) {
    return error(400, 'validation_error', 'Das neue Passwort muss mindestens 10 Zeichen haben');
  }

  const result = await ports.auth.changePassword({
    workspaceId: principal.workspaceId,
    userId: principal.userId,
    currentPassword,
    newPassword,
  });
  if (!result.ok) {
    if (result.code === 'invalid_current') {
      return error(403, 'invalid_current_password', 'Aktuelles Passwort ist falsch');
    }
    return error(400, 'validation_error', 'Passwort konnte nicht geaendert werden');
  }

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'auth.password_changed',
    entityType: 'user',
    entityId: principal.userId,
    metadata: {},
  });
  return data(200, { success: true });
}

async function handleCreateInvitation(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.auth.createInvitation) return error(503, 'auth_invitations_unavailable', 'Einladungen sind nicht konfiguriert');

  const parsed = parseInvitationCreateBody(req.body);
  if ('response' in parsed) return parsed.response;

  const result = await ports.auth.createInvitation({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    ...parsed.values,
  });
  if (!result.ok) {
    if (result.code === 'duplicate_email') return error(409, 'auth_user_duplicate_email', 'E-Mail ist bereits vergeben');
    return error(409, 'auth_invitation_duplicate', 'Fuer diese E-Mail existiert bereits eine offene Einladung');
  }

  const acceptPath = `/login?invite=${encodeURIComponent(result.token)}`;
  const delivery = await sendInvitationMail(ports, {
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    invitation: result.invitation,
    acceptPath,
  });

  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'auth.invitation_created',
    entityType: 'auth_invitation',
    entityId: result.invitation.id,
    metadata: {
      email: result.invitation.email,
      role: result.invitation.role,
      expiresAt: result.invitation.expiresAt,
      deliveryStatus: delivery.status,
      ...(delivery.status === 'failed' ? { deliveryError: delivery.error } : {}),
    },
  });

  return data(201, {
    invitation: publicInvitation(result.invitation),
    token: result.token,
    acceptPath,
    delivery,
  });
}

async function handleGetInvitation(
  req: ApiRequest,
  ports: ServerApiPorts,
  token: string,
): Promise<ApiResponse> {
  const normalizedToken = normalizeInviteToken(token);
  if (!normalizedToken) return error(404, 'auth_invitation_invalid', 'Einladung nicht gefunden');
  if (!ports.auth.getInvitationByToken) return error(503, 'auth_invitations_unavailable', 'Einladungen sind nicht konfiguriert');
  const result = await ports.auth.getInvitationByToken({ token: normalizedToken });
  if (!result.ok) return invitationErrorResponse(result.code);
  return data(200, publicInvitation(result.invitation));
}

async function sendInvitationMail(
  ports: ServerApiPorts,
  input: Parameters<NonNullable<ServerApiPorts['authInvitationMailer']>['sendInvitation']>[0],
) {
  if (!ports.authInvitationMailer) return { status: 'not_configured' as const };
  try {
    return await ports.authInvitationMailer.sendInvitation(input);
  } catch {
    return { status: 'failed' as const, error: 'smtp_send_failed' as const };
  }
}

async function handleAcceptInvitation(
  req: ApiRequest,
  ports: ServerApiPorts,
  token: string,
): Promise<ApiResponse> {
  const normalizedToken = normalizeInviteToken(token);
  if (!normalizedToken) return error(404, 'auth_invitation_invalid', 'Einladung nicht gefunden');
  if (!ports.auth.acceptInvitation) return error(503, 'auth_invitations_unavailable', 'Einladungen sind nicht konfiguriert');

  const parsed = parseInvitationAcceptBody(req.body);
  if ('response' in parsed) return parsed.response;
  const result = await ports.auth.acceptInvitation({
    token: normalizedToken,
    ...parsed.values,
  });
  if (!result.ok) {
    if (result.code === 'duplicate_email') return error(409, 'auth_user_duplicate_email', 'E-Mail ist bereits vergeben');
    return invitationErrorResponse(result.code);
  }

  await ports.audit?.record({
    workspaceId: result.user.workspaceId,
    actorUserId: result.user.id,
    action: 'auth.invitation_accepted',
    entityType: 'user',
    entityId: result.user.id,
    metadata: {
      email: result.user.email,
      role: result.user.role,
      device: parsed.values.device ?? null,
    },
  });

  return data(200, {
    user: publicUser(result.user),
    tokens: result.tokens,
  });
}

async function handleLogout(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  const refreshToken = getStringField(req.body, 'refreshToken')?.trim();
  if (!refreshToken) {
    return error(400, 'validation_error', 'refreshToken ist erforderlich');
  }

  const revoked = await ports.auth.revokeRefreshToken({
    refreshToken,
    principal: req.principal,
  });
  if (req.principal) {
    await ports.audit?.record({
      workspaceId: req.principal.workspaceId,
      actorUserId: req.principal.userId,
      action: 'auth.logout',
      entityType: 'user',
      entityId: req.principal.userId,
      metadata: {
        revoked,
      },
    });
  }
  return data(200, { revoked });
}

async function handleAuditLog(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.audit?.list) return error(503, 'audit_unavailable', 'Audit-Log API nicht konfiguriert');
  const limit = parseAuditLimit(req.query?.limit);
  if (limit === null) return error(400, 'invalid_limit', `limit muss zwischen 1 und ${MAX_AUDIT_LIMIT} liegen`);
  const offset = parseAuditOffset(req.query?.offset);
  if (offset === null) return error(400, 'invalid_offset', 'offset muss eine nicht-negative Ganzzahl sein');
  const rows = await ports.audit.list({
    workspaceId: principal.workspaceId,
    limit,
    ...(offset === undefined ? {} : { offset }),
  });
  return data(200, rows.map((row) => ({
    id: Number(row.id),
    workspaceId: row.workspaceId,
    actorUserId: row.actorUserId ?? null,
    action: row.action,
    entityType: row.entityType ?? null,
    entityId: row.entityId ?? null,
    metadata: row.metadata,
    previousHash: row.previousHash ?? null,
    eventHash: row.eventHash,
    createdAt: row.createdAt,
  })));
}

async function handleAuditChainVerify(req: ApiRequest, ports: ServerApiPorts): Promise<ApiResponse> {
  if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');
  if (!ports.audit?.verify) return error(503, 'audit_unavailable', 'Audit-Chain API nicht konfiguriert');
  const result = await ports.audit.verify({ workspaceId: principal.workspaceId });
  return data(200, {
    valid: result.valid,
    checked: result.checked,
    ...(result.firstBrokenId === undefined ? {} : { firstBrokenId: result.firstBrokenId }),
    ...(result.error === undefined ? {} : { error: result.error }),
  });
}

function publicUser(user: {
  id: string;
  workspaceId: string;
  email: string;
  displayName: string;
  role: string;
}) {
  return {
    id: user.id,
    workspaceId: user.workspaceId,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
  };
}

function publicAdminUser(user: {
  id: string;
  email: string;
  displayName: string;
  role: string;
  disabledAt: string | null;
  loginPinEnabled?: boolean;
  mfaEnabled?: boolean;
  mfaMethod?: 'totp' | 'email' | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    role: user.role,
    disabledAt: user.disabledAt,
    loginPinEnabled: Boolean(user.loginPinEnabled),
    mfaEnabled: Boolean(user.mfaEnabled),
    mfaMethod: user.mfaMethod ?? null,
    ...(user.createdAt === undefined ? {} : { createdAt: user.createdAt }),
    ...(user.updatedAt === undefined ? {} : { updatedAt: user.updatedAt }),
  };
}

function publicInvitation(invitation: {
  id: string;
  email: string;
  displayName: string;
  role: string;
  expiresAt: string;
  acceptedAt?: string | null;
  revokedAt?: string | null;
  createdAt?: string | null;
}) {
  return {
    id: invitation.id,
    email: invitation.email,
    displayName: invitation.displayName,
    role: invitation.role,
    expiresAt: invitation.expiresAt,
    acceptedAt: invitation.acceptedAt ?? null,
    revokedAt: invitation.revokedAt ?? null,
    ...(invitation.createdAt === undefined ? {} : { createdAt: invitation.createdAt }),
  };
}

function parseInitialSetupBody(body: unknown):
  | { values: { email: string; password: string; displayName: string; workspaceName: string; device?: string } }
  | { response: ApiResponse } {
  const email = normalizeEmail(getStringField(body, 'email'));
  const password = getStringField(body, 'password');
  const displayName = normalizeOptionalText(getStringField(body, 'displayName'), 120) ?? email ?? 'Owner';
  const workspaceName = normalizeOptionalText(getStringField(body, 'workspaceName'), 120) ?? 'SimpleCRM';
  const device = normalizeOptionalText(getStringField(body, 'device'), 120);
  const errors: Array<{ field: string; message: string }> = [];

  if (!email) {
    errors.push({ field: 'email', message: 'email muss eine gueltige E-Mail-Adresse sein' });
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    errors.push({ field: 'password', message: `password muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` });
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push({ field: 'password', message: `password darf maximal ${MAX_PASSWORD_LENGTH} Zeichen haben` });
  }
  if (displayName.length > 120) {
    errors.push({ field: 'displayName', message: 'displayName darf maximal 120 Zeichen haben' });
  }
  if (workspaceName.length > 120) {
    errors.push({ field: 'workspaceName', message: 'workspaceName darf maximal 120 Zeichen haben' });
  }

  if (errors.length > 0 || !email || !password) {
    return {
      response: error(400, 'validation_error', 'Initiales Setup ist ungueltig', { fields: errors }),
    };
  }

  return {
    values: {
      email,
      password,
      displayName,
      workspaceName,
      ...(device ? { device } : {}),
    },
  };
}

function parseInvitationCreateBody(body: unknown):
  | { values: { email: string; displayName: string; role: 'owner' | 'admin' | 'user'; expiresInDays?: number } }
  | { response: ApiResponse } {
  const bodyRecord = isRecord(body) ? body : {};
  const email = normalizeEmail(getStringField(body, 'email') ?? getStringField(body, 'username'));
  const displayName = normalizeOptionalText(getStringField(body, 'displayName') ?? getStringField(body, 'display_name'), 120)
    ?? email
    ?? '';
  const role = normalizeServerUserRole(getStringField(body, 'role')) ?? 'user';
  const expiresInDays = normalizeOptionalInt(bodyRecord.expiresInDays, 1, 30);
  const errors: Array<{ field: string; message: string }> = [];

  if (!email) errors.push({ field: 'email', message: 'email muss eine gueltige E-Mail-Adresse sein' });
  if (!displayName) errors.push({ field: 'displayName', message: 'displayName ist erforderlich' });
  if (bodyRecord.expiresInDays !== undefined && expiresInDays === undefined) {
    errors.push({ field: 'expiresInDays', message: 'expiresInDays muss zwischen 1 und 30 liegen' });
  }

  if (errors.length > 0 || !email) {
    return {
      response: error(400, 'validation_error', 'Einladungs-Payload ist ungueltig', { fields: errors }),
    };
  }

  return {
    values: {
      email,
      displayName,
      role,
      ...(expiresInDays === undefined ? {} : { expiresInDays }),
    },
  };
}

function parseInvitationAcceptBody(body: unknown):
  | { values: { password: string; device?: string } }
  | { response: ApiResponse } {
  const password = getStringField(body, 'password') ?? getStringField(body, 'passphrase');
  const device = normalizeOptionalText(getStringField(body, 'device'), 120);
  const errors: Array<{ field: string; message: string }> = [];

  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    errors.push({ field: 'password', message: `password muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` });
  } else if (password.length > MAX_PASSWORD_LENGTH) {
    errors.push({ field: 'password', message: `password darf maximal ${MAX_PASSWORD_LENGTH} Zeichen haben` });
  }

  if (errors.length > 0 || !password) {
    return {
      response: error(400, 'validation_error', 'Einladung kann mit diesem Payload nicht angenommen werden', { fields: errors }),
    };
  }

  return {
    values: {
      password,
      ...(device ? { device } : {}),
    },
  };
}

function invitationErrorResponse(code: 'invalid_token' | 'expired' | 'accepted' | 'revoked'): ApiResponse {
  if (code === 'invalid_token') return error(404, 'auth_invitation_invalid', 'Einladung nicht gefunden');
  if (code === 'expired') return error(410, 'auth_invitation_expired', 'Einladung ist abgelaufen');
  if (code === 'accepted') return error(410, 'auth_invitation_accepted', 'Einladung wurde bereits angenommen');
  return error(410, 'auth_invitation_revoked', 'Einladung wurde widerrufen');
}

function normalizeEmail(value: string | null): string | null {
  const normalized = value?.trim().toLowerCase() ?? '';
  if (!normalized || normalized.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) return null;
  return normalized;
}

function normalizeInviteToken(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || normalized.length > 240) return null;
  if (!/^[A-Za-z0-9_-]+$/.test(normalized)) return null;
  return normalized;
}

function normalizeOptionalText(value: string | null, maxLength: number): string | undefined {
  const normalized = value?.trim();
  if (!normalized) return undefined;
  return normalized.length <= maxLength ? normalized : normalized;
}

function normalizeOptionalInt(value: unknown, min: number, max: number): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) return undefined;
  return parsed;
}

function parseUserSaveBody(body: unknown, pathUserId?: string):
  | { values: { id?: string; email: string; displayName: string; role: 'owner' | 'admin' | 'user'; password?: string; isActive?: boolean; loginPin?: string | null } }
  | { response: ApiResponse } {
  const bodyRecord = isRecord(body) ? body : null;
  const id = pathUserId || normalizeOptionalText(getStringField(body, 'id'), 120);
  const email = normalizeEmail(getStringField(body, 'email') ?? getStringField(body, 'username'));
  const displayName = normalizeOptionalText(getStringField(body, 'displayName') ?? getStringField(body, 'display_name'), 120)
    ?? email
    ?? '';
  const role = normalizeServerUserRole(getStringField(body, 'role'));
  const password = getStringField(body, 'passphrase') ?? getStringField(body, 'password') ?? undefined;
  const isActive = normalizeOptionalBoolean(bodyRecord?.isActive ?? bodyRecord?.is_active);
  const loginPinRaw = getStringField(body, 'loginPin') ?? getStringField(body, 'login_pin');
  const loginPin = loginPinRaw === undefined || loginPinRaw === null
    ? undefined
    : loginPinRaw.trim() === ''
      ? null
      : loginPinRaw.trim();
  const errors: Array<{ field: string; message: string }> = [];

  if (!email) errors.push({ field: 'email', message: 'email muss eine gueltige E-Mail-Adresse sein' });
  if (!displayName) errors.push({ field: 'displayName', message: 'displayName ist erforderlich' });
  if (!role) errors.push({ field: 'role', message: 'role muss owner, admin oder user sein' });
  if (password !== undefined && password.length < MIN_PASSWORD_LENGTH) {
    errors.push({ field: 'password', message: `password muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` });
  } else if (password !== undefined && password.length > MAX_PASSWORD_LENGTH) {
    errors.push({ field: 'password', message: `password darf maximal ${MAX_PASSWORD_LENGTH} Zeichen haben` });
  }
  if (loginPin !== undefined && loginPin !== null && !/^\d{6}$/.test(loginPin)) {
    errors.push({ field: 'loginPin', message: 'loginPin muss genau 6 Ziffern haben' });
  }

  if (errors.length > 0 || !email || !role) {
    return {
      response: error(400, 'validation_error', 'Benutzer-Payload ist ungueltig', { fields: errors }),
    };
  }

  return {
    values: {
      ...(id ? { id } : {}),
      email,
      displayName,
      role,
      ...(password === undefined ? {} : { password }),
      ...(isActive === undefined ? {} : { isActive }),
      ...(loginPin === undefined ? {} : { loginPin }),
    },
  };
}

function normalizeServerUserRole(value: string | null): 'owner' | 'admin' | 'user' | null {
  const normalized = value?.trim().toLowerCase();
  if (normalized === 'owner' || normalized === 'admin' || normalized === 'user') return normalized;
  if (normalized === 'agent' || normalized === 'viewer') return 'user';
  return null;
}

function normalizeOptionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
    if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  }
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseAuditLimit(value: string | undefined): number | null {
  if (value === undefined || value === '') return DEFAULT_AUDIT_LIMIT;
  const limit = parsePositiveInt(value);
  if (limit === null || limit > MAX_AUDIT_LIMIT) return null;
  return limit;
}

function parseAuditOffset(value: string | undefined): number | undefined | null {
  if (value === undefined || value === '') return undefined;
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function parsePositiveInt(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function verifyInitialSetupToken(
  req: ApiRequest,
  configuredToken: string | undefined,
): ApiResponse | null {
  const expected = configuredToken?.trim();
  if (!expected) {
    return error(
      503,
      'initial_setup_token_required',
      'INITIAL_SETUP_TOKEN muss auf dem Server gesetzt sein, bevor das erste Owner-Konto angelegt werden kann.',
    );
  }

  const headerToken = req.headers?.['x-initial-setup-token']?.trim();
  const bodyToken =
    getStringField(req.body, 'setupToken')?.trim()
    ?? getStringField(req.body, 'initialSetupToken')?.trim();
  const provided = headerToken || bodyToken;
  if (!provided) {
    return error(403, 'forbidden', 'Initial-Setup-Token erforderlich');
  }

  const expectedBuf = Buffer.from(expected);
  const providedBuf = Buffer.from(provided);
  if (expectedBuf.length !== providedBuf.length || !timingSafeEqual(expectedBuf, providedBuf)) {
    return error(403, 'forbidden', 'Initial-Setup-Token ungueltig');
  }
  return null;
}
