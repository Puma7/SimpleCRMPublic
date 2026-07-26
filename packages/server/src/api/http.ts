import type {
  ApiDataBody,
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
} from './types';

export function json<T>(status: number, body: T, headers?: Record<string, string>): ApiResponse<T> {
  return { status, body, headers };
}

export function data<T>(status: number, value: T): ApiResponse<ApiDataBody<T>> {
  return json(status, { data: value });
}

export function error(
  status: number,
  code: string,
  message: string,
  details?: unknown,
): ApiResponse<ApiErrorBody> {
  return json(status, {
    error: {
      code,
      message,
      ...(details === undefined ? {} : { details }),
    },
  });
}

export function requirePrincipal(req: ApiRequest): AuthenticatedPrincipal | ApiResponse<ApiErrorBody> {
  if (req.principal) return req.principal;
  return error(401, 'unauthorized', 'Authentifizierung erforderlich');
}

export function requireAdmin(principal: AuthenticatedPrincipal): boolean {
  return principal.role === 'owner' || principal.role === 'admin';
}

/**
 * Grant-only capability check. Owners and admins implicitly hold every
 * capability; other roles must have it granted through a group membership.
 */
export function requireCapability(principal: AuthenticatedPrincipal, capability: string): boolean {
  if (requireAdmin(principal)) return true;
  return principal.capabilities?.includes(capability) ?? false;
}

/** Returns a 403 response when the principal lacks the capability; otherwise null. */
export function forbidUnlessCapability(
  principal: AuthenticatedPrincipal,
  capability: string,
  message: string,
): ApiResponse<ApiErrorBody> | null {
  if (requireCapability(principal, capability)) return null;
  return error(403, 'forbidden', message);
}

export function rejectUnlessCrmWrite(
  principal: AuthenticatedPrincipal,
): ApiResponse<ApiErrorBody> | null {
  return forbidUnlessCapability(
    principal,
    'crm.write',
    'Adminrechte oder CRM-Schreibberechtigung erforderlich',
  );
}

export function forbidUnlessCrmWrite(
  principal: AuthenticatedPrincipal,
): ApiResponse<ApiErrorBody> | null {
  return rejectUnlessCrmWrite(principal);
}

export function rejectUnlessWorkflowManage(
  principal: AuthenticatedPrincipal,
): ApiResponse<ApiErrorBody> | null {
  return forbidUnlessCapability(
    principal,
    'workflows.manage',
    'Adminrechte oder Workflow-Berechtigung erforderlich',
  );
}

export function positiveIntFromPath(value: string | undefined): number | null {
  if (!value || !/^[1-9]\d*$/.test(value)) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : null;
}

export function getStringField(body: unknown, key: string): string | null {
  if (!body || typeof body !== 'object') return null;
  const value = (body as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}
