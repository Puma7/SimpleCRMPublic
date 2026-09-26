import type { ApiRequest, ApiResponse, AuthenticatedPrincipal, ServerApiPorts } from './types';
import { error, getStringField } from './http';

/**
 * A signed-in user re-entering the current password (change-password, step-up
 * before an MFA change) is a password check like /login. Without the login lockout a stolen access token
 * could guess the password at the global API rate. These helpers feed such
 * checks into the same (email, ip) counter, as completeMfaLogin does for codes.
 */
export async function passwordCheckEmail(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<string | null> {
  const user = await ports.auth.getUser?.({ workspaceId: principal.workspaceId, userId: principal.userId });
  if (user?.email) return user.email;
  const users = await ports.auth.listUsers?.({ workspaceId: principal.workspaceId });
  return users?.find((row) => row.id === principal.userId)?.email ?? null;
}

export async function passwordCheckLockResponse(
  ports: ServerApiPorts,
  email: string | null,
  ip: string,
): Promise<ApiResponse | null> {
  if (!email) return null;
  const lock = await ports.auth.checkLoginLock?.({ email, ip });
  if (!lock || lock.kind === 'none') return null;
  const locked = lock.kind === 'permanent';
  return error(
    locked ? 423 : 429,
    locked ? 'account_locked' : 'rate_limited',
    'Zu viele Fehlversuche',
    { penalty: lock },
  );
}

export async function recordFailedPasswordCheck(
  ports: ServerApiPorts,
  input: {
    principal: AuthenticatedPrincipal;
    email: string | null;
    ip: string;
    action: string;
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  if (input.email) {
    await ports.auth.recordFailedLogin({ email: input.email, ip: input.ip, userId: input.principal.userId });
  }
  await ports.audit?.record({
    workspaceId: input.principal.workspaceId,
    actorUserId: input.principal.userId,
    action: input.action,
    entityType: 'user',
    entityId: input.principal.userId,
    metadata: { ip: input.ip, ...input.metadata },
  });
}

export async function recordSuccessfulPasswordCheck(
  ports: ServerApiPorts,
  input: { principal: AuthenticatedPrincipal; email: string | null; ip: string },
): Promise<void> {
  if (!input.email) return;
  await ports.auth.recordSuccessfulLogin({ userId: input.principal.userId, email: input.email, ip: input.ip });
}

export type StepUpMethod = 'password' | 'totp';

/**
 * Step-up before a signed-in user changes a second factor (own or, as admin,
 * someone else's): the actor's current password, or a current code of the
 * actor's authenticator. A hijacked access token alone must not be enough to
 * switch off or replace MFA. Failures count like failed logins.
 */
export async function verifyStepUpAuthentication(
  req: ApiRequest,
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  audit: { operation: string; targetUserId: string },
): Promise<{ method: StepUpMethod } | { response: ApiResponse }> {
  const password = getStringField(req.body, 'currentPassword');
  const code = getStringField(req.body, 'currentMfaCode')?.trim();
  if (!password && !code) {
    return {
      response: error(403, 'reauth_required', 'Bitte zur Bestaetigung das aktuelle Passwort eingeben.'),
    };
  }

  const ip = req.ip ?? '0.0.0.0';
  const email = await passwordCheckEmail(ports, principal);
  const locked = await passwordCheckLockResponse(ports, email, ip);
  if (locked) return { response: locked };

  const method: StepUpMethod = password ? 'password' : 'totp';
  const verified = password
    ? await verifyPrincipalPassword(ports, principal, email, password)
    : Boolean(code && await ports.loginSecurity?.verifyCurrentTotpCode({
      workspaceId: principal.workspaceId,
      userId: principal.userId,
      code,
    }));
  if (!verified) {
    await recordFailedPasswordCheck(ports, {
      principal,
      email,
      ip,
      action: 'auth.mfa_reauth_failed',
      metadata: { operation: audit.operation, targetUserId: audit.targetUserId, reauthMethod: method },
    });
    return { response: error(403, 'reauth_failed', 'Passwort oder Code ist falsch.') };
  }
  await recordSuccessfulPasswordCheck(ports, { principal, email, ip });
  return { method };
}

async function verifyPrincipalPassword(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
  email: string | null,
  password: string,
): Promise<boolean> {
  if (!email) return false;
  const user = await ports.auth.findUserByEmail(email);
  if (!user || user.id !== principal.userId || user.workspaceId !== principal.workspaceId || user.disabledAt) {
    return false;
  }
  return ports.auth.verifyPassword(password, user.passwordHash);
}
