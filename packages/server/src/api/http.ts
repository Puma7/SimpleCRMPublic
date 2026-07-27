import type {
  ApiDataBody,
  ApiErrorBody,
  ApiRequest,
  ApiResponse,
  AuthenticatedPrincipal,
} from './types';
import { expandUserGroupCapabilities } from './capabilities';

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
 * Higher module levels imply lower ones (e.g. workflows.manage ⇒ workflows.view).
 */
export function requireCapability(principal: AuthenticatedPrincipal, capability: string): boolean {
  if (requireAdmin(principal)) return true;
  const granted = principal.capabilities;
  if (!granted || granted.length === 0) return false;
  if (granted.includes(capability)) return true;
  // Defensive inclusive expand: tests and tokens may store only the highest key.
  return expandUserGroupCapabilities(granted).includes(capability);
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

/**
 * Unterste Stufe des CRM-Moduls. Wird zentral im Dispatcher fuer alle Pfade
 * unter einem CRM-Wurzelsegment geprueft (siehe crm-route-inventory.ts);
 * `crm.write` schliesst sie ein.
 */
export function rejectUnlessCrmRead(
  principal: AuthenticatedPrincipal,
): ApiResponse<ApiErrorBody> | null {
  return forbidUnlessCapability(
    principal,
    'crm.read',
    'Adminrechte oder CRM-Leseberechtigung erforderlich',
  );
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

export function rejectUnlessWorkflowView(
  principal: AuthenticatedPrincipal,
): ApiResponse<ApiErrorBody> | null {
  return forbidUnlessCapability(
    principal,
    'workflows.view',
    'Adminrechte oder Workflow-Ansicht erforderlich',
  );
}

export function rejectUnlessWorkflowRun(
  principal: AuthenticatedPrincipal,
): ApiResponse<ApiErrorBody> | null {
  return forbidUnlessCapability(
    principal,
    'workflows.run',
    'Adminrechte oder Workflow-Ausfuehrung erforderlich',
  );
}

export function rejectUnlessWorkflowEdit(
  principal: AuthenticatedPrincipal,
): ApiResponse<ApiErrorBody> | null {
  return forbidUnlessCapability(
    principal,
    'workflows.edit',
    'Adminrechte oder Workflow-Bearbeitung erforderlich',
  );
}

export function rejectUnlessWorkflowManage(
  principal: AuthenticatedPrincipal,
): ApiResponse<ApiErrorBody> | null {
  return forbidUnlessCapability(
    principal,
    'workflows.manage',
    'Adminrechte oder Workflow-Verwaltung erforderlich',
  );
}

export function rejectUnlessSettingsView(
  principal: AuthenticatedPrincipal,
): ApiResponse<ApiErrorBody> | null {
  return forbidUnlessCapability(
    principal,
    'settings.view',
    'Adminrechte oder Einstellungs-Berechtigung erforderlich',
  );
}

export function rejectUnlessSettingsManage(
  principal: AuthenticatedPrincipal,
): ApiResponse<ApiErrorBody> | null {
  // Accept legacy email_settings.manage via expanded principal capabilities.
  return forbidUnlessCapability(
    principal,
    'settings.manage',
    'Adminrechte oder Einstellungs-Berechtigung erforderlich',
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
