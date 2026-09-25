import type { ApiResponse, AuthenticatedPrincipal, ServerApiPorts } from './types';
import { error } from './http';

/**
 * A signed-in user re-entering the current password (change-password) is a
 * password check like /login. Without the login lockout a stolen access token
 * could guess the password at the global API rate. These helpers feed such
 * checks into the same (email, ip) counter, as completeMfaLogin does for codes.
 */
export async function passwordCheckEmail(
  ports: ServerApiPorts,
  principal: AuthenticatedPrincipal,
): Promise<string | null> {
  const user = await ports.auth.getUser?.({ workspaceId: principal.workspaceId, userId: principal.userId });
  return user?.email ?? null;
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
  input: { principal: AuthenticatedPrincipal; email: string | null; ip: string; action: string },
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
    metadata: { ip: input.ip },
  });
}

export async function recordSuccessfulPasswordCheck(
  ports: ServerApiPorts,
  input: { principal: AuthenticatedPrincipal; email: string | null; ip: string },
): Promise<void> {
  if (!input.email) return;
  await ports.auth.recordSuccessfulLogin({ userId: input.principal.userId, email: input.email, ip: input.ip });
}
