import { maintenanceHardResetPhraseMatches } from '@simplecrm/core';
import type { ApiRequest, ApiResponse, ServerApiPorts } from './types';
import { data, error, getStringField, requireAdmin, requirePrincipal } from './http';

function requireOwner(principal: { role: string }): boolean {
  return principal.role === 'owner';
}

export async function handleMaintenanceRoute(
  req: ApiRequest,
  ports: ServerApiPorts,
): Promise<ApiResponse | null> {
  if (!req.path.startsWith('/api/v1/maintenance')) return null;
  if (!ports.maintenance) return error(503, 'maintenance_unavailable', 'Wartungsmodus ist nicht konfiguriert');

  const principal = requirePrincipal(req);
  if ('status' in principal) return principal;
  if (!requireAdmin(principal)) return error(403, 'forbidden', 'Adminrechte erforderlich');

  if (req.path === '/api/v1/maintenance/status' && req.method === 'GET') {
    return data(200, await ports.maintenance.getStatus());
  }

  if (req.path === '/api/v1/maintenance/doctor' && req.method === 'GET') {
    return data(200, await ports.maintenance.runDoctor());
  }

  if (req.path === '/api/v1/maintenance/migrations/check' && req.method === 'POST') {
    const plan = await ports.maintenance.checkMigrations();
    return data(200, {
      pendingCount: plan.pendingIds.length,
      appliedCount: plan.appliedIds.length,
      pendingIds: plan.pendingIds,
      appliedIds: plan.appliedIds,
      items: plan.items,
    });
  }

  if (req.path === '/api/v1/maintenance/migrations/apply' && req.method === 'POST') {
    const result = await ports.maintenance.applyMigrations();
    return data(200, result);
  }

  if (req.path === '/api/v1/maintenance/reset/preview' && req.method === 'GET') {
    if (!requireOwner(principal)) return error(403, 'forbidden', 'Nur der Owner darf einen Komplett-Reset vorbereiten');
    return data(200, await ports.maintenance.previewHardReset());
  }

  if (req.path === '/api/v1/maintenance/reset/execute' && req.method === 'POST') {
    if (!requireOwner(principal)) return error(403, 'forbidden', 'Nur der Owner darf einen Komplett-Reset ausführen');
    const acknowledge = req.body && typeof req.body === 'object'
      ? (req.body as Record<string, unknown>).acknowledgeDataLoss === true
      : false;
    const confirmPhrase = getStringField(req.body, 'confirmPhrase') ?? '';
    if (!acknowledge) {
      return error(400, 'acknowledgement_required', 'Bitte den vollständigen Datenverlust bestätigen');
    }
    if (!maintenanceHardResetPhraseMatches(confirmPhrase)) {
      return error(400, 'invalid_confirm_phrase', 'Bestätigungsphrase stimmt nicht');
    }
    const result = await ports.maintenance.executeHardReset();
    return data(200, {
      success: true,
      truncatedTables: result.truncatedTables,
      needsInitialSetup: true,
    });
  }

  return error(404, 'not_found', 'Wartungs-Endpunkt nicht gefunden');
}
