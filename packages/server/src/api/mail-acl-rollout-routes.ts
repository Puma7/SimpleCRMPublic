import type { ApiRequest, ApiResponse, ServerApiPorts } from './types';
import { data, error, requireAdmin, requirePrincipal } from './http';

const READINESS_PATH = '/api/v1/email/acl-rollout/readiness';
const ENFORCE_PATH = '/api/v1/email/acl-rollout/enforce';
const RESET_PATH = '/api/v1/email/acl-rollout/reset-counters';

export async function handleMailAclRolloutRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (req.path !== READINESS_PATH && req.path !== ENFORCE_PATH && req.path !== RESET_PATH) return null;
  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Keine Berechtigung');
  if (!ports.mailAclRollout) {
    return error(503, 'mail_acl_rollout_unavailable', 'Mail-ACL-Rollout nicht konfiguriert');
  }

  if (req.path === READINESS_PATH) {
    if (req.method !== 'GET') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    return data(200, serializeReadiness(await ports.mailAclRollout.getReadiness(principal.workspaceId)));
  }

  if (req.path === RESET_PATH) {
    if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
    const result = await ports.mailAclRollout.resetShadowCounters({ workspaceId: principal.workspaceId });
    if (!result.ok) return error(409, result.code, 'Counter koennen nur im Shadow-Modus zurueckgesetzt werden');
    await ports.audit?.record({
      workspaceId: principal.workspaceId,
      actorUserId: principal.userId,
      action: 'mail_acl_rollout.counters_reset',
      entityType: 'mail_acl_rollout',
      entityId: principal.workspaceId,
      metadata: { mode: 'shadow' },
    });
    return data(200, { ok: true });
  }

  if (req.method !== 'POST') return error(405, 'method_not_allowed', 'Methode nicht erlaubt');
  const result = await ports.mailAclRollout.transitionToEnforce({ workspaceId: principal.workspaceId });
  if (!result.ok) {
    const message = result.code === 'no_observations'
      ? 'Vor enforce ist mindestens eine Shadow-Beobachtung erforderlich'
      : result.code === 'mismatches_present'
        ? 'Enforce ist bei vorhandenen Shadow-Mismatches gesperrt'
        : result.code === 'telemetry_unhealthy'
          ? 'Enforce ist bei ungesunder Shadow-Telemetrie gesperrt'
          : 'Workspace ist nicht im Shadow-Modus';
    return error(409, result.code, message);
  }
  await ports.audit?.record({
    workspaceId: principal.workspaceId,
    actorUserId: principal.userId,
    action: 'mail_acl_rollout.enforced',
    entityType: 'mail_acl_rollout',
    entityId: principal.workspaceId,
    metadata: { mode: 'enforce' },
  });
  return data(200, { ok: true });
}

function serializeReadiness(
  readiness: Awaited<ReturnType<NonNullable<ServerApiPorts['mailAclRollout']>['getReadiness']>>,
): Record<string, unknown> {
  return {
    workspaceId: readiness.workspaceId,
    mode: readiness.mode,
    evaluated: readiness.evaluated.toString(),
    legacyAllowNewDeny: readiness.legacyAllowNewDeny.toString(),
    legacyDenyNewAllow: readiness.legacyDenyNewAllow.toString(),
    notComparable: readiness.notComparable.toString(),
    observationStartedAt: readiness.observationStartedAt,
    observationUpdatedAt: readiness.observationUpdatedAt,
    telemetryHealthy: readiness.telemetryHealthy,
    diagnosticCode: readiness.diagnosticCode,
    diagnosticAt: readiness.diagnosticAt,
    ready: readiness.ready,
    enforced: readiness.enforced,
    ...(readiness.diagnostic ? { diagnostic: readiness.diagnostic } : {}),
  };
}
